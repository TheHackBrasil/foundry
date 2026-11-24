import type { PedidoResumo } from '../api.ts';
import type { Carga } from '../useTorre.ts';
import { chaveCurta, formatarMomento } from '../format.ts';

interface Props {
  pedidos: Carga<PedidoResumo[]>;
  selecionado: string | null;
  aoTentarDeNovo: () => void;
}

export function PedidoLista({ pedidos, selecionado, aoTentarDeNovo }: Props) {
  return (
    <section className="lista" aria-labelledby="lista-titulo">
      <h2 id="lista-titulo">Pedidos</h2>
      {pedidos.estado === 'carregando' && <p className="dica">Carregando pedidos…</p>}
      {pedidos.estado === 'erro' && (
        <div className="aviso-erro" role="alert">
          <p>Não foi possível carregar os pedidos: {pedidos.mensagem}</p>
          <button type="button" className="botao" onClick={aoTentarDeNovo}>
            Tentar de novo
          </button>
        </div>
      )}
      {pedidos.estado === 'ok' && pedidos.dados.length === 0 && (
        <p className="dica">Nenhum pedido ainda. Envie uma NF-e em XML para criar o primeiro.</p>
      )}
      {pedidos.estado === 'ok' && pedidos.dados.length > 0 && (
        <nav aria-label="Lista de pedidos">
          <ul className="lista-itens">
            {pedidos.dados.map((p) => (
              <li key={p.pedidoId}>
                <a
                  href={`#/pedido/${encodeURIComponent(p.pedidoId)}`}
                  aria-current={p.pedidoId === selecionado ? 'page' : undefined}
                  title={p.pedidoId}
                >
                  <div className="lista-item-topo">
                    <span className="mono">{chaveCurta(p.pedidoId)}</span>
                    {p.daSessao && <span className="pilula-rail">Sessão</span>}
                  </div>
                  <span className="meta num">
                    {p.totalEventos} {p.totalEventos === 1 ? 'evento' : 'eventos'} · {formatarMomento(p.ultimoEm)}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </section>
  );
}
