// Store append-only (spec 0004): `events` e o ledger; triggers rejeitam
// UPDATE/DELETE/TRUNCATE e /audit reconta a cadeia.

import { randomBytes } from 'node:crypto';
import { GENESIS_HASH, hashEvento, verificarCadeia, type VerificacaoCadeia } from '../shared/chain.js';
import { TIPOS_DOCUMENTO } from '../shared/model.js';
import type { CanalContato, Cobranca, Contato, Evento, ItemRevisao, Parte, PropostaMapeamento } from '../shared/model.js';
import type { EstadoKillSwitch } from '../operador/politica.js';
import { CONTATOS_SEED } from './contatos.js';
import type { Db } from './db.js';

// Contato da agenda com id e dono, como contatoDaParte devolve.
export type ContatoDaAgenda = Contato & { id: number; workspaceId: string; naoContatarIa: boolean };

// Sinal ao operador (RF18): declaracao aprovada na revisao que o fluxo do
// caso ainda nao leu.
export interface SinalOperador {
  id: number;
  workspaceId: string;
  pedidoId: string;
  revisaoId: number;
  fonte: string;
  seqDeclaracao: number | null;
  criadoEm: string;
}

// Linha do contato_aceito casada pelo id externo, antes de achar o caso.
export interface AceiteDoFornecedor {
  workspaceId: string;
  pedidoId: string;
  chave: string;
}

// 'workspace': so as cobrancas do store; 'todos': a caixa IMAP do sistema.
export type EscopoCobranca = 'workspace' | 'todos';

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

-- Agenda de contatos por workspace (spec 0007, RF7). A fonte diz se veio
-- manual, de documento ou da seed.
CREATE TABLE IF NOT EXISTS contatos (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  parte        TEXT NOT NULL,
  nome         TEXT NOT NULL,
  canal        TEXT NOT NULL,
  destino      TEXT NOT NULL,
  fonte        TEXT NOT NULL DEFAULT 'manual',
  ts           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS contatos_ws ON contatos (workspace_id);
-- Spec 0017, T705: um contato por parte e canal (o operador precisa do
-- e-mail, do WhatsApp e do telefone da mesma transportadora). A base antiga
-- tinha no maximo um por parte, entao cabe na chave nova sem perder linha.
-- nao_contatar_ia marca quem pediu para nao falar com a IA (RF8).
ALTER TABLE contatos DROP CONSTRAINT IF EXISTS contatos_workspace_id_parte_key;
CREATE UNIQUE INDEX IF NOT EXISTS contatos_ws_parte_canal ON contatos (workspace_id, parte, canal);
ALTER TABLE contatos ADD COLUMN IF NOT EXISTS nao_contatar_ia BOOLEAN NOT NULL DEFAULT false;

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

-- Identidade muitos-para-muitos (spec 0011): cada referencia extraida de um
-- documento (chave NF-e, xPed, chave CT-e, CNPJ+serie+numero) liga ao pedido
-- dono no workspace. Conflito de referencias nunca resolve em merge — o
-- documento vai para a fila de revisao.
CREATE TABLE IF NOT EXISTS pedido_documentos (
  id           BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  pedido_id    TEXT NOT NULL,
  tipo_doc     TEXT NOT NULL,
  referencia   TEXT NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, referencia)
);
CREATE INDEX IF NOT EXISTS pedido_documentos_ws ON pedido_documentos (workspace_id, pedido_id);

-- Cobrancas de status (spec 0010): pendencia por tempo gera pedido de status
-- a transportadora; message_id e a ponte de volta para a resposta IMAP.
CREATE TABLE IF NOT EXISTS cobrancas (
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
CREATE INDEX IF NOT EXISTS cobrancas_ws ON cobrancas (workspace_id, pedido_id);
CREATE INDEX IF NOT EXISTS cobrancas_msgid ON cobrancas (workspace_id, message_id);
-- Spec 0017: caso_id liga a cobranca ao caso de pendencia que a pediu (T705)
-- e segredo_msgid torna o Message-ID derivado impossivel de adivinhar (T712).
-- A resposta IMAP casa por Message-ID em qualquer workspace (RF27).
ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS caso_id TEXT NULL;
ALTER TABLE cobrancas ADD COLUMN IF NOT EXISTS segredo_msgid TEXT NULL;
CREATE INDEX IF NOT EXISTS cobrancas_msgid_global ON cobrancas (message_id);

-- Evidencias (spec 0010): o .eml bruto que gerou um status_declarado fica
-- enderecado pelo proprio hash (emlHash do claim). Nao entra em rota publica
-- nem no comprovante: so o hash circula fora.
CREATE TABLE IF NOT EXISTS evidencias (
  workspace_id TEXT NOT NULL DEFAULT 'seed',
  hash         TEXT NOT NULL,
  tipo         TEXT NOT NULL,
  conteudo     BYTEA NOT NULL,
  ts           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, hash)
);
-- Spec 0017, T705: a chave passa de hash a (workspace, hash). Dois visitantes
-- com o mesmo arquivo guardam cada um a sua copia. A base antiga tem o hash
-- unico, entao cabe na chave nova sem perder linha. apagar_em e o prazo de
-- retencao (RF25): o job apaga WHERE apagar_em < now(); NULL fica.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'evidencias'::regclass AND conname = 'evidencias_pkey' AND array_length(conkey, 1) = 1
  ) THEN
    ALTER TABLE evidencias DROP CONSTRAINT evidencias_pkey;
    ALTER TABLE evidencias ADD PRIMARY KEY (workspace_id, hash);
  END IF;
END $$;
ALTER TABLE evidencias ADD COLUMN IF NOT EXISTS apagar_em TIMESTAMPTZ NULL;
CREATE INDEX IF NOT EXISTS evidencias_apagar_em ON evidencias (apagar_em) WHERE apagar_em IS NOT NULL;

-- Spec 0017, RF12: um contato_iniciado por chave de efeito no pedido. O
-- segundo append com a mesma chave falha; os eventos seguintes (aceito,
-- incerto, falhou) repetem a chave sem colidir.
CREATE UNIQUE INDEX IF NOT EXISTS events_contato_iniciado_chave
  ON events (workspace_id, pedido_id, (payload->>'chave')) WHERE tipo = 'contato_iniciado';

-- Spec 0017, RF17: dedupe de webhook de fornecedor pelo id do evento. Fica
-- fora do workspace porque a entrada ainda nao sabe de quem e o evento; o
-- mapeamento vem depois, pelo id externo do contato_aceito.
CREATE TABLE IF NOT EXISTS webhook_eventos (
  fornecedor   TEXT NOT NULL,
  id_evento    TEXT NOT NULL,
  recebido_em  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (fornecedor, id_evento)
);

-- Spec 0017, RF10: kill switch global e por workspace, fora do snapshot da
-- politica e lido antes de cada efeito externo. escopo 'global' usa
-- workspace_id vazio. acionado = true: nenhum efeito sai.
CREATE TABLE IF NOT EXISTS operador_controle (
  escopo        TEXT NOT NULL CHECK (escopo IN ('global', 'workspace')),
  workspace_id  TEXT NOT NULL DEFAULT '',
  acionado      BOOLEAN NOT NULL,
  por           TEXT NULL,
  atualizado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (escopo, workspace_id)
);

-- Spec 0017, RF18: declaracao de WhatsApp ou ligacao aprovada na revisao
-- sinaliza o operador. Uma linha por item de revisao; o operador marca como
-- lida quando o fluxo acorda e rele o ledger.
CREATE TABLE IF NOT EXISTS operador_sinais (
  id             BIGSERIAL PRIMARY KEY,
  workspace_id   TEXT NOT NULL,
  pedido_id      TEXT NOT NULL,
  revisao_id     BIGINT NOT NULL,
  fonte          TEXT NOT NULL,
  seq_declaracao INT NULL,
  criado_em      TIMESTAMPTZ NOT NULL DEFAULT now(),
  lido_em        TIMESTAMPTZ NULL,
  UNIQUE (workspace_id, revisao_id)
);
CREATE INDEX IF NOT EXISTS operador_sinais_pendentes ON operador_sinais (workspace_id) WHERE lido_em IS NULL;

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
         VALUES ($1, $2, $3, $4, $5, 'seed') ON CONFLICT (workspace_id, parte, canal) DO NOTHING`,
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

  // Idempotencia: = em jsonb ignora ordem de chaves do payload. Chaves
  // volateis (claims com afirmadoEm do ingest, token de resposta do caso)
  // ficam fora da comparacao: mesmo documento ingerido de novo e no-op
  // mesmo quando essas chaves mudam de valor (spec 0011).
  async eventoExiste(
    pedidoId: string,
    tipo: Evento['tipo'],
    payload: Record<string, unknown>,
    volateis: string[] = ['claims', 'token'],
  ): Promise<boolean> {
    const coluna = volateis.reduce((col, k) => `${col} - '${k}'`, 'payload');
    const rows = await this.db.query(
      `SELECT 1 AS n FROM events WHERE workspace_id = $1 AND pedido_id = $2 AND tipo = $3 AND ${coluna} = $4::jsonb LIMIT 1`,
      [this.workspace, pedidoId, tipo, JSON.stringify(volateis.reduce((p, k) => ({ ...p, [k]: undefined }), payload))],
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

  // Identidade (spec 0011): referencias extraidas do documento ->
  // pedidos conhecidos. Mais de um pedido distinto = conflito (revisao).
  async pedidosPorReferencias(
    referencias: string[],
  ): Promise<Array<{ referencia: string; pedidoId: string }>> {
    if (referencias.length === 0) return [];
    const rows = await this.db.query<{ referencia: string; pedido_id: string }>(
      `SELECT referencia, pedido_id FROM pedido_documentos
       WHERE workspace_id = $1 AND referencia = ANY($2)`,
      [this.workspace, referencias],
    );
    return rows.map((r) => ({ referencia: r.referencia, pedidoId: r.pedido_id }));
  }

  async vincularDocumento(pedidoId: string, tipoDoc: string, referencias: string[]): Promise<void> {
    for (const ref of referencias) {
      await this.db.query(
        `INSERT INTO pedido_documentos (workspace_id, pedido_id, tipo_doc, referencia)
         VALUES ($1, $2, $3, $4) ON CONFLICT (workspace_id, referencia) DO NOTHING`,
        [this.workspace, pedidoId, tipoDoc, ref],
      );
    }
  }

  async referenciasDoPedido(pedidoId: string): Promise<string[]> {
    const rows = await this.db.query<{ referencia: string }>(
      `SELECT referencia FROM pedido_documentos WHERE workspace_id = $1 AND pedido_id = $2 ORDER BY id`,
      [this.workspace, pedidoId],
    );
    return rows.map((r) => r.referencia);
  }

  // Pendencias (spec 0011): workspaces que ja gravaram evento — o tick do
  // servidor itera sobre eles sem conhecer sessoes.
  async workspacesAtivos(): Promise<string[]> {
    const rows = await this.db.query<{ workspace_id: string }>(
      `SELECT DISTINCT workspace_id FROM events`,
    );
    return rows.map((r) => r.workspace_id);
  }

  async pendenciaExiste(pedidoId: string, motivo: string): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 AS n FROM events WHERE workspace_id = $1 AND pedido_id = $2
       AND tipo = 'pendencia_aberta' AND payload->>'motivo' = $3 LIMIT 1`,
      [this.workspace, pedidoId, motivo],
    );
    return rows.length > 0;
  }

  async ultimoAncora(pedidoId: string): Promise<Record<string, unknown> | null> {
    const rows = await this.db.query<{ payload: Record<string, unknown> }>(
      `SELECT payload FROM events WHERE workspace_id = $1 AND pedido_id = $2 AND tipo = 'ancora' ORDER BY seq DESC LIMIT 1`,
      [this.workspace, pedidoId],
    );
    return rows[0]?.payload ?? null;
  }

  // Cobrancas (spec 0010). 'Aberta' = pendente/pendente_envio/enviada: a que
  // ainda aguarda acao ou resposta. Expiradas e respondidas sao historico.
  private cobrancaRow(r: Record<string, unknown>): Cobranca {
    return {
      id: r['id'] as number,
      pedidoId: r['pedido_id'] as string,
      workspaceId: r['workspace_id'] as string,
      canal: r['canal'] as Cobranca['canal'],
      contatoId: r['contato_id'] === null || r['contato_id'] === undefined ? null : Number(r['contato_id']),
      casoId: (r['caso_id'] as string | null) ?? undefined,
      destinatario: (r['destinatario'] as string | null) ?? undefined,
      status: r['status'] as Cobranca['status'],
      messageId: (r['message_id'] as string | null) ?? undefined,
      motivo: (r['motivo'] as string | null) ?? undefined,
      criadaEm: new Date(r['criada_em'] as string).toISOString(),
      enviadaEm: r['enviada_em'] ? new Date(r['enviada_em'] as string).toISOString() : undefined,
      respondidaEm: r['respondida_em'] ? new Date(r['respondida_em'] as string).toISOString() : undefined,
      expiraEm: new Date(r['expira_em'] as string).toISOString(),
    };
  }

  // Cria cobranca pendente para o pedido; idempotente: cobranca aberta para
  // o mesmo pedido devolve a existente, nunca duplica. criada_em sai do
  // relogio do app, o mesmo do ts dos eventos. casoId liga a cobranca ao
  // caso de pendencia que a pediu (spec 0017, T705). O segredo entra no
  // Message-ID derivado (T712) e nunca sai da tabela.
  async criarCobrancaPendente(
    pedidoId: string,
    contatoId: number | null,
    destinatario: string | null,
    expiraEm: Date,
    casoId: string | null = null,
  ): Promise<{ cobranca: Cobranca; criada: boolean }> {
    const aberta = await this.cobrancaAbertaDoPedido(pedidoId);
    if (aberta) return { cobranca: aberta, criada: false };
    const rows = await this.db.query<Record<string, unknown>>(
      `INSERT INTO cobrancas (workspace_id, pedido_id, contato_id, destinatario, expira_em, criada_em, caso_id, segredo_msgid)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        this.workspace,
        pedidoId,
        contatoId,
        destinatario,
        expiraEm.toISOString(),
        new Date().toISOString(),
        casoId,
        randomBytes(8).toString('hex'),
      ],
    );
    return { cobranca: this.cobrancaRow(rows[0]!), criada: true };
  }

  // Spec 0017, RF13: o caso ja teve a sua cobranca, em qualquer status. O
  // vinculo e o caso_id (T705). Cobranca anterior a coluna (caso_id nulo)
  // segue a regra antiga por tempo: nascida na abertura do caso ou depois.
  // Sem esse recuo, cada caso aberto de uma base antiga ganharia uma
  // cobranca nova no primeiro tick depois do deploy.
  async cobrancaDoCaso(pedidoId: string, casoId: string, abertoEm: string): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 AS n FROM cobrancas WHERE workspace_id = $1 AND pedido_id = $2
       AND (caso_id = $3 OR (caso_id IS NULL AND criada_em >= $4)) LIMIT 1`,
      [this.workspace, pedidoId, casoId, abertoEm],
    );
    return rows.length > 0;
  }

  async cobrancaAbertaDoPedido(pedidoId: string): Promise<Cobranca | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM cobrancas WHERE workspace_id = $1 AND pedido_id = $2
       AND status IN ('pendente','pendente_envio','enviada') ORDER BY id DESC LIMIT 1`,
      [this.workspace, pedidoId],
    );
    return rows[0] ? this.cobrancaRow(rows[0]) : null;
  }

  async listarCobrancas(): Promise<Cobranca[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM cobrancas WHERE workspace_id = ANY($1) ORDER BY id DESC`,
      [this.visiveis()],
    );
    return rows.map((r) => this.cobrancaRow(r));
  }

  async cobrancaPorId(id: number): Promise<Cobranca | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM cobrancas WHERE workspace_id = $1 AND id = $2`,
      [this.workspace, id],
    );
    return rows[0] ? this.cobrancaRow(rows[0]) : null;
  }

  // Matching resposta -> cobranca (spec 0010, RF7): o Message-Id gravado no
  // envio volta no In-Reply-To/References do e-mail da transportadora.
  // escopo 'todos' e a caixa IMAP do sistema (spec 0017, RF27): casa em
  // qualquer workspace, inclusive depois da expiracao. 'workspace' e o
  // upload da sessao, que so enxerga as proprias cobrancas. Respondida nao
  // casa de novo: a segunda resposta nao duplica o claim.
  async cobrancaPorMessageId(messageId: string, escopo: EscopoCobranca = 'workspace'): Promise<Cobranca | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM cobrancas WHERE message_id = $1 AND status <> 'respondida'
       AND ($2::text IS NULL OR workspace_id = $2) ORDER BY id DESC LIMIT 1`,
      [messageId, escopo === 'todos' ? null : this.workspace],
    );
    return rows[0] ? this.cobrancaRow(rows[0]) : null;
  }

  // Message-ID derivado de tentativa anterior (spec 0017, T712): a coluna
  // message_id guarda so o ultimo envio, entao a resposta ao primeiro e-mail
  // casa pelo id e pelo segredo lidos do proprio Message-ID.
  async cobrancaPorSegredo(id: number, segredo: string, escopo: EscopoCobranca = 'workspace'): Promise<Cobranca | null> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM cobrancas WHERE id = $1 AND segredo_msgid = $2 AND status <> 'respondida'
       AND ($3::text IS NULL OR workspace_id = $3)`,
      [id, segredo, escopo === 'todos' ? null : this.workspace],
    );
    return rows[0] ? this.cobrancaRow(rows[0]) : null;
  }

  // Segredo do Message-ID da cobranca; a cobranca anterior a coluna ganha o
  // seu no primeiro envio e o mantem nos seguintes.
  async segredoDaCobranca(id: number): Promise<string | null> {
    const rows = await this.db.query<{ segredo_msgid: string }>(
      `UPDATE cobrancas SET segredo_msgid = COALESCE(segredo_msgid, $3)
       WHERE workspace_id = $1 AND id = $2 RETURNING segredo_msgid`,
      [this.workspace, id, randomBytes(8).toString('hex')],
    );
    return rows[0]?.segredo_msgid ?? null;
  }

  // Envios confirmados da cobranca, contados no ledger (cobranca_enviada).
  // A proxima tentativa e esse numero mais um.
  async enviosDaCobranca(cobranca: Pick<Cobranca, 'id' | 'pedidoId'>): Promise<number> {
    const rows = await this.db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM events WHERE workspace_id = $1 AND pedido_id = $2
       AND tipo = 'cobranca_enviada' AND payload->>'cobrancaId' = $3`,
      [this.workspace, cobranca.pedidoId, String(cobranca.id)],
    );
    return rows[0]?.n ?? 0;
  }

  async atualizarCobranca(
    id: number,
    campos: {
      status?: Cobranca['status'];
      messageId?: string;
      motivo?: string;
      respondida?: boolean;
      contatoId?: number | null;
      destinatario?: string | null;
    },
  ): Promise<boolean> {
    const sets: string[] = [];
    const vals: unknown[] = [this.workspace, id];
    let i = 3;
    if (campos.status !== undefined) {
      sets.push(`status = $${i++}`);
      vals.push(campos.status);
    }
    if (campos.messageId !== undefined) {
      sets.push(`message_id = $${i++}`);
      vals.push(campos.messageId);
    }
    if (campos.motivo !== undefined) {
      sets.push(`motivo = $${i++}`);
      vals.push(campos.motivo);
    }
    if (campos.contatoId !== undefined) {
      sets.push(`contato_id = $${i++}`);
      vals.push(campos.contatoId);
    }
    if (campos.destinatario !== undefined) {
      sets.push(`destinatario = $${i++}`);
      vals.push(campos.destinatario);
    }
    if (campos.status === 'enviada') sets.push('enviada_em = now()');
    if (campos.respondida === true) sets.push(`status = 'respondida', respondida_em = now()`);
    if (sets.length === 0) return false;
    const n = await this.db.query<{ n: number }>(
      `UPDATE cobrancas SET ${sets.join(', ')} WHERE workspace_id = $1 AND id = $2 RETURNING id AS n`,
      vals,
    );
    return n.length > 0;
  }

  // Expira cobrancas enviadas/pendentes sem resposta (COBRANCA_EXPIRA_HORAS).
  // Devolve as expiradas: quem chama grava cobranca_expirada no pedido de
  // cada uma (spec 0017, T712).
  async expirarCobrancas(agora: Date): Promise<Cobranca[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `UPDATE cobrancas SET status = 'expirada'
       WHERE workspace_id = $1 AND status IN ('pendente','pendente_envio','enviada') AND expira_em < $2
       RETURNING *`,
      [this.workspace, agora.toISOString()],
    );
    return rows.map((r) => this.cobrancaRow(r)).sort((a, b) => a.pedidoId.localeCompare(b.pedidoId) || a.id - b.id);
  }

  // Evidencia enderecada por (workspace, hash) (spec 0010; T705 da 0017): o
  // .eml bruto fica aqui e fora circula so o hash. apagarEm e o prazo de
  // retencao (RF25); sem ele a evidencia fica.
  async guardarEvidencia(hash: string, tipo: string, conteudo: Buffer, apagarEm: Date | null = null): Promise<void> {
    await this.db.query(
      `INSERT INTO evidencias (hash, workspace_id, tipo, conteudo, apagar_em) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (workspace_id, hash) DO NOTHING`,
      [hash, this.workspace, tipo, conteudo, apagarEm ? apagarEm.toISOString() : null],
    );
  }

  async evidencia(hash: string): Promise<Buffer | null> {
    const rows = await this.db.query<{ conteudo: Uint8Array }>(
      `SELECT conteudo FROM evidencias WHERE hash = $1 AND workspace_id = $2`,
      [hash, this.workspace],
    );
    // pg devolve BYTEA como Buffer; PGlite, como Uint8Array.
    const conteudo = rows[0]?.conteudo;
    return conteudo ? Buffer.from(conteudo) : null;
  }

  // Contato de uma parte num canal (spec 0017, T705), com id. A sessao que
  // tem algum contato da parte e dona dela: a seed so responde quando a
  // sessao nao tem nenhum (mesma regra da agenda visivel). Com mais de um
  // canal aceito vale o contato salvo por ultimo, que e o que a agenda de
  // um contato por parte mostrava antes da chave por canal.
  async contatoDaParte(parte: Parte, canais: CanalContato | readonly CanalContato[]): Promise<ContatoDaAgenda | null> {
    const lista = typeof canais === 'string' ? [canais] : [...canais];
    const rows = await this.db.query<ContatoDaAgenda>(
      `SELECT id, workspace_id AS "workspaceId", parte, nome, canal, destino, fonte, nao_contatar_ia AS "naoContatarIa"
       FROM contatos c WHERE workspace_id = ANY($1) AND parte = $2 AND canal = ANY($3)
       AND (workspace_id = $4 OR NOT EXISTS (
         SELECT 1 FROM contatos s WHERE s.workspace_id = $4 AND s.parte = $2))
       ORDER BY ts DESC, id DESC LIMIT 1`,
      [this.visiveis(), parte, lista, this.workspace],
    );
    const r = rows[0];
    return r ? { ...r, id: Number(r.id) } : null;
  }

  // Agenda visivel (sessao + seed) com o dono e o instante do ultimo save:
  // quem monta a agenda decide a precedencia (listarAgenda em contatos.ts).
  async listarContatos(): Promise<Array<Contato & { workspaceId: string; ts: string }>> {
    const rows = await this.db.query<Contato & { workspaceId: string; ts: Date | string }>(
      `SELECT workspace_id AS "workspaceId", parte, nome, canal, destino, fonte,
              nao_contatar_ia AS "naoContatarIa", ts
       FROM contatos WHERE workspace_id = ANY($1) ORDER BY id`,
      [this.visiveis()],
    );
    return rows.map((r) => ({ ...r, ts: r.ts instanceof Date ? r.ts.toISOString() : String(r.ts) }));
  }

  // Upsert do PUT /api/contatos por (parte, canal): sempre fonte 'manual' na
  // sessao do chamador; o save renova o ts. naoContatarIa ausente mantem o
  // valor gravado (novo contato nasce com false).
  async upsertContato(c: Contato): Promise<void> {
    await this.db.query(
      `INSERT INTO contatos (workspace_id, parte, nome, canal, destino, fonte, nao_contatar_ia)
       VALUES ($1, $2, $3, $4, $5, 'manual', COALESCE($6::boolean, false))
       ON CONFLICT (workspace_id, parte, canal)
       DO UPDATE SET nome = EXCLUDED.nome, destino = EXCLUDED.destino, fonte = 'manual', ts = now(),
         nao_contatar_ia = COALESCE($6::boolean, contatos.nao_contatar_ia)`,
      [this.workspace, c.parte, c.nome, c.canal, c.destino, c.naoContatarIa ?? null],
    );
  }

  // Bootstrap por documento: so insere quando a parte ainda nao tem contato
  // em nenhum canal; um manual cadastrado a mao nunca e tocado (RF7).
  async inserirContatoSeAusente(c: Contato): Promise<boolean> {
    const rows = await this.db.query<{ id: number }>(
      `INSERT INTO contatos (workspace_id, parte, nome, canal, destino, fonte)
       SELECT $1, $2, $3, $4, $5, $6
       WHERE NOT EXISTS (SELECT 1 FROM contatos WHERE workspace_id = $1 AND parte = $2)
       ON CONFLICT (workspace_id, parte, canal) DO NOTHING RETURNING id`,
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
  // --- Operador (spec 0017) ---

  // Dedupe de webhook (RF17): true so na primeira vez que o par chega.
  async registrarWebhookSeInedito(fornecedor: string, idEvento: string): Promise<boolean> {
    const rows = await this.db.query<{ n: number }>(
      `INSERT INTO webhook_eventos (fornecedor, id_evento) VALUES ($1, $2)
       ON CONFLICT (fornecedor, id_evento) DO NOTHING RETURNING 1 AS n`,
      [fornecedor, idEvento],
    );
    return rows.length > 0;
  }

  // O efeito falhou: o reenvio do fornecedor precisa ser processado.
  async esquecerWebhook(fornecedor: string, idEvento: string): Promise<void> {
    await this.db.query(`DELETE FROM webhook_eventos WHERE fornecedor = $1 AND id_evento = $2`, [fornecedor, idEvento]);
  }

  // contato_aceito com o id externo, em qualquer workspace, cujo
  // contato_iniciado (mesma chave, mesmo pedido) saiu pelo fornecedor. Quem
  // chama recusa quando ha mais de um: id externo ambiguo nao mapeia.
  async aceitesPorIdExterno(fornecedor: string, idExterno: string): Promise<AceiteDoFornecedor[]> {
    return this.db.query<AceiteDoFornecedor>(
      `SELECT DISTINCT a.workspace_id AS "workspaceId", a.pedido_id AS "pedidoId", a.payload->>'chave' AS chave
       FROM events a JOIN events i
         ON i.workspace_id = a.workspace_id AND i.pedido_id = a.pedido_id
        AND i.tipo = 'contato_iniciado' AND i.payload->>'chave' = a.payload->>'chave'
       WHERE a.tipo = 'contato_aceito' AND a.payload->>'idExterno' = $2 AND i.payload->>'fornecedor' = $1
       LIMIT 2`,
      [fornecedor, idExterno],
    );
  }

  // Kill switch (RF10): lido do banco a cada efeito, nunca do snapshot.
  async lerKillSwitch(): Promise<EstadoKillSwitch> {
    const rows = await this.db.query<{ escopo: string; workspace_id: string }>(
      `SELECT escopo, workspace_id FROM operador_controle WHERE acionado ORDER BY workspace_id`,
    );
    return {
      global: rows.some((r) => r.escopo === 'global'),
      workspaces: rows.filter((r) => r.escopo === 'workspace').map((r) => r.workspace_id),
    };
  }

  // workspaceId null = chave global. por: rotulo de quem mudou, nunca o token.
  async definirKillSwitch(workspaceId: string | null, acionado: boolean, por: string | null = null): Promise<void> {
    await this.db.query(
      `INSERT INTO operador_controle (escopo, workspace_id, acionado, por, atualizado_em)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (escopo, workspace_id) DO UPDATE SET acionado = EXCLUDED.acionado, por = EXCLUDED.por, atualizado_em = now()`,
      [workspaceId === null ? 'global' : 'workspace', workspaceId ?? '', acionado, por],
    );
  }

  // Sinal ao operador (RF18), idempotente por item de revisao.
  async registrarSinalOperador(pedidoId: string, revisaoId: number, fonte: string, seqDeclaracao: number | null): Promise<void> {
    await this.db.query(
      `INSERT INTO operador_sinais (workspace_id, pedido_id, revisao_id, fonte, seq_declaracao)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (workspace_id, revisao_id) DO NOTHING`,
      [this.workspace, pedidoId, revisaoId, fonte, seqDeclaracao],
    );
  }

  async sinaisOperadorPendentes(pedidoId?: string): Promise<SinalOperador[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      `SELECT * FROM operador_sinais WHERE workspace_id = $1 AND lido_em IS NULL
       AND ($2::text IS NULL OR pedido_id = $2) ORDER BY id`,
      [this.workspace, pedidoId ?? null],
    );
    return rows.map((r) => ({
      id: Number(r['id']),
      workspaceId: r['workspace_id'] as string,
      pedidoId: r['pedido_id'] as string,
      revisaoId: Number(r['revisao_id']),
      fonte: r['fonte'] as string,
      seqDeclaracao: r['seq_declaracao'] === null || r['seq_declaracao'] === undefined ? null : Number(r['seq_declaracao']),
      criadoEm: new Date(r['criado_em'] as string).toISOString(),
    }));
  }

  async marcarSinalLido(id: number): Promise<boolean> {
    const rows = await this.db.query(
      `UPDATE operador_sinais SET lido_em = now() WHERE workspace_id = $1 AND id = $2 AND lido_em IS NULL RETURNING id`,
      [this.workspace, id],
    );
    return rows.length > 0;
  }

  // Resposta de canal sem assinatura ainda na revisao: pausa a escada (RF18).
  async declaracaoEmRevisao(pedidoId: string): Promise<boolean> {
    const rows = await this.db.query(
      `SELECT 1 AS n FROM review_queue WHERE workspace_id = $1 AND status = 'pendente'
       AND payload->>'pedidoId' = $2 AND payload->>'fonte' = ANY($3::text[]) LIMIT 1`,
      [this.workspace, pedidoId, ['whatsapp_transportadora', 'ligacao_transportadora']],
    );
    return rows.length > 0;
  }
}
