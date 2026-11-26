// Tela #/operacao (specs 0010/0011, T530-T533): fila de casos de exceção
// com ações do ciclo de vida, detalhe com token do parceiro e comprovante
// verificável, cobranças de status e o painel de métricas. Casos e
// cobranças da seed aparecem somente leitura para o visitante.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PARTES, type Parte } from '../../../shared/model.ts';
import { ErroApi } from '../api.ts';
import {
  chaveCurta,
  formatarMomento,
  formatarValor,
  rotuloFonte,
  rotuloParte,
} from '../format.ts';
import type { Carga } from '../useTorre.ts';
import {
  assumirCaso,
  enviarCobranca,
  listarCasos,
  listarCobrancas,
  listarMetricas,
  obterCaso,
  obterLinkComprovante,
  reabrirCaso,
  resolverCaso,
  responderComoParceiro,
  type CasoDetalhe,
} from './api.ts';
import {
  cartoesMetricas,
  classeStatusCaso,
  classeStatusCobranca,
  ordenarCasos,
  podeEnviarCobranca,
  rotuloStatusCaso,
  rotuloStatusCobranca,
  tituloCaso,
  type CasoLista,
  type CobrancaLista,
} from './dominio.ts';
import { IconeComprovante, IconeEnvelope } from './icones.tsx';
import type { Metricas } from '../../../shared/model.ts';
import './operacao.css';

export interface PaginaOperacaoProps {
  aoAnunciar: (texto: string) => void;
  aoAbrirNaTorre: (pedidoId: string) => void;
  // Sobe a cada evento SSE: a fila recarrega junto com o resto da torre.
  pulsoEventoSeq?: number;
}

const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : 'Erro inesperado.');

export function PaginaOperacao({ aoAnunciar, aoAbrirNaTorre, pulsoEventoSeq = 0 }: PaginaOperacaoProps) {
  const [casos, setCasos] = useState<Carga<CasoLista[]>>({ estado: 'carregando' });
  const [metricas, setMetricas] = useState<Carga<Metricas>>({ estado: 'carregando' });
  const [cobrancas, setCobrancas] = useState<Carga<CobrancaLista[]>>({ estado: 'carregando' });
  const [sel, setSel] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<Carga<CasoDetalhe>>({ estado: 'carregando' });
  const [ocupada, setOcupada] = useState(false);
  const [parteSel, setParteSel] = useState<Parte>('transportadora');
  const [textoResolucao, setTextoResolucao] = useState('');
  const [textoParceiro, setTextoParceiro] = useState('');
  const [comprovanteUrl, setComprovanteUrl] = useState<string | null>(null);
  const [enviandoId, setEnviandoId] = useState<number | null>(null);
  const detalheSeq = useRef(0);
  const selRef = useRef<string | null>(null);
  selRef.current = sel;

  const recarregar = useCallback(async () => {
    const [rCasos, rMetricas, rCobrancas] = await Promise.allSettled([
      listarCasos(),
      listarMetricas(),
      listarCobrancas(),
    ]);
    setCasos(
      rCasos.status === 'fulfilled'
        ? { estado: 'ok', dados: rCasos.value.casos }
        : { estado: 'erro', mensagem: mensagemDe(rCasos.reason) },
    );
    setMetricas(
      rMetricas.status === 'fulfilled'
        ? { estado: 'ok', dados: rMetricas.value.metricas }
        : { estado: 'erro', mensagem: mensagemDe(rMetricas.reason) },
    );
    setCobrancas(
      rCobrancas.status === 'fulfilled'
        ? { estado: 'ok', dados: rCobrancas.value.cobrancas }
        : { estado: 'erro', mensagem: mensagemDe(rCobrancas.reason) },
    );
  }, []);

  const carregarDetalhe = useCallback(async (id: string) => {
    const seq = ++detalheSeq.current;
    setDetalhe({ estado: 'carregando' });
    setComprovanteUrl(null);
    try {
      const d = await obterCaso(id);
      if (seq !== detalheSeq.current) return;
      setDetalhe({ estado: 'ok', dados: d });
    } catch (e) {
      if (seq === detalheSeq.current) {
        setDetalhe({ estado: 'erro', mensagem: mensagemDe(e) });
      }
    }
  }, []);

  useEffect(() => {
    void recarregar();
  }, [recarregar, pulsoEventoSeq]);

  useEffect(() => {
    if (sel) void carregarDetalhe(sel);
  }, [sel, carregarDetalhe]);

  const fila = useMemo(
    () => (casos.estado === 'ok' ? ordenarCasos(casos.dados) : []),
    [casos],
  );

  // Seleciona o primeiro caso da fila quando nenhum está aberto.
  useEffect(() => {
    if (fila.length > 0 && !selRef.current) setSel(fila[0]!.id);
  }, [fila]);

  const executar = useCallback(
    async (acao: () => Promise<unknown>, aviso: string) => {
      setOcupada(true);
      try {
        await acao();
        aoAnunciar(aviso);
      } catch (e) {
        aoAnunciar(
          e instanceof ErroApi && e.status === 403
            ? 'Casos de exemplo são somente leitura. Envie documentos na sua sessão para operar.'
            : `Não foi possível concluir: ${mensagemDe(e)}`,
        );
        return;
      } finally {
        setOcupada(false);
      }
      await recarregar();
      if (selRef.current) await carregarDetalhe(selRef.current);
    },
    [aoAnunciar, recarregar, carregarDetalhe],
  );

  const emitirComprovante = useCallback(
    (pedidoId: string) =>
      executar(async () => {
        const r = await obterLinkComprovante(pedidoId);
        setComprovanteUrl(`${window.location.origin}${r.url}`);
      }, 'Comprovante verificável emitido.'),
    [executar],
  );

  const copiarToken = useCallback(
    async (token: string) => {
      try {
        await navigator.clipboard.writeText(token);
        aoAnunciar('Token do parceiro copiado.');
      } catch {
        aoAnunciar('Não foi possível copiar; selecione o token manualmente.');
      }
    },
    [aoAnunciar],
  );

  const casoAtual = detalhe.estado === 'ok' ? detalhe.dados.caso : null;

  return (
    <section className="op" aria-labelledby="op-titulo">
      <header className="op-cab">
        <div>
          <h1 id="op-titulo">Operação</h1>
          <p className="meta">
            Fila de exceções, cobranças de status por e-mail e métricas medidas
            dos eventos. Exemplos da seed são somente leitura.
          </p>
        </div>
      </header>

      <dl className="op-metricas" aria-label="Métricas da operação">
        {metricas.estado === 'ok' ? (
          cartoesMetricas(metricas.dados).map((c) => (
            <div key={c.rotulo} className="op-metrica">
              <dt className="meta">{c.rotulo}</dt>
              <dd className="op-metrica-valor num">{c.valor}</dd>
              {c.ajuda && <dd className="meta">{c.ajuda}</dd>}
            </div>
          ))
        ) : (
          <div className="op-metrica">
            <dt className="meta">Métricas</dt>
            <dd className="meta">
              {metricas.estado === 'carregando' ? 'Carregando…' : metricas.mensagem}
            </dd>
          </div>
        )}
      </dl>

      <div className="op-grade">
        <section className="op-col" aria-labelledby="op-fila-t">
          <h2 id="op-fila-t" className="op-col-t">
            Fila de casos
            {casos.estado === 'ok' && (
              <span className="meta num"> {fila.filter((c) => c.status !== 'resolvido').length} em aberto</span>
            )}
          </h2>
          {casos.estado === 'erro' && <p className="meta">{casos.mensagem}</p>}
          {casos.estado === 'ok' && fila.length === 0 && (
            <p className="meta">
              Nenhuma exceção até aqui. Divergências entre fontes e pendências de
              tempo abrem casos automaticamente.
            </p>
          )}
          <ol className="op-fila">
            {fila.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="op-caso"
                  data-ativo={sel === c.id ? 'true' : undefined}
                  aria-current={sel === c.id ? 'true' : undefined}
                  onClick={() => setSel(c.id)}
                >
                  <span className="op-caso-topo">
                    <span className={classeStatusCaso(c.status)}>{rotuloStatusCaso(c.status)}</span>
                    {!c.daSessao && <span className="pilula-sutil">exemplo</span>}
                    {c.daSessao && <span className="pilula-ok">sua sessão</span>}
                    <time className="meta mono num" dateTime={c.abertoEm}>
                      {formatarMomento(c.abertoEm)}
                    </time>
                  </span>
                  <span className="op-caso-titulo">{tituloCaso(c)}</span>
                  <span className="meta mono">{chaveCurta(c.pedidoId)}</span>
                </button>
              </li>
            ))}
          </ol>

          <h2 className="op-col-t">
            Cobranças de status
            {cobrancas.estado === 'ok' && (
              <span className="meta num"> {cobrancas.dados.length}</span>
            )}
          </h2>
          {cobrancas.estado === 'ok' && cobrancas.dados.length === 0 && (
            <p className="meta">
              Quando um pedido fica tempo demais parado, a pendência sugere uma
              cobrança por e-mail à transportadora.
            </p>
          )}
          <ol className="op-fila">
            {(cobrancas.estado === 'ok' ? cobrancas.dados : []).map((cb) => (
              <li key={cb.id} className="op-cobranca">
                <div className="op-caso-topo">
                  <span className={classeStatusCobranca(cb.status)}>
                    {rotuloStatusCobranca(cb.status)}
                  </span>
                  {!cb.daSessao && <span className="pilula-sutil">exemplo</span>}
                  {cb.daSessao && <span className="pilula-ok">sua sessão</span>}
                  <button
                    type="button"
                    className="botao-sutil op-link-pedido"
                    onClick={() => aoAbrirNaTorre(cb.pedidoId)}
                  >
                    <span className="mono">{chaveCurta(cb.pedidoId)}</span>
                  </button>
                </div>
                <div className="op-cobranca-corpo">
                  <span className="meta">
                    {cb.destinatario ? (
                      <>
                        <IconeEnvelope /> {cb.destinatario}
                      </>
                    ) : (
                      'Sem e-mail da transportadora na agenda'
                    )}
                  </span>
                  {cb.motivo && <span className="meta">{cb.motivo}</span>}
                </div>
                {podeEnviarCobranca(cb) && (
                  <button
                    type="button"
                    className="botao-sutil"
                    disabled={enviandoId === cb.id}
                    onClick={() => {
                      setEnviandoId(cb.id);
                      void (async () => {
                        try {
                          const r = await enviarCobranca(cb.id);
                          aoAnunciar(
                            r.cobranca?.status === 'enviada'
                              ? 'Cobrança enviada à transportadora.'
                              : `Cobrança não enviada: ${r.cobranca?.motivo ?? r.erro ?? 'motivo não informado'}.`,
                          );
                        } catch (e) {
                          aoAnunciar(`Não foi possível enviar: ${mensagemDe(e)}`);
                        } finally {
                          setEnviandoId(null);
                          void recarregar();
                        }
                      })();
                    }}
                  >
                    {cb.status === 'enviada' ? 'Reenviar' : 'Enviar cobrança'}
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>

        <section className="op-col op-detalhe" aria-labelledby="op-detalhe-t" aria-live="polite">
          <h2 id="op-detalhe-t" className="op-col-t">
            Caso em detalhe
          </h2>
          {detalhe.estado === 'carregando' && <p className="meta">Carregando…</p>}
          {detalhe.estado === 'erro' && <p className="meta">{detalhe.mensagem}</p>}
          {detalhe.estado === 'ok' && casoAtual && (
            <article className="op-card" aria-label={`Caso ${casoAtual.id}`}>
              <div className="op-caso-topo">
                <span className={classeStatusCaso(casoAtual.status)}>
                  {rotuloStatusCaso(casoAtual.status)}
                </span>
                <span className="pilula-neutra">
                  {casoAtual.origem === 'pendencia' ? 'pendência' : 'divergência'}
                </span>
                {!casoAtual.daSessao && <span className="pilula-sutil">exemplo, somente leitura</span>}
                {casoAtual.daSessao && <span className="pilula-ok">Sua sessão</span>}
              </div>

              <h3 className="op-card-titulo">{tituloCaso(casoAtual)}</h3>
              <button
                type="button"
                className="botao-sutil op-link-pedido"
                onClick={() => aoAbrirNaTorre(casoAtual.pedidoId)}
              >
                Abrir pedido <span className="mono">{chaveCurta(casoAtual.pedidoId)}</span> na torre
              </button>

              {casoAtual.divergencia && (
                <dl className="op-dupla">
                  <div>
                    <dt className="meta">{rotuloFonte(casoAtual.divergencia.fonteA)}</dt>
                    <dd className="mono">{formatarValor(casoAtual.divergencia.campo, casoAtual.divergencia.valorA)}</dd>
                  </div>
                  <div>
                    <dt className="meta">{rotuloFonte(casoAtual.divergencia.fonteB)}</dt>
                    <dd className="mono">{formatarValor(casoAtual.divergencia.campo, casoAtual.divergencia.valorB)}</dd>
                  </div>
                </dl>
              )}
              {casoAtual.pendencia?.detalhe && <p className="meta">{casoAtual.pendencia.detalhe}</p>}

              <dl className="op-fat-lista">
                <div>
                  <dt className="meta">Aberto</dt>
                  <dd className="meta mono">{formatarMomento(casoAtual.abertoEm)}</dd>
                </div>
                {casoAtual.donoPapel && (
                  <div>
                    <dt className="meta">Dono</dt>
                    <dd className="meta">{rotuloParte(casoAtual.donoPapel)}</dd>
                  </div>
                )}
                {casoAtual.ciclos > 0 && (
                  <div>
                    <dt className="meta">Reaberturas</dt>
                    <dd className="meta num">{casoAtual.ciclos}</dd>
                  </div>
                )}
                {casoAtual.resolucao && (
                  <div>
                    <dt className="meta">Resolução</dt>
                    <dd className="meta">{casoAtual.resolucao}</dd>
                  </div>
                )}
              </dl>

              {casoAtual.ultimaRespostaParceiro && (
                <div className="op-resposta-parceiro">
                  <span className={casoAtual.ultimaRespostaParceiro.acao === 'contestar' ? 'pilula-erro' : 'pilula-ok'}>
                    Parceiro: {casoAtual.ultimaRespostaParceiro.acao === 'contestar' ? 'contestou' : 'confirmou'}
                  </span>
                  {casoAtual.ultimaRespostaParceiro.texto && (
                    <p className="meta">“{casoAtual.ultimaRespostaParceiro.texto}”</p>
                  )}
                </div>
              )}

              {detalhe.dados.custo.itens.length > 0 && (
                <div className="op-custo">
                  <span className="meta">
                    Custo estimado do atraso <span className="pilula-sutil">simulação</span>
                  </span>
                  <span className="op-custo-valor num">
                    R$ {detalhe.dados.custo.valor.toLocaleString('pt-BR')}
                  </span>
                  <ul className="meta">
                    {detalhe.dados.custo.itens.map((i) => (
                      <li key={i.rotulo}>
                        {i.rotulo}: R$ {i.valor.toLocaleString('pt-BR')}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {detalhe.dados.documentos.length > 0 && (
                <div>
                  <span className="meta">Documentos do pedido</span>
                  <ul className="op-docs meta mono">
                    {detalhe.dados.documentos.map((doc) => (
                      <li key={doc}>{doc}</li>
                    ))}
                  </ul>
                </div>
              )}

              {!casoAtual.daSessao && (
                <p className="meta">
                  Casos de exemplo são somente leitura. Para testar as ações, envie um
                  documento na sua sessão: a divergência ou pendência dele abre um caso seu
                  aqui na fila.
                </p>
              )}

              {casoAtual.daSessao && casoAtual.status !== 'resolvido' && (
                <div className="op-acoes">
                  {casoAtual.status !== 'atribuido' && (
                    <div className="op-acao">
                      <label className="meta" htmlFor="op-parte">
                        Assumir como
                      </label>
                      <div className="op-acao-linha">
                        <select
                          id="op-parte"
                          value={parteSel}
                          onChange={(e) => setParteSel(e.target.value as Parte)}
                        >
                          {PARTES.map((p) => (
                            <option key={p} value={p}>
                              {rotuloParte(p)}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          className="botao"
                          disabled={ocupada}
                          onClick={() =>
                            void executar(
                              () => assumirCaso(casoAtual.id, parteSel),
                              `Caso assumido por ${rotuloParte(parteSel)}.`,
                            )
                          }
                        >
                          Assumir
                        </button>
                      </div>
                    </div>
                  )}
                  <div className="op-acao">
                    <label className="meta" htmlFor="op-resolucao">
                      Resolver com nota
                    </label>
                    <div className="op-acao-linha op-acao-linha-texto">
                      <input
                        id="op-resolucao"
                        type="text"
                        maxLength={2000}
                        placeholder="Ex.: nova data confirmada com o cliente"
                        value={textoResolucao}
                        onChange={(e) => setTextoResolucao(e.target.value)}
                      />
                      <button
                        type="button"
                        className="botao"
                        disabled={ocupada}
                        onClick={() =>
                          void executar(async () => {
                            await resolverCaso(casoAtual.id, textoResolucao.trim());
                            setTextoResolucao('');
                          }, 'Caso resolvido.')
                        }
                      >
                        Resolver
                      </button>
                    </div>
                  </div>
                </div>
              )}
              {casoAtual.daSessao && (casoAtual.status === 'resolvido' || casoAtual.status === 'contestado') && (
                <button
                  type="button"
                  className="botao-sutil"
                  disabled={ocupada}
                  onClick={() => void executar(() => reabrirCaso(casoAtual.id), 'Caso reaberto.')}
                >
                  Reabrir caso
                </button>
              )}

              {casoAtual.daSessao && casoAtual.tokenParceiro && casoAtual.status !== 'resolvido' && (
                <div className="op-parceiro">
                  <span className="meta">
                    Link do parceiro (token opaco — quem o tem responde sem login)
                  </span>
                  <div className="op-acao-linha">
                    <code className="mono op-token">{casoAtual.tokenParceiro}</code>
                    <button
                      type="button"
                      className="botao-sutil"
                      onClick={() => void copiarToken(casoAtual.tokenParceiro!)}
                    >
                      Copiar
                    </button>
                  </div>
                  <details className="op-parceiro-demo">
                    <summary className="meta">Responder como parceiro (demonstração do link)</summary>
                    <div className="op-acao op-parceiro-form">
                      <input
                        type="text"
                        maxLength={2000}
                        aria-label="Texto da resposta do parceiro"
                        placeholder="Ex.: a previsão nova é dia 30, atraso no pátio"
                        value={textoParceiro}
                        onChange={(e) => setTextoParceiro(e.target.value)}
                      />
                      <div className="op-acao-linha">
                        <button
                          type="button"
                          className="botao-sutil"
                          disabled={ocupada}
                          onClick={() =>
                            void executar(async () => {
                              await responderComoParceiro(casoAtual.id, {
                                token: casoAtual.tokenParceiro!,
                                acao: 'confirmar',
                                texto: textoParceiro.trim() || undefined,
                              });
                              setTextoParceiro('');
                            }, 'Parceiro confirmou o caso.')
                          }
                        >
                          Confirmar
                        </button>
                        <button
                          type="button"
                          className="botao-sutil"
                          disabled={ocupada}
                          onClick={() =>
                            void executar(async () => {
                              await responderComoParceiro(casoAtual.id, {
                                token: casoAtual.tokenParceiro!,
                                acao: 'contestar',
                                texto: textoParceiro.trim() || 'valor declarado não é nosso',
                              });
                              setTextoParceiro('');
                            }, 'Parceiro contestou o caso.')
                          }
                        >
                          Contestar
                        </button>
                      </div>
                    </div>
                  </details>
                </div>
              )}

              <div className="op-comprovante">
                <button
                  type="button"
                  className="botao-sutil"
                  disabled={ocupada}
                  onClick={() => void emitirComprovante(casoAtual.pedidoId)}
                >
                  <IconeComprovante />
                  <span>Emitir comprovante verificável</span>
                </button>
                {comprovanteUrl && (
                  <p className="meta">
                    <a href={comprovanteUrl} target="_blank" rel="noreferrer" className="mono">
                      Abrir comprovante
                    </a>{' '}
                    — cadeia, declarações e âncora conferíveis por terceiros, sem sessão.
                  </p>
                )}
              </div>
            </article>
          )}
          {detalhe.estado === 'ok' && !casoAtual && fila.length === 0 && (
            <p className="meta">Selecione um caso na fila para operar.</p>
          )}
        </section>
      </div>
    </section>
  );
}
