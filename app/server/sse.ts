// Hub SSE (spec 0004, RF13): cada cliente so recebe eventos do proprio
// workspace; eventos do WORKSPACE_SEED alcancam todas as sessoes.

import type { FastifyReply } from 'fastify';
import type { Evento } from '../shared/model.js';

export class CanalSSE {
  private clientes = new Map<FastifyReply, string>();
  private timer: NodeJS.Timeout | null = null;

  constructor(private seedWorkspace = 'seed') {}

  registrar(reply: FastifyReply, workspace: string): void {
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    reply.raw.write(`event: hello\ndata: {"ok":true}\n\n`);
    this.clientes.set(reply, workspace);
    reply.raw.on('close', () => this.clientes.delete(reply));
    if (this.clientes.size === 1) this.iniciarHeartbeat();
  }

  // 20 s: roteadores de hospedagem derrubam conexao ociosa (~55 s).
  private iniciarHeartbeat(): void {
    this.timer ??= setInterval(() => {
      this.enviar('heartbeat', { ts: new Date().toISOString() });
    }, 20_000);
    this.timer.unref?.();
  }

  // ws omitido = broadcast; ws da seed atinge todos os clientes.
  enviar(nome: string, dados: unknown, ws?: string): void {
    const quadro = `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const [reply, clienteWs] of this.clientes) {
      if (ws !== undefined && ws !== this.seedWorkspace && ws !== clienteWs) continue;
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

  evento(ev: Evento, ws: string): void {
    this.enviar('evento', ev, ws);
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
