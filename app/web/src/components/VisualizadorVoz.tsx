import { useEffect, useRef, type RefObject } from 'react';
import {
  calcularAlvosBarras,
  calcularRmsTemporal,
  suavizarBarras,
  type FaseVoz,
} from '../useVoz.ts';

interface Props {
  analyserRef: RefObject<AnalyserNode | null>;
  energiaRef: RefObject<number>;
  ativo: boolean;
  fase?: FaseVoz;
  movimentoReduzido: boolean;
}

const LARGURA = 96;
const ALTURA = 24;
const BARRAS = 20;
const LARGURA_BARRA = 2.2;
const PISO_BARRA = 0.12;
const LIMIAR_RMS = 0.014;
const LIMIAR_PICO_VOCAL = 10;

function envelopeHann(indice: number, total: number): number {
  const metade = total / 2;
  const distCentro = Math.abs(indice - (metade - 0.5)) / metade;
  return 0.5 * (1 + Math.cos(Math.PI * distCentro));
}

function lerCoresTema(): { ativa: string; base: string } {
  const cs = getComputedStyle(document.documentElement);
  return {
    ativa: cs.getPropertyValue('--change').trim() || '#654199',
    base: cs.getPropertyValue('--text2').trim() || '#52665e',
  };
}

// Visualizador de voz em <canvas> fora do ciclo de re-render do React.
// Espelhado a partir do centro com janela de Hann e traços arredondados sem roundRect.
export function VisualizadorVoz({
  analyserRef,
  energiaRef,
  ativo,
  fase = 'ouvindo',
  movimentoReduzido,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const faseRef = useRef<FaseVoz>(fase);

  useEffect(() => {
    faseRef.current = fase;
  }, [fase]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = LARGURA * dpr;
    canvas.height = ALTURA * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let cores = lerCoresTema();
    let niveis: number[] = Array.from({ length: BARRAS }, () => PISO_BARRA);
    const freqBuffer = new Uint8Array(128);
    const timeBuffer = new Uint8Array(256);
    let energiaLocal = 0.08;
    let ultimaEnergiaObservada = 0;
    let ultimoTempoMs: number | null = null;
    let rafId = 0;

    const pintarBarras = (alturas: readonly number[]) => {
      ctx.clearRect(0, 0, LARGURA, ALTURA);
      const passo = LARGURA / BARRAS;
      const centroY = ALTURA / 2;

      ctx.lineCap = 'round';
      ctx.lineWidth = LARGURA_BARRA;

      for (let i = 0; i < BARRAS; i++) {
        const nivel = alturas[i] ?? PISO_BARRA;
        const h = Math.max(3, nivel * (ALTURA - 4));
        const meiaHaste = Math.max(0.4, (h - LARGURA_BARRA) / 2);
        const cx = i * passo + passo / 2;
        const y1 = centroY - meiaHaste;
        const y2 = centroY + meiaHaste;

        ctx.strokeStyle = nivel > 0.28 ? cores.ativa : cores.base;
        ctx.globalAlpha = nivel > 0.28 ? 0.95 : 0.42;
        ctx.beginPath();
        ctx.moveTo(cx, y1);
        ctx.lineTo(cx, y2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const desenharEstatico = () => {
      const estatico = Array.from({ length: BARRAS }, (_, i) => 0.16 + envelopeHann(i, BARRAS) * 0.52);
      pintarBarras(estatico);
    };

    // Evita getComputedStyle a 60fps: relê tokens só quando data-tema muda.
    const observadorTema =
      typeof MutationObserver !== 'undefined'
        ? new MutationObserver(() => {
            cores = lerCoresTema();
            if (movimentoReduzido) {
              desenharEstatico();
            } else if (!ativo) {
              pintarBarras(niveis);
            }
          })
        : null;
    observadorTema?.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema'],
    });

    if (movimentoReduzido) {
      desenharEstatico();
      return () => observadorTema?.disconnect();
    }

    const desenhar = (tempoMs: number) => {
      const dtMs = ultimoTempoMs === null ? 16 : tempoMs - ultimoTempoMs;
      ultimoTempoMs = tempoMs;
      const dtClamped = Math.min(64, Math.max(4, dtMs));
      const t = tempoMs * 0.004;

      const energiaAtual = energiaRef.current;
      if (energiaAtual !== ultimaEnergiaObservada) {
        ultimaEnergiaObservada = energiaAtual;
        if (energiaAtual > energiaLocal) {
          energiaLocal = energiaAtual;
        }
      }
      const pisoEnergia = energiaAtual > 0.15 ? Math.min(0.36, energiaAtual * 0.45) : 0.08;
      if (energiaLocal > pisoEnergia) {
        energiaLocal = pisoEnergia + (energiaLocal - pisoEnergia) * Math.exp(-dtClamped / 260);
      } else {
        energiaLocal = pisoEnergia;
      }

      const metade = BARRAS / 2;
      const faseAtual = faseRef.current;
      let alvos: number[];

      switch (faseAtual) {
        case 'iniciando': {
          alvos = Array.from({ length: BARRAS }, (_, i) => {
            const distCentro = Math.abs(i - (metade - 0.5)) / metade;
            const janela = envelopeHann(i, BARRAS);
            const pulso = 0.5 + 0.5 * Math.sin(t * 0.9 - distCentro * 2.2);
            return 0.14 + pulso * 0.14 * (0.35 + 0.65 * janela);
          });
          break;
        }
        case 'ouvindo': {
          const analyser = analyserRef.current;
          let temAudioReal = false;
          let rms = 0;
          if (analyser) {
            analyser.getByteFrequencyData(freqBuffer);
            analyser.getByteTimeDomainData(timeBuffer);
            rms = calcularRmsTemporal(timeBuffer);
            if (rms > LIMIAR_RMS) {
              temAudioReal = true;
            } else {
              for (let k = 1; k <= 16; k++) {
                if ((freqBuffer[k] ?? 0) > LIMIAR_PICO_VOCAL) {
                  temAudioReal = true;
                  break;
                }
              }
            }
          }

          if (temAudioReal) {
            alvos = calcularAlvosBarras(freqBuffer, rms, BARRAS);
          } else {
            const energia = Math.max(0.16, energiaLocal);
            alvos = Array.from({ length: BARRAS }, (_, i) => {
              const distCentro = Math.abs(i - (metade - 0.5)) / metade;
              const janela = 0.2 + 0.8 * envelopeHann(i, BARRAS);
              const onda = 0.5 + 0.5 * Math.sin(t * 1.6 - distCentro * 4.2 + (i % 3) * 0.6);
              return Math.min(1, PISO_BARRA + onda * energia * 0.78 * janela);
            });
          }
          break;
        }
        case 'finalizando':
        case 'ocioso': {
          alvos = Array.from({ length: BARRAS }, () => PISO_BARRA);
          break;
        }
      }

      niveis = suavizarBarras(niveis, alvos, dtMs);
      pintarBarras(niveis);

      if (ativo) {
        rafId = window.requestAnimationFrame(desenhar);
      }
    };

    rafId = window.requestAnimationFrame(desenhar);
    return () => {
      observadorTema?.disconnect();
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
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
