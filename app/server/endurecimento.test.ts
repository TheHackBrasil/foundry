// Endurecimento da demo publica sem login (P-010, D-I5 a D-I8): CORS so com
// origem configurada, seed somente leitura pela API, limites por sessao e por
// arquivo, rate limit por IP, guarda de espaco, healthcheck e erros sem vazar
// detalhe interno.

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { configDoEnv } from './config.js';
import { createLiteDb, type Db } from './db.js';
import { buildServer } from './index.js';
import { ingerir } from './pipeline.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const CHAVE = '35260123456789000123550010000000011000000019';
const WS_SEED_UUID = '99999999-9999-4999-8999-999999999999';

type Servidor = Awaited<ReturnType<typeof buildServer>>;

const abertos: Servidor[] = [];
afterEach(async () => {
  for (const s of abertos.splice(0)) await s.app.close();
});

async function subir(env: Record<string, string> = {}, db?: Db, workspacePadrao?: string): Promise<Servidor> {
  const s = await buildServer(db ?? (await createLiteDb()), {
    config: configDoEnv(env),
    ...(workspacePadrao ? { workspacePadrao } : {}),
  });
  abertos.push(s);
  return s;
}

function cookieDe(res: { headers: Record<string, unknown> }): string {
  const bruto = res.headers['set-cookie'];
  const valor = Array.isArray(bruto) ? String(bruto[0]) : String(bruto);
  return valor.split(';')[0]!;
}

async function novaSessao(s: Servidor): Promise<string> {
  return cookieDe(await s.app.inject({ method: 'GET', url: '/api/pedidos' }));
}

const enviar = (s: Servidor, cookie: string, nome: string, conteudo: string, headers: Record<string, string> = {}) =>
  s.app.inject({ method: 'POST', url: '/api/ingest', headers: { cookie, ...headers }, payload: { nome, conteudo } });

function multipart(nome: string, conteudo: Buffer): { headers: Record<string, string>; payload: Buffer } {
  const fronteira = 'xFronteiraTeste';
  return {
    headers: { 'content-type': `multipart/form-data; boundary=${fronteira}` },
    payload: Buffer.concat([
      Buffer.from(`--${fronteira}\r\nContent-Disposition: form-data; name="file"; filename="${nome}"\r\nContent-Type: application/octet-stream\r\n\r\n`),
      conteudo,
      Buffer.from(`\r\n--${fronteira}--\r\n`),
    ]),
  };
}

describe('configuracao', () => {
  it('recusa CORS_ORIGIN="*", origem com caminho e inteiro invalido', () => {
    expect(() => configDoEnv({ CORS_ORIGIN: '*' })).toThrow(/não é aceito/);
    expect(() => configDoEnv({ CORS_ORIGIN: 'https://a.exemplo/' })).toThrow(/sem barra/);
    expect(() => configDoEnv({ MAX_UPLOAD_BYTES: 'dois' })).toThrow(/MAX_UPLOAD_BYTES/);
    expect(() => configDoEnv({ WORKSPACE_SEED: 'seed; drop' })).toThrow(/WORKSPACE_SEED/);
    expect(configDoEnv({ CORS_ORIGIN: 'https://a.exemplo, http://localhost:5173' }).corsOrigens).toEqual([
      'https://a.exemplo',
      'http://localhost:5173',
    ]);
    expect(configDoEnv({}).corsOrigens).toEqual([]);
  });
});

describe('seed somente leitura pela API', () => {
  async function comSeed(env: Record<string, string> = {}) {
    const s = await subir(env);
    await ingerir(s.store, s.canal, 'nfe-ok.xml', Buffer.from(ler('nfe-ok.xml')));
    const itemSeed = await s.store.enfileirarRevisao('imap', 'pedido_desconhecido', { pedidoId: 'x', docTipo: 'cte', fonte: 'cte', campos: {}, dados: {} });
    return { s, itemSeed };
  }

  it('ancorar pedido da seed responde 403 antes de tocar a rede e nao grava nada', async () => {
    const { s } = await comSeed();
    const cookie = await novaSessao(s);
    const antes = await s.store.eventosDoPedido(CHAVE);
    const res = await s.app.inject({ method: 'POST', url: '/api/anchor', headers: { cookie }, payload: { pedidoId: CHAVE } });
    expect(res.statusCode).toBe(403);
    expect((res.json() as { erro: string }).erro).toContain('só podem ser lidos');
    expect(await s.store.eventosDoPedido(CHAVE)).toHaveLength(antes.length);
  });

  it('decidir item da fila da seed responde 403 e o item segue pendente', async () => {
    const { s, itemSeed } = await comSeed();
    const cookie = await novaSessao(s);
    for (const status of ['aprovado', 'descartado']) {
      const res = await s.app.inject({ method: 'POST', url: `/api/revisao/${itemSeed}/decisao`, headers: { cookie }, payload: { status } });
      expect(res.statusCode).toBe(403);
    }
    const fila = (await s.app.inject({ method: 'GET', url: '/api/revisao', headers: { cookie } })).json() as {
      itens: Array<{ id: number; status: string }>;
    };
    expect(fila.itens.find((i) => Number(i.id) === itemSeed)?.status).toBe('pendente');
  });

  it('a sessao decide os proprios itens da fila, uma vez so', async () => {
    const { s } = await comSeed();
    const cookie = await novaSessao(s);
    const orfao = ler('cte-ok.xml').replaceAll(CHAVE, '35260100000000000100550010000099991000099991');
    expect((await enviar(s, cookie, 'orfao.xml', orfao)).statusCode).toBe(200);
    const fila = (await s.app.inject({ method: 'GET', url: '/api/revisao', headers: { cookie } })).json() as {
      itens: Array<{ id: number; workspace_id: string }>;
    };
    const proprio = fila.itens.find((i) => i.workspace_id !== 'seed')!;
    const decidir = () => s.app.inject({ method: 'POST', url: `/api/revisao/${proprio.id}/decisao`, headers: { cookie }, payload: { status: 'descartado' } });
    expect((await decidir()).statusCode).toBe(200);
    expect((await decidir()).statusCode).toBe(404);
  });

  it('cookie igual ao WORKSPACE_SEED e trocado por uma sessao nova', async () => {
    const s = await subir({ WORKSPACE_SEED: WS_SEED_UUID });
    const res = await s.app.inject({ method: 'GET', url: '/api/pedidos', headers: { cookie: `foundry_ws=${WS_SEED_UUID}` } });
    expect((res.json() as { workspace: string }).workspace).not.toBe(WS_SEED_UUID);
    expect(cookieDe(res)).not.toBe(`foundry_ws=${WS_SEED_UUID}`);
  });

  it('envio cujo destino e a seed responde 403', async () => {
    const s = await subir({}, undefined, 'seed');
    const res = await enviar(s, '', 'nfe-ok.xml', ler('nfe-ok.xml'));
    expect(res.statusCode).toBe(403);
    expect(await s.store.eventosDoPedido(CHAVE)).toEqual([]);
  });
});

describe('limites por arquivo e por sessao', () => {
  it('arquivo acima do limite responde 413 em portugues, no JSON e no multipart', async () => {
    const s = await subir({ MAX_UPLOAD_BYTES: '2048' });
    const cookie = await novaSessao(s);
    const grande = 'x'.repeat(3000);
    const json = await enviar(s, cookie, 'grande.csv', grande);
    expect(json.statusCode).toBe(413);
    expect((json.json() as { erro: string }).erro).toBe('O arquivo passa de 2 KB, o limite da demonstração por envio.');

    const mp = multipart('grande.csv', Buffer.from(grande));
    const viaForm = await s.app.inject({ method: 'POST', url: '/api/ingest', headers: { cookie, ...mp.headers }, payload: mp.payload });
    expect(viaForm.statusCode).toBe(413);
    expect((viaForm.json() as { erro: string }).erro).toContain('limite da demonstração');

    // Corpo JSON acima do bodyLimit: o Fastify recusa antes do handler.
    const enorme = await enviar(s, cookie, 'enorme.csv', 'y'.repeat(200 * 1024));
    expect(enorme.statusCode).toBe(413);
    expect((enorme.json() as { erro: string }).erro).toContain('limite da demonstração');
  });

  it('planilha com mais linhas que o limite por envio responde 413 e nao grava nada', async () => {
    const s = await subir({ MAX_DOCS_PER_UPLOAD: '2' });
    const cookie = await novaSessao(s);
    const linhas = ['chave_nf;data_prevista', `${CHAVE};25/01/2026`, `${CHAVE.slice(0, -1)}1;25/01/2026`, `${CHAVE.slice(0, -1)}2;25/01/2026`];
    const res = await enviar(s, cookie, 'muitas.csv', linhas.join('\n'));
    expect(res.statusCode).toBe(413);
    expect((res.json() as { erro: string }).erro).toContain('mais de 2 documentos');
    const ws = cookie.split('=')[1]!;
    expect(await s.store.paraWorkspace(ws).uso()).toEqual({ eventos: 0, documentos: 0 });
  });

  it('sessao no limite de documentos responde 429 e manda abrir outra sessao', async () => {
    const s = await subir({ MAX_DOCS_PER_WORKSPACE: '2' });
    const cookie = await novaSessao(s);
    expect((await enviar(s, cookie, 'nfe-ok.xml', ler('nfe-ok.xml'))).statusCode).toBe(200);
    expect((await enviar(s, cookie, 'cte-ok.xml', ler('cte-ok.xml'))).statusCode).toBe(200);
    const res = await enviar(s, cookie, 'planilha.csv', ler('planilha.csv'));
    expect(res.statusCode).toBe(429);
    expect((res.json() as { erro: string }).erro).toContain('janela anônima');
    // Outra sessao segue livre.
    expect((await enviar(s, await novaSessao(s), 'nfe-ok.xml', ler('nfe-ok.xml'))).statusCode).toBe(200);
  });

  it('sessao no limite de eventos responde 429', async () => {
    const s = await subir({ MAX_EVENTS_PER_WORKSPACE: '3' });
    const cookie = await novaSessao(s);
    expect((await enviar(s, cookie, 'nfe-ok.xml', ler('nfe-ok.xml'))).statusCode).toBe(200);
    expect((await enviar(s, cookie, 'cte-ok.xml', ler('cte-ok.xml'))).statusCode).toBe(200);
    expect((await enviar(s, cookie, 'planilha.csv', ler('planilha.csv'))).statusCode).toBe(429);
  });

  it('banco acima de MAX_DB_BYTES recusa escrita com 507 e segue lendo', async () => {
    const s = await subir({ MAX_DB_BYTES: '1' });
    const cookie = await novaSessao(s);
    const res = await enviar(s, cookie, 'nfe-ok.xml', ler('nfe-ok.xml'));
    expect(res.statusCode).toBe(507);
    expect((res.json() as { erro: string }).erro).toContain('limite de armazenamento');
    expect((await s.app.inject({ method: 'GET', url: '/api/pedidos', headers: { cookie } })).statusCode).toBe(200);
  });
});

describe('rate limit por IP', () => {
  it('passa do limite de escritas: 429 com retry-after; leitura e healthcheck seguem livres', async () => {
    const s = await subir({ RATE_LIMIT_WRITES_PER_MIN: '3' });
    const cookie = await novaSessao(s);
    for (let i = 0; i < 3; i += 1) {
      expect((await enviar(s, cookie, 'invalido.xml', ler('invalido.xml'))).statusCode).toBe(422);
    }
    const res = await enviar(s, cookie, 'nfe-ok.xml', ler('nfe-ok.xml'));
    expect(res.statusCode).toBe(429);
    expect(res.headers['retry-after']).toBeDefined();
    expect((res.json() as { erro: string }).erro).toMatch(/^Muitos envios seguidos/);
    expect((await s.app.inject({ method: 'GET', url: '/api/pedidos', headers: { cookie } })).statusCode).toBe(200);
    expect((await s.app.inject({ method: 'GET', url: '/api/health' })).statusCode).toBe(200);
  });

  it('com CLIENT_IP_HEADER, cada IP do proxy tem a propria cota', async () => {
    const s = await subir({ RATE_LIMIT_WRITES_PER_MIN: '1', CLIENT_IP_HEADER: 'x-real-ip' });
    const cookie = await novaSessao(s);
    const de = (ip: string) => enviar(s, cookie, 'invalido.xml', ler('invalido.xml'), { 'x-real-ip': ip });
    expect((await de('203.0.113.1')).statusCode).toBe(422);
    expect((await de('203.0.113.1')).statusCode).toBe(429);
    expect((await de('203.0.113.2')).statusCode).toBe(422);
  });

  it('ancora tem cota propria e mais curta', async () => {
    const s = await subir({ RATE_LIMIT_ANCHORS_PER_10MIN: '1' });
    const cookie = await novaSessao(s);
    expect((await enviar(s, cookie, 'nfe-ok.xml', ler('nfe-ok.xml'))).statusCode).toBe(200);
    const ancorar = () => s.app.inject({ method: 'POST', url: '/api/anchor', headers: { cookie }, payload: { pedidoId: CHAVE } });
    expect((await ancorar()).statusCode).toBe(503); // sem carteira configurada no teste
    const segunda = await ancorar();
    expect(segunda.statusCode).toBe(429);
    expect((segunda.json() as { erro: string }).erro).toContain('âncoras');
  });

  it('PDF tem cota propria por IP, inclusive dentro de outro envio', async () => {
    const s = await subir({ RATE_LIMIT_PDFS_PER_10MIN: '1' });
    const cookie = await novaSessao(s);
    const pdf = '%PDF-1.4\n% documento ficticio e quebrado\n';
    expect((await enviar(s, cookie, 'a.pdf', pdf)).statusCode).not.toBe(429);
    const segundo = await enviar(s, cookie, 'b.pdf', pdf);
    expect(segundo.statusCode).toBe(429);
    expect((segundo.json() as { erro: string }).erro).toContain('PDF');
  });
});

describe('healthcheck, erros e arquivos estaticos', () => {
  it('health responde 200 sem criar sessao e 503 com o banco fora', async () => {
    const lite = await createLiteDb();
    let fora = false;
    const db: Db = {
      query: (sql, params) => (fora && sql === 'SELECT 1' ? Promise.reject(new Error('conexao recusada')) : lite.query(sql, params)),
      exec: (sql) => lite.exec(sql),
      transaction: (fn) => lite.transaction(fn),
      close: () => lite.close(),
    };
    const s = await subir({}, db);
    const ok = await s.app.inject({ method: 'GET', url: '/api/health' });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toEqual({ ok: true });
    expect(ok.headers['set-cookie']).toBeUndefined();
    fora = true;
    const caiu = await s.app.inject({ method: 'GET', url: '/api/health' });
    expect(caiu.statusCode).toBe(503);
    expect((caiu.json() as { ok: boolean }).ok).toBe(false);
  });

  it('500 nao vaza o detalhe interno; 404 e JSON invalido respondem em portugues', async () => {
    const s = await subir();
    s.app.get('/api/teste-erro', async () => {
      throw new Error('relation "segredo" does not exist');
    });
    const erro = await s.app.inject({ method: 'GET', url: '/api/teste-erro' });
    expect(erro.statusCode).toBe(500);
    expect(erro.body).not.toContain('segredo');
    expect((erro.json() as { erro: string }).erro).toContain('Erro interno');

    const nada = await s.app.inject({ method: 'GET', url: '/api/nao-existe' });
    expect(nada.statusCode).toBe(404);
    expect(nada.json()).toEqual({ erro: 'Rota não encontrada.' });

    const quebrado = await s.app.inject({
      method: 'POST',
      url: '/api/simulate',
      headers: { 'content-type': 'application/json' },
      payload: '{"pedidoId":',
    });
    expect(quebrado.statusCode).toBe(400);
    expect(quebrado.json()).toEqual({ erro: 'Corpo JSON inválido.' });
  });

  it('serve o build da web na mesma origem, sem arquivo oculto nem fuga de pasta', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'forseti-web-'));
    try {
      writeFileSync(join(dir, 'index.html'), '<!doctype html><div id="root"></div>');
      writeFileSync(join(dir, '.env'), 'NAO_SERVIR=1');
      const s = await subir({ WEB_DIST_DIR: dir });
      const raiz = await s.app.inject({ method: 'GET', url: '/' });
      expect(raiz.statusCode).toBe(200);
      expect(raiz.headers['content-type']).toContain('text/html');
      expect(raiz.body).toContain('id="root"');
      expect(raiz.headers['x-content-type-options']).toBe('nosniff');
      expect(String(raiz.headers['set-cookie'])).toContain('foundry_ws=');
      expect((await s.app.inject({ method: 'GET', url: '/.env' })).statusCode).toBe(404);
      expect((await s.app.inject({ method: 'GET', url: '/%2e%2e/package.json' })).statusCode).toBe(404);
      expect((await s.app.inject({ method: 'GET', url: '/api/pedidos' })).statusCode).toBe(200);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('cookie sai com Secure atras de proxy HTTPS', async () => {
    const s = await subir();
    const res = await s.app.inject({ method: 'GET', url: '/api/pedidos', headers: { 'x-forwarded-proto': 'https' } });
    expect(String(res.headers['set-cookie'])).toMatch(/HttpOnly; SameSite=Lax; Secure$/);
  });
});
