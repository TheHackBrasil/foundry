import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

// Contratos mínimos da Web Speech API (ausentes na lib DOM padrão do TS).
export interface ResultadoReconhecimento {
  readonly isFinal: boolean;
  readonly length: number;
  readonly [index: number]: { readonly transcript: string } | undefined;
}

export interface EventoResultadoReconhecimento {
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

const SEM_FALA_INICIAL_MS = 7500;
const SILENCIO_PROVISORIO_MS = 3400;
const SILENCIO_POS_FALA_MS = 2100;
const WATCHDOG_FINALIZAR_MS = 1200;
const RETRY_ALSA_MS = 120;

const PISO_BARRA = 0.12;
const LIMIAR_RMS_FALA = 0.014;
const BIN_VOCAL_INICIO = 1;
const BIN_VOCAL_FIM = 16;
const TAU_ATAQUE_MS = 36;
const TAU_QUEDA_MS = 125;
const DT_MIN_MS = 4;
const DT_MAX_MS = 64;

export function montarTranscricao(
  results: EventoResultadoReconhecimento['results'],
  ehAndroid: boolean,
): { texto: string; provisorio: boolean } {
  const partes: string[] = [];
  let provisorio = false;

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    if (!res) continue;
    if (!res.isFinal) provisorio = true;
    const trecho = (res[0]?.transcript ?? '').replace(/\s+/g, ' ').trim();
    if (!trecho) continue;

    // Android Chrome reemite prefixos cumulativos ou repete trechos consecutivos
    // dentro do mesmo evento onresult.
    if (ehAndroid && partes.length > 0) {
      const anterior = partes[partes.length - 1] ?? '';
      const anteriorLow = anterior.toLowerCase();
      const trechoLow = trecho.toLowerCase();
      if (trechoLow === anteriorLow) continue;
      if (trechoLow.startsWith(anteriorLow)) {
        partes[partes.length - 1] = trecho;
        continue;
      }
      const acumuladoLow = partes.join(' ').toLowerCase();
      if (acumuladoLow.endsWith(trechoLow)) continue;
      if (trechoLow.startsWith(acumuladoLow)) {
        partes.splice(0, partes.length, trecho);
        continue;
      }
    }

    partes.push(trecho);
  }

  const texto = partes.join(' ').replace(/\s+/g, ' ').trim();
  return { texto, provisorio };
}

export function calcularRmsTemporal(amostras: Uint8Array): number {
  if (amostras.length === 0) return 0;
  let somaQuad = 0;
  for (let i = 0; i < amostras.length; i++) {
    const normalizado = ((amostras[i] ?? 128) - 128) / 128;
    somaQuad += normalizado * normalizado;
  }
  return Math.min(1, Math.sqrt(somaQuad / amostras.length));
}

// Mapeia as bandas vocais reais (bins 1..16 em fftSize=256, ~187 Hz–3 kHz)
// com envelope de Hann simétrico a partir do centro e piso suave de RMS.
export function calcularAlvosBarras(
  dadosFrequencia: Uint8Array,
  rms: number,
  quantidade = 20,
): number[] {
  if (quantidade <= 0) return [];
  const metade = quantidade / 2;
  const temBins = dadosFrequencia.length > BIN_VOCAL_INICIO;
  const binFim = temBins ? Math.min(BIN_VOCAL_FIM, dadosFrequencia.length - 1) : BIN_VOCAL_INICIO;
  const faixa = Math.max(1, binFim - BIN_VOCAL_INICIO + 1);
  const pisoRms = rms > LIMIAR_RMS_FALA ? Math.min(1, (rms - LIMIAR_RMS_FALA) * 3.2) * 0.45 : 0;

  const alvos: number[] = [];
  for (let i = 0; i < quantidade; i++) {
    const distCentro = Math.abs(i - (metade - 0.5)) / metade;
    const hann = 0.5 * (1 + Math.cos(Math.PI * distCentro));
    const janela = 0.2 + 0.8 * hann;

    let espectro = 0;
    if (temBins) {
      const fracInicio = Math.max(0, distCentro - 0.5 / metade);
      const fracFim = Math.min(1, distCentro + 0.5 / metade);
      const a = BIN_VOCAL_INICIO + Math.floor(fracInicio * faixa);
      const b = Math.min(binFim + 1, Math.max(a + 1, BIN_VOCAL_INICIO + Math.ceil(fracFim * faixa)));
      let soma = 0;
      let contagem = 0;
      for (let j = a; j < b; j++) {
        soma += dadosFrequencia[j] ?? 0;
        contagem += 1;
      }
      const bruto = contagem > 0 ? soma / (contagem * 255) : 0;
      espectro = Math.pow(bruto, 0.72) * 1.05;
    }

    const energia = Math.max(espectro, pisoRms);
    const altura = Math.min(1, Math.max(PISO_BARRA, PISO_BARRA + energia * janela));
    alvos.push(altura);
  }
  return alvos;
}

// Suavização exponencial independente da taxa de quadros: ataque rápido na
// sílaba e queda macia no silêncio.
export function suavizarBarras(
  atuais: ArrayLike<number>,
  alvos: readonly number[],
  dtMs: number,
): number[] {
  const dt = Number.isFinite(dtMs) ? Math.min(DT_MAX_MS, Math.max(DT_MIN_MS, dtMs)) : 16;
  const alphaAtaque = 1 - Math.exp(-dt / TAU_ATAQUE_MS);
  const alphaQueda = 1 - Math.exp(-dt / TAU_QUEDA_MS);

  const saida: number[] = [];
  for (let i = 0; i < alvos.length; i++) {
    const alvo = alvos[i] ?? PISO_BARRA;
    const atual = atuais[i] ?? PISO_BARRA;
    const alpha = alvo > atual ? alphaAtaque : alphaQueda;
    saida.push(atual + (alvo - atual) * alpha);
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
    case 'language-not-supported':
      return 'O reconhecimento de voz em português (pt-BR) não está disponível neste navegador.';
    case 'aborted':
      return '';
    default:
      return 'Não foi possível transcrever o áudio agora. Digite o comando ou tente novamente.';
  }
}

function contextoFechado(ctx: AudioContext): boolean {
  return ctx.state === 'closed';
}

function obterJanelaVoz(): JanelaComVoz | null {
  if (typeof window === 'undefined') return null;
  return window as unknown as JanelaComVoz;
}

function construtorReconhecimento(): ConstrutorReconhecimento | null {
  const w = obterJanelaVoz();
  return w?.SpeechRecognition ?? w?.webkitSpeechRecognition ?? null;
}

function ehAndroid(): boolean {
  return typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
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

export type FaseVoz = 'ocioso' | 'iniciando' | 'ouvindo' | 'finalizando';

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
  const finalizarRef = useRef<number | null>(null);
  const retryRef = useRef<number | null>(null);
  const medidorSolicitadoRef = useRef(false);
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

  const fecharContexto = useCallback((ctx: AudioContext) => {
    if (audioCtxRef.current === ctx) audioCtxRef.current = null;
    if (!contextoFechado(ctx)) {
      void ctx.close().catch(() => undefined);
    }
  }, []);

  const encerrarAudio = useCallback(() => {
    analyserRef.current = null;
    energiaRef.current = 0;
    if (streamRef.current) {
      for (const faixa of streamRef.current.getTracks()) faixa.stop();
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      fecharContexto(audioCtxRef.current);
    }
  }, [fecharContexto]);

  const pararCronometro = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const limparSilencio = useCallback(() => {
    if (silencioRef.current !== null) {
      window.clearTimeout(silencioRef.current);
      silencioRef.current = null;
    }
  }, []);

  const limparFinalizar = useCallback(() => {
    if (finalizarRef.current !== null) {
      window.clearTimeout(finalizarRef.current);
      finalizarRef.current = null;
    }
  }, []);

  const limparRetry = useCallback(() => {
    if (retryRef.current !== null) {
      window.clearTimeout(retryRef.current);
      retryRef.current = null;
    }
  }, []);

  const encerrarTimers = useCallback(() => {
    pararCronometro();
    limparSilencio();
    setSegundos(0);
  }, [limparSilencio, pararCronometro]);

  // AudioContext criado e retomado no próprio clique (gesto do usuário), senão
  // o Chrome trava em estado "suspended" e o AnalyserNode devolve apenas zeros.
  const ligarMedidorAcustico = useCallback(
    async (ctx: AudioContext | null, rec: ReconhecimentoFala) => {
      if (!ctx || movimentoReduzido || dispositivoToque() || !navigator.mediaDevices?.getUserMedia) {
        if (ctx) fecharContexto(ctx);
        return;
      }
      try {
        // Desliga o DSP do getUserMedia para não disputar Bluetooth HFP ou
        // pré-processamento de microfone com o SpeechRecognition.
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        });
        if (recRef.current !== rec || ctx.state === 'closed') {
          for (const faixa of stream.getTracks()) faixa.stop();
          fecharContexto(ctx);
          return;
        }
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => undefined);
        }
        if (recRef.current !== rec || contextoFechado(ctx)) {
          for (const faixa of stream.getTracks()) faixa.stop();
          fecharContexto(ctx);
          return;
        }
        const origem = ctx.createMediaStreamSource(stream);
        const analisador = ctx.createAnalyser();
        analisador.fftSize = 256;
        analisador.minDecibels = -76;
        analisador.maxDecibels = -20;
        analisador.smoothingTimeConstant = 0.68;
        origem.connect(analisador);

        streamRef.current = stream;
        audioCtxRef.current = ctx;
        analyserRef.current = analisador;
      } catch {
        // Não bloqueia o SpeechRecognition: visualizador reage a energiaRef.
        fecharContexto(ctx);
      }
    },
    [fecharContexto, movimentoReduzido],
  );

  const solicitarParada = useCallback(
    (rec: ReconhecimentoFala) => {
      if (recRef.current !== rec || finalizarRef.current !== null) return;
      canceladoRef.current = false;
      setFase('finalizando');
      encerrarAudio();
      pararCronometro();
      limparSilencio();
      try {
        rec.stop();
      } catch {
        // Ignora stop sobre instância já encerrada.
      }
      // Watchdog para navegadores que nunca disparam onend após stop().
      finalizarRef.current = window.setTimeout(() => {
        finalizarRef.current = null;
        if (recRef.current !== rec) return;
        recRef.current = null;
        encerrarAudio();
        encerrarTimers();
        setFase('ocioso');
        if (!canceladoRef.current && ultimoTextoRef.current) {
          aoConcluirRef.current?.(ultimoTextoRef.current);
        }
      }, WATCHDOG_FINALIZAR_MS);
    },
    [encerrarAudio, encerrarTimers, limparSilencio, pararCronometro],
  );

  const parar = useCallback(() => {
    limparRetry();
    const rec = recRef.current;
    if (!rec) {
      limparFinalizar();
      encerrarAudio();
      encerrarTimers();
      setFase('ocioso');
      return;
    }
    solicitarParada(rec);
  }, [encerrarAudio, encerrarTimers, limparFinalizar, limparRetry, solicitarParada]);

  const cancelar = useCallback(() => {
    limparRetry();
    limparFinalizar();
    canceladoRef.current = true;
    const rec = recRef.current;
    recRef.current = null;
    try {
      rec?.abort();
    } catch {
      // Ignora abort sobre instância já encerrada.
    }
    encerrarAudio();
    encerrarTimers();
    setFase('ocioso');
  }, [encerrarAudio, encerrarTimers, limparFinalizar, limparRetry]);

  const abrirReconhecimento = useCallback(
    (comMedidor: boolean) => {
      const Ctor = construtorReconhecimento();
      if (!Ctor) return;
      if (typeof window !== 'undefined' && window.isSecureContext === false) {
        setErro('O microfone exige HTTPS ou localhost.');
        return;
      }

      limparRetry();
      limparFinalizar();
      encerrarAudio();
      encerrarTimers();

      setErro(null);
      canceladoRef.current = false;
      ultimoTextoRef.current = '';
      medidorSolicitadoRef.current = comMedidor;
      setFase('iniciando');

      // Abre AudioContext sincronamente dentro do gesto de clique e registra
      // no ref imediatamente para que cancelar() durante 'iniciando' o feche.
      let ctx: AudioContext | null = null;
      if (comMedidor && !movimentoReduzido && !dispositivoToque()) {
        const w = obterJanelaVoz();
        const AudioCtx = w?.AudioContext ?? w?.webkitAudioContext;
        if (AudioCtx) {
          try {
            ctx = new AudioCtx();
            audioCtxRef.current = ctx;
            void ctx.resume().catch(() => undefined);
          } catch {
            ctx = null;
          }
        }
      }

      const android = ehAndroid();
      const rec = new Ctor();
      rec.lang = 'pt-BR';
      rec.interimResults = true;
      rec.continuous = !android;
      rec.maxAlternatives = 1;
      recRef.current = rec;

      const agendarSilencio = (ms: number) => {
        limparSilencio();
        silencioRef.current = window.setTimeout(() => {
          silencioRef.current = null;
          solicitarParada(rec);
        }, ms);
      };

      rec.onstart = () => {
        if (recRef.current !== rec) return;
        if (finalizarRef.current !== null) return;
        setFase('ouvindo');
        setSegundos(0);
        pararCronometro();
        timerRef.current = window.setInterval(() => setSegundos((s) => s + 1), 1000);
        agendarSilencio(SEM_FALA_INICIAL_MS);
        if (comMedidor && ctx) void ligarMedidorAcustico(ctx, rec);
      };

      rec.onsoundstart = () => {
        if (recRef.current !== rec) return;
        limparSilencio();
        energiaRef.current = Math.max(energiaRef.current, 0.45);
      };

      rec.onspeechstart = () => {
        if (recRef.current !== rec) return;
        limparSilencio();
        energiaRef.current = 0.85;
      };

      rec.onspeechend = () => {
        if (recRef.current !== rec) return;
        energiaRef.current = 0.15;
      };

      rec.onresult = (e) => {
        if (recRef.current !== rec) return;
        limparSilencio();
        const { texto: limpo, provisorio } = montarTranscricao(e.results, android);
        if (!limpo) return;
        ultimoTextoRef.current = limpo;
        energiaRef.current = provisorio ? 0.92 : 0.55;
        aoTranscreverRef.current(limpo, provisorio);
        if (finalizarRef.current === null) {
          agendarSilencio(provisorio ? SILENCIO_PROVISORIO_MS : SILENCIO_POS_FALA_MS);
        }
      };

      rec.onerror = (e) => {
        if (recRef.current !== rec) return;
        const codigo = e.error ?? '';
        // Em alguns Linux/ALSA o getUserMedia disputa o dispositivo: solta o
        // stream e tenta uma vez só com SpeechRecognition antes de acusar erro.
        if (
          codigo === 'audio-capture' &&
          (streamRef.current || medidorSolicitadoRef.current) &&
          !retentouSemStreamRef.current
        ) {
          retentouSemStreamRef.current = true;
          recRef.current = null;
          try {
            rec.abort();
          } catch {
            // Ignora abort sobre instância já encerrada.
          }
          limparFinalizar();
          encerrarAudio();
          encerrarTimers();
          limparRetry();
          retryRef.current = window.setTimeout(() => {
            retryRef.current = null;
            abrirReconhecimento(false);
          }, RETRY_ALSA_MS);
          return;
        }
        if (codigo === 'no-speech' && ultimoTextoRef.current) {
          return;
        }
        const msg = normalizarErroVoz(codigo);
        if (msg) setErro(msg);
      };

      rec.onend = () => {
        if (recRef.current !== rec) return;
        limparFinalizar();
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
        encerrarAudio();
        encerrarTimers();
        setFase('ocioso');
        setErro('Não foi possível iniciar o microfone agora.');
      }
    },
    [
      encerrarAudio,
      encerrarTimers,
      ligarMedidorAcustico,
      limparFinalizar,
      limparRetry,
      limparSilencio,
      movimentoReduzido,
      pararCronometro,
      solicitarParada,
    ],
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
      limparRetry();
      limparFinalizar();
      canceladoRef.current = true;
      const rec = recRef.current;
      recRef.current = null;
      try {
        rec?.abort();
      } catch {
        // Cleanup silencioso no unmount.
      }
      encerrarAudio();
      encerrarTimers();
    },
    [encerrarAudio, encerrarTimers, limparFinalizar, limparRetry],
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
