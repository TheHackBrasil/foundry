import {
  forwardRef,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { CardId } from './layout.ts';

export interface TorreCardHandleProps {
  onPointerDown: (e: PointerEvent<HTMLButtonElement>, id: CardId) => void;
  onPointerMove: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, id: CardId) => void;
}

interface TorreCardProps {
  id: CardId;
  titulo: string;
  tituloId: string;
  span: number;
  ordemI: number;
  recolhido: boolean;
  arrastando: boolean;
  pecaRef?: (el: HTMLElement | null) => void;
  handleProps: TorreCardHandleProps;
  aoAlternarRecolhido: (id: CardId) => void;
  children: ReactNode;
}

// Casca comum dos cards do tiling: a <section> é o slot no grid (fica parada e
// mostra o contorno de destino) e a .torre-card-peca interna é o que voa no
// arraste — medir a section dá sempre a posição comprometida, sem transform.
export const TorreCard = forwardRef<HTMLElement, TorreCardProps>(function TorreCard(
  { id, titulo, tituloId, span, ordemI, recolhido, arrastando, pecaRef, handleProps, aoAlternarRecolhido, children },
  ref,
) {
  const corpoId = `torre-corpo-${id}`;
  return (
    <section
      ref={ref}
      className={`torre-card tc-${id} slab-mineral`}
      data-torre-card={id}
      data-arrastando={arrastando ? 'true' : undefined}
      data-recolhido={recolhido ? 'true' : undefined}
      aria-labelledby={tituloId}
      style={{ '--span-card': span, '--ordem-i': ordemI } as CSSProperties}
    >
      <div ref={pecaRef} className="torre-card-peca" data-lifted={arrastando ? 'true' : undefined}>
        <div className="torre-card-cab">
          <button
            type="button"
            className="torre-arraste"
            aria-label={`Mover card ${titulo}. Setas reordenam; Home e End levam ao início ou ao fim.`}
            aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
            onPointerDown={(e) => handleProps.onPointerDown(e, id)}
            onPointerMove={handleProps.onPointerMove}
            onPointerUp={handleProps.onPointerUp}
            onPointerCancel={handleProps.onPointerCancel}
            onKeyDown={(e) => handleProps.onKeyDown(e, id)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <circle cx="5.5" cy="3.5" r="1.35" fill="currentColor" />
              <circle cx="10.5" cy="3.5" r="1.35" fill="currentColor" />
              <circle cx="5.5" cy="8" r="1.35" fill="currentColor" />
              <circle cx="10.5" cy="8" r="1.35" fill="currentColor" />
              <circle cx="5.5" cy="12.5" r="1.35" fill="currentColor" />
              <circle cx="10.5" cy="12.5" r="1.35" fill="currentColor" />
            </svg>
          </button>
          <h2 id={tituloId} className="torre-card-titulo" tabIndex={-1}>
            {titulo}
          </h2>
          <button
            type="button"
            className="torre-toggle"
            aria-expanded={!recolhido}
            aria-controls={corpoId}
            aria-label={recolhido ? `Expandir card ${titulo}` : `Recolher card ${titulo}`}
            title={recolhido ? `Expandir ${titulo}` : `Recolher ${titulo}`}
            onClick={() => aoAlternarRecolhido(id)}
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
              <path
                d="m4.5 6 3.5 3.5L11.5 6"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
        <div className="torre-card-corpo" id={corpoId}>
          <div className="torre-card-corpo-inner">{children}</div>
        </div>
      </div>
    </section>
  );
});
