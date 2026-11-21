import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, hashEvento, verificarCadeia } from './chain.js';
import type { Evento } from './model.js';

function ev(seq: number, prev: string, payload: Record<string, unknown> = {}): Evento {
  const base = {
    pedidoId: 'P1',
    seq,
    tipo: 'nfe' as const,
    payload,
    ts: '2026-01-01T00:00:00.000Z',
    prevHash: prev,
  };
  return { ...base, hash: hashEvento(base, prev) };
}

function cadeia(n: number): Evento[] {
  const eventos: Evento[] = [];
  let prev = GENESIS_HASH;
  for (let i = 1; i <= n; i++) {
    const e = ev(i, prev, { doc: i });
    eventos.push(e);
    prev = e.hash;
  }
  return eventos;
}

describe('verificarCadeia', () => {
  it('cadeia vazia e valida', () => {
    const r = verificarCadeia([]);
    expect(r.valida).toBe(true);
    expect(r.total).toBe(0);
  });

  it('cadeia integra valida', () => {
    const r = verificarCadeia(cadeia(5));
    expect(r.valida).toBe(true);
    expect(r.total).toBe(5);
  });

  it('detecta adulteracao de payload no meio', () => {
    const eventos = cadeia(5);
    eventos[2]!.payload = { doc: 'adulterado' };
    const r = verificarCadeia(eventos);
    expect(r.valida).toBe(false);
    expect(r.indiceFalha).toBe(2);
    expect(r.eventoFalha).toBe(eventos[2]);
    expect(r.hashEncontrado).toBe(eventos[2]!.hash);
    expect(r.hashEsperado).not.toBe(eventos[2]!.hash);
  });

  it('detecta adulteracao de ts', () => {
    const eventos = cadeia(3);
    eventos[0]!.ts = '2020-01-01T00:00:00.000Z';
    const r = verificarCadeia(eventos);
    expect(r.valida).toBe(false);
    expect(r.indiceFalha).toBe(0);
  });

  it('detecta elo quebrado (prevHash trocado)', () => {
    const eventos = cadeia(3);
    eventos[1]!.prevHash = 'f'.repeat(64);
    const r = verificarCadeia(eventos);
    expect(r.valida).toBe(false);
    expect(r.indiceFalha).toBe(1);
  });

  it('detecta evento removido do meio (seq fora de ordem)', () => {
    const eventos = cadeia(4);
    eventos.splice(1, 1); // remove o seq=2
    const r = verificarCadeia(eventos);
    expect(r.valida).toBe(false);
    expect(r.indiceFalha).toBe(1);
  });

  it('serializacao canonica ignora ordem das chaves', () => {
    const a = ev(1, GENESIS_HASH, { x: 1, y: { b: 2, a: 1 } });
    const b = ev(1, GENESIS_HASH, { y: { a: 1, b: 2 }, x: 1 });
    expect(a.hash).toBe(b.hash);
  });
});
