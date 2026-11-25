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
  // Largura atual em colunas do masonry e o máximo que cabe (cols do grid).
  span: number;
  spanMax: number;
  ordemI: number;
  recolhido: boolean;
  arrastando: boolean;
  pecaRef?: (el: HTMLElement | null) => void;
  medidaRef?: (el: HTMLElement | null) => void;
  handleProps: TorreCardHandleProps;
  aoCiclarSpan: (id: CardId, delta: number) => void;
  aoAlternarRecolhido: (id: CardId) => void;
  // Posição/tamanho calculados pelo packing (transform/width/height).
  estilo?: CSSProperties;
  children: ReactNode;
}

// Casca comum dos cards do masonry: a <section> ocupa a posição calculada pelo
// packing (transform/width/height vêm do layout e transicionam em CSS) e a
// .torre-card-peca interna é o que voa no arraste. A .torre-card-medida mede a
// altura natural do conteúdo — é ela que alimenta o packing via ResizeObserver.
export const TorreCard = forwardRef<HTMLElement, TorreCardProps>(function TorreCard(
  { id, titulo, tituloId, span, spanMax, ordemI, recolhido, arrastando, pecaRef, medidaRef, handleProps, aoCiclarSpan, aoAlternarRecolhido, estilo, children },
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
      style={{ '--ordem-i': ordemI, ...estilo } as CSSProperties}
    >
      <div ref={pecaRef} className="torre-card-peca" data-lifted={arrastando ? 'true' : undefined}>
        <div ref={medidaRef} className="torre-card-medida" data-card-medida={id}>
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
            {spanMax > 1 && (
              <button
                type="button"
                className="torre-span"
                data-largo={span > 1 ? 'true' : undefined}
                aria-label={`Largura do card ${titulo}: ${span} de ${spanMax} colunas. Clique cicla; setas esquerda e direita ajustam.`}
                aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                title={`Largura ${span}/${spanMax} — clique para ciclar`}
                onClick={() => aoCiclarSpan(id, 1)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); aoCiclarSpan(id, -1); }
                  else if (e.key === 'ArrowRight') { e.preventDefault(); aoCiclarSpan(id, 1); }
                  else if (e.key === 'Home') { e.preventDefault(); aoCiclarSpan(id, -spanMax); }
                  else if (e.key === 'End') { e.preventDefault(); aoCiclarSpan(id, spanMax); }
                }}
              >
                <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
                  <path
                    d="M2 8h12M10.5 4.5 14 8l-3.5 3.5M5.5 4.5 2 8l3.5 3.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="torre-span-n">{span}×</span>
              </button>
            )}
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
      </div>
    </section>
  );
});
