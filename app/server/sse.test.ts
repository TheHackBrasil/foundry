// Broadcast SSE (spec 0004, RF13): dois clientes recebem o evento em
// menos de 1s. Testa o hub direto, sem socket real.

import { describe, expect, it, vi } from 'vitest';
import { CanalSSE } from './sse.js';
import type { Evento } from '../shared/model.js';

function respostaFalsa(preparados: Record<string, string> = {}) {
  const escrito: string[] = [];
  const handlers = new Map<string, () => void>();
  const writeHead = vi.fn();
  const end = vi.fn(() => handlers.get('close')?.());
  return {
    escrito,
    writeHead,
    end,
    reply: {
      hijack: vi.fn(),
      getHeaders: () => preparados,
      raw: {
        writeHead,
        write: (chunk: string) => {
          escrito.push(chunk);
          return true;
        },
        end,
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

  it('o cabecalho do stream leva o que os hooks prepararam e nunca CORS aberto', () => {
    const canal = new CanalSSE('seed');
    const a = respostaFalsa({ 'set-cookie': 'foundry_ws=abc; Path=/', 'access-control-allow-origin': 'https://demo.exemplo' });
    canal.registrar(a.reply, 'ws-a');
    expect(a.reply.hijack).toHaveBeenCalledOnce();
    const cabecalhos = a.writeHead.mock.calls[0]![1] as Record<string, string>;
    expect(cabecalhos['set-cookie']).toBe('foundry_ws=abc; Path=/');
    expect(cabecalhos['access-control-allow-origin']).toBe('https://demo.exemplo');
    expect(cabecalhos['content-type']).toContain('text/event-stream');
    expect(Object.values(cabecalhos)).not.toContain('*');
    expect(a.escrito[0]).toMatch(/^retry: \d+\nevent: hello\n/);
    canal.fechar();
  });

  it('recusa acima do teto global e do teto por IP', () => {
    const canal = new CanalSSE('seed', { maxClientes: 3, maxPorIp: 2 });
    expect(canal.registrar(respostaFalsa().reply, 'ws-a', '10.0.0.1')).toBe('ok');
    expect(canal.registrar(respostaFalsa().reply, 'ws-a', '10.0.0.1')).toBe('ok');
    expect(canal.registrar(respostaFalsa().reply, 'ws-a', '10.0.0.1')).toBe('lotado_ip');
    expect(canal.registrar(respostaFalsa().reply, 'ws-b', '10.0.0.2')).toBe('ok');
    expect(canal.registrar(respostaFalsa().reply, 'ws-c', '10.0.0.3')).toBe('lotado');
    canal.fechar();
  });

  it('recicla a conexao ao passar do teto de bytes', () => {
    const canal = new CanalSSE('seed', { maxBytes: 300 });
    const a = respostaFalsa();
    canal.registrar(a.reply, 'ws-a');
    canal.evento({ ...evento, payload: { texto: 'x'.repeat(400) } }, 'ws-a');
    expect(a.end).toHaveBeenCalled();
    expect(canal.totalClientes).toBe(0);
    canal.fechar();
  });

  it('fechar encerra os streams abertos', () => {
    const canal = new CanalSSE('seed');
    const a = respostaFalsa();
    canal.registrar(a.reply, 'ws-a');
    canal.fechar();
    expect(a.end).toHaveBeenCalled();
    expect(canal.totalClientes).toBe(0);
  });
});
