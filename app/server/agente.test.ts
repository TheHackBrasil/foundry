// Suite do agente conversacional (spec 0009, T330): llm.ts com tools,
// ferramentas sobre PGlite, motor ReAct com LLM sequenciada e a rota SSE
// com socket real. LLM e Nvoip sempre com fetch mockado; o fetch do teste
// (chamadas ao app) usa a referencia real capturada antes dos stubs.

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { verificarCadeia } from '../shared/chain.js';
import type { EventoStreamMandato, ResultadoAgente } from '../shared/model.js';
import { docDataParaPayload } from '../shared/projection.js';
import { executarTool, resolverPedido, type ContextoTools } from './agente/ferramentas.js';
import { executarAgente } from './agente/motor.js';
import { createLiteDb } from './db.js';
import { buildServer } from './index.js';
import { parseNFe } from './ingest/nfe.js';
import { chatComTools, chatTextoStream } from './llm.js';
import { executarMandato } from './mandatos.js';
import { LedgerStore } from './store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const WS = '00000000-0000-4000-8000-00000000aa09';
const CHAVE = '35260123456789000123550010000000011000000019';
const CHAVE2 = '35260198765432000123550010000000022000000028';
const CHAVE_SEED = '35260123456789000123550010000000011000007777';

// Referencia real capturada antes de qualquer stubGlobal: chamadas HTTP do
// proprio teste ao app nao podem cair no mock da LLM.
const fetchReal = globalThis.fetch;

const ENV_KEYS = [
  'LLM_API_URL',
  'LLM_API_KEY',
  'LLM_MODEL',
  'LLM_TIMEOUT_MS',
  'NVOIP_API_URL',
  'NVOIP_API_KEY',
  'NVOIP_CANAL_PADRAO',
  'NVOIP_TIMEOUT_MS',
  'NVOIP_NOTIFY_ON_TASK',
] as const;

const envLlm = (): void => {
  process.env['LLM_API_URL'] = 'http://llm.test/chat';
  process.env['LLM_API_KEY'] = 'chave-teste';
};

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) delete process.env[k];
});

// Envelopes OpenAI-compativeis da conversa com tools.
const respTexto = (texto: string): Response =>
  Response.json({ choices: [{ message: { content: texto }, finish_reason: 'stop' }] });

const respTools = (
  calls: Array<{ nome: string; argumentos: unknown }>,
): Response =>
  Response.json({
    choices: [
      {
        message: {
          content: '',
          tool_calls: calls.map((c, i) => ({
            id: `call_${i}`,
            type: 'function',
            function: {
              name: c.nome,
              arguments: typeof c.argumentos === 'string' ? c.argumentos : JSON.stringify(c.argumentos),
            },
          })),
        },
        finish_reason: 'tool_calls',
      },
    ],
  });

// Fila sequencial de respostas: cada chamada LLM consome a proxima; estouro
// falha o teste na hora em vez de devolver resposta errada.
const filaLlm = (...resps: Response[]): ReturnType<typeof vi.fn> => {
  const q = [...resps];
  const f = vi.fn(async () => {
    const r = q.shift();
    if (!r) throw new Error('fila de respostas da LLM esgotada');
    return r;
  });
  vi.stubGlobal('fetch', f);
  return f;
};

const parseSse = (body: string): EventoStreamMandato[] =>
  body
    .split('\n\n')
    .map((bloco) => bloco.trim())
    .filter((bloco) => bloco.startsWith('data:'))
    .map((bloco) => JSON.parse(bloco.slice(5).trim()) as EventoStreamMandato);

const chamada = (f: ReturnType<typeof vi.fn>, i = 0): [string, { body: string }] =>
  f.mock.calls[i] as unknown as [string, { body: string }];

describe('llm.ts com tools (T310)', () => {
  it('chatComTools envia tools com tool_choice auto e devolve chamadas parseadas', async () => {
    envLlm();
    const f = filaLlm(respTools([{ nome: 'consultar_pedido', argumentos: { pedido: 'x' } }]));
    const r = await chatComTools(
      [{ role: 'user', content: 'como esta o pedido?' }],
      [{ nome: 'consultar_pedido', descricao: 'Consulta', parametros: { type: 'object' } }],
    );
    expect(r.texto).toBe('');
    expect(r.toolCalls).toEqual([{ id: 'call_0', nome: 'consultar_pedido', argumentos: { pedido: 'x' } }]);
    const corpo = JSON.parse(chamada(f)[1].body) as {
      tools: Array<{ type: string; function: { name: string } }>;
      tool_choice: string;
      reasoning_effort?: string;
    };
    expect(corpo.tools[0]?.function.name).toBe('consultar_pedido');
    expect(corpo.tool_choice).toBe('auto');
    expect(corpo.reasoning_effort).toBe('none');
  });

  it('chatComTools repete sem reasoning_effort se o provedor recusar o campo com HTTP 400', async () => {
    envLlm();
    const erro400 = new Response(
      JSON.stringify({ error: { message: "Unsupported parameter: 'reasoning_effort'" } }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    );
    const f = filaLlm(erro400, respTexto('ok sem reasoning_effort'));
    const r = await chatComTools(
      [{ role: 'user', content: 'oi' }],
      [{ nome: 'listar_pedidos', descricao: 'Lista', parametros: { type: 'object' } }],
    );
    expect(r.texto).toBe('ok sem reasoning_effort');
    expect(f).toHaveBeenCalledTimes(2);
    const primeiro = JSON.parse(chamada(f, 0)[1].body) as { reasoning_effort?: string };
    const segundo = JSON.parse(chamada(f, 1)[1].body) as { reasoning_effort?: string };
    expect(primeiro.reasoning_effort).toBe('none');
    expect(segundo.reasoning_effort).toBeUndefined();
  });

  it('argumento quebrado vira {}; chamada sem nome e descartada', async () => {
    envLlm();
    filaLlm(
      respTools([
        { nome: 'consultar_pedido', argumentos: '{nao-json' },
        { nome: '', argumentos: {} },
      ]),
    );
    const r = await chatComTools([{ role: 'user', content: 'x' }], []);
    expect(r.toolCalls).toEqual([{ id: 'call_0', nome: 'consultar_pedido', argumentos: {} }]);
  });

  it('chatTextoStream soma os deltas do SSE ate o [DONE]', async () => {
    envLlm();
    const sse =
      'data: {"choices":[{"delta":{"content":"Ola, "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"mundo."}}]}\n\n' +
      'data: [DONE]\n\n';
    filaLlm(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const deltas: string[] = [];
    const texto = await chatTextoStream([{ role: 'user', content: 'oi' }], (d) => deltas.push(d));
    expect(texto).toBe('Ola, mundo.');
    expect(deltas).toEqual(['Ola, ', 'mundo.']);
  });

  it('chatTextoStream com resposta JSON comum emite o conteudo de uma vez', async () => {
    envLlm();
    filaLlm(respTexto('resposta unica'));
    const deltas: string[] = [];
    const texto = await chatTextoStream([{ role: 'user', content: 'oi' }], (d) => deltas.push(d));
    expect(texto).toBe('resposta unica');
    expect(deltas).toEqual(['resposta unica']);
  });

  it('chatComTools com onDelta streama tokens SSE em tempo real', async () => {
    envLlm();
    const sse =
      'data: {"choices":[{"delta":{"content":"Krona "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"atrasou 5 dias."},"finish_reason":"stop"}]}\n\n' +
      'data: [DONE]\n\n';
    const f = filaLlm(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const deltas: string[] = [];
    const r = await chatComTools(
      [{ role: 'user', content: 'como esta a Krona?' }],
      [{ nome: 'consultar_pedido', descricao: 'Consulta', parametros: { type: 'object' } }],
      { onDelta: (d) => deltas.push(d) },
    );
    expect(r.texto).toBe('Krona atrasou 5 dias.');
    expect(r.streamouTexto).toBe(true);
    expect(r.toolCalls).toEqual([]);
    expect(deltas).toEqual(['Krona ', 'atrasou 5 dias.']);
    const corpo = JSON.parse(chamada(f)[1].body) as { stream?: boolean; reasoning_effort?: string };
    expect(corpo.stream).toBe(true);
    expect(corpo.reasoning_effort).toBe('none');
  });

  it('chatComTools em SSE remonta tool_calls fragmentados por indice', async () => {
    envLlm();
    const sse =
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"consultar_","arguments":"{\\"ped"}}]}}]}\n\n' +
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"pedido","arguments":"ido\\":\\"krona\\"}"}}]},"finish_reason":"tool_calls"}]}\n\n' +
      'data: [DONE]\n\n';
    filaLlm(new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const deltas: string[] = [];
    const r = await chatComTools(
      [{ role: 'user', content: 'krona' }],
      [{ nome: 'consultar_pedido', descricao: 'Consulta', parametros: { type: 'object' } }],
      { onDelta: (d) => deltas.push(d) },
    );
    expect(deltas).toEqual([]);
    expect(r.streamouTexto).toBe(false);
    expect(r.toolCalls).toEqual([{ id: 'call_a', nome: 'consultar_pedido', argumentos: { pedido: 'krona' } }]);
  });
});

describe('ferramentas do agente sobre PGlite (T311/T312)', () => {
  let store: LedgerStore;
  let sessao: LedgerStore;
  let ctx: ContextoTools;
  let db: Awaited<ReturnType<typeof createLiteDb>>;

  beforeAll(async () => {
    db = await createLiteDb();
    store = new LedgerStore(db, 'seed', 'seed');
    await store.init();
    sessao = store.paraWorkspace(WS);
    ctx = { sessao, store, seedWs: 'seed' };

    // Pedido 1 da sessao: NF-e + planilha com previsao divergente.
    const nfe = parseNFe(ler('nfe-ok.xml'));
    await sessao.append(CHAVE, 'nfe', docDataParaPayload(nfe));
    await sessao.append(CHAVE, 'planilha', {
      fonte: 'planilha',
      campos: { previsaoEntrega: '2026-01-25' },
      dados: { linha: 2 },
    });
    // Pedido 2 da sessao: emitente diferente, sem divergencia.
    await sessao.append(CHAVE2, 'nfe', {
      fonte: 'nfe',
      campos: { previsaoEntrega: '2026-02-10', status: 'emitida' },
      dados: { emitente: { nome: 'Metais Sul Ltda' }, destinatario: { nome: 'CD Norte' } },
    });
    // Divergencias e tarefas de verdade no pedido 1.
    await executarMandato(sessao, 'propague', { acao: 'propagar', filtros: { pedidoId: CHAVE } }, { maxAlvos: 5 });

    // Pedido na seed: escrita e bloqueada para as tools da sessao.
    await store.append(CHAVE_SEED, 'nfe', {
      fonte: 'nfe',
      campos: { previsaoEntrega: '2026-01-24', status: 'emitida' },
      dados: { emitente: { nome: 'PackSul Seed' }, destinatario: { nome: 'CD Anhanguera' } },
    });
  });
  afterAll(async () => {
    await db.close();
  });

  it('resolverPedido resolve por id exato, sufixo de chave e nome do emitente', async () => {
    expect((await resolverPedido(sessao, CHAVE))?.pedidoId).toBe(CHAVE);
    expect((await resolverPedido(sessao, CHAVE.slice(-6)))?.pedidoId).toBe(CHAVE);
    expect((await resolverPedido(sessao, 'fornecedor ficticio'))?.pedidoId).toBe(CHAVE);
    expect((await resolverPedido(sessao, 'metais sul'))?.pedidoId).toBe(CHAVE2);
    expect((await resolverPedido(sessao, 'packsul'))?.workspaceId).toBe('seed');
    expect(await resolverPedido(sessao, 'empresa inexistente')).toBeNull();
  });

  it('listar_pedidos traz os visiveis com contagens da projecao', async () => {
    const r = await executarTool(ctx, 'listar_pedidos', {});
    expect(r.ok).toBe(true);
    const pedidos = r.dados['pedidos'] as Array<{ pedidoId: string; divergencias: number; daSessao: boolean }>;
    const p1 = pedidos.find((p) => p.pedidoId === CHAVE)!;
    expect(p1).toMatchObject({ divergencias: 1, daSessao: true });
    expect(pedidos.some((p) => p.pedidoId === CHAVE_SEED && !p.daSessao)).toBe(true);
  });

  it('consultar_pedido devolve valores por fonte, divergencias e tarefas por setor', async () => {
    const r = await executarTool(ctx, 'consultar_pedido', { pedido: CHAVE });
    expect(r.ok).toBe(true);
    expect(r.pedidoIdResolvido).toBe(CHAVE);
    const porFonte = r.dados['valoresPorFonte'] as Array<{ fonte: string; campos: Record<string, unknown> }>;
    expect(porFonte.find((f) => f.fonte === 'nfe')?.campos['previsaoEntrega']).toBe('2026-01-20');
    expect(porFonte.find((f) => f.fonte === 'planilha')?.campos['previsaoEntrega']).toBe('2026-01-25');
    expect((r.dados['divergencias'] as unknown[]).length).toBe(1);
    const porParte = r.dados['tarefasPorParte'] as Record<string, unknown[]>;
    expect(Object.keys(porParte)).toHaveLength(5); // propagar gera uma tarefa por parte
  });

  it('comparar_fontes detalha o campo pedido com versao e divergencia', async () => {
    const r = await executarTool(ctx, 'comparar_fontes', { pedido: CHAVE, campo: 'previsaoEntrega' });
    expect(r.ok).toBe(true);
    const comp = (r.dados['comparacoes'] as Array<{ campo: string; porFonte: Array<{ fonte: string; valor: unknown }> }>)[0]!;
    expect(comp.porFonte.map((f) => `${f.fonte}:${f.valor}`)).toEqual(['nfe:2026-01-20', 'planilha:2026-01-25']);
  });

  it('simular_cenario nao grava nada e sinaliza os blocos de simulacao', async () => {
    const antes = await sessao.eventosDoPedido(CHAVE);
    const r = await executarTool(ctx, 'simular_cenario', {
      pedido: CHAVE,
      campo: 'previsaoEntrega',
      valor: '28/01/2026',
    });
    expect(r.ok).toBe(true);
    const divs = r.dados['divergencias'] as Array<{ fonteA: string; fonteB: string; valorB: string }>;
    expect(divs[0]).toMatchObject({ fonteA: 'planilha', fonteB: 'manual', valorB: '2026-01-28' });
    expect(r.blocosSugeridos).toEqual(['simulador_interativo', 'domino_impacto']);
    expect(r.eventos).toBeUndefined();
    const depois = await sessao.eventosDoPedido(CHAVE);
    expect(depois).toHaveLength(antes.length); // zero escrita (R-006)
    expect((await verificarCadeia(depois)).valida).toBe(true);
  });

  it('listar_tarefas_setor agrupa por parte com contato da agenda', async () => {
    const r = await executarTool(ctx, 'listar_tarefas_setor', { pedido: CHAVE, partes: ['cd', 'fiscal'] });
    expect(r.ok).toBe(true);
    const setores = r.dados['setores'] as Array<{ parte: string; tarefas: unknown[]; contato: unknown }>;
    expect(setores[0]?.parte).toBe('cd');
    expect(setores[0]?.tarefas.length).toBe(1);
    expect((setores[0]?.contato as { canal: string } | null)?.canal).toBe('sms');
  });

  it('consultar_auditoria confirma a cadeia integra com raiz merkle', async () => {
    const r = await executarTool(ctx, 'consultar_auditoria', { pedido: CHAVE });
    expect(r.ok).toBe(true);
    expect(r.dados['valida']).toBe(true);
    expect(typeof r.dados['raizMerkle']).toBe('string');
  });

  it('preparar_notificacao monta rascunho deterministico com contato e podeEnviar', async () => {
    const r = await executarTool(ctx, 'preparar_notificacao', { pedido: CHAVE, parte: 'cd' });
    expect(r.ok).toBe(true);
    const rascunho = r.dados['rascunho'] as { mensagemSugerida: string; campo: string } | null;
    // O rascunho vem da tarefa real: titulo + detalhe com a data nova declarada.
    expect(rascunho?.mensagemSugerida).toContain('25/01/2026');
    expect(rascunho?.campo).toBe('previsaoEntrega');
    expect(r.dados['podeEnviar']).toBe(true);
    expect(r.blocosSugeridos).toEqual(['cartoes_despacho']);
  });

  it('enviar_notificacao grava notificacao + mandato na sessao; Nvoip fora vira desligado', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const antes = (await sessao.eventosDoPedido(CHAVE)).length;
    const r = await executarTool(ctx, 'enviar_notificacao', { pedido: CHAVE, parte: 'cd' });
    expect(r.ok).toBe(true);
    expect(r.dados).toMatchObject({ parte: 'cd', status: 'nao_entregue', motivo: 'desligado' });
    expect(f).not.toHaveBeenCalled();
    expect(r.eventos?.map((e) => e.tipo)).toEqual(['notificacao', 'mandato']);
    const depois = await sessao.eventosDoPedido(CHAVE);
    expect(depois).toHaveLength(antes + 2);
    expect((await verificarCadeia(depois)).valida).toBe(true);
  });

  it('propagar_divergencias e idempotente e grava so o mandato num pedido novo', async () => {
    // CHAVE ja propagada no beforeAll: so resta o evento mandato da intencao.
    const r1 = await executarTool(ctx, 'propagar_divergencias', { pedido: CHAVE });
    expect(r1.ok).toBe(true);
    expect(r1.dados['eventosNovos']).toBe(0);
    expect(r1.eventos?.map((e) => e.tipo)).toEqual(['mandato']);

    // CHAVE2 nunca propagada e sem divergencia: recomputa, nada a gravar.
    const r2 = await executarTool(ctx, 'propagar_divergencias', { pedido: CHAVE2 });
    expect(r2.ok).toBe(true);
    expect(r2.dados).toMatchObject({ divergencias: 0, eventosNovos: 0 });
  });

  it('tools de escrita na seed devolvem seed_somente_leitura estruturado', async () => {
    const antes = (await store.eventosDoPedido(CHAVE_SEED)).length;
    for (const [nome, args] of [
      ['enviar_notificacao', { pedido: CHAVE_SEED, parte: 'cd' }],
      ['propagar_divergencias', { pedido: CHAVE_SEED }],
    ] as const) {
      const r = await executarTool(ctx, nome, args);
      expect(r.ok).toBe(false);
      expect(r.dados['erro']).toBe('seed_somente_leitura');
      expect(r.pedidoIdResolvido).toBe(CHAVE_SEED);
    }
    expect((await store.eventosDoPedido(CHAVE_SEED)).length).toBe(antes);
  });

  it('tool desconhecida e argumentos invalidos voltam como erro estruturado', async () => {
    const desconhecida = await executarTool(ctx, 'apagar_pedido', {});
    expect(desconhecida.dados['erro']).toBe('tool_desconhecida');
    const invalido = await executarTool(ctx, 'consultar_pedido', { pedido: 42 });
    expect(invalido.dados['erro']).toBe('argumentos_invalidos');
    const semParte = await executarTool(ctx, 'enviar_notificacao', { pedido: CHAVE });
    expect(semParte.dados['erro']).toBe('argumentos_invalidos');
  });
});

describe('motor do agente com LLM sequenciada (T313)', () => {
  let store: LedgerStore;
  let sessao: LedgerStore;
  let db: Awaited<ReturnType<typeof createLiteDb>>;

  beforeAll(async () => {
    db = await createLiteDb();
    store = new LedgerStore(db, 'seed', 'seed');
    await store.init();
    sessao = store.paraWorkspace(WS);
    const nfe = parseNFe(ler('nfe-ok.xml'));
    await sessao.append(CHAVE, 'nfe', docDataParaPayload(nfe));
    await sessao.append(CHAVE, 'planilha', {
      fonte: 'planilha',
      campos: { previsaoEntrega: '2026-01-25' },
      dados: { linha: 2 },
    });
    await executarMandato(sessao, 'propague', { acao: 'propagar', filtros: { pedidoId: CHAVE } }, { maxAlvos: 5 });
    await store.append(CHAVE_SEED, 'nfe', {
      fonte: 'nfe',
      campos: { previsaoEntrega: '2026-01-24', status: 'emitida' },
      dados: { emitente: { nome: 'PackSul Seed' }, destinatario: { nome: 'CD Anhanguera' } },
    });
  });
  afterAll(async () => {
    await db.close();
  });

  const base = (): Omit<Parameters<typeof executarAgente>[0], 'pergunta' | 'onEvento'> => ({
    sessao,
    store,
    seedWs: 'seed',
  });

  it('conversa pura em pt-BR: texto direto sem tools nem blocos', async () => {
    envLlm();
    filaLlm(respTexto('Posso ajudar com pedidos, divergências e avisos aos setores.'));
    const eventos: EventoStreamMandato[] = [];
    const saida = await executarAgente({ ...base(), pergunta: 'oi, quem e voce?', onEvento: (e) => eventos.push(e) });
    expect(saida.textoFinal).toContain('Posso ajudar');
    expect(saida.toolsExecutadas).toEqual([]);
    expect(saida.viewSpec).toBeUndefined();
    const deltas = eventos.filter((e) => e.tipo === 'texto_delta');
    expect(deltas.map((d) => (d as { delta: string }).delta).join('')).toBe(saida.textoFinal);
    expect(eventos.some((e) => e.tipo === 'bloco')).toBe(false);
    expect(saida.respostaCompat.acao).toBe('resumir');
  });

  it('loop multi-step: duas consultas em paralelo e resposta com pedido resolvido', async () => {
    envLlm();
    const f = filaLlm(
      respTools([
        { nome: 'consultar_pedido', argumentos: { pedido: 'fornecedor ficticio' } },
        { nome: 'comparar_fontes', argumentos: { pedido: CHAVE.slice(-6), campo: 'previsaoEntrega' } },
      ]),
      respTexto('O pedido tem uma divergência de prazo: NF-e diz 20/01 e a planilha 25/01.'),
    );
    const eventos: EventoStreamMandato[] = [];
    const saida = await executarAgente({
      ...base(),
      pergunta: 'compare as fontes desse pedido',
      onEvento: (e) => eventos.push(e),
    });
    expect(f).toHaveBeenCalledTimes(2);
    expect(saida.toolsExecutadas.map((t) => t.nome)).toEqual(['consultar_pedido', 'comparar_fontes']);
    expect(saida.toolsExecutadas.every((t) => t.status === 'concluida')).toBe(true);
    expect(saida.pedidoIdResolvido).toBe(CHAVE);
    const trilha = eventos.filter((e) => e.tipo === 'tool');
    expect(trilha.map((t) => (t as { status: string }).status)).toEqual([
      'executando',
      'executando',
      'concluida',
      'concluida',
    ]);
  });

  it('simulacao pelo agente: blocos de simulacao emitidos e nada gravado', async () => {
    envLlm();
    filaLlm(
      respTools([{ nome: 'simular_cenario', argumentos: { campo: 'previsaoEntrega', valor: '01/02/2026' } }]),
      respTexto('Se a entrega virar 01/02, a planilha briga com a NF-e.'),
    );
    const antes = (await sessao.eventosDoPedido(CHAVE)).length;
    const eventos: EventoStreamMandato[] = [];
    const saida = await executarAgente({
      ...base(),
      pergunta: 'e se a entrega virar 01/02?',
      pedidoId: CHAVE,
      onEvento: (e) => eventos.push(e),
    });
    expect(saida.eventos).toEqual([]);
    expect((await sessao.eventosDoPedido(CHAVE)).length).toBe(antes);
    const blocos = eventos.filter((e) => e.tipo === 'bloco').map((e) => (e as { bloco: { tipo: string } }).bloco.tipo);
    expect(blocos).toContain('simulador_interativo');
    expect(blocos).toContain('domino_impacto');
    expect(saida.viewSpec?.layout).toBe('simulacao');
    expect(saida.resultado?.['simulacao']).toBeDefined();
  });

  it('multi-turn: historico saneado chega na LLM e referencia do turno anterior resolve o pedido', async () => {
    envLlm();
    const f = filaLlm(
      respTools([{ nome: 'consultar_pedido', argumentos: {} }]),
      respTexto('Continuando: a entrega prevista na NF-e é 20/01.'),
    );
    const saida = await executarAgente({
      ...base(),
      pergunta: 'e qual era a previsao original mesmo?',
      pedidoId: CHAVE,
      historico: [
        { papel: 'usuario', texto: 'fale do pedido da Fornecedor Ficticio' },
        { papel: 'assistente', texto: 'Ele tem uma divergência de prazo.' },
        // Turno fora do formato e descartado pelo saneamento.
        { papel: 'sistema', texto: 'lixo' } as unknown as { papel: 'usuario'; texto: string },
      ],
    });
    expect(saida.pedidoIdResolvido).toBe(CHAVE);
    const msgs = (JSON.parse(chamada(f)[1].body) as { messages: Array<{ role: string }> }).messages;
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
  });

  it('recupera de argumento invalido e de tool inexistente dentro do loop', async () => {
    envLlm();
    const f = filaLlm(
      respTools([{ nome: 'consultar_pedido', argumentos: { pedido: 42 } }]),
      respTools([
        { nome: 'apagar_tudo', argumentos: {} },
        { nome: 'consultar_pedido', argumentos: { pedido: CHAVE } },
      ]),
      respTexto('O pedido da Fornecedor Ficticio está atrasado na planilha.'),
    );
    const saida = await executarAgente({ ...base(), pergunta: 'como esta o pedido?', onEvento: () => {} });
    expect(saida.toolsExecutadas.map((t) => t.status)).toEqual(['erro', 'erro', 'concluida']);
    expect(saida.textoFinal).toContain('Fornecedor Ficticio');
    // A role:tool da chamada invalida viajou para a LLM com o erro estruturado.
    const msgs2 = (JSON.parse(chamada(f, 1)[1].body) as { messages: Array<{ role: string; content?: string }> })
      .messages;
    const roleTool = msgs2.find((m) => m.role === 'tool')!;
    expect(roleTool.content).toContain('argumentos_invalidos');
  });

  it('escrita na seed devolve erro na trilha e o modelo explica ao usuario', async () => {
    envLlm();
    filaLlm(
      respTools([{ nome: 'propagar_divergencias', argumentos: { pedido: 'packsul' } }]),
      respTexto('Este pedido é só leitura: suba os seus arquivos para comandar.'),
    );
    const antes = (await store.eventosDoPedido(CHAVE_SEED)).length;
    const saida = await executarAgente({ ...base(), pergunta: 'propague o atraso no pedido packsul', onEvento: () => {} });
    expect(saida.toolsExecutadas).toEqual([
      { nome: 'propagar_divergencias', resumo: 'Pedido de exemplo: somente leitura', status: 'erro' },
    ]);
    expect(saida.textoFinal).toContain('só leitura');
    expect((await store.eventosDoPedido(CHAVE_SEED)).length).toBe(antes);
  });

  it('teto de iteracoes cai na sintese final com stream real de texto', async () => {
    envLlm();
    // Um Response so pode ser lido uma vez: cada iteracao pede uma copia.
    const chamadasTool = Array.from({ length: 6 }, () =>
      respTools([{ nome: 'consultar_pedido', argumentos: { pedido: CHAVE } }]),
    );
    const sse =
      'data: {"choices":[{"delta":{"content":"Resumo do que "}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"encontrei."}}]}\n\n' +
      'data: [DONE]\n\n';
    filaLlm(...chamadasTool, new Response(sse, { headers: { 'content-type': 'text/event-stream' } }));
    const eventos: EventoStreamMandato[] = [];
    const saida = await executarAgente({ ...base(), pergunta: 'detalhe tudo', pedidoId: CHAVE, onEvento: (e) => eventos.push(e) });
    expect(saida.toolsExecutadas).toHaveLength(6);
    expect(saida.textoFinal).toBe('Resumo do que encontrei.');
    const deltas = eventos.filter((e) => e.tipo === 'texto_delta').map((e) => (e as { delta: string }).delta);
    expect(deltas).toEqual(['Resumo do que ', 'encontrei.']);
  });
});

describe('POST /api/mandatos/stream com socket real (T314)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let store: LedgerStore;
  let base: string;

  beforeAll(async () => {
    const r = await buildServer(await createLiteDb(), { workspacePadrao: WS });
    app = r.app;
    store = r.store;
    const sessao = store.paraWorkspace(WS);
    const nfe = parseNFe(ler('nfe-ok.xml'));
    await sessao.append(CHAVE, 'nfe', docDataParaPayload(nfe));
    await sessao.append(CHAVE, 'planilha', {
      fonte: 'planilha',
      campos: { previsaoEntrega: '2026-01-25' },
      dados: { linha: 2 },
    });
    await app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await app.close();
  });

  const postStream = (payload: unknown) =>
    fetchReal(`${base}/api/mandatos/stream`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });

  it('emite etapa, tool, texto_delta, bloco, fim e concluido na ordem', async () => {
    envLlm();
    filaLlm(
      respTools([{ nome: 'simular_cenario', argumentos: { campo: 'previsaoEntrega', valor: '2026-02-01' } }]),
      respTexto('Simulei a entrega para 01/02: a planilha segue brigando com a NF-e.'),
    );
    const res = await postStream({ comando: 'simule a entrega para 01/02', pedidoId: CHAVE });
    expect(res.status).toBe(200);
    expect(String(res.headers.get('content-type'))).toContain('text/event-stream');
    const eventos = parseSse(await res.text());
    const tipos = eventos.map((e) => e.tipo);

    expect(tipos[0]).toBe('etapa');
    expect(tipos.at(-1)).toBe('concluido');
    expect(tipos.at(-2)).toBe('fim');
    expect(tipos.filter((t) => t === 'tool')).toHaveLength(2); // executando + concluida
    expect(tipos.indexOf('tool')).toBeLessThan(tipos.indexOf('texto_delta'));
    expect(tipos.indexOf('texto_delta')).toBeLessThan(tipos.indexOf('bloco'));

    const blocos = eventos.filter(
      (e): e is Extract<EventoStreamMandato, { tipo: 'bloco' }> => e.tipo === 'bloco',
    );
    expect(blocos.map((b) => b.bloco.tipo)).toContain('simulador_interativo');

    const fim = eventos.find((e): e is Extract<EventoStreamMandato, { tipo: 'fim' }> => e.tipo === 'fim')!;
    const resultado = fim.resultado as ResultadoAgente;
    expect(resultado.pedidoIdResolvido).toBe(CHAVE);
    expect(resultado.toolsExecutadas).toEqual([
      expect.objectContaining({ nome: 'simular_cenario', status: 'concluida' }),
    ]);
    expect(resultado.viewSpec?.layout).toBe('simulacao');
    expect(resultado.textoFinal).toContain('Simulei');

    const concluido = eventos.find(
      (e): e is Extract<EventoStreamMandato, { tipo: 'concluido' }> => e.tipo === 'concluido',
    )!;
    expect(concluido.resposta.acao).toBe('resumir');
    expect(concluido.resposta.alvos).toEqual([CHAVE]);
    expect(concluido.resposta.viewSpec?.versao).toBe(2);
  });

  it('aceita o campo texto como alias e valida historico', async () => {
    envLlm();
    filaLlm(respTexto('Sem contexto de pedido ainda.'));
    const res = await postStream({ texto: 'ola', historico: [{ papel: 'usuario', texto: 'oi' }] });
    expect(res.status).toBe(200);
    const eventos = parseSse(await res.text());
    expect(eventos.at(-1)?.tipo).toBe('concluido');

    expect((await postStream({ texto: 123 })).status).toBe(400);
    expect((await postStream({ comando: 'x', historico: 'sim' })).status).toBe(400);
  });

  it('sem LLM configurada responde 503 JSON antes de abrir o SSE', async () => {
    const res = await postStream({ comando: 'propague' });
    expect(res.status).toBe(503);
    expect(String(res.headers.get('content-type'))).toContain('application/json');
    expect(((await res.json()) as { erro: string }).erro).toBe('indisponivel');
  });

  it('falha da LLM no meio do stream vira evento erro mapeado', async () => {
    envLlm();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('rede caiu'))));
    const res = await postStream({ comando: 'detalhe o pedido' });
    expect(res.status).toBe(200);
    const eventos = parseSse(await res.text());
    const erro = eventos.find((e): e is Extract<EventoStreamMandato, { tipo: 'erro' }> => e.tipo === 'erro');
    expect(erro).toMatchObject({ status: 503, motivo: 'indisponivel' });
    expect(eventos.at(-1)?.tipo).toBe('erro');
  });
});
