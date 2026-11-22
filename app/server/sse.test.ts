// Broadcast SSE (spec 0004, RF13): dois clientes recebem o evento em
// menos de 1s. Testa o hub direto, sem socket real.

import { describe, expect, it, vi } from 'vitest';
import { CanalSSE } from './sse.js';
import type { Evento } from '../shared/model.js';

function respostaFalsa() {
  const escrito: string[] = [];
  const handlers = new Map<string, () => void>();
  return {
    escrito,
    reply: {
      raw: {
        writeHead: vi.fn(),
        write: (chunk: string) => {
          escrito.push(chunk);
          return true;
        },
        on: (nome: string, fn: () => void) => handlers.set(nome, fn),
      },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any,
    fechar: () => handlers.get('close')?.(),
  };
}

const evento: Evento = {
  pedidoId: 'P1',
  seq: 1,
  tipo: 'nfe',
  payload: {},
  ts: '2026-01-01T00:00:00.000Z',
  prevHash: '0'.repeat(64),
  hash: 'a'.repeat(64),
};

describe('CanalSSE', () => {
  it('dois clientes recebem o evento em <1s', () => {
    const canal = new CanalSSE('seed');
    const a = respostaFalsa();
    const b = respostaFalsa();
    canal.registrar(a.reply, 'ws-a');
    canal.registrar(b.reply, 'ws-b');
    expect(canal.totalClientes).toBe(2);

    const t0 = Date.now();
    canal.evento(evento, 'ws-a');
    const delta = Date.now() - t0;

    expect(delta).toBeLessThan(1000);
    const quadroA = a.escrito.find((s) => s.startsWith('event: evento'));
    expect(quadroA).toBeDefined();
    expect(quadroA).toContain(evento.hash);
    expect(b.escrito.find((s) => s.startsWith('event: evento'))).toBeUndefined();
    canal.fechar();
  });

  it('evento do workspace seed alcanca todas as sessoes', () => {
    const canal = new CanalSSE('seed');
    const a = respostaFalsa();
    const b = respostaFalsa();
    canal.registrar(a.reply, 'ws-a');
    canal.registrar(b.reply, 'ws-b');

    canal.evento(evento, 'seed');
    for (const c of [a, b]) {
      expect(c.escrito.find((s) => s.startsWith('event: evento'))).toBeDefined();
    }
    canal.fechar();
  });

  it('cliente desconectado sai do registro', () => {
    const canal = new CanalSSE('seed');
    const a = respostaFalsa();
    canal.registrar(a.reply, 'ws-a');
    a.fechar();
    expect(canal.totalClientes).toBe(0);
    canal.fechar();
  });
});
