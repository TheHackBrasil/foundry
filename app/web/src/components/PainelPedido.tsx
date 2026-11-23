import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PARTES } from '../../../shared/model.ts';
import type { Parte, ProjecaoPedido, RespostaAuditoria, ViewSpec } from '../../../shared/model.ts';
import { obterViewSpec } from '../api.ts';
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
      modo: 'ativa';
      lente: Parte;
      fontesVisiveis: number;
      fontesTotal: number;
      camposVisiveis: number;
      camposTotal: number;
      itensOcultos: readonly string[];
      destacarDivergencias: boolean;
    };

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
      <div className="sec-cab">
        <div className="sec-cab-grupo">
          <h2 id="bloco-versoes">Versões recebidas</h2>
          <p className="meta">Só acréscimo · nada é apagado do registro</p>
        </div>
      </div>
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
  const matriz = useMemo(() => montarMatriz(dados.versoes, dados.divergencias), [dados.versoes, dados.divergencias]);
  const [filtro, setFiltro] = useState<FiltroParte>(
    () => PARTES.find((p) => tarefasDaParte(dados.tarefas, p).length > 0) ?? FILTRO_TODAS,
  );
  const [specAtivo, setSpecAtivo] = useState<ViewSpec | null>(null);
  const [carregandoLente, setCarregandoLente] = useState(false);
  const [papelCompondo, setPapelCompondo] = useState<Parte | null>(null);
  const [ignorarLente, setIgnorarLente] = useState(false);
  const [direcaoLente, setDirecaoLente] = useState<-1 | 0 | 1>(0);
  const [lenteSnapshot, setLenteSnapshot] = useState<SnapshotLente | null>(null);
  const [chaveCopiada, setChaveCopiada] = useState(false);

  const lenteSeq = useRef(0);
  const lenteAbort = useRef<AbortController | null>(null);
  const ultimoTotalRef = useRef(dados.totalEventos);
  const fecharLenteTimerRef = useRef<number | null>(null);
  const copiaTimerRef = useRef<number | null>(null);

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

  const buscarLente = useCallback(
    async (papel: Parte, totalEventos: number) => {
      const chave = chaveCacheLente(id, papel, totalEventos);
      const emCache = cacheLente.obter(chave);
      lenteAbort.current?.abort();
      const seq = ++lenteSeq.current;
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
        // Fallback silencioso para a visao completa: falha de lente nunca bloqueia o painel.
        if (seq === lenteSeq.current) setSpecAtivo(null);
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
    if (specAtivo && filtro !== FILTRO_TODAS && !ignorarLente) {
      void buscarLente(filtro, dados.totalEventos);
    }
  }, [dados.totalEventos, specAtivo, filtro, ignorarLente, buscarLente]);

  const aoFiltrar = useCallback(
    (proximo: FiltroParte, direcao: -1 | 0 | 1 = 0) => {
      setFiltro(proximo);
      setIgnorarLente(false);
      setDirecaoLente(direcao);
      if (proximo === FILTRO_TODAS) {
        lenteAbort.current?.abort();
        lenteSeq.current += 1;
        setCarregandoLente(false);
        setPapelCompondo(null);
        setSpecAtivo(null);
        return;
      }
      void buscarLente(proximo, dados.totalEventos);
    },
    [buscarLente, dados.totalEventos],
  );

  const resultadoLente = useMemo<ResultadoLente>(() => {
    if (specAtivo && filtro !== FILTRO_TODAS && !ignorarLente) {
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
  }, [matriz, specAtivo, filtro, ignorarLente]);

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
    if (carregandoLente && papelCompondo !== null) {
      return { modo: 'carregando', papel: papelCompondo };
    }
    if (resultadoLente.ajustada) {
      return {
        modo: 'ativa',
        lente: resultadoLente.lente,
        fontesVisiveis: matrizVisivel.fontes.length,
        fontesTotal: matriz.fontes.length,
        camposVisiveis: matrizVisivel.linhas.length,
        camposTotal: matriz.linhas.length,
        itensOcultos,
        destacarDivergencias: resultadoLente.destacarDivergencias,
      };
    }
    return null;
  }, [
    carregandoLente,
    papelCompondo,
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

  const podeAcionarLente =
    filtro !== FILTRO_TODAS &&
    !carregandoLente &&
    matriz.fontes.length > 0 &&
    !resultadoLente.ajustada &&
    (!specAtivo || specAtivo.lente !== filtro || ignorarLente);

  async function copiarChave() {
    if (!navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(id);
    } catch {
      return;
    }
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

      <BarraMandatos aoAnunciar={aoAnunciar} aoSelecionar={aoSelecionar} />

      {/* data-fontes segue a matriz completa para as abas nao pularem de coluna durante a lente. */}
      <div className="cols" data-fontes={matriz.fontes.length}>
        <section aria-labelledby="bloco-matriz">
          <div className="sec-cab">
            <div className="sec-cab-grupo">
              <h2 id="bloco-matriz">Fontes e campos</h2>
              <p className="meta">
                Referência: primeira fonte que declara o campo. Divergências ficam marcadas.
              </p>
            </div>
            {podeAcionarLente && (
              <button
                type="button"
                className="btn-lente"
                onClick={() => {
                  setDirecaoLente(0);
                  setIgnorarLente(false);
                  if (!specAtivo || specAtivo.lente !== filtro) {
                    void buscarLente(filtro, dados.totalEventos);
                  }
                }}
              >
                <IconeLente />
                <span>
                  {ignorarLente && specAtivo && specAtivo.lente === filtro
                    ? `Reativar lente · ${rotuloParte(filtro)}`
                    : `Lente · ${rotuloParte(filtro)}`}
                </span>
              </button>
            )}
          </div>

          <div
            className={`lente-gaveta ${lenteAberta ? 'lente-gaveta-aberta' : ''}`}
            aria-hidden={!lenteAberta || undefined}
          >
            <div className="lente-gaveta-inner">
              {lenteExibida && (
                <div className="lente-gaveta-pad">
                  {lenteExibida.modo === 'carregando' ? (
                    <div className="lente-faixa lente-faixa-carregando" role={lenteAberta ? 'status' : undefined}>
                      <span className="lente-status">
                        <span className="cmd-spinner" aria-hidden="true" />
                        <span>Ajustando visão para {rotuloParte(lenteExibida.papel)}…</span>
                      </span>
                    </div>
                  ) : (
                    <div className="lente-faixa" role={lenteAberta ? 'status' : undefined}>
                      <div className="lente-info">
                        <span className="pilula-coord">
                          <IconeLente />
                          Visão ajustada para {rotuloParte(lenteExibida.lente)}
                        </span>
                        <span className="meta num">
                          {lenteExibida.fontesVisiveis}/{lenteExibida.fontesTotal} fontes ·{' '}
                          {lenteExibida.camposVisiveis}/{lenteExibida.camposTotal} campos
                        </span>
                        {lenteExibida.itensOcultos.length > 0 && (
                          <span className="lente-ocultos">
                            <span className="meta">Oculto:</span>
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
                        onClick={() => {
                          setDirecaoLente(0);
                          setIgnorarLente(true);
                        }}
                      >
                        Ver matriz completa
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
              <h2 id="bloco-tarefas">Tarefas por parte</h2>
              <p className="meta">Ações derivadas das divergências abertas por papel.</p>
            </div>
          </div>
          <TarefasPorParte tarefas={dados.tarefas} filtro={filtro} aoFiltrar={aoFiltrar} novas={novas} />
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
