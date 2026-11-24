import { useEffect, useRef, type RefObject } from 'react';
import { CamadaShader, obterMotorWebgl } from '../shaders/index.ts';
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

const BANDAS = 16;
const PISO_BANDA = 0.08;
const LIMIAR_RMS = 0.014;
const LIMIAR_PICO_VOCAL = 10;

// Lira de Anfíon reativa à FFT: amostra 16 bandas vocais em Float32Array fora do
// ciclo de render do React e alimenta o shader WebGL `liraVoz` (4 cordas harmônicas).
// Quando `prefers-reduced-motion` está ativo ou WebGL não existe, exibe um SVG
// limpo das 4 cordas estáticas com zero loop de animação.
export function VisualizadorVoz({
  analyserRef,
  energiaRef,
  ativo,
  fase = 'ouvindo',
  movimentoReduzido,
}: Props) {
  const bandasRef = useRef<Float32Array | null>(new Float32Array(BANDAS).fill(PISO_BANDA));
  const rmsRef = useRef<number | null>(0.12);
  const faseRef = useRef<FaseVoz>(fase);

  useEffect(() => {
    faseRef.current = fase;
  }, [fase]);

  const webglDisponivel = !movimentoReduzido && obterMotorWebgl().suportado;

  useEffect(() => {
    if (!ativo || !webglDisponivel) return;

    const freqBuffer = new Uint8Array(128);
    const timeBuffer = new Uint8Array(256);
    let niveis: number[] = Array.from({ length: BANDAS }, () => PISO_BANDA);
    let energiaLocal = 0.1;
    let ultimaEnergiaObservada = 0;
    let ultimoTempoMs: number | null = null;
    let rafId = 0;

    const amostrar = (tempoMs: number) => {
      const dtMs = ultimoTempoMs === null ? 16 : tempoMs - ultimoTempoMs;
      ultimoTempoMs = tempoMs;
      const dtClamped = Math.min(64, Math.max(4, dtMs));
      const t = tempoMs * 0.004;

      const energiaAtual = energiaRef.current;
      if (energiaAtual !== ultimaEnergiaObservada) {
        ultimaEnergiaObservada = energiaAtual;
        if (energiaAtual > energiaLocal) energiaLocal = energiaAtual;
      }
      const piso = energiaAtual > 0.15 ? Math.min(0.4, energiaAtual * 0.48) : 0.1;
      energiaLocal =
        energiaLocal > piso
          ? piso + (energiaLocal - piso) * Math.exp(-dtClamped / 240)
          : piso;

      let alvos: number[];
      let rmsAtual = energiaLocal;

      switch (faseRef.current) {
        case 'iniciando': {
          alvos = Array.from({ length: BANDAS }, (_, i) => {
            const p = i / (BANDAS - 1);
            return 0.14 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.1 - p * 4.2));
          });
          rmsAtual = 0.16;
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
            alvos = calcularAlvosBarras(freqBuffer, rms, BANDAS);
            rmsAtual = Math.min(1, Math.max(0.14, rms * 3.8));
          } else {
            const energia = Math.max(0.18, energiaLocal);
            alvos = Array.from({ length: BANDAS }, (_, i) => {
              const p = i / (BANDAS - 1);
              const hann = 0.5 * (1 - Math.cos(2 * Math.PI * p));
              const onda = 0.5 + 0.5 * Math.sin(t * 1.8 - p * 5.0 + (i % 3) * 0.7);
              return Math.min(1, PISO_BANDA + onda * energia * 0.85 * (0.25 + 0.75 * hann));
            });
            rmsAtual = energia;
          }
          break;
        }
        case 'finalizando':
        case 'ocioso': {
          alvos = Array.from({ length: BANDAS }, () => PISO_BANDA);
          rmsAtual = 0.08;
          break;
        }
      }

      niveis = suavizarBarras(niveis, alvos, dtMs);
      const dest = bandasRef.current;
      if (dest) {
        for (let i = 0; i < BANDAS; i++) {
          dest[i] = niveis[i] ?? PISO_BANDA;
        }
      }
      rmsRef.current = rmsAtual;

      rafId = window.requestAnimationFrame(amostrar);
    };

    rafId = window.requestAnimationFrame(amostrar);
    return () => {
      if (rafId !== 0) window.cancelAnimationFrame(rafId);
    };
  }, [analyserRef, ativo, energiaRef, webglDisponivel]);

  if (!webglDisponivel) {
    return (
      <svg
        className="voz-canvas voz-lira-estatica"
        width="104"
        height="26"
        viewBox="0 0 104 26"
        aria-hidden="true"
        focusable="false"
      >
        <path d="M2 7 Q28 4 52 7 T102 7" fill="none" stroke="var(--change)" strokeWidth="1.2" strokeOpacity="0.85" />
        <path d="M2 11 Q28 15 52 11 T102 11" fill="none" stroke="var(--text2)" strokeWidth="1.1" strokeOpacity="0.6" />
        <path d="M2 15 Q28 11 52 15 T102 15" fill="none" stroke="var(--change)" strokeWidth="1.2" strokeOpacity="0.85" />
        <path d="M2 19 Q28 22 52 19 T102 19" fill="none" stroke="var(--text2)" strokeWidth="1.1" strokeOpacity="0.55" />
      </svg>
    );
  }

  return (
    <span className="voz-canvas voz-lira-wrap" aria-hidden="true">
      <CamadaShader
        shader="liraVoz"
        ativo={ativo}
        modo={0}
        bandasRef={bandasRef}
        rmsRef={rmsRef}
      />
    </span>
  );
}
