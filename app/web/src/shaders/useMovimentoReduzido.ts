import { useEffect, useState } from 'react';

const CONSULTA_REDUZIR = '(prefers-reduced-motion: reduce)';

export function movimentoReduzidoAgora(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false;
  }
  return window.matchMedia(CONSULTA_REDUZIR).matches;
}

export function useMovimentoReduzido(): boolean {
  const [reduzido, setReduzido] = useState<boolean>(movimentoReduzidoAgora);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const mq = window.matchMedia(CONSULTA_REDUZIR);
    const atualizar = () => setReduzido(mq.matches);
    atualizar();

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', atualizar);
      return () => mq.removeEventListener('change', atualizar);
    }
    if (typeof mq.addListener === 'function') {
      mq.addListener(atualizar);
      return () => mq.removeListener(atualizar);
    }
    return undefined;
  }, []);

  return reduzido;
}
