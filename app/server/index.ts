// Fastify API (spec 0004, T010/T020/T024/T025/T032): ingest, pedidos,
// versoes, audit, stream SSE, simulate, anchor e fila de revisao.

import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { raizMerkle } from '../shared/merkle.js';
import { propagarTodas } from '../shared/rules.js';
import type { CamposObservados, Divergencia } from '../shared/model.js';
import { projetar } from '../shared/projection.js';
import { ancorar } from './anchor.js';
import { createDb } from './db.js';
import { imapConfigDoEnv, iniciarPolling } from './ingest/imap.js';
import { ErroParser, aprovarRevisao, ingerir } from './pipeline.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const PORTA = Number(process.env['PORT'] ?? 3000);

export async function buildServer() {
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(multipart, { limits: { fileSize: 10 * 1024 * 1024 } });

  const db = await createDb();
  const store = new LedgerStore(db);
  await store.init();
  const canal = new CanalSSE();

  app.get('/api/health', async () => ({ ok: true }));

  // Ingestao: multipart (arquivo) ou JSON {nome, conteudoBase64|conteudo}.
  app.post('/api/ingest', async (req, reply) => {
    let nome: string | undefined;
    let conteudo: Buffer | undefined;

    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) return reply.code(400).send({ erro: 'arquivo ausente' });
      nome = file.filename;
      conteudo = await file.toBuffer();
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
      const r = await ingerir(store, canal, nome, conteudo);
      return { ok: true, ...r, eventos: r.eventos.length };
    } catch (e) {
      if (e instanceof ErroParser) {
        return reply.code(422).send({ erro: e.message, tipo: 'parser' });
      }
      throw e;
    }
  });

  app.get('/api/pedidos', async () => ({ pedidos: await store.listarPedidos() }));

  app.get<{ Params: { id: string } }>('/api/pedidos/:id', async (req, reply) => {
    const eventos = await store.eventosDoPedido(req.params.id);
    if (eventos.length === 0) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    return projetar(eventos);
  });

  app.get<{ Params: { id: string } }>('/api/pedidos/:id/versoes', async (req, reply) => {
    const eventos = await store.eventosDoPedido(req.params.id);
    if (eventos.length === 0) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    return { versoes: projetar(eventos).versoes };
  });

  // Audit: recomputa a cadeia inteira e, havendo ancora gravada,
  // confere o Merkle root atual contra o que foi para a rede — pega
  // adulteracao pos-ancoragem e truncamento de cauda que a cadeia
  // sozinha nao ve (RF15).
  app.get<{ Params: { id: string } }>('/api/pedidos/:id/audit', async (req, reply) => {
    const eventos = await store.eventosDoPedido(req.params.id);
    if (eventos.length === 0) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    const verificacao = await store.auditar(req.params.id);
    const ancora = await store.ultimoAncora(req.params.id);
    const rootAtual = raizMerkle(eventos.map((e) => e.hash));
    const rootConfere = ancora ? rootAtual === ancora['root'] : null;
    return { ...verificacao, ancora, rootAtual, rootConfere };
  });

  // SSE: fluxo ao vivo; reconexao reidrata via GET /api/pedidos/:id.
  app.get('/api/stream', async (req, reply) => {
    canal.registrar(reply);
    return reply;
  });

  // "E se?" deterministico: hipotese de campos -> divergencias -> tarefas,
  // sem gravar nada (RF12, T032).
  app.post<{ Body: { pedidoId?: string; campos?: CamposObservados } }>(
    '/api/simulate',
    async (req, reply) => {
      const { pedidoId, campos } = req.body ?? {};
      if (!pedidoId || !campos || Object.keys(campos).length === 0) {
        return reply.code(400).send({ erro: 'pedidoId e campos obrigatorios' });
      }
      const eventos = await store.eventosDoPedido(pedidoId);
      if (eventos.length === 0) return reply.code(404).send({ erro: 'pedido nao encontrado' });
      const proj = projetar(eventos);
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
    const r = await ancorar(store, pedidoId);
    if (r.ok) canal.enviar('ancora', r);
    return r.ok ? r : reply.code(503).send(r);
  });

  // Fila de revisao (RF7/T035): docs sem pedido ou extracao incerta.
  app.get('/api/revisao', async () => ({ itens: await store.listarRevisao() }));
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
      if (status === 'aprovado') {
        const eventos = await aprovarRevisao(store, canal, id);
        if (eventos === null) return reply.code(404).send({ erro: 'item nao encontrado ou ja decidido' });
        return { ok: true, eventos: eventos.length };
      }
      if (!(await store.resolverRevisao(id, 'descartado'))) {
        return reply.code(404).send({ erro: 'item nao encontrado' });
      }
      return { ok: true };
    },
  );

  app.addHook('onClose', async () => {
    canal.fechar();
    await db.close();
  });

  return { app, store, canal };
}

// IMAP opcional: liga o polling quando configurado.
async function ligarImap(canal: CanalSSE, store: LedgerStore): Promise<void> {
  const cfg = imapConfigDoEnv();
  if (!cfg) return;
  iniciarPolling(
    cfg,
    (nome, conteudo) =>
      ingerir(store, canal, nome, conteudo).then((r) => {
        console.log(`imap: ${nome} -> pedido ${r.pedidoId ?? 'revisao'}`);
      }),
    (nome, erro) =>
      store.enfileirarRevisao('imap', 'anexo_rejeitado', { nome, erro }),
    (msg) => console.log(msg),
  );
  console.log(`imap: polling em ${cfg.host}:${cfg.port} a cada ${cfg.intervaloMs}ms`);
}

// Boot standalone (tsx server/index.ts).
if (process.argv[1] && import.meta.url === new URL(`file:///${process.argv[1].replace(/\\/g, '/')}`).href) {
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
