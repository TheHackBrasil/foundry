import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  obterMotorWebgl,
  type EstadoQuadroSlot,
  type NomeShader,
  type PonteiroShader,
} from './motorWebgl.ts';
import {
  easeOutQuint,
  envelopeAdsr,
  observarPaletaTema,
  type FaseEnvelope,
} from './paletaTema.ts';
import { useMovimentoReduzido } from './useMovimentoReduzido.ts';

export type ResolucaoShader = 'ok' | 'erro' | null;

export interface RefLeitura<T> {
  readonly current: T;
}

export interface PropsCamadaShader {
  readonly shader: NomeShader;
  readonly ativo: boolean;
  readonly modo?: number;
  readonly direcao?: -1 | 0 | 1;
  readonly origem?: readonly [number, number];
  readonly grade?: readonly [number, number];
  readonly raioPx?: number;
  readonly pulsoChave?: number;
  readonly duracaoPulsoMs?: number;
  readonly resolverEm?: ResolucaoShader;
  readonly bandasRef?: RefLeitura<Float32Array | null>;
  readonly rmsRef?: RefLeitura<number | null>;
  readonly ponteiroRef?: RefLeitura<PonteiroShader | null>;
  readonly className?: string;
}

export interface PropsSeloMonolitosShader {
  readonly ativo: boolean;
  readonly tamanho?: number;
  readonly className?: string;
}

interface EstadoCiclo {
  fase: FaseEnvelope;
  inicioFaseMs: number;
  inicioShaderMs: number;
  nivelInicialResolucao: number;
  nivelAtual: number;
  pulsoAtivo: boolean;
  inicioPulsoMs: number;
  duracaoPulsoMs: number;
  resolucaoAtiva: ResolucaoShader;
}

const ATAQUE_PADRAO_MS = 180;
const RESOLUCAO_PADRAO_MS = 320;
const DURACAO_PULSO_PADRAO_MS = 600;
const ORIGEM_PADRAO: readonly [number, number] = [0.5, 0.5];
const GRADE_PADRAO: readonly [number, number] = [6, 4];
const INTERVALO_REPOUSO_MINERAL_MS = 32;

const ESTILO_BASE_CAMADA: CSSProperties = {
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  pointerEvents: 'none',
  borderRadius: 'inherit',
};

// Fallback CSS estático de contraste contido para campoMineral quando WebGL não existe
// ou quando o usuário prefere movimento reduzido sem contexto GPU.
const ESTILO_CAMPO_ESTATICO: CSSProperties = {
  ...ESTILO_BASE_CAMADA,
  opacity: 0.08,
  backgroundImage:
    'radial-gradient(ellipse 75% 60% at 24% 28%, var(--change) 0%, transparent 64%), radial-gradient(ellipse 68% 58% at 78% 72%, var(--primary) 0%, transparent 68%)',
};

function agoraMonotonicoMs(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function resolverModoEfetivo(
  shader: NomeShader,
  modoBase: number,
  resolucao: ResolucaoShader,
): number {
  if (resolucao === 'erro') return 2;
  if (resolucao === 'ok') {
    if (shader === 'ignicaoBotao') return 1;
    if (shader === 'seloCadeia') return 0;
  }
  return modoBase;
}

function medirCanvasFisico(el: HTMLCanvasElement, larguraCss?: number, alturaCss?: number): [number, number] {
  const dpr = typeof window !== 'undefined' ? Math.min(window.devicePixelRatio || 1, 2) : 1;
  const wCss = larguraCss ?? (el.clientWidth || 1);
  const hCss = alturaCss ?? (el.clientHeight || 1);
  return [
    Math.max(1, Math.min(2048, Math.round(wCss * dpr))),
    Math.max(1, Math.min(2048, Math.round(hCss * dpr))),
  ];
}

function criarEstadoCicloInicial(): EstadoCiclo {
  return {
    fase: 'ocioso',
    inicioFaseMs: 0,
    inicioShaderMs: 0,
    nivelInicialResolucao: 1,
    nivelAtual: 0,
    pulsoAtivo: false,
    inicioPulsoMs: 0,
    duracaoPulsoMs: DURACAO_PULSO_PADRAO_MS,
    resolucaoAtiva: null,
  };
}

function CamadaCampoMineralEstatica({
  origem,
  className,
}: {
  readonly origem: readonly [number, number];
  readonly className: string | undefined;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const origemRef = useRef(origem);
  origemRef.current = origem;

  useEffect(() => {
    const canvas = canvasRef.current;
    const motor = obterMotorWebgl();
    if (!canvas || !motor.suportado) return;

    const pintarUmQuadro = (larguraCss?: number, alturaCss?: number) => {
      const [w, h] = medirCanvasFisico(canvas, larguraCss, alturaCss);
      const estado: EstadoQuadroSlot = {
        shader: 'campoMineral',
        tempoSeg: 0,
        envelope: 1,
        resolve: 0,
        origem: origemRef.current,
        direcao: 0,
        modo: 0,
        grade: GRADE_PADRAO,
        raioPx: 2,
        rms: 0,
        bandas: null,
        ponteiro: null,
      };
      motor.desenharQuadroUnico(canvas, w, h, estado);
    };

    pintarUmQuadro();

    const cancelarPaleta = observarPaletaTema(() => {
      pintarUmQuadro();
    });

    const observadorResize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entradas) => {
            const entrada = entradas[0];
            if (!entrada) return;
            const caixa = entrada.contentBoxSize?.[0];
            if (caixa) {
              pintarUmQuadro(caixa.inlineSize, caixa.blockSize);
            } else {
              pintarUmQuadro(entrada.contentRect.width, entrada.contentRect.height);
            }
          })
        : null;
    observadorResize?.observe(canvas);

    return () => {
      cancelarPaleta();
      observadorResize?.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} style={ESTILO_BASE_CAMADA} aria-hidden="true" />;
}

export function CamadaShader(props: PropsCamadaShader) {
  const {
    shader,
    ativo,
    modo = 0,
    direcao = 0,
    origem = ORIGEM_PADRAO,
    grade = GRADE_PADRAO,
    raioPx = 2,
    pulsoChave,
    duracaoPulsoMs = DURACAO_PULSO_PADRAO_MS,
    resolverEm = null,
    bandasRef,
    rmsRef,
    ponteiroRef,
    className,
  } = props;

  const movimentoReduzido = useMovimentoReduzido();
  const motor = obterMotorWebgl();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const slotIdRef = useRef<number>(0);
  const visivelRef = useRef<boolean>(true);
  const dimensoesRef = useRef<[number, number]>([1, 1]);
  const cicloRef = useRef<EstadoCiclo>(criarEstadoCicloInicial());
  const ultimoPulsoChaveRef = useRef<number>(0);
  const ativoAnteriorRef = useRef<boolean>(false);
  const resolucaoAnteriorRef = useRef<ResolucaoShader>(null);
  const [emExecucao, setEmExecucao] = useState<boolean>(false);

  const propsRef = useRef({
    shader,
    ativo,
    modo,
    direcao,
    origem,
    grade,
    raioPx,
    resolverEm,
    bandasRef,
    rmsRef,
    ponteiroRef,
  });
  propsRef.current = {
    shader,
    ativo,
    modo,
    direcao,
    origem,
    grade,
    raioPx,
    resolverEm,
    bandasRef,
    rmsRef,
    ponteiroRef,
  };

  const podeAnimar = !movimentoReduzido && motor.suportado;

  // Observa tamanho e interseção sem ler layout dentro do RAF.
  useEffect(() => {
    if (!podeAnimar) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    dimensoesRef.current = medirCanvasFisico(canvas);

    const observadorResize =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver((entradas) => {
            const entrada = entradas[0];
            if (!entrada) return;
            const caixa = entrada.contentBoxSize?.[0];
            const [w, h] = caixa
              ? medirCanvasFisico(canvas, caixa.inlineSize, caixa.blockSize)
              : medirCanvasFisico(canvas, entrada.contentRect.width, entrada.contentRect.height);
            dimensoesRef.current = [w, h];
            if (slotIdRef.current !== 0) {
              motor.atualizarDimensoesSlot(slotIdRef.current, w, h);
            }
          })
        : null;
    observadorResize?.observe(canvas);

    const observadorIntersecao =
      typeof IntersectionObserver !== 'undefined'
        ? new IntersectionObserver((entradas) => {
            const entrada = entradas[0];
            if (!entrada) return;
            visivelRef.current = entrada.isIntersecting;
            if (slotIdRef.current !== 0) {
              motor.atualizarVisibilidadeSlot(slotIdRef.current, entrada.isIntersecting);
            }
          })
        : null;
    observadorIntersecao?.observe(canvas);

    return () => {
      observadorResize?.disconnect();
      observadorIntersecao?.disconnect();
      if (slotIdRef.current !== 0) {
        motor.removerSlot(slotIdRef.current);
        slotIdRef.current = 0;
      }
      cicloRef.current = criarEstadoCicloInicial();
      ativoAnteriorRef.current = false;
      resolucaoAnteriorRef.current = null;
      setEmExecucao(false);
    };
  }, [motor, podeAnimar]);

  // Gerencia máquina de estados ADSR e disparo one-shot (pulsoChave + duracaoPulsoMs).
  useEffect(() => {
    if (!podeAnimar) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ciclo = cicloRef.current;
    const agora = agoraMonotonicoMs();
    const novoPulso =
      pulsoChave !== undefined && pulsoChave > 0 && pulsoChave !== ultimoPulsoChaveRef.current;

    const garantirSlotRegistrado = () => {
      if (slotIdRef.current !== 0) return;
      const [w, h] = dimensoesRef.current;
      slotIdRef.current = motor.registrarSlot({
        canvas,
        larguraPx: w,
        alturaPx: h,
        visivel: visivelRef.current,
        coletarEstado: (agoraMs: number): EstadoQuadroSlot | null => {
          const atual = propsRef.current;
          const tempoSeg = Math.max(0, (agoraMs - ciclo.inicioShaderMs) / 1000);
          let envelope = 0;
          let resolve = 0;

          if (ciclo.pulsoAtivo) {
            const decorrido = Math.max(0, agoraMs - ciclo.inicioPulsoMs);
            const duracao = ciclo.duracaoPulsoMs;
            if (decorrido >= duracao) {
              ciclo.pulsoAtivo = false;
              if (atual.ativo) {
                ciclo.fase = 'sustentacao';
                ciclo.inicioFaseMs = agoraMs;
                envelope = 1;
              } else {
                ciclo.fase = 'ocioso';
                ciclo.nivelAtual = 0;
                return null;
              }
            } else {
              const ataquePulso = Math.min(110, duracao * 0.18);
              const resolucaoPulso = Math.min(260, duracao * 0.34);
              const inicioCauda = Math.max(ataquePulso, duracao - resolucaoPulso);
              if (decorrido < ataquePulso) {
                envelope = envelopeAdsr('ataque', decorrido, { ataqueMs: ataquePulso });
              } else if (decorrido < inicioCauda) {
                envelope = 1;
              } else {
                const tempoCauda = decorrido - inicioCauda;
                envelope = envelopeAdsr('resolucao', tempoCauda, { resolucaoMs: resolucaoPulso });
                resolve = easeOutQuint(tempoCauda / Math.max(1, resolucaoPulso));
              }
            }
          } else {
            let tempoFase = Math.max(0, agoraMs - ciclo.inicioFaseMs);
            if (ciclo.fase === 'ataque') {
              if (tempoFase >= ATAQUE_PADRAO_MS) {
                ciclo.fase = 'sustentacao';
                ciclo.inicioFaseMs = agoraMs;
                tempoFase = 0;
                envelope = 1;
              } else {
                envelope = envelopeAdsr('ataque', tempoFase, { ataqueMs: ATAQUE_PADRAO_MS });
              }
            } else if (ciclo.fase === 'sustentacao') {
              const piso = atual.shader === 'campoMineral' ? 0.72 : 0.25;
              envelope = envelopeAdsr('sustentacao', tempoFase, { pisoAtenuacao: piso });
            } else if (ciclo.fase === 'resolucao') {
              if (tempoFase >= RESOLUCAO_PADRAO_MS) {
                ciclo.fase = 'ocioso';
                ciclo.nivelAtual = 0;
                return null;
              }
              envelope = envelopeAdsr('resolucao', tempoFase, {
                resolucaoMs: RESOLUCAO_PADRAO_MS,
                nivelInicialResolucao: ciclo.nivelInicialResolucao,
              });
              resolve = easeOutQuint(tempoFase / RESOLUCAO_PADRAO_MS);
            } else {
              return null;
            }
          }

          ciclo.nivelAtual = envelope;
          const modoEfetivo = resolverModoEfetivo(atual.shader, atual.modo, ciclo.resolucaoAtiva);

          return {
            shader: atual.shader,
            tempoSeg,
            envelope,
            resolve,
            origem: atual.origem,
            direcao: atual.direcao,
            modo: modoEfetivo,
            grade: atual.grade,
            raioPx: atual.raioPx,
            rms: atual.rmsRef?.current ?? 0,
            bandas: atual.bandasRef?.current ?? null,
            ponteiro: atual.ponteiroRef?.current ?? null,
            intervaloMinMs:
              atual.shader === 'campoMineral' && modoEfetivo === 0 ? INTERVALO_REPOUSO_MINERAL_MS : 0,
          };
        },
        aoEncerrar: () => {
          slotIdRef.current = 0;
          setEmExecucao(false);
        },
      });
    };

    if (novoPulso && pulsoChave !== undefined) {
      ultimoPulsoChaveRef.current = pulsoChave;
      ciclo.pulsoAtivo = true;
      ciclo.inicioPulsoMs = agora;
      ciclo.inicioShaderMs = agora;
      ciclo.duracaoPulsoMs = Math.max(80, duracaoPulsoMs);
      ciclo.fase = 'ataque';
      ciclo.inicioFaseMs = agora;
      ciclo.resolucaoAtiva = resolverEm;
      setEmExecucao(true);
      garantirSlotRegistrado();
    } else if (ativo && !ativoAnteriorRef.current) {
      ciclo.pulsoAtivo = false;
      ciclo.fase = 'ataque';
      ciclo.inicioFaseMs = agora;
      ciclo.inicioShaderMs = agora;
      ciclo.resolucaoAtiva = null;
      setEmExecucao(true);
      garantirSlotRegistrado();
    } else if (!ativo && ativoAnteriorRef.current && !ciclo.pulsoAtivo) {
      if (ciclo.fase === 'ataque' || ciclo.fase === 'sustentacao') {
        ciclo.nivelInicialResolucao = Math.max(0.05, ciclo.nivelAtual);
        ciclo.fase = 'resolucao';
        ciclo.inicioFaseMs = agora;
        ciclo.resolucaoAtiva = resolverEm;
      }
    } else if (
      resolverEm !== null &&
      resolverEm !== resolucaoAnteriorRef.current &&
      (ciclo.fase === 'ataque' || ciclo.fase === 'sustentacao')
    ) {
      ciclo.nivelInicialResolucao = Math.max(0.05, ciclo.nivelAtual);
      ciclo.fase = 'resolucao';
      ciclo.inicioFaseMs = agora;
      ciclo.resolucaoAtiva = resolverEm;
    }

    ativoAnteriorRef.current = ativo;
    resolucaoAnteriorRef.current = resolverEm;
  }, [ativo, duracaoPulsoMs, motor, podeAnimar, pulsoChave, resolverEm]);

  // Para campoMineral em movimento reduzido ou sem WebGL: 1 quadro estático (sem RAF) ou CSS mineral.
  if (!podeAnimar) {
    if (shader === 'campoMineral' && ativo) {
      if (movimentoReduzido && motor.suportado) {
        return <CamadaCampoMineralEstatica origem={origem} className={className} />;
      }
      return <div className={className} style={ESTILO_CAMPO_ESTATICO} aria-hidden="true" />;
    }
    return null;
  }

  const estiloCanvas: CSSProperties = emExecucao
    ? { ...ESTILO_BASE_CAMADA, opacity: 1, willChange: 'opacity' }
    : { ...ESTILO_BASE_CAMADA, opacity: 0 };

  return <canvas ref={canvasRef} className={className} style={estiloCanvas} aria-hidden="true" />;
}

// Micro-loader 24x24px dos 3 monólitos do Forseti em SDF, com fallback SVG limpo
// para prefers-reduced-motion ou ausência de WebGL (indicador essencial Tier 3).
export function SeloMonolitosShader({
  ativo,
  tamanho = 24,
  className,
}: PropsSeloMonolitosShader) {
  const movimentoReduzido = useMovimentoReduzido();
  const motor = obterMotorWebgl();

  if (!ativo) return null;

  if (movimentoReduzido || !motor.suportado) {
    return (
      <svg
        className={className}
        width={tamanho}
        height={tamanho}
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        style={{ display: 'inline-block', flexShrink: 0 }}
      >
        <path
          d="M3.2 10.6L7.4 8.4V18.8L3.2 21V10.6ZM9.8 6.4L14.2 4.1V17.9L9.8 20.2V6.4ZM16.6 5.2L20.8 3V13.4L16.6 15.6V5.2Z"
          fill="var(--primary, #163c38)"
        />
        <path
          d="M2.6 14.8C7.8 12.2 14.8 11.4 21.4 8.2M2.6 16.5C7.8 13.9 14.8 13.1 21.4 9.9M2.6 18.2C7.8 15.6 14.8 14.8 21.4 11.6M2.6 19.9C7.8 17.3 14.8 16.5 21.4 13.3"
          stroke="var(--change, #654199)"
          strokeWidth="1.05"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <span
      className={className}
      aria-hidden="true"
      style={{
        position: 'relative',
        display: 'inline-block',
        width: tamanho,
        height: tamanho,
        flexShrink: 0,
      }}
    >
      <CamadaShader shader="tearGenUi" ativo={ativo} modo={1} />
    </span>
  );
}
