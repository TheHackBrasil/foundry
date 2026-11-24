import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  IconePausa,
  IconeRetomar,
  IconeTorre,
} from './components/icones.tsx';
import { Marca } from './components/Marca.tsx';
import { PaginaAssistenteIA } from './components/PaginaAssistenteIA.tsx';
import { PainelPedido } from './components/PainelPedido.tsx';
import { PedidoLista } from './components/PedidoLista.tsx';
import { rotuloMotivoNotificacao, rotuloParte } from './format.ts';
import { aplicarTema, temaInicial, type Tema } from './tema.ts';
import { useTorre } from './useTorre.ts';

export function App() {
  const torre = useTorre();
  const [tema, setTema] = useState<Tema>(temaInicial);
  const [menuMobileAberto, setMenuMobileAberto] = useState(false);
  const [revisaoAberto, setRevisaoAberto] = useState(false);
  const [agendaEstado, setAgendaEstado] = useState<{ aberto: boolean; parteInicial?: Parte }>({
    aberto: false,
  });
  const [auditoriaAberto, setAuditoriaAberto] = useState(false);
  const [comandoInicialIA, setComandoInicialIA] = useState<string | null>(null);
  const [focoPendenteTorre, setFocoPendenteTorre] = useState<AlvoFocoGenUI | null>(null);

  const menuBtnRef = useRef<HTMLButtonElement | null>(null);
  const fecharMenuBtnRef = useRef<HTMLButtonElement | null>(null);

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

  const selecionarAposEnvio = useCallback(
    (pedidoId: string) => {
      torre.selecionar(pedidoId);
      void torre.recarregarLista();
      setMenuMobileAberto(false);
    },
    [torre.selecionar, torre.recarregarLista],
  );

  const abrirAgenda = useCallback((parte?: Parte) => {
    setMenuMobileAberto(false);
    setAgendaEstado(parte ? { aberto: true, parteInicial: parte } : { aberto: true });
  }, []);

  const abrirRevisao = useCallback(() => {
    setMenuMobileAberto(false);
    setRevisaoAberto(true);
  }, []);

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

  const drawerModalAberto = revisaoAberto || agendaEstado.aberto || auditoriaAberto;
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
          aria-label="Navegação principal, pedidos e ingestão"
        >
          <div className="rail-topo">
            <div className="rail-marca-grupo">
              <div className="rail-marca">
                <Marca tema="dark" />
                <span className="rail-nome">Forseti</span>
              </div>
              <span className="rail-selo">Dados sintéticos</span>
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

          <nav className="rail-nav" aria-label="Navegação principal">
            <a
              href={hrefTorre}
              className="rail-nav-link"
              aria-current={torre.rota === 'torre' ? 'page' : undefined}
              onClick={fecharMenuMobile}
            >
              <IconeTorre />
              <span>Torre operacional</span>
            </a>
            <a
              href={hrefIA}
              className="rail-nav-link"
              aria-current={torre.rota === 'ia' ? 'page' : undefined}
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

          <EnvioArquivos
            aoEnviar={selecionarAposEnvio}
            aoAbrirRevisao={abrirRevisao}
            aoAtualizarRevisao={() => void torre.recarregarAuxiliares()}
          />

          <div className="rail-mobile-ops">
            <button type="button" className="rail-op-btn" onClick={() => abrirAgenda()}>
              <IconeAgenda />
              <span>Agenda de contatos</span>
            </button>
            <button
              type="button"
              className="rail-op-btn"
              onClick={() => {
                torre.alternarPausa();
                fecharMenuMobile();
              }}
            >
              {torre.pausado ? <IconeRetomar /> : <IconePausa />}
              <span>{torre.pausado ? 'Retomar ao vivo' : 'Pausar ao vivo'}</span>
            </button>
          </div>
        </aside>

        <div className="palco-coluna" inert={menuMobileAberto || undefined}>
          <Cabecalho
            rota={torre.rota}
            pedidoId={torre.selecionado}
            stream={torre.estadoStream}
            pulsoEventoSeq={torre.pulsoEventoSeq}
            pausado={torre.pausado}
            pendentes={torre.pendentes}
            revisaoPendentes={torre.revisaoPendentes}
            aoPausar={torre.alternarPausa}
            aoAbrirRevisao={abrirRevisao}
            aoAbrirAgenda={() => abrirAgenda()}
            aoAbrirMenuMobile={() => setMenuMobileAberto((a) => !a)}
            menuMobileAberto={menuMobileAberto}
            menuBtnRef={menuBtnRef}
            tema={tema}
            aoTema={trocarTema}
          />

          <main id="conteudo" tabIndex={-1} data-rota={torre.rota}>
            {torre.rota === 'ia' ? (
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
                  Envie uma NF-e em XML no monólito lateral. O Forseti compara o que cada fonte
                  declara, aponta divergências e gera tarefas por setor.
                </p>
              </section>
            )}
          </main>
        </div>
      </div>

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
