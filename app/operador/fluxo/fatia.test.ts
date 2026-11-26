// Fatia do operador com as portas reais do servidor (spec 0017): gatilho da
// pendencia (T740), degrau de e-mail que sobe em 4 h (T742), espera da
// aprovacao relendo o ledger e revalidacao sob a trava (T751) e kill switch
// no meio do fluxo (T731). Postgres do app/docker-compose.yml (o DBOS nao
// roda sobre PGlite, T702); sem o banco no ar, a suite e pulada.
//
// O relogio do fluxo e falso (porta `agora`), num dia util as 10h de Sao
// Paulo; a aprovacao entra no ledger com o ts desse relogio, como a rota
// gravaria. SMTP e WhatsApp sao falsos, rotulados como teste (A7); contatos
// e telefones sao sinteticos.

import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { createDb, type Db } from '../../server/db.js';
import { verificarWorkspace } from '../../server/pendencia.js';
import { portasDoServidor } from '../../server/portas-operador.js';
import type { Remetente, SmtpConfig } from '../../server/smtp.js';
import type { CanalSSE } from '../../server/sse.js';
import { LedgerStore } from '../../server/store.js';
import type { Evento } from '../../shared/model.js';
import { criarCanalEmail } from '../canais/email.js';
import { criarPortaLedger, FonteLedgerDbos } from '../db-dbos.js';
import { alvoDaConfig, assumirCasosPendentes, configOperadorDoEnv, portasPadrao, type AlvoOperador } from '../index.js';
import { idFluxo, registrarFluxoCaso, type AdaptadorCanal, type EntradaFluxoCaso, type FluxoCaso } from './caso.js';

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

const HORA = 3_600_000;
// Quarta-feira, 25/11/2026, 10h em Sao Paulo (UTC-3).
const T0 = Date.parse('2026-11-25T13:00:00.000Z');
const SMTP: SmtpConfig = { host: 'smtp.teste.invalid', port: 587, from: 'operador@teste.invalid', dominio: 'teste.invalid', timeoutMs: 1_000 };

class RemetenteFalso implements Remetente {
  enviadas: string[] = [];
  async enviar(m: { messageId: string }) {
    this.enviadas.push(m.messageId);
  }
}

// WhatsApp falso (teste): conta os efeitos por workspace.
class WhatsappFalso implements AdaptadorCanal {
  readonly canal = 'whatsapp' as const;
  readonly fornecedor = 'falso-teste';
  readonly custoEstimadoBrl = 0;
  efeitos: Array<{ workspace: string; chave: string }> = [];
  async enviar(p: { workspace: string; chave: string }) {
    this.efeitos.push({ workspace: p.workspace, chave: p.chave });
    return { status: 'aceito' as const, idExterno: `wa-${this.efeitos.length}` };
  }
  async consultar() {
    return { status: 'desconhecido' as const };
  }
}

const canalSse = { evento: () => undefined, enviar: () => undefined } as unknown as CanalSSE;

describe.skipIf(!URL_TESTE)('fatia do operador com portas reais (Postgres)', () => {
  const url = URL_TESTE!;
  const versao = `teste-fatia-${randomUUID()}`;
  let db: Db;
  let raiz: LedgerStore;
  let fluxo: FluxoCaso;
  let relogio = T0;
  const destinos: string[] = [];
  const remetente = new RemetenteFalso();
  const whatsapp = new WhatsappFalso();

  beforeAll(async () => {
    db = await createDb(url);
    raiz = new LedgerStore(db, 'seed', 'seed');
    await raiz.init();
    const config = configOperadorDoEnv({ OPERADOR_ATIVO: '1', OPERADOR_VERSAO: versao, DATABASE_URL: url });
    const fonte = new FonteLedgerDbos({ databaseUrl: url }).registrar();
    const base = portasPadrao(config, db, criarPortaLedger(fonte, db));
    fluxo = registrarFluxoCaso(
      portasDoServidor({
        raiz,
        base,
        destinosPermitidos: destinos, // a mesma lista que entra no snapshot de cada teste
        canais: { email: criarCanalEmail({ raiz, expiraHoras: 72, remetente, smtp: SMTP }), whatsapp },
        agora: () => relogio,
      }),
    );
    DBOS.setConfig({ name: 'foundry-teste-fatia', systemDatabaseUrl: url, systemDatabaseSchemaName: 'dbos', applicationVersion: versao, logLevel: 'error' });
    await DBOS.launch();
  }, 60_000);

  afterAll(async () => {
    if (DBOS.isInitialized()) await DBOS.shutdown({ deregister: true });
    await db?.close();
  });

  // Workspace novo por teste, com e-mail e WhatsApp manuais e o telefone na
  // lista de destinos (um numero por teste: as tentativas somam workspaces).
  const preparar = async (opcoes: { email?: boolean } = {}) => {
    const ws = raiz.paraWorkspace(`teste-fatia-${randomUUID().slice(0, 8)}`);
    const pedidoId = `352611${String(Date.now()).slice(-8)}${randomUUID().replace(/\D/g, '').padEnd(30, '0').slice(0, 30)}`;
    const telefone = `+55119${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;
    destinos.splice(0, destinos.length, telefone);
    if (opcoes.email !== false) {
      await ws.upsertContato({ parte: 'transportadora', nome: 'Equipe (teste)', canal: 'email', destino: 'equipe@teste.invalid', fonte: 'manual' });
    }
    await ws.upsertContato({ parte: 'transportadora', nome: 'Equipe (teste)', canal: 'whatsapp', destino: telefone, fonte: 'manual' });
    const config = configOperadorDoEnv({
      OPERADOR_ATIVO: '1',
      OPERADOR_WORKSPACES: ws.workspace,
      OPERADOR_DESTINOS_PERMITIDOS: telefone,
    });
    const alvo: AlvoOperador = { fluxo: () => fluxo, ...alvoDaConfig(config, 'seed') };
    return { ws, pedidoId, telefone, alvo };
  };

  const eventos = (ws: LedgerStore, pedidoId: string): Promise<Evento[]> => ws.eventosDoPedido(pedidoId);
  const tipos = async (ws: LedgerStore, pedidoId: string): Promise<string[]> => (await eventos(ws, pedidoId)).map((e) => e.tipo);

  const esperar = async (ws: LedgerStore, pedidoId: string, cond: (evs: Evento[]) => boolean, ms = 20_000): Promise<Evento[]> => {
    const fim = Date.now() + ms;
    for (;;) {
      const evs = await eventos(ws, pedidoId);
      if (cond(evs)) return evs;
      if (Date.now() > fim) throw new Error(`condicao nao chegou: ${evs.map((e) => e.tipo).join(', ')}`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const tem = (tipo: string) => (evs: Evento[]) => evs.some((e) => e.tipo === tipo);
  const planoDe = (evs: Evento[]) => {
    const p = [...evs].reverse().find((e) => e.tipo === 'contato_planejado')!.payload as Record<string, unknown>;
    return { planoId: String(p['planoId']), versao: Number(p['versao']), hashRoteiro: String(p['hashRoteiro']), fluxoId: String(p['fluxoId']) };
  };

  // A rota de aprovacao grava assim (com o relogio do teste) e sinaliza.
  const aprovar = async (ws: LedgerStore, pedidoId: string, casoId: string, p: ReturnType<typeof planoDe>, ts = relogio): Promise<void> => {
    await ws.append(pedidoId, 'contato_aprovado', { casoId, planoId: p.planoId, versao: p.versao, hashRoteiro: p.hashRoteiro, aprovador: 'aprovador' }, new Date(ts).toISOString());
    await fluxo.aprovar(p.fluxoId, p.planoId, p.versao);
  };

  const fechar = async (ws: LedgerStore, pedidoId: string, casoId: string, fluxoId: string): Promise<void> => {
    await ws.append(pedidoId, 'caso_resolvido', { casoId, resolvidoPor: 'motor' });
    await fluxo.acordar(fluxoId);
  };

  it('pendencia aberta assume uma vez por caso, o e-mail sai uma vez e sobe para o WhatsApp em 4 h; aprovacao valida sai uma vez', async () => {
    relogio = T0;
    const { ws, pedidoId, alvo } = await preparar();
    await ws.append(pedidoId, 'nfe', { fonte: 'nfe', campos: { pesoTotal: 10 } }, new Date(Date.now() - 72 * HORA).toISOString());
    const gatilho = (s: LedgerStore) => assumirCasosPendentes(alvo, s);
    const efeitosAntes = whatsapp.efeitos.length;
    const enviadasAntes = remetente.enviadas.length;

    expect(await verificarWorkspace(ws, canalSse, new Date(), { horasSemAtualizacao: 24 }, gatilho)).toBe(1);
    let evs = await esperar(ws, pedidoId, tem('contato_aceito'));
    const pend = evs.find((e) => e.tipo === 'pendencia_aberta')!;
    const casoId = `${pedidoId}:${pend.seq}`;
    const fluxoId = `${ws.workspace}:${pedidoId}:${pend.seq}:1`;
    // Segundo tick: o caso ja tem operador_assumiu, nada abre de novo.
    await verificarWorkspace(ws, canalSse, new Date(), { horasSemAtualizacao: 24 }, gatilho);
    expect((await tipos(ws, pedidoId)).filter((t) => t === 'operador_assumiu')).toHaveLength(1);
    expect(remetente.enviadas.length - enviadasAntes).toBe(1);
    const iniciado = evs.find((e) => e.tipo === 'contato_iniciado')!;
    expect(iniciado.payload).toMatchObject({ casoId, canal: 'email', fornecedor: 'smtp' });
    expect(evs.filter((e) => e.tipo === 'cobranca_enviada')).toHaveLength(1);

    // 3h59: ainda no prazo do e-mail.
    relogio = T0 + 4 * HORA - 60_000;
    await fluxo.acordar(fluxoId);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await tipos(ws, pedidoId)).not.toContain('operador_escalou');

    // 4h: sobe para o WhatsApp e propoe o plano.
    relogio = T0 + 4 * HORA;
    await fluxo.acordar(fluxoId);
    evs = await esperar(ws, pedidoId, tem('contato_planejado'));
    expect(evs.find((e) => e.tipo === 'operador_escalou')!.payload).toMatchObject({ de: 'email', para: 'whatsapp', motivo: 'prazo_vencido' });
    const planejado = evs.find((e) => e.tipo === 'contato_planejado')!;
    expect(planejado.payload).toMatchObject({ casoId, canal: 'whatsapp', versao: 1, motivo: 'prazo_vencido', prazo: new Date(relogio + 30 * 60_000).toISOString() });
    expect(JSON.stringify(evs)).not.toContain(destinos[0]!);
    expect(whatsapp.efeitos.length - efeitosAntes).toBe(0); // nada sai sem o OK

    const p = planoDe(evs);
    expect((await ws.evidencia(p.hashRoteiro)) !== null).toBe(true);
    await aprovar(ws, pedidoId, casoId, p);
    await aprovar(ws, pedidoId, casoId, p); // duplo sinal: o ledger decide
    evs = await esperar(ws, pedidoId, (x) => x.filter((e) => e.tipo === 'contato_aceito').length === 2);
    expect(whatsapp.efeitos.length - efeitosAntes).toBe(1);
    const intencao = evs.filter((e) => e.tipo === 'contato_iniciado')[1]!;
    expect(intencao.payload).toMatchObject({ casoId, canal: 'whatsapp', planoId: p.planoId, versao: 1, hashRoteiro: p.hashRoteiro });

    await fechar(ws, pedidoId, casoId, fluxoId);
    await esperar(ws, pedidoId, tem('operador_encerrou'));
    expect(whatsapp.efeitos.length - efeitosAntes).toBe(1);
  }, 90_000);

  // Caso que comeca no WhatsApp (sem e-mail na agenda): plano logo de cara.
  const abrirNoWhatsapp = async () => {
    relogio = T0;
    const ctx = await preparar({ email: false });
    const ab = await ctx.ws.append(ctx.pedidoId, 'pendencia_aberta', { motivo: 'sem_atualizacao' });
    const casoId = `${ctx.pedidoId}:${ab.seq}`;
    const caso = { id: casoId, pedidoId: ctx.pedidoId, origem: 'pendencia' as const, origemSeq: ab.seq!, status: 'aberto' as const, abertoEm: ab.ts, ciclos: 0 };
    const entrada: EntradaFluxoCaso = ctx.alvo.entradaDoCaso(ctx.ws.workspace, caso, 'pendencia_aberta', 'transportadora');
    const r = await fluxo.abrir(entrada);
    if (!r.aberto) throw new Error('fluxo nao abriu');
    const evs = await esperar(ctx.ws, ctx.pedidoId, tem('contato_planejado'));
    return { ...ctx, casoId, entrada, handle: r.handle, plano: planoDe(evs) };
  };

  it('aprovacao de versao antiga nao sai; sem decisao no prazo, o plano expira', async () => {
    const { ws, pedidoId, casoId, plano, handle } = await abrirNoWhatsapp();
    const antes = whatsapp.efeitos.length;
    // O analista ajustou (versao 2) e alguem aprova a versao 1.
    await ws.append(pedidoId, 'contato_planejado', { fluxoId: plano.fluxoId, casoId, planoId: plano.planoId, versao: 2, canal: 'whatsapp', contatoId: 1, hashRoteiro: 'b'.repeat(64), prazo: new Date(relogio + 30 * 60_000).toISOString(), custoEstimadoBrl: 0 });
    await aprovar(ws, pedidoId, casoId, plano);
    await new Promise((r) => setTimeout(r, 1_500));
    expect(await tipos(ws, pedidoId)).not.toContain('contato_iniciado');
    relogio = T0 + 31 * 60_000;
    await fluxo.aprovar(plano.fluxoId, plano.planoId, 1);
    expect(await handle.getResult()).toEqual({ motivo: 'sem_aprovacao', degrau: 'whatsapp' });
    const evs = await eventos(ws, pedidoId);
    expect(evs.map((e) => e.tipo)).toContain('contato_expirado');
    expect(evs.map((e) => e.tipo)).not.toContain('contato_iniciado');
    expect(whatsapp.efeitos.length).toBe(antes);
  }, 90_000);

  it('aprovacao vencida quando o efeito ia sair: revalidada sob a trava, nada sai', async () => {
    const { ws, pedidoId, casoId, plano, handle } = await abrirNoWhatsapp();
    const antes = whatsapp.efeitos.length;
    // Aprovada ha 31 min no relogio do fluxo: passou da validade (30 min).
    await aprovar(ws, pedidoId, casoId, plano, relogio - 31 * 60_000);
    expect(await handle.getResult()).toEqual({ motivo: 'politica', degrau: 'whatsapp' });
    const evs = await eventos(ws, pedidoId);
    expect(evs.map((e) => e.tipo)).not.toContain('contato_iniciado');
    expect(evs.find((e) => e.tipo === 'contato_falhou')!.payload).toMatchObject({ planoId: plano.planoId, motivo: 'aprovacao_vencida' });
    expect(evs.find((e) => e.tipo === 'operador_encerrou')!.payload['motivos']).toEqual(['aprovacao_vencida']);
    expect(whatsapp.efeitos.length).toBe(antes);
  }, 90_000);

  it('caso fecha antes da decisao: o plano e cancelado e nada sai', async () => {
    const { ws, pedidoId, casoId, plano, handle } = await abrirNoWhatsapp();
    const antes = whatsapp.efeitos.length;
    await ws.append(pedidoId, 'caso_resolvido', { casoId, resolvidoPor: 'motor' });
    await aprovar(ws, pedidoId, casoId, plano);
    expect(await handle.getResult()).toEqual({ motivo: 'caso_fechado', degrau: 'whatsapp' });
    expect(await tipos(ws, pedidoId)).toContain('contato_expirado');
    expect(whatsapp.efeitos.length).toBe(antes);
  }, 90_000);

  it('kill switch ligado no meio do fluxo: o e-mail ja saiu, o WhatsApp aprovado nao sai (T731)', async () => {
    relogio = T0;
    const { ws, pedidoId, alvo } = await preparar();
    const ab = await ws.append(pedidoId, 'pendencia_aberta', { motivo: 'sem_atualizacao' });
    const casoId = `${pedidoId}:${ab.seq}`;
    const caso = { id: casoId, pedidoId, origem: 'pendencia' as const, origemSeq: ab.seq!, status: 'aberto' as const, abertoEm: ab.ts, ciclos: 0 };
    const entrada = alvo.entradaDoCaso(ws.workspace, caso, 'pendencia_aberta', 'transportadora');
    const r = await fluxo.abrir(entrada);
    if (!r.aberto) throw new Error('fluxo nao abriu');
    await esperar(ws, pedidoId, tem('contato_aceito'));
    const antes = whatsapp.efeitos.length;
    try {
      await raiz.definirKillSwitch(ws.workspace, true, 'teste');
      relogio = T0 + 4 * HORA;
      await fluxo.acordar(idFluxo(entrada));
      const evs = await esperar(ws, pedidoId, tem('contato_planejado'));
      await aprovar(ws, pedidoId, casoId, planoDe(evs));
      expect(await r.handle.getResult()).toEqual({ motivo: 'politica', degrau: 'whatsapp' });
      const fim = await eventos(ws, pedidoId);
      expect(fim.filter((e) => e.tipo === 'contato_iniciado')).toHaveLength(1); // so o do e-mail
      expect(fim.find((e) => e.tipo === 'contato_falhou')!.payload).toMatchObject({ canal: 'whatsapp', motivo: 'kill_switch_workspace' });
      expect(whatsapp.efeitos.length).toBe(antes);
    } finally {
      await raiz.definirKillSwitch(ws.workspace, false, 'teste');
    }
  }, 90_000);
});
