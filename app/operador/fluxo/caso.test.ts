// T725: fluxo por caso no DBOS, com queda em tres pontos. Roda no Postgres do
// app/docker-compose.yml (o DBOS nao roda sobre PGlite, T702); sem o banco
// no ar, a suite e pulada. A "queda" e um DBOS.shutdown com o fluxo preso
// num ponto, seguido de launch: a recuperacao do DBOS retoma o fluxo.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createDb, type Db } from '../../server/db.js';
import { LedgerStore, type ContatoDaAgenda } from '../../server/store.js';
import type { Evento } from '../../shared/model.js';
import { criarPortaLedger, FonteLedgerDbos } from '../db-dbos.js';
import { POLITICA_PADRAO } from '../politica.js';
import {
  chaveEfeito,
  hashDestinos,
  idFluxo,
  registrarFluxoCaso,
  snapshotPolitica,
  type AdaptadorCanal,
  type EntradaFluxoCaso,
  type EstadoCasoFluxo,
  type FluxoCaso,
  type PortasFluxo,
} from './caso.js';

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

// Pontos onde o teste prende o fluxo para derrubar o processo.
type Ponto = 'killSwitch' | 'enviar' | 'estadoCaso';

// Fornecedor falso (rotulado como teste): conta efeitos e lembra a chave.
class CanalFalso implements AdaptadorCanal {
  readonly canal = 'email' as const;
  readonly fornecedor = 'falso-teste';
  readonly custoEstimadoBrl = 0;
  efeitos: string[] = [];
  consultas: string[] = [];
  aceitos = new Map<string, string>();
  modo: 'aceita' | 'recusa' | 'lanca' = 'aceita';
  queda: (() => Promise<never>) | null = null;

  async enviar(p: { chave: string }) {
    this.efeitos.push(p.chave);
    if (this.modo === 'recusa') return { status: 'recusado' as const, motivo: 'caixa_inexistente' };
    if (this.modo === 'lanca') throw new Error('timeout depois do pedido');
    const id = `ext-${this.efeitos.length}`;
    this.aceitos.set(p.chave, id);
    if (this.queda) await this.queda(); // o fornecedor aceitou, a resposta se perdeu
    return { status: 'aceito' as const, idExterno: id };
  }

  async consultar(chave: string) {
    this.consultas.push(chave);
    const id = this.aceitos.get(chave);
    return id ? { status: 'aceito' as const, idExterno: id } : { status: 'desconhecido' as const };
  }
}

describe.skipIf(!URL_TESTE)('fluxo do caso no DBOS (Postgres)', () => {
  const url = URL_TESTE!;
  const versao = `teste-${randomUUID()}`;
  let db: Db;
  let fluxo: FluxoCaso;

  // Estado do mundo falso, trocado por teste.
  let canal: CanalFalso;
  let estado: EstadoCasoFluxo;
  let kill = { global: false, workspaces: [] as string[] };
  let presoEm: Ponto | null = null;
  let chegou: (() => void) | null = null;

  const nunca = (): Promise<never> => {
    chegou?.();
    return new Promise<never>(() => undefined);
  };

  const contato = (workspace: string, canalPedido: string): ContatoDaAgenda | null =>
    canalPedido === 'email'
      ? { id: 41, workspaceId: workspace, parte: 'transportadora', nome: 'Equipe (teste)', canal: 'email', destino: 'equipe@example.com', fonte: 'manual', naoContatarIa: false }
      : null;

  const subir = async (): Promise<void> => {
    const fonte = new FonteLedgerDbos({ databaseUrl: url }).registrar();
    const portas: PortasFluxo = {
      ledger: criarPortaLedger(fonte, db),
      canais: {
        get email() {
          return canal;
        },
      },
      killSwitch: async () => (presoEm === 'killSwitch' ? nunca() : kill),
      contato: async (w, _p, c) => contato(w, c),
      contadores: async () => ({ tentativasHojeDestino: 0, gastoCasoBrl: 0, gastoDiaBrl: 0 }),
      destinosPermitidos: async () => [],
      estadoCaso: async () => (presoEm === 'estadoCaso' ? nunca() : estado),
      aprovacaoValida: async () => false,
      agora: () => Date.now(),
    };
    fluxo = registrarFluxoCaso(portas);
    DBOS.setConfig({ name: 'foundry-teste-caso', systemDatabaseUrl: url, systemDatabaseSchemaName: 'dbos', applicationVersion: versao, logLevel: 'error' });
    await DBOS.launch();
  };

  const cair = (): Promise<void> => DBOS.shutdown({ deregister: true });

  const entrada = (over: Partial<EntradaFluxoCaso> = {}): EntradaFluxoCaso => {
    const workspace = over.workspace ?? `teste-caso-${randomUUID().slice(0, 8)}`;
    const pedidoId = over.pedidoId ?? `p-${randomUUID()}`;
    return {
      workspace,
      pedidoId,
      casoId: `${pedidoId}:3`,
      seqOrigem: 3,
      ciclo: 1,
      parte: 'transportadora',
      gatilho: 'pendencia_aberta',
      politica: snapshotPolitica(workspace, { ...POLITICA_PADRAO, workspacesHabilitados: [workspace] }, {
        emailH: 4,
        whatsappH: 1,
        aprovacaoValidadeMin: 30,
      }),
      ...over,
    };
  };

  const eventos = (e: EntradaFluxoCaso): Promise<Evento[]> => new LedgerStore(db, e.workspace).eventosDoPedido(e.pedidoId);
  const tipos = async (e: EntradaFluxoCaso): Promise<string[]> => (await eventos(e)).map((ev) => ev.tipo);

  // Abre o fluxo, espera ele chegar no ponto, derruba e sobe de novo.
  const quedaEm = async (ponto: Ponto, e: EntradaFluxoCaso): Promise<void> => {
    presoEm = ponto;
    if (ponto === 'enviar') canal.queda = nunca;
    const chegada = new Promise<void>((r) => (chegou = r));
    const r = await fluxo.abrir(e);
    expect(r.aberto).toBe(true);
    await chegada;
    await cair();
    presoEm = null;
    canal.queda = null;
    chegou = null;
    await subir();
  };

  const resultado = (e: EntradaFluxoCaso) => DBOS.retrieveWorkflow<{ motivo: string }>(idFluxo(e)).getResult();

  beforeAll(async () => {
    db = await createDb(url);
    await new LedgerStore(db, 'seed').init();
    canal = new CanalFalso();
    estado = { casoFechado: true, optout: false, declaracao: 'nenhuma' };
    await subir();
  }, 60_000);

  afterAll(async () => {
    if (DBOS.isInitialized()) await cair();
    await db?.close();
  });

  const novoMundo = (): void => {
    canal = new CanalFalso();
    estado = { casoFechado: true, optout: false, declaracao: 'nenhuma' };
    kill = { global: false, workspaces: [] };
  };

  it('caminho feliz: snapshot sem destinos, intencao, aceite e encerramento', async () => {
    novoMundo();
    await cair();
    await subir();
    const e = entrada();
    const r = await fluxo.abrir(e);
    expect(r.aberto).toBe(true);
    if (!r.aberto) return;
    expect(r.fluxoId).toBe(`${e.workspace}:${e.pedidoId}:3:1`);
    expect(await r.handle.getResult()).toEqual({ motivo: 'caso_fechado', degrau: 'email' });
    expect(await tipos(e)).toEqual(['operador_assumiu', 'contato_iniciado', 'contato_aceito', 'operador_encerrou']);
    const [assumiu, iniciado] = await eventos(e);
    const politica = assumiu!.payload['politica'] as Record<string, unknown>;
    expect(politica['destinosHash']).toBe(hashDestinos([]));
    expect(politica).not.toHaveProperty('destinosPermitidos');
    expect(politica).not.toHaveProperty('workspacesHabilitados');
    expect(iniciado!.payload['chave']).toBe(chaveEfeito(r.fluxoId, 'email', 1));
    expect(JSON.stringify(await eventos(e))).not.toContain('equipe@example.com');
    expect(canal.efeitos).toHaveLength(1);
  }, 60_000);

  it('queda antes do contato_iniciado: retoma e o efeito sai uma vez', async () => {
    novoMundo();
    await cair();
    await subir();
    const e = entrada();
    await quedaEm('killSwitch', e);
    expect(await resultado(e)).toMatchObject({ motivo: 'caso_fechado' });
    expect(canal.efeitos).toHaveLength(1);
    expect(canal.consultas).toHaveLength(0);
    expect(await tipos(e)).toEqual(['operador_assumiu', 'contato_iniciado', 'contato_aceito', 'operador_encerrou']);
  }, 60_000);

  it('queda entre o contato_iniciado e o aceite: consulta pela chave, nao reenvia', async () => {
    novoMundo();
    await cair();
    await subir();
    const e = entrada();
    await quedaEm('enviar', e);
    expect(await resultado(e)).toMatchObject({ motivo: 'caso_fechado' });
    expect(canal.efeitos).toHaveLength(1);
    expect(canal.consultas).toHaveLength(1);
    const evs = await eventos(e);
    expect(evs.map((x) => x.tipo)).toEqual(['operador_assumiu', 'contato_iniciado', 'contato_aceito', 'operador_encerrou']);
    expect(evs[2]!.payload).toMatchObject({ idExterno: 'ext-1', consultado: true });
  }, 60_000);

  it('queda depois do aceite: retoma na espera sem repetir efeito nem evento', async () => {
    novoMundo();
    await cair();
    await subir();
    const e = entrada();
    await quedaEm('estadoCaso', e);
    expect(await resultado(e)).toMatchObject({ motivo: 'caso_fechado' });
    expect(canal.efeitos).toHaveLength(1);
    expect(canal.consultas).toHaveLength(0);
    expect(await tipos(e)).toEqual(['operador_assumiu', 'contato_iniciado', 'contato_aceito', 'operador_encerrou']);
  }, 60_000);

  it('segundo caso da mesma contraparte nao abre fluxo novo', async () => {
    novoMundo();
    estado = { casoFechado: false, optout: false, declaracao: 'nenhuma' };
    const a = entrada();
    const ra = await fluxo.abrir(a);
    expect(ra.aberto).toBe(true);
    const b = entrada({ workspace: a.workspace, pedidoId: a.pedidoId, casoId: `${a.pedidoId}:9`, seqOrigem: 9 });
    const rb = await fluxo.abrir(b);
    expect(rb).toEqual({ aberto: false, motivo: 'fluxo_ativo', fluxoId: idFluxo(a) });
    // O mesmo caso de novo tambem nao duplica.
    expect(await fluxo.abrir(a)).toMatchObject({ aberto: false, fluxoId: idFluxo(a) });
    // Fecha o caso e acorda o fluxo: o sinal so acelera, o fluxo rele o estado.
    estado = { casoFechado: true, optout: false, declaracao: 'nenhuma' };
    await fluxo.acordar(idFluxo(a));
    expect(await resultado(a)).toMatchObject({ motivo: 'caso_fechado' });
    expect(canal.efeitos).toHaveLength(1);
    expect((await tipos(a)).filter((t) => t === 'operador_assumiu')).toHaveLength(1);
  }, 60_000);

  it('kill switch acionado: nenhum efeito sai e o caso volta ao analista', async () => {
    novoMundo();
    kill = { global: true, workspaces: [] };
    const e = entrada();
    const r = await fluxo.abrir(e);
    if (!r.aberto) throw new Error('fluxo nao abriu');
    expect(await r.handle.getResult()).toEqual({ motivo: 'politica', degrau: 'email' });
    expect(canal.efeitos).toHaveLength(0);
    const evs = await eventos(e);
    expect(evs.map((x) => x.tipo)).toEqual(['operador_assumiu', 'operador_encerrou']);
    expect(evs[1]!.payload['motivos']).toContain('kill_switch_global');
  }, 60_000);

  it('falha ambigua sem resposta na consulta: contato_incerto, sem nova tentativa', async () => {
    novoMundo();
    canal.modo = 'lanca';
    const e = entrada();
    const r = await fluxo.abrir(e);
    if (!r.aberto) throw new Error('fluxo nao abriu');
    expect(await r.handle.getResult()).toEqual({ motivo: 'contato_incerto', degrau: 'email' });
    expect(canal.efeitos).toHaveLength(1);
    expect(canal.consultas).toHaveLength(1);
    expect(await tipos(e)).toEqual(['operador_assumiu', 'contato_iniciado', 'contato_incerto', 'operador_encerrou']);
  }, 60_000);

  it('recusa do fornecedor: contato_falhou, sem retry, e sobe de degrau', async () => {
    novoMundo();
    canal.modo = 'recusa';
    const e = entrada();
    const r = await fluxo.abrir(e);
    if (!r.aberto) throw new Error('fluxo nao abriu');
    // Sem contato de WhatsApp nem ligacao, a escada devolve ao analista.
    expect(await r.handle.getResult()).toEqual({ motivo: 'contato_falhou', degrau: 'analista' });
    expect(canal.efeitos).toHaveLength(1);
    expect(await tipos(e)).toEqual(['operador_assumiu', 'contato_iniciado', 'contato_falhou', 'operador_encerrou']);
  }, 60_000);
});
