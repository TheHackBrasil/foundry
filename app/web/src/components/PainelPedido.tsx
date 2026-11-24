import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from 'react';
import {
  PARTES,
  type AlvoFocoGenUI,
  type CampoVigiado,
  type CamposObservados,
  type Contato,
  type FonteDocumento,
  type Parte,
  type ProjecaoPedido,
  type RespostaAuditoria,
  type ViewSpecV2,
} from '../../../shared/model.ts';
import { aplicarHipoteseComoPlanilha, obterViewSpecV2 } from '../apiOps.ts';
import { copiarTexto } from '../copiar.ts';
import {
  chaveAgrupada,
  chaveCurta,
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloParte,
  variacao,
} from '../format.ts';
import { cacheLenteV2, chaveCacheLente } from '../lenteCache.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  aplicarViewSpec,
  montarMatriz,
  tarefasDaParte,
  type FiltroParte,
  type LinhaMatriz,
  type Matriz,
  type ResultadoLente,
} from '../matriz.ts';
import { SeloMonolitosShader } from '../shaders/index.ts';
import type { Carga } from '../useTorre.ts';
import { BarraMandatos } from './BarraMandatos.tsx';
import {
  IconeAssistente,
  IconeConfere,
  IconeCopiar,
  IconeDiverge,
  IconeExterno,
} from './icones.tsx';
import { MatrizFontes, type TrilhoFonte } from './MatrizFontes.tsx';
import { PalcoGenUI } from './PalcoGenUI.tsx';
import { SinaisEAvisos, chaveNotificacao, chaveSinal } from './SinaisEAvisos.tsx';
import { StatusCadeia } from './StatusCadeia.tsx';
import { TarefasPorParte } from './TarefasPorParte.tsx';

interface Props {
  id: string;
  daSessao: boolean;
  projecao: Carga<ProjecaoPedido>;
  auditoria: Carga<RespostaAuditoria>;
  contatos: readonly Contato[];
  novas: ReadonlySet<string>;
  pulsoEventoSeq: number;
  focoInicial?: AlvoFocoGenUI | null;
  aoConsumirFocoInicial?: () => void;
  aoVerificar: () => void;
  aoAbrirAuditoria: () => void;
  aoAncorar: () => Promise<void>;
  aoAbrirAgenda: (parte?: Parte) => void;
  aoAbrirAssistente: (comando?: string) => void;
  aoGarantirSessao: (pedidoId?: string | null) => Promise<string | null>;
  aoNotificar: (parte: Parte, campo?: CampoVigiado) => Promise<void>;
  aoRecarregarPedido: () => Promise<void>;
  aoAnunciar: (texto: string) => void;
  aoSelecionar: (pedidoId: string) => void;
}

const ORDEM_ABAS: readonly FiltroParte[] = [FILTRO_TODAS, ...PARTES];
const NOVO_REGISTRO_MS = 8000;

function formatarManifestoItens(dados: ProjecaoPedido): string | null {
  const itens = dados.pedido?.itens ?? [];
  const primeiro = itens[0];
  if (!primeiro) return null;
  const qtd = Number.isFinite(primeiro.quantidade)
    ? primeiro.quantidade.toLocaleString('pt-BR')
    : String(primeiro.quantidade);
  const unidade = primeiro.unidade.trim() || 'un';
  const base = `${qtd} ${unidade} · ${primeiro.descricao}`;
  return itens.length > 1 ? `${base} (+${itens.length - 1})` : base;
}

function extrairDeltaCampo(linhas: readonly LinhaMatriz[], campo: CampoVigiado): string | null {
  const linha = linhas.find((l) => l.campo === campo && l.divergente);
  if (!linha || !linha.referencia) return null;
  for (const cel of linha.celulas) {
    if (!cel.emConflito || cel.referencia || cel.valor === undefined) continue;
    const d = variacao(campo, cel.valor, linha.referencia.valor);
    if (d) return campo === 'volumes' ? `${d} vol` : d;
  }
  return null;
}

function resumoCurtoSpec(spec: ViewSpecV2): string {
  const blocoResumo = spec.blocos.find((b) => b.tipo === 'resumo_citado');
  if (blocoResumo && blocoResumo.tipo === 'resumo_citado') {
    const limpo = blocoResumo.corpo
      .replace(/\(\s*(?:\[\[[^\]]+\]\]\s*(?:e|,|;)?\s*)+\)/g, '')
      .replace(/\[\[[^\]]+\]\]/g, '')
      .replace(/\s+([.,;:])/g, '$1')
      .replace(/\s+/g, ' ')
      .trim();
    if (limpo) return limpo.length > 140 ? `${limpo.slice(0, 139).trimEnd()}…` : limpo;
  }
  return spec.justificativa;
}

function Resumo({ linhas }: { linhas: readonly LinhaMatriz[] }) {
  const divergentes = linhas.filter((l) => l.divergente);
  if (divergentes.length === 0) {
    return (
      <p className="resumo-mx sem-diverge">
        <IconeConfere />
        <span>Nenhum campo diverge entre as fontes declaradas.</span>
      </p>
    );
  }
  return (
    <p className="resumo-mx">
      <IconeDiverge />
      <span>
        <strong>
          {divergentes.length} {divergentes.length === 1 ? 'campo diverge' : 'campos divergem'}.
        </strong>{' '}
        {divergentes.map((l) => {
          const ref = l.referencia;
          const outras = l.celulas.filter((c) => c.emConflito && !c.referencia);
          return (
            <span key={l.campo}>
              {rotuloCampo(l.campo)}:{' '}
              {outras.length === 0 ? (
                <span>diverge em fonte recolhida</span>
              ) : (
                outras.map((c, i) => {
                  const delta = variacao(l.campo, c.valor, ref?.valor);
                  return (
                    <span key={c.fonte}>
                      {i > 0 && '; '}
                      {rotuloFonte(c.fonte)} indica {formatarValor(l.campo, c.valor)}
                      {ref && ` e ${rotuloFonte(ref.fonte)}, ${formatarValor(l.campo, ref.valor)}`}
                      {delta && ` (${delta})`}
                    </span>
                  );
                })
              )}
              .{' '}
            </span>
          );
        })}
      </span>
    </p>
  );
}

function Versoes({ versoes }: { versoes: ProjecaoPedido['versoes'] }) {
  if (versoes.length === 0) return null;
  const recentes = [...versoes].sort(
    (a, b) => b.geradaEm.localeCompare(a.geradaEm) || b.versao - a.versao,
  );
  return (
    <section aria-labelledby="bloco-versoes">
      <details className="versoes-detalhes">
        <summary className="versoes-sumario">
          <span id="bloco-versoes" className="versoes-sumario-titulo">
            Histórico de versões recebidas
          </span>
          <span className="meta num">
            {versoes.length} {versoes.length === 1 ? 'documento' : 'documentos'} · só acréscimo
          </span>
        </summary>
        <ul className="versoes">
          {recentes.map((v) => (
            <li key={`${v.fonte}-${v.versao}`}>
              <span className="versao-ponto" aria-hidden="true" />
              <time dateTime={v.geradaEm}>{formatarMomento(v.geradaEm)}</time>
              <span>
                <strong>{rotuloFonte(v.fonte)}</strong> v{v.versao}{' '}
                {v.versao === 1 ? 'registrada' : 'recebida'}
              </span>
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}

function Conteudo({
  id,
  daSessao,
  dados,
  auditoria,
  contatos,
  novas,
  pulsoEventoSeq,
  focoInicial,
  aoConsumirFocoInicial,
  aoVerificar,
  aoAbrirAuditoria,
  aoAncorar,
  aoAbrirAgenda,
  aoAbrirAssistente,
  aoGarantirSessao,
  aoNotificar,
  aoRecarregarPedido,
  aoAnunciar,
  aoSelecionar,
}: Omit<Props, 'projecao'> & { dados: ProjecaoPedido }) {
  const visaoId = useId();
  const matriz = useMemo(
    () => montarMatriz(dados.versoes, dados.divergencias),
    [dados.versoes, dados.divergencias],
  );

  const [filtro, setFiltro] = useState<FiltroParte>(FILTRO_TODAS);
  const [specV2Ativo, setSpecV2Ativo] = useState<ViewSpecV2 | null>(null);
  const [palcoPapelAberto, setPalcoPapelAberto] = useState(false);
  const [carregandoLente, setCarregandoLente] = useState(false);
  const [erroLente, setErroLente] = useState(false);
  const [direcaoLente, setDirecaoLente] = useState<-1 | 0 | 1>(0);
  const [fontesExpandidas, setFontesExpandidas] = useState<ReadonlySet<FonteDocumento>>(new Set());
  const [focoAtivo, setFocoAtivo] = useState<AlvoFocoGenUI | null>(focoInicial ?? null);
  const [modoSimulacao, setModoSimulacao] = useState(false);
  const [pulsoDomino, setPulsoDomino] = useState(0);
  const [origemDomino, setOrigemDomino] = useState<readonly [number, number]>([0.5, 0.5]);
  const [pulsoRefracao, setPulsoRefracao] = useState(0);
  const [chaveCopiada, setChaveCopiada] = useState(false);
  const [trilho, setTrilho] = useState<{ x: number; w: number; pronto: boolean }>({
    x: 0,
    w: 0,
    pronto: false,
  });
  const [fadeEsq, setFadeEsq] = useState(false);
  const [fadeDir, setFadeDir] = useState(false);

  const abasListaRef = useRef<HTMLDivElement>(null);
  const lenteSeq = useRef(0);
  const lenteAbort = useRef<AbortController | null>(null);
  const ultimoTotalRef = useRef(dados.totalEventos);
  const ultimoPulsoEventoRef = useRef(pulsoEventoSeq);
  const copiaTimerRef = useRef<number | null>(null);
  const matrizCabRef = useRef<HTMLHeadingElement>(null);
  const montouLenteRef = useRef(false);
  const ultimaLenteAnunciadaRef = useRef<string | null>(null);

  useEffect(() => {
    if (!focoInicial) return;
    setFocoAtivo(focoInicial);
    setOrigemDomino([0.5, 0.5]);
    setPulsoDomino((n) => n + 1);
    aoConsumirFocoInicial?.();
  }, [focoInicial, aoConsumirFocoInicial]);

  useEffect(() => {
    if (pulsoEventoSeq > ultimoPulsoEventoRef.current) {
      ultimoPulsoEventoRef.current = pulsoEventoSeq;
      setOrigemDomino([0.5, 0.5]);
      setPulsoDomino((n) => n + 1);
    }
  }, [pulsoEventoSeq]);

  const totalTarefasAgrupadas = useMemo(
    () => agruparTarefas(dados.tarefas).length,
    [dados.tarefas],
  );

  const abas = useMemo<ReadonlyArray<{ valor: FiltroParte; rotulo: string; n: number }>>(
    () => [
      { valor: FILTRO_TODAS, rotulo: 'Visão completa', n: totalTarefasAgrupadas },
      ...PARTES.map((p) => ({
        valor: p as FiltroParte,
        rotulo: rotuloParte(p),
        n: agruparTarefas(tarefasDaParte(dados.tarefas, p)).length,
      })),
    ],
    [dados.tarefas, totalTarefasAgrupadas],
  );
  const assinaturaContagens = abas.map((a) => a.n).join(',');
  const tarefasVisiveis = useMemo(
    () =>
      filtro === FILTRO_TODAS
        ? totalTarefasAgrupadas
        : agruparTarefas(tarefasDaParte(dados.tarefas, filtro)).length,
    [dados.tarefas, filtro, totalTarefasAgrupadas],
  );

  const sinaisConhecidos = useRef<ReadonlySet<string>>(new Set(dados.sinais.map(chaveSinal)));
  const avisosConhecidos = useRef<ReadonlySet<string>>(
    new Set(dados.notificacoes.map(chaveNotificacao)),
  );
  const [sinaisNovos, setSinaisNovos] = useState<ReadonlySet<string>>(new Set());
  const [avisosNovos, setAvisosNovos] = useState<ReadonlySet<string>>(new Set());
  const limpaRegistrosRef = useRef<number | null>(null);

  useEffect(() => {
    const atuaisSinais = new Set(dados.sinais.map(chaveSinal));
    const atuaisAvisos = new Set(dados.notificacoes.map(chaveNotificacao));
    const surgSinais = [...atuaisSinais].filter((k) => !sinaisConhecidos.current.has(k));
    const surgAvisos = [...atuaisAvisos].filter((k) => !avisosConhecidos.current.has(k));
    sinaisConhecidos.current = atuaisSinais;
    avisosConhecidos.current = atuaisAvisos;

    if (surgSinais.length > 0 || surgAvisos.length > 0) {
      if (surgSinais.length > 0) setSinaisNovos(new Set(surgSinais));
      if (surgAvisos.length > 0) setAvisosNovos(new Set(surgAvisos));
      if (limpaRegistrosRef.current !== null) window.clearTimeout(limpaRegistrosRef.current);
      limpaRegistrosRef.current = window.setTimeout(() => {
        setSinaisNovos(new Set());
        setAvisosNovos(new Set());
      }, NOVO_REGISTRO_MS);
    }
  }, [dados.sinais, dados.notificacoes]);

  useEffect(
    () => () => {
      lenteAbort.current?.abort();
      if (limpaRegistrosRef.current !== null) window.clearTimeout(limpaRegistrosRef.current);
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    },
    [],
  );

  useLayoutEffect(() => {
    const container = abasListaRef.current;
    if (!container) return;
    let ativo = true;

    const atualizarFades = () => {
      if (!ativo) return;
      const esq = container.scrollLeft > 2;
      const dir = container.scrollLeft + container.clientWidth < container.scrollWidth - 2;
      setFadeEsq(esq);
      setFadeDir(dir);
    };

    const atualizar = () => {
      if (!ativo) return;
      const ativa = container.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]');
      if (ativa) {
        setTrilho({ x: ativa.offsetLeft, w: ativa.offsetWidth, pronto: true });
      }
      atualizarFades();
    };

    atualizar();

    container.addEventListener('scroll', atualizarFades, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(atualizar);
      ro.observe(container);
    }
    if (typeof document !== 'undefined' && document.fonts?.ready) {
      void document.fonts.ready.then(atualizar);
    }

    return () => {
      ativo = false;
      container.removeEventListener('scroll', atualizarFades);
      ro?.disconnect();
    };
  }, [filtro, assinaturaContagens]);

  const buscarLente = useCallback(
    async (papel: Parte, totalEventos: number) => {
      const chave = chaveCacheLente(id, papel, totalEventos);
      const emCache = cacheLenteV2.obter(chave);
      lenteAbort.current?.abort();
      const seq = ++lenteSeq.current;
      setErroLente(false);
      if (emCache) {
        setSpecV2Ativo(emCache);
        setCarregandoLente(false);
        setPulsoRefracao((n) => n + 1);
        return;
      }
      const ctrl = new AbortController();
      lenteAbort.current = ctrl;
      setCarregandoLente(true);
      try {
        const spec = await obterViewSpecV2(id, papel, ctrl.signal);
        if (seq !== lenteSeq.current) return;
        cacheLenteV2.guardar(chave, spec);
        setSpecV2Ativo(spec);
      } catch {
        if (seq === lenteSeq.current) {
          setSpecV2Ativo(null);
          setErroLente(true);
        }
      } finally {
        if (seq === lenteSeq.current) {
          setCarregandoLente(false);
        }
      }
    },
    [id],
  );

  useEffect(() => {
    if (dados.totalEventos === ultimoTotalRef.current) return;
    ultimoTotalRef.current = dados.totalEventos;
    if (filtro !== FILTRO_TODAS) {
      void buscarLente(filtro, dados.totalEventos);
    }
  }, [dados.totalEventos, filtro, buscarLente]);

  const aoFiltrar = useCallback(
    (proximo: FiltroParte, direcao: -1 | 0 | 1 = 0) => {
      setFiltro(proximo);
      setDirecaoLente(direcao);
      setFontesExpandidas(new Set());
      setPalcoPapelAberto(false);
      if (proximo === FILTRO_TODAS) {
        lenteAbort.current?.abort();
        lenteSeq.current += 1;
        setCarregandoLente(false);
        setErroLente(false);
        setSpecV2Ativo(null);
        setPulsoRefracao((n) => n + 1);
        return;
      }
      void buscarLente(proximo, dados.totalEventos);
    },
    [buscarLente, dados.totalEventos],
  );

  const trocarPerspectiva = useCallback(
    (proximo: FiltroParte) => {
      const indiceAtual = ORDEM_ABAS.indexOf(filtro);
      const indiceDestino = ORDEM_ABAS.indexOf(proximo);
      const direcao: -1 | 0 | 1 =
        indiceAtual === -1 || indiceDestino === -1 || indiceDestino === indiceAtual
          ? 0
          : indiceDestino > indiceAtual
            ? 1
            : -1;

      if (proximo !== filtro) {
        aoFiltrar(proximo, direcao);
      } else if (proximo !== FILTRO_TODAS && !specV2Ativo && !carregandoLente) {
        void buscarLente(proximo, dados.totalEventos);
      }

      const container = abasListaRef.current;
      const botao =
        indiceDestino >= 0
          ? container?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[indiceDestino]
          : undefined;
      if (container && botao) {
        const margem = 24;
        const esq = botao.offsetLeft;
        const dir = esq + botao.offsetWidth;
        let novoScroll: number | null = null;
        if (esq < container.scrollLeft + margem) {
          novoScroll = Math.max(0, esq - margem);
        } else if (dir > container.scrollLeft + container.clientWidth - margem) {
          novoScroll = dir - container.clientWidth + margem;
        }
        if (novoScroll !== null) {
          const reduzido =
            typeof window !== 'undefined' &&
            typeof window.matchMedia === 'function' &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;
          container.scrollTo({ left: novoScroll, behavior: reduzido ? 'auto' : 'smooth' });
        }
      }
    },
    [aoFiltrar, buscarLente, carregandoLente, dados.totalEventos, filtro, specV2Ativo],
  );

  function aoTeclarAba(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const proxima = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
    if (proxima === undefined) return;
    e.preventDefault();
    const destino = (proxima + abas.length) % abas.length;
    const alvo = abas[destino];
    if (!alvo) return;
    trocarPerspectiva(alvo.valor);
    abasListaRef.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [destino]?.focus({ preventScroll: true });
  }

  function voltarVisaoCompleta() {
    const primeiraAba = abasListaRef.current?.querySelector<HTMLButtonElement>('[role="tab"]');
    (primeiraAba ?? matrizCabRef.current)?.focus({ preventScroll: true });
    trocarPerspectiva(FILTRO_TODAS);
    aoAnunciar('Exibindo visão completa do pedido.');
  }

  const resultadoLenteBase = useMemo<ResultadoLente>(() => {
    if (specV2Ativo && filtro !== FILTRO_TODAS) {
      return aplicarViewSpec(matriz, specV2Ativo);
    }
    return {
      matriz,
      ajustada: false,
      fontesOcultas: [],
      camposOcultos: [],
      destacarDivergencias: true,
      lente: filtro === FILTRO_TODAS ? 'fornecedor' : filtro,
    };
  }, [matriz, specV2Ativo, filtro]);

  const resultadoLente = useMemo<ResultadoLente>(() => {
    if (specV2Ativo && filtro !== FILTRO_TODAS) {
      return aplicarViewSpec(matriz, specV2Ativo, fontesExpandidas);
    }
    return resultadoLenteBase;
  }, [matriz, specV2Ativo, filtro, fontesExpandidas, resultadoLenteBase]);

  // Trilhos dobráveis: fontes sem dados (ex. CC-e textual) e fontes ocultas pela lente
  // ficam recolhidas em chips clicáveis para preservar o split 60/40 acima da dobra.
  const { matrizExibida, trilhosDobraveis } = useMemo<{
    matrizExibida: Matriz;
    trilhosDobraveis: TrilhoFonte[];
  }>(() => {
    const base = resultadoLente.matriz;
    const vaziasSet = new Set<FonteDocumento>(matriz.fontesSemDeclaracao);
    const ocultasLenteSet = new Set<FonteDocumento>(resultadoLenteBase.fontesOcultas);
    const temFonteComDados = base.fontes.some((f) => !vaziasSet.has(f));

    const fontesVisiveis = temFonteComDados
      ? base.fontes.filter((f) => !vaziasSet.has(f) || fontesExpandidas.has(f))
      : base.fontes;
    const visiveisSet = new Set<FonteDocumento>(fontesVisiveis);

    const trilhos: TrilhoFonte[] = [];
    for (const f of matriz.fontes) {
      const ehOculta = ocultasLenteSet.has(f);
      const ehVazia = vaziasSet.has(f);
      if (ehOculta) {
        trilhos.push({
          fonte: f,
          motivo: 'oculta_lente',
          expandida: visiveisSet.has(f),
        });
      } else if (ehVazia && temFonteComDados) {
        trilhos.push({
          fonte: f,
          motivo: 'sem_dados',
          expandida: visiveisSet.has(f),
        });
      }
    }

    const matrizFinal: Matriz =
      fontesVisiveis.length === base.fontes.length
        ? base
        : {
            fontes: fontesVisiveis,
            fontesSemDeclaracao: base.fontesSemDeclaracao.filter((f) => visiveisSet.has(f)),
            linhas: base.linhas.map((l) => ({
              ...l,
              celulas: l.celulas.filter((c) => visiveisSet.has(c.fonte)),
            })),
          };

    return { matrizExibida: matrizFinal, trilhosDobraveis: trilhos };
  }, [
    fontesExpandidas,
    matriz.fontes,
    matriz.fontesSemDeclaracao,
    resultadoLente.matriz,
    resultadoLenteBase.fontesOcultas,
  ]);

  const alternarTrilhoFonte = useCallback((fonte: FonteDocumento) => {
    setFontesExpandidas((prev) => {
      const prox = new Set(prev);
      if (prox.has(fonte)) prox.delete(fonte);
      else prox.add(fonte);
      return prox;
    });
  }, []);

  const assinaturaLente = `${resultadoLente.ajustada ? resultadoLente.lente : 'completa'}|${matrizExibida.fontes.join(',')}|${matrizExibida.linhas.map((l) => l.campo).join(',')}|${resultadoLente.destacarDivergencias}`;

  useEffect(() => {
    const chaveAtual =
      filtro !== FILTRO_TODAS && specV2Ativo && specV2Ativo.lente === filtro
        ? resultadoLenteBase.ajustada
          ? `adaptada|${resultadoLenteBase.lente}|${matrizExibida.fontes.length}|${matriz.fontes.length}`
          : `avaliada|${specV2Ativo.lente}`
        : null;
    if (!montouLenteRef.current) {
      montouLenteRef.current = true;
      ultimaLenteAnunciadaRef.current = chaveAtual;
      return;
    }
    if (chaveAtual === ultimaLenteAnunciadaRef.current) return;
    ultimaLenteAnunciadaRef.current = chaveAtual;
    if (chaveAtual === null || !specV2Ativo || filtro === FILTRO_TODAS) return;
    aoAnunciar(
      `Perspectiva de ${rotuloParte(filtro)} aplicada: ${matrizExibida.fontes.length} de ${matriz.fontes.length} fontes visíveis.`,
    );
  }, [
    aoAnunciar,
    filtro,
    matriz.fontes.length,
    matrizExibida.fontes.length,
    resultadoLenteBase.ajustada,
    resultadoLenteBase.lente,
    specV2Ativo,
  ]);

  const lidarFoco = useCallback(
    (alvo: AlvoFocoGenUI | null, origem?: readonly [number, number]) => {
      setFocoAtivo(alvo);
      if (alvo) {
        setOrigemDomino(origem ?? [0.5, 0.5]);
        setPulsoDomino((n) => n + 1);
      }
    },
    [],
  );

  async function copiarChave() {
    if (!(await copiarTexto(id))) return;
    setChaveCopiada(true);
    aoAnunciar('Chave NF-e copiada.');
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    copiaTimerRef.current = window.setTimeout(() => {
      setChaveCopiada(false);
      copiaTimerRef.current = null;
    }, 1800);
  }

  async function aplicarHipotesePapel(hipotese: CamposObservados) {
    let alvo = id;
    if (!daSessao) {
      const novoId = await aoGarantirSessao(id);
      if (!novoId) {
        throw new Error('Não foi possível preparar a sessão isolada para gravar a atualização.');
      }
      alvo = novoId;
    }
    const r = await aplicarHipoteseComoPlanilha(alvo, hipotese);
    setPulsoDomino((n) => n + 1);
    if (r.pedidoId) aoSelecionar(r.pedidoId);
    await aoRecarregarPedido();
    setModoSimulacao(false);
    aoAnunciar('Atualização aplicada como planilha na sua sessão.');
  }

  const manifesto = useMemo(() => formatarManifestoItens(dados), [dados]);
  const linhasDivergentesCount = useMemo(
    () => matriz.linhas.filter((l) => l.divergente).length,
    [matriz.linhas],
  );
  const deltaPrazo = useMemo(
    () => extrairDeltaCampo(matriz.linhas, 'previsaoEntrega'),
    [matriz.linhas],
  );
  const deltaPeso = useMemo(() => extrairDeltaCampo(matriz.linhas, 'pesoTotal'), [matriz.linhas]);
  const deltaVolumes = useMemo(() => extrairDeltaCampo(matriz.linhas, 'volumes'), [matriz.linhas]);

  return (
    <>
      <header className="painel-cab">
        <div className="painel-identidade">
          <div className="painel-titulo-linha">
            <h1 id="pedido-titulo" title={id}>
              Pedido <span className="mono">{chaveCurta(id)}</span>
            </h1>
            {daSessao && <span className="pilula-sutil">Sua sessão</span>}
          </div>

          {dados.pedido && (
            <p className="partes-pedido">
              <span>{dados.pedido.emitente.nome}</span>
              <span className="meta" aria-hidden="true"> → </span>
              <span>{dados.pedido.destinatario.nome}</span>
              {manifesto && <span className="manifesto-carga"> · {manifesto}</span>}
            </p>
          )}

          <div className="chave-linha">
            <p className="chave mono">NF-e {chaveAgrupada(id)}</p>
            <button
              type="button"
              className={chaveCopiada ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'}
              onClick={() => void copiarChave()}
              aria-label={chaveCopiada ? 'Chave NF-e copiada' : 'Copiar chave NF-e'}
              title={chaveCopiada ? 'Chave NF-e copiada' : 'Copiar chave NF-e'}
            >
              <span className="icone-slot-sm" aria-hidden="true">
                <span className={`icone-troca icone-troca-rapida ${chaveCopiada ? '' : 'visivel'}`}>
                  <IconeCopiar />
                </span>
                <span className={`icone-troca icone-troca-rapida ${chaveCopiada ? 'visivel' : ''}`}>
                  <IconeConfere />
                </span>
              </span>
            </button>
          </div>
        </div>

        <StatusCadeia
          auditoria={auditoria}
          pulsoExterno={pulsoEventoSeq}
          aoVerificar={aoVerificar}
          aoAbrirAuditoria={aoAbrirAuditoria}
          aoAncorar={aoAncorar}
          aoAnunciar={aoAnunciar}
        />
      </header>

      <div className="ticker-sinais" role="region" aria-label="Sinais operacionais do pedido">
        <div className="ticker-itens">
          <span
            className={
              linhasDivergentesCount > 0
                ? 'ticker-item ticker-item-destaque num'
                : 'ticker-item ticker-item-ok num'
            }
          >
            {linhasDivergentesCount > 0
              ? `${linhasDivergentesCount} ${linhasDivergentesCount === 1 ? 'divergência' : 'divergências'}`
              : 'Sem divergências'}
          </span>

          {deltaPrazo && (
            <>
              <span className="ticker-sep" aria-hidden="true">|</span>
              <span className="ticker-item mono num">{deltaPrazo}</span>
            </>
          )}

          {deltaPeso && (
            <>
              <span className="ticker-sep" aria-hidden="true">|</span>
              <span className="ticker-item mono num">{deltaPeso}</span>
            </>
          )}

          {deltaVolumes && (
            <>
              <span className="ticker-sep" aria-hidden="true">|</span>
              <span className="ticker-item mono num">{deltaVolumes}</span>
            </>
          )}

          <span className="ticker-sep" aria-hidden="true">|</span>
          <span className="ticker-item num">
            {totalTarefasAgrupadas}{' '}
            {totalTarefasAgrupadas === 1 ? 'tarefa aberta' : 'tarefas abertas'}
          </span>
        </div>

        <button
          type="button"
          className="ticker-assistente"
          onClick={() => aoAbrirAssistente()}
        >
          <IconeAssistente />
          <span>Perguntar ao Assistente</span>
          <IconeExterno />
        </button>
      </div>

      <BarraMandatos
        pedidoId={id}
        daSessao={daSessao}
        projecao={dados}
        contatos={contatos}
        focoAtivo={focoAtivo}
        aoFocar={lidarFoco}
        aoAnunciar={aoAnunciar}
        aoSelecionar={aoSelecionar}
        aoAplicarPapel={trocarPerspectiva}
        aoNotificar={aoNotificar}
        aoAbrirAgenda={aoAbrirAgenda}
        aoAbrirAssistente={aoAbrirAssistente}
        aoGarantirSessao={aoGarantirSessao}
        aoRecarregarPedido={aoRecarregarPedido}
        aoSimulacaoAtiva={setModoSimulacao}
        aoPulsoDomino={() => {
          setOrigemDomino([0.5, 0.5]);
          setPulsoDomino((n) => n + 1);
        }}
      />

      <div className="perspectiva-faixa">
        <div
          className="abas-wrap"
          data-fade-esq={fadeEsq ? 'true' : 'false'}
          data-fade-dir={fadeDir ? 'true' : 'false'}
        >
          <div className="abas" role="tablist" aria-label="Perspectiva por papel" ref={abasListaRef}>
            {abas.map((a, i) => (
              <button
                key={a.valor}
                type="button"
                role="tab"
                id={`${visaoId}-${a.valor}`}
                className="aba"
                aria-selected={filtro === a.valor}
                aria-controls={`${visaoId}-painel`}
                tabIndex={filtro === a.valor ? 0 : -1}
                onClick={() => trocarPerspectiva(a.valor)}
                onKeyDown={(e) => aoTeclarAba(e, i)}
              >
                <span>{a.rotulo}</span>
                <span className="aba-n mono num">{a.n}</span>
              </button>
            ))}
            {trilho.pronto && (
              <span
                className="abas-indicador"
                aria-hidden="true"
                style={{ '--ix': `${trilho.x}px`, '--iw-escala': trilho.w } as CSSProperties}
              />
            )}
          </div>
        </div>

        <div className="perspectiva-status">
          {carregandoLente && (
            <span className="lente-compondo" role="status">
              <SeloMonolitosShader ativo={true} tamanho={20} />
              <span className="meta">Adaptando…</span>
            </span>
          )}
          {focoAtivo && (
            <button
              type="button"
              className="botao-sutil"
              onClick={() => {
                setFocoAtivo(null);
                aoAnunciar('Destaque removido.');
              }}
            >
              Limpar destaque
            </button>
          )}
        </div>
      </div>

      {filtro !== FILTRO_TODAS && (specV2Ativo || erroLente) && (
        <div className="lente-resumo-faixa">
          {specV2Ativo ? (
            <>
              <p className="lente-resumo-texto">
                <strong>{rotuloParte(filtro)}:</strong> {resumoCurtoSpec(specV2Ativo)}
              </p>
              <div className="lente-resumo-acoes">
                {specV2Ativo.blocos.length > 0 && (
                  <button
                    type="button"
                    className="botao-sutil"
                    aria-expanded={palcoPapelAberto}
                    onClick={() => setPalcoPapelAberto((a) => !a)}
                  >
                    {palcoPapelAberto
                      ? `Recolher análise`
                      : `Abrir análise de ${rotuloParte(filtro)}`}
                  </button>
                )}
                <button type="button" className="botao-sutil" onClick={voltarVisaoCompleta}>
                  Visão completa
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="meta">
                Adaptação de perspectiva indisponível no momento; tarefas filtradas para{' '}
                {rotuloParte(filtro)}.
              </p>
              <button type="button" className="botao-sutil" onClick={voltarVisaoCompleta}>
                Visão completa
              </button>
            </>
          )}
        </div>
      )}

      {palcoPapelAberto && specV2Ativo && (
        <PalcoGenUI
          spec={specV2Ativo}
          etapas={[]}
          blocosStream={[]}
          carregando={false}
          projecao={dados}
          pedidoId={id}
          daSessao={daSessao}
          contatos={contatos}
          focoAtivo={focoAtivo}
          aoFocar={lidarFoco}
          aoExecutarComando={(cmd) => aoAbrirAssistente(cmd)}
          aoSelecionarPapel={trocarPerspectiva}
          aoNotificar={aoNotificar}
          aoAbrirAgenda={aoAbrirAgenda}
          aoSimularResultado={(res) => setModoSimulacao(res !== null)}
          aoAplicarHipotese={aplicarHipotesePapel}
          aoFechar={() => {
            setPalcoPapelAberto(false);
            setModoSimulacao(false);
          }}
          aoAnunciar={aoAnunciar}
          slotLoader={<SeloMonolitosShader ativo={true} tamanho={24} />}
        />
      )}

      <div className="cols" data-fontes={matrizExibida.fontes.length}>
        <section aria-labelledby="bloco-matriz" className="col-matriz">
          <div className="sec-cab">
            <div className="sec-cab-grupo">
              <h2 id="bloco-matriz" ref={matrizCabRef} tabIndex={-1}>
                Fontes e campos
              </h2>
              <p className="meta">
                Referência: primeira fonte que declara o campo. Clique em divergências para destacar tarefas.
              </p>
            </div>
          </div>

          <MatrizFontes
            matriz={matrizExibida}
            trilhos={trilhosDobraveis}
            aoAlternarTrilho={alternarTrilhoFonte}
            destacar={resultadoLente.destacarDivergencias}
            carregandoLente={carregandoLente}
            assinaturaLente={assinaturaLente}
            direcaoLente={direcaoLente}
            pulsoDomino={pulsoDomino}
            origemDomino={origemDomino}
            pulsoRefracao={pulsoRefracao}
            modoSimulacao={modoSimulacao}
            focoAtivo={focoAtivo}
            aoFocar={lidarFoco}
          />
          {matrizExibida.fontes.length > 0 && <Resumo linhas={matrizExibida.linhas} />}
        </section>

        <section aria-labelledby="bloco-tarefas" className="col-tarefas">
          <div className="sec-cab">
            <div className="sec-cab-grupo">
              <h2 id="bloco-tarefas">
                {filtro === FILTRO_TODAS ? 'Tarefas abertas' : `Tarefas · ${rotuloParte(filtro)}`}
              </h2>
              <p className="meta">Ações derivadas das divergências por setor.</p>
            </div>
            <span className="pilula-sutil mono num">
              {tarefasVisiveis} {tarefasVisiveis === 1 ? 'tarefa' : 'tarefas'}
            </span>
          </div>
          <TarefasPorParte
            tarefas={dados.tarefas}
            contatos={contatos}
            filtro={filtro}
            novas={novas}
            direcao={direcaoLente}
            painelId={`${visaoId}-painel`}
            rotuloAbaId={`${visaoId}-${filtro}`}
            focoAtivo={focoAtivo}
            aoFocar={lidarFoco}
            aoNotificar={aoNotificar}
            aoAbrirAgenda={aoAbrirAgenda}
          />
        </section>
      </div>

      <SinaisEAvisos
        sinais={dados.sinais}
        notificacoes={dados.notificacoes}
        sinaisNovos={sinaisNovos}
        avisosNovos={avisosNovos}
      />

      <Versoes versoes={dados.versoes} />
    </>
  );
}

export function PainelPedido({
  id,
  daSessao,
  projecao,
  auditoria,
  contatos,
  novas,
  pulsoEventoSeq,
  focoInicial,
  aoConsumirFocoInicial,
  aoVerificar,
  aoAbrirAuditoria,
  aoAncorar,
  aoAbrirAgenda,
  aoAbrirAssistente,
  aoGarantirSessao,
  aoNotificar,
  aoRecarregarPedido,
  aoAnunciar,
  aoSelecionar,
}: Props) {
  return (
    <article aria-labelledby="pedido-titulo" className="painel-pedido">
      {projecao.estado === 'carregando' && (
        <>
          <h1 id="pedido-titulo" className="so-leitor">
            Pedido {chaveCurta(id)}
          </h1>
          <p className="dica">Carregando o pedido…</p>
        </>
      )}
      {projecao.estado === 'erro' && (
        <>
          <h1 id="pedido-titulo" className="so-leitor">
            Pedido {chaveCurta(id)}
          </h1>
          <p className="aviso-erro" role="alert">
            Não foi possível carregar o pedido: {projecao.mensagem}
          </p>
        </>
      )}
      {projecao.estado === 'ok' && (
        <Conteudo
          id={id}
          daSessao={daSessao}
          dados={projecao.dados}
          auditoria={auditoria}
          contatos={contatos}
          novas={novas}
          pulsoEventoSeq={pulsoEventoSeq}
          {...(focoInicial !== undefined ? { focoInicial } : {})}
          {...(aoConsumirFocoInicial ? { aoConsumirFocoInicial } : {})}
          aoVerificar={aoVerificar}
          aoAbrirAuditoria={aoAbrirAuditoria}
          aoAncorar={aoAncorar}
          aoAbrirAgenda={aoAbrirAgenda}
          aoAbrirAssistente={aoAbrirAssistente}
          aoGarantirSessao={aoGarantirSessao}
          aoNotificar={aoNotificar}
          aoRecarregarPedido={aoRecarregarPedido}
          aoAnunciar={aoAnunciar}
          aoSelecionar={aoSelecionar}
        />
      )}
    </article>
  );
}
