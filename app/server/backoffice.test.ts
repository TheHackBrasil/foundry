// Backoffice do operador (/#/admin): senha de admin, numeros no banco por
// cima do env e aprovacao sem senha. Banco PGlite em memoria; numeros
// ficticios (A7).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigBackoffice, normalizarLista, validarAjustes, type AjustesOperador } from './backoffice.js';
import { configDoEnv } from './config.js';
import { createLiteDb } from './db.js';
import { buildServer } from './index.js';

const SENHA = 'senha-admin-teste';
const auth = { authorization: `Bearer ${SENHA}` };
const AJUSTES: AjustesOperador = {
  prazoEmailMin: 240,
  prazoWhatsappMin: 60,
  validadeAprovacaoMin: 30,
  tentativasDia: 2,
  tetoCasoBrl: 5,
  tetoDiaBrl: 50,
  janelaInicio: 8,
  janelaFim: 18,
  janelaTodosDias: false,
};

describe('normalizarLista', () => {
  it('normaliza para E.164, tira repetidos e separa invalidos', () => {
    expect(normalizarLista(['+55 (11) 90000-0001', '+5511900000001', 'abc'])).toEqual({ validos: ['+5511900000001'], invalidos: ['abc'] });
  });
});

describe('rotas do backoffice', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  beforeAll(async () => {
    app = (await buildServer(await createLiteDb(), { workspacePadrao: 'sessao-teste', config: { ...configDoEnv({}), operadorAprovadorToken: SENHA } })).app;
  });
  afterAll(async () => {
    await app.close();
  });

  it('sem a senha nao le nem grava', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/admin/config' })).statusCode).toBe(401);
    const r = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: { authorization: 'Bearer errada' }, payload: { aprovacaoAberta: true } });
    expect(r.statusCode).toBe(401);
  });

  it('grava a lista no banco, normalizada, e recusa telefone invalido', async () => {
    const ruim = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: auth, payload: { destinos: ['123'] } });
    expect(ruim.statusCode).toBe(400);
    const r = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: auth, payload: { destinos: ['+55 11 90000-0001'] } });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ destinos: ['+5511900000001'], origemDestinos: 'banco', aprovacaoAberta: false });
  });

  it('aprovacao aberta aparece na rota publica', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/operador/aprovacao' })).json()).toEqual({ aberta: false });
    await app.inject({ method: 'PUT', url: '/api/admin/config', headers: auth, payload: { aprovacaoAberta: true } });
    expect((await app.inject({ method: 'GET', url: '/api/operador/aprovacao' })).json()).toEqual({ aberta: true });
  });
});

describe('ConfigBackoffice', () => {
  it('sem linha no banco vale o env; ouvinte recebe a lista nova', async () => {
    const c = new ConfigBackoffice(['+5511900000002'], false, AJUSTES);
    const vistas: string[][] = [];
    c.aoMudar((e) => vistas.push(e.destinos));
    expect(c.estado()).toEqual({ destinos: ['+5511900000002'], origemDestinos: 'env', aprovacaoAberta: false, ajustes: AJUSTES });
    const store = { gravarConfigOperador: async () => {} } as never;
    await c.definir(store, { destinos: ['+5511900000003'] });
    expect(vistas.at(-1)).toEqual(['+5511900000003']);
  });
});

describe('ajustes do operador', () => {
  it('aceita valores no limite e recusa fora dele, chave desconhecida e janela invertida', () => {
    expect(validarAjustes(AJUSTES, { prazoEmailMin: 2, janelaTodosDias: true })).toEqual({
      ok: true,
      ajustes: { ...AJUSTES, prazoEmailMin: 2, janelaTodosDias: true },
    });
    expect(validarAjustes(AJUSTES, { prazoEmailMin: 0 })).toMatchObject({ ok: false });
    expect(validarAjustes(AJUSTES, { qualquer: 1 })).toMatchObject({ ok: false });
    expect(validarAjustes(AJUSTES, { janelaInicio: 20, janelaFim: 10 })).toMatchObject({ ok: false });
  });

  it('a rota grava os ajustes e devolve o estado novo', async () => {
    const { app } = await buildServer(await createLiteDb(), { workspacePadrao: 'sessao-teste', config: { ...configDoEnv({}), operadorAprovadorToken: SENHA } });
    const r = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: auth, payload: { ajustes: { prazoEmailMin: 2, janelaInicio: 0, janelaFim: 24 } } });
    expect(r.statusCode).toBe(200);
    expect(r.json().ajustes).toMatchObject({ prazoEmailMin: 2, janelaInicio: 0, janelaFim: 24 });
    const ruim = await app.inject({ method: 'PUT', url: '/api/admin/config', headers: auth, payload: { ajustes: { tentativasDia: 99 } } });
    expect(ruim.statusCode).toBe(400);
    await app.close();
  });
});
