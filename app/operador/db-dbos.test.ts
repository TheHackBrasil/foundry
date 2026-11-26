// T723: append do ledger num passo transacional do DBOS. Roda no Postgres do
// app/docker-compose.yml (o DBOS nao roda sobre PGlite, T702); sem o banco
// no ar, a suite e pulada.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createDb, type Db } from '../server/db.js';
import { LedgerStore } from '../server/store.js';
import { FonteLedgerDbos } from './db-dbos.js';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://foundry:foundry@localhost:5432/foundry';
const NOME_BANCO = 'foundry_teste_operador';

// Banco proprio dos testes do operador, criado se faltar; null sem Postgres.
async function bancoDeTeste(): Promise<string | null> {
  const c = new pg.Client({ connectionString: BASE, connectionTimeoutMillis: 1_500 });
  try {
    await c.connect();
  } catch {
    return null;
  }
  try {
    const r = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [NOME_BANCO]);
    if (r.rows.length === 0) await c.query(`CREATE DATABASE ${NOME_BANCO}`);
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code !== '42P04' && code !== '23505') throw e; // outro arquivo criou antes
  } finally {
    await c.end();
  }
  const url = new URL(BASE);
  url.pathname = `/${NOME_BANCO}`;
  return url.toString();
}

const URL_TESTE = await bancoDeTeste();

describe.skipIf(!URL_TESTE)('db-dbos: ledger no passo transacional (Postgres)', () => {
  const url = URL_TESTE!;
  const ws = `teste-dbos-${randomUUID().slice(0, 8)}`;
  let db: Db;
  let fonte: FonteLedgerDbos;
  let fluxoGrava: (pedidoId: string, falhar: boolean) => Promise<{ seq: number; checkpoints: number; eventos: number }>;

  const contarEventos = async (pedidoId: string): Promise<number> =>
    (await new LedgerStore(db, ws).eventosDoPedido(pedidoId)).length;

  beforeAll(async () => {
    db = await createDb(url);
    await new LedgerStore(db, ws).init();
    fonte = new FonteLedgerDbos({ databaseUrl: url }).registrar();
    fluxoGrava = DBOS.registerWorkflow(
      async (pedidoId: string, falhar: boolean) => {
        const ev = await fonte.noPasso('gravar', async (tx) => {
          const e = await new LedgerStore(tx, ws).append(pedidoId, 'operador_assumiu', { fluxoId: DBOS.workflowID });
          if (falhar) throw new Error('falha depois do append');
          return e;
        });
        // Antes do fim do fluxo o checkpoint ainda existe (o SDK apaga os
        // checkpoints da fonte quando o fluxo termina).
        const leitura = await DBOS.runStep(async () => {
          const r = await db.query<{ n: string }>(
            'SELECT count(*) AS n FROM dbos.transaction_completion WHERE workflow_id = $1',
            [DBOS.workflowID],
          );
          return { checkpoints: Number(r[0]!.n), eventos: await contarEventos(pedidoId) };
        });
        return { seq: ev.seq!, ...leitura };
      },
      { name: 'teste_db_dbos_grava' },
    );
    DBOS.setConfig({
      name: 'foundry-teste-db-dbos',
      systemDatabaseUrl: url,
      systemDatabaseSchemaName: 'dbos',
      applicationVersion: `teste-${randomUUID()}`,
      logLevel: 'error',
    });
    await DBOS.launch();
  }, 60_000);

  afterAll(async () => {
    await DBOS.shutdown({ deregister: true });
    await db?.close();
  });

  it('grava evento e checkpoint na mesma transacao', async () => {
    const pedidoId = `p-${randomUUID()}`;
    const r = await fluxoGrava(pedidoId, false);
    expect(r).toEqual({ seq: 1, checkpoints: 1, eventos: 1 });
  });

  it('falha no callback desfaz o evento e nao deixa checkpoint', async () => {
    const pedidoId = `p-${randomUUID()}`;
    const id = `teste:${randomUUID()}`;
    await expect(DBOS.startWorkflow(fluxoGrava, { workflowID: id })(pedidoId, true).then((h) => h.getResult())).rejects.toThrow(
      'falha depois do append',
    );
    expect(await contarEventos(pedidoId)).toBe(0);
    const cp = await db.query('SELECT 1 FROM dbos.transaction_completion WHERE workflow_id = $1', [id]);
    expect(cp).toHaveLength(0);
  });

  it('checkpoint ja gravado (queda entre o COMMIT e o registro do passo) devolve o resultado sem gravar de novo', async () => {
    const pedidoId = `p-${randomUUID()}`;
    const id = `teste:${randomUUID()}`;
    // O primeiro passo do fluxo tem id 0: e a linha que a execucao anterior
    // teria confirmado junto com o evento.
    await db.query(`INSERT INTO dbos.transaction_completion (workflow_id, function_num, output) VALUES ($1, 0, $2)`, [
      id,
      JSON.stringify({ json: { seq: 7 } }),
    ]);
    const h = await DBOS.startWorkflow(fluxoGrava, { workflowID: id })(pedidoId, false);
    const r = await h.getResult();
    expect(r.seq).toBe(7);
    expect(r.eventos).toBe(0);
  });

  it('fora de fluxo e transacao comum, sem checkpoint', async () => {
    const pedidoId = `p-${randomUUID()}`;
    const ev = await fonte.noPasso('avulso', (tx) => new LedgerStore(tx, ws).append(pedidoId, 'operador_assumiu', {}));
    expect(ev.seq).toBe(1);
    expect(await contarEventos(pedidoId)).toBe(1);
  });
});
