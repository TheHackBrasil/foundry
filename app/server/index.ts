// API Fastify (spec 0004): ingest, pedidos, audit, SSE, simulate, anchor, revisao.
// Sessao: cookie foundry_ws isola o workspace do visitante (regulamento 6.9);
// WORKSPACE_SEED e o conteudo compartilhado, gravado so por seed.ts e IMAP.

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { raizMerkle } from '../shared/merkle.js';
import { propagarTodas } from '../shared/rules.js';
import type { CamposObservados, Divergencia } from '../shared/model.js';
import { projetar } from '../shared/projection.js';
import { ancorar } from './anchor.js';
import { createDb, type Db } from './db.js';
import { imapConfigDoEnv, iniciarPolling } from './ingest/imap.js';
import { ErroParser, aprovarRevisao, ingerir } from './pipeline.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const PORTA = Number(process.env['PORT'] ?? 3000);
const AQUI = dirname(fileURLToPath(import.meta.url));

declare module 'fastify' {
  interface FastifyRequest {
    workspace: string;
  }
}

const COOKIE_WS = 'foundry_ws';
const REGEX_WS = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface BuildOpts {
  // Testes fixam o workspace sem precisar de cookie; producao nunca usa.
  workspacePadrao?: string;
}

export async function buildServer(dbInjetado?: Db, opts: BuildOpts = {}) {
  const seedWs = process.env['WORKSPACE_SEED'] ?? 'seed';
  const app = Fastify({ logger: true });
  await app.register(cors, {
    origin: process.env['CORS_ORIGIN']?.split(',').map((o) => o.trim()) ?? true,
    credentials: true,
  });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  const db = dbInjetado ?? (await createDb());
  const store = new LedgerStore(db, seedWs, seedWs);
  await store.init();
  const canal = new CanalSSE(seedWs);

  // Sessao: workspace vem so do cookie emitido pelo servidor, nunca do body.
  app.addHook('onRequest', async (req, reply) => {
    const cookie = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE_WS}=([^;]+)`))?.[1];
    const ws = cookie && REGEX_WS.test(cookie) ? cookie : (opts.workspacePadrao ?? randomUUID());
    req.workspace = ws;
    if (!cookie || cookie !== ws) {
      reply.header('set-cookie', `${COOKIE_WS}=${ws}; Path=/; HttpOnly; SameSite=Lax`);
    }
  });

  // Store do pedido: sessao do chamador ou workspace dono do pedido (seed).
  async function storeDoPedido(sessao: LedgerStore, pedidoId: string): Promise<LedgerStore | null> {
    const dono = await sessao.wsDoPedido(pedidoId);
    return dono === null ? null : store.paraWorkspace(dono);
  }

  app.get('/api/health', async () => ({ ok: true }));

  // Ingestao: multipart (arquivo) ou JSON {nome, conteudoBase64|conteudo}.
  app.post('/api/ingest', async (req, reply) => {
    let nome: string | undefined;
    let conteudo: Buffer | undefined;

    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) return reply.code(400).send({ erro: 'arquivo ausente' });
      nome = file.filename;
      try {
        conteudo = await file.toBuffer();
      } catch {
        return reply.code(413).send({ erro: 'arquivo excede o limite de 10 MB' });
      }
    } else {
      const body = req.body as { nome?: string; conteudo?: string; conteudoBase64?: string } | undefined;
      nome = body?.nome;
      if (body?.conteudoBase64) conteudo = Buffer.from(body.conteudoBase64, 'base64');
      else if (body?.conteudo) conteudo = Buffer.from(body.conteudo, 'utf8');
    }
    if (!nome || !conteudo || conteudo.length === 0) {
      return reply.code(400).send({ erro: 'nome e conteudo obrigatorios' });
    }

    try {
      const r = await ingerir(store.paraWorkspace(req.workspace), canal, nome, conteudo);
      return { ok: true, ...r, eventos: r.eventos.length };
    } catch (e) {
      if (e instanceof ErroParser) {
        return reply.code(422).send({ erro: e.message, tipo: 'parser' });
      }
      throw e;
    }
  });

  app.get('/api/pedidos', async (req) => ({
    pedidos: await store.paraWorkspace(req.workspace).listarPedidos(),
    workspace: req.workspace,
  }));

  app.get<{ Params: { id: string } }>('/api/pedidos/:id', async (req, reply) => {
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
    if (!s) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    return projetar(await s.eventosDoPedido(req.params.id));
  });

  app.get<{ Params: { id: string } }>('/api/pedidos/:id/versoes', async (req, reply) => {
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
    if (!s) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    return { versoes: projetar(await s.eventosDoPedido(req.params.id)).versoes };
  });

  // rootConfere: Merkle root sobre os eventos que a ancora cobriu
  // (seq < seq do evento 'ancora'). Eventos novos nao o invalidam (RF15).
  app.get<{ Params: { id: string } }>('/api/pedidos/:id/audit', async (req, reply) => {
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
    if (!s) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    const eventos = await s.eventosDoPedido(req.params.id);
    const verificacao = await s.auditar(req.params.id);
    const ancora = await s.ultimoAncora(req.params.id);
    const rootAtual = raizMerkle(eventos.map((e) => e.hash));
    const seqAncora = [...eventos].reverse().find((e) => e.tipo === 'ancora')?.seq;
    const rootHistorico = seqAncora === undefined
      ? null
      : raizMerkle(eventos.filter((e) => e.seq !== undefined && e.seq < seqAncora).map((e) => e.hash));
    const rootConfere = ancora && rootHistorico !== null ? rootHistorico === ancora['root'] : null;
    return {
      ...verificacao,
      ancora,
      rootAtual,
      rootHistorico,
      rootConfere,
      eventosAncorados: seqAncora === undefined ? null : seqAncora - 1,
    };
  });

  // SSE: fluxo ao vivo do workspace da sessao + seed; reconexao reidrata via GET.
  app.get('/api/stream', async (req, reply) => {
    canal.registrar(reply, req.workspace);
    return reply;
  });

  // "E se?" deterministico: nada e gravado (RF12).
  app.post<{ Body: { pedidoId?: string; campos?: CamposObservados } }>(
    '/api/simulate',
    async (req, reply) => {
      const { pedidoId, campos } = req.body ?? {};
      if (!pedidoId || !campos || Object.keys(campos).length === 0) {
        return reply.code(400).send({ erro: 'pedidoId e campos obrigatorios' });
      }
      const s = await storeDoPedido(store.paraWorkspace(req.workspace), pedidoId);
      if (!s) return reply.code(404).send({ erro: 'pedido nao encontrado' });
      const proj = projetar(await s.eventosDoPedido(pedidoId));
      const atual = proj.pedido?.campos ?? {};
      const divs: Divergencia[] = [];
      for (const [campo, valorNovo] of Object.entries(campos)) {
        const valorAtual = (atual as Record<string, unknown>)[campo];
        if (valorAtual !== undefined && valorAtual !== valorNovo) {
          divs.push({
            campo: campo as Divergencia['campo'],
            fonteA: 'planilha',
            fonteB: 'manual',
            valorA: valorAtual,
            valorB: valorNovo,
          });
        }
      }
      return { divergencias: divs, tarefas: propagarTodas(divs), simulacao: true };
    },
  );

  // Ancora Merkle root na Base Sepolia (T025). Falha declarada, ledger segue.
  app.post<{ Body: { pedidoId?: string } }>('/api/anchor', async (req, reply) => {
    const { pedidoId } = req.body ?? {};
    if (!pedidoId) return reply.code(400).send({ erro: 'pedidoId obrigatorio' });
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), pedidoId);
    if (!s) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    const r = await ancorar(s, pedidoId);
    if (r.ok) canal.enviar('ancora', r, s.workspace);
    return r.ok ? r : reply.code(503).send(r);
  });

  // Fila de revisao (RF7/T035): docs sem pedido ou extracao incerta.
  app.get('/api/revisao', async (req) => ({
    itens: await store.paraWorkspace(req.workspace).listarRevisao(),
  }));
  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    '/api/revisao/:id/decisao',
    async (req, reply) => {
      if (!/^\d+$/.test(req.params.id)) {
        return reply.code(400).send({ erro: 'id deve ser inteiro' });
      }
      const status = req.body?.status;
      if (status !== 'aprovado' && status !== 'descartado') {
        return reply.code(400).send({ erro: 'status deve ser aprovado ou descartado' });
      }
      const id = Number(req.params.id);
      const s = store.paraWorkspace(req.workspace);
      if (status === 'aprovado') {
        const eventos = await aprovarRevisao(s, canal, id);
        if (eventos === null) return reply.code(404).send({ erro: 'item nao encontrado ou ja decidido' });
        return { ok: true, eventos: eventos.length };
      }
      if (!(await s.resolverRevisao(id, 'descartado'))) {
        return reply.code(404).send({ erro: 'item nao encontrado' });
      }
      return { ok: true };
    },
  );

  // Producao: serve o build da web quando app-demo gerar app/web/dist.
  const webDist = join(AQUI, '..', 'web', 'dist');
  if (existsSync(webDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: webDist });
  }

  app.addHook('onClose', async () => {
    canal.fechar();
    await db.close();
  });

  return { app, store, canal };
}

// IMAP: polling so liga quando IMAP_HOST esta configurado; canal do
// operador, grava no WORKSPACE_SEED compartilhado.
async function ligarImap(canal: CanalSSE, store: LedgerStore): Promise<void> {
  const cfg = imapConfigDoEnv();
  if (!cfg) return;
  const seedWs = process.env['WORKSPACE_SEED'] ?? 'seed';
  iniciarPolling(
    cfg,
    (nome, conteudo) =>
      ingerir(store.paraWorkspace(seedWs), canal, nome, conteudo).then((r) => {
        console.log(`imap: ${nome} -> pedido ${r.pedidoId ?? 'revisao'}`);
      }),
    (nome, erro) =>
      store.paraWorkspace(seedWs).enfileirarRevisao('imap', 'anexo_rejeitado', { nome, erro }),
    (msg) => console.log(msg),
  );
  console.log(`imap: polling em ${cfg.host}:${cfg.port} a cada ${cfg.intervaloMs}ms`);
}

// Boot standalone (tsx server/index.ts).
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
  await import('dotenv/config'); // carrega .env so no boot, nao nos testes
  const { app, store, canal } = await buildServer();
  await ligarImap(canal, store);
  try {
    await app.listen({ port: PORTA, host: '0.0.0.0' });
    console.log(`api em http://localhost:${PORTA}`);
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
