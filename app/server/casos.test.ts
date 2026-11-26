// Teste do modelo de excecao (spec 0011): mudanca mesma-fonte, ciclo de
// vida do caso, resposta do parceiro por token, metricas, pendencia por
// tempo e identidade muitos-para-muitos. Banco PGlite em memoria.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { metricasDosCasos, projetarCasos } from '../shared/casos.js';
import { buildServer } from './index.js';
import { createLiteDb } from './db.js';
import { verificarWorkspace } from './pendencia.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const CHAVE = '35260123456789000123550010000000011000000019';

// Planilha com data sob medida: mesmo layout do fixture, data variavel.
const planilhaCom = (data: string): string =>
  `chave_nf;data_prevista;peso_total;volumes;status\n${CHAVE};${data};12000;40;em_transito`;

async function subir() {
  const db = await createLiteDb();
  return buildServer(db, { workspacePadrao: 'sessao-teste' });
}

async function ingest(app: Awaited<ReturnType<typeof buildServer>>['app'], nome: string, conteudo: string) {
  const form = new FormData();
  form.append('arquivos', new Blob([conteudo]), nome);
  const r = await app.inject({ method: 'POST', url: '/api/ingest', payload: form });
  return r.json() as { pedidoId: string };
}

describe('spec 0011: mudanca, caso, metricas', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let store: Awaited<ReturnType<typeof buildServer>>['store'];

  beforeAll(async () => {
    const b = await subir();
    app = b.app;
    store = b.store;
    await ingest(app, 'nfe-ok.xml', ler('nfe-ok.xml'));
    // A NF-e do corpus e da sessao: duas planilhas do fornecedor divergem
    // da nota e depois entre si (mudanca de versao da mesma fonte).
    await ingest(app, 'planilha.csv', planilhaCom('2026-01-20'));
    await ingest(app, 'planilha.csv', planilhaCom('2026-01-25'));
  });

  afterAll(async () => {
    await app.close();
  });

  it('mesma fonte mudando de versao abre divergencia tipo mudanca', async () => {
    const r = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` });
    const proj = (await r.json()) as { divergencias: Array<{ tipo?: string; fonteA: string; fonteB: string }> };
    const mud = proj.divergencias.filter((d) => d.tipo === 'mudanca');
    expect(mud.length).toBe(1);
    expect(mud[0]!.fonteA).toBe('planilha');
    expect(mud[0]!.fonteB).toBe('planilha');
  });

  it('claims entram no payload do documento', async () => {
    const eventos = await store.paraWorkspace('sessao-teste').eventosDoPedido(CHAVE);
    const nfe = eventos.find((e) => e.tipo === 'nfe')!;
    const claims = nfe.payload['claims'] as Array<{ campo: string; fonte: string }>;
    expect(claims.length).toBeGreaterThan(0);
    expect(claims[0]!.fonte).toBe('nfe');
  });

  it('divergencias abrem casos e o ciclo flui por eventos', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/casos' });
    const { casos } = (await r.json()) as { casos: Array<{ id: string; status: string; daSessao: boolean }> };
    const daSessao = casos.filter((c) => c.daSessao);
    expect(daSessao.length).toBeGreaterThan(0);
    const caso = daSessao[0]!;

    // assumir -> resolver -> reabrir -> resolver
    let t = await app.inject({
      method: 'POST',
      url: `/api/casos/${encodeURIComponent(caso.id)}/assumir`,
      payload: { parte: 'transportadora' },
    });
    expect(t.statusCode).toBe(200);
    t = await app.inject({
      method: 'POST',
      url: `/api/casos/${encodeURIComponent(caso.id)}/resolver`,
      payload: { texto: 'nova data confirmada com o cliente' },
    });
    expect(t.statusCode).toBe(200);

    const detalhe = await app.inject({ method: 'GET', url: `/api/casos/${encodeURIComponent(caso.id)}` });
    const body = (await detalhe.json()) as { caso: { status: string; donoPapel: string; tokenParceiro?: string }; custo: { metodo: string } };
    expect(body.caso.status).toBe('resolvido');
    expect(body.caso.donoPapel).toBe('transportadora');
    expect(body.caso.tokenParceiro).toBeTruthy();
    expect(body.custo.metodo).toBe('simulacao');

    // resposta do parceiro com token errado -> 403; certo -> confirmar
    const err = await app.inject({
      method: 'POST',
      url: `/api/casos/${encodeURIComponent(caso.id)}/resposta`,
      payload: { token: 'errado', acao: 'contestar', texto: 'nao foi a gente' },
    });
    expect(err.statusCode).toBe(403);
    const ok = await app.inject({
      method: 'POST',
      url: `/api/casos/${encodeURIComponent(caso.id)}/resposta`,
      payload: { token: body.caso.tokenParceiro, acao: 'contestar', texto: 'nao foi a gente' },
    });
    expect(ok.statusCode).toBe(200);
    const depois = await app.inject({ method: 'GET', url: `/api/casos/${encodeURIComponent(caso.id)}` });
    expect(((await depois.json()) as { caso: { status: string } }).caso.status).toBe('contestado');
  });

  it('metricas derivam dos eventos', async () => {
    const r = await app.inject({ method: 'GET', url: '/api/metricas' });
    const { metricas } = (await r.json()) as { metricas: { totalPedidos: number; pedidosComExcecao: number; casosResolvidos: number } };
    expect(metricas.totalPedidos).toBeGreaterThan(0);
    expect(metricas.pedidosComExcecao).toBeGreaterThan(0);
    expect(metricas.casosResolvidos).toBe(0); // o unico resolvido foi contestado
  });

  it('comprovante verifica cadeia para terceiro, com trilha e casos', async () => {
    const emissao = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/comprovante` });
    expect(emissao.statusCode).toBe(200);
    const { url } = emissao.json() as { url: string };
    expect(url.startsWith('/api/comprovante/')).toBe(true);

    // O link abre sem cookie de sessao: outra chamada inject, sem header.
    const r = await app.inject({ method: 'GET', url });
    expect(r.statusCode).toBe(200);
    const c = r.json() as {
      cadeiaIntegra: boolean;
      trilha: Array<{ seq: number; hash: string; payload: Record<string, unknown> }>;
      casos: Array<{ id: string }>;
      ancora: unknown;
      rootConfere: boolean | null;
    };
    expect(c.cadeiaIntegra).toBe(true);
    expect(c.trilha.length).toBeGreaterThan(0);
    expect(c.trilha.every((e) => typeof e.hash === 'string' && e.hash.length === 64)).toBe(true);
    expect(c.casos.length).toBeGreaterThan(0);
    // Sem ancora gravada no teste: o campo fica null, sem fingir conferencia.
    expect(c.ancora).toBeNull();
    expect(c.rootConfere).toBeNull();
  });

  it('assinatura de comprovante adulterada ou desconhecida recusa com 404', async () => {
    const emissao = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/comprovante` });
    const { url } = emissao.json() as { url: string };
    const falsificado = url.replace(/[^/]+$/, 'assinaturaforjada');
    expect((await app.inject({ method: 'GET', url: falsificado })).statusCode).toBe(404);
    const foraDoPedido = url.replace(CHAVE, '99999999999999999999999999999999999999999999');
    expect((await app.inject({ method: 'GET', url: foraDoPedido })).statusCode).toBe(404);
    // pedido inexistente nao emite link
    const r = await app.inject({ method: 'GET', url: '/api/pedidos/NAOEXISTE/comprovante' });
    expect(r.statusCode).toBe(404);
  });
});

describe('spec 0011: pendencia e identidade', () => {
  let store: LedgerStore;
  let canal: CanalSSE;

  beforeAll(async () => {
    const db = await createLiteDb();
    store = new LedgerStore(db, 'sessao-pend');
    await store.init();
    canal = new CanalSSE();
  });

  it('pedido velho sem atualizacao abre pendencia uma unica vez', async () => {
    const velho = new Date(Date.now() - 48 * 3_600_000).toISOString();
    await store.append('PED1', 'nfe', { fonte: 'nfe', campos: { status: 'emitida' }, dados: {} }, velho);
    const agora = new Date();
    expect(await verificarWorkspace(store, canal, agora, { horasSemAtualizacao: 24 })).toBeGreaterThan(0);
    // segunda rodada: nada duplica
    expect(await verificarWorkspace(store, canal, agora, { horasSemAtualizacao: 24 })).toBe(0);
    const casos = projetarCasos(await store.eventosDoPedido('PED1'));
    expect(casos.length).toBe(1);
    expect(casos[0]!.origem).toBe('pendencia');
  });

  it('entrega vencida sem confirmacao vira pendencia', async () => {
    const velho = new Date(Date.now() - 10 * 3_600_000).toISOString();
    await store.append('PED2', 'nfe', {
      fonte: 'nfe',
      campos: { status: 'em_transito', previsaoEntrega: '2020-01-01' },
      dados: {},
    }, velho);
    await verificarWorkspace(store, canal, new Date(), { horasSemAtualizacao: 24 });
    expect(await store.pendenciaExiste('PED2', 'entrega_sem_confirmacao')).toBe(true);
  });

  it('projecao conta metricas a partir de eventos soltos', () => {
    const mk = (tipo: string, payload: Record<string, unknown>, seq: number): never =>
      ({ pedidoId: 'P', seq, tipo, payload, ts: `2026-01-0${seq}T00:00:00Z`, prevHash: '', hash: '' }) as never;
    const evs = [
      mk('divergencia', { campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'planilha', valorA: '1', valorB: '2' }, 1),
      mk('caso_atribuido', { casoId: 'P:1', parte: 'transportadora' }, 2),
      mk('caso_resolvido', { casoId: 'P:1', texto: 'ok' }, 3),
    ];
    const casos = projetarCasos(evs as never);
    expect(casos[0]!.status).toBe('resolvido');
    const m = metricasDosCasos(casos, 1);
    expect(m.casosResolvidos).toBe(1);
    expect(m.tempoMedioAteDonoMs).toBe(86_400_000);
    expect(m.tempoMedioAteResolverMs).toBe(2 * 86_400_000);
  });
});
