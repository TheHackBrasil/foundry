import { useEffect, useState } from 'react';
import { movimentoReduzidoAgora } from './shaders/index.ts';

export type FasePresenca = 'fechado' | 'entrando' | 'aberto' | 'saindo';

// Mantém modais e gavetas montados durante a transição de saída para permitir
// coreografia simétrica de entrada e fechamento sem bibliotecas externas.
export function usePresencaAnimada(aberto: boolean, duracaoSaidaMs = 200) {
  const [montado, setMontado] = useState(aberto);
  const [fase, setFase] = useState<FasePresenca>(aberto ? 'aberto' : 'fechado');

  useEffect(() => {
    const reduzido = movimentoReduzidoAgora();
    if (aberto) {
      setMontado(true);
      if (reduzido) {
        setFase('aberto');
        return;
      }
      setFase('entrando');
      // Usa timer curto (~16ms) em vez de rAF duplo para nunca ficar preso atrás
      // de frames pesados do canvas WebGL em GPUs mais lentas.
      const timer = window.setTimeout(() => setFase('aberto'), 16);
      return () => window.clearTimeout(timer);
    }

    if (!montado) return;
    setFase('saindo');
    const tempo = reduzido ? 110 : duracaoSaidaMs;
    const timer = window.setTimeout(() => {
      setMontado(false);
      setFase('fechado');
    }, tempo);
    return () => window.clearTimeout(timer);
  }, [aberto, duracaoSaidaMs, montado]);

  return { montado, fase };
}
