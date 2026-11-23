import { useEffect, useRef, type RefObject } from 'react';

interface Props {
  analyserRef: RefObject<AnalyserNode | null>;
  energiaRef: RefObject<number>;
  ativo: boolean;
  movimentoReduzido: boolean;
}

const LARGURA = 96;
const ALTURA = 24;
const BARRAS = 20;

// Visualizador de voz em <canvas> a 60fps fora do ciclo de re-render do React.
// Espelhado a partir do centro com janela de Hann (estetica sobria de instrumento).
export function VisualizadorVoz({ analyserRef, energiaRef, ativo, movimentoReduzido }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LARGURA * dpr;
    canvas.height = ALTURA * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const niveis = new Float32Array(BARRAS).fill(0.14);
    const freqBuffer = new Uint8Array(64);
    let rafId = 0;

    const lerCores = () => {
      const cs = getComputedStyle(document.documentElement);
      return {
        ativa: cs.getPropertyValue('--change').trim() || '#654199',
        base: cs.getPropertyValue('--text2').trim() || '#52665e',
      };
    };

    const desenhar = (tempoMs: number) => {
      const { ativa, base } = lerCores();
      ctx.clearRect(0, 0, LARGURA, ALTURA);

      const metade = BARRAS / 2;
      const passo = LARGURA / BARRAS;
      const larguraBarra = 2.2;
      const centroY = ALTURA / 2;
      const t = tempoMs * 0.004;

      const analyser = analyserRef.current;
      let temAudioReal = false;
      if (analyser && !movimentoReduzido) {
        analyser.getByteFrequencyData(freqBuffer);
        for (let k = 1; k < 24; k++) {
          if ((freqBuffer[k] ?? 0) > 6) {
            temAudioReal = true;
            break;
          }
        }
      }

      // Decai energia de fallback por eventos de fala suavemente.
      if (!temAudioReal && energiaRef.current > 0.08) {
        energiaRef.current = Math.max(0.08, energiaRef.current * 0.94);
      }

      for (let i = 0; i < BARRAS; i++) {
        const distCentro = Math.abs(i - (metade - 0.5)) / metade; // 0 no centro, ~1 nas pontas
        const janela = Math.cos(distCentro * Math.PI * 0.46); // envelope de Hann suave
        let alvo = 0.14;

        if (movimentoReduzido) {
          alvo = 0.22 + janela * 0.45;
        } else if (temAudioReal) {
          const bin = Math.min(28, 2 + Math.floor(distCentro * 20));
          const bruto = (freqBuffer[bin] ?? 0) / 255;
          alvo = Math.min(1, 0.16 + Math.pow(bruto, 0.72) * 1.15 * janela);
        } else {
          // Respiracao sutil em repouso + resposta a eventos reais de voz.
          const energia = Math.max(0.18, energiaRef.current);
          const onda = 0.5 + 0.5 * Math.sin(t * 1.6 - distCentro * 4.2 + (i % 3) * 0.6);
          alvo = Math.min(1, 0.14 + onda * energia * 0.82 * janela);
        }

        const atual = niveis[i] ?? 0.14;
        const peso = alvo > atual ? 0.42 : 0.18;
        const prox = movimentoReduzido ? alvo : atual + (alvo - atual) * peso;
        niveis[i] = prox;

        const h = Math.max(3, prox * (ALTURA - 4));
        const x = i * passo + (passo - larguraBarra) / 2;
        const y = centroY - h / 2;

        ctx.fillStyle = prox > 0.28 ? ativa : base;
        ctx.globalAlpha = prox > 0.28 ? 0.95 : 0.42;
        ctx.beginPath();
        ctx.roundRect(x, y, larguraBarra, h, 1.5);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      if (ativo && !movimentoReduzido) {
        rafId = window.requestAnimationFrame(desenhar);
      }
    };

    if (movimentoReduzido) {
      desenhar(0);
      return;
    }
    rafId = window.requestAnimationFrame(desenhar);
    return () => window.cancelAnimationFrame(rafId);
  }, [analyserRef, ativo, energiaRef, movimentoReduzido]);

  return (
    <canvas
      ref={canvasRef}
      className="voz-canvas"
      width={LARGURA}
      height={ALTURA}
      aria-hidden="true"
    />
  );
}
