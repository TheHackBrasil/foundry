import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AlvoFocoGenUI, CampoVigiado, Parte } from '../../shared/model.ts';
import { ErroApi } from './api.ts';
import { ancorarPedido, notificarDireto } from './apiOps.ts';
import { Cabecalho } from './components/Cabecalho.tsx';
import { DrawerAgenda } from './components/DrawerAgenda.tsx';
import { DrawerAuditoria } from './components/DrawerAuditoria.tsx';
import { DrawerRevisao } from './components/DrawerRevisao.tsx';
import { EnvioArquivos } from './components/EnvioArquivos.tsx';
import {
  IconeAgenda,
  IconeAssistente,
  IconeFechar,
  IconeMais,
  IconeTorre,
} from './components/icones.tsx';
import { Marca } from './components/Marca.tsx';
import { PaginaAssistenteIA } from './components/PaginaAssistenteIA.tsx';
import { PainelPedido } from './components/PainelPedido.tsx';
import { PedidoLista } from './components/PedidoLista.tsx';
import { IconeOperacao } from './operacao/icones.tsx';
import { PaginaOperacao } from './operacao/PaginaOperacao.tsx';
import { chaveCurta, rotuloMotivoNotificacao, rotuloParte } from './format.ts';
import { aplicarTema, temaInicial, type Tema } from './tema.ts';
import { useIndicadorDeslizante } from './useIndicadorDeslizante.ts';
import { usePresencaAnimada } from './usePresencaAnimada.ts';
import { useTorre } from './useTorre.ts';

export function App() {
  const torre = useTorre();
  // #/operacao (spec 0011, T533): rota lida aqui e não em useTorre, que
  // pertence a outra frente — o hash vive inteiro neste componente.
  const [rotaOperacao, setRotaOperacao] = useState(() =>
    window.location.hash.startsWith('#/operacao'),
  );
  const rotaEfetiva = rotaOperacao ? 'operacao' : torre.rota;
  const [tema, setTema] = useState<Tema>(temaInicial);
  const [menuMobileAberto, setMenuMobileAberto] = useState(false);
  const [revisaoAberto, setRevisaoAberto] = useState(false);
  const [agendaEstado, setAgendaEstado] = useState<{ aberto: boolean; parteInicial?: Parte }>({
    aberto: false,
  });
  const [auditoriaAberto, setAuditoriaAberto] = useState(false);
  const [envioAberto, setEnvioAberto] = useState(false);
  const [comandoInicialIA, setComandoInicialIA] = useState<string | null>(null);
  const [focoPendenteTorre, setFocoPendenteTorre] = useState<AlvoFocoGenUI | null>(null);

  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const fecharMenuBtnRef = useRef<HTMLButtonElement | null>(null);
  const envioBtnRef = useRef<HTMLButtonElement | null>(null);
  const fecharEnvioBtnRef = useRef<HTMLButtonElement | null>(null);
  const railNavRef = useRef<HTMLElement | null>(null);

  const navIndicador = useIndicadorDeslizante(railNavRef, '[aria-current="page"]', rotaEfetiva);
  const presencaEnvio = usePresencaAnimada(envioAberto, 200);

  const trocarTema = (t: Tema) => {
    aplicarTema(t);
    setTema(t);
  };

  const listaPedidos = torre.pedidos.estado === 'ok' ? torre.pedidos.dados : [];
  const vazio = torre.pedidos.estado === 'ok' && listaPedidos.length === 0;
  const pedidoAtualResumo = useMemo(
    () => (torre.selecionado ? listaPedidos.find((p) => p.pedidoId === torre.selecionado) : undefined),
    [listaPedidos, torre.selecionado],
  );
  const daSessaoAtual = Boolean(pedidoAtualResumo?.daSessao);

  const fecharMenuMobile = useCallback(() => {
    setMenuMobileAberto(false);
  }, []);

  // Mantém a rota #/operacao em sincronia com a barra de endereço.
  useEffect(() => {
    const aoMudar = () => setRotaOperacao(window.location.hash.startsWith('#/operacao'));
    window.addEventListener('hashchange', aoMudar);
    return () => window.removeEventListener('hashchange', aoMudar);
  }, []);

  // Gerencia foco, Escape e bloqueio de rolagem da gaveta lateral em telas estreitas.
  useEffect(() => {
    if (!menuMobileAberto) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      fecharMenuBtnRef.current?.focus();
    });
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuMobileAberto(false);
      }
    };
    const aoRedimensionar = () => {
      if (window.innerWidth > 960) setMenuMobileAberto(false);
    };
    document.addEventListener('keydown', aoTecla);
    window.addEventListener('resize', aoRedimensionar);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', aoTecla);
      window.removeEventListener('resize', aoRedimensionar);
      document.body.style.overflow = prevOverflow;
      menuBtnRef.current?.focus({ preventScroll: true });
    };
  }, [menuMobileAberto]);

  const fecharEnvioModal = useCallback(() => {
    setEnvioAberto(false);
  }, []);

  // Gerencia foco, Escape e bloqueio de rolagem do modal de envio de documentos.
  useEffect(() => {
    if (!envioAberto) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = window.requestAnimationFrame(() => {
      fecharEnvioBtnRef.current?.focus();
    });
    const aoTecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setEnvioAberto(false);
      }
    };
    document.addEventListener('keydown', aoTecla);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener('keydown', aoTecla);
      document.body.style.overflow = prevOverflow;
      envioBtnRef.current?.focus({ preventScroll: true });
    };
  }, [envioAberto]);

  const selecionarAposEnvio = useCallback(
    (pedidoId: string) => {
      torre.selecionar(pedidoId);
      void torre.recarregarLista();
      setMenuMobileAberto(false);
      setEnvioAberto(false);
    },
    [torre.selecionar, torre.recarregarLista],
  );

  const abrirAgenda = useCallback((parte?: Parte) => {
    setMenuMobileAberto(false);
    setEnvioAberto(false);
    setAgendaEstado(parte ? { aberto: true, parteInicial: parte } : { aberto: true });
  }, []);

  const abrirRevisao = useCallback(() => {
    setMenuMobileAberto(false);
    setEnvioAberto(false);
    setRevisaoAberto(true);
  }, []);

  const encaminharParaRevisao = useCallback(
    (revisaoId: number, nomeArquivo: string) => {
      setEnvioAberto(false);
      setMenuMobileAberto(false);
      setRevisaoAberto(true);
      void torre.recarregarAuxiliares();
      torre.anunciar(`${nomeArquivo} encaminhado para a Fila de Revisão (#${revisaoId}).`);
    },
    [torre.anunciar, torre.recarregarAuxiliares],
  );

  const abrirAssistente = useCallback(
    (comando?: string) => {
      if (comando?.trim()) setComandoInicialIA(comando.trim());
      torre.irParaAssistente(torre.selecionado);
    },
    [torre.irParaAssistente, torre.selecionado],
  );

  const notificarComAutoFork = useCallback(
    async (pedidoId: string, parte: Parte, campo?: CampoVigiado): Promise<void> => {
      let alvo = pedidoId;
      const resumo = listaPedidos.find((p) => p.pedidoId === pedidoId);
      if (!resumo?.daSessao) {
        const clonado = await torre.garantirPedidoNaSessao(pedidoId);
        if (clonado) alvo = clonado;
      }

      let res;
      try {
        res = await notificarDireto(alvo, parte, campo);
      } catch (err) {
        if (err instanceof ErroApi && err.status === 403) {
          const clonado = await torre.garantirPedidoNaSessao(pedidoId);
          if (!clonado) throw err;
          res = await notificarDireto(clonado, parte, campo);
        } else {
          throw err;
        }
      }

      await torre.recarregarPedidoAtual();

      if (res.status === 'nao_entregue') {
        const msg = res.motivo
          ? rotuloMotivoNotificacao(res.motivo)
          : `Aviso não entregue para ${rotuloParte(parte)}.`;
        torre.anunciar(msg);
        throw new Error(msg);
      }
      torre.anunciar(`Aviso enviado para ${rotuloParte(parte)}.`);
    },
    [listaPedidos, torre.anunciar, torre.garantirPedidoNaSessao, torre.recarregarPedidoAtual],
  );

  const ancorarComAutoFork = useCallback(async (): Promise<void> => {
    const atualId = torre.selecionado;
    if (!atualId) return;

    let alvo = atualId;
    if (!daSessaoAtual) {
      const clonado = await torre.garantirPedidoNaSessao(atualId);
      if (!clonado) {
        torre.anunciar('Não foi possível preparar sua sessão para ancorar este pedido.');
        return;
      }
      alvo = clonado;
    }

    const r = await ancorarPedido(alvo);
    await torre.recarregarLista();
    await torre.verificarDeNovo();
    if (r.ok) {
      torre.anunciar('Raiz Merkle ancorada na Base Sepolia.');
    } else {
      torre.anunciar(
        r.motivo
          ? `Ancoragem não concluída: ${r.motivo}. A cadeia local segue íntegra.`
          : 'Ancoragem não concluída nesta instalação. A cadeia local segue íntegra.',
      );
    }
  }, [
    daSessaoAtual,
    torre.anunciar,
    torre.garantirPedidoNaSessao,
    torre.recarregarLista,
    torre.selecionado,
    torre.verificarDeNovo,
  ]);

  const drawerModalAberto =
    revisaoAberto || agendaEstado.aberto || auditoriaAberto || envioAberto;
  const hrefTorre = torre.selecionado
    ? `#/pedido/${encodeURIComponent(torre.selecionado)}`
    : '#/';
  const hrefIA = torre.selecionado ? `#/ia/${encodeURIComponent(torre.selecionado)}` : '#/ia';

  return (
    <>
      <a
        className="pular"
        href="#conteudo"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('conteudo')?.focus();
        }}
      >
        Ir para o conteúdo
      </a>

      <div className="app-shell" inert={drawerModalAberto || undefined}>
        {menuMobileAberto && (
          <div
            className="lateral-backdrop"
            aria-hidden="true"
            onClick={fecharMenuMobile}
          />
        )}

        <aside
          id="painel-lateral"
          className="lateral"
          data-aberta={menuMobileAberto ? 'true' : 'false'}
          aria-label="Navegação principal e pedidos ativos"
        >
          <div className="rail-corpo">
            <div className="rail-topo">
              <div className="rail-marca-grupo">
                <div className="rail-marca">
                  <Marca tema="dark" />
                  <span className="rail-nome">Forseti</span>
                </div>
              </div>

              <button
                ref={fecharMenuBtnRef}
                type="button"
                className="rail-fechar-mobile"
                aria-label="Fechar menu lateral"
                onClick={fecharMenuMobile}
              >
                <IconeFechar />
              </button>
            </div>

            <nav ref={railNavRef} className="rail-nav" aria-label="Navegação principal">
              {navIndicador.pronto && (
                <span
                  className="rail-nav-indicador"
                  aria-hidden="true"
                  data-animar={navIndicador.animar ? 'true' : 'false'}
                  style={
                    {
                      '--ny': `${navIndicador.y}px`,
                      '--nh': `${navIndicador.altura}px`,
                    } as CSSProperties
                  }
                />
              )}
              <a
                href={hrefTorre}
                className="rail-nav-link"
                aria-current={rotaEfetiva === 'torre' ? 'page' : undefined}
                onClick={fecharMenuMobile}
              >
                <IconeTorre />
                <span>Torre operacional</span>
              </a>
              <a
                href="#/operacao"
                className="rail-nav-link"
                aria-current={rotaEfetiva === 'operacao' ? 'page' : undefined}
                onClick={fecharMenuMobile}
              >
                <IconeOperacao />
                <span>Operação</span>
              </a>
              <a
                href={hrefIA}
                className="rail-nav-link"
                aria-current={rotaEfetiva === 'ia' ? 'page' : undefined}
                onClick={fecharMenuMobile}
              >
                <IconeAssistente />
                <span>Assistente IA</span>
              </a>
            </nav>

            <PedidoLista
              pedidos={torre.pedidos}
              selecionado={torre.selecionado}
              rota={torre.rota}
              aoTentarDeNovo={torre.recarregarLista}
              aoSelecionarMobile={fecharMenuMobile}
            />
          </div>

          <div className="rail-rodape">
            <button
              ref={envioBtnRef}
              type="button"
              className="rail-btn-enviar"
              onClick={() => {
                setMenuMobileAberto(false);
                setEnvioAberto(true);
              }}
            >
              <IconeMais />
              <span>Enviar documento</span>
            </button>

            <div className="rail-mobile-ops">
              <button type="button" className="rail-op-btn" onClick={() => abrirAgenda()}>
                <IconeAgenda />
                <span>Agenda de contatos</span>
              </button>
            </div>
          </div>
        </aside>

        <div className="palco-coluna" inert={menuMobileAberto || undefined}>
          <Cabecalho
            rota={torre.rota}
            pedidoId={torre.selecionado}
            revisaoPendentes={torre.revisaoPendentes}
            aoAbrirRevisao={abrirRevisao}
            aoAbrirAgenda={() => abrirAgenda()}
            aoAbrirMenuMobile={() => setMenuMobileAberto((a) => !a)}
            menuMobileAberto={menuMobileAberto}
            menuBtnRef={menuBtnRef}
            tema={tema}
            aoTema={trocarTema}
          />

          <main id="conteudo" tabIndex={-1} data-rota={rotaEfetiva}>
            <div key={rotaEfetiva} className="rota-palco" data-rota={rotaEfetiva}>
              {rotaOperacao ? (
                <PaginaOperacao
                  aoAnunciar={torre.anunciar}
                  aoAbrirNaTorre={torre.irParaTorre}
                  pulsoEventoSeq={torre.pulsoEventoSeq}
                />
              ) : torre.rota === 'ia' ? (
                <PaginaAssistenteIA
                  pedidos={listaPedidos}
                  pedidoId={torre.selecionado}
                  projecao={torre.projecao}
                  contatos={torre.contatos}
                  comandoInicial={comandoInicialIA}
                  aoConsumirComandoInicial={() => setComandoInicialIA(null)}
                  aoSelecionarPedido={torre.selecionar}
                  aoAbrirNaTorre={(pid, foco) => {
                    setFocoPendenteTorre(foco ?? null);
                    torre.irParaTorre(pid);
                  }}
                  aoAbrirAgenda={abrirAgenda}
                  aoGarantirSessao={torre.garantirPedidoNaSessao}
                  aoNotificar={notificarComAutoFork}
                  aoRecarregarPedido={torre.recarregarPedidoAtual}
                  aoAnunciar={torre.anunciar}
                />
              ) : torre.selecionado ? (
                <PainelPedido
                  key={torre.selecionado}
                  id={torre.selecionado}
                  daSessao={daSessaoAtual}
                  projecao={torre.projecao}
                  auditoria={torre.auditoria}
                  contatos={torre.contatos}
                  novas={torre.novas}
                  pulsoEventoSeq={torre.pulsoEventoSeq}
                  focoInicial={focoPendenteTorre}
                  aoConsumirFocoInicial={() => setFocoPendenteTorre(null)}
                  aoVerificar={torre.verificarDeNovo}
                  aoAbrirAuditoria={() => setAuditoriaAberto(true)}
                  aoAncorar={ancorarComAutoFork}
                  aoAbrirAgenda={abrirAgenda}
                  aoAbrirAssistente={abrirAssistente}
                  aoGarantirSessao={torre.garantirPedidoNaSessao}
                  aoNotificar={(parte, campo) =>
                    notificarComAutoFork(torre.selecionado!, parte, campo)
                  }
                  aoRecarregarPedido={torre.recarregarPedidoAtual}
                  aoAnunciar={torre.anunciar}
                  aoSelecionar={selecionarAposEnvio}
                />
              ) : (
                <section aria-labelledby="vazio-titulo" className="vazio">
                  <h1 id="vazio-titulo">{vazio ? 'Nada para mostrar ainda' : 'Escolha um pedido'}</h1>
                  <p className="dica">
                    Envie uma NF-e, CT-e, planilha ou e-mail. O Forseti compara o que cada fonte
                    declara, aponta divergências e gera tarefas por setor.
                  </p>
                  {listaPedidos.length > 0 && (
                    <nav aria-label="Pedidos disponíveis" style={{ width: '100%' }}>
                      <ul
                        style={{
                          listStyle: 'none',
                          margin: '0.25rem 0 0',
                          padding: 0,
                          display: 'grid',
                          gap: '0.375rem',
                          width: '100%',
                          maxWidth: '34rem',
                        }}
                      >
                        {listaPedidos.slice(0, 8).map((p) => {
                          const emitente = p.emitente?.trim() || chaveCurta(p.pedidoId);
                          const divs = p.divergencias ?? 0;
                          const selo =
                            p.status === 'cancelada'
                              ? 'Cancelada'
                              : (p.atrasoDias ?? 0) > 0
                                ? `+${p.atrasoDias}d de atraso`
                                : divs > 0
                                  ? `${divs} ${divs === 1 ? 'desvio' : 'desvios'}`
                                  : 'Consistente';
                          return (
                            <li key={p.pedidoId}>
                              <a
                                href={`#/pedido/${encodeURIComponent(p.pedidoId)}`}
                                style={{
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'space-between',
                                  gap: '0.75rem',
                                  padding: '0.6875rem 0.875rem',
                                  border: '1px solid var(--border)',
                                  borderRadius: 'var(--r-md)',
                                  background: 'var(--surface)',
                                  color: 'var(--text)',
                                  textDecoration: 'none',
                                }}
                              >
                                <span
                                  style={{
                                    fontWeight: 600,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                    minWidth: 0,
                                  }}
                                >
                                  {emitente}
                                </span>
                                <span
                                  style={{
                                    color: 'var(--text2)',
                                    fontSize: '0.8125rem',
                                    flexShrink: 0,
                                    whiteSpace: 'nowrap',
                                  }}
                                >
                                  {selo} · …{p.pedidoId.slice(-6)}
                                </span>
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                      {listaPedidos.length > 8 && (
                        <p className="dica" style={{ fontSize: '0.8125rem', marginTop: '0.375rem' }}>
                          Mais {listaPedidos.length - 8} pedidos na lista lateral.
                        </p>
                      )}
                    </nav>
                  )}
                  <button
                    type="button"
                    className="botao vazio-acao"
                    onClick={() => setEnvioAberto(true)}
                  >
                    <IconeMais />
                    <span>Enviar documento</span>
                  </button>
                </section>
              )}
            </div>
          </main>
        </div>
      </div>

      {presencaEnvio.montado && (
        <div
          className="modal-backdrop"
          data-fase={presencaEnvio.fase}
          onClick={(e) => {
            if (e.target === e.currentTarget) fecharEnvioModal();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-envio-titulo"
            className="modal-envio slab-mineral"
            data-fase={presencaEnvio.fase}
          >
            <header className="modal-envio-cab">
              <div>
                <h2 id="modal-envio-titulo">Enviar documento</h2>
                <p className="meta">
                  Faça upload ou dispare um exemplo real para comparar fontes e gerar tarefas.
                </p>
              </div>
              <button
                ref={fecharEnvioBtnRef}
                type="button"
                className="botao-fechar"
                aria-label="Fechar envio de documentos"
                onClick={fecharEnvioModal}
              >
                <IconeFechar />
              </button>
            </header>
            <div className="modal-envio-corpo">
              <EnvioArquivos
                emModal
                aoEnviar={selecionarAposEnvio}
                aoAbrirRevisao={abrirRevisao}
                aoEncaminharRevisao={encaminharParaRevisao}
                aoAtualizarRevisao={() => void torre.recarregarAuxiliares()}
              />
            </div>
          </div>
        </div>
      )}

      <DrawerRevisao
        aberto={revisaoAberto}
        aoFechar={() => setRevisaoAberto(false)}
        aoAtualizar={() => {
          void torre.recarregarPedidoAtual();
          void torre.recarregarAuxiliares();
        }}
        aoAnunciar={torre.anunciar}
      />

      <DrawerAgenda
        aberto={agendaEstado.aberto}
        {...(agendaEstado.parteInicial ? { parteInicial: agendaEstado.parteInicial } : {})}
        aoFechar={() => setAgendaEstado({ aberto: false })}
        aoSalvar={() => {
          void torre.recarregarAuxiliares();
        }}
        aoAnunciar={torre.anunciar}
      />

      <DrawerAuditoria
        aberto={auditoriaAberto && Boolean(torre.selecionado)}
        pedidoId={torre.selecionado ?? ''}
        daSessao={daSessaoAtual}
        auditoria={torre.auditoria.estado === 'ok' ? torre.auditoria.dados : null}
        projecao={torre.projecao.estado === 'ok' ? torre.projecao.dados : null}
        carregando={torre.auditoria.estado === 'carregando'}
        aoFechar={() => setAuditoriaAberto(false)}
        aoVerificar={() => void torre.verificarDeNovo()}
        aoAncorado={() => {
          void torre.recarregarLista();
          void torre.verificarDeNovo();
        }}
        aoAutoForkEAncorar={ancorarComAutoFork}
        aoAnunciar={torre.anunciar}
      />

      <div className="so-leitor" role="status" aria-live="polite" aria-atomic="true">
        {torre.anuncio}
      </div>
    </>
  );
}
