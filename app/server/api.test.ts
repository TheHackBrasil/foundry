// Teste de integracao do core (spec 0004): parsers, ledger append-only,
// divergencia->tarefa, audit tamper, rotas, simulate, anchor offline.
// Banco: PGlite em memoria (Postgres real, trigger funciona de verdade).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENESIS_HASH, hashEvento } from '../shared/chain.js';
import { raizMerkle } from '../shared/merkle.js';
import { buildServer } from './index.js';
import { createLiteDb } from './db.js';
import { parseNFe } from './ingest/nfe.js';
import { parseCTe } from './ingest/cte.js';
import { parseEventoNFe } from './ingest/eventos.js';
import { parseCsv } from './ingest/csv.js';
import type { LedgerStore } from './store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const CHAVE = '35260123456789000123550010000000011000000019';

describe('parsers', () => {
  it('NF-e -> chave 44, emitente, destinatario, itens, peso, data', () => {
    const d = parseNFe(ler('nfe-ok.xml'));
    expect(d.pedidoId).toBe(CHAVE);
    expect(d.dados['emitente']).toEqual({ cnpj: '12345678000123', nome: 'Fornecedor Ficticio Ltda' });
    expect((d.dados['itens'] as unknown[]).length).toBe(2);
    expect(d.campos.pesoTotal).toBe(510);
    expect(d.campos.volumes).toBe(10);
    expect(d.campos.previsaoEntrega).toBe('2026-01-20');
  });

  it('CT-e vincula ao pedido pela chave NF-e', () => {
    const d = parseCTe(ler('cte-ok.xml'));
    expect(d.pedidoId).toBe(CHAVE);
    expect(d.campos.pesoTotal).toBe(520);
    expect(d.campos.volumes).toBe(12);
  });

  it('CC-e vira evento de atraso com nova data', () => {
    const d = parseEventoNFe(ler('cce-atraso.xml'));
    expect(d.docTipo).toBe('cce');
    expect(d.pedidoId).toBe(CHAVE);
    expect(d.campos.previsaoEntrega).toBe('2026-01-25');
    expect(d.campos.status).toBe('atrasada');
  });

  it('cancelamento vira status cancelada', () => {
    const d = parseEventoNFe(ler('cancelamento.xml'));
    expect(d.docTipo).toBe('cancelamento');
    expect(d.campos.status).toBe('cancelada');
  });

  it('CSV: uma linha vira doc planilha', () => {
    const docs = parseCsv(ler('planilha.csv'));
    expect(docs).toHaveLength(1);
    expect(docs[0]!.pedidoId).toBe(CHAVE);
    expect(docs[0]!.campos.previsaoEntrega).toBe('2026-01-25');
  });

  it('XML malformado e XML fora de schema viram ErroParser', () => {
    expect(() => parseNFe('<quebrado')).toThrowError(/NF-e/);
    expect(() => parseNFe(ler('invalido.xml'))).toThrowError(/infNFe/);
  });
});

describe('ledger + api (PGlite)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let store: LedgerStore;

  beforeAll(async () => {
    const r = await buildServer(await createLiteDb());
    app = r.app;
    store = r.store;
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('POST /api/ingest NF-e cria pedido e cadeia com genesis', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pedidoId: string; eventos: number };
    expect(body.pedidoId).toBe(CHAVE);
    const evs = await store.eventosDoPedido(CHAVE);
    expect(evs[0]!.prevHash).toBe(GENESIS_HASH);
    expect(evs[0]!.seq).toBe(1);
  });

  it('CT-e gera divergencia de peso/volumes e tarefas propagadas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'cte-ok.xml', conteudo: ler('cte-ok.xml') },
    });
    expect(res.statusCode).toBe(200);
    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as {
      divergencias: Array<{ campo: string }>;
      tarefas: Array<{ parte: string }>;
    };
    expect(proj.divergencias.map((d) => d.campo).sort()).toEqual(['pesoTotal', 'status', 'volumes'].sort());
    expect(proj.tarefas.length).toBeGreaterThan(0);
    expect(new Set(proj.tarefas.map((t) => t.parte))).toContain('transportadora');
  });

  it('CC-e propaga tarefa para as 5 partes no atraso', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'cce-atraso.xml', conteudo: ler('cce-atraso.xml') },
    });
    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as {
      tarefas: Array<{ parte: string; divergencia: { campo: string } }>;
      versoes: unknown[];
    };
    const deData = proj.tarefas.filter((t) => t.divergencia.campo === 'previsaoEntrega');
    expect(new Set(deData.map((t) => t.parte)).size).toBe(5);
    expect(proj.versoes.length).toBe(3); // nfe, cte, cce
  });

  it('reingestao identica e no-op (idempotente)', async () => {
    const antes = (await store.eventosDoPedido(CHAVE)).length;
    await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') },
    });
    expect((await store.eventosDoPedido(CHAVE)).length).toBe(antes);
  });

  it('CT-e sem pedido vai para fila de revisao, nao 500', async () => {
    const cteOrfao = ler('cte-ok.xml').replaceAll(CHAVE, '35260100000000000100550010000099991000099991');
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'orfao.xml', conteudo: cteOrfao },
    });
    expect(res.statusCode).toBe(200);
    const revisao = (await app.inject({ method: 'GET', url: '/api/revisao' })).json() as {
      itens: Array<{ motivo: string }>;
    };
    expect(revisao.itens.some((i) => i.motivo === 'pedido_desconhecido')).toBe(true);
  });

  it('XML invalido responde 422 explicito', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'invalido.xml', conteudo: ler('invalido.xml') },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { erro: string }).erro).toContain('XML');
  });

  it('trigger do banco rejeita UPDATE e DELETE em events', async () => {
    const db = (store as unknown as { db: { query: (s: string) => Promise<unknown> } }).db;
    await expect(db.query(`UPDATE events SET tipo='x' WHERE pedido_id='${CHAVE}'`)).rejects.toThrow();
    await expect(db.query(`DELETE FROM events WHERE pedido_id='${CHAVE}'`)).rejects.toThrow();
  });

  it('bypass da trigger e pego pelo audit nomeando o evento', async () => {
    const db = (store as unknown as { db: { query: (s: string, p?: unknown[]) => Promise<unknown> } }).db;
    await db.query('ALTER TABLE events DISABLE TRIGGER ALL');
    await db.query(`UPDATE events SET payload = '{"fonte":"nfe","adulterado":true}' WHERE pedido_id='${CHAVE}' AND seq=1`);
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL');
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/audit` });
    const audit = res.json() as { valida: boolean; indiceFalha: number | null; eventoFalha: { seq: number } | null };
    expect(audit.valida).toBe(false);
    expect(audit.eventoFalha?.seq).toBe(1);
    // Restaura o evento correto para os proximos testes
    await db.query('ALTER TABLE events DISABLE TRIGGER ALL');
    await db.query(
      `DELETE FROM events WHERE pedido_id='${CHAVE}'`,
    );
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL');
    await app.inject({ method: 'POST', url: '/api/ingest', payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') } });
  });

  it('audit de cadeia integra retorna valida', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/audit` });
    expect((res.json() as { valida: boolean }).valida).toBe(true);
  });

  it('eventos novos pos-ancoragem nao invalidam rootConfere', async () => {
    const pedido = 'pedido-ancora-cresce';
    await store.append(pedido, 'nfe', { fonte: 'nfe' });
    await store.append(pedido, 'cte', { fonte: 'cte' });
    const pre = await store.eventosDoPedido(pedido);
    await store.append(pedido, 'ancora', { root: raizMerkle(pre.map((e) => e.hash)) });
    await store.append(pedido, 'planilha', { fonte: 'planilha' });
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${pedido}/audit` });
    const audit = res.json() as {
      rootConfere: boolean | null;
      eventosAncorados: number | null;
      rootHistorico: string | null;
      ancora: { root: string } | null;
    };
    expect(audit.rootConfere).toBe(true);
    expect(audit.eventosAncorados).toBe(2);
    expect(audit.rootHistorico).toBe(audit.ancora?.root);
  });

  it('rescrever cadeia inteira engana o hash mas nao a ancora', async () => {
    // O ataque que a ancora existe pra pegar: dono do banco adultera o
    // payload E recomputa hash/prev_hash, deixando a cadeia autoconsis-
    // tente (valida=true). rootHistorico diverge do root ancorado.
    const pedido = 'pedido-ancora-tamper';
    await store.append(pedido, 'nfe', { fonte: 'nfe' });
    const pre = await store.eventosDoPedido(pedido);
    await store.append(pedido, 'ancora', { root: raizMerkle(pre.map((e) => e.hash)) });
    const evs = await store.eventosDoPedido(pedido);
    const h1 = hashEvento(
      { pedidoId: pedido, tipo: 'nfe', payload: { adulterado: true }, ts: evs[0]!.ts },
      evs[0]!.prevHash,
    );
    const h2 = hashEvento(
      { pedidoId: pedido, tipo: 'ancora', payload: evs[1]!.payload, ts: evs[1]!.ts },
      h1,
    );
    const db = (store as unknown as { db: { query: (s: string) => Promise<unknown> } }).db;
    await db.query('ALTER TABLE events DISABLE TRIGGER ALL');
    await db.query(
      `UPDATE events SET payload='{"adulterado":true}', hash='${h1}' WHERE pedido_id='${pedido}' AND seq=1`,
    );
    await db.query(
      `UPDATE events SET prev_hash='${h1}', hash='${h2}' WHERE pedido_id='${pedido}' AND seq=2`,
    );
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL');
    const audit = (await app.inject({ method: 'GET', url: `/api/pedidos/${pedido}/audit` })).json() as {
      valida: boolean;
      rootConfere: boolean | null;
    };
    expect(audit.valida).toBe(true);
    expect(audit.rootConfere).toBe(false);
  });

  it('POST /api/simulate devolve tarefas sem gravar', async () => {
    const antes = (await store.eventosDoPedido(CHAVE)).length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulate',
      payload: { pedidoId: CHAVE, campos: { previsaoEntrega: '2026-02-01' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { simulacao: boolean; tarefas: unknown[] };
    expect(body.simulacao).toBe(true);
    expect(body.tarefas.length).toBe(5);
    expect((await store.eventosDoPedido(CHAVE)).length).toBe(antes);
  });

  it('POST /api/anchor sem config devolve 503 com motivo declarado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anchor',
      payload: { pedidoId: CHAVE },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { ok: boolean; motivo: string; root: string };
    expect(body.ok).toBe(false);
    expect(body.motivo).toContain('nao configurada');
    expect(body.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GET /api/pedidos lista o pedido', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pedidos' });
    const body = res.json() as { pedidos: Array<{ pedidoId: string }> };
    expect(body.pedidos.map((p) => p.pedidoId)).toContain(CHAVE);
  });

  it('GET /api/versoes devolve linha do tempo', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/versoes` });
    expect((res.json() as { versoes: unknown[] }).versoes.length).toBeGreaterThanOrEqual(1);
  });
});
