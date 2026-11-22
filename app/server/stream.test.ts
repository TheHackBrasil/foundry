// SSE com socket real (D-I4): o stream passa pelo mesmo onRequest das outras
// rotas. Uma sessao nova que abre o stream antes de qualquer requisicao recebe
// o cookie, depois so os eventos do proprio workspace e nenhum de outro.

import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { configDoEnv } from './config.js';
import { createLiteDb } from './db.js';
import { buildServer } from './index.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const CHAVE = '35260123456789000123550010000000011000000019';
const ORIGEM = 'https://demo.exemplo';
const REGEX_COOKIE = /^foundry_ws=([0-9a-f-]{36}); Path=\/; HttpOnly; SameSite=Lax$/;

interface Quadro {
  evento: string;
  dados: string;
}

// Cliente SSE minimo sobre fetch: o EventSource do Node nao envia Cookie.
async function abrirStream(base: string, headers: Record<string, string> = {}) {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/stream`, { headers, signal: ctrl.signal });
  const quadros: Quadro[] = [];
  const ouvintes = new Set<() => void>();
  let terminou = false;
  void (async () => {
    const leitor = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let fimBloco = buf.indexOf('\n\n');
        while (fimBloco >= 0) {
          const bloco = buf.slice(0, fimBloco);
          buf = buf.slice(fimBloco + 2);
          let evento = 'message';
          const dados: string[] = [];
          for (const linha of bloco.split('\n')) {
            if (linha.startsWith('event:')) evento = linha.slice(6).trim();
            else if (linha.startsWith('data:')) dados.push(linha.slice(5).trim());
          }
          quadros.push({ evento, dados: dados.join('\n') });
          for (const f of [...ouvintes]) f();
          fimBloco = buf.indexOf('\n\n');
        }
      }
    } catch {
      // conexao abortada pelo teste
    }
    terminou = true;
    for (const f of [...ouvintes]) f();
  })();

  const aguardar = <T>(teste: () => T | undefined, ms: number, motivo: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const parar = () => {
        clearTimeout(timer);
        ouvintes.delete(checar);
      };
      const checar = () => {
        const r = teste();
        if (r !== undefined) {
          parar();
          resolve(r);
        } else if (terminou) {
          parar();
          reject(new Error(`stream terminou antes de: ${motivo}`));
        }
      };
      const timer = setTimeout(() => {
        parar();
        reject(new Error(`${ms} ms sem: ${motivo}`));
      }, ms);
      ouvintes.add(checar);
      checar();
    });

  return {
    res,
    quadros,
    esperar: (pred: (q: Quadro) => boolean, ms = 2000, motivo = 'quadro esperado') =>
      aguardar(() => quadros.find(pred), ms, motivo),
    aguardarFim: (ms = 3000) =>
      new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`stream seguiu aberto por ${ms} ms`)), ms);
        const checar = () => {
          if (terminou) {
            clearTimeout(timer);
            ouvintes.delete(checar);
            resolve();
          }
        };
        ouvintes.add(checar);
        checar();
      }),
    eventos: () => quadros.filter((q) => q.evento === 'evento').map((q) => JSON.parse(q.dados) as { pedidoId: string; hash: string }),
    fechar: () => ctrl.abort(),
  };
}

type Stream = Awaited<ReturnType<typeof abrirStream>>;

describe('SSE com socket real', () => {
  let fechar: Array<() => Promise<void> | void> = [];

  afterEach(async () => {
    for (const f of fechar.reverse()) await f();
    fechar = [];
  });

  async function subir(env: Record<string, string> = {}): Promise<string> {
    const { app } = await buildServer(await createLiteDb(), { config: configDoEnv(env) });
    await app.listen({ port: 0, host: '127.0.0.1' });
    fechar.push(() => app.close());
    return `http://127.0.0.1:${(app.server.address() as AddressInfo).port}`;
  }

  async function stream(base: string, headers: Record<string, string> = {}): Promise<Stream> {
    const s = await abrirStream(base, headers);
    fechar.push(() => s.fechar());
    await s.esperar((q) => q.evento === 'hello', 2000, 'hello');
    return s;
  }

  const ingerirNfe = (base: string, cookie: string) =>
    fetch(`${base}/api/ingest`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({ nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') }),
    });

  it('stream aberto antes de qualquer requisicao recebe o cookie e so os eventos da propria sessao', async () => {
    const base = await subir({ CORS_ORIGIN: ORIGEM });

    // Sessao A: a primeira requisicao dela e o proprio stream, sem cookie.
    const a = await stream(base, { origin: ORIGEM });
    const setCookie = a.res.headers.getSetCookie();
    expect(setCookie).toHaveLength(1);
    const wsA = setCookie[0]!.match(REGEX_COOKIE)?.[1];
    expect(wsA).toBeDefined();
    expect(a.res.headers.get('access-control-allow-origin')).toBe(ORIGEM);
    expect(a.res.headers.get('access-control-allow-credentials')).toBe('true');
    expect(a.res.headers.get('content-type')).toContain('text/event-stream');
    const cookieA = `foundry_ws=${wsA}`;

    // Sessao B: cookie vindo de uma requisicao comum; o stream dela o respeita.
    const lista = await fetch(`${base}/api/pedidos`);
    const cookieB = lista.headers.getSetCookie()[0]!.split(';')[0]!;
    expect(cookieB).not.toBe(cookieA);
    const b = await stream(base, { cookie: cookieB });
    expect(b.res.headers.getSetCookie()).toEqual([]);

    const t0 = Date.now();
    const resA = await ingerirNfe(base, cookieA);
    expect(resA.status).toBe(200);
    await a.esperar((q) => q.evento === 'evento' && q.dados.includes(CHAVE), 2000, 'evento da sessao A');
    expect(Date.now() - t0).toBeLessThan(2000);

    // O upload de A fica no workspace de A: B lista so a seed (vazia aqui).
    const listaB = (await (await fetch(`${base}/api/pedidos`, { headers: { cookie: cookieB } })).json()) as {
      pedidos: Array<{ workspaceId: string }>;
    };
    expect(listaB.pedidos.filter((p) => p.workspaceId === wsA)).toEqual([]);

    // B envia o mesmo XML: B recebe a propria copia, A nao recebe nada novo.
    const eventosA = a.eventos().length;
    const resB = await ingerirNfe(base, cookieB);
    expect(resB.status).toBe(200);
    await b.esperar((q) => q.evento === 'evento' && q.dados.includes(CHAVE), 2000, 'evento da sessao B');
    await new Promise((r) => setTimeout(r, 300));
    expect(a.eventos()).toHaveLength(eventosA);
    const hashesA = new Set(a.eventos().map((e) => e.hash));
    expect(b.eventos().some((e) => hashesA.has(e.hash))).toBe(false);
  });

  it('sem CORS_ORIGIN o stream e a API nao emitem cabecalho CORS', async () => {
    const base = await subir();
    const s = await stream(base, { origin: ORIGEM });
    expect(s.res.headers.get('access-control-allow-origin')).toBeNull();
    const api = await fetch(`${base}/api/pedidos`, { headers: { origin: ORIGEM } });
    expect(api.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('origem fora da lista nao recebe CORS, nem no stream', async () => {
    const base = await subir({ CORS_ORIGIN: ORIGEM });
    const s = await stream(base, { origin: 'https://outro.exemplo' });
    expect(s.res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('teto de tempo encerra o stream pelo servidor e a reconexao com o mesmo cookie recebe eventos novos', async () => {
    const base = await subir({ SSE_MAX_CONNECTION_MS: '400' });
    const primeiro = await stream(base);
    const cookie = primeiro.res.headers.getSetCookie()[0]!.split(';')[0]!;
    await primeiro.aguardarFim(3000);

    const segundo = await stream(base, { cookie });
    const res = await ingerirNfe(base, cookie);
    expect(res.status).toBe(200);
    await segundo.esperar((q) => q.evento === 'evento' && q.dados.includes(CHAVE), 2000, 'evento depois da reconexao');
  });
});
