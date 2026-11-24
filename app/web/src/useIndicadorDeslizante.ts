import { useLayoutEffect, useState, type RefObject } from 'react';

export interface GeometriaIndicador {
  pronto: boolean;
  animar: boolean;
  x: number;
  y: number;
  largura: number;
  altura: number;
  clipLeft: number;
  clipRight: number;
  clipTop: number;
  clipBottom: number;
}

const INICIAL: GeometriaIndicador = {
  pronto: false,
  animar: false,
  x: 0,
  y: 0,
  largura: 0,
  altura: 0,
  clipLeft: 0,
  clipRight: 0,
  clipTop: 0,
  clipBottom: 0,
};

// Mede o elemento ativo dentro de um grupo segmentado ou barra de abas e expõe
// coordenadas para indicadores compositor-only (translate3d / clip-path) sem
// disparar slide artificial no primeiro render.
export function useIndicadorDeslizante(
  containerRef: RefObject<HTMLElement | null>,
  seletorAtivo: string,
  chaveDependencia: string | number,
): GeometriaIndicador {
  const [geo, setGeo] = useState<GeometriaIndicador>(INICIAL);

  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let rafAnimar = 0;

    const medir = (permitirAnimacao: boolean) => {
      const ativo = el.querySelector<HTMLElement>(seletorAtivo);
      if (!ativo) {
        setGeo((prev) => (prev.pronto ? { ...prev, pronto: false } : prev));
        return;
      }

      const cW = el.clientWidth;
      const cH = el.clientHeight;
      const x = ativo.offsetLeft;
      const y = ativo.offsetTop;
      const largura = ativo.offsetWidth;
      const altura = ativo.offsetHeight;
      const clipLeft = Math.max(0, x);
      const clipRight = Math.max(0, cW - (x + largura));
      const clipTop = Math.max(0, y);
      const clipBottom = Math.max(0, cH - (y + altura));

      setGeo((prev) => {
        if (
          prev.pronto &&
          Math.abs(prev.x - x) < 0.5 &&
          Math.abs(prev.y - y) < 0.5 &&
          Math.abs(prev.largura - largura) < 0.5 &&
          Math.abs(prev.altura - altura) < 0.5 &&
          Math.abs(prev.clipRight - clipRight) < 0.5 &&
          Math.abs(prev.clipBottom - clipBottom) < 0.5
        ) {
          return prev;
        }
        return {
          pronto: true,
          animar: prev.pronto && permitirAnimacao,
          x,
          y,
          largura,
          altura,
          clipLeft,
          clipRight,
          clipTop,
          clipBottom,
        };
      });

      if (!permitirAnimacao) {
        window.cancelAnimationFrame(rafAnimar);
        rafAnimar = window.requestAnimationFrame(() => {
          setGeo((prev) => (prev.pronto && !prev.animar ? { ...prev, animar: true } : prev));
        });
      }
    };

    medir(true);

    const obs = typeof ResizeObserver === 'function' ? new ResizeObserver(() => medir(false)) : null;
    obs?.observe(el);

    let ativo = true;
    document.fonts?.ready?.then(() => {
      if (ativo) medir(false);
    });

    return () => {
      ativo = false;
      window.cancelAnimationFrame(rafAnimar);
      obs?.disconnect();
    };
  }, [containerRef, seletorAtivo, chaveDependencia]);

  return geo;
}
