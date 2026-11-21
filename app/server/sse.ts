// Hub SSE (spec 0004, RF13/T020): clientes registrados recebem cada
// evento appendado. Reconexao reidrata via GET /api/pedidos (RF13).

import type { FastifyReply } from 'fastify';
import type { Evento } from '../shared/model.js';

export class CanalSSE {
  private clientes = new Set<FastifyReply>();
  private timer: NodeJS.Timeout | null = null;

  registrar(reply: FastifyReply): void {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);
    this.clientes.add(reply);
    reply.raw.on('close', () => this.clientes.delete(reply));
    if (this.clientes.size === 1) this.iniciarHeartbeat();
  }

  private iniciarHeartbeat(): void {
    this.timer ??= setInterval(() => {
      this.enviar('heartbeat', { ts: new Date().toISOString() });
    }, 25_000);
    this.timer.unref?.();
  }

  enviar(nome: string, dados: unknown): void {
    const quadro = `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const reply of this.clientes) {
      try {
        reply.raw.write(quadro);
      } catch {
        this.clientes.delete(reply);
      }
    }
    if (this.clientes.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  evento(ev: Evento): void {
    this.enviar('evento', ev);
  }

  get totalClientes(): number {
    return this.clientes.size;
  }

  fechar(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.clientes.clear();
  }
}
