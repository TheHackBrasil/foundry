import { useCallback, useEffect, useRef, useState } from 'react';

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
const BARRAS_REPOUSO: readonly number[] = [0.16, 0.16, 0.16, 0.16, 0.16];
const BARRAS_ESTATICAS: readonly number[] = [0.35, 0.65, 0.85, 0.55, 0.35];
const PESOS_EVENTO: readonly number[] = [0.55, 0.85, 1, 0.8, 0.5];

// Converte espectro FFT em 5 barras normalizadas (0.16..1) com suavizacao
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
  // Faixa vocal (ignora DC no indice 0 e agudos extremos sem energia de voz).
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
    // Curva leve para dar leitura visivel em voz normal de microfone de notebook.
    const alvo = Math.min(1, Math.max(0.16, Math.pow(media, 0.78) * 1.35 + 0.16));
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
      return 'Permissão de microfone negada no navegador.';
    case 'no-speech':
      return 'Nenhuma fala detectada. Tente de novo perto do microfone.';
    case 'audio-capture':
      return 'Nenhum microfone disponível neste aparelho.';
    case 'network':
      return 'Falha de rede no reconhecimento de voz do navegador.';
    case 'aborted':
      return '';
    default:
      return 'Não foi possível transcrever o áudio agora.';
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

// Em telas touch (iOS/Android), abrir getUserMedia em paralelo com
// SpeechRecognition costuma disputar o hardware do microfone e encerrar o ditado.
function dispositivoToque(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(pointer: coarse)').matches
  );
}

export interface OpcoesVoz {
  aoTranscrever: (texto: string, provisorio: boolean) => void;
  aoConcluir?: (textoFinal: string) => void;
}

export interface EstadoVoz {
  suportado: boolean;
  ouvindo: boolean;
  segundos: number;
  niveis: readonly number[];
  fonteNivel: 'audio' | 'eventos' | 'estatico';
  erro: string | null;
  alternar: () => void;
  parar: () => void;
  cancelar: () => void;
  limparErro: () => void;
}

export function useVoz({ aoTranscrever, aoConcluir }: OpcoesVoz): EstadoVoz {
  const suportado = construtorReconhecimento() !== null;
  const [ouvindo, setOuvindo] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [niveis, setNiveis] = useState<readonly number[]>(BARRAS_REPOUSO);
  const [fonteNivel, setFonteNivel] = useState<'audio' | 'eventos' | 'estatico'>('eventos');
  const [erro, setErro] = useState<string | null>(null);
  const [movimentoReduzido, setMovimentoReduzido] = useState(prefereMovimentoReduzido);

  const recRef = useRef<ReconhecimentoFala | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const decaimentoRef = useRef<number | null>(null);
  const niveisRef = useRef<readonly number[]>(BARRAS_REPOUSO);
  const canceladoRef = useRef(false);
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
    if (rafRef.current !== null) {
      window.cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (decaimentoRef.current !== null) {
      window.clearTimeout(decaimentoRef.current);
      decaimentoRef.current = null;
    }
    if (streamRef.current) {
      for (const faixa of streamRef.current.getTracks()) faixa.stop();
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    niveisRef.current = BARRAS_REPOUSO;
    setNiveis(BARRAS_REPOUSO);
  }, []);

  const encerrarCronometro = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    setSegundos(0);
  }, []);

  // Pulso honesto quando o AnalyserNode nao esta ativo: reage apenas aos
  // eventos reais de voz/transcricao e retorna ao repouso no silencio.
  const pulsarPorEvento = useCallback(
    (intensidade: number) => {
      if (movimentoReduzido || audioCtxRef.current !== null) return;
      const barras = PESOS_EVENTO.map((peso) =>
        Number(Math.min(1, Math.max(0.16, 0.16 + peso * intensidade)).toFixed(3)),
      );
      niveisRef.current = barras;
      setNiveis(barras);
      if (decaimentoRef.current !== null) window.clearTimeout(decaimentoRef.current);
      decaimentoRef.current = window.setTimeout(() => {
        niveisRef.current = BARRAS_REPOUSO;
        setNiveis(BARRAS_REPOUSO);
      }, 280);
    },
    [movimentoReduzido],
  );

  const ligarMedidorAcustico = useCallback(async () => {
    if (movimentoReduzido) {
      setFonteNivel('estatico');
      setNiveis(BARRAS_ESTATICAS);
      return;
    }
    if (dispositivoToque() || !navigator.mediaDevices?.getUserMedia) {
      setFonteNivel('eventos');
      return;
    }
    const w = window as unknown as JanelaComVoz;
    const AudioCtx = w.AudioContext ?? w.webkitAudioContext;
    if (!AudioCtx) {
      setFonteNivel('eventos');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Se o reconhecimento ja encerrou enquanto a permissao resolvia, solta o mic.
      if (!recRef.current) {
        for (const faixa of stream.getTracks()) faixa.stop();
        return;
      }
      const ctx = new AudioCtx();
      const origem = ctx.createMediaStreamSource(stream);
      const analisador = ctx.createAnalyser();
      analisador.fftSize = 64;
      analisador.smoothingTimeConstant = 0.65;
      origem.connect(analisador);

      streamRef.current = stream;
      audioCtxRef.current = ctx;
      setFonteNivel('audio');

      const buffer = new Uint8Array(analisador.frequencyBinCount);
      const quadro = () => {
        if (!audioCtxRef.current) return;
        analisador.getByteFrequencyData(buffer);
        const prox = calcularBarrasAudio(buffer, niveisRef.current);
        niveisRef.current = prox;
        setNiveis(prox);
        rafRef.current = window.requestAnimationFrame(quadro);
      };
      rafRef.current = window.requestAnimationFrame(quadro);
    } catch {
      // Sem bloquear o SpeechRecognition: degrada para barras reativas a eventos.
      setFonteNivel('eventos');
    }
  }, [movimentoReduzido]);

  const parar = useCallback(() => {
    canceladoRef.current = false;
    try {
      recRef.current?.stop();
    } catch {
      // Ignora stop sobre instancia ja encerrada.
    }
    encerrarAudio();
    encerrarCronometro();
    setOuvindo(false);
  }, [encerrarAudio, encerrarCronometro]);

  const cancelar = useCallback(() => {
    canceladoRef.current = true;
    try {
      recRef.current?.abort();
    } catch {
      // Ignora abort sobre instancia ja encerrada.
    }
    recRef.current = null;
    encerrarAudio();
    encerrarCronometro();
    setOuvindo(false);
  }, [encerrarAudio, encerrarCronometro]);

  const iniciar = useCallback(() => {
    const Ctor = construtorReconhecimento();
    if (!Ctor) return;
    setErro(null);
    canceladoRef.current = false;
    ultimoTextoRef.current = '';

    const rec = new Ctor();
    rec.lang = 'pt-BR';
    rec.interimResults = true;
    rec.continuous = false;
    rec.maxAlternatives = 1;
    recRef.current = rec;

    rec.onstart = () => {
      setOuvindo(true);
      setSegundos(0);
      timerRef.current = window.setInterval(() => setSegundos((s) => s + 1), 1000);
      void ligarMedidorAcustico();
    };

    rec.onsoundstart = () => pulsarPorEvento(0.35);
    rec.onspeechstart = () => pulsarPorEvento(0.68);
    rec.onspeechend = () => {
      if (audioCtxRef.current === null && !movimentoReduzido) {
        niveisRef.current = BARRAS_REPOUSO;
        setNiveis(BARRAS_REPOUSO);
      }
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
      ultimoTextoRef.current = limpo;
      if (limpo) {
        pulsarPorEvento(provisorio ? 0.78 : 0.45);
        aoTranscreverRef.current(limpo, provisorio);
      }
    };

    rec.onerror = (e) => {
      const msg = normalizarErroVoz(e.error ?? '');
      if (msg) setErro(msg);
    };

    rec.onend = () => {
      recRef.current = null;
      encerrarAudio();
      encerrarCronometro();
      setOuvindo(false);
      if (!canceladoRef.current && ultimoTextoRef.current) {
        aoConcluirRef.current?.(ultimoTextoRef.current);
      }
    };

    try {
      rec.start();
    } catch {
      recRef.current = null;
      setErro('Não foi possível iniciar o microfone agora.');
    }
  }, [encerrarAudio, encerrarCronometro, ligarMedidorAcustico, movimentoReduzido, pulsarPorEvento]);

  const alternar = useCallback(() => {
    if (ouvindo) parar();
    else iniciar();
  }, [ouvindo, iniciar, parar]);

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
      encerrarCronometro();
    },
    [encerrarAudio, encerrarCronometro],
  );

  return {
    suportado,
    ouvindo,
    segundos,
    niveis: movimentoReduzido && ouvindo ? BARRAS_ESTATICAS : niveis,
    fonteNivel: movimentoReduzido ? 'estatico' : fonteNivel,
    erro,
    alternar,
    parar,
    cancelar,
    limparErro,
  };
}
