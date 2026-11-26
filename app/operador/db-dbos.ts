// Adaptador Db sobre o client transacional do DBOS (spec 0017, T723 e
// NFR-dados): o append do ledger roda num passo transacional do fluxo, e o
// evento e o checkpoint do passo entram na mesma transacao do Postgres do app.
//
// O SDK 5.7 deixou as transacoes para fontes de dados registradas
// (`@dbos-inc/dbos-sdk/datasource`). O pacote pronto para node-postgres nao
// esta nas dependencias, entao esta fonte implementa o contrato publico
// `DataSourceTransactionHandler` sobre o `pg` que o app ja usa:
//   1. abre a transacao e procura o checkpoint (workflow, passo) em
//      `<schema>.transaction_completion`; se existir, devolve o resultado
//      gravado sem rodar o callback (replay depois de queda);
//   2. roda o callback com um `Db` preso ao client da transacao;
//   3. grava o checkpoint, confere que esta execucao ainda e dona do fluxo
//      (`assertStillOwnsWorkflow`) e so entao faz COMMIT.
// Queda entre o COMMIT e o registro do passo no banco de sistema do DBOS:
// na recuperacao o passo roda de novo, acha o checkpoint e nao grava o
// evento outra vez.
//
// O resultado do callback precisa ser JSON puro: e o que o checkpoint
// guarda, e a primeira execucao devolve a mesma copia que o replay daria.

import { AsyncLocalStorage } from 'node:async_hooks';
import pg from 'pg';
import { DBOS } from '@dbos-inc/dbos-sdk';
import {
  assertStillOwnsWorkflow,
  checkpointWorkflowID,
  guardDataSourcePoolPG,
  isPGKeyConflictError,
  migrateDataSourcePG,
  registerDataSource,
  replayRecordedStep,
  runTransaction,
  type DataSourceTransactionHandler,
  type PGTransactionConfig,
} from '@dbos-inc/dbos-sdk/datasource';
import type { Db } from '../server/db.js';
import { LedgerStore } from '../server/store.js';
import type { PortaLedger } from './fluxo/caso.js';

export const NOME_FONTE_LEDGER = 'foundry-ledger';
export const SCHEMA_DBOS_PADRAO = 'dbos';

export interface OpcoesFonteLedger {
  databaseUrl: string; // Postgres do app (DATABASE_URL): onde mora `events`
  schema?: string; // schema do checkpoint; padrao 'dbos', o mesmo do estado do DBOS
  nome?: string;
  tamanhoPool?: number;
}

// Db preso a um client que ja esta numa transacao. Transacao aninhada junta
// a externa, como o PgDb de server/db.ts: o append do LedgerStore abre
// `db.transaction` e cai no mesmo client.
class DbNaTransacao implements Db {
  constructor(private readonly client: pg.PoolClient) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const r = await this.client.query(sql, params as never[]);
    return r.rows as T[];
  }

  async exec(sql: string): Promise<void> {
    await this.client.query(sql);
  }

  async transaction<T>(fn: (db: Db) => Promise<T>): Promise<T> {
    return fn(this);
  }

  async close(): Promise<void> {
    throw new Error('db-dbos: o client do passo e da fonte; nao feche dentro do callback');
  }
}

function aspas(nome: string): string {
  return `"${nome.replace(/"/g, '""')}"`;
}

function inicioTransacao(cfg: PGTransactionConfig): string {
  const partes = ['BEGIN'];
  if (cfg.isolationLevel) partes.push(`ISOLATION LEVEL ${cfg.isolationLevel}`);
  if (cfg.readOnly) partes.push('READ ONLY');
  return partes.join(' ');
}

// Formato do SuperJSON que o `replayRecordedStep` do SDK le: JSON puro vai
// em { json } sem meta.
function serializarSaida(valor: unknown): string | null {
  if (valor === undefined) return null;
  return JSON.stringify({ json: valor });
}

function copiaJson<T>(valor: T): T {
  if (valor === undefined) return valor;
  return JSON.parse(JSON.stringify(valor)) as T;
}

export class FonteLedgerDbos implements DataSourceTransactionHandler {
  readonly name: string;
  readonly schema: string;
  private readonly databaseUrl: string;
  private readonly tamanhoPool: number;
  private pool: pg.Pool | null = null;
  private readonly clientAtual = new AsyncLocalStorage<pg.PoolClient>();

  constructor(opcoes: OpcoesFonteLedger) {
    this.name = opcoes.nome ?? NOME_FONTE_LEDGER;
    this.schema = opcoes.schema ?? SCHEMA_DBOS_PADRAO;
    this.databaseUrl = opcoes.databaseUrl;
    this.tamanhoPool = opcoes.tamanhoPool ?? 5;
  }

  // Registra no DBOS; precisa vir antes de DBOS.launch (e de novo depois de
  // um shutdown com deregister).
  registrar(): this {
    registerDataSource(this);
    return this;
  }

  private get tabela(): string {
    return `${aspas(this.schema)}.transaction_completion`;
  }

  private poolAberto(): pg.Pool {
    if (!this.pool) throw new Error(`db-dbos: fonte ${this.name} sem pool; DBOS.launch chama initialize`);
    return this.pool;
  }

  async initialize(): Promise<void> {
    if (this.pool) return;
    const pool = new pg.Pool({
      connectionString: this.databaseUrl,
      max: this.tamanhoPool,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 15_000,
      idle_in_transaction_session_timeout: 30_000,
      application_name: 'forseti-operador',
    });
    guardDataSourcePoolPG(pool, 'foundry-ledger');
    // Migracao do schema do checkpoint numa transacao so, como o SDK pede.
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await migrateDataSourcePG(async (sql) => (await client.query(sql)).rows, this.schema);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
      throw e;
    }
    client.release();
    this.pool = pool;
  }

  async destroy(): Promise<void> {
    const pool = this.pool;
    this.pool = null;
    if (pool) await pool.end();
  }

  async deleteCheckpoints(workflowID: string, startStep: number, beforeCommit?: () => Promise<void>): Promise<void> {
    const client = await this.poolAberto().connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM ${this.tabela} WHERE workflow_id = $1 AND function_num >= $2`, [
        checkpointWorkflowID(workflowID),
        startStep,
      ]);
      if (beforeCommit) await beforeCommit();
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  private async checkpointGravado(
    client: pg.PoolClient | pg.Pool,
    id: string,
    passo: number,
  ): Promise<{ output: string | null; error: string | null } | null> {
    const r = await client.query<{ output: string | null; error: string | null }>(
      `SELECT output, error FROM ${this.tabela} WHERE workflow_id = $1 AND function_num = $2`,
      [id, passo],
    );
    return r.rows[0] ?? null;
  }

  async invokeTransactionFunction<This, Args extends unknown[], Return>(
    config: unknown,
    target: This,
    func: (this: This, ...args: Args) => Promise<Return>,
    ...args: Args
  ): Promise<Return> {
    const cfg = (config ?? {}) as PGTransactionConfig;
    const workflowID = DBOS.workflowID;
    const passo = DBOS.stepID;
    // Fora de fluxo (teste, script): transacao comum, sem checkpoint.
    const comCheckpoint = workflowID !== undefined && passo !== undefined;
    const idCheckpoint = comCheckpoint ? checkpointWorkflowID(workflowID) : '';
    const client = await this.poolAberto().connect();
    let liberado = false;
    const liberar = (): void => {
      if (!liberado) client.release();
      liberado = true;
    };
    try {
      await client.query(inicioTransacao(cfg));
      if (comCheckpoint) {
        const gravado = await this.checkpointGravado(client, idCheckpoint, passo);
        if (gravado) {
          await client.query('ROLLBACK');
          liberar();
          return replayRecordedStep<Return>(gravado);
        }
      }
      const resultado = copiaJson(await this.clientAtual.run(client, () => func.call(target, ...args)));
      if (comCheckpoint) {
        try {
          await client.query(`INSERT INTO ${this.tabela} (workflow_id, function_num, output) VALUES ($1, $2, $3)`, [
            idCheckpoint,
            passo,
            serializarSaida(resultado),
          ]);
        } catch (e) {
          if (!isPGKeyConflictError(e)) throw e;
          // Execucao concorrente gravou primeiro: desfaz esta e devolve a dela.
          await client.query('ROLLBACK');
          liberar();
          const dela = await this.checkpointGravado(this.poolAberto(), idCheckpoint, passo);
          if (!dela) throw e;
          return replayRecordedStep<Return>(dela);
        }
        // Depois do checkpoint: um dono mais novo espera este COMMIT, e esta
        // execucao, se ficou velha, desfaz em vez de gravar.
        await assertStillOwnsWorkflow(workflowID);
      }
      await client.query('COMMIT');
      return resultado;
    } catch (e) {
      if (!liberado) {
        await client.query('ROLLBACK').catch(() => undefined);
      }
      // DBOSWorkflowConflictError sobe como veio: o SDK estaciona a execucao.
      throw e;
    } finally {
      liberar();
    }
  }

  // Db da transacao corrente; so existe dentro de `noPasso`.
  private dbDoPasso(): Db {
    const client = this.clientAtual.getStore();
    if (!client) throw new Error('db-dbos: Db do passo pedido fora de noPasso');
    return new DbNaTransacao(client);
  }

  // Roda `fn` numa transacao do Postgres do app. Chamado de dentro de um
  // fluxo DBOS, vira passo transacional: o que `fn` grava e o checkpoint do
  // passo sao confirmados juntos. Fora de fluxo, e transacao comum.
  noPasso<T>(nome: string, fn: (db: Db) => Promise<T>, config?: PGTransactionConfig): Promise<T> {
    return runTransaction(() => fn(this.dbDoPasso()), nome, { dsName: this.name, config: config ?? {} });
  }
}

// Porta do ledger do fluxo (fluxo/caso.ts) sobre esta fonte. `registrar`
// grava no passo transacional; `registrarIntencao` grava o contato_iniciado
// com commit proprio no Db do app, antes do efeito, e traduz o indice unico
// da chave em 'ja_existia'.
export function criarPortaLedger(fonte: FonteLedgerDbos, dbApp: Db): PortaLedger {
  return {
    registrar: (nome, workspace, pedidoId, eventos) =>
      fonte.noPasso(nome, (db) => new LedgerStore(db, workspace).appendVarios(pedidoId, eventos)),
    async registrarIntencao(workspace, pedidoId, payload, revalidar) {
      try {
        if (!revalidar) {
          await new LedgerStore(dbApp, workspace).append(pedidoId, 'contato_iniciado', payload);
          return 'gravado';
        }
        // Sob a trava do pedido, a mesma das rotas de plano (T751): quem
        // aprova, recusa ou ajusta espera esta transacao, e vice-versa.
        return await dbApp.transaction(async (tx) => {
          const s = new LedgerStore(tx, workspace);
          await s.travarPedido(pedidoId);
          const motivo = revalidar(await s.eventosDoPedido(pedidoId));
          if (motivo) return { bloqueado: motivo };
          await s.append(pedidoId, 'contato_iniciado', payload);
          return 'gravado' as const;
        });
      } catch (e) {
        if (isPGKeyConflictError(e)) return 'ja_existia';
        throw e;
      }
    },
    async intencaoExiste(workspace, pedidoId, chave) {
      const eventos = await new LedgerStore(dbApp, workspace).eventosDoPedido(pedidoId);
      return eventos.some((e) => e.tipo === 'contato_iniciado' && e.payload['chave'] === chave);
    },
  };
}
