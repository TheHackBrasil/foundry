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
  type ReactNode,
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
  type RespostaSimulacao,
  type ViewSpecV2,
} from '../../../shared/model.ts';
import { aplicarHipoteseComoPlanilha, obterViewSpecV2 } from '../apiOps.ts';
import { copiarTexto } from '../copiar.ts';
import {
  chaveAgrupada,
  chaveCurta,
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
import '../torre-v2.css';
import { useIndicadorDeslizante } from '../useIndicadorDeslizante.ts';
import type { Carga } from '../useTorre.ts';
import {
  IconeCaixa,
  IconeCalendario,
  IconeCaminhao,
  IconeConfere,
  IconeCopiar,
  IconeFabrica,
  IconeFiscal,
  IconeGalpao,
  IconePeso,
  IconePlanilha,
  IconeRota,
} from './icones.tsx';
import type { TrilhoFonte } from './MatrizFontes.tsx';
import { PalcoGenUI } from './PalcoGenUI.tsx';
import { chaveNotificacao, chaveSinal } from './SinaisEAvisos.tsx';
import { CardCadeia } from './torre/CardCadeia.tsx';
import { CardDomino } from './torre/CardDomino.tsx';
import { CardMatriz } from './torre/CardMatriz.tsx';
import { CardSinais } from './torre/CardSinais.tsx';
import { CardSimulador } from './torre/CardSimulador.tsx';
import { CardTarefas } from './torre/CardTarefas.tsx';
import { CardVersoes } from './torre/CardVersoes.tsx';
import type { CardId } from './torre/layout.ts';
import { TorreGrid } from './torre/TorreGrid.tsx';

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
const CENTRO_DOMINO: readonly [number, number] = [0.5, 0.5];

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

interface KpiDivergencia {
  campo: CampoVigiado;
  rotulo: string;
  valor: string;
  contexto: string;
  alvo: Extract<AlvoFocoGenUI, { tipo: 'divergencia' }>;
}

function comparacaoCurtaLinha(campo: CampoVigiado, valA: unknown, valB: unknown): string {
  const a = formatarValor(campo, valA);
  const b = formatarValor(campo, valB);
  if (campo === 'previsaoEntrega') {
    const mA = /^(\d{2}\/\d{2})\/(\d{4})$/.exec(a);
    const mB = /^(\d{2}\/\d{2})\/(\d{4})$/.exec(b);
    if (mA && mB && mA[2] === mB[2]) return `${mA[1]} → ${mB[1]}`;
  }
  if (campo === 'pesoTotal') {
    const numA = a.replace(/\s*kg$/i, '');
    return `${numA} → ${b}`;
  }
  if (campo === 'volumes') {
    return `${a} → ${b} vol`;
  }
  return `${a} → ${b}`;
}

function extrairKpisDivergencia(linhas: readonly LinhaMatriz[]): KpiDivergencia[] {
  const saida: KpiDivergencia[] = [];
  for (const linha of linhas) {
    if (!linha.divergente || !linha.referencia) continue;
    const conflito = linha.celulas.find(
      (c) => c.emConflito && !c.referencia && c.valor !== undefined,
    );
    if (!conflito) continue;
    const d = variacao(linha.campo, conflito.valor, linha.referencia.valor);
    const valor = d
      ? linha.campo === 'volumes'
        ? `${d} vol`
        : d
      : formatarValor(linha.campo, conflito.valor);

    saida.push({
      campo: linha.campo,
      rotulo: rotuloCampo(linha.campo),
      valor,
      contexto: comparacaoCurtaLinha(linha.campo, linha.referencia.valor, conflito.valor),
      alvo: {
        tipo: 'divergencia',
        campo: linha.campo,
        fonteA: linha.referencia.fonte,
        fonteB: conflito.fonte,
      },
    });
  }
  return saida;
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
  // INSTRUMENTACAO TEMPORARIA (remover antes do merge)
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
  const [detalhesAbertos, setDetalhesAbertos] = useState(false);
  // Pulso do domino derivado (spec 0015, F3): o seq de eventos SSE soma na
  // chave direto do prop, sem copia em state; pulsos locais (foco, hipotese,
  // mandato) guardam n, a origem do clique e o seq de evento daquele momento
  // para decidir quem dispara por ultimo sem effect.
  const [pulsoLocal, setPulsoLocal] = useState<{
    n: number;
    origem: readonly [number, number];
    eventoSeq: number;
  }>({ n: 0, origem: CENTRO_DOMINO, eventoSeq: 0 });
  const [pulsoRefracao, setPulsoRefracao] = useState(0);
  const [chaveCopiada, setChaveCopiada] = useState(false);
  const [fadeEsq, setFadeEsq] = useState(false);
  const [fadeDir, setFadeDir] = useState(false);

  const abasListaRef = useRef<HTMLDivElement>(null);
  const lenteSeq = useRef(0);
  const lenteAbort = useRef<AbortController | null>(null);
  const ultimoTotalRef = useRef(dados.totalEventos);
  const pulsoEventoRef = useRef(pulsoEventoSeq);
  // Roving tabindex na faixa de KPIs (spec 0015, F7): um ponto de Tab para
  // a faixa inteira; setas percorrem os cartoes de divergencia e o de tarefas.
  const [posKpi, setPosKpi] = useState(0);
  const kpiRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const copiaTimerRef = useRef<number | null>(null);
  const montouLenteRef = useRef(false);
  const ultimaLenteAnunciadaRef = useRef<string | null>(null);

  const dispararPulsoDomino = useCallback((origem?: readonly [number, number]) => {
    setPulsoLocal((prev) => ({
      n: prev.n + 1,
      origem: origem ?? prev.origem,
      eventoSeq: pulsoEventoRef.current,
    }));
  }, []);

  useEffect(() => {
    if (!focoInicial) return;
    setFocoAtivo(focoInicial);
    dispararPulsoDomino(CENTRO_DOMINO);
    aoConsumirFocoInicial?.();
  }, [focoInicial, aoConsumirFocoInicial, dispararPulsoDomino]);

  // O ref acompanha o prop sem render extra: o pulso de evento entra na
  // chave derivada abaixo, nao em estado espelhado.
  useEffect(() => {
    pulsoEventoRef.current = pulsoEventoSeq;
  }, [pulsoEventoSeq]);

  // Chave e origem derivadas no render: evento pulsa do centro; se o ultimo
  // pulso foi local (seq de evento nao andou desde entao), vale a origem dele.
  const pulsoDomino = pulsoLocal.n + pulsoEventoSeq;
  const origemDomino = pulsoEventoSeq > pulsoLocal.eventoSeq ? CENTRO_DOMINO : pulsoLocal.origem;

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
  const trilhoGeo = useIndicadorDeslizante(
    abasListaRef,
    '[role="tab"][aria-selected="true"]',
    `${filtro}|${assinaturaContagens}`,
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

    atualizarFades();

    container.addEventListener('scroll', atualizarFades, { passive: true });
    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(atualizarFades);
      ro.observe(container);
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
    const tituloMatriz = document.getElementById('torre-titulo-matriz');
    (primeiraAba ?? tituloMatriz)?.focus({ preventScroll: true });
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
        dispararPulsoDomino(origem ?? CENTRO_DOMINO);
      }
    },
    [dispararPulsoDomino],
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

  const aplicarHipotesePapel = useCallback(
    async (hipotese: CamposObservados) => {
      let alvo = id;
      if (!daSessao) {
        const novoId = await aoGarantirSessao(id);
        if (!novoId) {
          throw new Error('Não foi possível preparar a sessão isolada para gravar a atualização.');
        }
        alvo = novoId;
      }
      const r = await aplicarHipoteseComoPlanilha(alvo, hipotese);
      dispararPulsoDomino();
      if (r.pedidoId) aoSelecionar(r.pedidoId);
      await aoRecarregarPedido();
      setModoSimulacao(false);
      aoAnunciar('Atualização aplicada como planilha na sua sessão.');
    },
    [id, daSessao, aoGarantirSessao, aoSelecionar, aoRecarregarPedido, aoAnunciar, dispararPulsoDomino],
  );

  const aoResultadoSimulacao = useCallback(
    (res: { hipotese: CamposObservados; resultado: RespostaSimulacao } | null) => {
      setModoSimulacao(res !== null);
    },
    [],
  );

  const manifesto = useMemo(() => formatarManifestoItens(dados), [dados]);
  const kpisDivergencia = useMemo(
    () => extrairKpisDivergencia(matriz.linhas),
    [matriz.linhas],
  );
  const setoresAfetadosCount = useMemo(
    () => PARTES.filter((p) => tarefasDaParte(dados.tarefas, p).length > 0).length,
    [dados.tarefas],
  );
  const camposFocoDomino = useMemo<CampoVigiado[] | undefined>(() => {
    if (!focoAtivo) return undefined;
    if (focoAtivo.tipo === 'divergencia' || focoAtivo.tipo === 'celula') {
      return [focoAtivo.campo];
    }
    return undefined;
  }, [focoAtivo]);
  const partesFocoDomino = useMemo<Parte[] | undefined>(() => {
    if (focoAtivo?.tipo === 'parte') return [focoAtivo.parte];
    if (!focoAtivo && filtro !== FILTRO_TODAS) return [filtro];
    return undefined;
  }, [focoAtivo, filtro]);

  // kpisDivergencia.length cartoes de campo + 1 cartao de tarefas no fim.
  const posEfKpi = Math.min(posKpi, kpisDivergencia.length);

  function teclarKpi(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const total = kpisDivergencia.length + 1;
    let prox = -1;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') prox = (i + 1) % total;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') prox = (i - 1 + total) % total;
    else if (e.key === 'Home') prox = 0;
    else if (e.key === 'End') prox = total - 1;
    if (prox < 0) return;
    e.preventDefault();
    setPosKpi(prox);
    kpiRefs.current[prox]?.focus();
  }

  function alternarKpiCampo(kpi: KpiDivergencia) {
    const jaAtivo =
      focoAtivo?.tipo === 'divergencia' && focoAtivo.campo === kpi.campo;
    if (jaAtivo) {
      lidarFoco(null);
      aoAnunciar('Destaque removido.');
      return;
    }
    lidarFoco(kpi.alvo, [0.5, 0.35]);
    aoAnunciar(`Destacando ${kpi.rotulo} na matriz e no mapa causal.`);
  }

  function iconeFonteCompacto(fonte: FonteDocumento) {
    if (fonte === 'cte') return <IconeCaminhao />;
    if (fonte === 'planilha') return <IconePlanilha />;
    return <IconeFiscal />;
  }

  function iconeCampoKpi(campo: CampoVigiado) {
    switch (campo) {
      case 'previsaoEntrega':
        return <IconeCalendario />;
      case 'pesoTotal':
        return <IconePeso />;
      case 'volumes':
        return <IconeCaixa />;
      case 'status':
        return <IconeRota />;
    }
  }

  function renderMicroVisualKpi(kpi: KpiDivergencia) {
    if (kpi.campo === 'previsaoEntrega') {
      return (
        <span className="kpi-vis kpi-vis-prazo" aria-hidden="true">
          <span className="kpi-vis-trilha" />
          <span className="kpi-vis-ponto-base" />
          <span className="kpi-vis-desvio-trilha" />
          <span className="kpi-vis-ponto-dv" />
        </span>
      );
    }
    if (kpi.campo === 'pesoTotal') {
      return (
        <span className="kpi-vis kpi-vis-barras" aria-hidden="true">
          <span className="kpi-vis-barra-base" style={{ width: '74%' }} />
          <span className="kpi-vis-barra-dv" style={{ width: '92%' }} />
        </span>
      );
    }
    if (kpi.campo === 'volumes') {
      return (
        <span className="kpi-vis kpi-vis-blocos" aria-hidden="true">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} className="kpi-vis-bloco-base" />
          ))}
          <span className="kpi-vis-bloco-dv" />
          <span className="kpi-vis-bloco-dv" />
        </span>
      );
    }
    return (
      <span className="kpi-vis kpi-vis-etapas" aria-hidden="true">
        <span className="kpi-vis-etapa kpi-vis-etapa-ok" />
        <span className="kpi-vis-fio kpi-vis-fio-ok" />
        <span className="kpi-vis-etapa kpi-vis-etapa-dv" />
        <span className="kpi-vis-fio" />
        <span className="kpi-vis-etapa" />
      </span>
    );
  }

  const fontesAtivasHero = useMemo(
    () =>
      matriz.fontes.filter(
        (f) => !matriz.fontesSemDeclaracao.includes(f),
      ),
    [matriz.fontes, matriz.fontesSemDeclaracao],
  );

  const fontesComConflito = useMemo(() => {
    const s = new Set<FonteDocumento>();
    for (const d of dados.divergencias) {
      s.add(d.fonteA);
      s.add(d.fonteB);
    }
    return s;
  }, [dados.divergencias]);

  const distribuicaoSetores = useMemo(
    () =>
      PARTES.map((p) => ({
        parte: p,
        qtd: agruparTarefas(tarefasDaParte(dados.tarefas, p)).length,
      })).filter((x) => x.qtd > 0),
    [dados.tarefas],
  );

  const statusAtualVisual = useMemo(() => {
    const linha = matriz.linhas.find((l) => l.campo === 'status');
    const ultima = linha?.celulas.filter((c) => c.valor !== undefined).at(-1);
    return ultima?.valor ? formatarValor('status', ultima.valor) : 'Emitida';
  }, [matriz.linhas]);

  // Cada seção vira um card do tiling (THE-18). Um useMemo por card (spec
  // 0015, F1): o elemento só é recriado quando o próprio dado muda, então um
  // pulso de evento ou troca de foco não redesenha os outros seis cards.
  const cardMatriz = useMemo<ReactNode>(
    () => (
      <CardMatriz
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
    ),
    [
      matrizExibida,
      trilhosDobraveis,
      alternarTrilhoFonte,
      resultadoLente.destacarDivergencias,
      carregandoLente,
      assinaturaLente,
      direcaoLente,
      pulsoDomino,
      origemDomino,
      pulsoRefracao,
      modoSimulacao,
      focoAtivo,
      lidarFoco,
    ],
  );

  const cardTarefas = useMemo<ReactNode>(
    () => (
      <CardTarefas
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
    ),
    [
      dados.tarefas,
      contatos,
      filtro,
      novas,
      direcaoLente,
      visaoId,
      focoAtivo,
      lidarFoco,
      aoNotificar,
      aoAbrirAgenda,
    ],
  );

  const cardDomino = useMemo<ReactNode>(
    () => (
      <CardDomino
        divergencias={dados.divergencias}
        tarefas={dados.tarefas}
        modoSimulacao={modoSimulacao}
        camposFoco={camposFocoDomino}
        partesFoco={partesFocoDomino}
        aoFocar={lidarFoco}
        aoSelecionarPapel={trocarPerspectiva}
      />
    ),
    [
      dados.divergencias,
      dados.tarefas,
      modoSimulacao,
      camposFocoDomino,
      partesFocoDomino,
      lidarFoco,
      trocarPerspectiva,
    ],
  );

  const cardSinais = useMemo<ReactNode>(
    () => (
      <CardSinais
        sinais={dados.sinais}
        notificacoes={dados.notificacoes}
        sinaisNovos={sinaisNovos}
        avisosNovos={avisosNovos}
      />
    ),
    [dados.sinais, dados.notificacoes, sinaisNovos, avisosNovos],
  );

  const cardCadeia = useMemo<ReactNode>(
    () => (
      <CardCadeia
        auditoria={auditoria}
        pulsoExterno={pulsoEventoSeq}
        aoVerificar={aoVerificar}
        aoAbrirAuditoria={aoAbrirAuditoria}
        aoAncorar={aoAncorar}
        aoAnunciar={aoAnunciar}
      />
    ),
    [auditoria, pulsoEventoSeq, aoVerificar, aoAbrirAuditoria, aoAncorar, aoAnunciar],
  );

  const cardSimulador = useMemo<ReactNode>(
    () => (
      <CardSimulador
        pedidoId={id}
        versoes={dados.versoes}
        daSessao={daSessao}
        aoResultadoSimulacao={aoResultadoSimulacao}
        aoAplicarNaSessao={aplicarHipotesePapel}
        aoAnunciar={aoAnunciar}
      />
    ),
    [id, dados.versoes, daSessao, aoResultadoSimulacao, aplicarHipotesePapel, aoAnunciar],
  );

  const cardVersoes = useMemo<ReactNode>(
    () => <CardVersoes versoes={dados.versoes} />,
    [dados.versoes],
  );

  const cardsTorre = useMemo<Partial<Record<CardId, ReactNode>>>(
    () => ({
      matriz: cardMatriz,
      tarefas: cardTarefas,
      domino: cardDomino,
      sinais: cardSinais,
      cadeia: cardCadeia,
      simulador: cardSimulador,
      versoes: cardVersoes,
    }),
    [cardMatriz, cardTarefas, cardDomino, cardSinais, cardCadeia, cardSimulador, cardVersoes],
  );

  const titulosCard = useMemo<Partial<Record<CardId, string>>>(
    () => ({
      tarefas: filtro === FILTRO_TODAS ? 'Tarefas abertas' : `Tarefas · ${rotuloParte(filtro)}`,
    }),
    [filtro],
  );

  const aoFecharPalco = useCallback(() => {
    setPalcoPapelAberto(false);
    setModoSimulacao(false);
  }, []);

  const aoExecutarComandoPalco = useCallback(
    (cmd: string) => aoAbrirAssistente(cmd),
    [aoAbrirAssistente],
  );

  return (
    <>
      <header className="painel-cab">
        <div className="painel-identidade">
          <div className="painel-titulo-linha">
            <h1 id="pedido-titulo" title={id}>
              {dados.pedido ? (
                <>
                  <span>{dados.pedido.emitente.nome}</span>
                  <span className="titulo-codigo mono num">#{chaveCurta(id)}</span>
                </>
              ) : (
                <>
                  Pedido <span className="mono num">{chaveCurta(id)}</span>
                </>
              )}
            </h1>
            {daSessao && <span className="pilula-sutil">Sua sessão</span>}
          </div>

          {dados.pedido && (
            <div className="rota-visual slab-mineral" aria-label="Rota e conciliação de documentos">
              <div className="rota-fluxo">
                <div className="rota-extremo">
                  <span className="rota-icone" aria-hidden="true"><IconeFabrica /></span>
                  <div className="rota-txt">
                    <span className="rota-rotulo">Origem</span>
                    <strong className="rota-nome">{dados.pedido.emitente.nome}</strong>
                  </div>
                </div>

                <div className="rota-trilha" aria-hidden="true">
                  <span className="rota-linha" />
                  <span
                    className={
                      kpisDivergencia.length > 0
                        ? 'rota-no-carga rota-no-carga-dv'
                        : 'rota-no-carga'
                    }
                  >
                    <IconeCaminhao />
                    <span>{statusAtualVisual}</span>
                  </span>
                  <span className="rota-linha rota-linha-prox" />
                </div>

                <div className="rota-extremo rota-extremo-dir">
                  <span className="rota-icone" aria-hidden="true"><IconeGalpao /></span>
                  <div className="rota-txt">
                    <span className="rota-rotulo">Destino</span>
                    <strong className="rota-nome">{dados.pedido.destinatario.nome}</strong>
                  </div>
                </div>
              </div>

              <div className="rota-docs" aria-label="Documentos cruzados">
                {fontesAtivasHero.map((fonte, idx) => {
                  const conflita = fontesComConflito.has(fonte);
                  return (
                    <span key={fonte} className="rota-doc-par">
                      {idx > 0 && (
                        <span
                          className={
                            kpisDivergencia.length > 0
                              ? 'rota-doc-elo rota-doc-elo-dv'
                              : 'rota-doc-elo rota-doc-elo-ok'
                          }
                          aria-hidden="true"
                        />
                      )}
                      <span
                        className={conflita ? 'rota-doc-no rota-doc-no-dv' : 'rota-doc-no rota-doc-no-ok'}
                      >
                        {iconeFonteCompacto(fonte)}
                        <span>{rotuloFonte(fonte)}</span>
                      </span>
                    </span>
                  );
                })}
              </div>
            </div>
          )}

          <button
            type="button"
            className="painel-detalhes-toggle botao-sutil"
            aria-expanded={detalhesAbertos}
            aria-controls="painel-meta-detalhes"
            onClick={() => setDetalhesAbertos((v) => !v)}
          >
            {detalhesAbertos ? 'Ocultar detalhes' : 'Ver detalhes'}
          </button>
          <div className="painel-meta-linha" id="painel-meta-detalhes" hidden={!detalhesAbertos}>
            <div className="chave-linha">
              <p className="chave mono">
                NF-e {chaveAgrupada(id)}
                {manifesto ? ` · ${manifesto}` : ''}
              </p>
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
        </div>
      </header>

      <section className="kpi-hero-faixa slab-mineral" aria-label="Resumo operacional do pedido">
        {kpisDivergencia.length > 0 ? (
          <>
            {kpisDivergencia.map((kpi, idx) => {
              const ativo =
                (focoAtivo?.tipo === 'divergencia' || focoAtivo?.tipo === 'celula') &&
                focoAtivo.campo === kpi.campo;
              return (
                <button
                  key={kpi.campo}
                  ref={(el) => {
                    kpiRefs.current[idx] = el;
                  }}
                  type="button"
                  className="kpi-hero-item kpi-hero-clicavel"
                  style={{ '--stagger': Math.min(idx, 4) } as CSSProperties}
                  aria-pressed={ativo}
                  tabIndex={idx === posEfKpi ? 0 : -1}
                  onKeyDown={(e) => teclarKpi(e, idx)}
                  onFocus={() => setPosKpi(idx)}
                  onClick={() => alternarKpiCampo(kpi)}
                >
                  <span className="kpi-hero-label">
                    <span className="kpi-hero-icone" aria-hidden="true">{iconeCampoKpi(kpi.campo)}</span>
                    <span>{kpi.rotulo}</span>
                  </span>
                  <span className="kpi-hero-valor kpi-hero-valor-dv mono num">{kpi.valor}</span>
                  {renderMicroVisualKpi(kpi)}
                  <span className="kpi-hero-contexto mono num">{kpi.contexto}</span>
                </button>
              );
            })}
            <button
              ref={(el) => {
                kpiRefs.current[kpisDivergencia.length] = el;
              }}
              type="button"
              className="kpi-hero-item kpi-hero-clicavel"
              style={{ '--stagger': Math.min(kpisDivergencia.length, 4) } as CSSProperties}
              aria-pressed={false}
              tabIndex={kpisDivergencia.length === posEfKpi ? 0 : -1}
              onKeyDown={(e) => teclarKpi(e, kpisDivergencia.length)}
              onFocus={() => setPosKpi(kpisDivergencia.length)}
              onClick={() => {
                const reduzido =
                  typeof window !== 'undefined' &&
                  typeof window.matchMedia === 'function' &&
                  window.matchMedia('(prefers-reduced-motion: reduce)').matches;
                document.getElementById('torre-titulo-tarefas')?.scrollIntoView({
                  behavior: reduzido ? 'auto' : 'smooth',
                  block: 'start',
                });
              }}
            >
              <span className="kpi-hero-label">Tarefas abertas</span>
              <span className="kpi-hero-valor mono num">
                {totalTarefasAgrupadas}{' '}
                {totalTarefasAgrupadas === 1 ? 'tarefa' : 'tarefas'}
              </span>
              <span className="kpi-vis kpi-vis-setores" aria-hidden="true">
                {distribuicaoSetores.map((s) => (
                  <span
                    key={s.parte}
                    className="kpi-vis-setor-seg"
                    style={{ flexGrow: s.qtd }}
                    title={`${rotuloParte(s.parte)}: ${s.qtd}`}
                  />
                ))}
              </span>
              <span className="kpi-hero-contexto num">
                {setoresAfetadosCount} {setoresAfetadosCount === 1 ? 'setor' : 'setores'}
              </span>
            </button>
          </>
        ) : (
          <>
            <div className="kpi-hero-item" style={{ '--stagger': 0 } as CSSProperties}>
              <span className="kpi-hero-label">Conciliação</span>
              <span className="kpi-hero-valor kpi-hero-valor-ok mono num">0 divergências</span>
              <span className="kpi-vis kpi-vis-ok-trilha" aria-hidden="true" />
              <span className="kpi-hero-contexto">Fontes em acordo</span>
            </div>
            <div className="kpi-hero-item" style={{ '--stagger': 1 } as CSSProperties}>
              <span className="kpi-hero-label">Documentos</span>
              <span className="kpi-hero-valor mono num">
                {dados.versoes.length}{' '}
                {dados.versoes.length === 1 ? 'versão' : 'versões'}
              </span>
              <span className="kpi-hero-contexto">Verificados na cadeia</span>
            </div>
            <div className="kpi-hero-item" style={{ '--stagger': 2 } as CSSProperties}>
              <span className="kpi-hero-label">Tarefas abertas</span>
              <span className="kpi-hero-valor mono num">{totalTarefasAgrupadas}</span>
              <span className="kpi-hero-contexto">Nenhuma ação pendente</span>
            </div>
          </>
        )}
      </section>


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
            {trilhoGeo.pronto && (
              <span
                className="abas-indicador"
                aria-hidden="true"
                data-animar={trilhoGeo.animar ? 'true' : 'false'}
                style={{ '--ix': `${trilhoGeo.x}px`, '--iw-escala': trilhoGeo.largura } as CSSProperties}
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
          aoExecutarComando={aoExecutarComandoPalco}
          aoSelecionarPapel={trocarPerspectiva}
          aoNotificar={aoNotificar}
          aoAbrirAgenda={aoAbrirAgenda}
          aoSimularResultado={aoResultadoSimulacao}
          aoAplicarHipotese={aplicarHipotesePapel}
          aoFechar={aoFecharPalco}
          aoAnunciar={aoAnunciar}
          slotLoader={<SeloMonolitosShader ativo={true} tamanho={24} />}
        />
      )}

      <TorreGrid
        pedidoId={id}
        cards={cardsTorre}
        titulosCard={titulosCard}
        aoAnunciar={aoAnunciar}
      />
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
