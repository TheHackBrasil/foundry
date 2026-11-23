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
import { IconeConfere, IconeDiverge, IconeLente } from './icones.tsx';
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
        <h3 id="bloco-versoes">Versões recebidas</h3>
        <span className="meta">Só acréscimo: nada é apagado do registro.</span>
      </div>
      <ul className="versoes">
        {recentes.map((v) => (
          <li key={`${v.fonte}-${v.versao}`}>
            <time dateTime={v.geradaEm}>{formatarMomento(v.geradaEm)}</time>
            <span>
              {rotuloFonte(v.fonte)} v{v.versao} {v.versao === 1 ? 'registrada' : 'recebida'}.
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function descreverOcultos(lente: ResultadoLente): string {
  const partes: string[] = [];
  if (lente.fontesOcultas.length > 0) {
    partes.push(lente.fontesOcultas.map(rotuloFonte).join(', '));
  }
  if (lente.camposOcultos.length > 0) {
    partes.push(lente.camposOcultos.map(rotuloCampo).join(', '));
  }
  return partes.join(' · ');
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
  // Abre na primeira parte que tem tarefa; "Todas" continua à mão.
  const [filtro, setFiltro] = useState<FiltroParte>(
    () => PARTES.find((p) => tarefasDaParte(dados.tarefas, p).length > 0) ?? FILTRO_TODAS,
  );
  const [specAtivo, setSpecAtivo] = useState<ViewSpec | null>(null);
  const [carregandoLente, setCarregandoLente] = useState(false);
  const [ignorarLente, setIgnorarLente] = useState(false);
  const [teveTransicaoLente, setTeveTransicaoLente] = useState(false);

  const lenteSeq = useRef(0);
  const lenteAbort = useRef<AbortController | null>(null);
  const ultimoTotalRef = useRef(dados.totalEventos);

  // Destaca sinais e avisos novos que chegam ao vivo via SSE.
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
        setTeveTransicaoLente(true);
        setSpecAtivo(emCache);
        setCarregandoLente(false);
        return;
      }
      const ctrl = new AbortController();
      lenteAbort.current = ctrl;
      setCarregandoLente(true);
      try {
        const spec = await obterViewSpec(id, papel, ctrl.signal);
        if (seq !== lenteSeq.current) return;
        cacheLente.guardar(chave, spec);
        setTeveTransicaoLente(true);
        setSpecAtivo(spec);
      } catch {
        // Fallback silencioso para a visao completa: falha de lente nunca bloqueia o painel.
        if (seq === lenteSeq.current) setSpecAtivo(null);
      } finally {
        if (seq === lenteSeq.current) setCarregandoLente(false);
      }
    },
    [id],
  );

  // Quando o SSE entrega novos eventos com uma lente ativa, revalida o spec
  // para nao ocultar fontes recem-chegadas.
  useEffect(() => {
    if (dados.totalEventos === ultimoTotalRef.current) return;
    ultimoTotalRef.current = dados.totalEventos;
    if (specAtivo && filtro !== FILTRO_TODAS && !ignorarLente) {
      void buscarLente(filtro, dados.totalEventos);
    }
  }, [dados.totalEventos, specAtivo, filtro, ignorarLente, buscarLente]);

  const aoFiltrar = useCallback(
    (proximo: FiltroParte) => {
      setFiltro(proximo);
      setIgnorarLente(false);
      if (proximo === FILTRO_TODAS) {
        lenteAbort.current?.abort();
        lenteSeq.current += 1;
        setCarregandoLente(false);
        setSpecAtivo((anterior) => {
          if (anterior !== null) setTeveTransicaoLente(true);
          return null;
        });
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
  const chaveTransicao = teveTransicaoLente
    ? `${resultadoLente.ajustada ? resultadoLente.lente : 'completa'}|${matrizVisivel.fontes.join(',')}|${matrizVisivel.linhas.map((l) => l.campo).join(',')}|${resultadoLente.destacarDivergencias}`
    : undefined;
  const ocultosTexto = resultadoLente.ajustada ? descreverOcultos(resultadoLente) : '';

  return (
    <>
      <div className="painel-cab">
        <div>
          <h2 id="pedido-titulo">
            Pedido <span className="mono">{chaveCurta(id)}</span>
          </h2>
          {dados.pedido && (
            <p className="partes-pedido">
              {dados.pedido.emitente.nome} para {dados.pedido.destinatario.nome}.
            </p>
          )}
          <p className="chave mono">Chave NF-e {chaveAgrupada(id)}</p>
        </div>
        <StatusCadeia auditoria={auditoria} aoVerificar={aoVerificar} />
      </div>

      <BarraMandatos aoAnunciar={aoAnunciar} aoSelecionar={aoSelecionar} />

      {/* data-fontes segue a matriz completa para as abas nao pularem de coluna durante a lente. */}
      <div className="cols" data-fontes={matriz.fontes.length}>
        <section aria-labelledby="bloco-matriz">
          <div className="sec-cab">
            <h3 id="bloco-matriz">Fontes e campos</h3>
            <div className="sec-cab-dir">
              <span className="meta">
                Referência: a primeira fonte que declara o campo. Células diferentes dela ficam marcadas.
              </span>
              {filtro !== FILTRO_TODAS &&
                !carregandoLente &&
                matriz.fontes.length > 0 &&
                !resultadoLente.ajustada &&
                (!specAtivo || specAtivo.lente !== filtro || ignorarLente) && (
                  <button
                    type="button"
                    className="botao-sutil"
                    onClick={() => {
                      setIgnorarLente(false);
                      if (specAtivo && specAtivo.lente === filtro) {
                        setTeveTransicaoLente(true);
                      } else {
                        void buscarLente(filtro, dados.totalEventos);
                      }
                    }}
                  >
                    {ignorarLente && specAtivo && specAtivo.lente === filtro
                      ? `Reativar lente de ${rotuloParte(filtro)}`
                      : `Ajustar visão para ${rotuloParte(filtro)}`}
                  </button>
                )}
            </div>
          </div>

          {resultadoLente.ajustada && (
            <div className="lente-faixa" role="status">
              <div className="lente-info">
                <IconeLente />
                <div>
                  <p className="lente-titulo">Visão ajustada para {rotuloParte(resultadoLente.lente)}</p>
                  <p className="meta">
                    Mostrando {matrizVisivel.fontes.length} de {matriz.fontes.length}{' '}
                    {matriz.fontes.length === 1 ? 'fonte' : 'fontes'} e {matrizVisivel.linhas.length} de{' '}
                    {matriz.linhas.length} campos.
                    {ocultosTexto && ` Oculto: ${ocultosTexto}.`}
                    {!resultadoLente.destacarDivergencias && ' Destaques de divergência suprimidos para este papel.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="botao-sutil"
                onClick={() => {
                  setTeveTransicaoLente(true);
                  setIgnorarLente(true);
                }}
              >
                Ver matriz completa
              </button>
            </div>
          )}

          <MatrizFontes
            matriz={matrizVisivel}
            destacar={resultadoLente.destacarDivergencias}
            carregandoLente={carregandoLente}
            chaveTransicao={chaveTransicao}
          />
          {matrizVisivel.fontes.length > 0 && <Resumo linhas={matrizVisivel.linhas} />}
        </section>

        <section aria-labelledby="bloco-tarefas">
          <div className="sec-cab">
            <h3 id="bloco-tarefas">Tarefas por parte</h3>
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
          <h2 id="pedido-titulo" className="so-leitor">
            Pedido {chaveCurta(id)}
          </h2>
          <p className="dica">Carregando o pedido…</p>
        </>
      )}
      {projecao.estado === 'erro' && (
        <>
          <h2 id="pedido-titulo" className="so-leitor">
            Pedido {chaveCurta(id)}
          </h2>
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
