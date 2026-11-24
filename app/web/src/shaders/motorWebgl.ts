import { FRAGMENT_CAMPO_MINERAL } from './glsl/campoMineral.ts';
import { VERTEX_SHADER_UNIVERSAL, VERTICES_TRIANGULO_TELA } from './glsl/comum.ts';
import { FRAGMENT_IGNICAO_BOTAO } from './glsl/ignicaoBotao.ts';
import { FRAGMENT_LAMINA_REFRACAO } from './glsl/laminaRefracao.ts';
import { FRAGMENT_LIRA_VOZ } from './glsl/liraVoz.ts';
import { FRAGMENT_ONDA_DOMINO } from './glsl/ondaDomino.ts';
import { FRAGMENT_SELO_CADEIA } from './glsl/seloCadeia.ts';
import { FRAGMENT_TEAR_GENUI } from './glsl/tearGenUi.ts';
import { observarPaletaTema, obterPaletaAtual, type PaletaShader } from './paletaTema.ts';

export type NomeShader =
  | 'ignicaoBotao'
  | 'liraVoz'
  | 'tearGenUi'
  | 'ondaDomino'
  | 'laminaRefracao'
  | 'seloCadeia'
  | 'campoMineral';

export const CATALOGO_SHADERS: Readonly<Record<NomeShader, string>> = {
  ignicaoBotao: FRAGMENT_IGNICAO_BOTAO,
  liraVoz: FRAGMENT_LIRA_VOZ,
  tearGenUi: FRAGMENT_TEAR_GENUI,
  ondaDomino: FRAGMENT_ONDA_DOMINO,
  laminaRefracao: FRAGMENT_LAMINA_REFRACAO,
  seloCadeia: FRAGMENT_SELO_CADEIA,
  campoMineral: FRAGMENT_CAMPO_MINERAL,
};

export const NOMES_SHADERS: readonly NomeShader[] = [
  'ignicaoBotao',
  'liraVoz',
  'tearGenUi',
  'ondaDomino',
  'laminaRefracao',
  'seloCadeia',
  'campoMineral',
];

export interface PonteiroShader {
  readonly x: number;
  readonly y: number;
  readonly ativo: boolean;
}

export interface EstadoQuadroSlot {
  readonly shader: NomeShader;
  readonly tempoSeg: number;
  readonly envelope: number;
  readonly resolve: number;
  readonly origem: readonly [number, number];
  readonly direcao: number;
  readonly modo: number;
  readonly grade: readonly [number, number];
  readonly raioPx: number;
  readonly rms: number;
  readonly bandas: Float32Array | null;
  readonly ponteiro: PonteiroShader | null;
  readonly intervaloMinMs?: number;
}

export interface OpcoesRegistroSlot {
  readonly canvas: HTMLCanvasElement;
  readonly larguraPx: number;
  readonly alturaPx: number;
  readonly visivel: boolean;
  readonly coletarEstado: (agoraMs: number) => EstadoQuadroSlot | null;
  readonly aoEncerrar?: () => void;
}

export interface MotorWebgl {
  readonly suportado: boolean;
  registrarSlot(opcoes: OpcoesRegistroSlot): number;
  removerSlot(id: number): void;
  atualizarDimensoesSlot(id: number, larguraPx: number, alturaPx: number): void;
  atualizarVisibilidadeSlot(id: number, visivel: boolean): void;
  desenharQuadroUnico(
    canvas: HTMLCanvasElement,
    larguraPx: number,
    alturaPx: number,
    estado: EstadoQuadroSlot,
  ): boolean;
  quantidadeSlotsAtivos(): number;
}

interface UniformsPrograma {
  readonly uRes: WebGLUniformLocation | null;
  readonly uTime: WebGLUniformLocation | null;
  readonly uEnvelope: WebGLUniformLocation | null;
  readonly uResolve: WebGLUniformLocation | null;
  readonly uOrigin: WebGLUniformLocation | null;
  readonly uDir: WebGLUniformLocation | null;
  readonly uMode: WebGLUniformLocation | null;
  readonly uGrid: WebGLUniformLocation | null;
  readonly uRadius: WebGLUniformLocation | null;
  readonly uRms: WebGLUniformLocation | null;
  readonly uDark: WebGLUniformLocation | null;
  readonly uPointer: WebGLUniformLocation | null;
  readonly uColPrimary: WebGLUniformLocation | null;
  readonly uColChange: WebGLUniformLocation | null;
  readonly uColCord: WebGLUniformLocation | null;
  readonly uColSurface: WebGLUniformLocation | null;
  readonly uColOk: WebGLUniformLocation | null;
  readonly uColError: WebGLUniformLocation | null;
  readonly uBands: WebGLUniformLocation | null;
}

interface ProgramaCompilado {
  readonly programa: WebGLProgram;
  readonly aPos: number;
  readonly uniforms: UniformsPrograma;
}

type DestinoCanvas =
  | { readonly tipo: 'bitmap'; readonly ctx: ImageBitmapRenderingContext }
  | { readonly tipo: '2d'; readonly ctx: CanvasRenderingContext2D };

interface SlotInterno {
  readonly id: number;
  readonly canvas: HTMLCanvasElement;
  readonly destino: DestinoCanvas;
  readonly coletarEstado: (agoraMs: number) => EstadoQuadroSlot | null;
  readonly aoEncerrar: (() => void) | undefined;
  larguraPx: number;
  alturaPx: number;
  visivel: boolean;
  ultimoDesenhoMs: number;
  ultimoTickMs: number;
  ponteiroX: number;
  ponteiroY: number;
  ponteiroPeso: number;
  ponteiroIniciado: boolean;
}

type GlContexto = WebGL2RenderingContext | WebGLRenderingContext;
type CanvasFonte = OffscreenCanvas | HTMLCanvasElement;

const OPCOES_CONTEXTO: WebGLContextAttributes = {
  alpha: true,
  antialias: false,
  premultipliedAlpha: true,
  powerPreference: 'low-power',
  depth: false,
  stencil: false,
  preserveDrawingBuffer: false,
};

const DIMENSAO_MAX_PX = 2048;
const TAU_PONTEIRO_POS_MS = 115;
const TAU_PONTEIRO_ATAQUE_MS = 120;
const TAU_PONTEIRO_ESTEIRA_MS = 260;

function limitarDimensao(valor: number): number {
  if (!Number.isFinite(valor) || valor < 1) return 1;
  return Math.min(DIMENSAO_MAX_PX, Math.round(valor));
}

function limitar01(valor: number): number {
  if (!Number.isFinite(valor)) return 0;
  if (valor <= 0) return 0;
  if (valor >= 1) return 1;
  return valor;
}

function limparDestino(destino: DestinoCanvas, larguraPx: number, alturaPx: number): void {
  try {
    if (destino.tipo === 'bitmap') {
      destino.ctx.transferFromImageBitmap(null);
    } else {
      destino.ctx.clearRect(0, 0, larguraPx, alturaPx);
    }
  } catch {
    // limpeza defensiva: contexto pode já estar indisponível no teardown
  }
}

class MotorWebglIndisponivel implements MotorWebgl {
  readonly suportado = false;

  registrarSlot(): number {
    return 0;
  }

  removerSlot(): void {}

  atualizarDimensoesSlot(): void {}

  atualizarVisibilidadeSlot(): void {}

  desenharQuadroUnico(): boolean {
    return false;
  }

  quantidadeSlotsAtivos(): number {
    return 0;
  }
}

class MotorWebglUnico implements MotorWebgl {
  readonly suportado: boolean;

  private readonly canvasFonte: CanvasFonte;
  private readonly usaOffscreen: boolean;
  private readonly gl: GlContexto;
  private readonly programas = new Map<NomeShader, ProgramaCompilado | null>();
  private readonly slots = new Map<number, SlotInterno>();
  private readonly destinos = new WeakMap<HTMLCanvasElement, DestinoCanvas | null>();
  private readonly bandasPadrao = new Float32Array(16);
  private readonly bandasBuffer = new Float32Array(16);

  private vertexShader: WebGLShader | null = null;
  private vbo: WebGLBuffer | null = null;
  private paleta: PaletaShader;
  private proximoId = 1;
  private rafId = 0;
  private contextoPerdido = false;
  private documentoOculto = false;

  private constructor(canvasFonte: CanvasFonte, gl: GlContexto, usaOffscreen: boolean) {
    this.canvasFonte = canvasFonte;
    this.gl = gl;
    this.usaOffscreen = usaOffscreen;
    this.suportado = true;
    this.paleta = obterPaletaAtual();
    this.documentoOculto = typeof document !== 'undefined' ? document.hidden : false;

    this.inicializarGeometria();

    observarPaletaTema((novaPaleta) => {
      this.paleta = novaPaleta;
    });

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.aoMudarVisibilidade);
    }

    canvasFonte.addEventListener('webglcontextlost', this.aoPerderContexto, false);
    canvasFonte.addEventListener('webglcontextrestored', this.aoRestaurarContexto, false);
  }

  static criar(): MotorWebgl {
    if (typeof window === 'undefined' || typeof document === 'undefined') {
      return new MotorWebglIndisponivel();
    }

    try {
      if (typeof OffscreenCanvas !== 'undefined') {
        const offscreen = new OffscreenCanvas(1, 1);
        const glOff =
          offscreen.getContext('webgl2', OPCOES_CONTEXTO) ??
          offscreen.getContext('webgl', OPCOES_CONTEXTO);
        if (glOff && typeof offscreen.transferToImageBitmap === 'function') {
          return new MotorWebglUnico(offscreen, glOff, true);
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const glDom =
        canvas.getContext('webgl2', OPCOES_CONTEXTO) ??
        canvas.getContext('webgl', OPCOES_CONTEXTO);
      if (glDom) {
        return new MotorWebglUnico(canvas, glDom, false);
      }
    } catch {
      // Ausência de WebGL ou bloqueio de GPU: degrada silenciosamente.
    }

    return new MotorWebglIndisponivel();
  }

  registrarSlot(opcoes: OpcoesRegistroSlot): number {
    if (!this.suportado) return 0;
    const destino = this.obterDestinoCanvas(opcoes.canvas);
    if (!destino) return 0;

    const id = this.proximoId++;
    const larguraPx = limitarDimensao(opcoes.larguraPx);
    const alturaPx = limitarDimensao(opcoes.alturaPx);

    this.slots.set(id, {
      id,
      canvas: opcoes.canvas,
      destino,
      coletarEstado: opcoes.coletarEstado,
      aoEncerrar: opcoes.aoEncerrar,
      larguraPx,
      alturaPx,
      visivel: opcoes.visivel,
      ultimoDesenhoMs: -Infinity,
      ultimoTickMs: 0,
      ponteiroX: 0.5,
      ponteiroY: 0.5,
      ponteiroPeso: 0,
      ponteiroIniciado: false,
    });

    this.agendarLoopSeNecessario();
    return id;
  }

  removerSlot(id: number): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    this.slots.delete(id);
    limparDestino(slot.destino, slot.larguraPx, slot.alturaPx);
    if (!this.temSlotVisivel()) {
      this.pararLoop();
    }
  }

  atualizarDimensoesSlot(id: number, larguraPx: number, alturaPx: number): void {
    const slot = this.slots.get(id);
    if (!slot) return;
    slot.larguraPx = limitarDimensao(larguraPx);
    slot.alturaPx = limitarDimensao(alturaPx);
  }

  atualizarVisibilidadeSlot(id: number, visivel: boolean): void {
    const slot = this.slots.get(id);
    if (!slot || slot.visivel === visivel) return;
    slot.visivel = visivel;
    if (visivel) {
      this.agendarLoopSeNecessario();
    } else if (!this.temSlotVisivel()) {
      this.pararLoop();
    }
  }

  desenharQuadroUnico(
    canvas: HTMLCanvasElement,
    larguraPx: number,
    alturaPx: number,
    estado: EstadoQuadroSlot,
  ): boolean {
    if (!this.suportado || this.contextoPerdido) return false;
    const destino = this.obterDestinoCanvas(canvas);
    if (!destino) return false;

    const w = limitarDimensao(larguraPx);
    const h = limitarDimensao(alturaPx);
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;

    return this.renderizarNoDestino(
      destino,
      w,
      h,
      estado,
      estado.origem[0],
      estado.origem[1],
      estado.ponteiro?.ativo ? 1 : 0,
    );
  }

  quantidadeSlotsAtivos(): number {
    return this.slots.size;
  }

  private readonly aoMudarVisibilidade = (): void => {
    this.documentoOculto = typeof document !== 'undefined' ? document.hidden : false;
    if (this.documentoOculto) {
      this.pararLoop();
    } else {
      this.agendarLoopSeNecessario();
    }
  };

  private readonly aoPerderContexto = (evento: Event): void => {
    evento.preventDefault();
    this.contextoPerdido = true;
    this.pararLoop();
  };

  private readonly aoRestaurarContexto = (): void => {
    this.programas.clear();
    this.vertexShader = null;
    this.vbo = null;
    this.inicializarGeometria();
    this.contextoPerdido = false;
    this.agendarLoopSeNecessario();
  };

  private readonly executarQuadro = (agoraMs: number): void => {
    this.rafId = 0;
    if (this.contextoPerdido || this.documentoOculto || this.slots.size === 0) {
      return;
    }

    let houveVisivel = false;
    const encerrados: SlotInterno[] = [];

    for (const slot of this.slots.values()) {
      if (!slot.visivel) continue;
      houveVisivel = true;

      const dtMs = slot.ultimoTickMs === 0 ? 16 : agoraMs - slot.ultimoTickMs;
      slot.ultimoTickMs = agoraMs;

      const estado = slot.coletarEstado(agoraMs);
      if (estado === null) {
        encerrados.push(slot);
        continue;
      }

      const ponteiro = this.atualizarPonteiroSlot(slot, estado, dtMs);
      const intervaloEfetivo =
        ponteiro.peso > 0.02 || estado.modo !== 0 ? 0 : (estado.intervaloMinMs ?? 0);

      if (intervaloEfetivo > 0 && agoraMs - slot.ultimoDesenhoMs < intervaloEfetivo) {
        continue;
      }

      if (slot.canvas.width !== slot.larguraPx) slot.canvas.width = slot.larguraPx;
      if (slot.canvas.height !== slot.alturaPx) slot.canvas.height = slot.alturaPx;

      this.renderizarNoDestino(
        slot.destino,
        slot.larguraPx,
        slot.alturaPx,
        estado,
        ponteiro.x,
        ponteiro.y,
        ponteiro.peso,
      );
      slot.ultimoDesenhoMs = agoraMs;
    }

    for (const slot of encerrados) {
      this.slots.delete(slot.id);
      limparDestino(slot.destino, slot.larguraPx, slot.alturaPx);
      slot.aoEncerrar?.();
    }

    if (houveVisivel && this.temSlotVisivel() && !this.documentoOculto && !this.contextoPerdido) {
      this.rafId = window.requestAnimationFrame(this.executarQuadro);
    }
  };

  private atualizarPonteiroSlot(
    slot: SlotInterno,
    estado: EstadoQuadroSlot,
    dtMs: number,
  ): { readonly x: number; readonly y: number; readonly peso: number } {
    if (estado.ponteiro === null) {
      slot.ponteiroIniciado = false;
      slot.ponteiroPeso = 0;
      return { x: estado.origem[0], y: estado.origem[1], peso: 0 };
    }

    const alvoX = limitar01(estado.ponteiro.x);
    const alvoY = limitar01(estado.ponteiro.y);
    const dtClamped = Math.min(64, Math.max(4, dtMs));

    if (!slot.ponteiroIniciado) {
      slot.ponteiroX = estado.ponteiro.ativo ? alvoX : estado.origem[0];
      slot.ponteiroY = estado.ponteiro.ativo ? alvoY : estado.origem[1];
      slot.ponteiroIniciado = true;
    } else if (estado.ponteiro.ativo) {
      const kPos = 1 - Math.exp(-dtClamped / TAU_PONTEIRO_POS_MS);
      slot.ponteiroX += (alvoX - slot.ponteiroX) * kPos;
      slot.ponteiroY += (alvoY - slot.ponteiroY) * kPos;
    }

    const alvoPeso = estado.ponteiro.ativo ? 1 : 0;
    const tauPeso = estado.ponteiro.ativo ? TAU_PONTEIRO_ATAQUE_MS : TAU_PONTEIRO_ESTEIRA_MS;
    const kPeso = 1 - Math.exp(-dtClamped / tauPeso);
    slot.ponteiroPeso += (alvoPeso - slot.ponteiroPeso) * kPeso;
    if (!estado.ponteiro.ativo && slot.ponteiroPeso < 0.002) {
      slot.ponteiroPeso = 0;
    }

    return { x: slot.ponteiroX, y: slot.ponteiroY, peso: slot.ponteiroPeso };
  }

  private renderizarNoDestino(
    destino: DestinoCanvas,
    larguraPx: number,
    alturaPx: number,
    estado: EstadoQuadroSlot,
    origemX: number,
    origemY: number,
    pesoPonteiro: number,
  ): boolean {
    const compilado = this.obterPrograma(estado.shader);
    if (!compilado || !this.vbo) return false;

    const gl = this.gl;
    if (this.canvasFonte.width !== larguraPx || this.canvasFonte.height !== alturaPx) {
      this.canvasFonte.width = larguraPx;
      this.canvasFonte.height = alturaPx;
    }

    gl.viewport(0, 0, larguraPx, alturaPx);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(compilado.programa);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.enableVertexAttribArray(compilado.aPos);
    gl.vertexAttribPointer(compilado.aPos, 2, gl.FLOAT, false, 0, 0);

    const u = compilado.uniforms;
    const p = this.paleta;

    if (u.uRes) gl.uniform2f(u.uRes, larguraPx, alturaPx);
    if (u.uTime) gl.uniform1f(u.uTime, estado.tempoSeg);
    if (u.uEnvelope) gl.uniform1f(u.uEnvelope, limitar01(estado.envelope));
    if (u.uResolve) gl.uniform1f(u.uResolve, limitar01(estado.resolve));
    if (u.uOrigin) gl.uniform2f(u.uOrigin, origemX, origemY);
    if (u.uDir) gl.uniform1f(u.uDir, estado.direcao);
    if (u.uMode) gl.uniform1f(u.uMode, estado.modo);
    if (u.uGrid) gl.uniform2f(u.uGrid, estado.grade[0], estado.grade[1]);
    if (u.uRadius) gl.uniform1f(u.uRadius, estado.raioPx);
    if (u.uRms) gl.uniform1f(u.uRms, limitar01(estado.rms));
    if (u.uDark) gl.uniform1f(u.uDark, p.dark);
    if (u.uPointer) gl.uniform1f(u.uPointer, limitar01(pesoPonteiro));

    if (u.uColPrimary) gl.uniform3f(u.uColPrimary, p.primary[0], p.primary[1], p.primary[2]);
    if (u.uColChange) gl.uniform3f(u.uColChange, p.change[0], p.change[1], p.change[2]);
    if (u.uColCord) gl.uniform3f(u.uColCord, p.cord[0], p.cord[1], p.cord[2]);
    if (u.uColSurface) gl.uniform3f(u.uColSurface, p.surface[0], p.surface[1], p.surface[2]);
    if (u.uColOk) gl.uniform3f(u.uColOk, p.ok[0], p.ok[1], p.ok[2]);
    if (u.uColError) gl.uniform3f(u.uColError, p.error[0], p.error[1], p.error[2]);

    if (u.uBands) {
      const bandas = this.prepararBandas(estado.bandas);
      gl.uniform1fv(u.uBands, bandas);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    return this.transferirQuadro(destino, larguraPx, alturaPx);
  }

  private transferirQuadro(destino: DestinoCanvas, larguraPx: number, alturaPx: number): boolean {
    try {
      if (destino.tipo === 'bitmap' && this.usaOffscreen && this.canvasFonte instanceof OffscreenCanvas) {
        const bitmap = this.canvasFonte.transferToImageBitmap();
        try {
          destino.ctx.transferFromImageBitmap(bitmap);
        } catch {
          bitmap.close();
          return false;
        }
        return true;
      }

      if (destino.tipo === '2d') {
        destino.ctx.clearRect(0, 0, larguraPx, alturaPx);
        destino.ctx.drawImage(this.canvasFonte, 0, 0, larguraPx, alturaPx);
        return true;
      }
    } catch {
      return false;
    }
    return false;
  }

  private prepararBandas(origem: Float32Array | null): Float32Array {
    if (!origem) return this.bandasPadrao;
    if (origem.length === 16) return origem;
    this.bandasBuffer.fill(0);
    const limite = Math.min(16, origem.length);
    for (let i = 0; i < limite; i++) {
      this.bandasBuffer[i] = origem[i] ?? 0;
    }
    return this.bandasBuffer;
  }

  private obterDestinoCanvas(canvas: HTMLCanvasElement): DestinoCanvas | null {
    const cache = this.destinos.get(canvas);
    if (cache !== undefined) return cache;

    let destino: DestinoCanvas | null = null;
    if (this.usaOffscreen) {
      try {
        const bitmapCtx = canvas.getContext('bitmaprenderer');
        if (bitmapCtx) {
          destino = { tipo: 'bitmap', ctx: bitmapCtx };
        }
      } catch {
        // fallback para contexto 2d abaixo
      }
    }

    if (!destino) {
      try {
        const ctx2d = canvas.getContext('2d');
        if (ctx2d) {
          destino = { tipo: '2d', ctx: ctx2d };
        }
      } catch {
        destino = null;
      }
    }

    this.destinos.set(canvas, destino);
    return destino;
  }

  private inicializarGeometria(): void {
    const gl = this.gl;
    const buffer = gl.createBuffer();
    if (!buffer) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, VERTICES_TRIANGULO_TELA, gl.STATIC_DRAW);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.CULL_FACE);
    this.vbo = buffer;
  }

  private compilarShader(tipo: number, fonte: string): WebGLShader | null {
    const gl = this.gl;
    const shader = gl.createShader(tipo);
    if (!shader) return null;
    gl.shaderSource(shader, fonte);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  private obterPrograma(nome: NomeShader): ProgramaCompilado | null {
    const emCache = this.programas.get(nome);
    if (emCache !== undefined) return emCache;

    const gl = this.gl;
    if (!this.vertexShader) {
      this.vertexShader = this.compilarShader(gl.VERTEX_SHADER, VERTEX_SHADER_UNIVERSAL);
    }
    if (!this.vertexShader) {
      this.programas.set(nome, null);
      return null;
    }

    const fragmentShader = this.compilarShader(gl.FRAGMENT_SHADER, CATALOGO_SHADERS[nome]);
    if (!fragmentShader) {
      this.programas.set(nome, null);
      return null;
    }

    const programa = gl.createProgram();
    if (!programa) {
      gl.deleteShader(fragmentShader);
      this.programas.set(nome, null);
      return null;
    }

    gl.attachShader(programa, this.vertexShader);
    gl.attachShader(programa, fragmentShader);
    gl.linkProgram(programa);
    gl.deleteShader(fragmentShader);

    if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) {
      gl.deleteProgram(programa);
      this.programas.set(nome, null);
      return null;
    }

    const aPos = gl.getAttribLocation(programa, 'aPos');
    if (aPos < 0) {
      gl.deleteProgram(programa);
      this.programas.set(nome, null);
      return null;
    }

    const compilado: ProgramaCompilado = {
      programa,
      aPos,
      uniforms: {
        uRes: gl.getUniformLocation(programa, 'uRes'),
        uTime: gl.getUniformLocation(programa, 'uTime'),
        uEnvelope: gl.getUniformLocation(programa, 'uEnvelope'),
        uResolve: gl.getUniformLocation(programa, 'uResolve'),
        uOrigin: gl.getUniformLocation(programa, 'uOrigin'),
        uDir: gl.getUniformLocation(programa, 'uDir'),
        uMode: gl.getUniformLocation(programa, 'uMode'),
        uGrid: gl.getUniformLocation(programa, 'uGrid'),
        uRadius: gl.getUniformLocation(programa, 'uRadius'),
        uRms: gl.getUniformLocation(programa, 'uRms'),
        uDark: gl.getUniformLocation(programa, 'uDark'),
        uPointer: gl.getUniformLocation(programa, 'uPointer'),
        uColPrimary: gl.getUniformLocation(programa, 'uColPrimary'),
        uColChange: gl.getUniformLocation(programa, 'uColChange'),
        uColCord: gl.getUniformLocation(programa, 'uColCord'),
        uColSurface: gl.getUniformLocation(programa, 'uColSurface'),
        uColOk: gl.getUniformLocation(programa, 'uColOk'),
        uColError: gl.getUniformLocation(programa, 'uColError'),
        uBands: gl.getUniformLocation(programa, 'uBands'),
      },
    };

    this.programas.set(nome, compilado);
    return compilado;
  }

  private temSlotVisivel(): boolean {
    for (const slot of this.slots.values()) {
      if (slot.visivel) return true;
    }
    return false;
  }

  private agendarLoopSeNecessario(): void {
    if (this.rafId !== 0 || this.contextoPerdido || this.documentoOculto) return;
    if (!this.temSlotVisivel()) return;
    this.rafId = window.requestAnimationFrame(this.executarQuadro);
  }

  private pararLoop(): void {
    if (this.rafId === 0) return;
    window.cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }
}

let instanciaMotor: MotorWebgl | null = null;

export function obterMotorWebgl(): MotorWebgl {
  if (instanciaMotor === null) {
    instanciaMotor = MotorWebglUnico.criar();
  }
  return instanciaMotor;
}
