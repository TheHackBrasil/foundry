import { useMemo, useRef, useState } from 'react';
import type { PedidoResumo } from '../api.ts';
import { chaveCurta, formatarMomento } from '../format.ts';
import { useIndicadorDeslizante } from '../useIndicadorDeslizante.ts';
import type { Carga, RotaTorre } from '../useTorre.ts';

interface Props {
  pedidos: Carga<PedidoResumo[]>;
  selecionado: string | null;
  rota: RotaTorre;
  aoTentarDeNovo: () => void;
  aoSelecionarMobile?: () => void;
}

function temConflito(p: PedidoResumo): boolean {
  return (p.divergencias ?? 0) > 0 || (p.atrasoDias ?? 0) > 0 || p.status === 'cancelada';
}

function seloOperacional(p: PedidoResumo): { texto: string; classe: string; mono?: boolean } {
  if (p.status === 'cancelada') {
    return { texto: 'Cancelada', classe: 'rail-badge-erro' };
  }
  if (typeof p.atrasoDias === 'number' && p.atrasoDias > 0) {
    return { texto: `+${p.atrasoDias}d`, classe: 'rail-badge-coord', mono: true };
  }
  const divs = p.divergencias ?? 0;
  if (divs > 0) {
    return {
      texto: `${divs} ${divs === 1 ? 'desvio' : 'desvios'}`,
      classe: 'rail-badge-coord',
      mono: true,
    };
  }
  return { texto: 'Confere', classe: 'rail-badge-ok' };
}

function sufixoChave(id: string): string {
  return id.length > 8 ? `…${id.slice(-6)}` : id;
}

export function PedidoLista({
  pedidos,
  selecionado,
  rota,
  aoTentarDeNovo,
  aoSelecionarMobile,
}: Props) {
  const [soConflito, setSoConflito] = useState(false);
  const filtroRef = useRef<HTMLDivElement>(null);

  const listaCompleta = pedidos.estado === 'ok' ? pedidos.dados : [];
  const totalConflitos = useMemo(
    () => listaCompleta.filter(temConflito).length,
    [listaCompleta],
  );
  const visiveis = useMemo(
    () => (soConflito ? listaCompleta.filter(temConflito) : listaCompleta),
    [listaCompleta, soConflito],
  );

  const filtroGeo = useIndicadorDeslizante(
    filtroRef,
    '[aria-pressed="true"]',
    `${soConflito ? '1' : '0'}-${totalConflitos}-${listaCompleta.length}`,
  );

  return (
    <section className="lista" aria-labelledby="lista-titulo">
      <div className="lista-cab">
        <h2 id="lista-titulo">Pedidos ativos</h2>
        {pedidos.estado === 'ok' && listaCompleta.length > 0 && (
          <div ref={filtroRef} className="rail-filtro" role="group" aria-label="Filtrar pedidos">
            {filtroGeo.pronto && (
              <span
                className="rail-filtro-thumb"
                aria-hidden="true"
                data-animar={filtroGeo.animar ? 'true' : 'false'}
                style={{
                  clipPath: `inset(${filtroGeo.clipTop}px ${filtroGeo.clipRight}px ${filtroGeo.clipBottom}px ${filtroGeo.clipLeft}px round 999px)`,
                }}
              />
            )}
            <button
              type="button"
              aria-pressed={!soConflito}
              onClick={() => setSoConflito(false)}
            >
              Todos
            </button>
            <button
              type="button"
              aria-pressed={soConflito}
              onClick={() => setSoConflito(true)}
            >
              Conflitos{totalConflitos > 0 ? ` (${totalConflitos})` : ''}
            </button>
          </div>
        )}
      </div>

      {pedidos.estado === 'carregando' && <p className="dica">Carregando pedidos…</p>}

      {pedidos.estado === 'erro' && (
        <div className="aviso-erro" role="alert">
          <p>Não foi possível carregar os pedidos: {pedidos.mensagem}</p>
          <button type="button" className="botao" onClick={aoTentarDeNovo}>
            Tentar de novo
          </button>
        </div>
      )}

      {pedidos.estado === 'ok' && listaCompleta.length === 0 && (
        <p className="dica">Nenhum pedido ainda. Envie uma NF-e em XML para criar o primeiro.</p>
      )}

      {pedidos.estado === 'ok' && listaCompleta.length > 0 && visiveis.length === 0 && (
        <div className="lista-vazio-filtro">
          <p className="dica">Nenhum pedido com conflito aberto.</p>
          <button
            type="button"
            className="rail-btn-sutil"
            onClick={() => setSoConflito(false)}
          >
            Mostrar todos
          </button>
        </div>
      )}

      {pedidos.estado === 'ok' && visiveis.length > 0 && (
        <nav aria-label="Lista de pedidos">
          <ul className="lista-itens">
            {visiveis.map((p) => {
              const selo = seloOperacional(p);
              const emitente = p.emitente?.trim();
              const destinatario = p.destinatario?.trim();
              const href =
                rota === 'ia'
                  ? `#/ia/${encodeURIComponent(p.pedidoId)}`
                  : `#/pedido/${encodeURIComponent(p.pedidoId)}`;

              return (
                <li key={p.pedidoId}>
                  <a
                    href={href}
                    aria-current={p.pedidoId === selecionado ? 'page' : undefined}
                    title={emitente ? `${emitente} · ${p.pedidoId}` : p.pedidoId}
                    onClick={aoSelecionarMobile}
                  >
                    <div className="lista-item-topo">
                      <span className={emitente ? 'lista-emitente' : 'lista-emitente mono'}>
                        {emitente ?? chaveCurta(p.pedidoId)}
                      </span>
                      <span
                        className={`rail-badge num ${selo.mono ? 'mono ' : ''}${selo.classe}`}
                      >
                        {selo.texto}
                      </span>
                    </div>

                    <div className="lista-sub">
                      {destinatario ? (
                        <span className="lista-dest">→ {destinatario}</span>
                      ) : (
                        <span className="lista-dest">{formatarMomento(p.ultimoEm)}</span>
                      )}
                      <span className="lista-chave mono">{sufixoChave(p.pedidoId)}</span>
                    </div>
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </section>
  );
}
