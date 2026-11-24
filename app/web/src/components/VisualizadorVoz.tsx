import { useEffect, useRef, type RefObject } from 'react';
import {
  calcularAlvosBarras,
  calcularRmsTemporal,
  type FaseVoz,
} from '../useVoz.ts';

interface Props {
  analyserRef: RefObject<AnalyserNode | null>;
  energiaRef: RefObject<number>;
  ativo: boolean;
  fase?: FaseVoz;
  movimentoReduzido: boolean;
}

const QTD_BARRAS = 24;
const LARGURA_CSS = 128;
const ALTURA_CSS = 32;
const LARGURA_BARRA = 2.5;
const ESPACO_BARRA = 2.5;
const RAIO_CAP = 1;
const PISO_BARRA = 0.12;
const LIMIAR_RMS = 0.014;
const LIMIAR_PICO_VOCAL = 10;
const TAU_ATAQUE_MS = 45;
const TAU_QUEDA_MS = 180;

const LARGURA_TOTAL_BARRAS = QTD_BARRAS * LARGURA_BARRA + (QTD_BARRAS - 1) * ESPACO_BARRA;
const MARGEM_X = (LARGURA_CSS - LARGURA_TOTAL_BARRAS) * 0.5;
const ALTURA_UTIL_MAX = ALTURA_CSS - 6;

interface CoresEspectro {
  texto: string;
  destaque: string;
  borda: string;
}

function lerCoresTema(): CoresEspectro {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return { texto: '#163c38', destaque: '#654199', borda: '#52665e' };
  }
  const st = window.getComputedStyle(document.documentElement);
  return {
    texto: st.getPropertyValue('--text').trim() || '#163c38',
    destaque: st.getPropertyValue('--change').trim() || '#654199',
    borda: st.getPropertyValue('--border-strong').trim() || '#52665e',
  };
}

function desenharBarraArredondada(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  const raio = Math.min(r, w * 0.5, h * 0.5);
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, raio);
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.moveTo(x + raio, y);
  ctx.lineTo(x + w - raio, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + raio);
  ctx.lineTo(x + w, y + h - raio);
  ctx.quadraticCurveTo(x + w, y + h, x + w - raio, y + h);
  ctx.lineTo(x + raio, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - raio);
  ctx.lineTo(x, y + raio);
  ctx.quadraticCurveTo(x, y, x + raio, y);
  ctx.closePath();
  ctx.fill();
}

// Envelope de Hann pré-calculado para as 24 barras estáticas no modo de movimento reduzido
const BARRAS_ESTATICAS = Array.from({ length: QTD_BARRAS }, (_, i) => {
  const dist = Math.abs(i - (QTD_BARRAS * 0.5 - 0.5)) / (QTD_BARRAS * 0.5);
  const hann = 0.5 * (1 + Math.cos(Math.PI * dist));
  const alturaNorm = 0.16 + 0.62 * hann;
  const alturaPx = Math.max(3, alturaNorm * ALTURA_UTIL_MAX);
  const x = MARGEM_X + i * (LARGURA_BARRA + ESPACO_BARRA);
  const y = (ALTURA_CSS - alturaPx) * 0.5;
  return { x, y, h: alturaPx, pico: hann > 0.72 };
});

// Espectro acústico tátil de 24 barras em Canvas 2D (zero contexto WebGL extra).
// Em `prefers-reduced-motion` renderiza um SVG estático de 24 barras com envelope de Hann.
export function VisualizadorVoz({
  analyserRef,
  energiaRef,
  ativo,
  fase = 'ouvindo',
  movimentoReduzido,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const faseRef = useRef<FaseVoz>(fase);

  useEffect(() => {
    faseRef.current = fase;
  }, [fase]);

  useEffect(() => {
    if (!ativo || movimentoReduzido) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(LARGURA_CSS * dpr);
    canvas.height = Math.round(ALTURA_CSS * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    let cores = lerCoresTema();
    const obsTema = new MutationObserver(() => {
      cores = lerCoresTema();
    });
    obsTema.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-tema'],
    });

    const freqBuffer = new Uint8Array(128);
    const timeBuffer = new Uint8Array(256);
    const niveis = new Float32Array(QTD_BARRAS).fill(PISO_BARRA);
    let energiaLocal = 0.14;
    let ultimaEnergiaObservada = 0;
    let ultimoTempoMs: number | null = null;
    let rafId = 0;

    const desenhar = (tempoMs: number) => {
      const dtBruto = ultimoTempoMs === null ? 16 : tempoMs - ultimoTempoMs;
      ultimoTempoMs = tempoMs;
      const dtMs = Math.min(64, Math.max(4, dtBruto));
      const t = tempoMs * 0.0042;

      const energiaAtual = energiaRef.current;
      if (energiaAtual !== ultimaEnergiaObservada) {
        ultimaEnergiaObservada = energiaAtual;
        if (energiaAtual > energiaLocal) energiaLocal = energiaAtual;
      }
      const pisoEnergia = energiaAtual > 0.14 ? Math.min(0.45, energiaAtual * 0.5) : 0.12;
      energiaLocal =
        energiaLocal > pisoEnergia
          ? pisoEnergia + (energiaLocal - pisoEnergia) * Math.exp(-dtMs / 220)
          : pisoEnergia;

      let alvos: number[];
      let picoVocal = energiaLocal;

      switch (faseRef.current) {
        case 'iniciando': {
          alvos = Array.from({ length: QTD_BARRAS }, (_, i) => {
            const p = i / (QTD_BARRAS - 1);
            const hann = 0.5 * (1 - Math.cos(2 * Math.PI * p));
            const varredura = 0.5 + 0.5 * Math.sin(t * 1.4 - p * 4.8);
            return PISO_BARRA + (0.08 + 0.24 * varredura) * (0.25 + 0.75 * hann);
          });
          picoVocal = 0.2;
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
            alvos = calcularAlvosBarras(freqBuffer, rms, QTD_BARRAS);
            picoVocal = Math.min(1, Math.max(0.18, rms * 4.1));
          } else {
            const energia = Math.max(0.22, energiaLocal);
            alvos = Array.from({ length: QTD_BARRAS }, (_, i) => {
              const p = i / (QTD_BARRAS - 1);
              const hann = 0.5 * (1 - Math.cos(2 * Math.PI * p));
              const onda =
                0.5 +
                0.32 * Math.sin(t * 2.1 - p * 6.2 + (i % 3) * 0.65) +
                0.18 * Math.cos(t * 3.4 + p * 9.0);
              return Math.min(1, PISO_BARRA + Math.max(0, onda) * energia * 0.88 * (0.22 + 0.78 * hann));
            });
            picoVocal = energia;
          }
          break;
        }
        case 'finalizando':
        case 'ocioso': {
          alvos = Array.from({ length: QTD_BARRAS }, () => PISO_BARRA);
          picoVocal = 0.08;
          break;
        }
      }

      const alphaAtaque = 1 - Math.exp(-dtMs / TAU_ATAQUE_MS);
      const alphaQueda = 1 - Math.exp(-dtMs / TAU_QUEDA_MS);

      ctx.clearRect(0, 0, LARGURA_CSS, ALTURA_CSS);

      for (let i = 0; i < QTD_BARRAS; i++) {
        const alvo = alvos[i] ?? PISO_BARRA;
        const atual = niveis[i] ?? PISO_BARRA;
        const alpha = alvo > atual ? alphaAtaque : alphaQueda;
        const nivel = atual + (alvo - atual) * alpha;
        niveis[i] = nivel;

        const alturaPx = Math.max(3, nivel * ALTURA_UTIL_MAX);
        const x = MARGEM_X + i * (LARGURA_BARRA + ESPACO_BARRA);
        const y = (ALTURA_CSS - alturaPx) * 0.5;

        if (nivel > 0.56 || (picoVocal > 0.52 && nivel > 0.44)) {
          ctx.fillStyle = cores.destaque;
          ctx.globalAlpha = 0.96;
        } else if (nivel > 0.24) {
          ctx.fillStyle = cores.texto;
          ctx.globalAlpha = 0.88;
        } else {
          ctx.fillStyle = cores.borda;
          ctx.globalAlpha = 0.62;
        }

        desenharBarraArredondada(ctx, x, y, LARGURA_BARRA, alturaPx, RAIO_CAP);
      }
      ctx.globalAlpha = 1;

      rafId = window.requestAnimationFrame(desenhar);
    };

    rafId = window.requestAnimationFrame(desenhar);
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
      obsTema.disconnect();
    };
  }, [analyserRef, ativo, energiaRef, movimentoReduzido]);

  if (movimentoReduzido) {
    return (
      <svg
        className="voz-canvas voz-espectro voz-espectro-estatico"
        width={LARGURA_CSS}
        height={ALTURA_CSS}
        viewBox={`0 0 ${LARGURA_CSS} ${ALTURA_CSS}`}
        aria-hidden="true"
        focusable="false"
      >
        {BARRAS_ESTATICAS.map((barra, idx) => (
          <rect
            key={idx}
            x={barra.x}
            y={barra.y}
            width={LARGURA_BARRA}
            height={barra.h}
            rx={RAIO_CAP}
            fill={barra.pico ? 'var(--change)' : 'var(--text)'}
            fillOpacity={barra.pico ? 0.92 : 0.68}
          />
        ))}
      </svg>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      className="voz-canvas voz-espectro"
      width={LARGURA_CSS}
      height={ALTURA_CSS}
      aria-hidden="true"
    />
  );
}
