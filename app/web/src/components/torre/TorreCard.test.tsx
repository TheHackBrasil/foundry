import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { TorreCard, type TorreCardHandleProps } from './TorreCard.tsx';

const HANDLE: TorreCardHandleProps = {
  onPointerDown: () => {},
  onKeyDown: () => {},
};

function renderCard(span: number, spanMax: number) {
  return renderToStaticMarkup(
    createElement(TorreCard, {
      id: 'matriz',
      titulo: 'Matriz',
      tituloId: 't-matriz',
      span,
      spanMax,
      ordemI: 0,
      recolhido: false,
      arrastando: false,
      handleProps: HANDLE,
      aoAjustarSpan: () => {},
      aoAlternarRecolhido: () => {},
      children: createElement('p', null, 'corpo'),
    }),
  );
}

describe('TorreCard — hint do splitter Nx', () => {
  it('mostra o próximo passo do ciclo ao lado do Nx', () => {
    const html = renderCard(2, 3);
    expect(html).toContain('torre-span-prox');
    // "2×" atual e "→3×" como próximo estado.
    expect(html).toContain('>2×<');
    expect(html).toMatch(/torre-span-prox[^]*?3×/);
  });

  it('com span no máximo, o próximo volta a 1', () => {
    const html = renderCard(3, 3);
    expect(html).toMatch(/torre-span-prox[^]*?1×/);
  });

  it('mantém o APG separator: valor atual, limites e rótulo do clique', () => {
    const html = renderCard(2, 3);
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-valuenow="2"');
    expect(html).toContain('aria-valuemin="1"');
    expect(html).toContain('aria-valuemax="3"');
    expect(html).toContain('aria-valuetext="2 de 3 colunas"');
    expect(html).toContain('clique leva a 3');
  });

  it('sem colunas extras (spanMax 1) não renderiza o splitter', () => {
    const html = renderCard(1, 1);
    expect(html).not.toContain('torre-span');
  });
});
