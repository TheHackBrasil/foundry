import type { RefObject } from 'react';
import type { Contato } from '../../../shared/model.ts';
import type { PedidoResumo } from '../api.ts';
import type { Tema } from '../tema.ts';
import type { RotaTorre } from '../useTorre.ts';
import { BuscaUniversal } from './BuscaUniversal.tsx';
import {
  IconeAgenda,
  IconeAssistente,
  IconeLua,
  IconeMenu,
  IconeRevisao,
  IconeSol,
  IconeTorre,
} from './icones.tsx';
import { Marca } from './Marca.tsx';

interface Props {
  rota: RotaTorre;
  pedidoId: string | null;
  pedidos: readonly PedidoResumo[];
  contatos: readonly Contato[];
  revisaoPendentes: number;
  aoAbrirRevisao: () => void;
  aoAbrirAgenda: () => void;
  aoAbrirAssistente: (comando?: string) => void;
  aoAbrirMenuMobile: () => void;
  menuMobileAberto: boolean;
  menuBtnRef?: RefObject<HTMLButtonElement | null>;
  tema: Tema;
  aoTema: (tema: Tema) => void;
}

export function Cabecalho({
  rota,
  pedidoId,
  pedidos,
  contatos,
  revisaoPendentes,
  aoAbrirRevisao,
  aoAbrirAgenda,
  aoAbrirAssistente,
  aoAbrirMenuMobile,
  menuMobileAberto,
  menuBtnRef,
  tema,
  aoTema,
}: Props) {
  const hrefAlterno =
    rota === 'torre'
      ? pedidoId
        ? `#/ia/${encodeURIComponent(pedidoId)}`
        : '#/ia'
      : pedidoId
        ? `#/pedido/${encodeURIComponent(pedidoId)}`
        : '#/';

  const hrefTorre = pedidoId ? `#/pedido/${encodeURIComponent(pedidoId)}` : '#/';

  return (
    <header className="topo">
      <div className="topo-esq">
        <button
          ref={menuBtnRef}
          type="button"
          className="topo-menu-btn topo-so-mobile"
          aria-label="Abrir navegação e pedidos"
          aria-expanded={menuMobileAberto}
          aria-controls="painel-lateral"
          onClick={aoAbrirMenuMobile}
        >
          <IconeMenu />
        </button>

        <a href={hrefTorre} className="topo-marca-mobile topo-so-mobile" aria-label="Forseti · Torre operacional">
          <Marca tema={tema} />
          <span className="topo-nome-mobile">Forseti</span>
        </a>

        <div className="topo-ops topo-so-desktop">
          <button
            type="button"
            className="topo-btn"
            onClick={aoAbrirRevisao}
            aria-label={
              revisaoPendentes > 0
                ? `Fila de revisão, ${revisaoPendentes} ${revisaoPendentes === 1 ? 'pendente' : 'pendentes'}`
                : 'Fila de revisão'
            }
          >
            <IconeRevisao />
            <span>Revisão</span>
            {revisaoPendentes > 0 && (
              <span className="topo-cont num">{revisaoPendentes}</span>
            )}
          </button>
          <button type="button" className="topo-btn" onClick={aoAbrirAgenda}>
            <IconeAgenda />
            <span>Agenda</span>
          </button>
        </div>
      </div>

      <div className="topo-acoes">
        <button
          type="button"
          className="topo-btn topo-so-mobile topo-btn-compacto"
          onClick={aoAbrirRevisao}
          aria-label={
            revisaoPendentes > 0
              ? `Fila de revisão, ${revisaoPendentes} ${revisaoPendentes === 1 ? 'pendente' : 'pendentes'}`
              : 'Fila de revisão'
          }
        >
          <IconeRevisao />
          {revisaoPendentes > 0 && <span className="topo-cont num">{revisaoPendentes}</span>}
        </button>

        <a
          href={hrefAlterno}
          className="topo-btn topo-so-mobile topo-atalho-rota"
        >
          {rota === 'torre' ? (
            <>
              <IconeAssistente />
              <span>IA</span>
            </>
          ) : (
            <>
              <IconeTorre />
              <span>Torre</span>
            </>
          )}
        </a>

        <BuscaUniversal
          pedidos={pedidos}
          contatos={contatos}
          rota={rota}
          aoAbrirAgenda={aoAbrirAgenda}
          aoPerguntarIA={aoAbrirAssistente}
        />

        <div className="tema" role="group" aria-label="Tema" data-tema-ativo={tema}>
          <span className="tema-pill" aria-hidden="true" />
          <button type="button" aria-pressed={tema === 'light'} onClick={() => aoTema('light')}>
            <IconeSol />
            <span>Claro</span>
          </button>
          <button type="button" aria-pressed={tema === 'dark'} onClick={() => aoTema('dark')}>
            <IconeLua />
            <span>Escuro</span>
          </button>
        </div>
      </div>
    </header>
  );
}
