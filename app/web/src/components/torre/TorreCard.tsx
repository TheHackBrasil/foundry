import {
  forwardRef,
  useEffect,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import type { CardId } from './layout.ts';

export interface TorreCardHandleProps {
  onPointerDown: (e: PointerEvent<HTMLButtonElement>, id: CardId) => void;
  onKeyDown: (e: KeyboardEvent<HTMLButtonElement>, id: CardId) => void;
  // Borda direita arrastável (resize de janela): opcional para consumidores
  // que só usam mover/teclado. A affordance acessível do mesmo mecanismo é o
  // separator .torre-span no cabeçalho — este handle é aria-hidden.
  onResizeDown?: (e: PointerEvent<HTMLDivElement>, id: CardId) => void;
}

interface TorreCardProps {
  id: CardId;
  titulo: string;
  tituloId: string;
  // Largura renderizada em colunas do masonry (pós-elástico) e o máximo que
  // cabe (cols do grid).
  span: number;
  spanMax: number;
  ordemI: number;
  recolhido: boolean;
  arrastando: boolean;
  pecaRef?: (el: HTMLElement | null) => void;
  medidaRef?: (el: HTMLElement | null) => void;
  handleProps: TorreCardHandleProps;
  // ciclar=true: clique avança com wrap; ciclar=false: alvo absoluto clampado
  // (setas do splitter nunca dão a volta — APG window splitter).
  aoAjustarSpan: (id: CardId, alvo: number, ciclar: boolean) => void;
  aoAlternarRecolhido: (id: CardId) => void;
  // Posição/tamanho calculados pelo packing (transform/width/height).
  estilo?: CSSProperties;
  children: ReactNode;
}

// Casca comum dos cards do masonry: a <section> ocupa a posição calculada pelo
// packing (transform/width/height vêm do layout e transicionam em CSS) e a
// .torre-card-peca interna é o que voa no arraste. A .torre-card-medida mede a
// altura natural do conteúdo — é ela que alimenta o packing via ResizeObserver.
// A animação de entrada é mount-only: a classe .torre-entra sai no
// animationend (ou assim que um arraste começa) e nunca volta, então nenhuma
// mudança de estado a reinicia.
export const TorreCard = forwardRef<HTMLElement, TorreCardProps>(function TorreCard(
  { id, titulo, tituloId, span, spanMax, ordemI, recolhido, arrastando, pecaRef, medidaRef, handleProps, aoAjustarSpan, aoAlternarRecolhido, estilo, children },
  ref,
) {
  const corpoId = `torre-corpo-${id}`;
  // O clique cicla com wrap (mesmo cálculo de aoAjustarSpan na grade): o hint
  // ao lado do Nx mostra esse próximo passo sem precisar clicar nem pairar.
  const proximoSpan = span >= spanMax ? 1 : span + 1;
  const [entrando, setEntrando] = useState(true);
  // Em voo a peça segue o pointer por transform inline — a keyframe de entrada
  // sai na hora para não disputar a propriedade com o gesto.
  useEffect(() => {
    if (arrastando) setEntrando(false);
  }, [arrastando]);
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
      <div
        ref={pecaRef}
        className={entrando ? 'torre-card-peca torre-entra' : 'torre-card-peca'}
        data-lifted={arrastando ? 'true' : undefined}
        onAnimationEnd={(e) => {
          if (e.animationName === 'torre-card-entra' || e.animationName === 'torre-card-entra-fade') {
            setEntrando(false);
          }
        }}
      >
        <div ref={medidaRef} className="torre-card-medida" data-card-medida={id}>
          <div className="torre-card-cab">
            <button
              type="button"
              className="torre-arraste"
              aria-label={`Mover card ${titulo}. Setas movem para o vizinho mais próximo naquela direção; Home e End levam ao início ou ao fim; Escape cancela o arraste.`}
              aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End Escape"
              onPointerDown={(e) => handleProps.onPointerDown(e, id)}
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
                role="separator"
                className="torre-span"
                data-largo={span > 1 ? 'true' : undefined}
                aria-orientation="horizontal"
                aria-valuenow={span}
                aria-valuemin={1}
                aria-valuemax={spanMax}
                aria-valuetext={`${span} de ${spanMax} colunas`}
                aria-label={`Largura do card ${titulo}. Setas ajustam entre 1 e ${spanMax} colunas; clique leva a ${proximoSpan}.`}
                aria-keyshortcuts="ArrowLeft ArrowRight Home End"
                title={
                  proximoSpan === 1
                    ? `Largura ${span}/${spanMax} — clique para voltar a 1 coluna`
                    : `Largura ${span}/${spanMax} — clique para ${proximoSpan} colunas`
                }
                onClick={() => aoAjustarSpan(id, span + 1, true)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowLeft') { e.preventDefault(); aoAjustarSpan(id, span - 1, false); }
                  else if (e.key === 'ArrowRight') { e.preventDefault(); aoAjustarSpan(id, span + 1, false); }
                  else if (e.key === 'Home') { e.preventDefault(); aoAjustarSpan(id, 1, false); }
                  else if (e.key === 'End') { e.preventDefault(); aoAjustarSpan(id, spanMax, false); }
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
                <span className="torre-span-prox" aria-hidden="true">
                  <svg viewBox="0 0 16 16" width="9" height="9" aria-hidden="true" focusable="false">
                    <path
                      d="M2.5 8h10M8.8 4.3 12.5 8l-3.7 3.7"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                  {proximoSpan}×
                </span>
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
      {/* Zona de arraste da largura: filha da section (não da peça) para não
          voar no arraste de reordenar nem ser clipada pelo overflow da peça.
          Só existe quando há para onde redimensionar (spanMax > 1). */}
      {spanMax > 1 && handleProps.onResizeDown && (
        <div
          className="torre-resize"
          aria-hidden="true"
          onPointerDown={(e) => handleProps.onResizeDown?.(e, id)}
        />
      )}
    </section>
  );
});
