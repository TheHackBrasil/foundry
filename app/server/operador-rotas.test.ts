// Rotas do operador (spec 0017): acionar numa divergencia (T741), planos e
// decisao do analista com credencial de aprovador (T750), linha do tempo e
// evidencia so para a sessao dona (T770). PGlite em memoria e um modulo do
// operador falso (o DBOS nao roda sobre PGlite, T702); chave, ids, hashes e
// contatos sao sinteticos (A7).

import { randomUUID } from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';
import { alvoDaConfig, configOperadorDoEnv, type AlvoOperador } from '../operador/index.js';
import { idFluxo, type EntradaFluxoCaso } from '../operador/fluxo/caso.js';
import { hashRoteiro, montarRoteiro, serializarRoteiro } from '../operador/roteiro.js';
import { configDoEnv } from './config.js';
import { createLiteDb } from './db.js';
import { buildServer } from './index.js';
import type { LedgerStore } from './store.js';

const CHAVE = '35260123456789000123550010000000011000000019';
const WS = 'ws-rotas-operador';
const OUTRO = randomUUID(); // sessao de outro visitante, pelo cookie
const TOKEN = 'aprovador-de-teste-0123456789';
const AUTH = { authorization: `Bearer ${TOKEN}` };
const H = (c: string): string => c.repeat(64);

type App = Awaited<ReturnType<typeof buildServer>>['app'];

interface Mundo {
  app: App;
  raiz: LedgerStore;
  ws: LedgerStore;
  abertos: EntradaFluxoCaso[];
  sinais: Array<[string, string, number]>;
  lider: { valor: boolean };
}

async function subir(): Promise<Mundo> {
  const db = await createLiteDb();
  const abertos: EntradaFluxoCaso[] = [];
  const sinais: Array<[string, string, number]> = [];
  const lider = { valor: true };
  const config = configOperadorDoEnv({ OPERADOR_ATIVO: '1', OPERADOR_WORKSPACES: `${WS},seed` });
  const alvo: AlvoOperador = {
    ...alvoDaConfig(config, 'seed'),
    fluxo: () =>
      lider.valor
        ? {
            async abrir(e) {
              const fluxoId = idFluxo(e);
              if (abertos.some((a) => idFluxo(a) === fluxoId)) return { aberto: false, motivo: 'fluxo_existente', fluxoId };
              abertos.push(e);
              return { aberto: true, fluxoId, handle: {} as never };
            },
            acordar: async () => undefined,
            async aprovar(fluxoId, planoId, versao) {
              sinais.push([fluxoId, planoId, versao]);
            },
            acordarPedido: async () => 0,
          }
        : null,
  };
  const base = await buildServer(db, {
    workspacePadrao: WS,
    config: { ...configDoEnv({}), operadorAprovadorToken: TOKEN },
    operador: alvo,
  });
  return { app: base.app, raiz: base.store, ws: base.store.paraWorkspace(WS), abertos, sinais, lider };
}

const cookieDe = (ws: string): Record<string, string> => ({ cookie: `foundry_ws=${ws}` });

async function divergencia(s: LedgerStore, fonteB: string = 'cte', pedidoId = CHAVE): Promise<string> {
  await s.append(pedidoId, 'nfe', { fonte: 'nfe', campos: { pesoTotal: 100 } });
  const ev = await s.append(pedidoId, 'divergencia', {
    campo: 'pesoTotal',
    fonteA: 'nfe',
    fonteB,
    valorA: 100,
    valorB: 140,
    tipo: 'contradicao',
    token: randomUUID(),
  });
  return `${pedidoId}:${ev.seq}`;
}

// Plano proposto como o fluxo grava: roteiro em evidencia, hash no ledger.
async function planoProposto(
  s: LedgerStore,
  casoId: string,
  over: { planoId?: string; prazoMs?: number; guardarRoteiro?: boolean } = {},
): Promise<{ planoId: string; hash: string }> {
  const roteiro = montarRoteiro({
    canal: 'whatsapp',
    chaveNota: CHAVE,
    motivo: 'prazo_vencido',
    contato: { nome: 'Equipe (teste)', destino: '+5511900000000' },
  });
  const conteudo = serializarRoteiro(roteiro);
  const hash = hashRoteiro(conteudo);
  if (over.guardarRoteiro !== false) await s.guardarEvidencia(hash, 'roteiro', conteudo);
  const planoId = over.planoId ?? H('1');
  await s.append(CHAVE, 'contato_planejado', {
    fluxoId: `${s.workspace}:${CHAVE}:1:1`,
    casoId,
    planoId,
    versao: 1,
    canal: 'whatsapp',
    contatoId: 7,
    hashRoteiro: hash,
    prazo: new Date(over.prazoMs ?? Date.now() + 30 * 60_000).toISOString(),
    custoEstimadoBrl: 0.4,
    motivo: 'prazo_vencido',
  });
  return { planoId, hash };
}

async function pendencia(s: LedgerStore): Promise<string> {
  const ev = await s.append(CHAVE, 'pendencia_aberta', { motivo: 'sem_atualizacao', token: randomUUID() });
  return `${CHAVE}:${ev.seq}`;
}

const url = (casoId: string, resto = ''): string => `/api/casos/${encodeURIComponent(casoId)}${resto}`;

describe('POST /api/casos/:id/acionar (T741)', () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await subir();
  });

  it('abre a escada uma vez por divergencia; o segundo clique responde 409', async () => {
    const casoId = await divergencia(m.ws);
    const r1 = await m.app.inject({ method: 'POST', url: url(casoId, '/acionar') });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toMatchObject({ ok: true, fluxoId: `${WS}:${CHAVE}:2:1` });
    expect(m.abertos).toHaveLength(1);
    expect(m.abertos[0]).toMatchObject({ casoId, gatilho: 'acionar_operador', workspace: WS, seqOrigem: 2, ciclo: 1 });
    expect(m.abertos[0]!.politica.workspaceHabilitado).toBe(true);
    const r2 = await m.app.inject({ method: 'POST', url: url(casoId, '/acionar') });
    expect(r2.statusCode).toBe(409);
    // Com o operador_assumiu no ledger, o 409 nem chega ao fluxo.
    await m.ws.append(CHAVE, 'operador_assumiu', { fluxoId: r1.json().fluxoId, casoId });
    const r3 = await m.app.inject({ method: 'POST', url: url(casoId, '/acionar') });
    expect(r3.statusCode).toBe(409);
    expect(r3.json()).toMatchObject({ motivo: 'ja_acionado' });
    expect(m.abertos).toHaveLength(1);
  });

  it('pedido da seed responde 403, mesmo com a seed listada no env', async () => {
    const casoId = await divergencia(m.raiz);
    const r = await m.app.inject({ method: 'POST', url: url(casoId, '/acionar') });
    expect(r.statusCode).toBe(403);
    expect(m.abertos).toHaveLength(0);
  });

  it('caso nascido de canal do operador nao aciona', async () => {
    for (const fonte of ['whatsapp_transportadora', 'ligacao_transportadora', 'email_transportadora']) {
      const casoId = await divergencia(m.ws, fonte);
      const r = await m.app.inject({ method: 'POST', url: url(casoId, '/acionar') });
      expect(r.statusCode).toBe(409);
      expect(r.json()).toMatchObject({ motivo: 'caso_de_canal_do_operador' });
    }
    expect(m.abertos).toHaveLength(0);
  });

  it('pendencia, caso de outra sessao, workspace nao habilitado e operador fora do ar', async () => {
    const pend = await pendencia(m.ws);
    expect((await m.app.inject({ method: 'POST', url: url(pend, '/acionar') })).statusCode).toBe(409);
    const casoId = await divergencia(m.ws);
    // Outro visitante nao enxerga o pedido desta sessao.
    expect((await m.app.inject({ method: 'POST', url: url(casoId, '/acionar'), headers: cookieDe(OUTRO) })).statusCode).toBe(404);
    const casoOutro = await divergencia(m.raiz.paraWorkspace(OUTRO), 'cte', `${CHAVE.slice(0, -1)}8`);
    const r = await m.app.inject({ method: 'POST', url: url(casoOutro, '/acionar'), headers: cookieDe(OUTRO) });
    expect(r.statusCode).toBe(403);
    expect(r.json()).toMatchObject({ motivo: 'workspace_nao_habilitado' });
    m.lider.valor = false;
    expect((await m.app.inject({ method: 'POST', url: url(casoId, '/acionar') })).statusCode).toBe(503);
    expect(m.abertos).toHaveLength(0);
  });
});

describe('planos de contato com credencial de aprovador (T750)', () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await subir();
  });

  const decidir = (planoId: string, acao: string, corpo: unknown, headers: Record<string, string> = AUTH) =>
    m.app.inject({ method: 'POST', url: `/api/planos/${planoId}/${acao}`, payload: corpo as object, headers });

  it('lista os planos do caso so para a sessao dona', async () => {
    const casoId = await pendencia(m.ws);
    const { planoId, hash } = await planoProposto(m.ws, casoId);
    const r = await m.app.inject({ method: 'GET', url: url(casoId, '/planos') });
    expect(r.statusCode).toBe(200);
    expect(r.json().planos).toEqual([
      expect.objectContaining({ planoId, versao: 1, estado: 'proposto', hashRoteiro: hash, casoId, canal: 'whatsapp', custoEstimadoBrl: 0.4 }),
    ]);
    expect((await m.app.inject({ method: 'GET', url: url(casoId, '/planos'), headers: cookieDe(OUTRO) })).statusCode).toBe(404);
  });

  it('sem credencial, com credencial errada ou so com o cookie: 401 e nada gravado', async () => {
    const casoId = await pendencia(m.ws);
    const { planoId, hash } = await planoProposto(m.ws, casoId);
    expect((await decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash }, {})).statusCode).toBe(401);
    expect((await decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash }, { authorization: 'Bearer outro-token-qualquer-123' })).statusCode).toBe(401);
    expect((await decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash }, { authorization: TOKEN })).statusCode).toBe(401);
    expect((await m.ws.eventosDoPedido(CHAVE)).some((e) => e.tipo === 'contato_aprovado')).toBe(false);
  });

  it('aprova uma vez: duplo clique, versao antiga e roteiro mudado respondem 409', async () => {
    const casoId = await pendencia(m.ws);
    const { planoId, hash } = await planoProposto(m.ws, casoId);
    expect((await decidir(planoId, 'aprovar', { versao: 2, hashRoteiro: hash })).json()).toMatchObject({ motivo: 'versao_antiga' });
    expect((await decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: H('9') })).json()).toMatchObject({ motivo: 'roteiro_mudou' });
    const [a, b] = await Promise.all([
      decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash }),
      decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash }),
    ]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([200, 409]);
    const ok = a.statusCode === 200 ? a : b;
    expect(ok.json().plano).toMatchObject({ estado: 'aprovado', aprovador: 'aprovador', versao: 1 });
    const aprovados = (await m.ws.eventosDoPedido(CHAVE)).filter((e) => e.tipo === 'contato_aprovado');
    expect(aprovados).toHaveLength(1);
    expect(aprovados[0]!.payload).toMatchObject({ planoId, versao: 1, hashRoteiro: hash, casoId });
    expect(JSON.stringify(aprovados[0]!.payload)).not.toContain(TOKEN);
    expect(m.sinais).toEqual([[`${WS}:${CHAVE}:1:1`, planoId, 1]]);
    expect((await decidir(planoId, 'recusar', { versao: 1, motivo: 'tarde' })).statusCode).toBe(409);
  });

  it('prazo vencido e caso fechado respondem 409 e nada sai', async () => {
    const casoId = await pendencia(m.ws);
    const vencido = await planoProposto(m.ws, casoId, { planoId: H('2'), prazoMs: Date.now() - 1_000 });
    const r = await decidir(vencido.planoId, 'aprovar', { versao: 1, hashRoteiro: vencido.hash });
    expect(r.statusCode).toBe(409);
    expect(r.json()).toMatchObject({ motivo: 'prazo_vencido' });

    const aberto = await planoProposto(m.ws, casoId, { planoId: H('3') });
    await m.ws.append(CHAVE, 'caso_resolvido', { casoId, resolvidoPor: 'motor' });
    const f = await decidir(aberto.planoId, 'aprovar', { versao: 1, hashRoteiro: aberto.hash });
    expect(f.statusCode).toBe(409);
    expect(f.json()).toMatchObject({ motivo: 'caso_fechado' });
    expect((await m.ws.eventosDoPedido(CHAVE)).some((e) => e.tipo === 'contato_aprovado')).toBe(false);
    expect(m.sinais).toEqual([]);
  });

  it('ajustar cria versao nova com roteiro novo; a versao antiga nao aprova mais', async () => {
    const casoId = await pendencia(m.ws);
    const { planoId, hash } = await planoProposto(m.ws, casoId);
    expect((await decidir(planoId, 'ajustar', { versao: 1, campos: { chaveNota: 'outra' } })).statusCode).toBe(400);
    expect((await decidir(planoId, 'ajustar', { versao: 1, campos: { pergunta: 'livre' } })).statusCode).toBe(400);
    const r = await decidir(planoId, 'ajustar', { versao: 1, campos: { pergunta: 'previsao_entrega', empresa: 'Empresa Teste' } });
    expect(r.statusCode).toBe(200);
    const novo = r.json().plano;
    expect(novo).toMatchObject({ versao: 2, estado: 'proposto' });
    expect(novo.hashRoteiro).not.toBe(hash);
    const guardado = JSON.parse((await m.ws.evidencia(novo.hashRoteiro))!.toString('utf8'));
    expect(guardado.campos).toEqual({ chaveNota: CHAVE, pergunta: 'previsao_entrega', empresa: 'Empresa Teste' });
    expect((await decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash })).json()).toMatchObject({ motivo: 'versao_antiga' });
    expect((await decidir(planoId, 'aprovar', { versao: 2, hashRoteiro: novo.hashRoteiro })).statusCode).toBe(200);
  });

  it('recusar grava o motivo como codigo; texto livre e recusado', async () => {
    const casoId = await pendencia(m.ws);
    const { planoId } = await planoProposto(m.ws, casoId);
    expect((await decidir(planoId, 'recusar', { versao: 1, motivo: 'Ligue amanhã, por favor' })).statusCode).toBe(400);
    const r = await decidir(planoId, 'recusar', { versao: 1, motivo: 'contato_errado' });
    expect(r.statusCode).toBe(200);
    expect(r.json().plano).toMatchObject({ estado: 'recusado' });
    expect((await decidir(H('f'), 'aprovar', { versao: 1, hashRoteiro: H('a') })).statusCode).toBe(404);
  });

  it('plano da seed e so leitura', async () => {
    const pend = await m.raiz.append(CHAVE, 'pendencia_aberta', { motivo: 'sem_atualizacao' });
    const { planoId, hash } = await planoProposto(m.raiz, `${CHAVE}:${pend.seq}`, { planoId: H('4') });
    expect((await decidir(planoId, 'aprovar', { versao: 1, hashRoteiro: hash })).statusCode).toBe(403);
  });
});

describe('linha do tempo e evidencia so para a sessao dona (T770)', () => {
  let m: Mundo;
  beforeEach(async () => {
    m = await subir();
  });

  it('a sessao dona le a linha do tempo e a evidencia citada nela', async () => {
    const casoId = await pendencia(m.ws);
    const { hash } = await planoProposto(m.ws, casoId);
    const r = await m.app.inject({ method: 'GET', url: url(casoId, '/linha-tempo') });
    expect(r.statusCode).toBe(200);
    const itens = r.json().itens as Array<{ tipo: string; hashes?: string[] }>;
    expect(itens.map((i) => i.tipo)).toEqual(['pendencia_aberta', 'contato_planejado']);
    expect(itens[1]!.hashes).toEqual([hash]);
    const e = await m.app.inject({ method: 'GET', url: url(casoId, `/evidencias/${hash}`) });
    expect(e.statusCode).toBe(200);
    expect(e.headers['content-type']).toContain('application/json');
    expect(e.headers['cache-control']).toBe('private, no-store');
    expect(JSON.parse(e.body).campos.chaveNota).toBe(CHAVE);
  });

  it('hash fora do caso, outra sessao, seed e outro workspace com o mesmo hash: nada vaza', async () => {
    const casoId = await pendencia(m.ws);
    const { hash } = await planoProposto(m.ws, casoId);
    // Evidencia do workspace que nao foi citada no caso.
    await m.ws.guardarEvidencia(H('b'), 'transcricao', Buffer.from('sintetica'));
    expect((await m.app.inject({ method: 'GET', url: url(casoId, `/evidencias/${H('b')}`) })).statusCode).toBe(404);
    expect((await m.app.inject({ method: 'GET', url: url(casoId, '/linha-tempo'), headers: cookieDe(OUTRO) })).statusCode).toBe(404);
    expect((await m.app.inject({ method: 'GET', url: url(casoId, `/evidencias/${hash}`), headers: cookieDe(OUTRO) })).statusCode).toBe(404);

    // Outro visitante com o mesmo pedido e um caso que cita o mesmo hash:
    // a evidencia e do workspace dono, entao ele nao a recebe.
    const outro = m.raiz.paraWorkspace(OUTRO);
    const casoOutro = await pendencia(outro);
    await planoProposto(outro, casoOutro, { guardarRoteiro: false });
    const r = await m.app.inject({ method: 'GET', url: url(casoOutro, `/evidencias/${hash}`), headers: cookieDe(OUTRO) });
    expect(r.statusCode).toBe(404);

    const pendSeed = await m.raiz.append(`${CHAVE.slice(0, -1)}7`, 'pendencia_aberta', { motivo: 'sem_atualizacao' });
    const casoSeed = `${pendSeed.pedidoId}:${pendSeed.seq}`;
    expect((await m.app.inject({ method: 'GET', url: url(casoSeed, '/linha-tempo') })).statusCode).toBe(403);
    expect((await m.app.inject({ method: 'GET', url: url(casoSeed, '/planos') })).statusCode).toBe(403);
  });
});
