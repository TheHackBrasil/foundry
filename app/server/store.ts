// Store append-only (spec 0004, T011/T022/T024): a tabela `events` e o
// ledger; trigger do banco rejeita UPDATE/DELETE, e GET /audit reconta a
// cadeia para pegar o que a trigger nao pegou (bypass via DISABLE).

import { GENESIS_HASH, hashEvento, verificarCadeia, type VerificacaoCadeia } from '../shared/chain.js';
import type { Evento } from '../shared/model.js';
import type { Db } from './db.js';

const DDL = `
CREATE TABLE IF NOT EXISTS events (
  id         BIGSERIAL PRIMARY KEY,
  pedido_id  TEXT NOT NULL,
  seq        INT NOT NULL,
  tipo       TEXT NOT NULL,
  payload    JSONB NOT NULL,
  ts         TIMESTAMPTZ NOT NULL,
  prev_hash  TEXT NOT NULL,
  hash       TEXT NOT NULL,
  UNIQUE (pedido_id, seq),
  CHECK (hash ~ '^[0-9a-f]{64}$')
);

CREATE TABLE IF NOT EXISTS review_queue (
  id      BIGSERIAL PRIMARY KEY,
  origem  TEXT NOT NULL,
  motivo  TEXT NOT NULL,
  payload JSONB NOT NULL,
  status  TEXT NOT NULL DEFAULT 'pendente',
  ts      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION rejeita_mutacao_events() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'events e append-only: % nao permitido', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS events_no_update ON events;
CREATE TRIGGER events_no_update
  BEFORE UPDATE ON events FOR EACH ROW EXECUTE FUNCTION rejeita_mutacao_events();

DROP TRIGGER IF EXISTS events_no_delete ON events;
CREATE TRIGGER events_no_delete
  BEFORE DELETE ON events FOR EACH ROW EXECUTE FUNCTION rejeita_mutacao_events();

DROP TRIGGER IF EXISTS events_no_truncate ON events;
CREATE TRIGGER events_no_truncate
  BEFORE TRUNCATE ON events FOR EACH STATEMENT EXECUTE FUNCTION rejeita_mutacao_events();
`;

interface EventoRow {
  id: number;
  pedido_id: string;
  seq: number;
  tipo: string;
  payload: Record<string, unknown>;
  ts: Date | string;
  prev_hash: string;
  hash: string;
}

function paraEvento(r: EventoRow): Evento {
  return {
    id: r.id,
    pedidoId: r.pedido_id,
    seq: r.seq,
    tipo: r.tipo as Evento['tipo'],
    payload: r.payload,
    ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
    prevHash: r.prev_hash,
    hash: r.hash,
  };
}

export class LedgerStore {
  constructor(private db: Db) {}

  async init(): Promise<void> {
    await this.db.exec(DDL);
  }

  // Atomicidade do pipeline: doc + divergencias + tarefas na mesma tx.
  transaction<T>(fn: (store: LedgerStore) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new LedgerStore(tx)));
  }

  // Acrescenta um evento na cadeia do pedido (seq + hash calculados aqui).
  async append(pedidoId: string, tipo: Evento['tipo'], payload: Record<string, unknown>, ts?: string): Promise<Evento> {
    return this.appendVarios(pedidoId, [{ tipo, payload, ts }]).then((l) => l[0]!);
  }

  async appendVarios(
    pedidoId: string,
    novos: Array<{ tipo: Evento['tipo']; payload: Record<string, unknown>; ts?: string | undefined }>,
  ): Promise<Evento[]> {
    return this.db.transaction(async (tx) => {
      // Lock por pedido: dois appends do mesmo pedido nao disputam seq.
      // FOR UPDATE nao bastaria: tx concorrente nao enxerga a linha nova.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [pedidoId]);
      const tail = await tx.query<{ seq: number; hash: string }>(
        `SELECT seq, hash FROM events WHERE pedido_id = $1 ORDER BY seq DESC LIMIT 1`,
        [pedidoId],
      );
      let seq = (tail[0]?.seq ?? 0) + 1;
      let prev = tail[0]?.hash ?? GENESIS_HASH;
      const inseridos: Evento[] = [];
      for (const n of novos) {
        const base = {
          pedidoId,
          tipo: n.tipo,
          payload: n.payload,
          ts: n.ts ?? new Date().toISOString(),
        };
        const hash = hashEvento(base, prev);
        const rows = await tx.query<EventoRow>(
          `INSERT INTO events (pedido_id, seq, tipo, payload, ts, prev_hash, hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
          [pedidoId, seq, n.tipo, JSON.stringify(n.payload), base.ts, prev, hash],
        );
        const ev = paraEvento(rows[0]!);
        inseridos.push(ev);
        prev = hash;
        seq += 1;
      }
      return inseridos;
    });
  }

  async eventosDoPedido(pedidoId: string): Promise<Evento[]> {
    const rows = await this.db.query<EventoRow>(
      `SELECT * FROM events WHERE pedido_id = $1 ORDER BY seq`,
      [pedidoId],
    );
    return rows.map(paraEvento);
  }

  async todosEventos(): Promise<Evento[]> {
    const rows = await this.db.query<EventoRow>(`SELECT * FROM events ORDER BY id`);
    return rows.map(paraEvento);
  }

  // Idempotencia: mesmo doc reingerido nao duplica evento (mesmo
  // pedidoId + tipo + payload ja gravado; = em jsonb ignora ordem).
  async eventoExiste(pedidoId: string, tipo: Evento['tipo'], payload: Record<string, unknown>): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 AS n FROM events WHERE pedido_id = $1 AND tipo = $2 AND payload = $3::jsonb LIMIT 1`,
      [pedidoId, tipo, JSON.stringify(payload)],
    );
    return rows.length > 0;
  }

  async pedidoExiste(pedidoId: string): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT 1 AS n FROM events WHERE pedido_id = $1 LIMIT 1`,
      [pedidoId],
    );
    return rows.length > 0;
  }

  async listarPedidos(): Promise<Array<{ pedidoId: string; totalEventos: number; criadoEm: string; ultimoEm: string }>> {
    return this.db.query(
      `SELECT pedido_id AS "pedidoId", COUNT(*)::int AS "totalEventos",
              MIN(ts)::text AS "criadoEm", MAX(ts)::text AS "ultimoEm"
       FROM events GROUP BY pedido_id ORDER BY MAX(id) DESC`,
    );
  }

  async auditar(pedidoId: string): Promise<VerificacaoCadeia> {
    return verificarCadeia(await this.eventosDoPedido(pedidoId));
  }

  async enfileirarRevisao(origem: string, motivo: string, payload: Record<string, unknown>): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO review_queue (origem, motivo, payload) VALUES ($1, $2, $3) RETURNING id`,
      [origem, motivo, JSON.stringify(payload)],
    );
    return rows[0]!.id;
  }

  async listarRevisao(): Promise<Array<Record<string, unknown>>> {
    return this.db.query(`SELECT * FROM review_queue ORDER BY id`);
  }

  async buscarRevisao(id: number): Promise<Record<string, unknown> | null> {
    const rows = await this.db.query(`SELECT * FROM review_queue WHERE id = $1`, [id]);
    return rows[0] ?? null;
  }

  // RETURNING id: false significa que o id nao existia (404 na rota).
  async resolverRevisao(id: number, status: string): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE review_queue SET status = $1 WHERE id = $2 RETURNING id`,
      [status, id],
    );
    return rows.length > 0;
  }

  async ultimoAncora(pedidoId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM events WHERE pedido_id = $1 AND tipo = 'ancora' ORDER BY seq DESC LIMIT 1`,
      [pedidoId],
    );
    return rows[0]?.payload ?? null;
  }
}
