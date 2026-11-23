import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Contratos minimos da Web Speech API (ausentes na lib DOM padrao do TS).
interface ResultadoReconhecimento {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string } | undefined;
}

interface EventoResultadoReconhecimento {
  readonly results: {
    readonly length: number;
    readonly [index: number]: ResultadoReconhecimento | undefined;
  };
}

interface EventoErroReconhecimento {
  readonly error?: string;
}

interface ReconhecimentoFala {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onsoundstart: (() => void) | null;
  onspeechstart: (() => void) | null;
  onspeechend: (() => void) | null;
  onresult: ((e: EventoResultadoReconhecimento) => void) | null;
  onerror: ((e: EventoErroReconhecimento) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

type ConstrutorReconhecimento = new () => ReconhecimentoFala;

interface JanelaComVoz {
  SpeechRecognition?: ConstrutorReconhecimento;
  webkitSpeechRecognition?: ConstrutorReconhecimento;
  AudioContext?: typeof AudioContext;
  webkitAudioContext?: typeof AudioContext;
}

const QUANTIDADE_BARRAS = 5;
const SILENCIO_POS_FALA_MS = 2600;

// Converte espectro FFT em barras normalizadas (0.16..1) com suavizacao
// assimetrica: sobe rapido no ataque da silaba e desce macio no silencio.
export function calcularBarrasAudio(
  dadosFrequencia: Uint8Array,
  anterior: readonly number[],
  quantidade = QUANTIDADE_BARRAS,
): number[] {
  const saida: number[] = [];
  if (dadosFrequencia.length === 0 || quantidade <= 0) {
    return Array.from({ length: Math.max(0, quantidade) }, () => 0.16);
  }
  const inicio = Math.min(1, dadosFrequencia.length - 1);
  const fim = Math.max(inicio + 1, Math.min(dadosFrequencia.length, Math.ceil(dadosFrequencia.length * 0.72)));
  const faixa = Math.max(1, fim - inicio);

  for (let i = 0; i < quantidade; i++) {
    const a = inicio + Math.floor((i * faixa) / quantidade);
    const b = Math.max(a + 1, inicio + Math.floor(((i + 1) * faixa) / quantidade));
    let soma = 0;
    let contagem = 0;
    for (let j = a; j < b && j < dadosFrequencia.length; j++) {
      soma += dadosFrequencia[j] ?? 0;
      contagem += 1;
    }
    const media = contagem > 0 ? soma / (contagem * 255) : 0;
    const alvo = Math.min(1, Math.max(0.16, Math.pow(media, 0.74) * 1.45 + 0.16));
    const prev = anterior[i] ?? 0.16;
    const peso = alvo > prev ? 0.58 : 0.24;
    saida.push(Number((prev + (alvo - prev) * peso).toFixed(3)));
  }
  return saida;
}

export function normalizarErroVoz(codigo: string): string {
  switch (codigo) {
    case 'not-allowed':
    case 'service-not-allowed':
      return 'Permissão de microfone bloqueada pelo navegador. Libere o acesso na barra de endereço e tente de novo.';
    case 'no-speech':
      return 'Nenhuma fala captada. Fale mais perto do microfone ou clique em Voz para tentar de novo.';
    case 'audio-capture':
      return 'Nenhum microfone ativo foi encontrado neste aparelho.';
    case 'network':
      return 'O serviço de transcrição do navegador não respondeu (comum no Brave ou Chromium sem chave Google). Use Chrome/Edge ou digite o comando.';
    case 'aborted':
      return '';
    default:
      return 'Não foi possível transcrever o áudio agora. Digite o comando ou tente novamente.';
  }
}

function construtorReconhecimento(): ConstrutorReconhecimento | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as JanelaComVoz;
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function prefereMovimentoReduzido(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function dispositivoToque(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export type FaseVoz = 'ocioso' | 'iniciando' | 'ouvindo';

export interface OpcoesVoz {
  aoTranscrever: (texto: string, provisorio: boolean) => void;
  aoConcluir?: (textoFinal: string) => void;
}

export interface EstadoVoz {
  suportado: boolean;
  fase: FaseVoz;
  ouvindo: boolean;
  segundos: number;
  movimentoReduzido: boolean;
  analyserRef: RefObject<AnalyserNode | null>;
  energiaRef: RefObject<number>;
  erro: string | null;
  alternar: () => void;
  parar: () => void;
  cancelar: () => void;
  limparErro: () => void;
}

export function useVoz({ aoTranscrever, aoConcluir }: OpcoesVoz): EstadoVoz {
  const suportado = construtorReconhecimento() !== null;
  const [fase, setFase] = useState<FaseVoz>('ocioso');
  const [segundos, setSegundos] = useState(0);
  const [erro, setErro] = useState<string | null>(null);
  const [movimentoReduzido, setMovimentoReduzido] = useState(prefereMovimentoReduzido);

  const recRef = useRef<ReconhecimentoFala | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const energiaRef = useRef(0);
  const timerRef = useRef<number | null>(null);
  const silencioRef = useRef<number | null>(null);
  const canceladoRef = useRef(false);
  const retentouSemStreamRef = useRef(false);
  const ultimoTextoRef = useRef('');
  const aoTranscreverRef = useRef(aoTranscrever);
  const aoConcluirRef = useRef(aoConcluir);

  useEffect(() => {
    aoTranscreverRef.current = aoTranscrever;
    aoConcluirRef.current = aoConcluir;
  }, [aoTranscrever, aoConcluir]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const aoMudar = () => setMovimentoReduzido(mq.matches);
    aoMudar();
    mq.addEventListener('change', aoMudar);
    return () => mq.removeEventListener('change', aoMudar);
  }, []);

  const encerrarAudio = useCallback(() => {
    analyserRef.current = null;
    energiaRef.current = 0;
    if (streamRef.current) {
      for (const faixa of streamRef.current.getTracks()) faixa.stop();
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
  }, []);

  const encerrarTimers = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (silencioRef.current !== null) {
      window.clearTimeout(silencioRef.current);
      silencioRef.current = null;
    }
    setSegundos(0);
  }, []);

  // AudioContext criado e retomado no proprio clique (gesto do usuario), senao
  // o Chrome trava em estado "suspended" e o AnalyserNode devolve apenas zeros.
  const ligarMedidorAcustico = useCallback(
    async (ctx: AudioContext | null) => {
      if (!ctx || movimentoReduzido || dispositivoToque() || !navigator.mediaDevices?.getUserMedia) {
        if (ctx) void ctx.close().catch(() => undefined);
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        if (!recRef.current) {
          for (const faixa of stream.getTracks()) faixa.stop();
          void ctx.close().catch(() => undefined);
          return;
        }
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => undefined);
        }
        const origem = ctx.createMediaStreamSource(stream);
        const analisador = ctx.createAnalyser();
        analisador.fftSize = 128;
        analisador.smoothingTimeConstant = 0.72;
        origem.connect(analisador);

        streamRef.current = stream;
        audioCtxRef.current = ctx;
        analyserRef.current = analisador;
      } catch {
        // Nao bloqueia o SpeechRecognition: visualizador reage a energiaRef.
        void ctx.close().catch(() => undefined);
      }
    },
    [movimentoReduzido],
  );

  const parar = useCallback(() => {
    canceladoRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      // Ignora stop sobre instancia ja encerrada.
    }
    encerrarAudio();
    encerrarTimers();
    setFase('ocioso');
  }, [encerrarAudio, encerrarTimers]);

  const cancelar = useCallback(() => {
    canceladoRef.current = true;
    try {
      recRef.current?.abort();
    } catch {
      // Ignora abort sobre instancia ja encerrada.
    }
    recRef.current = null;
    encerrarAudio();
    encerrarTimers();
    setFase('ocioso');
  }, [encerrarAudio, encerrarTimers]);

  const abrirReconhecimento = useCallback(
    (comMedidor: boolean) => {
      const Ctor = construtorReconhecimento();
      if (!Ctor) return;
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        setErro('O microfone exige HTTPS ou localhost.');
        return;
      }

      setErro(null);
      canceladoRef.current = false;
      ultimoTextoRef.current = '';
      setFase('iniciando');

      // Abre AudioContext sincronamente dentro do gesto de clique.
      let ctx: AudioContext | null = null;
      if (comMedidor && !movimentoReduzido && !dispositivoToque()) {
        const w = window as unknown as JanelaComVoz;
        const AudioCtx = w.AudioContext ?? w.webkitAudioContext;
        if (AudioCtx) {
          try {
            ctx = new AudioCtx();
            void ctx.resume().catch(() => undefined);
          } catch {
            ctx = null;
          }
        }
      }

      const rec = new Ctor();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = true;
      rec.maxAlternatives = 1;
      recRef.current = rec;

      rec.onstart = () => {
        setFase('ouvindo');
        setSegundos(0);
        if (timerRef.current !== null) window.clearInterval(timerRef.current);
        timerRef.current = window.setInterval(() => setSegundos((s) => s + 1), 1000);
        if (comMedidor && ctx) void ligarMedidorAcustico(ctx);
      };

      rec.onsoundstart = () => {
        energiaRef.current = Math.max(energiaRef.current, 0.45);
      };
      rec.onspeechstart = () => {
        energiaRef.current = 0.85;
      };
      rec.onspeechend = () => {
        energiaRef.current = 0.15;
      };

      rec.onresult = (e) => {
        let completo = '';
        let provisorio = false;
        for (let i = 0; i < e.results.length; i++) {
          const res = e.results[i];
          const trecho = res?.[0]?.transcript ?? '';
          completo += trecho;
          if (res && !res.isFinal) provisorio = true;
        }
        const limpo = completo.trim();
        if (limpo) {
          ultimoTextoRef.current = limpo;
          energiaRef.current = provisorio ? 0.92 : 0.55;
          aoTranscreverRef.current(limpo, provisorio);
          // No modo continuous, encerra suavemente apos pausa limpa depois da frase final.
          if (silencioRef.current !== null) window.clearTimeout(silencioRef.current);
          if (!provisorio) {
            silencioRef.current = window.setTimeout(() => {
              try {
                recRef.current?.stop();
              } catch {
                // Ja encerrado.
              }
            }, SILENCIO_POS_FALA_MS);
          }
        }
      };

      rec.onerror = (e) => {
        const codigo = e.error ?? '';
        // Em alguns Linux/ALSA o getUserMedia disputa o dispositivo: solta o
        // stream e tenta uma vez so com SpeechRecognition antes de acusar erro.
        if (codigo === 'audio-capture' && streamRef.current && !retentouSemStreamRef.current) {
          retentouSemStreamRef.current = true;
          encerrarAudio();
          encerrarTimers();
          recRef.current = null;
          window.setTimeout(() => abrirReconhecimento(false), 120);
          return;
        }
        const msg = normalizarErroVoz(codigo);
        if (msg) setErro(msg);
      };

      rec.onend = () => {
        if (recRef.current !== rec) return;
        recRef.current = null;
        encerrarAudio();
        encerrarTimers();
        setFase('ocioso');
        if (!canceladoRef.current && ultimoTextoRef.current) {
          aoConcluirRef.current?.(ultimoTextoRef.current);
        }
      };

      try {
        rec.start();
      } catch {
        recRef.current = null;
        if (ctx) void ctx.close().catch(() => undefined);
        setFase('ocioso');
        setErro('Não foi possível iniciar o microfone agora.');
      }
    },
    [encerrarAudio, encerrarTimers, ligarMedidorAcustico, movimentoReduzido],
  );

  const alternar = useCallback(() => {
    if (fase !== 'ocioso') {
      parar();
      return;
    }
    retentouSemStreamRef.current = false;
    abrirReconhecimento(true);
  }, [abrirReconhecimento, fase, parar]);

  const limparErro = useCallback(() => setErro(null), []);

  useEffect(
    () => () => {
      canceladoRef.current = true;
      try {
        recRef.current?.abort();
      } catch {
        // Cleanup silencioso no unmount.
      }
      recRef.current = null;
      encerrarAudio();
      encerrarTimers();
    },
    [encerrarAudio, encerrarTimers],
  );

  return {
    suportado,
    fase,
    ouvindo: fase !== 'ocioso',
    segundos,
    movimentoReduzido,
    analyserRef,
    energiaRef,
    erro,
    alternar,
    parar,
    cancelar,
    limparErro,
  };
}
