// Modo local (WORKSPACE_LOCAL): todo navegador da propria maquina cai no
// mesmo workspace; quem chega por proxy ou tunel continua isolado pelo cookie.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, ehLocalDireto } from './index.js';
import { createLiteDb } from './db.js';

const LOCAL = '11111111-2222-4333-8444-555555555555';
const OUTRO = '99999999-8888-4777-8666-555555555555';

const cookieDe = (setCookie: unknown): string | undefined => /foundry_ws=([^;]+)/.exec(String(setCookie ?? ''))?.[1];

describe('ehLocalDireto', () => {
  it('aceita loopback sem cabecalho de proxy', () => {
    expect(ehLocalDireto({ socket: { remoteAddress: '127.0.0.1' }, headers: {} })).toBe(true);
    expect(ehLocalDireto({ socket: { remoteAddress: '::1' }, headers: {} })).toBe(true);
  });
  it('recusa tunel, proxy e outro host', () => {
    expect(ehLocalDireto({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'cf-connecting-ip': '203.0.113.9' } })).toBe(false);
    expect(ehLocalDireto({ socket: { remoteAddress: '127.0.0.1' }, headers: { 'x-forwarded-for': '203.0.113.9' } })).toBe(false);
    expect(ehLocalDireto({ socket: { remoteAddress: '192.168.1.50' }, headers: {} })).toBe(false);
  });
});

describe('servidor com workspaceLocal', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  beforeAll(async () => {
    app = (await buildServer(await createLiteDb(), { workspaceLocal: LOCAL })).app;
  });
  afterAll(async () => {
    await app.close();
  });

  it('navegador local com cookie de outra sessao passa para o workspace local', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/pedidos', remoteAddress: '127.0.0.1', headers: { cookie: `foundry_ws=${OUTRO}` } });
    expect(cookieDe(r.headers['set-cookie'])).toBe(LOCAL);
  });

  it('pelo tunel o cookie continua valendo e o workspace local nao vaza', async () => {
    const r = await app.inject({
      method: 'GET',
      url: '/api/pedidos',
      remoteAddress: '127.0.0.1',
      headers: { cookie: `foundry_ws=${OUTRO}`, 'cf-connecting-ip': '203.0.113.9' },
    });
    expect(r.headers['set-cookie']).toBeUndefined();
    const novo = await app.inject({ method: 'GET', url: '/api/pedidos', remoteAddress: '127.0.0.1', headers: { 'cf-connecting-ip': '203.0.113.9' } });
    const ws = cookieDe(novo.headers['set-cookie']);
    expect(ws).toBeDefined();
    expect(ws).not.toBe(LOCAL);
  });
});
