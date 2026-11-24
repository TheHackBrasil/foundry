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
import { PARTES } from '../../../shared/model.ts';
import type { Parte, ProjecaoPedido, RespostaAuditoria, ViewSpec } from '../../../shared/model.ts';
import { obterViewSpec } from '../api.ts';
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
import { cacheLente, chaveCacheLente } from '../lenteCache.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  aplicarViewSpec,
  montarMatriz,
  tarefasDaParte,
  type FiltroParte,
  type LinhaMatriz,
  type ResultadoLente,
} from '../matriz.ts';
import type { Carga } from '../useTorre.ts';
import { BarraMandatos } from './BarraMandatos.tsx';
import { IconeConfere, IconeCopiar, IconeDiverge, IconeLente } from './icones.tsx';
import { MatrizFontes } from './MatrizFontes.tsx';
import { SinaisEAvisos, chaveNotificacao, chaveSinal } from './SinaisEAvisos.tsx';
import { StatusCadeia } from './StatusCadeia.tsx';
import { TarefasPorParte } from './TarefasPorParte.tsx';

interface Props {
  id: string;
  projecao: Carga<ProjecaoPedido>;
  auditoria: Carga<RespostaAuditoria>;
  novas: ReadonlySet<string>;
  aoVerificar: () => void;
  aoAnunciar: (texto: string) => void;
  aoSelecionar: (pedidoId: string) => void;
}

type SnapshotLente =
  | { modo: 'carregando'; papel: Parte }
  | {
      modo: 'adaptada';
      lente: Parte;
      fontesVisiveis: number;
      fontesTotal: number;
      camposVisiveis: number;
      camposTotal: number;
      itensOcultos: readonly string[];
      destacarDivergencias: boolean;
    }
  | { modo: 'avaliada'; lente: Parte }
  | { modo: 'indisponivel'; papel: Parte };

const ORDEM_ABAS: readonly FiltroParte[] = [FILTRO_TODAS, ...PARTES];
const NOVO_REGISTRO_MS = 8000;

// Frase que repete, em texto corrido, o que a matriz mostra por célula.
function Resumo({ linhas }: { linhas: readonly LinhaMatriz[] }) {
  const divergentes = linhas.filter((l) => l.divergente);
  if (divergentes.length === 0) {
    return (
      <p className="resumo-mx sem-diverge">
        <IconeConfere />
        <span>Nenhum campo diverge entre as fontes que já declararam valor.</span>
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
                <span>diverge em fonte oculta pela lente</span>
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
  const recentes = [...versoes].sort((a, b) => b.geradaEm.localeCompare(a.geradaEm) || b.versao - a.versao);
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
                <strong>{rotuloFonte(v.fonte)}</strong> v{v.versao} {v.versao === 1 ? 'registrada' : 'recebida'}
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
  dados,
  auditoria,
  novas,
  aoVerificar,
  aoAnunciar,
  aoSelecionar,
}: Omit<Props, 'projecao'> & { dados: ProjecaoPedido }) {
  const visaoId = useId();
  const matriz = useMemo(() => montarMatriz(dados.versoes, dados.divergencias), [dados.versoes, dados.divergencias]);
  const [filtro, setFiltro] = useState<FiltroParte>(FILTRO_TODAS);
  const [specAtivo, setSpecAtivo] = useState<ViewSpec | null>(null);
  const [carregandoLente, setCarregandoLente] = useState(false);
  const [erroLente, setErroLente] = useState(false);
  const [papelCompondo, setPapelCompondo] = useState<Parte | null>(null);
  const [direcaoLente, setDirecaoLente] = useState<-1 | 0 | 1>(0);
  const [lenteSnapshot, setLenteSnapshot] = useState<SnapshotLente | null>(null);
  const [chaveCopiada, setChaveCopiada] = useState(false);
  const [trilho, setTrilho] = useState<{ x: number; w: number; pronto: boolean }>({ x: 0, w: 0, pronto: false });
  const [fadeEsq, setFadeEsq] = useState(false);
  const [fadeDir, setFadeDir] = useState(false);

  const abasListaRef = useRef<HTMLDivElement>(null);
  const lenteSeq = useRef(0);
  const lenteAbort = useRef<AbortController | null>(null);
  const ultimoTotalRef = useRef(dados.totalEventos);
  const fecharLenteTimerRef = useRef<number | null>(null);
  const copiaTimerRef = useRef<number | null>(null);
  const matrizCabRef = useRef<HTMLHeadingElement>(null);
  const montouLenteRef = useRef(false);
  const ultimaLenteAnunciadaRef = useRef<string | null>(null);

  const abas = useMemo<ReadonlyArray<{ valor: FiltroParte; rotulo: string; n: number }>>(
    () => [
      { valor: FILTRO_TODAS, rotulo: 'Visão completa', n: agruparTarefas(dados.tarefas).length },
      ...PARTES.map((p) => ({
        valor: p as FiltroParte,
        rotulo: rotuloParte(p),
        n: agruparTarefas(tarefasDaParte(dados.tarefas, p)).length,
      })),
    ],
    [dados.tarefas],
  );
  const assinaturaContagens = abas.map((a) => a.n).join(',');
  const tarefasVisiveis = useMemo(
    () =>
      filtro === FILTRO_TODAS
        ? agruparTarefas(dados.tarefas).length
        : agruparTarefas(tarefasDaParte(dados.tarefas, filtro)).length,
    [dados.tarefas, filtro],
  );

  const sinaisConhecidos = useRef<ReadonlySet<string>>(new Set(dados.sinais.map(chaveSinal)));
  const avisosConhecidos = useRef<ReadonlySet<string>>(new Set(dados.notificacoes.map(chaveNotificacao)));
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
      if (fecharLenteTimerRef.current !== null) window.clearTimeout(fecharLenteTimerRef.current);
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
      const emCache = cacheLente.obter(chave);
      lenteAbort.current?.abort();
      const seq = ++lenteSeq.current;
      setErroLente(false);
      if (emCache) {
        setSpecAtivo(emCache);
        setCarregandoLente(false);
        setPapelCompondo(null);
        return;
      }
      const ctrl = new AbortController();
      lenteAbort.current = ctrl;
      setPapelCompondo(papel);
      setCarregandoLente(true);
      try {
        const spec = await obterViewSpec(id, papel, ctrl.signal);
        if (seq !== lenteSeq.current) return;
        cacheLente.guardar(chave, spec);
        setSpecAtivo(spec);
      } catch {
        // Fallback honesto para a matriz completa: falha de lente nunca bloqueia o painel.
        if (seq === lenteSeq.current) {
          setSpecAtivo(null);
          setErroLente(true);
        }
      } finally {
        if (seq === lenteSeq.current) {
          setCarregandoLente(false);
          setPapelCompondo(null);
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
      if (proximo === FILTRO_TODAS) {
        lenteAbort.current?.abort();
        lenteSeq.current += 1;
        setCarregandoLente(false);
        setErroLente(false);
        setPapelCompondo(null);
        setSpecAtivo(null);
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
      } else if (proximo !== FILTRO_TODAS && !specAtivo && !carregandoLente) {
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
    [aoFiltrar, buscarLente, carregandoLente, dados.totalEventos, filtro, specAtivo],
  );

  function aoTeclarAba(e: KeyboardEvent<HTMLButtonElement>, i: number) {
    const proxima = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: abas.length - 1 }[e.key];
    if (proxima === undefined) return;
    e.preventDefault();
    const destino = (proxima + abas.length) % abas.length;
    const alvo = abas[destino];
    if (!alvo) return;
    trocarPerspectiva(alvo.valor);
    abasListaRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[destino]?.focus({ preventScroll: true });
  }

  function voltarVisaoCompleta() {
    const primeiraAba = abasListaRef.current?.querySelector<HTMLButtonElement>('[role="tab"]');
    (primeiraAba ?? matrizCabRef.current)?.focus({ preventScroll: true });
    trocarPerspectiva(FILTRO_TODAS);
    aoAnunciar('Exibindo visão completa do pedido.');
  }

  const resultadoLente = useMemo<ResultadoLente>(() => {
    if (specAtivo && filtro !== FILTRO_TODAS) {
      return aplicarViewSpec(matriz, specAtivo);
    }
    return {
      matriz,
      ajustada: false,
      fontesOcultas: [],
      camposOcultos: [],
      destacarDivergencias: true,
      lente: filtro === FILTRO_TODAS ? 'fornecedor' : filtro,
    };
  }, [matriz, specAtivo, filtro]);

  const matrizVisivel = resultadoLente.matriz;
  const assinaturaLente = `${resultadoLente.ajustada ? resultadoLente.lente : 'completa'}|${matrizVisivel.fontes.join(',')}|${matrizVisivel.linhas.map((l) => l.campo).join(',')}|${resultadoLente.destacarDivergencias}`;

  const itensOcultos = useMemo(
    () => [
      ...resultadoLente.fontesOcultas.map(rotuloFonte),
      ...resultadoLente.camposOcultos.map(rotuloCampo),
    ],
    [resultadoLente.fontesOcultas, resultadoLente.camposOcultos],
  );

  const conteudoLenteAtual = useMemo<SnapshotLente | null>(() => {
    if (filtro === FILTRO_TODAS) return null;
    if (carregandoLente && papelCompondo !== null) {
      return { modo: 'carregando', papel: papelCompondo };
    }
    if (specAtivo && specAtivo.lente === filtro) {
      if (resultadoLente.ajustada) {
        return {
          modo: 'adaptada',
          lente: resultadoLente.lente,
          fontesVisiveis: matrizVisivel.fontes.length,
          fontesTotal: matriz.fontes.length,
          camposVisiveis: matrizVisivel.linhas.length,
          camposTotal: matriz.linhas.length,
          itensOcultos,
          destacarDivergencias: resultadoLente.destacarDivergencias,
        };
      }
      return { modo: 'avaliada', lente: specAtivo.lente };
    }
    if (erroLente) {
      return { modo: 'indisponivel', papel: filtro };
    }
    return null;
  }, [
    filtro,
    carregandoLente,
    papelCompondo,
    specAtivo,
    erroLente,
    resultadoLente.ajustada,
    resultadoLente.lente,
    resultadoLente.destacarDivergencias,
    matrizVisivel.fontes.length,
    matrizVisivel.linhas.length,
    matriz.fontes.length,
    matriz.linhas.length,
    itensOcultos,
  ]);

  const lenteAberta = conteudoLenteAtual !== null;

  useEffect(() => {
    if (fecharLenteTimerRef.current !== null) {
      window.clearTimeout(fecharLenteTimerRef.current);
      fecharLenteTimerRef.current = null;
    }
    if (conteudoLenteAtual) {
      setLenteSnapshot(conteudoLenteAtual);
      return;
    }
    fecharLenteTimerRef.current = window.setTimeout(() => {
      setLenteSnapshot(null);
      fecharLenteTimerRef.current = null;
    }, 200);
    return () => {
      if (fecharLenteTimerRef.current !== null) {
        window.clearTimeout(fecharLenteTimerRef.current);
        fecharLenteTimerRef.current = null;
      }
    };
  }, [conteudoLenteAtual]);

  const lenteExibida = conteudoLenteAtual ?? lenteSnapshot;

  useEffect(() => {
    const chaveAtual =
      filtro !== FILTRO_TODAS && specAtivo && specAtivo.lente === filtro
        ? resultadoLente.ajustada
          ? `adaptada|${resultadoLente.lente}|${matrizVisivel.fontes.length}|${matriz.fontes.length}|${matrizVisivel.linhas.length}`
          : `avaliada|${specAtivo.lente}`
        : null;
    if (!montouLenteRef.current) {
      montouLenteRef.current = true;
      ultimaLenteAnunciadaRef.current = chaveAtual;
      return;
    }
    if (chaveAtual === ultimaLenteAnunciadaRef.current) return;
    ultimaLenteAnunciadaRef.current = chaveAtual;
    if (chaveAtual === null || !specAtivo) return;
    if (resultadoLente.ajustada) {
      aoAnunciar(
        `Visão adaptada pela IA para ${rotuloParte(resultadoLente.lente)}: ${matrizVisivel.fontes.length} de ${matriz.fontes.length} fontes e ${matrizVisivel.linhas.length} de ${matriz.linhas.length} campos.`,
      );
    } else {
      aoAnunciar(
        `Visão avaliada pela IA para ${rotuloParte(specAtivo.lente)}: todas as fontes e campos atuais são relevantes.`,
      );
    }
  }, [
    aoAnunciar,
    filtro,
    matriz.fontes.length,
    matriz.linhas.length,
    matrizVisivel.fontes.length,
    matrizVisivel.linhas.length,
    resultadoLente.ajustada,
    resultadoLente.lente,
    specAtivo,
  ]);

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

  return (
    <>
      <div className="painel-cab">
        <div className="painel-identidade">
          <a href="#painel-lateral" className="atalho-mobile">
            Pedidos e envio ↓
          </a>
          <h1 id="pedido-titulo">
            Pedido <span className="mono">{chaveCurta(id)}</span>
          </h1>
          {dados.pedido && (
            <p className="partes-pedido">
              {dados.pedido.emitente.nome} <span className="meta" aria-hidden="true">→</span>{' '}
              {dados.pedido.destinatario.nome}
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
        <StatusCadeia auditoria={auditoria} aoVerificar={aoVerificar} aoAnunciar={aoAnunciar} />
      </div>

      <BarraMandatos aoAnunciar={aoAnunciar} aoSelecionar={aoSelecionar} aoAplicarPapel={trocarPerspectiva} />

      <section className="perspectiva-secao" aria-labelledby="bloco-visao">
        <div className="perspectiva-cab">
          <h2 id="bloco-visao" className="sec-titulo-icone">
            <IconeLente />
            <span>Visão por papel</span>
            <span className="pilula-coord">GenUI</span>
          </h2>
          <p className="meta">
            Escolha um papel: a IA adapta as fontes e campos da matriz e filtra as tarefas abaixo.
          </p>
        </div>

        <div
          className="abas-wrap"
          data-fade-esq={fadeEsq ? 'true' : 'false'}
          data-fade-dir={fadeDir ? 'true' : 'false'}
        >
          <div className="abas" role="tablist" aria-label="Visão por papel" ref={abasListaRef}>
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
                <span className="aba-n num">{a.n}</span>
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
      </section>

      {/* data-fontes segue a matriz completa para as colunas nao pularem durante a lente. */}
      <div className="cols" data-fontes={matriz.fontes.length}>
        <section aria-labelledby="bloco-matriz">
          <div className="sec-cab">
            <div className="sec-cab-grupo">
              <h2 id="bloco-matriz" ref={matrizCabRef} tabIndex={-1}>
                Fontes e campos
              </h2>
              <p className="meta">
                Referência: primeira fonte que declara o campo.
              </p>
            </div>
          </div>

          <div
            className={`lente-gaveta ${lenteAberta ? 'lente-gaveta-aberta' : ''}`}
            aria-hidden={!lenteAberta || undefined}
            inert={!lenteAberta || undefined}
          >
            <div className="lente-gaveta-inner">
              {lenteExibida && (
                <div className="lente-gaveta-pad">
                  {lenteExibida.modo === 'carregando' && (
                    <div className="lente-faixa lente-faixa-carregando">
                      <span className="lente-status">
                        <span className="cmd-spinner" aria-hidden="true" />
                        <span>IA adaptando a visão para {rotuloParte(lenteExibida.papel)}…</span>
                      </span>
                    </div>
                  )}
                  {lenteExibida.modo === 'adaptada' && (
                    <div className="lente-faixa">
                      <div className="lente-info">
                        <span className="pilula-coord">
                          <IconeLente />
                          Visão adaptada pela IA · {rotuloParte(lenteExibida.lente)}
                        </span>
                        <span className="meta num">
                          {lenteExibida.fontesVisiveis}/{lenteExibida.fontesTotal} fontes ·{' '}
                          {lenteExibida.camposVisiveis}/{lenteExibida.camposTotal} campos
                        </span>
                        {lenteExibida.itensOcultos.length > 0 && (
                          <span className="lente-ocultos">
                            <span className="meta">Ocultou:</span>
                            {lenteExibida.itensOcultos.map((nome) => (
                              <span key={nome} className="pilula-sutil">
                                {nome}
                              </span>
                            ))}
                          </span>
                        )}
                        {!lenteExibida.destacarDivergencias && (
                          <span className="meta">Destaques suprimidos para este papel.</span>
                        )}
                      </div>
                      <button
                        type="button"
                        className="botao-sutil"
                        tabIndex={lenteAberta ? 0 : -1}
                        onClick={voltarVisaoCompleta}
                      >
                        Ver visão completa
                      </button>
                    </div>
                  )}
                  {lenteExibida.modo === 'avaliada' && (
                    <div className="lente-faixa">
                      <div className="lente-info">
                        <span className="pilula-neutra">
                          <IconeLente />
                          Visão avaliada pela IA · {rotuloParte(lenteExibida.lente)}
                        </span>
                        <span className="meta">
                          Todas as fontes e campos atuais são relevantes para este papel.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="botao-sutil"
                        tabIndex={lenteAberta ? 0 : -1}
                        onClick={voltarVisaoCompleta}
                      >
                        Ver visão completa
                      </button>
                    </div>
                  )}
                  {lenteExibida.modo === 'indisponivel' && (
                    <div className="lente-faixa">
                      <div className="lente-info">
                        <span className="pilula-sutil">
                          Matriz completa · {rotuloParte(lenteExibida.papel)}
                        </span>
                        <span className="meta">
                          Adaptação por IA indisponível no momento; tarefas filtradas abaixo.
                        </span>
                      </div>
                      <button
                        type="button"
                        className="botao-sutil"
                        tabIndex={lenteAberta ? 0 : -1}
                        onClick={voltarVisaoCompleta}
                      >
                        Ver visão completa
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          <MatrizFontes
            matriz={matrizVisivel}
            destacar={resultadoLente.destacarDivergencias}
            carregandoLente={carregandoLente}
            assinaturaLente={assinaturaLente}
            direcaoLente={direcaoLente}
          />
          {matrizVisivel.fontes.length > 0 && <Resumo linhas={matrizVisivel.linhas} />}
        </section>

        <section aria-labelledby="bloco-tarefas">
          <div className="sec-cab">
            <div className="sec-cab-grupo">
              <h2 id="bloco-tarefas">
                {filtro === FILTRO_TODAS ? 'Todas as tarefas' : `Tarefas · ${rotuloParte(filtro)}`}
              </h2>
              <p className="meta">Ações derivadas das divergências abertas por papel.</p>
            </div>
            <span className="pilula-sutil num">
              {tarefasVisiveis} {tarefasVisiveis === 1 ? 'tarefa' : 'tarefas'}
            </span>
          </div>
          <TarefasPorParte
            tarefas={dados.tarefas}
            filtro={filtro}
            novas={novas}
            direcao={direcaoLente}
            painelId={`${visaoId}-painel`}
            rotuloAbaId={`${visaoId}-${filtro}`}
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

export function PainelPedido({ id, projecao, auditoria, novas, aoVerificar, aoAnunciar, aoSelecionar }: Props) {
  return (
    <article aria-labelledby="pedido-titulo">
      {projecao.estado === 'carregando' && (
        <>
          <a href="#painel-lateral" className="atalho-mobile">
            Pedidos e envio ↓
          </a>
          <h1 id="pedido-titulo" className="so-leitor">
            Pedido {chaveCurta(id)}
          </h1>
          <p className="dica">Carregando o pedido…</p>
        </>
      )}
      {projecao.estado === 'erro' && (
        <>
          <a href="#painel-lateral" className="atalho-mobile">
            Pedidos e envio ↓
          </a>
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
          dados={projecao.dados}
          auditoria={auditoria}
          novas={novas}
          aoVerificar={aoVerificar}
          aoAnunciar={aoAnunciar}
          aoSelecionar={aoSelecionar}
        />
      )}
    </article>
  );
}
