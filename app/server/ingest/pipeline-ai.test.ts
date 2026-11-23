// Fios da camada AI no pipeline (spec 0007, T140/T141/T142): sinais de texto
// livre (corpo de .eml e texto da CC-e), notificacao da tarefa propagada sob
// env e bootstrap da agenda por fone fiscal. LLM e Nvoip sao mockadas por
// stub de fetch/env; nada toca a rede.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Contato } from '../../shared/model.js';
import { projetar } from '../../shared/projection.js';
import { listarAgenda } from '../contatos.js';
import { createLiteDb } from '../db.js';
import { aprovarRevisao, ingerir } from '../pipeline.js';
import { CanalSSE } from '../sse.js';
import { LedgerStore } from '../store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const ler = (f: string): Buffer => readFileSync(join(FIX, f));
const CHAVE = '35260123456789000123550010000000011000000019';
const WS = '00000000-0000-4000-8000-00000000e001';

const URL_LLM = 'http://llm.invalid/chat';
const URL_NVOIP = 'http://nvoip.invalid/send';

async function novo() {
  const db = await createLiteDb();
  const store = new LedgerStore(db, WS, 'seed');
  await store.init();
  return { db, store, canal: new CanalSSE('seed') };
}

// Envelope OpenAI-compativel que o chatJson espera; a Nvoip responde so ok.
function stubFetch(respostaLlm: unknown, nvoipOk = true) {
  return vi.fn(async (url: unknown) => {
    if (typeof url === 'string' && url === URL_NVOIP) {
      return new Response(nvoipOk ? 'ok' : 'erro', { status: nvoipOk ? 200 : 500 });
    }
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(respostaLlm) } }] }), {
      status: 200,
    });
  });
}

function ligarLlm(respostaLlm: unknown, nvoipOk = true) {
  vi.stubEnv('LLM_API_URL', URL_LLM);
  vi.stubEnv('LLM_API_KEY', 'teste');
  vi.stubGlobal('fetch', stubFetch(respostaLlm, nvoipOk));
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const eventosDo = (store: LedgerStore) => store.eventosDoPedido(CHAVE);
const sinaisDo = async (store: LedgerStore) => (await eventosDo(store)).filter((e) => e.tipo === 'sinal');
const notificacoesDo = async (store: LedgerStore) => (await eventosDo(store)).filter((e) => e.tipo === 'notificacao');

describe('T140: sinais consultivos de texto livre', () => {
  const sinal = { sinais: [{ tipo: 'reagendamento', resumo: 'Entrega reagendada para sexta-feira', confianca: 0.9 }] };

  it('corpo do .eml e texto da CC-e geram evento sinal, cada um com a fonte certa', async () => {
    const { db, store, canal } = await novo();
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    ligarLlm(sinal);

    await ingerir(store, canal, 'email-corpo.eml', ler('email-corpo.eml'));

    const sinais = await sinaisDo(store);
    // Um sinal do corpo do .eml (fonte imap) e um do xCorrecao da CC-e (cce).
    expect(sinais.map((e) => e.payload['fonte']).sort()).toEqual(['cce', 'imap']);
    expect(sinais[0]!.payload['tipo']).toBe('reagendamento');
    // O corpo do e-mail nunca vaza para o ledger: so o resumo tipado da LLM.
    for (const e of sinais) {
      expect(Object.keys(e.payload).sort()).toEqual(['confianca', 'fonte', 'resumo', 'tipo']);
      expect(JSON.stringify(e.payload)).not.toContain('chuva');
      expect(JSON.stringify(e.payload)).not.toContain('Prezados');
    }
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });

  it('sinal nao declara campo vigiado nem gera divergencia (R-006 segue)', async () => {
    const { db, store, canal } = await novo();
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    const camposAntes = projetar(await eventosDo(store)).pedido?.campos;
    ligarLlm(sinal);

    await ingerir(store, canal, 'cce-reagendamento.xml', ler('cce-reagendamento.xml'));

    const sinais = await sinaisDo(store);
    expect(sinais.length).toBeGreaterThan(0);
    const evs = await eventosDo(store);
    expect(evs.filter((e) => e.tipo === 'divergencia')).toHaveLength(0);
    expect(projetar(evs).pedido?.campos).toEqual(camposAntes);
    await db.close();
  });

  it('sem LLM configurada nada muda: .eml segue so com o documento', async () => {
    const { db, store, canal } = await novo();
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    await ingerir(store, canal, 'email-corpo.eml', ler('email-corpo.eml'));

    expect(await sinaisDo(store)).toHaveLength(0);
    const evs = await eventosDo(store);
    expect(evs.map((e) => e.tipo)).toEqual(['nfe', 'cce']);
    await db.close();
  });

  it('CC-e de pedido inexistente vai para revisao e nao emite sinal', async () => {
    const { db, store, canal } = await novo();
    ligarLlm(sinal);
    const orfa = Buffer.from(ler('cce-reagendamento.xml').toString('utf8').replaceAll(CHAVE, '35260100000000000100550010000099991000099991'));

    const r = await ingerir(store, canal, 'cce-orfa.xml', orfa);

    expect(r.revisaoId).not.toBeNull();
    expect(await sinaisDo(store)).toHaveLength(0);
    await db.close();
  });
});

describe('T141: notificacao da tarefa propagada (NVOIP_NOTIFY_ON_TASK)', () => {
  const ligarNvoip = (nvoipOk = true) => {
    vi.stubEnv('NVOIP_NOTIFY_ON_TASK', '1');
    vi.stubEnv('NVOIP_API_URL', URL_NVOIP);
    vi.stubEnv('NVOIP_API_KEY', 'teste');
    // Sem LLM: o texto da notificacao sai pelo template deterministico.
    vi.stubGlobal('fetch', stubFetch({}, nvoipOk));
  };

  it('tarefa propagada com contato gera evento notificacao por parte', async () => {
    const { db, store, canal } = await novo();
    ligarNvoip();
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    // planilha.csv diverge da nfe (data, peso, status): tarefas por parte.
    await ingerir(store, canal, 'planilha.csv', ler('planilha.csv'));

    const evs = await eventosDo(store);
    const tarefas = evs.filter((e) => e.tipo === 'tarefa');
    expect(tarefas.length).toBeGreaterThan(0);
    const notificacoes = evs.filter((e) => e.tipo === 'notificacao');
    // Uma notificacao por tarefa propagada; o motivo e determinado pela
    // parte: contato seed em canal Nvoip entrega, email e incompativel e
    // fiscal nao tem contato nem na seed.
    expect(notificacoes).toHaveLength(tarefas.length);
    const esperado = new Map([
      ['fornecedor', 'entregue'],
      ['transportadora', 'entregue'],
      ['cd', 'entregue'],
      ['fiscal', 'sem_contato'],
      ['financeiro', 'canal_incompativel'],
    ]);
    for (const n of notificacoes) {
      const parte = String(n.payload['parte']);
      expect(String(n.payload['motivo'] ?? 'entregue')).toBe(esperado.get(parte));
    }
    expect(new Set(notificacoes.map((n) => String(n.payload['parte'])))).toEqual(
      new Set(tarefas.map((t) => String(t.payload['parte']))),
    );
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });

  it('sem NVOIP_NOTIFY_ON_TASK nada acontece, mesmo com provedora configurada', async () => {
    const { db, store, canal } = await novo();
    vi.stubEnv('NVOIP_API_URL', URL_NVOIP);
    vi.stubEnv('NVOIP_API_KEY', 'teste');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    await ingerir(store, canal, 'planilha.csv', ler('planilha.csv'));

    expect(await notificacoesDo(store)).toHaveLength(0);
    expect(fetchMock).not.toHaveBeenCalled();
    await db.close();
  });

  it('falha de envio registra nao_entregue e nunca quebra o pipeline', async () => {
    const { db, store, canal } = await novo();
    ligarNvoip(false);
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    const r = await ingerir(store, canal, 'planilha.csv', ler('planilha.csv'));

    expect(r.docs).toBe(1);
    const evs = await eventosDo(store);
    const tarefas = evs.filter((e) => e.tipo === 'tarefa');
    const notificacoes = evs.filter((e) => e.tipo === 'notificacao');
    expect(notificacoes).toHaveLength(tarefas.length);
    // Falha so onde houve envio de verdade (canal compativel); sem_contato e
    // canal_incompativel nao chegam a tentar.
    const compat = new Set(['fornecedor', 'transportadora', 'cd']);
    const esperadas = tarefas.filter((t) => compat.has(String(t.payload['parte']))).length;
    expect(notificacoes.filter((e) => e.payload['motivo'] === 'falha_envio')).toHaveLength(esperadas);
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });
});

describe('T142: bootstrap da agenda por fone fiscal', () => {
  const NFE_FONE = ler('nfe-ok.xml')
    .toString('utf8')
    .replace('</emit>', '<enderEmit><fone>1130112200</fone></enderEmit></emit>');
  const CTE_FONE = ler('cte-ok.xml')
    .toString('utf8')
    .replace('</emit>', '<enderEmit><fone>11988776655</fone></enderEmit></emit>');

  const contatoDa = async (store: LedgerStore, parte: Contato['parte']) => (await listarAgenda(store)).find((c) => c.parte === parte);

  it('NF-e com fone bootstrapa o fornecedor; CT-e com fone, a transportadora', async () => {
    const { db, store, canal } = await novo();
    await ingerir(store, canal, 'nfe-ok.xml', Buffer.from(NFE_FONE));
    await ingerir(store, canal, 'cte-ok.xml', Buffer.from(CTE_FONE));

    const fornecedor = await contatoDa(store, 'fornecedor');
    expect(fornecedor?.fonte).toBe('documento');
    expect(fornecedor?.destino).toBe('1130112200');
    const transportadora = await contatoDa(store, 'transportadora');
    expect(transportadora?.fonte).toBe('documento');
    expect(transportadora?.destino).toBe('11988776655');
    await db.close();
  });

  it('doc sem fone nao cria contato e manual nunca e sobrescrito', async () => {
    const { db, store, canal } = await novo();
    // Sem fone: o contato visivel segue sendo o da seed.
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    expect((await contatoDa(store, 'fornecedor'))?.fonte).toBe('seed');

    // Manual vence: cadastrado a mao, o bootstrap nao toca.
    await store.upsertContato({ parte: 'fornecedor', nome: 'Fornecedor Manual', canal: 'email', destino: 'f@ficticio.dev', fonte: 'manual' });
    await ingerir(store, canal, 'nfe-fone.xml', Buffer.from(NFE_FONE.replace('1130112200', '11000000000')));
    const fornecedor = await contatoDa(store, 'fornecedor');
    expect(fornecedor?.fonte).toBe('manual');
    expect(fornecedor?.destino).toBe('f@ficticio.dev');
    await db.close();
  });
});

describe('T124: aprovacao com proposta e template por remetente', () => {
  const proposta = {
    mapeamento: { Rastreio: 'pedidoId', Janela: 'previsaoEntrega' },
    confianca: 0.9,
    motivo: 'Rastreio carrega a chave; Janela e a data prevista',
  };

  it('revisao com proposta -> aprovacao ingere com mapeamento -> template reaplica sem LLM', async () => {
    const { db, store, canal } = await novo();
    ligarLlm(proposta);
    const fetchMock = vi.mocked(fetch);

    const r = await ingerir(store, canal, 'planilha-desconhecida.xlsx', ler('t124/planilha-desconhecida.xlsx'));
    expect(r.revisaoId).not.toBeNull();
    const item = (await store.listarRevisao()).find((i) => i.id === r.revisaoId);
    expect(item?.proposta?.mapeamento).toEqual(proposta.mapeamento);

    const eventos = await aprovarRevisao(store, canal, r.revisaoId!);
    expect(eventos).not.toBeNull();
    expect(eventos!.some((e) => e.tipo === 'planilha')).toBe(true);
    // O doc gravado saiu do mapeamento: pedidoId vem da coluna Rastreio.
    const docPlanilha = eventos!.find((e) => e.tipo === 'planilha');
    expect(docPlanilha?.pedidoId).toBe('BR-7731');
    expect(docPlanilha?.payload['dados']).toMatchObject({ mapeamento: 'template' });
    expect(await store.templatePara('planilha-desconhecida.xlsx')).toEqual(proposta.mapeamento);

    // Segundo arquivo do mesmo remetente: entra direto, sem LLM e sem fila.
    const chamadasAntes = fetchMock.mock.calls.length;
    const r2 = await ingerir(store, canal, 'planilha-desconhecida.xlsx', ler('t124/planilha-desconhecida.xlsx'));
    expect(r2.revisaoId).toBeNull();
    expect(fetchMock.mock.calls.length).toBe(chamadasAntes);
    await db.close();
  });

  it('sem LLM o item entra sem proposta e a aprovacao responde null', async () => {
    const { db, store, canal } = await novo();
    const r = await ingerir(store, canal, 'planilha-desconhecida.xlsx', ler('t124/planilha-desconhecida.xlsx'));
    const item = (await store.listarRevisao()).find((i) => i.id === r.revisaoId);
    expect(item?.proposta).toBeUndefined();
    expect(await aprovarRevisao(store, canal, r.revisaoId!)).toBeNull();
    await db.close();
  });

  it('S1: a revisao do xlsx tambem cobra cota (exigirCabe antes do parse)', async () => {
    const { db, store, canal } = await novo();
    const limites = {
      bytesPorArquivo: 50 * 1024 * 1024,
      eventosPorWorkspace: 5000,
      documentosPorWorkspace: 500,
      documentosPorEnvio: 0, // zero: qualquer documento deste envio ja estoura
      bytesBanco: 0,
      workspacesComEscrita: 100,
    };

    // Antes do S1 a revisao enfileirava sem exigirCabe: aqui o envio morre
    // no 413 antes de qualquer parse ou fila.
    await expect(
      ingerir(store, canal, 'planilha-desconhecida.xlsx', ler('t124/planilha-desconhecida.xlsx'), { limites }),
    ).rejects.toThrowError(/documentos/);
    expect(await store.listarRevisao()).toHaveLength(0);
    await db.close();
  });
});
