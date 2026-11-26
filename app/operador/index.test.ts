// T724: modulo do operador. Lock de lider no Postgres do
// app/docker-compose.yml; sem o banco no ar, os testes com banco sao pulados.
// O DBOS e um singleton por processo, entao as duas instancias do teste de
// lideranca usam um lancador falso que registra quem subiu; o lancador real
// sobe uma vez no teste do Fastify.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import Fastify from 'fastify';
import { afterAll, describe, expect, it } from 'vitest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createDb, type Db } from '../server/db.js';
import { LedgerStore } from '../server/store.js';
import { configOperadorDoEnv, iniciarOperador, registrarOperador, type ConfigOperador, type LancadorOperador } from './index.js';

const BASE = process.env['DATABASE_URL'] ?? 'postgres://foundry:foundry@localhost:5432/foundry';
const NOME_BANCO = 'foundry_teste_operador';

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
    if (code !== '42P04' && code !== '23505') throw e;
  } finally {
    await c.end();
  }
  const url = new URL(BASE);
  url.pathname = `/${NOME_BANCO}`;
  return url.toString();
}

const URL_TESTE = await bancoDeTeste();

class LancadorFalso implements LancadorOperador {
  lancados = 0;
  parados = 0;
  async lancar() {
    this.lancados++;
  }
  async parar() {
    this.parados++;
  }
}

const esperar = async (cond: () => boolean, ms = 5_000): Promise<void> => {
  const fim = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > fim) throw new Error('condicao nao chegou');
    await new Promise((r) => setTimeout(r, 25));
  }
};

describe('configuracao do operador', () => {
  it('le o env uma vez, com padrao seguro', () => {
    const c = configOperadorDoEnv({
      OPERADOR_ATIVO: '1',
      OPERADOR_VERSAO: 'v42',
      DATABASE_URL: 'postgres://x/app',
      OPERADOR_WORKSPACES: 'a, b,',
      OPERADOR_DESTINOS_PERMITIDOS: '+5511999990000',
      OPERADOR_JANELA: '9-17',
    });
    expect(c).toMatchObject({ ativo: true, versao: 'v42', systemDatabaseUrl: 'postgres://x/app', schemaDbos: 'dbos' });
    expect(c.politica.workspacesHabilitados).toEqual(['a', 'b']);
    expect(c.politica.janela).toEqual({ inicioHora: 9, fimHora: 17 });
    expect(c.prazos).toEqual({ emailH: 4, whatsappH: 1, aprovacaoValidadeMin: 30 });
    expect(configOperadorDoEnv({}).ativo).toBe(false);
  });

  it('desligado sem OPERADOR_ATIVO=1 e parado sem OPERADOR_VERSAO: nao conecta nem sobe', async () => {
    const l = new LancadorFalso();
    const desligado = await iniciarOperador({ config: configOperadorDoEnv({ DATABASE_URL: 'postgres://nada:1/x' }), lancador: l });
    expect(desligado.estado).toBe('desligado');
    const semVersao = await iniciarOperador({
      config: configOperadorDoEnv({ OPERADOR_ATIVO: '1', DATABASE_URL: 'postgres://nada:1/x' }),
      lancador: l,
    });
    expect(semVersao.estado).toBe('sem_versao');
    expect(l.lancados).toBe(0);
  });
});

describe.skipIf(!URL_TESTE)('lideranca do operador (Postgres)', () => {
  const url = URL_TESTE!;
  const config = (): ConfigOperador =>
    configOperadorDoEnv({ OPERADOR_ATIVO: '1', OPERADOR_VERSAO: 'teste', DATABASE_URL: url });

  it('duas instancias: so a lider sobe o executor; a reserva assume quando a lider para', async () => {
    const chaveLock = `teste:lider:${randomUUID()}`;
    const la = new LancadorFalso();
    const lb = new LancadorFalso();
    const a = await iniciarOperador({ config: config(), lancador: la, chaveLock, intervaloLiderMs: 50 });
    const b = await iniciarOperador({ config: config(), lancador: lb, chaveLock, intervaloLiderMs: 50 });
    try {
      expect(a.estado).toBe('lider');
      expect(b.estado).toBe('reserva');
      expect(la.lancados).toBe(1);
      expect(lb.lancados).toBe(0);
      // A reserva segue tentando e continua sem subir enquanto a lider vive.
      await new Promise((r) => setTimeout(r, 200));
      expect(lb.lancados).toBe(0);

      await a.parar();
      expect(a.estado).toBe('parado');
      expect(la.parados).toBe(1);
      await esperar(() => b.lider);
      expect(lb.lancados).toBe(1);
    } finally {
      await a.parar();
      await b.parar();
    }
  }, 30_000);

  it('lider que perde a conexao do lock para o executor e volta para a reserva', async () => {
    const chaveLock = `teste:lider:${randomUUID()}`;
    const la = new LancadorFalso();
    const a = await iniciarOperador({ config: config(), lancador: la, chaveLock, intervaloLiderMs: 0 });
    try {
      expect(a.lider).toBe(true);
      const adm = new pg.Client({ connectionString: url });
      await adm.connect();
      await adm.query(
        `SELECT pg_terminate_backend(pid) FROM pg_stat_activity
         WHERE application_name = 'forseti-operador-lider' AND datname = current_database() AND pid <> pg_backend_pid()`,
      );
      await adm.end();
      await esperar(() => a.estado === 'reserva');
      expect(la.parados).toBe(1);
    } finally {
      await a.parar();
    }
  }, 30_000);

  describe('Fastify com o DBOS real', () => {
    let db: Db | null = null;
    afterAll(async () => {
      if (DBOS.isInitialized()) await DBOS.shutdown({ deregister: true });
      await db?.close();
    });

    it('registrarOperador sobe o DBOS com a versao do env e para no onClose', async () => {
      db = await createDb(url);
      await new LedgerStore(db, 'seed').init();
      const app = Fastify();
      const versao = `teste-${randomUUID()}`;
      const mod = await registrarOperador(app, {
        db,
        env: { OPERADOR_ATIVO: '1', OPERADOR_VERSAO: versao, DATABASE_URL: url },
        intervaloLiderMs: 0,
      });
      expect(mod.operador.estado).toBe('lider');
      expect(DBOS.applicationVersion).toBe(versao);
      expect(mod.fluxo()).not.toBeNull();
      const r = await app.inject({ method: 'GET', url: '/api/operador/estado' });
      expect(r.json()).toEqual({ estado: 'lider', lider: true, versao });
      await app.close();
      expect(mod.operador.estado).toBe('parado');
      expect(DBOS.isInitialized()).toBe(false);
      expect(mod.fluxo()).toBeNull();
    }, 60_000);
  });
});
