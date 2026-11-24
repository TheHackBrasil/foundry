import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
} from 'react';
import {
  CAMPOS_VIGIADOS,
  type CampoVigiado,
  type ProjecaoPedido,
  type RespostaAuditoria,
  type ResultadoAncora,
  type VersaoPedido,
} from '../../../shared/model.ts';
import { ErroApi } from '../api.ts';
import { ancorarPedido, garantirEstilosOps } from '../apiOps.ts';
import { copiarTexto } from '../copiar.ts';
import {
  chaveCurta,
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  variacao,
} from '../format.ts';
import {
  IconeConfere,
  IconeCopiar,
  IconeDiverge,
  IconeErro,
  IconeFechar,
  IconeOk,
  IconeSeta,
} from './icones.tsx';

export interface DrawerAuditoriaProps {
  aberto: boolean;
  pedidoId: string;
  daSessao: boolean;
  auditoria: RespostaAuditoria | null;
  projecao: ProjecaoPedido | null;
  carregando?: boolean;
  aoFechar: () => void;
  aoVerificar?: () => void;
  aoAncorado?: (resultado: ResultadoAncora) => void;
  aoAutoForkEAncorar?: () => Promise<void> | void;
  aoAnunciar?: (texto: string) => void;
}

interface CampoDiffVersao {
  campo: CampoVigiado;
  valor: unknown;
  anterior?: unknown;
  mudou: boolean;
  delta: string | null;
}

interface ItemVersaoDiff {
  versao: VersaoPedido;
  campos: CampoDiffVersao[];
}

function lerStringSegura(obj: Record<string, unknown> | null | undefined, chave: string): string | null {
  if (!obj) return null;
  const v = obj[chave];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

function urlHttpSegura(url: string | null): string | null {
  if (!url) return null;
  return /^https?:\/\//i.test(url) ? url : null;
}

function focoElementos(container: HTMLElement): HTMLElement[] {
  const seletores =
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';
  return Array.from(container.querySelectorAll<HTMLElement>(seletores)).filter(
    (el) => el.offsetParent !== null,
  );
}

export function DrawerAuditoria({
  aberto,
  pedidoId,
  daSessao,
  auditoria,
  projecao,
  carregando = false,
  aoFechar,
  aoVerificar,
  aoAncorado,
  aoAutoForkEAncorar,
  aoAnunciar,
}: DrawerAuditoriaProps) {
  const tituloId = useId();
  const painelRef = useRef<HTMLDivElement>(null);
  const fecharBtnRef = useRef<HTMLButtonElement>(null);
  const triggerAnteriorRef = useRef<HTMLElement | null>(null);
  const copiaTimerRef = useRef<number | null>(null);
  const aoFecharRef = useRef(aoFechar);
  aoFecharRef.current = aoFechar;

  const [copiadoChave, setCopiadoChave] = useState<string | null>(null);
  const [ancorando, setAncorando] = useState(false);
  const [ancoraRecente, setAncoraRecente] = useState<ResultadoAncora | null>(null);
  const [statusAncora, setStatusAncora] = useState<{
    tipo: 'ok' | 'warn' | 'erro';
    texto: string;
  } | null>(null);

  useEffect(() => {
    garantirEstilosOps();
  }, []);

  useEffect(
    () => () => {
      if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    setAncoraRecente(null);
    setStatusAncora(null);
  }, [pedidoId]);

  useEffect(() => {
    if (!aberto) return;
    triggerAnteriorRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const anteriorOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const focoFrame = window.requestAnimationFrame(() => {
      fecharBtnRef.current?.focus();
    });

    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        aoFecharRef.current();
        return;
      }
      if (e.key === 'Tab' && painelRef.current) {
        const focaveis = focoElementos(painelRef.current);
        if (focaveis.length === 0) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis.at(-1);
        if (e.shiftKey && document.activeElement === primeiro) {
          e.preventDefault();
          ultimo?.focus();
        } else if (!e.shiftKey && document.activeElement === ultimo) {
          e.preventDefault();
          primeiro?.focus();
        }
      }
    };

    document.addEventListener('keydown', aoTecla);
    return () => {
      window.cancelAnimationFrame(focoFrame);
      document.removeEventListener('keydown', aoTecla);
      document.body.style.overflow = anteriorOverflow;
      triggerAnteriorRef.current?.focus({ preventScroll: true });
    };
  }, [aberto]);

  const diffVersoes = useMemo<ItemVersaoDiff[]>(() => {
    const lista = [...(projecao?.versoes ?? [])].sort((a, b) => a.versao - b.versao);
    const vistos = new Map<CampoVigiado, unknown>();
    return lista.map((versao) => {
      const campos: CampoDiffVersao[] = [];
      for (const campo of CAMPOS_VIGIADOS) {
        const valor = versao.campos[campo];
        if (valor === undefined) continue;
        const anterior = vistos.get(campo);
        const mudou = anterior !== undefined && String(anterior) !== String(valor);
        const delta = mudou ? variacao(campo, valor, anterior) : null;
        campos.push({
          campo,
          valor,
          ...(anterior !== undefined ? { anterior } : {}),
          mudou,
          delta,
        });
        vistos.set(campo, valor);
      }
      return { versao, campos };
    });
  }, [projecao?.versoes]);

  async function copiar(chave: string, valor: string, rotulo: string) {
    if (!(await copiarTexto(valor))) return;
    setCopiadoChave(chave);
    aoAnunciar?.(`${rotulo} copiada.`);
    if (copiaTimerRef.current !== null) window.clearTimeout(copiaTimerRef.current);
    copiaTimerRef.current = window.setTimeout(() => {
      setCopiadoChave(null);
      copiaTimerRef.current = null;
    }, 1800);
  }

  async function dispararAncoragem() {
    if (ancorando) return;
    setAncorando(true);
    setStatusAncora(null);
    try {
      if (!daSessao) {
        if (aoAutoForkEAncorar) {
          await aoAutoForkEAncorar();
          const msg = 'Pedido copiado para sua sessão e enviado para ancoragem na Base Sepolia.';
          setStatusAncora({ tipo: 'ok', texto: msg });
          aoAnunciar?.(msg);
          aoVerificar?.();
        } else {
          const msg =
            'Pedido de exemplo é somente leitura. Carregue os exemplos na sua sessão para ancorar na Base Sepolia.';
          setStatusAncora({ tipo: 'warn', texto: msg });
          aoAnunciar?.(msg);
        }
        return;
      }

      const r = await ancorarPedido(pedidoId);
      setAncoraRecente(r);
      if (r.ok) {
        const msg = 'Raiz Merkle ancorada na Base Sepolia com sucesso.';
        setStatusAncora({ tipo: 'ok', texto: msg });
        aoAnunciar?.(msg);
        aoAncorado?.(r);
        aoVerificar?.();
      } else {
        const msg = r.motivo
          ? `Ancoragem não concluída: ${r.motivo}. A cadeia local de hashes segue íntegra.`
          : 'Ancoragem não concluída nesta instalação. A cadeia local de hashes segue íntegra.';
        setStatusAncora({ tipo: 'warn', texto: msg });
        aoAnunciar?.(msg);
      }
    } catch (err) {
      if (err instanceof ErroApi && err.status === 403 && aoAutoForkEAncorar) {
        try {
          await aoAutoForkEAncorar();
          const msg = 'Pedido copiado para sua sessão e enviado para ancoragem.';
          setStatusAncora({ tipo: 'ok', texto: msg });
          aoAnunciar?.(msg);
          aoVerificar?.();
          return;
        } catch (errFork) {
          const msgFork =
            errFork instanceof Error ? errFork.message : 'Falha ao ancorar na sua sessão.';
          setStatusAncora({ tipo: 'erro', texto: msgFork });
          aoAnunciar?.(msgFork);
          return;
        }
      }
      const msg = err instanceof Error ? err.message : 'Falha ao ancorar na Base Sepolia.';
      setStatusAncora({ tipo: 'erro', texto: msg });
      aoAnunciar?.(msg);
    } finally {
      setAncorando(false);
    }
  }

  if (!aberto) return null;

  const ancoraOk = ancoraRecente?.ok ? ancoraRecente : null;
  const urlAncora = urlHttpSegura(ancoraOk?.url ?? lerStringSegura(auditoria?.ancora, 'url'));
  const txHashAncora = ancoraOk?.txHash ?? lerStringSegura(auditoria?.ancora, 'txHash');
  const rootAncorada =
    auditoria?.rootHistorico ?? ancoraOk?.root ?? lerStringSegura(auditoria?.ancora, 'root');
  const redeAncora = lerStringSegura(auditoria?.ancora, 'rede') ?? 'Base Sepolia';
  const temAncora = Boolean(auditoria?.ancora || ancoraOk);
  const eventosAposAncora =
    auditoria &&
    auditoria.eventosAncorados !== null &&
    auditoria.total > auditoria.eventosAncorados
      ? auditoria.total - auditoria.eventosAncorados
      : 0;

  return (
    <div
      className="drawer-backdrop"
      onClick={(e: MouseEvent<HTMLDivElement>) => {
        if (e.target === e.currentTarget) aoFechar();
      }}
    >
      <div
        ref={painelRef}
        className="drawer-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={tituloId}
      >
        <header className="drawer-cab">
          <div style={{ display: 'grid', gap: '0.25rem' }}>
            <div className="palco-cab-linha">
              <h2 id={tituloId}>Auditoria e âncora</h2>
              <span className="pilula-sutil mono">{chaveCurta(pedidoId)}</span>
            </div>
            <p className="meta">
              Verificação criptográfica da cadeia, Raiz Merkle e evolução das versões recebidas.
            </p>
          </div>

          <button
            ref={fecharBtnRef}
            type="button"
            className="botao-fechar"
            onClick={aoFechar}
            aria-label="Fechar auditoria do pedido"
          >
            <IconeFechar />
          </button>
        </header>

        <div className="drawer-corpo">
          <section className="drawer-card" aria-label="Integridade da cadeia de eventos">
            <div className="palco-bloco-cab">
              <div className="palco-cab-linha">
                {!auditoria ? (
                  <span className="pilula-sutil">Aguardando verificação</span>
                ) : auditoria.valida ? (
                  <span className="pilula-ok">
                    <IconeOk />
                    Cadeia íntegra
                  </span>
                ) : (
                  <span className="pilula-erro">
                    <IconeErro />
                    Cadeia adulterada
                  </span>
                )}
                {auditoria && (
                  <span className="meta num">
                    {auditoria.total} {auditoria.total === 1 ? 'evento' : 'eventos'} verificados
                  </span>
                )}
              </div>

              {aoVerificar && (
                <button
                  type="button"
                  className="botao-sutil"
                  disabled={carregando}
                  onClick={aoVerificar}
                >
                  {carregando ? 'Verificando…' : 'Verificar de novo'}
                </button>
              )}
            </div>

            {auditoria && !auditoria.valida && (
              <div role="alert" style={{ display: 'grid', gap: '0.375rem' }}>
                <p className="aviso-erro" style={{ fontSize: '0.875rem' }}>
                  Falha no evento nº {(auditoria.indiceFalha ?? 0) + 1} de {auditoria.total}: hash
                  recalculado não confere com o registro.
                </p>
                {auditoria.hashEsperado && (
                  <p className="meta mono" style={{ overflowWrap: 'anywhere' }}>
                    Esperado: {auditoria.hashEsperado}
                  </p>
                )}
                {auditoria.hashEncontrado && (
                  <p className="meta mono" style={{ overflowWrap: 'anywhere' }}>
                    Encontrado: {auditoria.hashEncontrado}
                  </p>
                )}
              </div>
            )}

            {auditoria && (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div className="domino-no-topo">
                  <strong style={{ fontSize: '0.84375rem' }}>Raiz Merkle atual</strong>
                  <button
                    type="button"
                    className={copiadoChave === 'rootAtual' ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'}
                    onClick={() => void copiar('rootAtual', auditoria.rootAtual, 'Raiz Merkle atual')}
                    aria-label={
                      copiadoChave === 'rootAtual'
                        ? 'Raiz Merkle atual copiada'
                        : 'Copiar Raiz Merkle atual'
                    }
                  >
                    {copiadoChave === 'rootAtual' ? <IconeConfere /> : <IconeCopiar />}
                    <span>{copiadoChave === 'rootAtual' ? 'Copiada' : 'Copiar'}</span>
                  </button>
                </div>
                <div className="drawer-hash">{auditoria.rootAtual}</div>
              </div>
            )}
          </section>

          <section className="drawer-card" aria-label="Âncora on-chain na Base Sepolia">
            <div className="palco-bloco-cab">
              <strong style={{ fontSize: '0.9375rem' }}>Âncora on-chain ({redeAncora})</strong>
              {temAncora ? (
                <span
                  className={
                    auditoria?.rootConfere === false ? 'pilula-erro' : 'pilula-ok'
                  }
                >
                  {auditoria?.rootConfere === false ? <IconeErro /> : <IconeOk />}
                  {auditoria?.rootConfere === false
                    ? 'Raiz diverge da âncora'
                    : 'Raiz histórica conferida'}
                </span>
              ) : (
                <span className="pilula-sutil">Âncora pendente</span>
              )}
            </div>

            {temAncora && rootAncorada ? (
              <div style={{ display: 'grid', gap: '0.5rem' }}>
                <div className="domino-no-topo">
                  <span className="meta num">
                    Raiz ancorada
                    {auditoria?.eventosAncorados !== null && auditoria?.eventosAncorados !== undefined
                      ? ` · cobre ${auditoria.eventosAncorados} de ${auditoria.total} eventos`
                      : ''}
                  </span>
                  <button
                    type="button"
                    className={
                      copiadoChave === 'rootHistorico' ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'
                    }
                    onClick={() => void copiar('rootHistorico', rootAncorada, 'Raiz ancorada')}
                  >
                    {copiadoChave === 'rootHistorico' ? <IconeConfere /> : <IconeCopiar />}
                    <span>{copiadoChave === 'rootHistorico' ? 'Copiada' : 'Copiar'}</span>
                  </button>
                </div>
                <div className="drawer-hash">{rootAncorada}</div>

                {txHashAncora && (
                  <div className="domino-no-topo" style={{ flexWrap: 'wrap' }}>
                    <span className="meta mono" style={{ overflowWrap: 'anywhere' }}>
                      Tx: {txHashAncora}
                    </span>
                    <button
                      type="button"
                      className={copiadoChave === 'txHash' ? 'btn-copiar btn-copiar-ok' : 'btn-copiar'}
                      onClick={() => void copiar('txHash', txHashAncora, 'Hash da transação')}
                    >
                      {copiadoChave === 'txHash' ? <IconeConfere /> : <IconeCopiar />}
                      <span>{copiadoChave === 'txHash' ? 'Copiado' : 'Copiar tx'}</span>
                    </button>
                  </div>
                )}

                {eventosAposAncora > 0 && (
                  <p className="meta">
                    {eventosAposAncora}{' '}
                    {eventosAposAncora === 1 ? 'novo evento entrou' : 'novos eventos entraram'} após
                    a última âncora. A raiz histórica continua válida; ancore novamente para incluir
                    os eventos recentes.
                  </p>
                )}
              </div>
            ) : (
              <p className="dica">
                Nenhuma transação registrada para este pedido ainda. Ancorar grava a Raiz Merkle
                atual no contrato FoundryAnchor na Base Sepolia.
              </p>
            )}

            {!daSessao && (
              <p className="meta">
                {aoAutoForkEAncorar
                  ? 'Pedido de exemplo (somente leitura): ao ancorar, clonaremos o pedido na sua sessão.'
                  : 'Pedido de exemplo é somente leitura: carregue os exemplos na sua sessão para ancorar.'}
              </p>
            )}

            {statusAncora && (
              <div
                role={statusAncora.tipo === 'erro' ? 'alert' : 'status'}
                className={
                  statusAncora.tipo === 'ok'
                    ? 'pilula-ok'
                    : statusAncora.tipo === 'warn'
                      ? 'pilula-warn'
                      : 'pilula-erro'
                }
                style={{ whiteSpace: 'normal' }}
              >
                {statusAncora.tipo === 'ok' ? <IconeOk /> : <IconeErro />}
                <span>{statusAncora.texto}</span>
              </div>
            )}

            <div className="despacho-acoes">
              <button
                type="button"
                className="cmd-btn-enviar"
                disabled={ancorando}
                onClick={() => void dispararAncoragem()}
              >
                {ancorando ? (
                  <>
                    <span className="cmd-spinner" aria-hidden="true" />
                    Ancorando na Base Sepolia…
                  </>
                ) : (
                  'Ancorar na Base Sepolia'
                )}
              </button>

              {urlAncora && (
                <a
                  href={urlAncora}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="botao-sutil"
                  style={{ textDecoration: 'none' }}
                >
                  Ver transação no BaseScan ↗
                </a>
              )}
            </div>
          </section>

          <section className="drawer-card" aria-label="Diff real de versões do pedido">
            <div className="palco-bloco-cab">
              <strong style={{ fontSize: '0.9375rem' }}>Diff real de versões</strong>
              <span className="meta num">
                {diffVersoes.length} {diffVersoes.length === 1 ? 'documento' : 'documentos'}
              </span>
            </div>

            {diffVersoes.length === 0 ? (
              <p className="dica">Nenhuma versão recebida neste pedido ainda.</p>
            ) : (
              <ol style={{ display: 'grid', gap: '0.75rem' }}>
                {diffVersoes.map(({ versao, campos }) => (
                  <li
                    key={`${versao.fonte}-${versao.versao}`}
                    style={{
                      display: 'grid',
                      gap: '0.4375rem',
                      paddingTop: '0.625rem',
                      borderTop: '1px solid var(--hairline)',
                    }}
                  >
                    <div className="domino-no-topo">
                      <div className="palco-cab-linha">
                        <span className="pilula-neutra mono num">v{versao.versao}</span>
                        <strong>{rotuloFonte(versao.fonte)}</strong>
                      </div>
                      <time className="meta mono" dateTime={versao.geradaEm}>
                        {formatarMomento(versao.geradaEm)}
                      </time>
                    </div>

                    {campos.length === 0 ? (
                      <p className="meta">Nenhum campo vigiado declarado neste documento.</p>
                    ) : (
                      <ul style={{ display: 'grid', gap: '0.3125rem' }}>
                        {campos.map((c) => (
                          <li
                            key={c.campo}
                            className="palco-cab-linha"
                            style={{ fontSize: '0.84375rem' }}
                          >
                            <span className="meta" style={{ minWidth: '8.5rem' }}>
                              {rotuloCampo(c.campo)}
                            </span>
                            <strong className="num">{formatarValor(c.campo, c.valor)}</strong>
                            {c.mudou && c.anterior !== undefined && (
                              <>
                                <span className="meta num">
                                  antes <s>{formatarValor(c.campo, c.anterior)}</s>
                                </span>
                                {c.delta ? (
                                  <span className="delta-pilula num">
                                    <IconeSeta />
                                    {c.delta}
                                  </span>
                                ) : (
                                  <span className="pilula-coord">
                                    <IconeDiverge />
                                    Alterado
                                  </span>
                                )}
                              </>
                            )}
                            {!c.mudou && c.anterior === undefined && (
                              <span className="pilula-sutil">Inicial</span>
                            )}
                            {!c.mudou && c.anterior !== undefined && (
                              <span className="pilula-ok">
                                <IconeConfere />
                                Confirma
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
