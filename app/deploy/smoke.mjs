#!/usr/bin/env node
// Fumaça do deploy (D-I10): confere a URL pública ponta a ponta, só com Node
// (fetch, FormData e streams nativos, sem dependências).
//
//   BASE_URL=https://forseti.up.railway.app node app/deploy/smoke.mjs
//   BASE_URL=... node app/deploy/smoke.mjs --soak 3 --teto-servidor-s 60
//
// --soak N            mantém o stream aberto por N minutos: mede heartbeats,
//                     derruba a conexão pelo cliente e reconecta, e espera o
//                     servidor fechar (teto SSE_MAX_CONNECTION_MS) para
//                     reconectar; depois de cada reconexão exige evento novo.
// --teto-servidor-s S exige ao menos um fechamento pelo servidor perto de S s
//                     (o servidor precisa subir com SSE_MAX_CONNECTION_MS=S*1000).
// --exemplos DIR      pasta com nfe-ok.xml, cte-ok.xml e planilha.csv
//                     (padrão: app/web/public/exemplos, senão app/server/fixtures).
// Sai com código 1 se algum item falhar.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = dirname(fileURLToPath(import.meta.url));
const CHAVE = '35260123456789000123550010000000011000000019';

function lerArgs(argv) {
  const o = { soakMin: 0, tetoServidorS: 0, maxIntervaloS: 45, maxUploadBytes: 2 * 1024 * 1024, exemplos: null };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    const valor = () => {
      const v = argv[(i += 1)];
      if (v === undefined) throw new Error(`${a} precisa de um valor`);
      return v;
    };
    if (a === '--soak') o.soakMin = Number(valor());
    else if (a === '--teto-servidor-s') o.tetoServidorS = Number(valor());
    else if (a === '--max-intervalo-s') o.maxIntervaloS = Number(valor());
    else if (a === '--max-upload-bytes') o.maxUploadBytes = Number(valor());
    else if (a === '--exemplos') o.exemplos = resolve(valor());
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  return o;
}

const opts = lerArgs(process.argv.slice(2));
const BASE = (process.env.BASE_URL ?? '').trim().replace(/\/+$/, '');
if (!BASE) {
  console.error('defina BASE_URL, por exemplo: BASE_URL=https://forseti.up.railway.app node app/deploy/smoke.mjs');
  process.exit(2);
}

const DIR_EXEMPLOS =
  opts.exemplos ??
  [join(AQUI, '..', 'web', 'public', 'exemplos'), join(AQUI, '..', 'server', 'fixtures')].find((d) =>
    existsSync(join(d, 'nfe-ok.xml')),
  );
if (!DIR_EXEMPLOS) {
  console.error('não achei nfe-ok.xml em app/web/public/exemplos nem em app/server/fixtures; use --exemplos DIR');
  process.exit(2);
}
const exemplo = (nome) => readFileSync(join(DIR_EXEMPLOS, nome));

const resultados = [];
function registrar(nome, ok, detalhe = '') {
  resultados.push({ nome, ok });
  console.log(`${ok ? 'PASSOU' : 'FALHOU'}  ${nome}${detalhe ? `  (${detalhe})` : ''}`);
}
async function checar(nome, fn) {
  try {
    registrar(nome, true, (await fn()) ?? '');
    return true;
  } catch (e) {
    registrar(nome, false, e.message);
    return false;
  }
}
function exigir(cond, msg) {
  if (!cond) throw new Error(msg);
}
const dormir = (ms) => new Promise((r) => setTimeout(r, ms));

class Sessao {
  constructor(nome) {
    this.nome = nome;
    this.cookie = null;
  }

  get ws() {
    return this.cookie?.split('=')[1] ?? null;
  }

  absorver(res) {
    for (const c of res.headers.getSetCookie()) {
      const m = c.match(/^foundry_ws=([^;]+)/);
      if (m) this.cookie = `foundry_ws=${m[1]}`;
    }
  }

  async req(caminho, init = {}) {
    const headers = new Headers(init.headers);
    if (this.cookie) headers.set('cookie', this.cookie);
    const res = await fetch(BASE + caminho, { ...init, headers, redirect: 'manual', signal: init.signal ?? AbortSignal.timeout(30_000) });
    this.absorver(res);
    return res;
  }

  async json(caminho, init) {
    const res = await this.req(caminho, init);
    const corpo = await res.json().catch(() => null);
    return { res, corpo };
  }

  enviar(nome, conteudo) {
    const form = new FormData();
    form.append('file', new Blob([conteudo]), nome);
    return this.json('/api/ingest', { method: 'POST', body: form });
  }
}

// Cliente SSE sobre fetch: o EventSource do Node não manda Cookie.
class Stream {
  static async abrir(sessao) {
    const s = new Stream();
    s.ctrl = new AbortController();
    s.abertoEm = Date.now();
    s.res = await sessao.req('/api/stream', { signal: s.ctrl.signal });
    exigir(s.res.status === 200, `stream respondeu ${s.res.status}`);
    exigir((s.res.headers.get('content-type') ?? '').includes('text/event-stream'), 'stream sem content-type text/event-stream');
    s.ler();
    return s;
  }

  constructor() {
    this.quadros = [];
    this.ouvintes = new Set();
    this.fimEm = null;
    this.abortado = false;
  }

  async ler() {
    const leitor = this.res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    try {
      for (;;) {
        const { value, done } = await leitor.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let fim = buf.indexOf('\n\n');
        while (fim >= 0) {
          const bloco = buf.slice(0, fim);
          buf = buf.slice(fim + 2);
          let evento = 'message';
          const dados = [];
          for (const linha of bloco.split('\n')) {
            if (linha.startsWith('event:')) evento = linha.slice(6).trim();
            else if (linha.startsWith('data:')) dados.push(linha.slice(5).trim());
          }
          this.quadros.push({ evento, dados: dados.join('\n'), t: Date.now() });
          this.avisar();
          fim = buf.indexOf('\n\n');
        }
      }
    } catch {
      // abortado pelo próprio script
    }
    this.fimEm = Date.now();
    this.avisar();
  }

  avisar() {
    for (const f of [...this.ouvintes]) f();
  }

  get terminou() {
    return this.fimEm !== null;
  }

  get fechadoPeloServidor() {
    return this.terminou && !this.abortado;
  }

  eventos() {
    return this.quadros.filter((q) => q.evento === 'evento');
  }

  esperar(pred, ms, motivo) {
    return new Promise((res, rej) => {
      const parar = () => {
        clearTimeout(timer);
        this.ouvintes.delete(ver);
      };
      const ver = () => {
        const q = this.quadros.find(pred);
        if (q) {
          parar();
          res(q);
        } else if (this.terminou) {
          parar();
          rej(new Error(`stream terminou antes de: ${motivo}`));
        }
      };
      const timer = setTimeout(() => {
        parar();
        rej(new Error(`${ms} ms sem: ${motivo}`));
      }, ms);
      this.ouvintes.add(ver);
      ver();
    });
  }

  aguardarFim(ms) {
    return new Promise((res) => {
      const timer = setTimeout(() => {
        this.ouvintes.delete(ver);
        res(false);
      }, ms);
      const ver = () => {
        if (this.terminou) {
          clearTimeout(timer);
          this.ouvintes.delete(ver);
          res(true);
        }
      };
      this.ouvintes.add(ver);
      ver();
    });
  }

  fechar() {
    this.abortado = !this.terminou;
    this.ctrl.abort();
  }
}

const eventoDoPedido = (q) => q.evento === 'evento' && q.dados.includes(CHAVE);
let variante = 0;
// Planilha com data nova a cada envio: o pipeline grava documento novo e as
// divergências dele, então sempre há evento para o stream entregar.
function planilhaNova() {
  variante += 1;
  const dia = String(1 + (variante % 27)).padStart(2, '0');
  return Buffer.from(`chave_nf;data_prevista;peso_kg;volumes;status\n${CHAVE};${dia}/03/2026;${500 + variante};12;atrasada\n`);
}

async function enviarEsperandoEvento(sessao, stream, rotulo) {
  const antes = stream.eventos().length;
  const t0 = Date.now();
  const { res, corpo } = await sessao.enviar(`planilha-${variante + 1}.csv`, planilhaNova());
  exigir(res.status === 200, `${rotulo}: envio respondeu ${res.status} ${corpo?.erro ?? ''}`);
  await stream.esperar((q) => eventoDoPedido(q) && stream.eventos().indexOf(q) >= antes, 2000, `evento em ${rotulo}`);
  return Date.now() - t0;
}

async function smoke() {
  console.log(`fumaça em ${BASE} (exemplos: ${DIR_EXEMPLOS})\n`);
  const a = new Sessao('A');
  const b = new Sessao('B');
  let streamA = null;
  let streamB = null;

  await checar('GET / serve a web', async () => {
    const res = await fetch(`${BASE}/`, { signal: AbortSignal.timeout(30_000) });
    const corpo = await res.text();
    exigir(res.status === 200, `status ${res.status}`);
    exigir((res.headers.get('content-type') ?? '').includes('text/html'), `content-type ${res.headers.get('content-type')}`);
    exigir(/<div id="root"|<script/i.test(corpo), 'HTML sem a aplicação');
    return `${corpo.length} bytes`;
  });

  await checar('GET /api/health responde ok com o banco', async () => {
    const res = await fetch(`${BASE}/api/health`, { signal: AbortSignal.timeout(30_000) });
    const corpo = await res.json().catch(() => null);
    exigir(res.status === 200 && corpo?.ok === true, `status ${res.status} ${JSON.stringify(corpo)}`);
  });

  const sessaoOk = await checar('stream aberto antes de qualquer requisição recebe a sessão (cookie foundry_ws)', async () => {
    streamA = await Stream.abrir(a);
    exigir(a.cookie, 'o stream não devolveu set-cookie');
    exigir(streamA.res.headers.get('access-control-allow-origin') !== '*', 'stream com CORS aberto (*)');
    await streamA.esperar((q) => q.evento === 'hello', 5000, 'hello');
    return `sessão A ${a.ws.slice(0, 8)}...`;
  });

  await checar('segunda sessão recebe outro workspace e abre o próprio stream', async () => {
    await b.json('/api/pedidos');
    exigir(b.cookie && b.cookie !== a.cookie, 'sessão B sem cookie próprio');
    streamB = await Stream.abrir(b);
    await streamB.esperar((q) => q.evento === 'hello', 5000, 'hello');
    return `sessão B ${b.ws.slice(0, 8)}...`;
  });

  if (!sessaoOk || !streamB) {
    registrar('fluxo de envio', false, 'sem sessão e stream não dá para seguir');
    return { a, streamA };
  }

  await checar('NF-e de exemplo entra e o SSE entrega ao dono em menos de 2 s', async () => {
    const t0 = Date.now();
    const { res, corpo } = await a.enviar('nfe-ok.xml', exemplo('nfe-ok.xml'));
    exigir(res.status === 200, `envio respondeu ${res.status} ${corpo?.erro ?? ''}`);
    exigir(corpo?.pedidoId === CHAVE, `pedidoId ${corpo?.pedidoId}`);
    await streamA.esperar(eventoDoPedido, 2000, 'evento da NF-e no stream de A');
    return `${Date.now() - t0} ms`;
  });

  await checar('CT-e e planilha de exemplo entram', async () => {
    for (const nome of ['cte-ok.xml', 'planilha.csv']) {
      const { res, corpo } = await a.enviar(nome, exemplo(nome));
      exigir(res.status === 200, `${nome} respondeu ${res.status} ${corpo?.erro ?? ''}`);
    }
    const { corpo } = await a.json(`/api/pedidos/${CHAVE}`);
    const fontes = (corpo?.versoes ?? []).map((v) => v.fonte);
    exigir(['nfe', 'cte', 'planilha'].every((f) => fontes.includes(f)), `versões ${fontes.join(',')}`);
    return `versões ${fontes.join(', ')}; ${corpo.divergencias.length} divergências`;
  });

  await checar('isolamento: a outra sessão não vê nem recebe nada da primeira', async () => {
    await dormir(1500);
    const vazou = streamB.eventos().length;
    exigir(vazou === 0, `stream de B recebeu ${vazou} evento(s)`);
    const { corpo: listaB } = await b.json('/api/pedidos');
    const deA = (listaB?.pedidos ?? []).filter((p) => p.workspaceId === a.ws);
    exigir(deA.length === 0, `B lista ${deA.length} pedido(s) da sessão A`);
    const { corpo: listaA } = await a.json('/api/pedidos');
    exigir((listaA?.pedidos ?? []).some((p) => p.workspaceId === a.ws && p.pedidoId === CHAVE), 'A não lista o próprio pedido');
    return `${streamA.eventos().length} eventos só no stream de A`;
  });

  await checar('/audit do pedido da sessão confere a cadeia', async () => {
    const { res, corpo } = await a.json(`/api/pedidos/${CHAVE}/audit`);
    exigir(res.status === 200 && corpo?.valida === true, `status ${res.status} valida=${corpo?.valida}`);
    return `cadeia válida, ${corpo.total} eventos`;
  });

  await checar('.xlsx responde 422 pedindo CSV', async () => {
    const { res, corpo } = await a.enviar('planilha.xlsx', Buffer.from('PK\u0003\u0004 planilha ficticia'));
    exigir(res.status === 422 && corpo?.tipo === 'parser', `status ${res.status} ${JSON.stringify(corpo)}`);
    exigir(/CSV/.test(corpo.erro), `mensagem: ${corpo.erro}`);
  });

  await checar('arquivo acima do limite responde 413 em português', async () => {
    const { res, corpo } = await a.enviar('grande.csv', Buffer.alloc(opts.maxUploadBytes + 1024, 'x'));
    exigir(res.status === 413, `status ${res.status}`);
    exigir(/limite/.test(corpo?.erro ?? ''), `mensagem: ${corpo?.erro}`);
  });

  await checar('a seed recusa escrita de visitante', async () => {
    const { corpo } = await b.json('/api/pedidos');
    const daSeed = (corpo?.pedidos ?? []).find((p) => p.workspaceId !== b.ws);
    exigir(daSeed, 'nenhum pedido da seed visível (SEED_ON_BOOT=1 carregou a seed?)');
    const ancora = await b.json('/api/anchor', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pedidoId: daSeed.pedidoId }),
    });
    exigir(ancora.res.status === 403, `âncora em pedido da seed respondeu ${ancora.res.status}`);
    const { corpo: fila } = await b.json('/api/revisao');
    const itemSeed = (fila?.itens ?? []).find((i) => i.workspace_id !== b.ws && i.status === 'pendente');
    if (itemSeed) {
      const decisao = await b.json(`/api/revisao/${itemSeed.id}/decisao`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: 'descartado' }),
      });
      exigir(decisao.res.status === 403, `decisão em item da seed respondeu ${decisao.res.status}`);
      return 'âncora e fila de revisão: 403';
    }
    return 'âncora: 403 (a fila da seed está vazia)';
  });

  streamB?.fechar();
  return { a, streamA };
}

async function soak(a, streamInicial) {
  const fimEm = Date.now() + opts.soakMin * 60_000;
  console.log(`\nsoak de ${opts.soakMin} min: heartbeats, queda pelo cliente e fechamento pelo servidor\n`);
  let stream = streamInicial ?? (await Stream.abrir(a));
  const conexoes = [stream];
  const fechamentosServidor = [];
  let quedaCliente = false;
  const reconexoes = [];

  while (Date.now() < fimEm) {
    const restante = fimEm - Date.now();
    const quedaEm = conexoes[0].abertoEm + (opts.soakMin * 60_000) / 3;
    if (!quedaCliente && Date.now() >= quedaEm) {
      // Queda pelo cliente: rede caiu, aba voltou do sono.
      stream.fechar();
      quedaCliente = true;
      stream = await Stream.abrir(a);
      conexoes.push(stream);
      try {
        await stream.esperar((q) => q.evento === 'hello', 5000, 'hello');
        reconexoes.push({ tipo: 'cliente', ms: await enviarEsperandoEvento(a, stream, 'reconexão pelo cliente') });
      } catch (e) {
        reconexoes.push({ tipo: 'cliente', erro: e.message });
      }
      continue;
    }
    const terminou = await stream.aguardarFim(Math.min(restante, Math.max(500, quedaCliente ? restante : quedaEm - Date.now())));
    if (terminou && stream.fechadoPeloServidor) {
      fechamentosServidor.push((stream.fimEm - stream.abertoEm) / 1000);
      await dormir(3000); // o retry que o servidor manda ao navegador
      stream = await Stream.abrir(a);
      conexoes.push(stream);
      try {
        await stream.esperar((q) => q.evento === 'hello', 5000, 'hello');
        reconexoes.push({ tipo: 'servidor', ms: await enviarEsperandoEvento(a, stream, 'reconexão após fechamento pelo servidor') });
      } catch (e) {
        reconexoes.push({ tipo: 'servidor', erro: e.message });
      }
    }
  }
  stream.fechar();

  const heartbeats = conexoes.flatMap((c) => c.quadros.filter((q) => q.evento === 'heartbeat'));
  let maiorIntervalo = 0;
  for (const c of conexoes) {
    const marcas = [c.abertoEm, ...c.quadros.map((q) => q.t), c.fimEm ?? Date.now()];
    for (let i = 1; i < marcas.length; i += 1) maiorIntervalo = Math.max(maiorIntervalo, marcas[i] - marcas[i - 1]);
  }
  const intervalos = [];
  for (const c of conexoes) {
    const hb = c.quadros.filter((q) => q.evento === 'heartbeat').map((q) => q.t);
    for (let i = 1; i < hb.length; i += 1) intervalos.push(hb[i] - hb[i - 1]);
  }
  const media = intervalos.length ? intervalos.reduce((s, x) => s + x, 0) / intervalos.length / 1000 : null;

  registrar(
    'heartbeats chegam e nenhuma conexão fica muda além do limite',
    heartbeats.length > 0 && maiorIntervalo / 1000 <= opts.maxIntervaloS,
    `${heartbeats.length} heartbeats, intervalo médio ${media === null ? 'n/d' : `${media.toFixed(1)} s`}, maior silêncio ${(maiorIntervalo / 1000).toFixed(1)} s (limite ${opts.maxIntervaloS} s)`,
  );
  const doCliente = reconexoes.filter((r) => r.tipo === 'cliente');
  registrar(
    'queda pelo cliente: reconecta com o mesmo cookie e recebe evento novo',
    doCliente.length > 0 && doCliente.every((r) => !r.erro),
    doCliente.map((r) => r.erro ?? `evento em ${r.ms} ms`).join('; ') || 'a queda não aconteceu',
  );
  const doServidor = reconexoes.filter((r) => r.tipo === 'servidor');
  if (opts.tetoServidorS > 0) {
    const perto = fechamentosServidor.filter((s) => s >= opts.tetoServidorS - 5 && s <= opts.tetoServidorS + 10);
    registrar(
      `servidor fecha o stream no teto (${opts.tetoServidorS} s) e a reconexão recebe evento novo`,
      perto.length > 0 && doServidor.length > 0 && doServidor.every((r) => !r.erro),
      `fechamentos após ${fechamentosServidor.map((s) => s.toFixed(1)).join(', ') || 'nenhum'} s; ${doServidor.map((r) => r.erro ?? `evento em ${r.ms} ms`).join('; ')}`,
    );
  } else if (doServidor.length > 0) {
    registrar(
      'reconexão depois de fechamento pelo servidor recebe evento novo',
      doServidor.every((r) => !r.erro),
      `fechamentos após ${fechamentosServidor.map((s) => s.toFixed(1)).join(', ')} s`,
    );
  }
}

const { a, streamA } = await smoke();
if (opts.soakMin > 0 && a.cookie) {
  try {
    await soak(a, streamA);
  } catch (e) {
    registrar('soak', false, e.message);
  }
} else {
  streamA?.fechar();
}

const falhas = resultados.filter((r) => !r.ok).length;
console.log(`\n${resultados.length - falhas} passaram, ${falhas} falharam`);
process.exit(falhas > 0 ? 1 : 0);
