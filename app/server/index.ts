// API Fastify (spec 0004): ingest, pedidos, audit, SSE, simulate, anchor, revisao.
// Sessao: cookie foundry_ws isola o workspace do visitante (regulamento 6.9);
// WORKSPACE_SEED e o conteudo compartilhado, gravado so por seed.ts e IMAP. Pela
// API a seed e somente leitura (P-010).

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { raizMerkle } from '../shared/merkle.js';
import { propagarTodas } from '../shared/rules.js';
import type { CamposObservados, Divergencia } from '../shared/model.js';
import { projetar } from '../shared/projection.js';
import { ancorar } from './anchor.js';
import { configDoEnv, inteiroDoEnv, type ConfigServidor } from './config.js';
import { createDb, type Db } from './db.js';
import { imapConfigDoEnv, iniciarPolling } from './ingest/imap.js';
import { ErroParser, aprovarRevisao, ingerir } from './pipeline.js';
import { ehProcessoPrincipal } from './processo.js';
import { ErroRequisicao, GuardaEspaco, JanelaFixa, mensagens } from './protecao.js';
import { carregarSeed } from './seed.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

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
  // Padrao: configDoEnv(process.env). Testes injetam limites pequenos.
  config?: ConfigServidor;
}

// Erro 4xx do Fastify ou dos plugins vira mensagem em portugues; o texto
// original fica no log.
function mensagem4xx(err: FastifyError): string {
  switch (err.code) {
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return 'Tipo de conteúdo não suportado: envie o arquivo como multipart/form-data ou JSON.';
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
      return 'Corpo JSON vazio.';
    case 'FST_FILES_LIMIT':
    case 'FST_PARTS_LIMIT':
    case 'FST_FIELDS_LIMIT':
      return 'Envie um arquivo por vez.';
    case 'FST_INVALID_MULTIPART_CONTENT_TYPE':
      return 'Formulário multipart inválido.';
    default:
      return err instanceof SyntaxError || /JSON/i.test(err.message) ? 'Corpo JSON inválido.' : 'Requisição inválida.';
  }
}

export async function buildServer(dbInjetado?: Db, opts: BuildOpts = {}) {
  const cfg = opts.config ?? configDoEnv();
  const { seedWs, limites } = cfg;
  const app = Fastify({ logger: true });

  // Atras do proxy da hospedagem o socket e o do proxy; o IP do visitante vem
  // no cabecalho que o proxy sobrescreve (CLIENT_IP_HEADER).
  const ipDoCliente = (req: FastifyRequest): string => {
    if (cfg.ipHeader) {
      const bruto = req.headers[cfg.ipHeader];
      const valor = (Array.isArray(bruto) ? bruto[0] : bruto)?.split(',')[0]?.trim();
      if (valor) return valor;
    }
    return req.ip;
  };

  // Sem CORS_ORIGIN nenhum cabecalho CORS sai, e o navegador so deixa a propria
  // origem ler a API. O cookie da sessao exige credenciais, entao nunca "*".
  if (cfg.corsOrigens.length > 0) {
    await app.register(cors, { origin: cfg.corsOrigens, credentials: true });
  }
  await app.register(multipart, {
    limits: { fileSize: limites.bytesPorArquivo, files: 1, fields: 4, fieldSize: 1024, parts: 5 },
  });
  // Por rota (global: false): so escrita, ancora e revisao contam; leitura,
  // stream e healthcheck ficam livres.
  await app.register(rateLimit, {
    global: false,
    keyGenerator: ipDoCliente,
    errorResponseBuilder: (req, ctx) =>
      new ErroRequisicao(
        429,
        req.routeOptions.url === '/api/anchor'
          ? mensagens.muitasAncoras(Math.ceil(ctx.ttl / 1000))
          : mensagens.muitasEscritas(Math.ceil(ctx.ttl / 1000)),
      ),
  });

  app.setErrorHandler((err: FastifyError, req, reply) => {
    if (err instanceof ErroRequisicao) return reply.code(err.status).send({ erro: err.message });
    if (err instanceof ErroParser) return reply.code(422).send({ erro: err.message, tipo: 'parser' });
    const status = typeof err.statusCode === 'number' ? err.statusCode : 500;
    if (status === 413 && !['FST_FILES_LIMIT', 'FST_PARTS_LIMIT', 'FST_FIELDS_LIMIT'].includes(err.code)) {
      return reply.code(413).send({ erro: mensagens.arquivoGrande(limites.bytesPorArquivo) });
    }
    if (status >= 400 && status < 500) {
      req.log.info({ err }, 'requisicao recusada');
      return reply.code(status).send({ erro: mensagem4xx(err) });
    }
    // 5xx: o detalhe (SQL, caminho, pilha) fica no log, nunca na resposta publica.
    req.log.error({ err }, 'erro interno');
    return reply.code(500).send({ erro: 'Erro interno do servidor. Tente de novo em instantes.' });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'Rota não encontrada.' }));

  const db = dbInjetado ?? (await createDb());
  const store = new LedgerStore(db, seedWs, seedWs);
  await store.init();
  const canal = new CanalSSE(seedWs, cfg.sse);
  const guarda = new GuardaEspaco(db, limites.bytesBanco, (e) =>
    app.log.error({ err: e }, 'guarda de espaco: falha ao medir o banco'),
  );
  const pdfs = new JanelaFixa(cfg.rateLimit.pdfsPor10Min, 10 * 60_000);
  const limiteEscrita = { rateLimit: { max: cfg.rateLimit.escritasPorMinuto, timeWindow: 60_000, groupId: 'escrita' } };
  const limiteAncora = { rateLimit: { max: cfg.rateLimit.ancorasPor10Min, timeWindow: 10 * 60_000, groupId: 'ancora' } };
  // Base64 cresce 4/3; a folga cobre o resto do JSON. Acima disso o Fastify
  // responde 413 antes de montar o corpo na memoria.
  const corpoJsonMax = Math.ceil((limites.bytesPorArquivo * 4) / 3) + 64 * 1024;

  // Sessao: workspace vem so do cookie emitido pelo servidor, nunca do body.
  // Cookie igual ao WORKSPACE_SEED e recusado: a seed nao e sessao de ninguem.
  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
    if (req.url === '/api/health') return; // healthcheck da hospedagem: sem sessao
    const cookie = req.headers.cookie?.match(new RegExp(`(?:^|;\\s*)${COOKIE_WS}=([^;]+)`))?.[1];
    const valido = cookie !== undefined && REGEX_WS.test(cookie) && cookie !== seedWs;
    const ws = valido ? cookie : (opts.workspacePadrao ?? randomUUID());
    req.workspace = ws;
    if (cookie !== ws) {
      const https = String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]?.trim() === 'https';
      reply.header('set-cookie', `${COOKIE_WS}=${ws}; Path=/; HttpOnly; SameSite=Lax${https ? '; Secure' : ''}`);
    }
  });

  // Toda escrita pela API passa aqui com o workspace que ela alteraria.
  const exigirGravavel = (ws: string, acao: string): void => {
    if (ws === seedWs) throw new ErroRequisicao(403, mensagens.seedSomenteLeitura(acao));
  };

  // Store do pedido: sessao do chamador ou workspace dono do pedido (seed).
  async function storeDoPedido(sessao: LedgerStore, pedidoId: string): Promise<LedgerStore | null> {
    const dono = await sessao.wsDoPedido(pedidoId);
    return dono === null ? null : store.paraWorkspace(dono);
  }

  // Healthcheck do deploy: 200 so com o banco respondendo.
  app.get('/api/health', async (req, reply) => {
    try {
      await db.query('SELECT 1');
      return { ok: true };
    } catch (e) {
      req.log.error({ err: e }, 'health: banco indisponivel');
      return reply.code(503).send({ ok: false, erro: 'Banco de dados indisponível.' });
    }
  });

  // Ingestao: multipart (arquivo) ou JSON {nome, conteudoBase64|conteudo}. O
  // corpo e lido antes das recusas: responder com upload pela metade pode
  // virar conexao resetada no navegador em vez da mensagem.
  app.post('/api/ingest', { config: limiteEscrita, bodyLimit: corpoJsonMax }, async (req, reply) => {
    let nome: string | undefined;
    let conteudo: Buffer | undefined;

    if (req.isMultipart()) {
      const file = await req.file();
      if (!file) return reply.code(400).send({ erro: 'arquivo ausente' });
      nome = file.filename;
      conteudo = await file.toBuffer(); // acima do limite: 413 no tratador de erro
    } else {
      const body = req.body as { nome?: string; conteudo?: string; conteudoBase64?: string } | undefined;
      nome = body?.nome;
      if (body?.conteudoBase64) conteudo = Buffer.from(body.conteudoBase64, 'base64');
      else if (body?.conteudo) conteudo = Buffer.from(body.conteudo, 'utf8');
    }
    if (!nome || !conteudo || conteudo.length === 0) {
      return reply.code(400).send({ erro: 'nome e conteudo obrigatorios' });
    }
    if (conteudo.length > limites.bytesPorArquivo) {
      throw new ErroRequisicao(413, mensagens.arquivoGrande(limites.bytesPorArquivo));
    }

    exigirGravavel(req.workspace, 'enviar arquivos para eles');
    await guarda.exigirEspaco();
    const sessao = store.paraWorkspace(req.workspace);
    const uso = await sessao.uso();
    if (uso.documentos >= limites.documentosPorWorkspace || uso.eventos >= limites.eventosPorWorkspace) {
      throw new ErroRequisicao(429, mensagens.sessaoCheia(limites));
    }
    const ip = ipDoCliente(req);
    const r = await ingerir(sessao, canal, nome, conteudo, {
      limites,
      uso,
      antesDoPdf: () => {
        if (!pdfs.consumir(ip)) throw new ErroRequisicao(429, mensagens.muitosPdfs());
      },
    });
    return { ok: true, ...r, eventos: r.eventos.length };
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
  // Passa pelo mesmo onRequest das outras rotas: um stream aberto antes de
  // qualquer outra requisicao recebe o cookie e fica no workspace dele.
  app.get('/api/stream', async (req, reply) => {
    const r = canal.registrar(reply, req.workspace, ipDoCliente(req));
    if (r === 'ok') return reply;
    return reply.code(503).header('retry-after', '30').send({
      erro: r === 'lotado'
        ? 'O servidor está com muitas conexões ao vivo agora. Recarregue a página em instantes.'
        : 'Há conexões ao vivo demais abertas a partir deste endereço. Feche abas antigas da demonstração.',
    });
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
  // Pedido da seed e recusado antes de tocar a rede: o 403 nao se confunde com
  // o 503 de ancoragem nao configurada.
  app.post<{ Body: { pedidoId?: string } }>('/api/anchor', { config: limiteAncora }, async (req, reply) => {
    const { pedidoId } = req.body ?? {};
    if (!pedidoId) return reply.code(400).send({ erro: 'pedidoId obrigatorio' });
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), pedidoId);
    if (!s) return reply.code(404).send({ erro: 'pedido nao encontrado' });
    exigirGravavel(s.workspace, 'ancorar um pedido de exemplo');
    await guarda.exigirEspaco();
    const r = await ancorar(s, pedidoId);
    if (r.ok) canal.enviar('ancora', r, s.workspace);
    return r.ok ? r : reply.code(503).send(r);
  });

  // Fila de revisao (RF7/T035): docs sem pedido ou extracao incerta. A sessao
  // le a propria fila e a da seed, mas so decide os proprios itens.
  app.get('/api/revisao', async (req) => ({
    itens: await store.paraWorkspace(req.workspace).listarRevisao(),
  }));
  app.post<{ Params: { id: string }; Body: { status?: string } }>(
    '/api/revisao/:id/decisao',
    { config: limiteEscrita },
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
      const item = await s.buscarRevisao(id);
      if (!item) return reply.code(404).send({ erro: 'item nao encontrado' });
      exigirGravavel(String(item['workspace_id']), 'decidir itens da fila de revisão de exemplo');
      if (status === 'aprovado') {
        await guarda.exigirEspaco();
        const eventos = await aprovarRevisao(s, canal, id);
        if (eventos === null) return reply.code(404).send({ erro: 'item nao encontrado ou ja decidido' });
        return { ok: true, eventos: eventos.length };
      }
      if (!(await s.resolverRevisao(id, 'descartado'))) {
        return reply.code(404).send({ erro: 'item nao encontrado ou ja decidido' });
      }
      return { ok: true };
    },
  );

  // Producao: o mesmo processo serve o build da web e a API na mesma origem.
  const webDist = cfg.webDist ?? join(AQUI, '..', 'web', 'dist');
  if (existsSync(webDist)) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: webDist, dotfiles: 'ignore' });
  }

  // Streams abertos impedem o close do servidor de terminar: encerra antes.
  app.addHook('preClose', async () => {
    canal.fechar();
  });
  app.addHook('onClose', async () => {
    await db.close();
  });

  return { app, store, canal };
}

// IMAP: polling so liga quando IMAP_HOST esta configurado; canal do
// operador, grava no WORKSPACE_SEED compartilhado (store da seed).
async function ligarImap(canal: CanalSSE, store: LedgerStore): Promise<void> {
  const cfg = imapConfigDoEnv();
  if (!cfg) return;
  iniciarPolling(
    cfg,
    (nome, conteudo) =>
      ingerir(store, canal, nome, conteudo).then((r) => {
        console.log(`imap: ${nome} -> pedido ${r.pedidoId ?? 'revisao'}`);
      }),
    (nome, erro) => store.enfileirarRevisao('imap', 'anexo_rejeitado', { nome, erro }),
    (msg) => console.log(msg),
  );
  console.log(`imap: polling em ${cfg.host}:${cfg.port} a cada ${cfg.intervaloMs}ms`);
}

export { ehProcessoPrincipal };

// Boot standalone (tsx server/index.ts, ou node --import tsx no container).
if (ehProcessoPrincipal(import.meta.url, process.argv[1])) {
  await import('dotenv/config'); // carrega .env so no boot, nao nos testes
  // Depois do dotenv: PORT do .env vale. Na Railway, PORT vem injetada.
  const porta = inteiroDoEnv(process.env, 'PORT', 3000, 1);
  const host = process.env['HOST']?.trim() || '0.0.0.0';
  const { app, store, canal } = await buildServer();
  // Seed antes do listen: carregada depois, ela mandaria os eventos da seed a
  // todo stream ja aberto.
  if (process.env['SEED_ON_BOOT'] === '1') {
    const r = await carregarSeed(store, canal, (msg) => app.log.info(msg));
    app.log.info(`seed: ${r.ingeridos} doc(s) processados, ${r.pulados} arquivo(s) sem efeito`);
  }
  await ligarImap(canal, store);
  // A hospedagem manda SIGTERM no redeploy: fecha os streams e o pool antes de sair.
  for (const sinal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(sinal, () => {
      app.log.info(`${sinal}: encerrando`);
      app.close().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
  }
  try {
    await app.listen({ port: porta, host });
  } catch (e) {
    app.log.error(e);
    process.exit(1);
  }
}
