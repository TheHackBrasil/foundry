// Testes da camada AI operacional (spec 0007). Moram em shared/ porque os
// paths da frente ai-mandatos (speckit/frentes.json) cobrem shared/ inteiro
// e so os .ts nomeados de server/. LLM e Nvoip sempre com fetch mockado;
// banco PGlite em memoria como nos testes do core.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { verificarCadeia } from './chain.js';
import { simularHipotese } from './divergence.js';
import { CANAIS_CONTATO, type BlocoGenUI, type Contato, type Evento, type EventoStreamMandato, type ResumoPedidoLista, type Tarefa, type ViewSpecV2 } from './model.js';
import { camposPorFonte, docDataParaPayload, projetar } from './projection.js';
import { bootstrapContatos, listarAgenda, validarContato } from '../server/contatos.js';
import { createLiteDb } from '../server/db.js';
import { buildServer } from '../server/index.js';
import { parseNFe } from '../server/ingest/nfe.js';
import { ErroLlm, chatJson } from '../server/llm.js';
import { executarMandato, validarMandato } from '../server/mandatos.js';
import { aplicarMapeamento, aplicarTemplate, proporMapeamento } from '../server/mapeamento.js';
import { notificarTarefa } from '../server/nvoip.js';
import { carregarSeed } from '../server/seed.js';
import { extrairSinais } from '../server/sinal.js';
import { CanalSSE } from '../server/sse.js';
import {
  comporViewSpecV2,
  comporViewSpecV2Deterministico,
  gerarViewSpec,
  validarViewSpec,
  viewSpecPadrao,
} from '../server/viewspec.js';
import type { LedgerStore } from '../server/store.js';

const CHAVE = '35260123456789000123550010000000011000000019';
const FIX = join(dirname(fileURLToPath(import.meta.url)), '../server/fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const WS = '00000000-0000-4000-8000-00000000bb01';

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
  'RATE_LIMIT_VIEWSPEC_PER_10MIN',
] as const;

const envLlm = (): void => {
  process.env['LLM_API_URL'] = 'http://llm.test/chat';
  process.env['LLM_API_KEY'] = 'chave-teste';
};
const envNvoip = (): void => {
  process.env['NVOIP_API_URL'] = 'http://nvoip.test/send';
  process.env['NVOIP_API_KEY'] = 'chave-teste';
};

// Os mocks de fetch nao declaram parametros; o cast expoe url e init da chamada.
const chamada = (f: ReturnType<typeof vi.fn>, i = 0): [string, { body: string; headers: Record<string, string> }] =>
  f.mock.calls[i] as unknown as [string, { body: string; headers: Record<string, string> }];

// Envelope OpenAI-compativel com o conteudo JSON do assistente dentro.
const respostaChat = (conteudo: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: JSON.stringify(conteudo) } }] }),
  }) as Response;

// Envelopes do agente conversacional (spec 0009): texto final ou tool_calls.
const respAgenteTexto = (texto: string): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ choices: [{ message: { content: texto }, finish_reason: 'stop' }] }),
  }) as Response;

const respAgenteTools = (calls: Array<{ nome: string; argumentos: unknown }>): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({
      choices: [
        {
          message: {
            content: '',
            tool_calls: calls.map((c, i) => ({
              id: `call_${i}`,
              type: 'function',
              function: { name: c.nome, arguments: JSON.stringify(c.argumentos) },
            })),
          },
          finish_reason: 'tool_calls',
        },
      ],
    }),
  }) as Response;

const evFake = (tipo: Evento['tipo'], payload: Record<string, unknown>): Evento => ({
  pedidoId: 'pedido-x',
  tipo,
  payload,
  ts: '2026-01-20T12:00:00.000Z',
  prevHash: '',
  hash: '',
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe('simularHipotese', () => {
  const versoes = [
    { fonte: 'nfe' as const, campos: { previsaoEntrega: '2026-01-20', pesoTotal: 510, status: 'emitida' } },
    { fonte: 'cte' as const, campos: { pesoTotal: 520, status: 'em_transito' } },
  ];

  it('fonteA e a ultima fonte que declarou o campo; fonteB e manual', () => {
    expect(simularHipotese(versoes, { previsaoEntrega: '2026-02-01' })).toEqual([
      { campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'manual', valorA: '2026-01-20', valorB: '2026-02-01' },
    ]);
    expect(simularHipotese(versoes, { pesoTotal: 900 })[0]?.fonteA).toBe('cte');
  });

  it('peso respeita a tolerancia de 0,01 kg', () => {
    expect(simularHipotese(versoes, { pesoTotal: 520.005 })).toEqual([]);
    expect(simularHipotese(versoes, { pesoTotal: 520.02 })).toHaveLength(1);
  });

  it('campo sem declaracao e campo desconhecido nao divergem', () => {
    expect(simularHipotese(versoes, { volumes: 5 })).toEqual([]);
    expect(simularHipotese(versoes, { previsaoEntrega: '2026-01-20' })).toEqual([]);
  });
});

describe('projecao com sinal, notificacao e mandato', () => {
  it('sinal e notificacao caem nos campos proprios; mandato nao altera nada', () => {
    const proj = projetar([
      evFake('nfe', { fonte: 'nfe', campos: { status: 'emitida' }, dados: {} }),
      evFake('sinal', { tipo: 'atraso_avisado', resumo: 'fornecedor avisou atraso', confianca: 0.9, fonte: 'imap' }),
      evFake('notificacao', { parte: 'cd', canal: 'sms', destino: '+55 11', mensagem: 'oi', status: 'entregue' }),
      evFake('mandato', { ator: 'workspace', texto: 'propague', acao: 'propagar', filtros: {}, resultado: {} }),
    ]);
    expect(proj.sinais).toHaveLength(1);
    expect(proj.sinais[0]?.tipo).toBe('atraso_avisado');
    expect(proj.notificacoes).toHaveLength(1);
    expect(proj.divergencias).toEqual([]);
    expect(proj.tarefas).toEqual([]);
    expect(proj.totalEventos).toBe(4);
  });
});

describe('chatJson', () => {
  it('sem URL/chave lanca indisponivel sem tocar a rede', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(chatJson([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ tipo: 'indisponivel' });
    expect(f).not.toHaveBeenCalled();
  });

  it('envia response_format json_object e devolve o conteudo parseado', async () => {
    envLlm();
    const f = vi.fn(async () => respostaChat({ ok: 1 }));
    vi.stubGlobal('fetch', f);
    const r = await chatJson([{ role: 'user', content: 'x' }], { maxTokens: 50 });
    expect(r).toEqual({ ok: 1 });
    const init = chamada(f)[1];
    expect(JSON.parse(init.body).response_format).toEqual({ type: 'json_object' });
    expect(init.headers['Authorization']).toBe('Bearer chave-teste');
  });

  it('HTTP nao-ok e erro de rede sao indisponivel; envelope ruim e invalido', async () => {
    envLlm();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 500, json: async () => ({}) }) as Response));
    await expect(chatJson([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ tipo: 'indisponivel' });
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('rede caiu'))));
    await expect(chatJson([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ tipo: 'indisponivel' });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }) as Response));
    await expect(chatJson([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ tipo: 'invalido' });
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'nao-json' } }] }) }) as Response),
    );
    await expect(chatJson([{ role: 'user', content: 'x' }])).rejects.toMatchObject({ tipo: 'invalido' });
    expect(ErroLlm).toBeDefined();
  });
});

describe('extrairSinais', () => {
  it('sem LLM devolve [] e nao chama a rede', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(extrairSinais('previsao furou', 'imap')).resolves.toEqual([]);
    expect(f).not.toHaveBeenCalled();
  });

  it('filtra por tipo conhecido e pelo limiar de confianca', async () => {
    envLlm();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaChat({
          sinais: [
            { tipo: 'atraso_avisado', resumo: 'entrega atrasa dois dias', confianca: 0.9 },
            { tipo: 'outro', resumo: 'talvez algo', confianca: 0.3 },
            { tipo: 'apocalipse', resumo: 'tipo inventado', confianca: 0.99 },
          ],
        }),
      ),
    );
    const sinais = await extrairSinais('a entrega atrasa dois dias', 'imap');
    expect(sinais).toHaveLength(1);
    expect(sinais[0]).toMatchObject({ tipo: 'atraso_avisado', fonte: 'imap', confianca: 0.9 });
  });

  it('resposta invalida da LLM devolve [] sem lancar', async () => {
    envLlm();
    vi.stubGlobal('fetch', vi.fn(async () => respostaChat({ sinais: 'nao-lista' })));
    await expect(extrairSinais('texto', 'cce')).resolves.toEqual([]);
  });
});

describe('validarMandato', () => {
  it('aceita o schema fechado e normaliza filtros', () => {
    expect(validarMandato({ acao: 'propagar', filtros: { pedidoId: CHAVE, parte: 'cd' } })).toEqual({
      acao: 'propagar',
      filtros: { pedidoId: CHAVE, parte: 'cd' },
    });
    expect(validarMandato({ acao: 'notificar', filtros: {}, alvo: 'cd' }).alvo).toBe('cd');
  });

  it('acao fora do conjunto e acao_ambigua (inclusive "nenhuma")', () => {
    for (const acao of ['nenhuma', 'apagar', 'cancelar_pedido']) {
      expect(() => validarMandato({ acao, filtros: {} })).toThrowError(
        expect.objectContaining({ motivo: 'acao_ambigua' }) as object,
      );
    }
  });

  it('forma quebrada e enum inventado sao parse_falhou', () => {
    const casos: unknown[] = [
      null,
      'propagar',
      { acao: 5 },
      { acao: 'propagar', filtros: 'x' },
      { acao: 'propagar', filtros: { parte: 'gerente' } },
      { acao: 'propagar', filtros: { campo: 'cnpj' } },
      { acao: 'simular', filtros: { campo: 'status', valor: { rico: true } } },
    ];
    for (const c of casos) {
      expect(() => validarMandato(c)).toThrowError(expect.objectContaining({ motivo: 'parse_falhou' }) as object);
    }
  });
});

describe('validarContato', () => {
  it('normaliza e fixa fonte manual; parte/canal/texto errado lanca 400', () => {
    expect(validarContato({ parte: 'cd', nome: ' CD ', canal: 'sms', destino: ' +55 ' })).toEqual({
      parte: 'cd',
      nome: 'CD',
      canal: 'sms',
      destino: '+55',
      fonte: 'manual',
    });
    for (const ruim of [
      { parte: 'gerente', nome: 'x', canal: 'sms', destino: '1' },
      { parte: 'cd', nome: 'x', canal: 'pombo', destino: '1' },
      { parte: 'cd', nome: '', canal: 'sms', destino: '1' },
      { parte: 'cd', nome: 'x', canal: 'sms', destino: 'a'.repeat(200) },
    ]) {
      expect(() => validarContato(ruim)).toThrowError(expect.objectContaining({ status: 400 }) as object);
    }
  });
});

describe('camada ai com PGlite', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let store: LedgerStore;
  let sessao: LedgerStore;

  beforeAll(async () => {
    const r = await buildServer(await createLiteDb(), { workspacePadrao: WS });
    app = r.app;
    store = r.store;
    await app.ready();
    sessao = store.paraWorkspace(WS);
    // Pedido da sessao: NF-e + promessa declarada pela transportadora
    // (20/01) + planilha com previsao divergente (25/01). A NF-e nao carrega
    // data: a divergencia honesta nasce entre declaracao e planilha.
    const nfe = parseNFe(ler('nfe-ok.xml'));
    await sessao.append(CHAVE, 'nfe', docDataParaPayload(nfe));
    await sessao.append(CHAVE, 'status_declarado', {
      fonte: 'email_transportadora',
      campos: { previsaoEntrega: '2026-01-20' },
      dados: { origem: 'confirmacao_inicial' },
    });
    await sessao.append(CHAVE, 'planilha', {
      fonte: 'planilha',
      campos: { previsaoEntrega: '2026-01-25' },
      dados: { linha: 2 },
    });
  });
  afterAll(async () => {
    await app.close();
  });

  it('mandato propagar repropaga divergencias pelo motor e grava evento mandato', async () => {
    const exec = await executarMandato(
      sessao,
      'propague o atraso',
      { acao: 'propagar', filtros: { pedidoId: CHAVE } },
      { maxAlvos: 5 },
    );
    expect(exec.alvos).toEqual([CHAVE]);
    const porPedido = (exec.resultado['porPedido'] as Array<{ divergencias: unknown[]; tarefas: Tarefa[] }>)[0]!;
    expect(porPedido.divergencias).toHaveLength(1);
    expect(porPedido.tarefas).toHaveLength(5); // uma por parte, como no ingest

    const evs = await sessao.eventosDoPedido(CHAVE);
    const mandato = evs.at(-1)!;
    expect(mandato.tipo).toBe('mandato');
    expect(mandato.payload).toMatchObject({ acao: 'propagar', ator: 'workspace' });
    expect((await verificarCadeia(evs)).valida).toBe(true);

    // Idempotente: segunda execucao nao duplica divergencia nem tarefa. A
    // corrida real (dois propagar simultaneos lendo eventoExiste=false) e
    // serializada por tx.travarPedido no topo da transacao, mesmo advisory
    // lock do pipeline: depende de pg.Pool e fica pinada por inspecao, pois
    // a PGlite serializa numa conexao so.
    const exec2 = await executarMandato(sessao, 'propague de novo', { acao: 'propagar', filtros: { pedidoId: CHAVE } }, { maxAlvos: 5 });
    expect(exec2.resultado['novosEventos']).toBe(0);
    expect((await sessao.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'divergencia')).toHaveLength(1);
  });

  it('mandato propagar resolve pedido pelo nome do fornecedor', async () => {
    const exec = await executarMandato(
      sessao,
      'propague o atraso pros pedidos do fornecedor Ficticio',
      { acao: 'propagar', filtros: { fornecedor: 'Ficticio' } },
      { maxAlvos: 5 },
    );
    expect(exec.alvos).toEqual([CHAVE]);
  });

  it('fornecedor inexistente e filtro largo recusam com motivo', async () => {
    await expect(
      executarMandato(sessao, 'x', { acao: 'propagar', filtros: { fornecedor: 'Nao Existe SA' } }, { maxAlvos: 5 }),
    ).rejects.toMatchObject({ motivo: 'sem_alvo' });

    const outro = 'pedido-largo-2';
    await sessao.append(outro, 'nfe', { fonte: 'nfe', campos: {}, dados: {} });
    await expect(
      executarMandato(sessao, 'propague tudo', { acao: 'propagar', filtros: {} }, { maxAlvos: 1 }),
    ).rejects.toMatchObject({ motivo: 'filtro_largo' });
  });

  it('mandato simular grava so o evento mandato e usa a fonte real', async () => {
    const antes = (await sessao.eventosDoPedido(CHAVE)).length;
    const exec = await executarMandato(
      sessao,
      'simule a entrega dia primeiro',
      { acao: 'simular', filtros: { pedidoId: CHAVE, campo: 'previsaoEntrega', valor: '2026-02-01' } },
      { maxAlvos: 5 },
    );
    const porPedido = (
      exec.resultado['porPedido'] as Array<{ divergencias: Array<{ fonteA: string; fonteB: string; valorB: string }> }>
    )[0]!;
    // fonteA e a fonte real do valor atual: a planilha declarou a data por ultimo.
    expect(porPedido.divergencias[0]).toMatchObject({ fonteA: 'planilha', fonteB: 'manual', valorA: '2026-01-25', valorB: '2026-02-01' });
    expect(exec.resultado['simulacao']).toBe(true);
    const evs = await sessao.eventosDoPedido(CHAVE);
    expect(evs).toHaveLength(antes + 1); // so o mandato
    expect(evs.at(-1)!.tipo).toBe('mandato');
  });

  it('mandato simular sem valor e acao_ambigua', async () => {
    await expect(
      executarMandato(sessao, 'simule', { acao: 'simular', filtros: { pedidoId: CHAVE, campo: 'status' } }, { maxAlvos: 5 }),
    ).rejects.toMatchObject({ motivo: 'acao_ambigua' });
  });

  it('mandato resumir sem LLM cai no texto deterministico', async () => {
    const exec = await executarMandato(
      sessao,
      'resuma o pedido para o cd',
      { acao: 'resumir', filtros: { pedidoId: CHAVE, parte: 'cd' } },
      { maxAlvos: 5 },
    );
    const porPedido = (exec.resultado['porPedido'] as Array<{ resumo: string; via: string }>)[0]!;
    expect(porPedido.via).toBe('deterministico');
    expect(porPedido.resumo).toContain('divergência');
  });

  it('resumir envia pergunta do usuario a LLM e normaliza data DD/MM/AAAA em simular', async () => {
    envLlm();
    const f = vi.fn(async () => respostaChat({ resumo: 'A entrega atrasou 5 dias na planilha.' }));
    vi.stubGlobal('fetch', f);
    const execRes = await executarMandato(
      sessao,
      'qual o atraso desse pedido?',
      { acao: 'resumir', filtros: { pedidoId: CHAVE } },
      { maxAlvos: 5 },
    );
    const corpoPrompt = JSON.parse(chamada(f)[1].body) as { messages: Array<{ content: string }> };
    expect(corpoPrompt.messages[0]?.content).toContain('qual o atraso desse pedido?');
    const itemRes = (execRes.resultado['porPedido'] as Array<{ resumo: string; via: string }>)[0]!;
    expect(itemRes).toEqual({ pedidoId: CHAVE, resumo: 'A entrega atrasou 5 dias na planilha.', via: 'llm' });

    const execSim = await executarMandato(
      sessao,
      'simule entrega para 28/01/2026',
      { acao: 'simular', filtros: { pedidoId: CHAVE, campo: 'previsaoEntrega', valor: '28/01/2026' } },
      { maxAlvos: 5 },
    );
    const itemSim = (execSim.resultado['porPedido'] as Array<{ divergencias: Array<{ valorB: string }> }>)[0]!;
    expect(itemSim.divergencias[0]?.valorB).toBe('2026-01-28');
  });

  it('sessao vazia pode resumir e simular pedido da seed sem gravar nada; propagar segue recusado', async () => {
    const seedStore = store.paraWorkspace('seed');
    const chaveSeed = '35260123456789000123550010000000011000009999';
    await seedStore.append(chaveSeed, 'nfe', {
      fonte: 'nfe',
      campos: { status: 'emitida' },
      dados: { emitente: { nome: 'Fornecedor Seed' }, destinatario: { nome: 'CD Seed' } },
    });
    // A previsao honesta do pedido seed: declaracao da transportadora.
    await seedStore.append(chaveSeed, 'status_declarado', {
      fonte: 'email_transportadora',
      campos: { previsaoEntrega: '2026-01-20' },
      dados: { origem: 'confirmacao_inicial' },
    });
    const visitanteVazio = store.paraWorkspace('00000000-0000-4000-8000-00000000eeee');
    const antesSeed = (await seedStore.eventosDoPedido(chaveSeed)).length;

    const res = await executarMandato(visitanteVazio, 'qual o estado?', { acao: 'resumir', filtros: {} }, { maxAlvos: 5 });
    expect(res.alvos).toEqual([chaveSeed]);
    expect(res.resultado['leituraExemplo']).toBe(true);
    expect(res.eventos).toEqual([]);
    const itemResSeed = (res.resultado['porPedido'] as Array<{ resumo: string }>)[0]!;
    expect(itemResSeed.resumo).toContain('Fornecedor Seed');
    expect((await seedStore.eventosDoPedido(chaveSeed)).length).toBe(antesSeed);

    const sim = await executarMandato(
      visitanteVazio,
      'simule entrega para 28/01/2026',
      { acao: 'simular', filtros: { campo: 'previsaoEntrega', valor: '28/01/2026' } },
      { maxAlvos: 5 },
    );
    expect(sim.alvos).toEqual([chaveSeed]);
    expect(sim.resultado['leituraExemplo']).toBe(true);
    expect(sim.eventos).toEqual([]);
    const itemSimSeed = (sim.resultado['porPedido'] as Array<{ divergencias: Array<{ valorA: string; valorB: string }> }>)[0]!;
    expect(itemSimSeed.divergencias).toHaveLength(1);
    expect(itemSimSeed.divergencias[0]).toMatchObject({ valorA: '2026-01-20', valorB: '2026-01-28' });
    expect((await seedStore.eventosDoPedido(chaveSeed)).length).toBe(antesSeed);

    await expect(
      executarMandato(visitanteVazio, 'propague o atraso', { acao: 'propagar', filtros: {} }, { maxAlvos: 5 }),
    ).rejects.toMatchObject({ motivo: 'sem_alvo' });

    await expect(
      executarMandato(visitanteVazio, 'propague na seed', { acao: 'propagar', filtros: { pedidoId: chaveSeed } }, { maxAlvos: 5 }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('mandato notificar com Nvoip desligada registra nao_entregue sem rede', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const exec = await executarMandato(
      sessao,
      'avise o CD',
      { acao: 'notificar', filtros: { pedidoId: CHAVE, parte: 'cd' } },
      { maxAlvos: 5 },
    );
    const porPedido = (exec.resultado['porPedido'] as Array<{ status: string; motivo?: string }>)[0]!;
    expect(porPedido.status).toBe('nao_entregue');
    expect(porPedido.motivo).toBe('desligado');
    expect(f).not.toHaveBeenCalled();
    const notif = (await sessao.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'notificacao').at(-1)!;
    expect(notif.payload).toMatchObject({ parte: 'cd', status: 'nao_entregue', motivo: 'desligado' });
  });

  it('mandato notificar ligada entrega pelo canal do contato', async () => {
    envNvoip();
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', f);
    // A propagacao anterior criou tarefa para a parte cd (contato seed: sms).
    const exec = await executarMandato(
      sessao,
      'avise o CD',
      { acao: 'notificar', filtros: { pedidoId: CHAVE, parte: 'cd' } },
      { maxAlvos: 5 },
    );
    const porPedido = (exec.resultado['porPedido'] as Array<{ status: string }>)[0]!;
    expect(porPedido.status).toBe('entregue');
    expect(f).toHaveBeenCalledTimes(1);
    const corpo = JSON.parse(chamada(f)[1].body) as { canal: string; destino: string };
    expect(corpo).toMatchObject({ canal: 'sms', destino: '+55 11 90000-0003' });
    const notif = (await sessao.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'notificacao').at(-1)!;
    expect(notif.payload).toMatchObject({ status: 'entregue', canal: 'sms' });
  });

  it('canal incompativel (email) registra motivo sem chamar a rede', async () => {
    envNvoip();
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const exec = await executarMandato(
      sessao,
      'avise o financeiro',
      { acao: 'notificar', filtros: { pedidoId: CHAVE, parte: 'financeiro' } },
      { maxAlvos: 5 },
    );
    const porPedido = (exec.resultado['porPedido'] as Array<{ status: string; motivo?: string }>)[0]!;
    expect(porPedido).toMatchObject({ status: 'nao_entregue', motivo: 'canal_incompativel' });
    expect(f).not.toHaveBeenCalled();
  });

  it('notificar sem parte no filtro e sem_alvo', async () => {
    await expect(
      executarMandato(sessao, 'avise alguem', { acao: 'notificar', filtros: { pedidoId: CHAVE } }, { maxAlvos: 5 }),
    ).rejects.toMatchObject({ motivo: 'sem_alvo' });
  });

  it('notificarTarefa desligada sem registrarSempre devolve null e nao grava', async () => {
    const antes = (await sessao.eventosDoPedido(CHAVE)).length;
    const tarefa: Tarefa = {
      parte: 'cd',
      titulo: 'Conferir doca',
      detalhe: 'Detalhe',
      divergencia: { campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'planilha', valorA: 'a', valorB: 'b' },
    };
    expect(await notificarTarefa(sessao, CHAVE, tarefa)).toBeNull();
    expect((await sessao.eventosDoPedido(CHAVE)).length).toBe(antes);
  });

  // Motivos fixos de nao_entregue: o contrato que T141 consumira na
  // propagacao. Todos pinados com Nvoip ligada e fetch mockado.
  it('notificarTarefa registra sem_tarefa, sem_contato e falha_envio sem quebrar', async () => {
    envNvoip();
    // sem_tarefa: pedido sem tarefa da parte (pedido-largo-2 so tem a NF-e).
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', f);
    let ev = await notificarTarefa(sessao, 'pedido-largo-2', null, { registrarSempre: true, parte: 'cd' });
    expect(ev?.payload).toMatchObject({ status: 'nao_entregue', motivo: 'sem_tarefa' });
    expect(f).not.toHaveBeenCalled();

    // sem_contato: tarefa existe, mas 'fiscal' nao tem contato na agenda
    // (a seed cobre so 4 partes).
    const tarefaFiscal: Tarefa = {
      parte: 'fiscal',
      titulo: 'Conferir escrituracao',
      detalhe: 'Detalhe',
      divergencia: { campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'planilha', valorA: 'a', valorB: 'b' },
    };
    ev = await notificarTarefa(sessao, CHAVE, tarefaFiscal, { registrarSempre: true });
    expect(ev?.payload).toMatchObject({ parte: 'fiscal', status: 'nao_entregue', motivo: 'sem_contato' });
    expect(f).not.toHaveBeenCalled();

    // falha_envio: contato e canal existem (cd, sms), a provedora responde nao-ok.
    const tarefaCd: Tarefa = { ...tarefaFiscal, parte: 'cd' };
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 502, json: async () => ({}) }) as Response));
    ev = await notificarTarefa(sessao, CHAVE, tarefaCd, { registrarSempre: true });
    expect(ev?.payload).toMatchObject({ parte: 'cd', canal: 'sms', status: 'nao_entregue', motivo: 'falha_envio' });
  });

  it('notificarTarefa sem parte nem tarefa nao lanca: nao_entregue sem_parte', async () => {
    const ev = await notificarTarefa(sessao, CHAVE, null, { registrarSempre: true });
    expect(ev?.payload).toMatchObject({ parte: null, status: 'nao_entregue', motivo: 'sem_parte' });
    // Sem registrarSempre a mesma entrada e no-op silencioso.
    expect(await notificarTarefa(sessao, CHAVE, null)).toBeNull();
  });

  it('POST /api/mandatos sem LLM responde 503 declarativo', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/mandatos', payload: { texto: 'propague' } });
    expect(res.statusCode).toBe(503);
    expect((res.json() as { erro: string }).erro).toBe('indisponivel');
  });

  it('POST /api/mandatos executa e grava o evento na cadeia', async () => {
    envLlm();
    vi.stubGlobal('fetch', vi.fn(async () => respostaChat({ acao: 'propagar', filtros: { pedidoId: CHAVE } })));
    const res = await app.inject({ method: 'POST', url: '/api/mandatos', payload: { texto: 'propague o atraso' } });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { acao: string; alvos: string[] };
    expect(body.acao).toBe('propagar');
    expect(body.alvos).toContain(CHAVE);
    const evs = await sessao.eventosDoPedido(CHAVE);
    expect(evs.at(-1)!.tipo).toBe('mandato');
    expect((await verificarCadeia(evs)).valida).toBe(true);
  });

  it('POST /api/mandatos com comando fora das acoes responde 422 acao_ambigua', async () => {
    envLlm();
    vi.stubGlobal('fetch', vi.fn(async () => respostaChat({ acao: 'nenhuma' })));
    const res = await app.inject({ method: 'POST', url: '/api/mandatos', payload: { texto: 'apague tudo' } });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { motivo: string }).motivo).toBe('acao_ambigua');
  });

  it('POST /api/mandatos com JSON quebrado da LLM responde 422 parse_falhou', async () => {
    envLlm();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{' } }] }) }) as Response),
    );
    const res = await app.inject({ method: 'POST', url: '/api/mandatos', payload: { texto: 'qualquer' } });
    expect(res.statusCode).toBe(422);
    const body = res.json() as { motivo: string; mensagem: string };
    expect(body.motivo).toBe('parse_falhou');
    expect(body.mensagem).toContain('formato esperado');
  });

  it('POST /api/mandatos com texto nao-string responde 400, nao 500', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/mandatos', payload: { texto: 123 } });
    expect(res.statusCode).toBe(400);
  });

  it('GET /api/contatos devolve a seed; PUT sobrescreve so na sessao', async () => {
    const lista = (await app.inject({ method: 'GET', url: '/api/contatos' })).json() as Contato[];
    expect(lista).toHaveLength(4);
    expect(lista.every((c) => c.fonte === 'seed')).toBe(true);

    const res = await app.inject({
      method: 'PUT',
      url: '/api/contatos',
      payload: { parte: 'cd', nome: 'CD da Sessao', canal: 'whatsapp', destino: '+55 11 97777-0000' },
    });
    expect(res.statusCode).toBe(200);
    const depois = (await app.inject({ method: 'GET', url: '/api/contatos' })).json() as Contato[];
    const cd = depois.find((c) => c.parte === 'cd')!;
    expect(cd).toMatchObject({ nome: 'CD da Sessao', canal: 'whatsapp', fonte: 'manual' });
    // A seed continua intacta para outro workspace.
    const agendaOutro = await listarAgenda(store.paraWorkspace('00000000-0000-4000-8000-00000000cccc'));
    expect(agendaOutro.find((c) => c.parte === 'cd')?.nome).toBe('CD Ficticio (seed)');
  });

  it('PUT /api/contatos com parte invalida responde 400', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/contatos',
      payload: { parte: 'gerente', nome: 'x', canal: 'sms', destino: '1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('bootstrap por documento insere fornecedor e nao toca contato manual', async () => {
    const doc = parseNFe(ler('nfe-ok.xml'));
    (doc.dados['emitente'] as { fone?: string }).fone = '+55 11 91234-0000';
    expect(await bootstrapContatos(sessao, doc)).toBe(1);
    let contato = await sessao.contatoDaParte('fornecedor', CANAIS_CONTATO);
    expect(contato).toMatchObject({ fonte: 'documento', destino: '+55 11 91234-0000' });

    // Documento repetido nao duplica nem sobrescreve.
    expect(await bootstrapContatos(sessao, doc)).toBe(0);
    await sessao.upsertContato({ parte: 'fornecedor', nome: 'Meu Fornecedor', canal: 'whatsapp', destino: '+55 11 90000-9999', fonte: 'manual' });
    expect(await bootstrapContatos(sessao, doc)).toBe(0);
    contato = await sessao.contatoDaParte('fornecedor', CANAIS_CONTATO);
    expect(contato).toMatchObject({ fonte: 'manual', nome: 'Meu Fornecedor' });
  });

  it('view-spec sem LLM e padrao deterministico; papel invalido e 400', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/view-spec?papel=cd` });
    expect(res.statusCode).toBe(200);
    const spec = res.json() as { versao: number; lente: string; destacarDivergencias: boolean };
    expect(spec).toMatchObject({ versao: 1, lente: 'cd', destacarDivergencias: true });
    const ruim = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/view-spec?papel=gerente` });
    expect(ruim.statusCode).toBe(400);
  });

  it('gerarViewSpec valida a LLM e cai no padrao quando sai do schema', async () => {
    const proj = projetar(await sessao.eventosDoPedido(CHAVE));
    envLlm();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaChat({ versao: 1, fontesVisiveis: ['nfe', 'planilha'], colunas: ['previsaoEntrega'], lente: 'cd', destacarDivergencias: true }),
      ),
    );
    const boa = await gerarViewSpec(proj, 'cd');
    expect(boa.fontesVisiveis).toEqual(['nfe', 'planilha']);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => respostaChat({ versao: 1, fontesVisiveis: ['alien'], colunas: ['previsaoEntrega'], lente: 'cd', destacarDivergencias: true })),
    );
    expect(await gerarViewSpec(proj, 'cd')).toEqual(viewSpecPadrao('cd'));
  });

  it('validarViewSpec recusa forma quebrada e enums inventados', () => {
    const boa = { versao: 1, fontesVisiveis: ['nfe'], colunas: ['status'], lente: 'fiscal', destacarDivergencias: false };
    expect(validarViewSpec(boa)).toMatchObject({ lente: 'fiscal' });
    for (const ruim of [
      null,
      {},
      { ...boa, versao: 2 },
      { ...boa, fontesVisiveis: [] },
      { ...boa, colunas: ['cnpj'] },
      { ...boa, lente: 'diretor' },
      { ...boa, destacarDivergencias: 'sim' },
    ]) {
      expect(validarViewSpec(ruim)).toBeNull();
    }
  });

  it('proporMapeamento valida a LLM; saida ruim nao gera proposta', async () => {
    expect(await proporMapeamento(['NF', 'DATA'], [['1', '2026-01-30']])).toBeNull(); // sem LLM
    envLlm();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaChat({ mapeamento: { NF: 'pedidoId', DATA: 'previsaoEntrega' }, confianca: 0.8, motivo: 'cabecalho direto' }),
      ),
    );
    const prop = await proporMapeamento(['NF', 'DATA'], [['1', '2026-01-30']]);
    expect(prop).toMatchObject({ mapeamento: { NF: 'pedidoId', DATA: 'previsaoEntrega' }, confianca: 0.8 });
    vi.stubGlobal('fetch', vi.fn(async () => respostaChat({ mapeamento: { NF: 'cnpj' }, confianca: 0.9, motivo: 'x' })));
    expect(await proporMapeamento(['NF'], [['1']])).toBeNull();
    vi.stubGlobal('fetch', vi.fn(async () => respostaChat({ oi: true })));
    expect(await proporMapeamento(['NF'], [['1']])).toBeNull();
  });

  it('aplicarMapeamento normaliza como o parser e template isola por workspace', async () => {
    const mapa = { NF: 'pedidoId', DATA: 'previsaoEntrega', PESO: 'pesoTotal' };
    const doc = aplicarMapeamento(
      { NF: '3526', DATA: '30/01/2026', PESO: '500,5' },
      mapa,
      0,
    );
    expect(doc).toMatchObject({ pedidoId: '3526', fonte: 'planilha' });
    expect(doc?.campos).toMatchObject({ previsaoEntrega: '2026-01-30', pesoTotal: 500.5 });
    expect(aplicarMapeamento({ DATA: '30/01/2026' }, mapa, 0)).toBeNull(); // sem pedidoId nao vira doc

    await sessao.salvarTemplate('forn@x.com', mapa);
    expect(await sessao.templatePara('forn@x.com')).toEqual(mapa);
    expect(await store.paraWorkspace('00000000-0000-4000-8000-00000000dddd').templatePara('forn@x.com')).toBeNull();
    const docs = await aplicarTemplate(sessao, 'forn@x.com', [{ NF: '3526', DATA: '30/01/2026', PESO: '500' }]);
    expect(docs).toHaveLength(1);
    expect(docs?.[0]?.campos['pesoTotal']).toBe(500);
  });

  it('aplicarMapeamento ignora coluna herdada do prototipo (template envenenado)', () => {
    // 'constructor' como coluna de 'status': sem hasOwn o lookup pegaria a
    // funcao do prototipo e v.trim() derrubava o arquivo inteiro.
    const doc = aplicarMapeamento(
      { NF: '3526' },
      { NF: 'pedidoId', constructor: 'status', hasOwnProperty: 'volumes' },
      0,
    );
    expect(doc).not.toBeNull();
    expect(doc?.campos).toEqual({});
  });

  it('GET view-spec com LLM ligada tem cota por IP e responde 429', async () => {
    // App proprio com cota 1: a segunda geracao estoura a janela.
    process.env['RATE_LIMIT_VIEWSPEC_PER_10MIN'] = '1';
    envLlm();
    const r2 = await buildServer(await createLiteDb(), { workspacePadrao: WS });
    const app2 = r2.app;
    await app2.ready();
    try {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          respostaChat({ versao: 1, fontesVisiveis: ['nfe'], colunas: ['status'], lente: 'cd', destacarDivergencias: true }),
        ),
      );
      const pedido2 = 'pedido-viewspec-429';
      await r2.store.paraWorkspace(WS).append(pedido2, 'nfe', { fonte: 'nfe', campos: { status: 'emitida' }, dados: {} });
      const url = `/api/pedidos/${pedido2}/view-spec?papel=cd`;
      expect((await app2.inject({ method: 'GET', url })).statusCode).toBe(200);
      const segunda = await app2.inject({ method: 'GET', url });
      expect(segunda.statusCode).toBe(429);
    } finally {
      await app2.close();
    }
  });
});

describe('merge de campos na projecao (cancelamento + CC-e)', () => {
  it('CC-e sem campos nao apaga status cancelada declarado pelo cancelamento na mesma fonte', () => {
    // Arrange
    const eventos: Evento[] = [
      evFake('nfe', {
        fonte: 'nfe',
        campos: { previsaoEntrega: '2026-01-20', pesoTotal: 510, volumes: 10, status: 'emitida' },
        dados: { emitente: { nome: 'Krona Eletrônicos Ind. Ltda' }, destinatario: { nome: 'CD Anhanguera' } },
      }),
      evFake('cancelamento', {
        fonte: 'cce',
        campos: { status: 'cancelada' },
        dados: { justificativa: 'Cancelado antes da coleta' },
      }),
      evFake('cce', {
        fonte: 'cce',
        campos: {},
        dados: { correcao: 'Correcao textual de endereco' },
      }),
    ];

    // Act
    const proj = projetar(eventos);
    const porFonte = camposPorFonte(eventos);

    // Assert
    expect(proj.pedido?.campos.status).toBe('cancelada');
    expect(porFonte.get('cce')).toEqual({ status: 'cancelada' });
    expect(proj.versoes.map((v) => v.fonte)).toEqual(['nfe', 'cce', 'cce']);
  });
});

describe('GenUI v2, mandatos/stream, notificar e lista enriquecida', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let store: LedgerStore;
  let sessao: LedgerStore;
  const CHAVE_SEED_TEST = '35260123456789000123550010000000011000008888';

  const parseSse = (body: string): EventoStreamMandato[] =>
    body
      .split('\n\n')
      .map((bloco) => bloco.trim())
      .filter((bloco) => bloco.startsWith('data:'))
      .map((bloco) => JSON.parse(bloco.slice(5).trim()) as EventoStreamMandato);

  beforeAll(async () => {
    const r = await buildServer(await createLiteDb(), { workspacePadrao: WS });
    app = r.app;
    store = r.store;
    await app.ready();
    sessao = store.paraWorkspace(WS);

    // Pedido na sessao: NF-e + CT-e + CC-e vazia (sem cancelamento) + planilha atrasada.
    const nfe = parseNFe(ler('nfe-ok.xml'));
    await sessao.append(CHAVE, 'nfe', docDataParaPayload(nfe));
    await sessao.append(CHAVE, 'status_declarado', {
      fonte: 'email_transportadora',
      campos: { previsaoEntrega: '2026-01-20' },
      dados: { origem: 'confirmacao_inicial' },
    });
    await sessao.append(CHAVE, 'cte', {
      fonte: 'cte',
      campos: { pesoTotal: 520, volumes: 12, status: 'em_transito' },
      dados: { transportadora: { nome: 'Transportadora Teste' } },
    });
    await sessao.append(CHAVE, 'cce', {
      fonte: 'cce',
      campos: {},
      dados: { correcao: 'Endereco complementar' },
    });
    await sessao.append(CHAVE, 'planilha', {
      fonte: 'planilha',
      campos: { previsaoEntrega: '2026-01-25', pesoTotal: 520, volumes: 12, status: 'atrasada' },
      dados: { linha: 2 },
    });
    await executarMandato(sessao, 'propague divergencias', { acao: 'propagar', filtros: { pedidoId: CHAVE } }, { maxAlvos: 5 });

    // Pedido na seed para validar protecao 403 e leitura somente leitura.
    await store.append(CHAVE_SEED_TEST, 'nfe', {
      fonte: 'nfe',
      campos: { previsaoEntrega: '2026-01-24', pesoTotal: 340, volumes: 18, status: 'emitida' },
      dados: { emitente: { nome: 'PackSul Seed' }, destinatario: { nome: 'CD Anhanguera' } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('comporViewSpecV2Deterministico poda fonte vazia, valida citacoes e mantem coerencia narrativa-matriz', async () => {
    // Arrange
    const proj = projetar(await sessao.eventosDoPedido(CHAVE));

    // Act
    const specFiscal = comporViewSpecV2Deterministico(proj, { papel: 'fiscal' });
    const specSim = comporViewSpecV2Deterministico(proj, {
      acao: 'simular',
      campoSimulado: 'previsaoEntrega',
      valorSimulado: '2026-01-28',
    });
    const specGeral = comporViewSpecV2Deterministico(proj);

    // Assert: lente fiscal poda 'cce' vazia (0 campos declarados), inclui citacoes validas e notaRegra
    expect(specFiscal.versao).toBe(2);
    expect(specFiscal.lente).toBe('fiscal');
    expect(specFiscal.layout).toBe('decisao_papel');
    expect(specFiscal.blocos.length).toBeGreaterThanOrEqual(2);
    expect(specFiscal.blocos.length).toBeLessThanOrEqual(4);
    expect(specFiscal.filtroMatriz.fontesVisiveis).not.toContain('cce');
    expect(specFiscal.filtroMatriz.fontesVisiveis).toContain('nfe');
    expect(specFiscal.filtroMatriz.fontesVisiveis).toContain('cte');
    expect(specFiscal.followUps.length).toBeGreaterThanOrEqual(3);
    expect(specFiscal.followUps.length).toBeLessThanOrEqual(4);

    const resumo = specFiscal.blocos.find((b): b is Extract<BlocoGenUI, { tipo: 'resumo_citado' }> => b.tipo === 'resumo_citado')!;
    expect(resumo.citacoes.length).toBeGreaterThan(0);
    for (const c of resumo.citacoes) {
      if (c.alvo.tipo === 'divergencia') {
        expect(specFiscal.filtroMatriz.fontesVisiveis).toContain(c.alvo.fonteA);
        expect(specFiscal.filtroMatriz.fontesVisiveis).toContain(c.alvo.fonteB);
      } else if (c.alvo.tipo === 'celula') {
        expect(specFiscal.filtroMatriz.fontesVisiveis).toContain(c.alvo.fonte);
      }
    }

    const conflito = specFiscal.blocos.find(
      (b): b is Extract<BlocoGenUI, { tipo: 'comparador_conflito' }> => b.tipo === 'comparador_conflito',
    )!;
    expect(conflito).toBeDefined();
    expect(conflito.notaRegra).toBeTruthy();

    // Assert: simulacao tem simulador_interativo + domino_impacto(simulacao) + resumo_citado
    expect(specSim.layout).toBe('simulacao');
    expect(specSim.blocos.map((b) => b.tipo)).toEqual(['simulador_interativo', 'domino_impacto', 'resumo_citado']);
    const simBloco = specSim.blocos[0] as Extract<BlocoGenUI, { tipo: 'simulador_interativo' }>;
    expect(simBloco.campoInicial).toBe('previsaoEntrega');
    expect(simBloco.valorInicial).toBe('2026-01-28');
    const domSim = specSim.blocos[1] as Extract<BlocoGenUI, { tipo: 'domino_impacto' }>;
    expect(domSim.modo).toBe('simulacao');
    expect(domSim.partesFoco).toHaveLength(5);

    // Assert: investigacao geral
    expect(specGeral.lente).toBe('operacao');
    expect(specGeral.layout).toBe('investigacao');
    expect(specGeral.blocos.map((b) => b.tipo)).toContain('linha_tempo_causal');
    expect(specGeral.blocos.map((b) => b.tipo)).toContain('domino_impacto');
  });

  it('comporViewSpecV2 refina via LLM com validacao rigorosa e cai no deterministico se alucinar citacao', async () => {
    // Arrange
    const proj = projetar(await sessao.eventosDoPedido(CHAVE));
    envLlm();

    // Act 1: LLM valida tentando incluir 'cce' vazia — servidor poda 'cce' e aceita texto
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaChat({
          tituloVisao: 'Fiscal · Divergência de peso e prazo',
          justificativa: 'Prioriza conflito NF-e × CT-e e regra R-006.',
          resumoCorpo: 'Há conflito de peso [[c1]] que exige validação fiscal.',
          filtroMatriz: { fontesVisiveis: ['nfe', 'cte', 'cce'], colunas: ['pesoTotal'], destacarDivergencias: true },
        }),
      ),
    );
    const refinado = await comporViewSpecV2(proj, { papel: 'fiscal' });

    // Assert 1
    expect(refinado.origem).toBe('llm');
    expect(refinado.tituloVisao).toBe('Fiscal · Divergência de peso e prazo');
    expect(refinado.filtroMatriz.fontesVisiveis).not.toContain('cce');
    expect(refinado.filtroMatriz.fontesVisiveis).toContain('planilha');

    // Act 2: LLM inventa marcador [[c99]] -> recusa e cai no deterministico
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaChat({
          tituloVisao: 'Alucinado',
          justificativa: 'Inventado',
          resumoCorpo: 'Referência inventada [[c99]].',
        }),
      ),
    );
    const fallback = await comporViewSpecV2(proj, { papel: 'fiscal' });

    // Assert 2
    expect(fallback.origem).toBe('deterministico');
  });

  it('GET /api/pedidos/:id/view-spec?papel=fiscal&v=2 devolve ViewSpecV2 e sem v=2 mantem v1', async () => {
    // Act
    const resV2 = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/view-spec?papel=fiscal&v=2` });
    const resV1 = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/view-spec?papel=fiscal` });

    // Assert
    expect(resV2.statusCode).toBe(200);
    const spec2 = resV2.json() as ViewSpecV2;
    expect(spec2.versao).toBe(2);
    expect(spec2.lente).toBe('fiscal');
    expect(spec2.filtroMatriz.fontesVisiveis).not.toContain('cce');
    expect(spec2.blocos.length).toBeGreaterThanOrEqual(2);

    expect(resV1.statusCode).toBe(200);
    expect((resV1.json() as { versao: number }).versao).toBe(1);
  });

  it('POST /api/mandatos aceita pedidoId opcional e inclui viewSpec v2 sem chamada LLM extra', async () => {
    // Arrange
    envLlm();
    const fetchMock = vi.fn(async () =>
      respostaChat({ acao: 'simular', filtros: { campo: 'previsaoEntrega', valor: '28/01/2026' } }),
    );
    vi.stubGlobal('fetch', fetchMock);

    // Act: seleciona pedido da seed por pedidoId opcional em acao somente leitura
    const res = await app.inject({
      method: 'POST',
      url: '/api/mandatos',
      payload: { texto: 'simule a entrega para 28/01/2026', pedidoId: CHAVE_SEED_TEST },
    });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1); // apenas interpretarMandato, zero chamada LLM extra para ViewSpec
    const body = res.json() as { acao: string; alvos: string[]; viewSpec?: ViewSpecV2; resultado: Record<string, unknown> };
    expect(body.acao).toBe('simular');
    expect(body.alvos).toEqual([CHAVE_SEED_TEST]);
    expect(body.resultado['leituraExemplo']).toBe(true);
    expect(body.viewSpec?.versao).toBe(2);
    expect(body.viewSpec?.layout).toBe('simulacao');
  });

  it('POST /api/mandatos/stream roda o agente: tool, texto_delta, bloco, fim e concluido', async () => {
    // Arrange: a LLM pede simular_cenario e depois responde em texto (spec 0009).
    envLlm();
    const fila = [
      respAgenteTools([{ nome: 'simular_cenario', argumentos: { campo: 'previsaoEntrega', valor: '28/01/2026' } }]),
      respAgenteTexto('Se a entrega virar 28/01, a planilha briga com a NF-e.'),
    ];
    vi.stubGlobal('fetch', vi.fn(async () => fila.shift()!));

    // Act
    const res = await app.inject({
      method: 'POST',
      url: '/api/mandatos/stream',
      payload: { comando: 'simule entrega para 28/01/2026', pedidoId: CHAVE },
    });

    // Assert
    expect(res.statusCode).toBe(200);
    expect(String(res.headers['content-type'])).toContain('text/event-stream');
    const eventos = parseSse(res.body);
    const tipos = eventos.map((e) => e.tipo);
    expect(tipos[0]).toBe('etapa');
    expect(tipos.at(-1)).toBe('concluido');
    expect(tipos.at(-2)).toBe('fim');
    expect(tipos).toContain('tool');
    expect(tipos).toContain('texto_delta');
    const blocos = eventos.filter((e): e is Extract<EventoStreamMandato, { tipo: 'bloco' }> => e.tipo === 'bloco');
    expect(blocos.map((b) => b.bloco.tipo)).toContain('simulador_interativo');
    const fim = eventos.find((e): e is Extract<EventoStreamMandato, { tipo: 'fim' }> => e.tipo === 'fim')!;
    expect(fim.resultado.pedidoIdResolvido).toBe(CHAVE);
    expect(fim.resultado.toolsExecutadas).toEqual([
      expect.objectContaining({ nome: 'simular_cenario', status: 'concluida' }),
    ]);
    const concluido = eventos.find(
      (e): e is Extract<EventoStreamMandato, { tipo: 'concluido' }> => e.tipo === 'concluido',
    )!;
    expect(concluido.resposta.acao).toBe('resumir');
    expect(concluido.resposta.alvos).toEqual([CHAVE]);
    expect(concluido.resposta.viewSpec?.versao).toBe(2);
  });

  it('POST /api/mandatos/stream emite evento erro limpo quando a LLM falha', async () => {
    // Arrange
    envLlm();
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('rede caiu'))));

    // Act
    const res = await app.inject({
      method: 'POST',
      url: '/api/mandatos/stream',
      payload: { comando: 'detalhe o pedido', pedidoId: CHAVE },
    });

    // Assert
    expect(res.statusCode).toBe(200);
    const eventos = parseSse(res.body);
    const erro = eventos.find((e): e is Extract<EventoStreamMandato, { tipo: 'erro' }> => e.tipo === 'erro');
    expect(erro).toMatchObject({ status: 503, motivo: 'indisponivel' });
  });

  it('POST /api/notificar funciona sem LLM na sessao e recusa 403 na seed', async () => {
    // Arrange: sem LLM configurada e com Nvoip ligada para validar entrega deterministica
    envNvoip();
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    // Act 1: notificar pedido da sessao
    const resOk = await app.inject({
      method: 'POST',
      url: '/api/notificar',
      payload: { pedidoId: CHAVE, parte: 'cd', campo: 'previsaoEntrega' },
    });

    // Assert 1
    expect(resOk.statusCode).toBe(200);
    const recibo = resOk.json() as {
      pedidoId: string;
      parte: string;
      status: string;
      canal?: string;
      destino?: string;
      mensagem?: string;
    };
    expect(recibo).toMatchObject({
      pedidoId: CHAVE,
      parte: 'cd',
      status: 'entregue',
      canal: 'sms',
      destino: '+55 11 90000-0003',
    });
    expect(recibo.mensagem).toContain('Reagendar janela de recebimento');
    expect(fetchMock).toHaveBeenCalledTimes(1); // apenas Nvoip, zero LLM

    // Act 2: notificar pedido da seed -> 403
    const resSeed = await app.inject({
      method: 'POST',
      url: '/api/notificar',
      payload: { pedidoId: CHAVE_SEED_TEST, parte: 'cd' },
    });

    // Assert 2
    expect(resSeed.statusCode).toBe(403);
    expect((resSeed.json() as { erro: string }).erro).toContain('só podem ser lidos');

    // Act 3: pedido inexistente -> 404 e parte invalida -> 400
    expect(
      (await app.inject({ method: 'POST', url: '/api/notificar', payload: { pedidoId: 'nao-existe', parte: 'cd' } })).statusCode,
    ).toBe(404);
    expect(
      (await app.inject({ method: 'POST', url: '/api/notificar', payload: { pedidoId: CHAVE, parte: 'diretor' } })).statusCode,
    ).toBe(400);
  });

  it('GET /api/pedidos retorna campos enriquecidos mantendo os campos existentes intactos', async () => {
    // Act
    const res = await app.inject({ method: 'GET', url: '/api/pedidos' });

    // Assert
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pedidos: Array<ResumoPedidoLista & { workspaceId: string }> };
    const proprio = body.pedidos.find((p) => p.pedidoId === CHAVE);
    const daSeed = body.pedidos.find((p) => p.pedidoId === CHAVE_SEED_TEST);

    expect(proprio).toMatchObject({
      pedidoId: CHAVE,
      workspaceId: WS,
      daSessao: true,
      emitente: 'Fornecedor Ficticio Ltda',
      destinatario: 'CD Ficticio SA',
      status: 'atrasada',
      previsaoEntrega: '2026-01-25',
      atrasoDias: 5,
      ancorado: false,
    });
    expect(proprio?.divergencias).toBeGreaterThan(0);
    expect(proprio?.tarefas).toBeGreaterThan(0);

    expect(daSeed).toMatchObject({
      pedidoId: CHAVE_SEED_TEST,
      daSessao: false,
      emitente: 'PackSul Seed',
      destinatario: 'CD Anhanguera',
      status: 'emitida',
      previsaoEntrega: '2026-01-24',
      atrasoDias: null,
      divergencias: 0,
      tarefas: 0,
      ancorado: false,
    });

    // Apos evento ancora, ancorado passa para true
    await sessao.append(CHAVE, 'ancora', { root: 'a'.repeat(64) });
    const depois = (await app.inject({ method: 'GET', url: '/api/pedidos' })).json() as {
      pedidos: ResumoPedidoLista[];
    };
    expect(depois.pedidos.find((p) => p.pedidoId === CHAVE)?.ancorado).toBe(true);
  });

  it('carregarSeed ingere os 3 pedidos sinteticos (Krona, PackSul e base) com cadeias integras', async () => {
    // Arrange
    const db = await createLiteDb();
    const seedStore = new (store.constructor as typeof LedgerStore)(db, 'seed', 'seed');
    await seedStore.init();
    const canal = new CanalSSE('seed');

    try {
      // Act
      const r = await carregarSeed(seedStore, canal, () => {});
      const lista = await seedStore.listarPedidos();
      const ids = lista.map((p) => p.pedidoId);

      // Assert
      expect(r.ingeridos).toBeGreaterThanOrEqual(5);
      expect(ids).toContain('35260211222333000181550010000048211000004821'); // Krona
      expect(ids).toContain('35260244555666000192550010000073101000007310'); // PackSul
      expect(ids).toContain(CHAVE); // Base fixtures

      const projKrona = projetar(await seedStore.eventosDoPedido('35260211222333000181550010000048211000004821'));
      expect(projKrona.pedido?.emitente.nome).toBe('Krona Eletrônicos Ind. Ltda');
      expect(projKrona.pedido?.destinatario.nome).toBe('CD Anhanguera Logística SA');
      // Previsao nao diverge mais: era artefato da NF-e usar a data de
      // emissao como promessa. Divergencias honestas restantes: peso e volumes.
      expect(projKrona.divergencias.some((d) => d.campo === 'previsaoEntrega')).toBe(false);
      expect(projKrona.divergencias.some((d) => d.campo === 'pesoTotal')).toBe(true);
      expect(projKrona.divergencias.some((d) => d.campo === 'volumes')).toBe(true);

      const projPackSul = projetar(await seedStore.eventosDoPedido('35260244555666000192550010000073101000007310'));
      expect(projPackSul.pedido?.emitente.nome).toBe('PackSul Embalagens Ltda');
      expect(projPackSul.divergencias.filter((d) => d.campo === 'pesoTotal' || d.campo === 'volumes')).toEqual([]);

      for (const id of ids) {
        expect((await seedStore.auditar(id)).valida).toBe(true);
      }
    } finally {
      await db.close();
    }
  });
});
