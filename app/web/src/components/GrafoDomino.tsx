import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
  resumoDelta: string | null;
  subtitulo: string;
  partesImpactadas: ReadonlySet<Parte>;
  totalPares: number;
}

interface GeometriaSvg {
  largura: number;
  altura: number;
  esquerdaY: Record<string, number>;
  direitaY: Record<string, number>;
}

const ROTULO_CURTO_CAMPO = new Map<CampoVigiado, string>([
  ['previsaoEntrega', 'Previsão'],
  ['pesoTotal', 'Peso'],
  ['volumes', 'Volumes'],
  ['status', 'Status'],
]);

function deltaCompacto(d: Divergencia): string | null {
  const v = variacao(d.campo, d.valorB, d.valorA);
  if (v) {
    return d.campo === 'previsaoEntrega' ? v.replace(/\s*dias?$/, 'd') : v;
  }
  if (d.campo === 'status') {
    return formatarValor('status', d.valorB);
  }
  return null;
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

  const [campoIsolado, setCampoIsolado] = useState<CampoVigiado | null>(null);
  const [parteAtiva, setParteAtiva] = useState<Parte | null>(null);

  const centroRef = useRef<HTMLDivElement>(null);
  const esqRefs = useRef<Map<CampoVigiado, HTMLButtonElement>>(new Map());
  const dirRefs = useRef<Map<Parte, HTMLButtonElement>>(new Map());
  const [geom, setGeom] = useState<GeometriaSvg>({
    largura: 240,
    altura: 250,
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

      const subtitulo =
        lista.length > 1
          ? `${rotuloFonte(principal.fonteA)} × ${rotuloFonte(principal.fonteB)} (+${lista.length - 1})`
          : `${rotuloFonte(principal.fonteA)} × ${rotuloFonte(principal.fonteB)}`;

      saida.push({
        campo,
        principal,
        rotuloCurto: ROTULO_CURTO_CAMPO.get(campo) ?? rotuloCampo(campo),
        resumoDelta: deltaCompacto(principal),
        subtitulo,
        partesImpactadas: partes,
        totalPares: lista.length,
      });
    }
    return saida;
  }, [divergencias, tarefas]);

  // Se o campo isolado deixou de existir apos atualizacao do pedido, limpa selecao.
  const isolamentoEfetivo =
    campoIsolado && nosDivergencia.some((n) => n.campo === campoIsolado) ? campoIsolado : null;

  const noIsolado = useMemo(
    () => nosDivergencia.find((n) => n.campo === isolamentoEfetivo) ?? null,
    [nosDivergencia, isolamentoEfetivo],
  );

  const tarefasFiltradas = useMemo(
    () =>
      isolamentoEfetivo
        ? tarefas.filter((t) => t.divergencia.campo === isolamentoEfetivo)
        : tarefas,
    [tarefas, isolamentoEfetivo],
  );

  const contagemPorParte = useMemo(() => {
    const mapa = new Map<Parte, number>();
    for (const parte of PARTES) {
      mapa.set(parte, agruparTarefas(tarefasDaParte(tarefasFiltradas, parte)).length);
    }
    return mapa;
  }, [tarefasFiltradas]);

  const totalTarefasUnicas = useMemo(
    () => agruparTarefas(tarefasFiltradas).length,
    [tarefasFiltradas],
  );

  const camposFocoSet = useMemo(() => new Set<CampoVigiado>(camposFoco ?? []), [camposFoco]);
  const partesFocoSet = useMemo(() => new Set<Parte>(partesFoco ?? []), [partesFoco]);

  const assinaturaNos = nosDivergencia.map((n) => n.campo).join(',');

  // Mede o centro real de cada botao HTML para que as curvas SVG encostem
  // exatamente nas bordas dos nos mesmo com quebra de texto ou zoom 200%.
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
      for (const parte of PARTES) {
        const btn = dirRefs.current.get(parte);
        if (!btn) continue;
        const r = btn.getBoundingClientRect();
        direitaY[parte] = r.top + r.height / 2 - rCentro.top;
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
  }, [assinaturaNos, nosDivergencia]);

  function alternarDivergencia(no: NoDivergencia) {
    const proximo = isolamentoEfetivo === no.campo ? null : no.campo;
    setCampoIsolado(proximo);
    setParteAtiva(null);
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

  function clicarPapel(parte: Parte) {
    setParteAtiva((atual) => (atual === parte ? null : parte));
    aoSelecionarPapel?.(parte);
  }

  const ehSimulacao = modo === 'simulacao';
  const cx = geom.largura / 2;
  const cy = geom.altura / 2;
  const tracejado = ehSimulacao ? '5 4' : undefined;

  return (
    <section
      className="domino-wrap"
      role="group"
      aria-label="Mapa dominó de impacto nos 5 setores"
    >
      <div className="domino-cab">
        <div className="palco-cab-linha">
          {titulo && <h3>{titulo}</h3>}
          {ehSimulacao && (
            <span className="pilula-warn">
              <IconeDiverge />
              Simulação · nenhum dado gravado
            </span>
          )}
          {noIsolado && (
            <span className="pilula-coord">
              Isolado: {rotuloCampo(noIsolado.campo)}
            </span>
          )}
        </div>
        {noIsolado && (
          <button
            type="button"
            className="botao-sutil"
            onClick={() => {
              setCampoIsolado(null);
              aoFocar?.(null);
            }}
          >
            Mostrar todas as divergências
          </button>
        )}
      </div>

      {nosDivergencia.length === 0 ? (
        <p className="dica">
          Nenhuma divergência ativa — o Motor de Regras não disparou tarefas entre os 5 setores.
        </p>
      ) : (
        <p className="meta">
          Selecione uma divergência à esquerda para isolar os setores impactados, ou escolha um
          setor à direita para filtrar as tarefas.
        </p>
      )}

      <div className="domino-palco">
        <div className="domino-col" role="group" aria-label="Divergências detectadas">
          {nosDivergencia.length === 0 ? (
            <div className="domino-no" data-esmaecido="true">
              <div className="domino-no-topo">
                <strong>Sem conflitos</strong>
                <span className="pilula-ok">
                  <IconeConfere />
                  Alinhado
                </span>
              </div>
              <span className="meta">Fontes concordam nos campos vigiados</span>
            </div>
          ) : (
            nosDivergencia.map((no) => {
              const pressionado = isolamentoEfetivo === no.campo;
              const esmaecido =
                isolamentoEfetivo !== null
                  ? !pressionado
                  : camposFocoSet.size > 0 && !camposFocoSet.has(no.campo);
              const textoAria = `${no.rotuloCurto}${no.resumoDelta ? ` ${no.resumoDelta}` : ''}, ${no.subtitulo}, impacta ${no.partesImpactadas.size} ${no.partesImpactadas.size === 1 ? 'setor' : 'setores'}`;
              return (
                <button
                  key={no.campo}
                  ref={(el) => {
                    if (el) esqRefs.current.set(no.campo, el);
                    else esqRefs.current.delete(no.campo);
                  }}
                  type="button"
                  className="domino-no"
                  aria-pressed={pressionado}
                  aria-label={textoAria}
                  data-esmaecido={esmaecido ? 'true' : undefined}
                  onClick={() => alternarDivergencia(no)}
                >
                  <span className="domino-no-topo">
                    <strong>{no.rotuloCurto}</strong>
                    {no.resumoDelta && (
                      <span className="delta-pilula num">{no.resumoDelta}</span>
                    )}
                  </span>
                  <span className="meta">{no.subtitulo}</span>
                </button>
              );
            })
          )}
        </div>

        <div className="domino-centro" ref={centroRef}>
          <svg
            className="domino-svg"
            viewBox={`0 0 ${Math.max(1, geom.largura)} ${Math.max(1, geom.altura)}`}
            aria-hidden="true"
            focusable="false"
          >
            {nosDivergencia.map((no, i) => {
              const fallbackY = ((i + 0.5) / Math.max(1, nosDivergencia.length)) * geom.altura;
              const y = geom.esquerdaY[no.campo] ?? fallbackY;
              const ativa =
                isolamentoEfetivo !== null
                  ? isolamentoEfetivo === no.campo
                  : camposFocoSet.size === 0 || camposFocoSet.has(no.campo);
              const d = `M 0 ${y} C ${geom.largura * 0.28} ${y}, ${geom.largura * 0.24} ${cy}, ${cx} ${cy}`;
              return (
                <g key={`esq-${no.campo}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={ativa ? 'var(--change)' : 'var(--hairline-strong)'}
                    strokeWidth={ativa ? 2.2 : 1.25}
                    strokeDasharray={tracejado}
                    opacity={ativa ? 0.92 : 0.28}
                  />
                  {ativa && <circle cx={2} cy={y} r={3} fill="var(--change)" />}
                </g>
              );
            })}

            {PARTES.map((parte, j) => {
              const fallbackY = ((j + 0.5) / PARTES.length) * geom.altura;
              const y = geom.direitaY[parte] ?? fallbackY;
              const n = contagemPorParte.get(parte) ?? 0;
              const impactada =
                noIsolado !== null
                  ? noIsolado.partesImpactadas.has(parte)
                  : n > 0 && (partesFocoSet.size === 0 || partesFocoSet.has(parte));
              const d = `M ${cx} ${cy} C ${geom.largura * 0.76} ${cy}, ${geom.largura * 0.72} ${y}, ${geom.largura} ${y}`;
              return (
                <g key={`dir-${parte}`}>
                  <path
                    d={d}
                    fill="none"
                    stroke={impactada ? 'var(--change)' : 'var(--hairline-strong)'}
                    strokeWidth={impactada ? 2.2 : 1.2}
                    strokeDasharray={tracejado}
                    opacity={impactada ? 0.92 : 0.24}
                  />
                  {impactada && (
                    <circle cx={Math.max(2, geom.largura - 2)} cy={y} r={3} fill="var(--change)" />
                  )}
                </g>
              );
            })}
          </svg>

          <div className="domino-motor">
            <strong style={{ fontSize: '0.84375rem' }}>Motor de Regras</strong>
            <span className="meta num">
              {nosDivergencia.length}{' '}
              {nosDivergencia.length === 1 ? 'conflito' : 'conflitos'} → {totalTarefasUnicas}{' '}
              {totalTarefasUnicas === 1 ? 'tarefa' : 'tarefas'}
            </span>
          </div>
        </div>

        <div className="domino-col" role="group" aria-label="Setores impactados">
          {PARTES.map((parte) => {
            const qtd = contagemPorParte.get(parte) ?? 0;
            const impactada =
              noIsolado !== null ? noIsolado.partesImpactadas.has(parte) : qtd > 0;
            const esmaecido =
              !impactada ||
              (noIsolado === null && partesFocoSet.size > 0 && !partesFocoSet.has(parte));
            const selecionada = parteAtiva === parte;
            return (
              <button
                key={parte}
                ref={(el) => {
                  if (el) dirRefs.current.set(parte, el);
                  else dirRefs.current.delete(parte);
                }}
                type="button"
                className="domino-no"
                aria-pressed={selecionada}
                aria-label={`${rotuloParte(parte)}: ${qtd} ${qtd === 1 ? 'tarefa' : 'tarefas'}`}
                data-esmaecido={esmaecido ? 'true' : undefined}
                onClick={() => clicarPapel(parte)}
              >
                <span className="domino-no-topo">
                  <strong>{rotuloParte(parte)}</strong>
                  <span className={qtd > 0 ? 'pilula-coord num' : 'pilula-sutil num'}>
                    {qtd}
                  </span>
                </span>
                <span className="meta">
                  {qtd === 0
                    ? 'Sem ação disparada'
                    : qtd === 1
                      ? '1 tarefa gerada'
                      : `${qtd} tarefas geradas`}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
