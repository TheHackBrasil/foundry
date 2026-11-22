// Hub SSE (spec 0004, RF13): cada cliente so recebe eventos do proprio
// workspace; eventos do WORKSPACE_SEED alcancam todas as sessoes.

import type { OutgoingHttpHeaders } from 'node:http';
import type { FastifyReply } from 'fastify';
import type { Evento } from '../shared/model.js';
import type { OpcoesSSE } from './config.js';

const OPCOES_PADRAO: OpcoesSSE = {
  heartbeatMs: 20_000,
  maxConexaoMs: 0,
  maxBytes: 0,
  maxClientes: 500,
  maxPorIp: 20,
  retryMs: 3_000,
};

interface Cliente {
  workspace: string;
  ip: string;
  bytes: number;
  teto: NodeJS.Timeout | null;
}

export type ResultadoRegistro = 'ok' | 'lotado' | 'lotado_ip';

export class CanalSSE {
  private clientes = new Map<FastifyReply, Cliente>();
  private timer: NodeJS.Timeout | null = null;
  private readonly opcoes: OpcoesSSE;

  constructor(private seedWorkspace = 'seed', opcoes: Partial<OpcoesSSE> = {}) {
    this.opcoes = { ...OPCOES_PADRAO, ...opcoes };
  }

  // hijack tira a resposta do ciclo do Fastify; os cabecalhos que os hooks ja
  // prepararam (set-cookie do foundry_ws, CORS) seguem no writeHead. Escrever
  // so os cabecalhos do SSE perdia o cookie e deixava o stream num workspace
  // diferente do da primeira requisicao.
  registrar(reply: FastifyReply, workspace: string, ip = ''): ResultadoRegistro {
    if (this.clientes.size >= this.opcoes.maxClientes) return 'lotado';
    if (ip && this.contarIp(ip) >= this.opcoes.maxPorIp) return 'lotado_ip';

    reply.hijack();
    const cabecalhos: OutgoingHttpHeaders = {};
    for (const [nome, valor] of Object.entries(reply.getHeaders())) {
      if (valor !== undefined) cabecalhos[nome] = valor;
    }
    reply.raw.writeHead(200, {
      ...cabecalhos,
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    const cliente: Cliente = { workspace, ip, bytes: 0, teto: null };
    this.clientes.set(reply, cliente);
    reply.raw.on('close', () => this.remover(reply));
    this.escrever(reply, cliente, `retry: ${this.opcoes.retryMs}\nevent: hello\ndata: {"ok":true}\n\n`);
    if (this.opcoes.maxConexaoMs > 0 && this.clientes.has(reply)) {
      cliente.teto = setTimeout(() => this.encerrar(reply), this.opcoes.maxConexaoMs);
      cliente.teto.unref?.();
    }
    this.iniciarHeartbeat();
    return 'ok';
  }

  private contarIp(ip: string): number {
    let n = 0;
    for (const c of this.clientes.values()) if (c.ip === ip) n += 1;
    return n;
  }

  // Heartbeat curto: o proxy da hospedagem derruba conexao sem dados (5 min na
  // Railway, 55 s no Heroku).
  private iniciarHeartbeat(): void {
    if (this.timer || this.clientes.size === 0) return;
    this.timer = setInterval(() => {
      this.enviar('heartbeat', { ts: new Date().toISOString() });
    }, this.opcoes.heartbeatMs);
    this.timer.unref?.();
  }

  private escrever(reply: FastifyReply, cliente: Cliente, quadro: string): void {
    try {
      reply.raw.write(quadro);
    } catch {
      this.remover(reply);
      return;
    }
    cliente.bytes += Buffer.byteLength(quadro);
    if (this.opcoes.maxBytes > 0 && cliente.bytes >= this.opcoes.maxBytes) this.encerrar(reply);
  }

  // Fim normal do stream: o EventSource reconecta sozinho depois do retry.
  private encerrar(reply: FastifyReply): void {
    this.remover(reply);
    try {
      reply.raw.end();
    } catch {
      // socket ja fechado
    }
  }

  private remover(reply: FastifyReply): void {
    const cliente = this.clientes.get(reply);
    if (!cliente) return;
    if (cliente.teto) clearTimeout(cliente.teto);
    this.clientes.delete(reply);
    if (this.clientes.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  // ws omitido = broadcast; ws da seed atinge todos os clientes.
  enviar(nome: string, dados: unknown, ws?: string): void {
    const quadro = `event: ${nome}\ndata: ${JSON.stringify(dados)}\n\n`;
    for (const [reply, cliente] of [...this.clientes]) {
      if (ws !== undefined && ws !== this.seedWorkspace && ws !== cliente.workspace) continue;
      this.escrever(reply, cliente, quadro);
    }
  }

  evento(ev: Evento, ws: string): void {
    this.enviar('evento', ev, ws);
  }

  get totalClientes(): number {
    return this.clientes.size;
  }

  // Encerra os streams abertos: sem isso o app.close() espera conexoes que
  // nunca terminam.
  fechar(): void {
    for (const reply of [...this.clientes.keys()]) this.encerrar(reply);
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}
