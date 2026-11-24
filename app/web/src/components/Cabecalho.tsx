import type { RefObject } from 'react';
import type { Tema } from '../tema.ts';
import type { EstadoStream } from '../useStream.ts';
import type { RotaTorre } from '../useTorre.ts';
import {
  IconeAgenda,
  IconeAssistente,
  IconeMenu,
  IconePausa,
  IconeRetomar,
  IconeRevisao,
  IconeTorre,
} from './icones.tsx';
import { Marca } from './Marca.tsx';

const ROTULO_STREAM: Record<EstadoStream, string> = {
  conectando: 'Conectando…',
  ao_vivo: 'Ao vivo',
  reconectando: 'Reconectando…',
};

interface Props {
  rota: RotaTorre;
  pedidoId: string | null;
  stream: EstadoStream;
  pulsoEventoSeq: number;
  pausado: boolean;
  pendentes: number;
  revisaoPendentes: number;
  aoPausar: () => void;
  aoAbrirRevisao: () => void;
  aoAbrirAgenda: () => void;
  aoAbrirMenuMobile: () => void;
  menuMobileAberto: boolean;
  menuBtnRef?: RefObject<HTMLButtonElement | null>;
  tema: Tema;
  aoTema: (tema: Tema) => void;
}

export function Cabecalho({
  rota,
  pedidoId,
  stream,
  pulsoEventoSeq,
  pausado,
  pendentes,
  revisaoPendentes,
  aoPausar,
  aoAbrirRevisao,
  aoAbrirAgenda,
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
          <span className="topo-contexto">
            {rota === 'ia' ? 'Assistente IA' : 'Torre operacional'}
          </span>
          <span className="topo-divisoria" aria-hidden="true" />
          <button
            type="button"
            className={revisaoPendentes > 0 ? 'topo-btn topo-btn-alerta' : 'topo-btn'}
            onClick={aoAbrirRevisao}
            aria-label={
              revisaoPendentes > 0
                ? `Fila de revisão, ${revisaoPendentes} ${revisaoPendentes === 1 ? 'pendente' : 'pendentes'}`
                : 'Fila de revisão'
            }
          >
            <IconeRevisao />
            <span>Revisão</span>
            <span className={revisaoPendentes > 0 ? 'topo-cont topo-cont-alerta num' : 'topo-cont num'}>
              {revisaoPendentes}
            </span>
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
          className={
            revisaoPendentes > 0
              ? 'topo-btn topo-btn-alerta topo-so-mobile topo-btn-compacto'
              : 'topo-btn topo-so-mobile topo-btn-compacto'
          }
          onClick={aoAbrirRevisao}
          aria-label={
            revisaoPendentes > 0
              ? `Fila de revisão, ${revisaoPendentes} ${revisaoPendentes === 1 ? 'pendente' : 'pendentes'}`
              : 'Fila de revisão'
          }
        >
          <IconeRevisao />
          {revisaoPendentes > 0 && <span className="topo-cont topo-cont-alerta num">{revisaoPendentes}</span>}
        </button>

        <a href={hrefAlterno} className="topo-btn topo-so-mobile topo-atalho-rota">
          {rota === 'torre' ? <IconeAssistente /> : <IconeTorre />}
          <span>{rota === 'torre' ? 'IA' : 'Torre'}</span>
        </a>

        <p className={`vivo topo-so-desktop ${pausado ? 'vivo-pausado' : `vivo-${stream}`}`}>
          <span className="vivo-ponto" aria-hidden="true">
            {pulsoEventoSeq > 0 && !pausado && stream === 'ao_vivo' && (
              <span key={pulsoEventoSeq} className="vivo-pulso-unico" />
            )}
          </span>
          <span>
            {pausado
              ? `Pausado${pendentes > 0 ? ` · ${pendentes}` : ''}`
              : ROTULO_STREAM[stream]}
          </span>
        </p>

        <button
          type="button"
          className="topo-btn topo-so-desktop"
          onClick={aoPausar}
          aria-label={pausado ? 'Retomar atualizações ao vivo' : 'Pausar atualizações ao vivo'}
        >
          {pausado ? <IconeRetomar /> : <IconePausa />}
          <span>{pausado ? 'Retomar' : 'Pausar'}</span>
        </button>

        <div className="tema" role="group" aria-label="Tema">
          <button type="button" aria-pressed={tema === 'light'} onClick={() => aoTema('light')}>
            Claro
          </button>
          <button type="button" aria-pressed={tema === 'dark'} onClick={() => aoTema('dark')}>
            Escuro
          </button>
        </div>
      </div>
    </header>
  );
}
