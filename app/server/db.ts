// Adaptador de banco: real Postgres via DATABASE_URL (pg) ou PGlite em
// memoria para dev/test sem Docker. Mesma interface nos dois lados.

import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  transaction<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

class PgDb implements Db {
  private pool: pg.Pool;
  private client: pg.PoolClient | null = null;

  constructor(url: string, client?: pg.PoolClient) {
    if (client) {
      this.client = client;
      this.pool = null as unknown as pg.Pool;
    } else {
      this.pool = new pg.Pool({ connectionString: url });
    }
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const executor = this.client ?? this.pool;
    const r = await executor.query(sql, params as never[]);
    return r.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.query(sql);
  }

  // Tx aninhada junta a tx externa (queries no mesmo client): o pipeline
  // abre uma tx e os appends internos rodam nela.
  async transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.client) return fn(this);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(new PgDb('', client));
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    if (this.pool) await this.pool.end();
  }
}

class LiteDb implements Db {
  private lite: PGlite;
  private inTx: boolean;

  constructor(lite: PGlite, inTx = false) {
    this.lite = lite;
    this.inTx = inTx;
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.lite.query<T>(sql, params);
    return r.rows;
  }

  // exec aceita lote multi-statement (DDL com $$ que o modo query nao parseia).
  async exec(sql: string): Promise<void> {
    await this.lite.exec(sql);
  }

  // Queries dentro do tx rodam pelo handle da transacao (tx), nao por
  // this.lite — PGlite serializa numa conexao so e deadlockaria. O
  // handle de tx nao tem .transaction: tx aninhada junta a externa.
  async transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    if (this.inTx) return fn(this);
    return this.lite.transaction(
      async (tx) => fn(new LiteDb(tx as unknown as PGlite, true)),
    ) as Promise<T>;
  }

  async close(): Promise<void> {
    await this.lite.close();
  }
}

export async function createDb(url?: string): Promise<Db> {
  const connection = url ?? process.env['DATABASE_URL'];
  if (connection) return new PgDb(connection);
  return new LiteDb(new PGlite());
}
