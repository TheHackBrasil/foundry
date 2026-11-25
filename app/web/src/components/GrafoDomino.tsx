import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  CAMPOS_VIGIADOS,
  PARTES,
  type AlvoFocoGenUI,
  type CampoVigiado,
  type Divergencia,
  type Parte,
  type Tarefa,
} from '../../../shared/model.ts';
import { garantirEstilosOps } from '../apiOps.ts';
import { formatarValor, rotuloCampo, rotuloFonte, rotuloParte, variacao } from '../format.ts';
import { agruparTarefas, tarefasDaParte } from '../matriz.ts';
import { IconeConfere, IconeDiverge } from './icones.tsx';

export interface GrafoDominoProps {
  divergencias: readonly Divergencia[];
  tarefas: readonly Tarefa[];
  modo?: 'atual' | 'simulacao';
  camposFoco?: readonly CampoVigiado[];
  partesFoco?: readonly Parte[];
  titulo?: string;
  aoFocar?: (alvo: AlvoFocoGenUI | null) => void;
  aoSelecionarPapel?: (parte: Parte) => void;
}

interface NoDivergencia {
  campo: CampoVigiado;
  principal: Divergencia;
  rotuloCurto: string;
  regraCausal: string;
  resumoDelta: string | null;
  comparacao: string;
  fontesTexto: string;
  partesImpactadas: ReadonlySet<Parte>;
  totalPares: number;
}

interface NoSetor {
  parte: Parte;
  totalAcoes: number;
  primeiraAcao: string | null;
  camposOrigem: CampoVigiado[];
}

interface ArestaCausal {
  chave: string;
  campo: CampoVigiado;
  parte: Parte;
  regra: string;
}

interface GeometriaSvg {
  largura: number;
  altura: number;
  esquerdaY: Record<string, number>;
  direitaY: Record<string, number>;
}

const ROTULO_CURTO_CAMPO = new Map<CampoVigiado, string>([
  ['previsaoEntrega', 'Previsão de entrega'],
  ['pesoTotal', 'Peso total'],
  ['volumes', 'Volumes'],
  ['status', 'Status'],
]);

const TAG_CURTA_CAMPO = new Map<CampoVigiado, string>([
  ['previsaoEntrega', 'Previsão'],
  ['pesoTotal', 'Peso'],
  ['volumes', 'Volumes'],
  ['status', 'Status'],
]);

const REGRA_CAUSAL_CAMPO = new Map<CampoVigiado, string>([
  ['previsaoEntrega', 'Janela de entrega'],
  ['pesoTotal', 'Conferência de carga'],
  ['volumes', 'Cubagem e doca'],
  ['status', 'Status operacional'],
]);

function deltaVisivel(d: Divergencia): string | null {
  const v = variacao(d.campo, d.valorB, d.valorA);
  if (v) {
    return d.campo === 'volumes' ? `${v} vol` : v;
  }
  if (d.campo === 'status') {
    return formatarValor('status', d.valorB);
  }
  return null;
}

function comparacaoConcreta(d: Divergencia): string {
  const a = formatarValor(d.campo, d.valorA);
  const b = formatarValor(d.campo, d.valorB);
  if (d.campo === 'previsaoEntrega') {
    const mA = /^(\d{2}\/\d{2})\/(\d{4})$/.exec(a);
    const mB = /^(\d{2}\/\d{2})\/(\d{4})$/.exec(b);
    if (mA && mB && mA[2] === mB[2]) {
      return `${mA[1]} → ${mB[1]}`;
    }
  }
  if (d.campo === 'volumes') {
    return `${a} → ${b} vol`;
  }
  return `${a} → ${b}`;
}

export function GrafoDomino({
  divergencias,
  tarefas,
  modo = 'atual',
  camposFoco,
  partesFoco,
  titulo,
  aoFocar,
  aoSelecionarPapel,
}: GrafoDominoProps) {
  useEffect(() => {
    garantirEstilosOps();
  }, []);

  const uid = useId().replace(/:/g, '');
  const markerAtivoId = `domino-seta-ativa-${uid}`;
  const markerDimId = `domino-seta-dim-${uid}`;

  const [campoIsolado, setCampoIsolado] = useState<CampoVigiado | null>(null);
  const [parteIsolada, setParteIsolada] = useState<Parte | null>(null);
  const [hoverCampo, setHoverCampo] = useState<CampoVigiado | null>(null);
  const [hoverParte, setHoverParte] = useState<Parte | null>(null);
  // Foco de teclado revela as arestas do nó sem exigir clique (THE-15).
  const [focoCampo, setFocoCampo] = useState<CampoVigiado | null>(null);
  const [focoParte, setFocoParte] = useState<Parte | null>(null);
  const [visivel, setVisivel] = useState(true);
  const [revelado, setRevelado] = useState(() => typeof IntersectionObserver === 'undefined');

  const wrapRef = useRef<HTMLElement>(null);
  const centroRef = useRef<HTMLDivElement>(null);
  const esqRefs = useRef<Map<CampoVigiado, HTMLButtonElement>>(new Map());
  const dirRefs = useRef<Map<Parte, HTMLButtonElement>>(new Map());

  // Dispara draw-in uma única vez ao entrar na viewport e pausa pulsos fora de tela.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      setVisivel(true);
      setRevelado(true);
      return;
    }
    const verificarAgora = () => {
      const r = el.getBoundingClientRect();
      if (r.height > 0 && r.top < window.innerHeight + 60 && r.bottom > -60) {
        setVisivel(true);
        setRevelado(true);
      }
    };
    const io = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const emTela = entry.isIntersecting;
        setVisivel(emTela);
        if (emTela) setRevelado(true);
      },
      { threshold: 0, rootMargin: '60px 0px' },
    );
    io.observe(el);
    verificarAgora();
    const raf = window.requestAnimationFrame(verificarAgora);
    return () => {
      window.cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [divergencias.length]);

  // Arestas ocultas por padrão (THE-15): nenhum pulso automático na chegada;
  // o fluxo só aparece quando a pessoa ativa um nó de origem.
  const [geom, setGeom] = useState<GeometriaSvg>({
    largura: 240,
    altura: 280,
    esquerdaY: {},
    direitaY: {},
  });

  const nosDivergencia = useMemo<NoDivergencia[]>(() => {
    const porCampo = new Map<CampoVigiado, Divergencia[]>();
    for (const d of divergencias) {
      const lista = porCampo.get(d.campo) ?? [];
      lista.push(d);
      porCampo.set(d.campo, lista);
    }

    const saida: NoDivergencia[] = [];
    for (const campo of CAMPOS_VIGIADOS) {
      const lista = porCampo.get(campo);
      if (!lista || lista.length === 0) continue;
      const principal = lista.at(-1) ?? lista[0];
      if (!principal) continue;

      const partes = new Set<Parte>();
      for (const t of tarefas) {
        if (t.divergencia.campo === campo) partes.add(t.parte);
      }

      const fontesTexto =
        lista.length > 1
          ? `${rotuloFonte(principal.fonteA)} × ${rotuloFonte(principal.fonteB)} (+${lista.length - 1})`
          : `${rotuloFonte(principal.fonteA)} × ${rotuloFonte(principal.fonteB)}`;

      saida.push({
        campo,
        principal,
        rotuloCurto: ROTULO_CURTO_CAMPO.get(campo) ?? rotuloCampo(campo),
        regraCausal: REGRA_CAUSAL_CAMPO.get(campo) ?? 'Regra operacional',
        resumoDelta: deltaVisivel(principal),
        comparacao: comparacaoConcreta(principal),
        fontesTexto,
        partesImpactadas: partes,
        totalPares: lista.length,
      });
    }
    return saida;
  }, [divergencias, tarefas]);

  const isolamentoEfetivo =
    campoIsolado && nosDivergencia.some((n) => n.campo === campoIsolado) ? campoIsolado : null;

  const nosSetor = useMemo<NoSetor[]>(() => {
    const lista: NoSetor[] = [];
    for (const parte of PARTES) {
      const tarefasParte = tarefasDaParte(tarefas, parte);
      const agrupadas = agruparTarefas(tarefasParte);
      const camposSet = new Set<CampoVigiado>();
      for (const t of tarefasParte) camposSet.add(t.divergencia.campo);
      const camposOrigem = CAMPOS_VIGIADOS.filter((c) => camposSet.has(c));

      lista.push({
        parte,
        totalAcoes: agrupadas.length,
        primeiraAcao: agrupadas[0]?.titulo ?? null,
        camposOrigem,
      });
    }
    return lista;
  }, [tarefas]);

  const setoresAtivos = useMemo(
    () => nosSetor.filter((s) => s.totalAcoes > 0),
    [nosSetor],
  );
  const setoresInativos = useMemo(
    () => nosSetor.filter((s) => s.totalAcoes === 0),
    [nosSetor],
  );

  const parteIsoladaEfetiva =
    parteIsolada && setoresAtivos.some((s) => s.parte === parteIsolada) ? parteIsolada : null;

  const camposFocoSet = useMemo(() => new Set<CampoVigiado>(camposFoco ?? []), [camposFoco]);
  const partesFocoSet = useMemo(() => new Set<Parte>(partesFoco ?? []), [partesFoco]);

  // Prioridade de foco: hover imediato > foco de teclado > seleção local no
  // grafo > foco externo (matriz/KPI).
  const focoCampoAtivo: CampoVigiado | null =
    hoverCampo ?? focoCampo ?? isolamentoEfetivo ?? (camposFocoSet.size === 1 ? [...camposFocoSet][0] ?? null : null);
  const focoParteAtiva: Parte | null =
    hoverParte ?? focoParte ?? parteIsoladaEfetiva ?? (partesFocoSet.size === 1 ? [...partesFocoSet][0] ?? null : null);

  const arestas = useMemo<ArestaCausal[]>(() => {
    const saida: ArestaCausal[] = [];
    for (const no of nosDivergencia) {
      for (const setor of setoresAtivos) {
        if (no.partesImpactadas.has(setor.parte)) {
          saida.push({
            chave: `${no.campo}::${setor.parte}`,
            campo: no.campo,
            parte: setor.parte,
            regra: no.regraCausal,
          });
        }
      }
    }
    return saida;
  }, [nosDivergencia, setoresAtivos]);

  const assinaturaNos = `${nosDivergencia.map((n) => n.campo).join(',')}|${setoresAtivos.map((s) => s.parte).join(',')}`;

  // Mede o centro real de cada cartão para que as curvas SVG encostem nas bordas mesmo em zoom 200%.
  useLayoutEffect(() => {
    const centro = centroRef.current;
    if (!centro) return;

    const medir = () => {
      const rCentro = centro.getBoundingClientRect();
      if (rCentro.width <= 0 || rCentro.height <= 0) return;

      const esquerdaY: Record<string, number> = {};
      for (const no of nosDivergencia) {
        const btn = esqRefs.current.get(no.campo);
        if (!btn) continue;
        const r = btn.getBoundingClientRect();
        esquerdaY[no.campo] = r.top + r.height / 2 - rCentro.top;
      }

      const direitaY: Record<string, number> = {};
      for (const setor of setoresAtivos) {
        const btn = dirRefs.current.get(setor.parte);
        if (!btn) continue;
        const r = btn.getBoundingClientRect();
        direitaY[setor.parte] = r.top + r.height / 2 - rCentro.top;
      }

      setGeom({
        largura: Math.round(rCentro.width),
        altura: Math.round(rCentro.height),
        esquerdaY,
        direitaY,
      });
    };

    medir();

    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(centro);
    for (const btn of esqRefs.current.values()) ro.observe(btn);
    for (const btn of dirRefs.current.values()) ro.observe(btn);
    return () => ro.disconnect();
  }, [assinaturaNos, nosDivergencia, setoresAtivos]);

  function alternarDivergencia(no: NoDivergencia) {
    const proximo = isolamentoEfetivo === no.campo ? null : no.campo;
    setCampoIsolado(proximo);
    setParteIsolada(null);
    if (proximo) {
      aoFocar?.({
        tipo: 'divergencia',
        campo: no.principal.campo,
        fonteA: no.principal.fonteA,
        fonteB: no.principal.fonteB,
      });
    } else {
      aoFocar?.(null);
    }
  }

  function clicarSetor(parte: Parte) {
    const proxima = parteIsoladaEfetiva === parte ? null : parte;
    setParteIsolada(proxima);
    setCampoIsolado(null);
    if (proxima) {
      aoFocar?.({ tipo: 'parte', parte: proxima });
      aoSelecionarPapel?.(proxima);
    } else {
      aoFocar?.(null);
    }
  }

  function limparIsolamento() {
    setCampoIsolado(null);
    setParteIsolada(null);
    setHoverCampo(null);
    setHoverParte(null);
    setFocoCampo(null);
    setFocoParte(null);
    aoFocar?.(null);
  }

  const ehSimulacao = modo === 'simulacao';
  const tracejado = ehSimulacao ? '6 4' : undefined;
  const temIsolamento = isolamentoEfetivo !== null || parteIsoladaEfetiva !== null;

  if (nosDivergencia.length === 0) {
    return (
      <section
        ref={wrapRef}
        className="domino-wrap domino-acordo slab-mineral"
        role="group"
        aria-label="Mapa de impacto causal"
      >
        <div className="domino-acordo-linha">
          <span className="domino-acordo-icone" aria-hidden="true">
            <IconeConfere />
          </span>
          <div className="domino-acordo-texto">
            <strong>Fontes em acordo · Cadeia sem desvios</strong>
            <span className="meta">
              Todos os campos vigiados coincidem entre os documentos declarados; nenhuma ação corretiva foi disparada entre os setores.
            </span>
          </div>
        </div>
      </section>
    );
  }

  const temFiltroAtivo =
    focoCampoAtivo !== null ||
    focoParteAtiva !== null ||
    camposFocoSet.size > 0 ||
    partesFocoSet.size > 0;

  // THE-15: a aresta só existe visualmente quando o nó de origem (a divergência)
  // foi ativado por hover, clique/isolamento ou foco de teclado; foco externo
  // (camposFoco) conta como ativação do mesmo nó. Estado por nó, não global.
  const camposRevelados = new Set<CampoVigiado>(camposFocoSet);
  if (hoverCampo) camposRevelados.add(hoverCampo);
  if (focoCampo) camposRevelados.add(focoCampo);
  if (isolamentoEfetivo) camposRevelados.add(isolamentoEfetivo);

  const arestaClasse = (a: ArestaCausal): 'oculta' | 'ativa' | 'enfase' => {
    if (!camposRevelados.has(a.campo)) return 'oculta';
    if (hoverCampo === a.campo || focoCampo === a.campo || isolamentoEfetivo === a.campo) {
      return 'enfase';
    }
    return 'ativa';
  };

  // Regras visíveis na coluna central: mostra apenas as regras ativas quando há foco
  // ou lista interativa ordenada sem sobreposição quando todas as ligações estão abertas.
  const regrasVisiveis = nosDivergencia.filter((no) => {
    if (focoCampoAtivo !== null) return no.campo === focoCampoAtivo;
    if (focoParteAtiva !== null) return no.partesImpactadas.has(focoParteAtiva);
    return true;
  });

  // Calcula posição vertical ancorada apenas quando há hover ou isolamento ativo de 1 regra.
  const regraAncoradaY: number | null = (() => {
    if (!temFiltroAtivo || regrasVisiveis.length !== 1) return null;
    const unica = regrasVisiveis[0];
    if (!unica) return null;
    const ativas = arestas.filter((a) => a.campo === unica.campo);
    if (ativas.length === 0) return null;
    const yEsq = geom.esquerdaY[unica.campo] ?? geom.altura / 2;
    const mediaDir =
      ativas.reduce((acc, a) => acc + (geom.direitaY[a.parte] ?? geom.altura / 2), 0) /
      ativas.length;
    const medio = (yEsq + mediaDir) / 2;
    return Math.max(24, Math.min(Math.max(24, geom.altura - 24), medio));
  })();

  const totalAcoes = setoresAtivos.reduce((acc, s) => acc + s.totalAcoes, 0);

  return (
    <section
      ref={wrapRef}
      className="domino-wrap"
      role="group"
      aria-label="Mapa causal de divergências para ações por setor"
      data-visivel={visivel ? 'true' : 'false'}
      data-revelado={revelado ? 'true' : 'false'}
    >
      {(titulo || ehSimulacao || temIsolamento) && (
        <div className="domino-cab">
          <div className="palco-cab-linha">
            {titulo && <h3 className="domino-titulo">{titulo}</h3>}
            {ehSimulacao && (
              <span className="pilula-warn">
                <IconeDiverge />
                Simulação · nenhum dado gravado
              </span>
            )}
            {isolamentoEfetivo && (
              <span className="pilula-coord">
                Isolado: {rotuloCampo(isolamentoEfetivo)}
              </span>
            )}
            {parteIsoladaEfetiva && (
              <span className="pilula-coord">
                Setor: {rotuloParte(parteIsoladaEfetiva)}
              </span>
            )}
          </div>
          {temIsolamento && (
            <button type="button" className="botao-sutil" onClick={limparIsolamento}>
              Limpar isolamento
            </button>
          )}
        </div>
      )}

      <div className="domino-col-titulos" aria-hidden="true">
        <span>Divergências ({nosDivergencia.length})</span>
        <span className="domino-col-titulo-centro">Fluxo causal</span>
        <span>
          Setores ({setoresAtivos.length} · {totalAcoes}{' '}
          {totalAcoes === 1 ? 'ação' : 'ações'})
        </span>
      </div>

      <div className="domino-palco">
        <div className="domino-col" role="group" aria-label="O que divergiu">
          {nosDivergencia.map((no, noIdx) => {
            const pressionado = isolamentoEfetivo === no.campo;
            const destacado =
              focoCampoAtivo === no.campo ||
              (focoParteAtiva !== null && no.partesImpactadas.has(focoParteAtiva));
            const esmaecido =
              temFiltroAtivo &&
              !destacado &&
              !(focoCampoAtivo === null && focoParteAtiva === null && camposFocoSet.has(no.campo));

            const textoAria = `${no.rotuloCurto}${no.resumoDelta ? ` (${no.resumoDelta})` : ''}: ${no.comparacao}, ${no.fontesTexto}, regra ${no.regraCausal}, aciona ${no.partesImpactadas.size} ${no.partesImpactadas.size === 1 ? 'setor' : 'setores'}`;

            return (
              <button
                key={no.campo}
                ref={(el) => {
                  if (el) esqRefs.current.set(no.campo, el);
                  else esqRefs.current.delete(no.campo);
                }}
                type="button"
                className="domino-no domino-card-div slab-mineral"
                style={{ '--no-i': Math.min(noIdx, 6) } as CSSProperties}
                aria-pressed={pressionado}
                aria-label={textoAria}
                data-ativo={destacado ? 'true' : undefined}
                data-esmaecido={esmaecido ? 'true' : undefined}
                onMouseEnter={() => setHoverCampo(no.campo)}
                onMouseLeave={() => setHoverCampo((atual) => (atual === no.campo ? null : atual))}
                onFocus={() => setFocoCampo(no.campo)}
                onBlur={() => setFocoCampo((atual) => (atual === no.campo ? null : atual))}
                onClick={() => alternarDivergencia(no)}
              >
                <span className="domino-no-topo">
                  <strong className="domino-card-titulo">{no.rotuloCurto}</strong>
                  {no.resumoDelta && (
                    <span className="domino-delta-pilula mono num">{no.resumoDelta}</span>
                  )}
                </span>
                <span className="domino-comparacao mono num">{no.comparacao}</span>
                <span className="domino-card-rodape">
                  <span className="domino-fonte-badge">{no.fontesTexto}</span>
                  <span className="domino-regra-inline">{no.regraCausal}</span>
                </span>
              </button>
            );
          })}
        </div>

        <div className="domino-centro" ref={centroRef}>
          <svg
            className="domino-svg"
            viewBox={`0 0 ${Math.max(1, geom.largura)} ${Math.max(1, geom.altura)}`}
            aria-hidden="true"
            focusable="false"
          >
            <defs>
              <marker
                id={markerAtivoId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="6.5"
                markerHeight="6.5"
                orient="auto"
              >
                <path d="M 0 0.75 L 7.5 4 L 0 7.25 z" fill="var(--change)" />
              </marker>
              <marker
                id={markerDimId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="5.5"
                markerHeight="5.5"
                orient="auto"
              >
                <path d="M 0 1 L 7 4 L 0 7 z" fill="var(--border-strong)" />
              </marker>
            </defs>

            {arestas.map((a, idx) => {
              const iEsq = nosDivergencia.findIndex((n) => n.campo === a.campo);
              const iDir = setoresAtivos.findIndex((s) => s.parte === a.parte);
              const y1 =
                geom.esquerdaY[a.campo] ??
                ((iEsq + 0.5) / Math.max(1, nosDivergencia.length)) * geom.altura;
              const y2 =
                geom.direitaY[a.parte] ??
                ((iDir + 0.5) / Math.max(1, setoresAtivos.length)) * geom.altura;
              const xFim = Math.max(8, geom.largura - 5);
              const c1x = geom.largura * 0.42;
              const c2x = geom.largura * 0.58;
              const d = `M 3 ${y1} C ${c1x} ${y1}, ${c2x} ${y2}, ${xFim} ${y2}`;
              const classeVis = arestaClasse(a);
              const visivelAresta = classeVis !== 'oculta';
              const enfase = classeVis === 'enfase';
              const classeAresta = [
                'domino-aresta',
                ehSimulacao ? 'domino-aresta-sim' : 'domino-aresta-solida',
                enfase
                  ? 'domino-aresta-enfase'
                  : visivelAresta
                    ? 'domino-aresta-ativa'
                    : 'domino-aresta-oculta',
              ].join(' ');

              return (
                <g key={a.chave}>
                  <path
                    d={d}
                    pathLength={ehSimulacao ? undefined : 1}
                    className={classeAresta}
                    style={{ '--edge-i': Math.min(idx, 10) } as CSSProperties}
                    fill="none"
                    stroke={visivelAresta ? 'var(--change)' : 'var(--border-strong)'}
                    strokeWidth={enfase ? 2.4 : 1.75}
                    strokeLinecap="round"
                    strokeDasharray={tracejado}
                    markerEnd={`url(#${visivelAresta ? markerAtivoId : markerDimId})`}
                  />
                  {enfase && !ehSimulacao && (
                    <path
                      d={d}
                      pathLength={1}
                      className="domino-fluxo-pulso"
                      style={{ '--edge-i': Math.min(idx, 10) } as CSSProperties}
                      fill="none"
                      strokeLinecap="round"
                    />
                  )}
                </g>
              );
            })}

            {nosDivergencia.map((no, i) => {
              const y =
                geom.esquerdaY[no.campo] ??
                ((i + 0.5) / Math.max(1, nosDivergencia.length)) * geom.altura;
              const ativo = camposRevelados.has(no.campo);
              return (
                <circle
                  key={`ponto-${no.campo}`}
                  cx={3}
                  cy={y}
                  r={ativo ? 3.5 : 2.5}
                  fill={ativo ? 'var(--change)' : 'var(--border-strong)'}
                  opacity={ativo ? 0.95 : 0.3}
                />
              );
            })}
          </svg>

          {regraAncoradaY !== null && regrasVisiveis[0] && (
            <div
              className="domino-regra-ancorada"
              style={{ '--ry': `${regraAncoradaY}px` } as CSSProperties}
            >
              <span className="domino-regra-pill domino-regra-pill-ativa">
                {regrasVisiveis[0].regraCausal}
              </span>
            </div>
          )}
        </div>

        <div className="domino-fluxo-mobile" aria-hidden="true">
          <span className="domino-fluxo-seta">↓</span>
          <span className="domino-fluxo-regras">
            {regrasVisiveis.map((r) => r.regraCausal).join(' · ')}
          </span>
        </div>

        <div className="domino-col" role="group" aria-label="Quem precisa agir">
          {setoresAtivos.map((setor, setorIdx) => {
            const pressionado = parteIsoladaEfetiva === setor.parte;
            const destacado =
              focoParteAtiva === setor.parte ||
              (focoCampoAtivo !== null && setor.camposOrigem.includes(focoCampoAtivo));
            const esmaecido =
              temFiltroAtivo &&
              !destacado &&
              !(focoCampoAtivo === null && focoParteAtiva === null && partesFocoSet.has(setor.parte));

            return (
              <button
                key={setor.parte}
                ref={(el) => {
                  if (el) dirRefs.current.set(setor.parte, el);
                  else dirRefs.current.delete(setor.parte);
                }}
                type="button"
                className="domino-no domino-card-setor slab-mineral"
                style={{ '--no-i': Math.min(setorIdx, 6) } as CSSProperties}
                aria-pressed={pressionado}
                aria-label={`${rotuloParte(setor.parte)}: ${setor.totalAcoes} ${setor.totalAcoes === 1 ? 'ação' : 'ações'}${setor.primeiraAcao ? `. Prioridade: ${setor.primeiraAcao}` : ''}`}
                data-ativo={destacado ? 'true' : undefined}
                data-esmaecido={esmaecido ? 'true' : undefined}
                onMouseEnter={() => setHoverParte(setor.parte)}
                onMouseLeave={() =>
                  setHoverParte((atual) => (atual === setor.parte ? null : atual))
                }
                onFocus={() => setFocoParte(setor.parte)}
                onBlur={() => setFocoParte((atual) => (atual === setor.parte ? null : atual))}
                onClick={() => clicarSetor(setor.parte)}
              >
                <span className="domino-no-topo">
                  <strong className="domino-card-titulo">{rotuloParte(setor.parte)}</strong>
                  <span className="domino-cont-acoes mono num">
                    {setor.totalAcoes} {setor.totalAcoes === 1 ? 'ação' : 'ações'}
                  </span>
                </span>
                {setor.primeiraAcao && (
                  <span className="domino-acao-preview">{setor.primeiraAcao}</span>
                )}
                {setor.camposOrigem.length > 0 && (
                  <span className="domino-tags-origem">
                    {setor.camposOrigem.map((c) => TAG_CURTA_CAMPO.get(c) ?? rotuloCampo(c)).join(' · ')}
                  </span>
                )}
              </button>
            );
          })}

          {setoresInativos.length > 0 && (
            <p className="domino-inativos meta">
              Sem ação: {setoresInativos.map((s) => rotuloParte(s.parte)).join(', ')}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
