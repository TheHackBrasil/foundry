// API Fastify (spec 0004): ingest, pedidos, audit, SSE, simulate, anchor, revisao.
// Sessao: cookie foundry_ws isola o workspace do visitante (regulamento 6.9);
// WORKSPACE_SEED e o conteudo compartilhado, gravado so por seed.ts e IMAP. Pela
// API a seed e somente leitura (P-010).

import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type { OutgoingHttpHeaders } from 'node:http';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { type FastifyError, type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import { simularHipotese } from '../shared/divergence.js';
import { raizMerkle } from '../shared/merkle.js';
import { propagarTodas } from '../shared/rules.js';
import {
  CAMPOS_VIGIADOS,
  PARTES,
  type CamposObservados,
  type CampoVigiado,
  type EventoStreamMandato,
  type MandatoParseado,
  type Notificacao,
  type Parte,
  type ProjecaoPedido,
  type RespostaMandato,
  type ResultadoAgente,
  type TurnoConversa,
  type ViewSpecV2,
} from '../shared/model.js';
import { projetar } from '../shared/projection.js';
import { metricasDosCasos, projetarCasos, tokenDoCaso } from '../shared/casos.js';
import { estimarCusto } from '../shared/custo.js';
import { montarComprovante } from '../shared/comprovante.js';
import type { Caso } from '../shared/model.js';
import { executarAgente } from './agente/motor.js';
import { ancorar, configAncoraDoEnv } from './anchor.js';
import { configDoEnv, inteiroDoEnv, type ConfigServidor } from './config.js';
import { listarAgenda, validarContato } from './contatos.js';
import { createDb, type Db } from './db.js';
import { imapConfigDoEnv, iniciarPolling } from './ingest/imap.js';
import { ErroLlm, llmConfigDoEnv } from './llm.js';
import {
  ErroMandato,
  executarMandato,
  interpretarMandato,
  normalizarFiltros,
  normalizarValorHipotese,
  type ResultadoExecucao,
} from './mandatos.js';
import { notificarTarefa } from './nvoip.js';
import { ErroParser, aprovarRevisao, ingerir } from './pipeline.js';
import { iniciarTickPendencias } from './pendencia.js';
import { ehProcessoPrincipal } from './processo.js';
import { ErroRequisicao, GuardaEspaco, JanelaFixa, mensagens } from './protecao.js';
import { carregarSeed } from './seed.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';
import { comporViewSpecV2, comporViewSpecV2Deterministico, gerarViewSpec, viewSpecPadrao } from './viewspec.js';

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

function dataIsoParaUtcMs(valor: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valor);
  if (!m) return null;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  const ms = Date.UTC(ano, mes - 1, dia);
  const d = new Date(ms);
  if (d.getUTCFullYear() !== ano || d.getUTCMonth() !== mes - 1 || d.getUTCDate() !== dia) return null;
  return ms;
}

function calcularAtrasoDias(proj: ProjecaoPedido): number | null {
  const porFonte = new Map<string, number>();
  for (const v of proj.versoes) {
    const prev = v.campos.previsaoEntrega;
    if (!prev) continue;
    const ms = dataIsoParaUtcMs(prev);
    if (ms !== null) porFonte.set(v.fonte, ms);
  }
  const datas = [...porFonte.values()];
  if (datas.length < 2) return null;
  return Math.round((Math.max(...datas) - Math.min(...datas)) / 86_400_000);
}

function validarCorpoMandato(body: { texto?: unknown; pedidoId?: unknown } | undefined): { texto: string; pedidoId?: string } {
  const bruto = body?.texto;
  if (typeof bruto !== 'string' || !bruto.trim()) {
    throw new ErroRequisicao(400, 'texto é obrigatório');
  }
  const texto = bruto.trim();
  if (texto.length > 1_000) throw new ErroRequisicao(400, 'texto é longo demais');
  const pidBruto = body?.pedidoId;
  if (pidBruto !== undefined && pidBruto !== null && typeof pidBruto !== 'string') {
    throw new ErroRequisicao(400, 'pedidoId inválido');
  }
  if (typeof pidBruto === 'string' && pidBruto.length > 120) {
    throw new ErroRequisicao(400, 'pedidoId é longo demais');
  }
  const pedidoId = typeof pidBruto === 'string' && pidBruto.trim() ? pidBruto.trim() : undefined;
  return pedidoId ? { texto, pedidoId } : { texto };
}

// Corpo do stream conversacional (spec 0009): 'comando' e o nome do campo,
// 'texto' segue aceito como alias do contrato anterior. historico traz os
// ultimos turnos da conversa; o servidor saneia formato, teto e tamanho —
// nada dele e persistido.
function validarCorpoConversa(
  body: { comando?: unknown; texto?: unknown; pedidoId?: unknown; historico?: unknown } | undefined,
): { texto: string; pedidoId?: string; historico?: TurnoConversa[] } {
  const bruto = body?.comando ?? body?.texto;
  if (typeof bruto !== 'string' || !bruto.trim()) {
    throw new ErroRequisicao(400, 'comando é obrigatório');
  }
  const texto = bruto.trim();
  if (texto.length > 1_000) throw new ErroRequisicao(400, 'texto é longo demais');
  const pidBruto = body?.pedidoId;
  if (pidBruto !== undefined && pidBruto !== null && typeof pidBruto !== 'string') {
    throw new ErroRequisicao(400, 'pedidoId inválido');
  }
  if (typeof pidBruto === 'string' && pidBruto.length > 120) {
    throw new ErroRequisicao(400, 'pedidoId é longo demais');
  }
  const pedidoId = typeof pidBruto === 'string' && pidBruto.trim() ? pidBruto.trim() : undefined;
  const histBruto = body?.historico;
  if (histBruto !== undefined && !Array.isArray(histBruto)) {
    throw new ErroRequisicao(400, 'historico inválido');
  }
  const historico = Array.isArray(histBruto)
    ? (histBruto as Array<Record<string, unknown>>)
        .filter(
          (t) =>
            typeof t === 'object' &&
            t !== null &&
            (t['papel'] === 'usuario' || t['papel'] === 'assistente') &&
            typeof t['texto'] === 'string' &&
            (t['texto'] as string).trim() !== '',
        )
        .slice(-20)
        .map((t) => ({ papel: t['papel'] as TurnoConversa['papel'], texto: (t['texto'] as string).trim() }))
    : undefined;
  return {
    texto,
    ...(pedidoId ? { pedidoId } : {}),
    ...(historico && historico.length > 0 ? { historico } : {}),
  };
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
  const mandatosJanela = new JanelaFixa(cfg.rateLimit.mandatosPor10Min, 10 * 60_000);
  const viewSpecJanela = new JanelaFixa(cfg.rateLimit.viewspecPor10Min, 10 * 60_000);
  const sessoesNovas = new JanelaFixa(cfg.rateLimit.sessoesNovasPor10Min, 10 * 60_000);
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

  // Compoe ViewSpecV2 deterministico enriquecido com o resumo ja produzido
  // por executarMandato (zero chamada LLM extra).
  async function montarViewSpecDoMandato(
    sessao: LedgerStore,
    texto: string,
    mandato: MandatoParseado,
    exec: ResultadoExecucao,
  ): Promise<ViewSpecV2 | undefined> {
    const alvoPrincipal = exec.alvos[0];
    if (!alvoPrincipal) return undefined;
    const s = await storeDoPedido(sessao, alvoPrincipal);
    if (!s) return undefined;
    const proj = projetar(await s.eventosDoPedido(alvoPrincipal));
    const porPedido = Array.isArray(exec.resultado['porPedido'])
      ? (exec.resultado['porPedido'] as Array<Record<string, unknown>>)
      : [];
    const primeiro = porPedido[0];
    const resumoTexto = typeof primeiro?.['resumo'] === 'string' ? primeiro['resumo'] : undefined;
    const viaBruta = primeiro?.['via'];
    const resumoVia = viaBruta === 'llm' || viaBruta === 'deterministico' ? viaBruta : undefined;
    const f = normalizarFiltros(mandato);
    const campoSimulado = exec.acao === 'simular' ? f.campo : undefined;
    const valorSimulado =
      exec.acao === 'simular' && f.campo && f.valor !== undefined
        ? normalizarValorHipotese(f.campo, f.valor)
        : undefined;

    return comporViewSpecV2Deterministico(proj, {
      ...(f.parte ? { papel: f.parte } : {}),
      pergunta: texto,
      acao: exec.acao,
      ...(resumoTexto ? { resumoTexto } : {}),
      ...(resumoVia ? { resumoVia } : {}),
      ...(campoSimulado ? { campoSimulado } : {}),
      ...(valorSimulado !== undefined ? { valorSimulado } : {}),
    });
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
      // Invariante: arquivo truncado pelo teto do busboy nunca chega ao parser
      // (sem este check ele cairia como 422 se throwFileSizeLimit mudasse).
      if (file.file.truncated) {
        throw new ErroRequisicao(413, mensagens.arquivoGrande(limites.bytesPorArquivo));
      }
    } else {
      const body = req.body as { nome?: string; conteudo?: string; conteudoBase64?: string } | undefined;
      nome = body?.nome;
      if (body?.conteudoBase64) conteudo = Buffer.from(body.conteudoBase64, 'base64');
      else if (body?.conteudo) conteudo = Buffer.from(body.conteudo, 'utf8');
    }
    if (!nome || !conteudo || conteudo.length === 0) {
      return reply.code(400).send({ erro: 'nome e conteúdo obrigatórios' });
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
    // Primeira escrita deste workspace: sem cota por IP e teto global, trocar
    // de cookie renovava a cota de graca. Sessao que ja gravou nao reconta.
    if (uso.documentos === 0 && uso.eventos === 0) {
      if (!sessoesNovas.consumir(ip)) {
        throw new ErroRequisicao(429, mensagens.sessoesNovasDemais());
      }
      if (await store.workspacesComEscrita() >= limites.workspacesComEscrita) {
        throw new ErroRequisicao(429, mensagens.demoLotada());
      }
    }
    const r = await ingerir(sessao, canal, nome, conteudo, {
      limites,
      uso,
      antesDoPdf: () => {
        if (!pdfs.consumir(ip)) throw new ErroRequisicao(429, mensagens.muitosPdfs());
      },
    });
    return { ok: true, ...r, eventos: r.eventos.length };
  });

  app.get('/api/pedidos', async (req) => {
    const sessao = store.paraWorkspace(req.workspace);
    const lista = await sessao.listarPedidos();
    const pedidos = [];
    for (const item of lista) {
      const dono = store.paraWorkspace(item.workspaceId);
      const proj = projetar(await dono.eventosDoPedido(item.pedidoId));
      const ancora = await dono.ultimoAncora(item.pedidoId);
      pedidos.push({
        ...item,
        daSessao: item.workspaceId === req.workspace,
        ...(proj.pedido ? { emitente: proj.pedido.emitente.nome, destinatario: proj.pedido.destinatario.nome } : {}),
        ...(proj.pedido?.campos.status !== undefined ? { status: proj.pedido.campos.status } : {}),
        ...(proj.pedido?.campos.previsaoEntrega !== undefined
          ? { previsaoEntrega: proj.pedido.campos.previsaoEntrega }
          : {}),
        atrasoDias: calcularAtrasoDias(proj),
        divergencias: new Set(proj.divergencias.map((d) => d.campo)).size,
        tarefas: new Set(proj.tarefas.map((t) => `${t.parte}|${t.titulo}`)).size,
        ancorado: ancora !== null,
      });
    }
    return { pedidos, workspace: req.workspace };
  });

  app.get<{ Params: { id: string } }>('/api/pedidos/:id', async (req, reply) => {
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
    if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
    return projetar(await s.eventosDoPedido(req.params.id));
  });

  app.get<{ Params: { id: string } }>('/api/pedidos/:id/versoes', async (req, reply) => {
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
    if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
    return { versoes: projetar(await s.eventosDoPedido(req.params.id)).versoes };
  });

  // rootConfere: Merkle root sobre os eventos que a ancora cobriu
  // (seq < seq do evento 'ancora'). Eventos novos nao o invalidam (RF15).
  app.get<{ Params: { id: string } }>('/api/pedidos/:id/audit', async (req, reply) => {
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
    if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
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

  // "E se?" deterministico: nada e gravado (RF12). A comparacao e a mesma de
  // divergence.ts, com tolerancia de peso; fonteA e a fonte real do valor
  // atual (a ultima que declarou o campo) e fonteB e 'manual' (spec 0007).
  app.post<{ Body: { pedidoId?: string; campos?: CamposObservados } }>(
    '/api/simulate',
    async (req, reply) => {
      const { pedidoId, campos } = req.body ?? {};
      if (!pedidoId || !campos || Object.keys(campos).length === 0) {
        return reply.code(400).send({ erro: 'pedidoId e campos obrigatórios' });
      }
      const s = await storeDoPedido(store.paraWorkspace(req.workspace), pedidoId);
      if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
      const proj = projetar(await s.eventosDoPedido(pedidoId));
      const divs = simularHipotese(proj.versoes, campos);
      return { divergencias: divs, tarefas: propagarTodas(divs), simulacao: true };
    },
  );

  // Mandato (spec 0007, RF4): texto em pt-BR vira acao tipada; a LLM so
  // traduz e a execucao e so do motor deterministico. Sem LLM configurada a
  // resposta e 503 declarativo; recusas do mandato sao 422 com motivo.
  app.post<{ Body: { texto?: unknown; pedidoId?: unknown } }>(
    '/api/mandatos',
    { config: limiteEscrita },
    async (req, reply) => {
      const { texto, pedidoId } = validarCorpoMandato(req.body);
      if (!llmConfigDoEnv()) {
        return reply.code(503).send({ erro: 'indisponivel', mensagem: mensagens.llmIndisponivel() });
      }
      if (!mandatosJanela.consumir(ipDoCliente(req))) {
        throw new ErroRequisicao(429, mensagens.muitosMandatos());
      }
      // O mandato grava eventos: a seed, que e leitura para todos, recusa.
      exigirGravavel(req.workspace, 'executar comandos');
      await guarda.exigirEspaco();
      const sessao = store.paraWorkspace(req.workspace);
      try {
        const mandato = await interpretarMandato(texto);
        const exec = await executarMandato(sessao, texto, mandato, {
          maxAlvos: cfg.mandatos.maxAlvos,
          ...(pedidoId ? { pedidoIdPadrao: pedidoId } : {}),
        });
        for (const e of exec.eventos) canal.evento(e, sessao.workspace);
        const viewSpec = await montarViewSpecDoMandato(sessao, texto, mandato, exec);
        const resposta: RespostaMandato = {
          acao: exec.acao,
          alvos: exec.alvos,
          filtros: mandato.filtros,
          ...(mandato.alvo !== undefined ? { alvo: mandato.alvo } : {}),
          resultado: exec.resultado,
          ...(viewSpec ? { viewSpec } : {}),
        };
        return reply.send(resposta);
      } catch (err) {
        if (err instanceof ErroLlm) {
          if (err.tipo === 'indisponivel') {
            return reply.code(503).send({ erro: 'indisponivel', mensagem: mensagens.llmIndisponivel() });
          }
          return reply.code(422).send({ erro: 'invalido', motivo: 'parse_falhou', mensagem: mensagens.llmInvalida() });
        }
        if (err instanceof ErroMandato) {
          return reply.code(422).send({ erro: 'invalido', motivo: err.motivo, mensagem: err.message });
        }
        throw err;
      }
    },
  );

  // Stream SSE do agente conversacional (spec 0009): o comando em pt-BR
  // entra num loop ReAct onde a LLM escolhe tools sobre o motor
  // deterministico; a trilha sai por etapa/tool/texto_delta, blocos GenUI
  // chegam quando tools visuais rodam, 'fim' carrega o ResultadoAgente e
  // 'concluido' fecha com o RespostaMandato sintetizado do contrato antigo.
  app.post<{ Body: { comando?: unknown; texto?: unknown; pedidoId?: unknown; historico?: unknown } }>(
    '/api/mandatos/stream',
    { config: limiteEscrita },
    async (req, reply) => {
      const { texto, pedidoId, historico } = validarCorpoConversa(req.body);
      if (!llmConfigDoEnv()) {
        return reply.code(503).send({ erro: 'indisponivel', mensagem: mensagens.llmIndisponivel() });
      }
      if (!mandatosJanela.consumir(ipDoCliente(req))) {
        throw new ErroRequisicao(429, mensagens.muitosMandatos());
      }
      // Tools de escrita gravam eventos: a seed, leitura para todos, recusa.
      exigirGravavel(req.workspace, 'executar comandos');
      await guarda.exigirEspaco();

      const sessao = store.paraWorkspace(req.workspace);
      const cabecalhos: OutgoingHttpHeaders = {};
      for (const [nome, valor] of Object.entries(reply.getHeaders())) {
        if (valor !== undefined) cabecalhos[nome] = valor;
      }
      reply.hijack();
      reply.raw.writeHead(200, {
        ...cabecalhos,
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-accel-buffering': 'no',
      });

      const emitir = (evento: EventoStreamMandato): void => {
        if (reply.raw.writableEnded || reply.raw.destroyed) return;
        try {
          reply.raw.write(`data: ${JSON.stringify(evento)}\n\n`);
        } catch {
          // cliente encerrou a conexao antes do fim do stream
        }
      };

      try {
        // Cliente que fecha o socket aborta as chamadas LLM do loop (o
        // sinal e combinado com o timeout por chamada dentro de llm.ts).
        const ctrl = new AbortController();
        reply.raw.on('close', () => ctrl.abort());
        const saida = await executarAgente({
          pergunta: texto,
          ...(pedidoId ? { pedidoId } : {}),
          ...(historico ? { historico } : {}),
          sessao,
          store,
          seedWs,
          onEvento: emitir,
          signal: ctrl.signal,
        });
        for (const e of saida.eventos) canal.evento(e, sessao.workspace);
        const resultado: ResultadoAgente = {
          textoFinal: saida.textoFinal,
          toolsExecutadas: saida.toolsExecutadas,
          ...(saida.pedidoIdResolvido ? { pedidoIdResolvido: saida.pedidoIdResolvido } : {}),
          ...(saida.viewSpec ? { viewSpec: saida.viewSpec } : {}),
          ...(saida.resultado ? { resultado: saida.resultado } : {}),
        };
        emitir({ tipo: 'fim', resultado });
        emitir({ tipo: 'concluido', resposta: saida.respostaCompat });
      } catch (err) {
        if (err instanceof ErroLlm) {
          const indisponivel = err.tipo === 'indisponivel';
          emitir({
            tipo: 'erro',
            status: indisponivel ? 503 : 422,
            motivo: indisponivel ? 'indisponivel' : 'parse_falhou',
            mensagem: indisponivel ? mensagens.llmIndisponivel() : mensagens.llmInvalida(),
          });
        } else if (err instanceof ErroRequisicao) {
          emitir({ tipo: 'erro', status: err.status, mensagem: err.message });
        } else {
          req.log.error({ err }, 'erro interno no stream do agente');
          emitir({ tipo: 'erro', status: 500, mensagem: 'Erro interno do servidor. Tente de novo em instantes.' });
        }
      } finally {
        if (!reply.raw.writableEnded) reply.raw.end();
      }
      return reply;
    },
  );

  // Notificacao deterministica direta (sem consumo de cota LLM): localiza a
  // tarefa mais recente da parte e dispara/registra pela Nvoip na sessao.
  app.post<{ Body: { pedidoId?: unknown; parte?: unknown; campo?: unknown } }>(
    '/api/notificar',
    { config: limiteEscrita },
    async (req, reply) => {
      const pedidoIdBruto = req.body?.pedidoId;
      const parteBruta = req.body?.parte;
      const campoBruto = req.body?.campo;
      if (typeof pedidoIdBruto !== 'string' || !pedidoIdBruto.trim()) {
        return reply.code(400).send({ erro: 'pedidoId obrigatório' });
      }
      if (typeof parteBruta !== 'string' || !(PARTES as readonly string[]).includes(parteBruta)) {
        return reply.code(400).send({ erro: `parte inválida; use uma das partes: ${PARTES.join(', ')}` });
      }
      if (campoBruto !== undefined && (typeof campoBruto !== 'string' || !(CAMPOS_VIGIADOS as readonly string[]).includes(campoBruto))) {
        return reply.code(400).send({ erro: `campo inválido; use um dos campos: ${CAMPOS_VIGIADOS.join(', ')}` });
      }
      const pedidoId = pedidoIdBruto.trim();
      const parte = parteBruta as Parte;
      const campo = campoBruto as CampoVigiado | undefined;

      exigirGravavel(req.workspace, 'enviar notificações');
      const s = await storeDoPedido(store.paraWorkspace(req.workspace), pedidoId);
      if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
      exigirGravavel(s.workspace, 'notificar sobre um pedido de exemplo');
      await guarda.exigirEspaco();

      const ev = await s.transaction(async (tx) => {
        await tx.travarPedido(pedidoId);
        const proj = projetar(await tx.eventosDoPedido(pedidoId));
        const tarefa =
          [...proj.tarefas].reverse().find((t) => t.parte === parte && (!campo || t.divergencia.campo === campo)) ?? null;
        return notificarTarefa(tx, pedidoId, tarefa, { registrarSempre: true, parte });
      });
      if (ev) canal.evento(ev, s.workspace);
      const n = ev?.payload as unknown as Notificacao | undefined;
      return reply.send({
        pedidoId,
        parte,
        status: n?.status ?? 'nao_entregue',
        ...(n?.motivo !== undefined ? { motivo: n.motivo } : {}),
        ...(n?.canal !== undefined && n.canal !== null ? { canal: n.canal } : {}),
        ...(n?.destino !== undefined && n.destino !== null ? { destino: n.destino } : {}),
        ...(n?.mensagem ? { mensagem: n.mensagem } : {}),
      });
    },
  );

  // Agenda de contatos (RF7): a sessao le a sua com a seed como fallback.
  app.get('/api/contatos', async (req) => listarAgenda(store.paraWorkspace(req.workspace)));

  app.put<{ Body: { parte?: string; nome?: string; canal?: string; destino?: string } }>(
    '/api/contatos',
    { config: limiteEscrita },
    async (req, reply) => {
      // validarContato lanca ErroRequisicao(400) com o campo errado na mensagem.
      const contato = validarContato(req.body ?? {});
      exigirGravavel(req.workspace, 'alterar a agenda de exemplo');
      await guarda.exigirEspaco();
      const sessao = store.paraWorkspace(req.workspace);
      await sessao.upsertContato(contato);
      return reply.send(contato);
    },
  );

  // View-spec por papel (RF9): v1 (padrao) ou v2 (?v=2, compositor GenUI).
  // LLM gera/refina, servidor valida, padrao deterministico cobre qualquer falha.
  app.get<{ Params: { id: string }; Querystring: { papel?: string; v?: string; pergunta?: string } }>(
    '/api/pedidos/:id/view-spec',
    async (req, reply) => {
      const versao2 = req.query.v === '2';
      const papel = req.query.papel;
      if (versao2) {
        if (papel !== undefined && papel !== '' && papel !== 'operacao' && !(PARTES as readonly string[]).includes(papel)) {
          return reply.code(400).send({ erro: `papel inválido; use uma das partes: ${PARTES.join(', ')}` });
        }
      } else if (!papel || !(PARTES as readonly string[]).includes(papel)) {
        return reply.code(400).send({ erro: `papel inválido; use uma das partes: ${PARTES.join(', ')}` });
      }
      const s = await storeDoPedido(store.paraWorkspace(req.workspace), req.params.id);
      if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
      const proj = projetar(await s.eventosDoPedido(req.params.id));
      const parteValida = papel && papel !== 'operacao' ? (papel as Parte) : undefined;
      const pergunta = typeof req.query.pergunta === 'string' && req.query.pergunta.trim() ? req.query.pergunta.trim() : undefined;
      if (!proj.pedido) {
        return reply.send(
          versao2
            ? comporViewSpecV2Deterministico(proj, { ...(parteValida ? { papel: parteValida } : {}), ...(pergunta ? { pergunta } : {}) })
            : viewSpecPadrao(papel as Parte),
        );
      }
      // Cada GET com LLM ligada e uma chamada paga: cota por IP como no
      // mandato. Sem LLM (ou no padrao acima) a rota nao tem custo e nao
      // conta a janela.
      if (llmConfigDoEnv() && !viewSpecJanela.consumir(ipDoCliente(req))) {
        throw new ErroRequisicao(429, mensagens.muitasVisoes());
      }
      if (versao2) {
        return reply.send(
          await comporViewSpecV2(proj, { ...(parteValida ? { papel: parteValida } : {}), ...(pergunta ? { pergunta } : {}) }),
        );
      }
      return reply.send(await gerarViewSpec(proj, papel as Parte));
    },
  );

  // Ancora Merkle root na Base Sepolia (T025). Falha declarada, ledger segue.
  // Pedido da seed e recusado antes de tocar a rede: o 403 nao se confunde com
  // o 503 de ancoragem nao configurada.
  app.post<{ Body: { pedidoId?: string } }>('/api/anchor', { config: limiteAncora }, async (req, reply) => {
    const { pedidoId } = req.body ?? {};
    if (!pedidoId) return reply.code(400).send({ erro: 'pedidoId obrigatório' });
    const s = await storeDoPedido(store.paraWorkspace(req.workspace), pedidoId);
    if (!s) return reply.code(404).send({ erro: 'pedido não encontrado' });
    exigirGravavel(s.workspace, 'ancorar um pedido de exemplo');
    await guarda.exigirEspaco();
    const r = await ancorar(s, pedidoId, configAncoraDoEnv(), (e) => req.log.error(e, 'ancoragem'));
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
      if (!item) return reply.code(404).send({ erro: 'item não encontrado' });
      exigirGravavel(String(item['workspace_id']), 'decidir itens da fila de revisão de exemplo');
      if (status === 'aprovado') {
        await guarda.exigirEspaco();
        const eventos = await aprovarRevisao(s, canal, id);
        if (eventos === null) return reply.code(404).send({ erro: 'item não encontrado ou já decidido' });
        return { ok: true, eventos: eventos.length };
      }
      if (!(await s.resolverRevisao(id, 'descartado'))) {
        return reply.code(404).send({ erro: 'item não encontrado ou já decidido' });
      }
      return { ok: true };
    },
  );

  // --- Casos de excecao e metricas (spec 0011) ---

  // Casos de todos os pedidos visiveis (sessao + seed), marcados pelo dono.
  async function casosDaSessao(sessao: LedgerStore): Promise<Caso[]> {
    const out: Caso[] = [];
    for (const p of await sessao.listarPedidos()) {
      const evs = await store.paraWorkspace(p.workspaceId).eventosDoPedido(p.pedidoId);
      for (const c of projetarCasos(evs)) out.push({ ...c, workspaceId: p.workspaceId });
    }
    return out;
  }

  // Resolve o dono do pedido a partir do casoId "pedidoId:seq".
  async function storeDoCaso(sessao: LedgerStore, casoId: string) {
    const pedidoId = casoId.split(':')[0] ?? '';
    if (!pedidoId) return null;
    return storeDoPedido(sessao, pedidoId);
  }

  app.get('/api/casos', async (req) => {
    const sessao = store.paraWorkspace(req.workspace);
    const casos = await casosDaSessao(sessao);
    return {
      casos: casos.map((c) => ({ ...c, daSessao: c.workspaceId === req.workspace })),
    };
  });

  app.get<{ Params: { id: string } }>('/api/casos/:id', async (req, reply) => {
    const sessao = store.paraWorkspace(req.workspace);
    const s = await storeDoCaso(sessao, req.params.id);
    if (!s) return reply.code(404).send({ erro: 'caso não encontrado' });
    const eventos = await s.eventosDoPedido(req.params.id.split(':')[0]!);
    const caso = projetarCasos(eventos).find((c) => c.id === req.params.id);
    if (!caso) return reply.code(404).send({ erro: 'caso não encontrado' });
    // O link do parceiro so aparece para a sessao dona: visitante nao ve.
    const daSessao = s.workspace === req.workspace;
    return {
      caso: {
        ...caso,
        workspaceId: s.workspace,
        daSessao,
        ...(daSessao ? { tokenParceiro: tokenDoCaso(eventos, caso) } : {}),
      },
      custo: estimarCusto(caso),
      documentos: await s.referenciasDoPedido(caso.pedidoId),
    };
  });

  // Transicoes da sessao dona: assumir, resolver e reabrir gravam caso_*.
  const transicaoCaso = (tipo: 'caso_atribuido' | 'caso_resolvido' | 'caso_reaberto') =>
    async (req: FastifyRequest<{ Params: { id: string }; Body: { parte?: string; texto?: string } }>, reply: FastifyReply) => {
      const sessao = store.paraWorkspace(req.workspace);
      const s = await storeDoCaso(sessao, req.params.id);
      if (!s) return reply.code(404).send({ erro: 'caso não encontrado' });
      exigirGravavel(s.workspace, 'alterar caso de exemplo');
      const eventos = await s.eventosDoPedido(req.params.id.split(':')[0]!);
      const caso = projetarCasos(eventos).find((c) => c.id === req.params.id);
      if (!caso) return reply.code(404).send({ erro: 'caso não encontrado' });
      if (tipo === 'caso_atribuido') {
        const parte = req.body?.parte;
        if (!parte || !PARTES.includes(parte as Parte)) {
          return reply.code(422).send({ erro: 'parte inválida', partes: PARTES });
        }
        if (caso.status === 'resolvido') {
          return reply.code(409).send({ erro: 'caso resolvido: reabra antes de atribuir' });
        }
        const ev = await s.append(caso.pedidoId, tipo, { casoId: caso.id, parte });
        canal.evento(ev, s.workspace);
      } else if (tipo === 'caso_resolvido') {
        if (caso.status === 'resolvido') return reply.code(409).send({ erro: 'caso já resolvido' });
        const texto = typeof req.body?.texto === 'string' ? req.body.texto.slice(0, 2000) : undefined;
        const ev = await s.append(caso.pedidoId, tipo, { casoId: caso.id, ...(texto ? { texto } : {}) });
        canal.evento(ev, s.workspace);
      } else {
        if (caso.status !== 'resolvido' && caso.status !== 'contestado') {
          return reply.code(409).send({ erro: 'só se reabre caso resolvido ou contestado' });
        }
        const ev = await s.append(caso.pedidoId, tipo, { casoId: caso.id });
        canal.evento(ev, s.workspace);
      }
      return { ok: true };
    };

  app.post('/api/casos/:id/assumir', transicaoCaso('caso_atribuido'));
  app.post('/api/casos/:id/resolver', transicaoCaso('caso_resolvido'));
  app.post('/api/casos/:id/reabrir', transicaoCaso('caso_reaberto'));

  // Resposta do parceiro pelo link opaco (spec 0011): sem sessao e sem 403
  // de seed — o token do evento de origem e a credencial. So o hash dele
  // vai para a trilha.
  app.post<{ Params: { id: string }; Body: { token?: string; acao?: string; texto?: string } }>(
    '/api/casos/:id/resposta',
    async (req, reply) => {
      const sessao = store.paraWorkspace(req.workspace);
      const s = await storeDoCaso(sessao, req.params.id);
      if (!s) return reply.code(404).send({ erro: 'caso não encontrado' });
      const acao = req.body?.acao;
      if (acao !== 'confirmar' && acao !== 'contestar') {
        return reply.code(422).send({ erro: 'acao deve ser confirmar ou contestar' });
      }
      const eventos = await s.eventosDoPedido(req.params.id.split(':')[0]!);
      const caso = projetarCasos(eventos).find((c) => c.id === req.params.id);
      if (!caso) return reply.code(404).send({ erro: 'caso não encontrado' });
      const token = tokenDoCaso(eventos, caso);
      if (!token || req.body?.token !== token) {
        return reply.code(403).send({ erro: 'token inválido' });
      }
      const texto = typeof req.body?.texto === 'string' ? req.body.texto.slice(0, 2000) : undefined;
      const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
      const ev = await s.append(caso.pedidoId, 'caso_resposta_parceiro', {
        casoId: caso.id,
        acao,
        ...(texto ? { texto } : {}),
        tokenHash,
      });
      canal.evento(ev, s.workspace);
      return { ok: true };
    },
  );

  // Metricas da operacao (spec 0011): derivadas so de eventos do escopo.
  app.get('/api/metricas', async (req) => {
    const sessao = store.paraWorkspace(req.workspace);
    const casos = await casosDaSessao(sessao);
    const totalPedidos = (await sessao.listarPedidos()).length;
    return { metricas: metricasDosCasos(casos, totalPedidos) };
  });

  // Comprovante verificavel (spec 0011): link-capacidade por pedido. A
  // assinatura HMAC(workspace|pedidoId) impede enumeracao e forja — sem
  // tabela, rotaciona com COMPROVANTE_SECRET. Sem env, um segredo efemero
  // por processo serve a demo (links morrem no restart).
  const segredoComprovante = process.env['COMPROVANTE_SECRET'] ?? randomBytes(32).toString('hex');
  const assinarComprovante = (workspace: string, pedidoId: string): string =>
    createHmac('sha256', segredoComprovante)
      .update(`${workspace}\n${pedidoId}`)
      .digest('base64url');

  // A sessao dona emite o link; o front monta a URL absoluta.
  app.get<{ Params: { id: string } }>('/api/pedidos/:id/comprovante', async (req, reply) => {
    const sessao = store.paraWorkspace(req.workspace);
    const dono = await sessao.wsDoPedido(req.params.id);
    if (dono === null) return reply.code(404).send({ erro: 'pedido não encontrado' });
    const url =
      `/api/comprovante/${encodeURIComponent(dono)}/${encodeURIComponent(req.params.id)}/` +
      assinarComprovante(dono, req.params.id);
    return { url };
  });

  // O link e a credencial: prova completa, sem sessao, para a terceira parte
  // refazer a cadeia e conferir a raiz ancorada on-chain. Os 3 segmentos
  // ficam abaixo do limite de parametro do roteador.
  app.get<{ Params: { workspace: string; pedidoId: string; assinatura: string } }>(
    '/api/comprovante/:workspace/:pedidoId/:assinatura',
    async (req, reply) => {
      const { workspace, pedidoId, assinatura } = req.params;
      if (assinatura !== assinarComprovante(workspace, pedidoId)) {
        return reply.code(404).send({ erro: 'comprovante inválido' });
      }
      const s = store.paraWorkspace(workspace);
      const eventos = await s.eventosDoPedido(pedidoId);
      if (eventos.length === 0) return reply.code(404).send({ erro: 'comprovante inválido' });
      return montarComprovante(pedidoId, eventos, await s.ultimoAncora(pedidoId));
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
  // Tick de pendencias (spec 0011): verifica todos os workspaces a cada
  // PENDENCIA_TICK_MS; so abre 'pendencia_aberta' onde ainda nao existe.
  iniciarTickPendencias(store, canal);
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
