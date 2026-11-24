export type RgbLinear = [number, number, number];

export interface PaletaShader {
  readonly bg: RgbLinear;
  readonly surface: RgbLinear;
  readonly primary: RgbLinear;
  readonly text2: RgbLinear;
  readonly change: RgbLinear;
  readonly changeBg: RgbLinear;
  readonly cord: RgbLinear;
  readonly ok: RgbLinear;
  readonly error: RgbLinear;
  readonly dark: 0 | 1;
}

export type FaseEnvelope = 'ocioso' | 'ataque' | 'sustentacao' | 'resolucao';

export interface OpcoesEnvelopeAdsr {
  readonly ataqueMs?: number;
  readonly resolucaoMs?: number;
  readonly inicioAtenuacaoMs?: number;
  readonly duracaoAtenuacaoMs?: number;
  readonly pisoAtenuacao?: number;
  readonly nivelInicialResolucao?: number;
}

interface TokensHex {
  readonly bg: string;
  readonly surface: string;
  readonly primary: string;
  readonly text2: string;
  readonly change: string;
  readonly changeBg: string;
  readonly cord: string;
  readonly ok: string;
  readonly error: string;
}

const PADRAO_CLARO: TokensHex = {
  bg: '#f5f2eb',
  surface: '#fcfaf6',
  primary: '#163c38',
  text2: '#52665e',
  change: '#654199',
  changeBg: '#ede5fe',
  cord: '#d7c5ea',
  ok: '#31693f',
  error: '#ac3031',
};

const PADRAO_ESCURO: TokensHex = {
  bg: '#0e1f1d',
  surface: '#152825',
  primary: '#e8f0ee',
  text2: '#a8bdb5',
  change: '#c9b2f0',
  changeBg: '#35294a',
  cord: '#d7c5ea',
  ok: '#95d7a2',
  error: '#ffa098',
};

const GAMMA_SRGB = 2.2;
const ATAQUE_PADRAO_MS = 180;
const RESOLUCAO_PADRAO_MS = 320;
const INICIO_ATENUACAO_PADRAO_MS = 4000;
const DURACAO_ATENUACAO_PADRAO_MS = 1200;
const PISO_ATENUACAO_PADRAO = 0.25;
const NORMA_EXPO = 1 - Math.pow(2, -10);

function limitar01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v <= 0) return 0;
  if (v >= 1) return 1;
  return v;
}

function canalSrgbParaLinear(byte: number): number {
  const srgb = limitar01(byte / 255);
  return Math.pow(srgb, GAMMA_SRGB);
}

// Converte #rgb, #rrggbb, #rgba, #rrggbbaa e rgb()/rgba() para RGB linear (pow 2.2).
export function hexParaLinearRgb(cor: string): RgbLinear {
  const limpa = cor.trim().toLowerCase();
  if (!limpa) return [0, 0, 0];

  if (limpa.startsWith('#')) {
    const hex = limpa.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = Number.parseInt((hex[0] ?? '0') + (hex[0] ?? '0'), 16);
      const g = Number.parseInt((hex[1] ?? '0') + (hex[1] ?? '0'), 16);
      const b = Number.parseInt((hex[2] ?? '0') + (hex[2] ?? '0'), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0, 0, 0];
      return [canalSrgbParaLinear(r), canalSrgbParaLinear(g), canalSrgbParaLinear(b)];
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = Number.parseInt(hex.slice(0, 2), 16);
      const g = Number.parseInt(hex.slice(2, 4), 16);
      const b = Number.parseInt(hex.slice(4, 6), 16);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return [0, 0, 0];
      return [canalSrgbParaLinear(r), canalSrgbParaLinear(g), canalSrgbParaLinear(b)];
    }
    return [0, 0, 0];
  }

  const matchRgb = /^rgba?\(\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)\s*[,\s]\s*([0-9.]+%?)(?:\s*[,/]\s*[0-9.]+%?)?\s*\)$/.exec(
    limpa,
  );
  if (matchRgb) {
    const parseCanal = (token: string | undefined): number => {
      if (!token) return 0;
      const valor = Number.parseFloat(token);
      if (!Number.isFinite(valor)) return 0;
      return token.endsWith('%') ? (valor / 100) * 255 : valor;
    };
    return [
      canalSrgbParaLinear(parseCanal(matchRgb[1])),
      canalSrgbParaLinear(parseCanal(matchRgb[2])),
      canalSrgbParaLinear(parseCanal(matchRgb[3])),
    ];
  }

  return [0, 0, 0];
}

export function easeOutExpo(t: number): number {
  const x = limitar01(t);
  if (x === 0) return 0;
  if (x === 1) return 1;
  return (1 - Math.pow(2, -10 * x)) / NORMA_EXPO;
}

export function easeOutQuint(t: number): number {
  const x = limitar01(t);
  return 1 - Math.pow(1 - x, 5);
}

// Envelope ADSR puro com atenuação suave após 4000ms (WCAG 2.2.2) para evitar
// movimento contínuo agressivo em operações demoradas.
export function envelopeAdsr(
  fase: FaseEnvelope,
  tempoFaseMs: number,
  opcoes: OpcoesEnvelopeAdsr = {},
): number {
  if (fase === 'ocioso') return 0;

  const tempo = Number.isFinite(tempoFaseMs) ? Math.max(0, tempoFaseMs) : 0;

  if (fase === 'ataque') {
    const ataqueMs = opcoes.ataqueMs ?? ATAQUE_PADRAO_MS;
    if (ataqueMs <= 0) return 1;
    return easeOutExpo(tempo / ataqueMs);
  }

  if (fase === 'sustentacao') {
    const inicioAtenuacaoMs = opcoes.inicioAtenuacaoMs ?? INICIO_ATENUACAO_PADRAO_MS;
    if (tempo <= inicioAtenuacaoMs) return 1;

    const duracaoAtenuacaoMs = opcoes.duracaoAtenuacaoMs ?? DURACAO_ATENUACAO_PADRAO_MS;
    const piso = limitar01(opcoes.pisoAtenuacao ?? PISO_ATENUACAO_PADRAO);
    if (duracaoAtenuacaoMs <= 0) return piso;

    const u = limitar01((tempo - inicioAtenuacaoMs) / duracaoAtenuacaoMs);
    const suavizado = u * u * (3 - 2 * u);
    return 1 - (1 - piso) * suavizado;
  }

  const resolucaoMs = opcoes.resolucaoMs ?? RESOLUCAO_PADRAO_MS;
  const nivelInicial = limitar01(opcoes.nivelInicialResolucao ?? 1);
  if (resolucaoMs <= 0) return 0;
  return nivelInicial * (1 - easeOutQuint(tempo / resolucaoMs));
}

function construirPaletaDeTokens(tokens: TokensHex, dark: 0 | 1): PaletaShader {
  return {
    bg: hexParaLinearRgb(tokens.bg),
    surface: hexParaLinearRgb(tokens.surface),
    primary: hexParaLinearRgb(tokens.primary),
    text2: hexParaLinearRgb(tokens.text2),
    change: hexParaLinearRgb(tokens.change),
    changeBg: hexParaLinearRgb(tokens.changeBg),
    cord: hexParaLinearRgb(tokens.cord),
    ok: hexParaLinearRgb(tokens.ok),
    error: hexParaLinearRgb(tokens.error),
    dark,
  };
}

export function lerPaletaDoDocumento(doc?: Document): PaletaShader {
  const alvo = doc ?? (typeof document !== 'undefined' ? document : undefined);
  if (!alvo?.documentElement) {
    return construirPaletaDeTokens(PADRAO_CLARO, 0);
  }

  const root = alvo.documentElement;
  const dark: 0 | 1 = root.getAttribute('data-tema') === 'dark' ? 1 : 0;
  const fallback = dark === 1 ? PADRAO_ESCURO : PADRAO_CLARO;

  if (typeof window === 'undefined' || typeof window.getComputedStyle !== 'function') {
    return construirPaletaDeTokens(fallback, dark);
  }

  const cs = window.getComputedStyle(root);
  const ler = (prop: string, padrao: string): string => cs.getPropertyValue(prop).trim() || padrao;

  return construirPaletaDeTokens(
    {
      bg: ler('--bg', fallback.bg),
      surface: ler('--surface', fallback.surface),
      primary: ler('--primary', fallback.primary),
      text2: ler('--text2', fallback.text2),
      change: ler('--change', fallback.change),
      changeBg: ler('--change-bg', fallback.changeBg),
      cord: ler('--cord', fallback.cord),
      ok: ler('--ok', fallback.ok),
      error: ler('--error', fallback.error),
    },
    dark,
  );
}

// Cache único da paleta atualizado apenas por MutationObserver em data-tema,
// eliminando getComputedStyle do loop de renderização.
let paletaCache: PaletaShader | null = null;
let observadorTema: MutationObserver | null = null;
const ouvintesPaleta = new Set<(paleta: PaletaShader) => void>();

function garantirObservador(): void {
  if (observadorTema !== null) return;
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  const root = document.documentElement;
  if (!root) return;

  observadorTema = new MutationObserver(() => {
    paletaCache = lerPaletaDoDocumento(document);
    for (const ouvinte of ouvintesPaleta) {
      ouvinte(paletaCache);
    }
  });
  observadorTema.observe(root, {
    attributes: true,
    attributeFilter: ['data-tema'],
  });
}

export function obterPaletaAtual(): PaletaShader {
  if (paletaCache === null) {
    paletaCache = lerPaletaDoDocumento();
    garantirObservador();
  }
  return paletaCache;
}

export function observarPaletaTema(aoMudar: (paleta: PaletaShader) => void): () => void {
  const atual = obterPaletaAtual();
  garantirObservador();
  ouvintesPaleta.add(aoMudar);
  aoMudar(atual);

  return () => {
    ouvintesPaleta.delete(aoMudar);
    if (ouvintesPaleta.size === 0 && observadorTema !== null) {
      observadorTema.disconnect();
      observadorTema = null;
      paletaCache = null;
    }
  };
}
