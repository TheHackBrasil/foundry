// Spec 0017, T705: DDL idempotente no boot. Base nova e base criada com o
// DDL anterior (contatos com UNIQUE por parte, evidencias com o hash como
// chave, cobrancas sem caso_id) sobem sem perder linha; a agenda passa a
// ter um contato por parte e canal, a evidencia e por workspace e o
// contato_iniciado e unico por chave. PGlite em memoria; contatos ficticios.

import { describe, expect, it } from 'vitest';
import { CANAIS_CONTATO } from '../shared/model.js';
import { bootstrapContatos, listarAgenda } from './contatos.js';
import { createLiteDb, type Db } from './db.js';
import { LedgerStore } from './store.js';

const WS = '00000000-0000-4000-8000-0000000017a1';
const OUTRO = '00000000-0000-4000-8000-0000000017a2';
const PEDIDO = '35260123456789000123550010000000011000000019';

// DDL das quatro tabelas como estava antes da T705 (store.ts em c9f9ad4).
const DDL_ANTIGO = `
CREATE TABLE events (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  pedido_id    TEXT NOT NULL,
  seq          INT NOT NULL,
  tipo         TEXT NOT NULL,
  payload      JSONB NOT NULL,
  ts           TIMESTAMPTZ NOT NULL,
  prev_hash    TEXT NOT NULL,
  hash         TEXT NOT NULL,
  CHECK (hash ~ '^[0-9a-f]{64}$')
);
CREATE UNIQUE INDEX events_ws_pedido_seq ON events (workspace_id, pedido_id, seq);
CREATE TABLE contatos (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  parte        TEXT NOT NULL,
  nome         TEXT NOT NULL,
  canal        TEXT NOT NULL,
  destino      TEXT NOT NULL,
  fonte        TEXT NOT NULL DEFAULT 'manual',
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, parte)
);
CREATE TABLE cobrancas (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  pedido_id    TEXT NOT NULL,
  canal        TEXT NOT NULL DEFAULT 'email',
  contato_id   BIGINT,
  destinatario TEXT,
  status       TEXT NOT NULL DEFAULT 'pendente',
  message_id   TEXT,
  motivo       TEXT,
  criada_em    TIMESTAMPTZ NOT NULL DEFAULT now(),
  enviada_em   TIMESTAMPTZ,
  respondida_em TIMESTAMPTZ,
  expira_em    TIMESTAMPTZ NOT NULL
);
CREATE TABLE evidencias (
  hash         TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  tipo         TEXT NOT NULL,
  conteudo     BYTEA NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;

async function baseAntiga(): Promise<Db> {
  const db = await createLiteDb();
  await db.exec(DDL_ANTIGO);
  await db.query(
    `INSERT INTO contatos (workspace_id, parte, nome, canal, destino, fonte) VALUES
       ('seed', 'transportadora', 'Transportadora Ficticia (seed)', 'whatsapp', '+55 11 90000-0002', 'seed'),
       ($1, 'transportadora', 'Ops Transp', 'email', 'ops@transp.dev', 'manual'),
       ($1, 'cd', 'CD da Sessao', 'sms', '+55 11 97777-0000', 'manual')`,
    [WS],
  );
  await db.query(`INSERT INTO evidencias (hash, workspace_id, tipo, conteudo) VALUES ('h1', $1, 'eml', $2)`, [
    WS,
    Buffer.from('eml antigo'),
  ]);
  await db.query(
    `INSERT INTO cobrancas (workspace_id, pedido_id, status, message_id, expira_em)
     VALUES ($1, $2, 'enviada', '<antiga@foundry.dev>', now() + interval '1 day')`,
    [WS, PEDIDO],
  );
  return db;
}

async function colunas(db: Db, tabela: string): Promise<string[]> {
  const rows = await db.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns WHERE table_name = $1`,
    [tabela],
  );
  return rows.map((r) => r.column_name);
}

describe('spec 0017 T705: migracao idempotente no boot', () => {
  it('base existente sobe sem perder contato, evidencia nem cobranca, e o boot repete sem erro', async () => {
    const db = await baseAntiga();
    const store = new LedgerStore(db, 'seed');
    await store.init();
    await store.init(); // segundo boot: nada muda nem falha

    const sessao = store.paraWorkspace(WS);
    const agenda = await listarAgenda(sessao);
    expect(agenda.find((c) => c.parte === 'transportadora')).toMatchObject({ canal: 'email', destino: 'ops@transp.dev' });
    expect(agenda.find((c) => c.parte === 'cd')).toMatchObject({ nome: 'CD da Sessao', naoContatarIa: false });
    const total = await db.query<{ n: number }>(`SELECT count(*)::int AS n FROM contatos`);
    // 3 antigos + os 3 da seed que faltavam (fornecedor, cd, financeiro).
    expect(total[0]!.n).toBe(6);

    expect((await sessao.evidencia('h1'))?.toString()).toBe('eml antigo');
    const [cob] = await sessao.listarCobrancas();
    expect(cob).toMatchObject({ status: 'enviada', messageId: '<antiga@foundry.dev>' });
    expect(cob!.casoId).toBeUndefined();

    expect(await colunas(db, 'contatos')).toContain('nao_contatar_ia');
    expect(await colunas(db, 'evidencias')).toContain('apagar_em');
    expect(await colunas(db, 'cobrancas')).toEqual(expect.arrayContaining(['caso_id', 'segredo_msgid']));
    const restricoes = await db.query<{ conname: string }>(
      `SELECT conname FROM pg_constraint WHERE conrelid = 'contatos'::regclass AND contype = 'u'`,
    );
    expect(restricoes).toEqual([]);
    await db.close();
  });

  it('base antiga ganha a chave por canal: a mesma parte aceita um segundo canal', async () => {
    const db = await baseAntiga();
    const store = new LedgerStore(db, 'seed');
    await store.init();
    const sessao = store.paraWorkspace(WS);
    await sessao.upsertContato({ parte: 'transportadora', nome: 'Ops Zap', canal: 'whatsapp', destino: '+55 11 95555-0000', fonte: 'manual' });
    expect((await sessao.contatoDaParte('transportadora', 'email'))?.destino).toBe('ops@transp.dev');
    expect((await sessao.contatoDaParte('transportadora', 'whatsapp'))?.destino).toBe('+55 11 95555-0000');
    await db.close();
  });

  it('evidencia antiga e nova convivem por (workspace, hash), com apagar_em', async () => {
    const db = await baseAntiga();
    const store = new LedgerStore(db, 'seed');
    await store.init();
    const a = store.paraWorkspace(WS);
    const b = store.paraWorkspace(OUTRO);
    // O mesmo hash em outro workspace e outra copia, nao um conflito.
    await b.guardarEvidencia('h1', 'eml', Buffer.from('eml do outro'), new Date('2027-02-24T00:00:00Z'));
    await a.guardarEvidencia('h1', 'eml', Buffer.from('sobrescrita?'));
    expect((await a.evidencia('h1'))?.toString()).toBe('eml antigo');
    expect((await b.evidencia('h1'))?.toString()).toBe('eml do outro');
    const prazo = await db.query<{ apagar_em: Date | null; workspace_id: string }>(
      `SELECT workspace_id, apagar_em FROM evidencias ORDER BY workspace_id`,
    );
    expect(prazo.find((r) => r.workspace_id === OUTRO)?.apagar_em).not.toBeNull();
    expect(prazo.find((r) => r.workspace_id === WS)?.apagar_em).toBeNull();
    await db.close();
  });
});

describe('spec 0017 T705: base nova', () => {
  async function nova(): Promise<LedgerStore> {
    const store = new LedgerStore(await createLiteDb(), 'seed');
    await store.init();
    await store.init();
    return store;
  }

  it('agenda por canal: contato por canal, o ultimo salvo vale quando qualquer canal serve', async () => {
    const store = await nova();
    const s = store.paraWorkspace(WS);
    // Sem contato da sessao, a seed responde (whatsapp ficticio).
    expect((await s.contatoDaParte('transportadora', CANAIS_CONTATO))?.fonte).toBe('seed');
    expect(await s.contatoDaParte('transportadora', 'email')).toBeNull();

    await s.upsertContato({ parte: 'transportadora', nome: 'Ops Mail', canal: 'email', destino: 'ops@transp.dev', fonte: 'manual' });
    // A sessao passou a ser dona da parte: o whatsapp da seed some dela.
    expect(await s.contatoDaParte('transportadora', 'whatsapp')).toBeNull();
    await s.upsertContato({ parte: 'transportadora', nome: 'Ops Zap', canal: 'whatsapp', destino: '+55 11 95555-0000', fonte: 'manual' });

    expect((await s.contatoDaParte('transportadora', 'email'))?.nome).toBe('Ops Mail');
    expect((await s.contatoDaParte('transportadora', CANAIS_CONTATO))?.canal).toBe('whatsapp');
    const agenda = (await listarAgenda(s)).filter((c) => c.parte === 'transportadora');
    expect(agenda.map((c) => c.canal)).toEqual(['email', 'whatsapp']);
    expect(agenda.every((c) => c.fonte === 'manual')).toBe(true);

    // Salvar o e-mail de novo atualiza a mesma linha e o traz para o fim.
    await s.upsertContato({ parte: 'transportadora', nome: 'Ops Mail 2', canal: 'email', destino: 'ops2@transp.dev', fonte: 'manual' });
    const depois = (await listarAgenda(s)).filter((c) => c.parte === 'transportadora');
    expect(depois.map((c) => c.canal)).toEqual(['whatsapp', 'email']);
    expect((await s.contatoDaParte('transportadora', CANAIS_CONTATO))?.destino).toBe('ops2@transp.dev');
    // Outra sessao segue vendo so a seed.
    const outra = (await listarAgenda(store.paraWorkspace(OUTRO))).filter((c) => c.parte === 'transportadora');
    expect(outra.map((c) => c.fonte)).toEqual(['seed']);
  });

  it('nao_contatar_ia nasce false e o upsert sem o campo preserva o valor gravado', async () => {
    const store = await nova();
    const s = store.paraWorkspace(WS);
    await s.upsertContato({ parte: 'cd', nome: 'CD', canal: 'ligacao', destino: '+55 11 94444-0000', fonte: 'manual', naoContatarIa: true });
    expect((await s.contatoDaParte('cd', 'ligacao'))?.naoContatarIa).toBe(true);
    await s.upsertContato({ parte: 'cd', nome: 'CD novo', canal: 'ligacao', destino: '+55 11 94444-0000', fonte: 'manual' });
    expect(await s.contatoDaParte('cd', 'ligacao')).toMatchObject({ nome: 'CD novo', naoContatarIa: true });
    await s.upsertContato({ parte: 'cd', nome: 'CD novo', canal: 'ligacao', destino: '+55 11 94444-0000', fonte: 'manual', naoContatarIa: false });
    expect((await s.contatoDaParte('cd', 'ligacao'))?.naoContatarIa).toBe(false);
  });

  it('bootstrap por documento nao cria segundo canal numa parte que ja tem contato', async () => {
    const store = await nova();
    const s = store.paraWorkspace(WS);
    await s.upsertContato({ parte: 'transportadora', nome: 'Ops Mail', canal: 'email', destino: 'ops@transp.dev', fonte: 'manual' });
    const cte = {
      fonte: 'cte' as const,
      docTipo: 'cte' as const,
      pedidoId: PEDIDO,
      campos: {},
      dados: { transportadora: { nome: 'Transp do CT-e', fone: '11988776655' } },
    };
    expect(await bootstrapContatos(s, cte)).toBe(0);
    expect((await listarAgenda(s)).filter((c) => c.parte === 'transportadora')).toHaveLength(1);
  });

  it('contato_iniciado e unico por chave no pedido; os eventos seguintes repetem a chave', async () => {
    const store = await nova();
    const s = store.paraWorkspace(WS);
    await s.append(PEDIDO, 'contato_iniciado', { chave: 'k1', canal: 'whatsapp' });
    await expect(s.append(PEDIDO, 'contato_iniciado', { chave: 'k1', canal: 'whatsapp' })).rejects.toThrow();
    await s.append(PEDIDO, 'contato_aceito', { chave: 'k1', idExterno: 'x1' });
    await s.append(PEDIDO, 'contato_iniciado', { chave: 'k2', canal: 'whatsapp' });
    // Mesma chave em outro pedido ou outro workspace nao colide.
    await s.append('OUTRO-PEDIDO', 'contato_iniciado', { chave: 'k1', canal: 'whatsapp' });
    await store.paraWorkspace(OUTRO).append(PEDIDO, 'contato_iniciado', { chave: 'k1', canal: 'whatsapp' });
    const tipos = (await s.eventosDoPedido(PEDIDO)).map((e) => e.tipo);
    expect(tipos).toEqual(['contato_iniciado', 'contato_aceito', 'contato_iniciado']);
    expect((await s.auditar(PEDIDO)).valida).toBe(true);
  });
});
