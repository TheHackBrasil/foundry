import { describe, expect, it } from 'vitest';
import { propagar, propagarTodas } from './rules.js';
import type { Divergencia } from './model.js';

const atraso: Divergencia = {
  campo: 'previsaoEntrega',
  fonteA: 'nfe',
  fonteB: 'cce',
  valorA: '2026-11-22',
  valorB: '2026-11-25',
};

describe('propagar', () => {
  it('atraso propaga para as 5 partes', () => {
    const tarefas = propagar(atraso);
    expect(tarefas).toHaveLength(5);
    expect(new Set(tarefas.map((t) => t.parte))).toEqual(
      new Set(['fornecedor', 'transportadora', 'cd', 'fiscal', 'financeiro']),
    );
    expect(tarefas.every((t) => t.divergencia === atraso)).toBe(true);
  });

  it('peso propaga para transportadora, fiscal e financeiro', () => {
    const d: Divergencia = {
      campo: 'pesoTotal',
      fonteA: 'nfe',
      fonteB: 'cte',
      valorA: 510,
      valorB: 520,
    };
    expect(propagar(d).map((t) => t.parte)).toEqual([
      'transportadora',
      'fiscal',
      'financeiro',
    ]);
  });

  it('volumes propaga para cd e transportadora', () => {
    const d: Divergencia = {
      campo: 'volumes',
      fonteA: 'nfe',
      fonteB: 'planilha',
      valorA: 10,
      valorB: 8,
    };
    expect(propagar(d).map((t) => t.parte)).toEqual(['cd', 'transportadora']);
  });

  it('deterministica: mesma entrada, mesma saida', () => {
    expect(propagar(atraso)).toEqual(propagar(atraso));
  });
});

describe('propagarTodas', () => {
  it('preserva ordem das divergencias', () => {
    const t = propagarTodas([atraso, { ...atraso, campo: 'volumes' as const }]);
    expect(t.length).toBe(5 + 2);
    expect(t[0]!.divergencia.campo).toBe('previsaoEntrega');
    expect(t[5]!.divergencia.campo).toBe('volumes');
  });
});
