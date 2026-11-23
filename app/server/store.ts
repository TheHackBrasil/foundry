// Store append-only (spec 0004): `events` e o ledger; triggers rejeitam
// UPDATE/DELETE/TRUNCATE e /audit reconta a cadeia.

import { GENESIS_HASH, hashEvento, verificarCadeia, type VerificacaoCadeia } from '../shared/chain.js';
import { TIPOS_DOCUMENTO } from '../shared/model.js';
import type { Contato, Evento, ItemRevisao, Parte, PropostaMapeamento } from '../shared/model.js';
import { CONTATOS_SEED } from './contatos.js';
import type { Db } from './db.js';

const DDL = `
CREATE TABLE IF NOT EXISTS events (
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

CREATE TABLE IF NOT EXISTS review_queue (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  origem       TEXT NOT NULL,
  motivo       TEXT NOT NULL,
  payload      JSONB NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pendente',
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Migracao de bancos pre-workspace: coluna entra como 'seed' e a unicidade
-- passa a ser por (workspace, pedido, seq) via indice.
ALTER TABLE events ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'seed';
ALTER TABLE events DROP CONSTRAINT IF EXISTS events_pedido_id_seq_key;
CREATE UNIQUE INDEX IF NOT EXISTS events_ws_pedido_seq ON events (workspace_id, pedido_id, seq);
ALTER TABLE review_queue ADD COLUMN IF NOT EXISTS workspace_id TEXT NOT NULL DEFAULT 'seed';
-- Fila e uso por sessao filtram por workspace a cada envio.
CREATE INDEX IF NOT EXISTS review_queue_ws ON review_queue (workspace_id);

-- Agenda de contatos por workspace (spec 0007, RF7). Um contato por parte por
-- workspace; a fonte diz se veio manual, de documento ou da seed.
CREATE TABLE IF NOT EXISTS contatos (
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
CREATE INDEX IF NOT EXISTS contatos_ws ON contatos (workspace_id);

-- Templates de mapeamento aprovados (spec 0007, RF11): coluna -> campo
-- canonico por (workspace, remetente); nao vaza entre workspaces.
CREATE TABLE IF NOT EXISTS templates (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  remetente    TEXT NOT NULL,
  mapeamento   JSONB NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, remetente)
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
  workspace_id: string;
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

// Store escopado por workspace: ingest escreve na sessao; leituras veem
// a sessao + WORKSPACE_SEED compartilhado (brief app-infra).
export class LedgerStore {
  constructor(
    private db: Db,
    readonly workspace = 'seed',
    private seedWorkspace = 'seed',
  ) {}

  paraWorkspace(ws: string): LedgerStore {
    return new LedgerStore(this.db, ws, this.seedWorkspace);
  }

  // Visiveis: sessao + seed (ordem importa: sessao primeiro na resolucao).
  private visiveis(): string[] {
    return this.workspace === this.seedWorkspace ? [this.workspace] : [this.workspace, this.seedWorkspace];
  }

  // Workspace dono do pedido entre os visiveis; null se fora do escopo.
  async wsDoPedido(pedidoId: string): Promise<string | null> {
    const rows = await this.db.query<{ workspace_id: string }>(
      `SELECT workspace_id FROM events WHERE pedido_id = $1 AND workspace_id = ANY($2)
       ORDER BY (workspace_id = $3) DESC LIMIT 1`,
      [pedidoId, this.visiveis(), this.workspace],
    );
    return rows[0]?.workspace_id ?? null;
  }

  async init(): Promise<void> {
    await this.db.exec(DDL);
    // Os 4 contatos ficticios da seed entram uma vez por banco; a seed e
    // escrita so por init/seed.ts, nunca pela API.
    for (const c of CONTATOS_SEED) {
      await this.db.query(
        `INSERT INTO contatos (workspace_id, parte, nome, canal, destino, fonte)
         VALUES ($1, $2, $3, $4, $5, 'seed') ON CONFLICT (workspace_id, parte) DO NOTHING`,
        [this.seedWorkspace, c.parte, c.nome, c.canal, c.destino],
      );
    }
  }

  // Atomicidade do pipeline: doc + divergencias + tarefas na mesma tx.
  transaction<T>(fn: (store: LedgerStore) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(new LedgerStore(tx, this.workspace, this.seedWorkspace)));
  }

  // Lock de sessao por workspace+pedido, liberado no fim da tx. Serializa as
  // decisoes que leem o estado antes de gravar (eventoExiste, resolverRevisao);
  // a mesma chave ja e travada por appendVarios, entao o lock aninhado e no-op.
  async travarPedido(pedidoId: string): Promise<void> {
    await this.db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${this.workspace}:${pedidoId}`]);
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
      // Lock por workspace+pedido: FOR UPDATE nao enxerga linha de tx concorrente.
      await tx.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`${this.workspace}:${pedidoId}`]);
      const tail = await tx.query<{ seq: number; hash: string }>(
        `SELECT seq, hash FROM events WHERE workspace_id = $1 AND pedido_id = $2 ORDER BY seq DESC LIMIT 1`,
        [this.workspace, pedidoId],
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
          `INSERT INTO events (workspace_id, pedido_id, seq, tipo, payload, ts, prev_hash, hash)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [this.workspace, pedidoId, seq, n.tipo, JSON.stringify(n.payload), base.ts, prev, hash],
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
      `SELECT * FROM events WHERE workspace_id = $1 AND pedido_id = $2 ORDER BY seq`,
      [this.workspace, pedidoId],
    );
    return rows.map(paraEvento);
  }

  async todosEventos(): Promise<Evento[]> {
    const rows = await this.db.query<EventoRow>(
      `SELECT * FROM events WHERE workspace_id = ANY($1) ORDER BY id`,
      [this.visiveis()],
    );
    return rows.map(paraEvento);
  }

  // Idempotencia: = em jsonb ignora ordem de chaves do payload.
  async eventoExiste(pedidoId: string, tipo: Evento['tipo'], payload: Record<string, unknown>): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 AS n FROM events WHERE workspace_id = $1 AND pedido_id = $2 AND tipo = $3 AND payload = $4::jsonb LIMIT 1`,
      [this.workspace, pedidoId, tipo, JSON.stringify(payload)],
    );
    return rows.length > 0;
  }

  async pedidoExiste(pedidoId: string): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT 1 AS n FROM events WHERE workspace_id = $1 AND pedido_id = $2 LIMIT 1`,
      [this.workspace, pedidoId],
    );
    return rows.length > 0;
  }

  async listarPedidos(): Promise<Array<{ pedidoId: string; workspaceId: string; totalEventos: number; criadoEm: string; ultimoEm: string }>> {
    return this.db.query(
      `SELECT pedido_id AS "pedidoId", workspace_id AS "workspaceId", COUNT(*)::int AS "totalEventos",
              MIN(ts)::text AS "criadoEm", MAX(ts)::text AS "ultimoEm"
       FROM events WHERE workspace_id = ANY($1)
       GROUP BY workspace_id, pedido_id ORDER BY MAX(id) DESC`,
      [this.visiveis()],
    );
  }

  async auditar(pedidoId: string): Promise<VerificacaoCadeia> {
    return verificarCadeia(await this.eventosDoPedido(pedidoId));
  }

  async enfileirarRevisao(origem: string, motivo: string, payload: Record<string, unknown>): Promise<number> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO review_queue (workspace_id, origem, motivo, payload) VALUES ($1, $2, $3, $4) RETURNING id`,
      [this.workspace, origem, motivo, JSON.stringify(payload)],
    );
    return rows[0]!.id;
  }

  // Contrato de GET /api/revisao: ItemRevisao sem workspace_id (RF6). A rota
  // que decide usa buscarRevisao, que le a linha inteira inclusive o dono.
  // payload.proposta (RF11) sobe para o campo tipado quando existe.
  async listarRevisao(): Promise<ItemRevisao[]> {
    const rows = await this.db.query<{
      id: number;
      origem: string;
      motivo: string;
      payload: Record<string, unknown>;
      status: ItemRevisao['status'];
      ts: Date | string;
    }>(`SELECT id, origem, motivo, payload, status, ts FROM review_queue WHERE workspace_id = ANY($1) ORDER BY id`, [
      this.visiveis(),
    ]);
    return rows.map((r) => {
      const proposta = r.payload['proposta'] as PropostaMapeamento | undefined;
      return {
        ...r,
        ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts),
        ...(proposta !== undefined ? { proposta } : {}),
      };
    });
  }

  async buscarRevisao(id: number): Promise<Record<string, unknown> | null> {
    const rows = await this.db.query(
      `SELECT * FROM review_queue WHERE id = $1 AND workspace_id = ANY($2)`,
      [id, this.visiveis()],
    );
    return rows[0] ?? null;
  }

  // So o workspace deste store e so item pendente: a seed e lida por todos, mas
  // decidir um item dela mudaria a fila de todo visitante. false = 404 na rota.
  async resolverRevisao(id: number, status: string): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE review_queue SET status = $1 WHERE id = $2 AND workspace_id = $3 AND status = 'pendente' RETURNING id`,
      [status, id, this.workspace],
    );
    return rows.length > 0;
  }

  // Uso da sessao contra os limites da demo: documento = evento de documento
  // ou item da fila de revisao.
  async uso(): Promise<{ eventos: number; documentos: number }> {
    const rows = await this.db.query<{ eventos: number; documentos: number }>(
      `SELECT
         (SELECT count(*) FROM events WHERE workspace_id = $1)::int AS eventos,
         ((SELECT count(*) FROM events WHERE workspace_id = $1 AND tipo = ANY($2::text[]))
          + (SELECT count(*) FROM review_queue WHERE workspace_id = $1))::int AS documentos`,
      [this.workspace, [...TIPOS_DOCUMENTO]],
    );
    return { eventos: rows[0]?.eventos ?? 0, documentos: rows[0]?.documentos ?? 0 };
  }

  // Workspaces de visitante que ja gravaram algo (evento ou item da fila).
  // Teto global da demo: sem ele, sessao nova por cookie era cota gratis.
  async workspacesComEscrita(): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM (
         SELECT workspace_id AS ws FROM events WHERE workspace_id <> $1
         UNION
         SELECT workspace_id AS ws FROM review_queue WHERE workspace_id <> $1
       ) AS ocupados`,
      [this.seedWorkspace],
    );
    return rows[0]?.n ?? 0;
  }

  async ultimoAncora(pedidoId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM events WHERE workspace_id = $1 AND pedido_id = $2 AND tipo = 'ancora' ORDER BY seq DESC LIMIT 1`,
      [this.workspace, pedidoId],
    );
    return rows[0]?.payload ?? null;
  }

  // Agenda visivel (sessao + seed) com o dono: quem monta a agenda decide a
  // precedencia por workspace (listarAgenda em contatos.ts).
  async listarContatos(): Promise<Array<Contato & { workspaceId: string }>> {
    return this.db.query(
      `SELECT workspace_id AS "workspaceId", parte, nome, canal, destino, fonte
       FROM contatos WHERE workspace_id = ANY($1) ORDER BY id`,
      [this.visiveis()],
    ) as Promise<Array<Contato & { workspaceId: string }>>;
  }

  // Um contato por parte por workspace: a sessao resolve pelo proprio, a seed
  // so entra quando a sessao nao cadastrou a parte.
  async contatoDaParte(parte: Parte): Promise<Contato | null> {
    const rows = await this.db.query<Contato>(
      `SELECT parte, nome, canal, destino, fonte FROM contatos
       WHERE workspace_id = ANY($1) AND parte = $2
       ORDER BY (workspace_id = $3) DESC, id LIMIT 1`,
      [this.visiveis(), parte, this.workspace],
    );
    return rows[0] ?? null;
  }

  // Upsert do PUT /api/contatos: sempre fonte 'manual' na sessao do chamador.
  async upsertContato(c: Contato): Promise<void> {
    await this.db.query(
      `INSERT INTO contatos (workspace_id, parte, nome, canal, destino, fonte)
       VALUES ($1, $2, $3, $4, $5, 'manual')
       ON CONFLICT (workspace_id, parte)
       DO UPDATE SET nome = EXCLUDED.nome, canal = EXCLUDED.canal, destino = EXCLUDED.destino, fonte = 'manual'`,
      [this.workspace, c.parte, c.nome, c.canal, c.destino],
    );
  }

  // Bootstrap por documento: so insere quando a parte ainda nao tem contato;
  // um manual cadastrado a mao nunca e tocado (RF7).
  async inserirContatoSeAusente(c: Contato): Promise<boolean> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO contatos (workspace_id, parte, nome, canal, destino, fonte)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (workspace_id, parte) DO NOTHING RETURNING id`,
      [this.workspace, c.parte, c.nome, c.canal, c.destino, c.fonte],
    );
    return rows.length > 0;
  }

  // Template de mapeamento aprovado (RF11): dados de sessao, escopo so do
  // workspace deste store; nao entra a seed nem outros visitantes.
  async templatePara(remetente: string): Promise<Record<string, string> | null> {
    const rows = await this.db.query<{ mapeamento: Record<string, string> }>(
      `SELECT mapeamento FROM templates WHERE workspace_id = $1 AND remetente = $2`,
      [this.workspace, remetente],
    );
    return rows[0]?.mapeamento ?? null;
  }

  async salvarTemplate(remetente: string, mapeamento: Record<string, string>): Promise<void> {
    await this.db.query(
      `INSERT INTO templates (workspace_id, remetente, mapeamento) VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, remetente) DO UPDATE SET mapeamento = EXCLUDED.mapeamento`,
      [this.workspace, remetente, JSON.stringify(mapeamento)],
    );
  }
}
