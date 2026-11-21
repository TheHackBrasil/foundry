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
    const canal = new CanalSSE();
    const a = respostaFalsa();
    const b = respostaFalsa();
    canal.registrar(a.reply);
    canal.registrar(b.reply);
    expect(canal.totalClientes).toBe(2);

    const t0 = Date.now();
    canal.evento(evento);
    const delta = Date.now() - t0;

    expect(delta).toBeLessThan(1000);
    for (const c of [a, b]) {
      const quadro = c.escrito.find((s) => s.startsWith('event: evento'));
      expect(quadro).toBeDefined();
      expect(quadro).toContain(evento.hash);
    }
    canal.fechar();
  });

  it('cliente desconectado sai do registro', () => {
    const canal = new CanalSSE();
    const a = respostaFalsa();
    canal.registrar(a.reply);
    a.fechar();
    expect(canal.totalClientes).toBe(0);
    canal.fechar();
  });
});
