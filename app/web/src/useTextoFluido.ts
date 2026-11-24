import { useEffect, useRef, useState } from 'react';
import { movimentoReduzidoAgora } from './shaders/index.ts';

export interface TextoFluidoEstado {
  visivel: string;
  compondo: boolean;
}

// Suaviza a entrega de texto_delta via SSE em 60fps: evita saltos de bloco
// quando pacotes de rede chegam em rajada e acelera adaptativamente conforme
// a fila cresce para nunca atrasar atras do modelo.
export function useTextoFluido(alvo: string, aoVivo: boolean): TextoFluidoEstado {
  const [tamanho, setTamanho] = useState<number>(() => {
    if (!aoVivo || movimentoReduzidoAgora()) return alvo.length;
    return 0;
  });

  const alvoRef = useRef(alvo);
  alvoRef.current = alvo;

  const tamanhoRef = useRef(tamanho);
  tamanhoRef.current = tamanho;

  useEffect(() => {
    if (movimentoReduzidoAgora()) {
      setTamanho(alvo.length);
      return;
    }

    // Se o texto alvo encolheu (ex.: reinicio de turno), sincroniza na hora.
    if (alvo.length < tamanhoRef.current) {
      setTamanho(alvo.length);
      return;
    }

    if (tamanhoRef.current >= alvo.length) {
      return;
    }

    let rafId = 0;
    let ultimoTs = 0;

    const passo = (ts: number) => {
      const atual = tamanhoRef.current;
      const destino = alvoRef.current;
      if (atual >= destino.length) return;

      const dt = ultimoTs === 0 ? 16.6 : Math.min(48, Math.max(8, ts - ultimoTs));
      ultimoTs = ts;
      const fator = dt / 16.6;

      const falta = destino.length - atual;
      const basePorQuadro =
        falta <= 14 ? 2 : falta <= 60 ? Math.max(3, Math.ceil(falta / 10)) : Math.ceil(falta / 7);
      let avanco = Math.max(1, Math.round(basePorQuadro * fator));
      let proximo = Math.min(destino.length, atual + avanco);

      // Evita exibir um '*' solitario no meio de '**negrito**' entre dois quadros.
      if (proximo < destino.length && destino[proximo - 1] === '*' && destino[proximo] === '*') {
        proximo = Math.min(destino.length, proximo + 1);
      }

      tamanhoRef.current = proximo;
      setTamanho(proximo);

      if (proximo < destino.length) {
        rafId = window.requestAnimationFrame(passo);
      }
    };

    rafId = window.requestAnimationFrame(passo);
    return () => {
      if (rafId) window.cancelAnimationFrame(rafId);
    };
  }, [alvo]);

  const visivel = tamanho >= alvo.length ? alvo : alvo.slice(0, tamanho);
  const compondo = aoVivo || visivel.length < alvo.length;

  return { visivel, compondo };
}
