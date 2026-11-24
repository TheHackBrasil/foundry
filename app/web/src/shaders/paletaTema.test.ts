import { describe, expect, it } from 'vitest';
import {
  PRELUDIO_FRAGMENTO,
  VERTEX_SHADER_UNIVERSAL,
  VERTICES_TRIANGULO_TELA,
} from './glsl/comum.ts';
import { CATALOGO_SHADERS, NOMES_SHADERS, obterMotorWebgl, type NomeShader } from './motorWebgl.ts';
import {
  easeOutExpo,
  easeOutQuint,
  envelopeAdsr,
  hexParaLinearRgb,
  lerPaletaDoDocumento,
} from './paletaTema.ts';
import { movimentoReduzidoAgora } from './useMovimentoReduzido.ts';

function contarDelimitadoresBalanceados(codigo: string, abre: string, fecha: string): boolean {
  let profundidade = 0;
  for (const ch of codigo) {
    if (ch === abre) profundidade++;
    else if (ch === fecha) {
      profundidade--;
      if (profundidade < 0) return false;
    }
  }
  return profundidade === 0;
}

describe('hexParaLinearRgb', () => {
  it('converte #163c38 (petróleo Forseti) de sRGB para linear via pow(c, 2.2)', () => {
    // Arrange
    const cor = '#163c38';
    const esperado: [number, number, number] = [
      Math.pow(0x16 / 255, 2.2),
      Math.pow(0x3c / 255, 2.2),
      Math.pow(0x38 / 255, 2.2),
    ];

    // Act
    const resultado = hexParaLinearRgb(cor);

    // Assert
    expect(resultado[0]).toBeCloseTo(esperado[0], 6);
    expect(resultado[1]).toBeCloseTo(esperado[1], 6);
    expect(resultado[2]).toBeCloseTo(esperado[2], 6);
  });

  it('converte #654199 (lavanda profunda) de sRGB para linear via pow(c, 2.2)', () => {
    // Arrange
    const cor = '  #654199  ';
    const esperado: [number, number, number] = [
      Math.pow(0x65 / 255, 2.2),
      Math.pow(0x41 / 255, 2.2),
      Math.pow(0x99 / 255, 2.2),
    ];

    // Act
    const resultado = hexParaLinearRgb(cor);

    // Assert
    expect(resultado[0]).toBeCloseTo(esperado[0], 6);
    expect(resultado[1]).toBeCloseTo(esperado[1], 6);
    expect(resultado[2]).toBeCloseTo(esperado[2], 6);
  });

  it('suporta notação curta #rgb e formatos rgb()/rgba()', () => {
    // Arrange & Act
    const branco = hexParaLinearRgb('#fff');
    const preto = hexParaLinearRgb('#000');
    const curto = hexParaLinearRgb('#f0a');
    const rgbVirgula = hexParaLinearRgb('rgb(22, 60, 56)');
    const rgbaEspaco = hexParaLinearRgb('rgba(101 65 153 / 0.8)');

    // Assert
    expect(branco).toEqual([1, 1, 1]);
    expect(preto).toEqual([0, 0, 0]);
    expect(curto[0]).toBeCloseTo(1, 6);
    expect(curto[1]).toBeCloseTo(0, 6);
    expect(curto[2]).toBeCloseTo(Math.pow(0xaa / 255, 2.2), 6);

    expect(rgbVirgula[0]).toBeCloseTo(Math.pow(22 / 255, 2.2), 6);
    expect(rgbVirgula[1]).toBeCloseTo(Math.pow(60 / 255, 2.2), 6);
    expect(rgbVirgula[2]).toBeCloseTo(Math.pow(56 / 255, 2.2), 6);

    expect(rgbaEspaco[0]).toBeCloseTo(Math.pow(101 / 255, 2.2), 6);
    expect(rgbaEspaco[1]).toBeCloseTo(Math.pow(65 / 255, 2.2), 6);
    expect(rgbaEspaco[2]).toBeCloseTo(Math.pow(153 / 255, 2.2), 6);
  });

  it('retorna [0, 0, 0] para entradas vazias ou inválidas', () => {
    // Arrange & Act & Assert
    expect(hexParaLinearRgb('')).toEqual([0, 0, 0]);
    expect(hexParaLinearRgb('#12')).toEqual([0, 0, 0]);
    expect(hexParaLinearRgb('#zzzzzz')).toEqual([0, 0, 0]);
    expect(hexParaLinearRgb('hsl(120, 50%, 50%)')).toEqual([0, 0, 0]);
  });
});

describe('envelopeAdsr', () => {
  it('retorna 0 na fase ocioso', () => {
    // Arrange & Act & Assert
    expect(envelopeAdsr('ocioso', 0)).toBe(0);
    expect(envelopeAdsr('ocioso', 500)).toBe(0);
  });

  it('sobe com curva easeOutExpo durante ataque', () => {
    // Arrange
    const ataqueMs = 200;

    // Act
    const inicio = envelopeAdsr('ataque', 0, { ataqueMs });
    const quarto = envelopeAdsr('ataque', 50, { ataqueMs });
    const metade = envelopeAdsr('ataque', 100, { ataqueMs });
    const fim = envelopeAdsr('ataque', 200, { ataqueMs });
    const alem = envelopeAdsr('ataque', 450, { ataqueMs });

    // Assert
    expect(inicio).toBe(0);
    expect(quarto).toBeCloseTo(easeOutExpo(0.25), 6);
    expect(metade).toBeCloseTo(easeOutExpo(0.5), 6);
    expect(metade).toBeGreaterThan(0.95);
    expect(quarto).toBeLessThan(metade);
    expect(fim).toBe(1);
    expect(alem).toBe(1);
  });

  it('mantém sustentação plena até 4000ms e atenua suavemente após 4000ms (WCAG 2.2.2)', () => {
    // Arrange & Act
    const em1s = envelopeAdsr('sustentacao', 1000);
    const em4s = envelopeAdsr('sustentacao', 4000);
    const em4600ms = envelopeAdsr('sustentacao', 4600);
    const em5200ms = envelopeAdsr('sustentacao', 5200);
    const em10s = envelopeAdsr('sustentacao', 10_000);

    // Assert
    expect(em1s).toBe(1);
    expect(em4s).toBe(1);
    expect(em4600ms).toBeGreaterThan(0.25);
    expect(em4600ms).toBeLessThan(1);
    expect(em4600ms).toBeCloseTo(0.625, 3);
    expect(em5200ms).toBeCloseTo(0.25, 6);
    expect(em10s).toBeCloseTo(0.25, 6);
  });

  it('decai com curva easeOutQuint durante resolução respeitando nível inicial', () => {
    // Arrange
    const resolucaoMs = 300;

    // Act
    const inicio = envelopeAdsr('resolucao', 0, { resolucaoMs });
    const em20Pct = envelopeAdsr('resolucao', 60, { resolucaoMs });
    const metade = envelopeAdsr('resolucao', 150, { resolucaoMs });
    const fim = envelopeAdsr('resolucao', 300, { resolucaoMs });
    const parcial = envelopeAdsr('resolucao', 0, { resolucaoMs, nivelInicialResolucao: 0.6 });

    // Assert
    expect(inicio).toBe(1);
    expect(em20Pct).toBeCloseTo(1 - easeOutQuint(0.2), 6);
    expect(metade).toBeCloseTo(1 - easeOutQuint(0.5), 6);
    expect(em20Pct).toBeGreaterThan(metade);
    expect(fim).toBe(0);
    expect(parcial).toBeCloseTo(0.6, 6);
  });

  it('trata tempos negativos, NaN e durações zeradas sem produzir NaN', () => {
    // Arrange & Act & Assert
    expect(envelopeAdsr('ataque', -50)).toBe(0);
    expect(envelopeAdsr('ataque', Number.NaN)).toBe(0);
    expect(envelopeAdsr('ataque', 10, { ataqueMs: 0 })).toBe(1);
    expect(envelopeAdsr('resolucao', 10, { resolucaoMs: 0 })).toBe(0);
    expect(envelopeAdsr('sustentacao', 5000, { duracaoAtenuacaoMs: 0, pisoAtenuacao: 0.3 })).toBeCloseTo(0.3, 6);
  });
});

describe('catálogo completo de shaders GLSL ES 1.00', () => {
  const nomesEsperados: readonly NomeShader[] = [
    'ignicaoBotao',
    'liraVoz',
    'tearGenUi',
    'ondaDomino',
    'laminaRefracao',
    'seloCadeia',
    'campoMineral',
  ];

  const uniformsObrigatorios = [
    'uniform vec2 uRes;',
    'uniform float uTime;',
    'uniform float uEnvelope;',
    'uniform float uResolve;',
    'uniform vec2 uOrigin;',
    'uniform float uDir;',
    'uniform float uMode;',
    'uniform vec2 uGrid;',
    'uniform float uRadius;',
    'uniform float uRms;',
    'uniform float uDark;',
    'uniform float uPointer;',
    'uniform vec3 uColPrimary;',
    'uniform vec3 uColChange;',
    'uniform vec3 uColCord;',
    'uniform vec3 uColSurface;',
    'uniform vec3 uColOk;',
    'uniform vec3 uColError;',
    'uniform float uBands[16];',
  ];

  const funcoesPreludio = [
    'float sdRoundedBox(',
    'float snoise(',
    'float fbm2(',
    'float ignDither(',
    'vec3 linearToSrgb(',
    'float sampleBand(',
  ];

  it('exporta os 7 shaders da marca e o vertex shader universal de triângulo único', () => {
    // Arrange & Act
    const chavesCatalogo = Object.keys(CATALOGO_SHADERS);

    // Assert
    expect(NOMES_SHADERS).toEqual(nomesEsperados);
    expect(chavesCatalogo).toEqual(nomesEsperados);
    expect(Array.from(VERTICES_TRIANGULO_TELA)).toEqual([-1, -1, 3, -1, -1, 3]);
    expect(VERTEX_SHADER_UNIVERSAL).toContain('attribute vec2 aPos;');
    expect(VERTEX_SHADER_UNIVERSAL).toContain('varying vec2 vUv;');
    expect(VERTEX_SHADER_UNIVERSAL).toContain('gl_Position');
    expect(contarDelimitadoresBalanceados(VERTEX_SHADER_UNIVERSAL, '{', '}')).toBe(true);
    expect(contarDelimitadoresBalanceados(VERTEX_SHADER_UNIVERSAL, '(', ')')).toBe(true);
  });

  it('inclui todos os uniforms e funções utilitárias no prelúdio compartilhado', () => {
    // Arrange & Act & Assert
    for (const u of uniformsObrigatorios) {
      expect(PRELUDIO_FRAGMENTO).toContain(u);
    }
    for (const fn of funcoesPreludio) {
      expect(PRELUDIO_FRAGMENTO).toContain(fn);
    }
  });

  it.each(nomesEsperados)('shader "%s" é GLSL ES 1.00 válido e estruturalmente íntegro', (nome) => {
    // Arrange
    const fonte = CATALOGO_SHADERS[nome];

    // Act
    const chavesOk = contarDelimitadoresBalanceados(fonte, '{', '}');
    const parentesesOk = contarDelimitadoresBalanceados(fonte, '(', ')');
    const acessosBanda = Array.from(fonte.matchAll(/uBands\[([^\]]+)\]/g), (m) => m[1]?.trim());

    // Assert
    expect(fonte.length).toBeGreaterThan(PRELUDIO_FRAGMENTO.length + 100);
    expect(chavesOk).toBe(true);
    expect(parentesesOk).toBe(true);
    expect(fonte).toContain('void main()');
    expect(fonte).toContain('gl_FragColor');
    expect(fonte).toContain('saidaPremult(');
    expect(fonte).not.toMatch(/#version\s+300/);
    expect(fonte).not.toMatch(/\b(in|out)\s+vec[234]\b/);
    expect(fonte).not.toMatch(/\b(round|tanh|texture)\s*\(/);
    // Só permite declaração uBands[16] ou índice constante de laço uBands[i] (WebGL1).
    for (const indice of acessosBanda) {
      expect(['16', 'i']).toContain(indice);
    }
  });
});

describe('degradação segura sem DOM/WebGL', () => {
  it('lê paleta padrão clara e degrada motor WebGL silenciosamente fora do navegador', () => {
    // Arrange & Act
    const paleta = lerPaletaDoDocumento();
    const motor = obterMotorWebgl();

    // Assert
    expect(paleta.dark).toBe(0);
    expect(paleta.primary).toEqual(hexParaLinearRgb('#163c38'));
    expect(paleta.change).toEqual(hexParaLinearRgb('#654199'));
    expect(movimentoReduzidoAgora()).toBe(false);
    expect(motor.suportado).toBe(false);
    expect(motor.quantidadeSlotsAtivos()).toBe(0);
    expect(() => motor.removerSlot(999)).not.toThrow();
  });
});
