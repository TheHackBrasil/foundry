import { describe, expect, it } from 'vitest';
import { compararFontes, divergenciasDaNovaFonte } from './divergence.js';

describe('compararFontes', () => {
  it('sem divergencia quando campos batem', () => {
    const a = { fonte: 'nfe' as const, campos: { pesoTotal: 510, volumes: 10 } };
    const b = { fonte: 'cte' as const, campos: { pesoTotal: 510, volumes: 10 } };
    expect(compararFontes(a, b)).toEqual([]);
  });

  it('diverge peso, volumes, data e status', () => {
    const a = {
      fonte: 'nfe' as const,
      campos: { pesoTotal: 510, volumes: 10, previsaoEntrega: '2026-11-25', status: 'emitida' },
    };
    const b = {
      fonte: 'cte' as const,
      campos: { pesoTotal: 520, volumes: 12, previsaoEntrega: '2026-11-28', status: 'cancelada' },
    };
    const divs = compararFontes(a, b);
    expect(divs.map((d) => d.campo).sort()).toEqual(
      ['pesoTotal', 'previsaoEntrega', 'status', 'volumes'].sort(),
    );
    const peso = divs.find((d) => d.campo === 'pesoTotal')!;
    expect(peso.valorA).toBe(510);
    expect(peso.valorB).toBe(520);
  });

  it('ignora campo que so uma fonte declara', () => {
    const a = { fonte: 'nfe' as const, campos: { pesoTotal: 510 } };
    const b = { fonte: 'planilha' as const, campos: { status: 'entregue' } };
    expect(compararFontes(a, b)).toEqual([]);
  });

  it('tolerancia de arredondamento no peso', () => {
    const a = { fonte: 'nfe' as const, campos: { pesoTotal: 510 } };
    const b = { fonte: 'cte' as const, campos: { pesoTotal: 510.005 } };
    expect(compararFontes(a, b)).toEqual([]);
  });
});

describe('divergenciasDaNovaFonte', () => {
  it('nao compara a fonte nova consigo mesma', () => {
    const nova = { fonte: 'cte' as const, campos: { pesoTotal: 520 } };
    const existentes = [
      { fonte: 'cte' as const, campos: { pesoTotal: 510 } },
      { fonte: 'nfe' as const, campos: { pesoTotal: 510 } },
    ];
    const divs = divergenciasDaNovaFonte(nova, existentes);
    expect(divs).toHaveLength(1);
    expect(divs[0]!.fonteA).toBe('nfe');
  });
});
