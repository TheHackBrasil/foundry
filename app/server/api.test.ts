// Teste de integracao do core (spec 0004): parsers, ledger append-only,
// divergencia->tarefa, audit tamper, rotas, simulate, anchor offline.
// Banco: PGlite em memoria (Postgres real, trigger funciona de verdade).

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GENESIS_HASH, hashEvento } from '../shared/chain.js';
import { raizMerkle } from '../shared/merkle.js';
import { buildServer } from './index.js';
import { createLiteDb } from './db.js';
import { parseNFe } from './ingest/nfe.js';
import { parseCTe } from './ingest/cte.js';
import { parseEventoNFe } from './ingest/eventos.js';
import { parseCsv } from './ingest/csv.js';
import type { LedgerStore } from './store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): string => readFileSync(join(FIX, f), 'utf8');
const CHAVE = '35260123456789000123550010000000011000000019';
const TEXTO_CCE = 'O endereco de entrega consta Rua das Acacias 100; o correto e Rua das Acacias 1000';
// Texto que o parser antigo transformava em atraso: tem data e a palavra "atraso".
const TEXTO_CCE_COM_DATA = 'Nova previsao de entrega: 25/01/2026 em razao de atraso na expedicao';

// A CC-e do corpus tem texto sem data; este helper troca o texto da correcao.
const cceComTexto = (texto: string): string =>
  ler('cce-correcao.xml').replace(/<xCorrecao>.*<\/xCorrecao>/, `<xCorrecao>${texto}</xCorrecao>`);

// Evento de insucesso na entrega do CT-e (110190), sintetico, ligado a NF-e
// do corpus. R-006: e tentativa de entrega que falhou, nao atraso.
const INSUCESSO_CTE = `<?xml version="1.0" encoding="UTF-8"?>
<procEventoCTe xmlns="http://www.portalfiscal.inf.br/cte" versao="4.00">
  <eventoCTe versao="4.00">
    <infEvento Id="ID11019035260155566677000188570010000000021000000025001">
      <cOrgao>35</cOrgao><tpAmb>2</tpAmb><CNPJ>55566677000188</CNPJ>
      <chCTe>35260155566677000188570010000000021000000025</chCTe>
      <dhEvento>2026-01-22T15:00:00-03:00</dhEvento>
      <tpEvento>110190</tpEvento><nSeqEvento>1</nSeqEvento>
      <detEvento versaoEvento="4.00"><evIECTe>
        <descEvento>Insucesso na Entrega do CT-e</descEvento>
        <dhTentativaEntrega>2026-01-22T14:30:00-03:00</dhTentativaEntrega>
        <tpMotivo>1</tpMotivo>
        <infEntrega><chNFe>${CHAVE}</chNFe></infEntrega>
      </evIECTe></detEvento>
    </infEvento>
  </eventoCTe>
</procEventoCTe>`;

interface Projecao {
  pedido: { campos: Record<string, unknown> };
  versoes: Array<{ fonte: string }>;
  divergencias: Array<{ campo: string; fonteA: string; fonteB: string; valorA: unknown; valorB: unknown }>;
  tarefas: Array<{ parte: string; titulo: string; detalhe: string; divergencia: { campo: string } }>;
}

describe('parsers', () => {
  it('NF-e -> chave 44, emitente, destinatario, itens, peso, data', () => {
    const d = parseNFe(ler('nfe-ok.xml'));
    expect(d.pedidoId).toBe(CHAVE);
    expect(d.dados['emitente']).toEqual({ cnpj: '12345678000123', nome: 'Fornecedor Ficticio Ltda' });
    expect((d.dados['itens'] as unknown[]).length).toBe(2);
    expect(d.campos.pesoTotal).toBe(510);
    expect(d.campos.volumes).toBe(10);
    expect(d.campos.previsaoEntrega).toBe('2026-01-20');
  });

  it('CT-e vincula ao pedido pela chave NF-e', () => {
    const d = parseCTe(ler('cte-ok.xml'));
    expect(d.pedidoId).toBe(CHAVE);
    expect(d.campos.pesoTotal).toBe(520);
    expect(d.campos.volumes).toBe(12);
  });

  it('CC-e vira evento de correcao, sem declarar campo de atraso', () => {
    const d = parseEventoNFe(ler('cce-correcao.xml'));
    expect(d.docTipo).toBe('cce');
    expect(d.pedidoId).toBe(CHAVE);
    expect(d.campos.previsaoEntrega).toBeUndefined();
    expect(d.campos.status).toBeUndefined();
    expect(d.dados['correcao']).toContain('Acacias');
  });

  it.each([
    ['data DD/MM/AAAA e palavra atraso', TEXTO_CCE_COM_DATA],
    ['data ISO', 'Previsao de entrega corrigida para 2026-01-25'],
    ['adiamento', 'Entrega adiada por reagendamento da doca'],
    ['postergacao', 'Coleta postergada a pedido do cliente'],
  ])('CC-e com texto de %s nao produz previsaoEntrega nem status (R-006)', (_nome, texto) => {
    const d = parseEventoNFe(cceComTexto(texto));
    expect(d.campos).toEqual({});
    expect(d.dados['correcao']).toBe(texto);
    expect(d.dados).not.toHaveProperty('novaData');
  });

  it('cancelamento vira status cancelada', () => {
    const d = parseEventoNFe(ler('cancelamento.xml'));
    expect(d.docTipo).toBe('cancelamento');
    expect(d.campos.status).toBe('cancelada');
  });

  it('CSV: uma linha vira doc planilha', () => {
    const docs = parseCsv(ler('planilha.csv'));
    expect(docs).toHaveLength(1);
    expect(docs[0]!.pedidoId).toBe(CHAVE);
    expect(docs[0]!.campos.previsaoEntrega).toBe('2026-01-25');
  });

  it('XML malformado e XML fora de schema viram ErroParser', () => {
    expect(() => parseNFe('<quebrado')).toThrowError(/NF-e/);
    expect(() => parseNFe(ler('invalido.xml'))).toThrowError(/infNFe/);
  });
});

// A seed e somente leitura pela API (P-010): os envios dos testes caem numa
// sessao fixa, e o que precisa estar na seed entra pelo store dela.
const WS = '00000000-0000-4000-8000-00000000a001';

describe('ledger + api (PGlite)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];
  let store: LedgerStore;
  let seed: LedgerStore;

  beforeAll(async () => {
    const r = await buildServer(await createLiteDb(), { workspacePadrao: WS });
    app = r.app;
    seed = r.store;
    store = r.store.paraWorkspace(WS);
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('POST /api/ingest NF-e cria pedido e cadeia com genesis', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { pedidoId: string; eventos: number };
    expect(body.pedidoId).toBe(CHAVE);
    const evs = await store.eventosDoPedido(CHAVE);
    expect(evs[0]!.prevHash).toBe(GENESIS_HASH);
    expect(evs[0]!.seq).toBe(1);
  });

  it('CT-e gera divergencia de peso/volumes e tarefas propagadas', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'cte-ok.xml', conteudo: ler('cte-ok.xml') },
    });
    expect(res.statusCode).toBe(200);
    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as {
      divergencias: Array<{ campo: string }>;
      tarefas: Array<{ parte: string }>;
    };
    expect(proj.divergencias.map((d) => d.campo).sort()).toEqual(['pesoTotal', 'status', 'volumes'].sort());
    expect(proj.tarefas.length).toBeGreaterThan(0);
    expect(new Set(proj.tarefas.map((t) => t.parte))).toContain('transportadora');
  });

  it('CC-e entra no ledger como evento informativo, sem divergencia nem tarefa (R-006)', async () => {
    const antes = await store.eventosDoPedido(CHAVE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'cce-correcao.xml', conteudo: ler('cce-correcao.xml') },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { eventos: number }).eventos).toBe(1);

    const depois = await store.eventosDoPedido(CHAVE);
    expect(depois).toHaveLength(antes.length + 1);
    const ev = depois.at(-1)!;
    expect(ev.tipo).toBe('cce');
    expect(ev.payload['campos']).toEqual({});
    expect((ev.payload['dados'] as { correcao: string }).correcao).toBe(TEXTO_CCE);

    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as Projecao;
    expect(proj.versoes.map((v) => v.fonte)).toEqual(['nfe', 'cte', 'cce']);
    expect(proj.divergencias.filter((d) => d.campo === 'previsaoEntrega')).toEqual([]);
    expect(proj.tarefas.filter((t) => t.divergencia.campo === 'previsaoEntrega')).toEqual([]);
    expect(proj.pedido.campos['previsaoEntrega']).toBe('2026-01-20');
    expect(proj.pedido.campos['status']).toBe('em_transito');
  });

  it('evento 110190 do CT-e (insucesso na entrega) nao vira atraso: 422 e nada gravado (R-006)', async () => {
    const antes = await store.eventosDoPedido(CHAVE);
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'insucesso-entrega.xml', conteudo: INSUCESSO_CTE },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { tipo: string }).tipo).toBe('parser');
    expect(await store.eventosDoPedido(CHAVE)).toHaveLength(antes.length);
  });

  it('planilha com data nova gera a divergencia de data e as 5 tarefas, uma por parte', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'planilha.csv', conteudo: ler('planilha.csv') },
    });
    expect(res.statusCode).toBe(200);

    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as Projecao;
    // A planilha tambem diverge em peso, volumes e status: filtra pelo campo de data.
    expect(proj.divergencias.filter((d) => d.campo === 'previsaoEntrega')).toEqual([
      { campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'planilha', valorA: '2026-01-20', valorB: '2026-01-25' },
    ]);
    const deData = proj.tarefas.filter((t) => t.divergencia.campo === 'previsaoEntrega');
    expect(deData.map((t) => t.parte)).toEqual(['transportadora', 'cd', 'fiscal', 'financeiro', 'fornecedor']);
    expect(proj.versoes.map((v) => v.fonte)).toEqual(['nfe', 'cte', 'cce', 'planilha']);

    const fiscal = deData.find((t) => t.parte === 'fiscal')!;
    expect(fiscal.titulo).toBe('Conferir se o atraso exige ação fiscal');
    expect(fiscal.detalhe).toBe(
      'A previsão passou de 20/01/2026 para 25/01/2026. O cancelamento da NF-e só cabe em até 24 h e sem circulação da mercadoria, e a CC-e não corrige data de saída.',
    );
  });

  it('detalhes das tarefas saem com data brasileira, status legivel e acentos', async () => {
    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as Projecao;
    const detalhes = proj.tarefas.map((t) => t.detalhe);
    expect(detalhes).toContain('Previsão divergente: NF-e diz 20/01/2026, planilha diz 25/01/2026.');
    expect(detalhes).toContain('Status divergente: NF-e diz Emitida, CT-e diz Em trânsito.');
    expect(detalhes).toContain('Status divergente: CT-e diz Em trânsito, planilha diz Atrasada.');
    for (const t of proj.tarefas) {
      expect(t.detalhe).not.toMatch(/\d{4}-\d{2}-\d{2}|\w_\w|\b(nfe|cte|cce)\b/);
    }
  });

  it('.eml desembrulha anexo XML e joga no mesmo pipeline', async () => {
    const eml = readFileSync(join(FIX, 'email-nfe.eml'));
    const r = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'email-nfe.eml', conteudoBase64: eml.toString('base64') },
    });
    const body = r.json() as { ok: boolean; pedidoId: string | null; docs: number };
    expect(body.ok).toBe(true);
    expect(body.pedidoId).toBe(CHAVE);
    expect(body.docs).toBe(1); // o anexo vira doc; idempotente, sem evento novo
  });

  it('reingestao identica e no-op (idempotente)', async () => {
    const antes = (await store.eventosDoPedido(CHAVE)).length;
    await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') },
    });
    expect((await store.eventosDoPedido(CHAVE)).length).toBe(antes);
  });

  it('CT-e sem pedido vai para fila de revisao, nao 500', async () => {
    const cteOrfao = ler('cte-ok.xml').replaceAll(CHAVE, '35260100000000000100550010000099991000099991');
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'orfao.xml', conteudo: cteOrfao },
    });
    expect(res.statusCode).toBe(200);
    const revisao = (await app.inject({ method: 'GET', url: '/api/revisao' })).json() as {
      itens: Array<{ motivo: string }>;
    };
    expect(revisao.itens.some((i) => i.motivo === 'pedido_desconhecido')).toBe(true);
  });

  it('XML invalido responde 422 explicito', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'invalido.xml', conteudo: ler('invalido.xml') },
    });
    expect(res.statusCode).toBe(422);
    expect((res.json() as { erro: string }).erro).toContain('XML');
  });

  it('XLSX e XLS respondem 422 pedindo CSV, sem ler o arquivo (D-028)', async () => {
    for (const nome of ['planilha.xlsx', 'planilha.XLS']) {
      const res = await app.inject({
        method: 'POST',
        url: '/api/ingest',
        payload: { nome, conteudoBase64: Buffer.from('PK\u0003\u0004 conteudo qualquer').toString('base64') },
      });
      expect(res.statusCode).toBe(422);
      const body = res.json() as { erro: string; tipo: string };
      expect(body.tipo).toBe('parser');
      expect(body.erro).toContain('exporte a planilha como CSV');
      expect(body.erro).toMatch(/nao suportad/); // imap.ts manda para a revisao com base nesse texto
    }
  });

  it('trigger do banco rejeita UPDATE e DELETE em events', async () => {
    const db = (store as unknown as { db: { query: (s: string) => Promise<unknown> } }).db;
    await expect(db.query(`UPDATE events SET tipo='x' WHERE pedido_id='${CHAVE}'`)).rejects.toThrow();
    await expect(db.query(`DELETE FROM events WHERE pedido_id='${CHAVE}'`)).rejects.toThrow();
  });

  it('bypass da trigger e pego pelo audit nomeando o evento', async () => {
    const db = (store as unknown as { db: { query: (s: string, p?: unknown[]) => Promise<unknown> } }).db;
    await db.query('ALTER TABLE events DISABLE TRIGGER ALL');
    await db.query(`UPDATE events SET payload = '{"fonte":"nfe","adulterado":true}' WHERE pedido_id='${CHAVE}' AND seq=1`);
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL');
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/audit` });
    const audit = res.json() as { valida: boolean; indiceFalha: number | null; eventoFalha: { seq: number } | null };
    expect(audit.valida).toBe(false);
    expect(audit.eventoFalha?.seq).toBe(1);
    // Restaura o evento correto para os proximos testes
    await db.query('ALTER TABLE events DISABLE TRIGGER ALL');
    await db.query(
      `DELETE FROM events WHERE pedido_id='${CHAVE}'`,
    );
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL');
    await app.inject({ method: 'POST', url: '/api/ingest', payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') } });
  });

  it('audit de cadeia integra retorna valida', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/audit` });
    expect((res.json() as { valida: boolean }).valida).toBe(true);
  });

  it('eventos novos pos-ancoragem nao invalidam rootConfere', async () => {
    const pedido = 'pedido-ancora-cresce';
    await store.append(pedido, 'nfe', { fonte: 'nfe' });
    await store.append(pedido, 'cte', { fonte: 'cte' });
    const pre = await store.eventosDoPedido(pedido);
    await store.append(pedido, 'ancora', { root: raizMerkle(pre.map((e) => e.hash)) });
    await store.append(pedido, 'planilha', { fonte: 'planilha' });
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${pedido}/audit` });
    const audit = res.json() as {
      rootConfere: boolean | null;
      eventosAncorados: number | null;
      rootHistorico: string | null;
      ancora: { root: string } | null;
    };
    expect(audit.rootConfere).toBe(true);
    expect(audit.eventosAncorados).toBe(2);
    expect(audit.rootHistorico).toBe(audit.ancora?.root);
  });

  it('rescrever cadeia inteira engana o hash mas nao a ancora', async () => {
    // O ataque que a ancora existe pra pegar: dono do banco adultera o
    // payload E recomputa hash/prev_hash, deixando a cadeia autoconsis-
    // tente (valida=true). rootHistorico diverge do root ancorado.
    const pedido = 'pedido-ancora-tamper';
    await store.append(pedido, 'nfe', { fonte: 'nfe' });
    const pre = await store.eventosDoPedido(pedido);
    await store.append(pedido, 'ancora', { root: raizMerkle(pre.map((e) => e.hash)) });
    const evs = await store.eventosDoPedido(pedido);
    const h1 = hashEvento(
      { pedidoId: pedido, tipo: 'nfe', payload: { adulterado: true }, ts: evs[0]!.ts },
      evs[0]!.prevHash,
    );
    const h2 = hashEvento(
      { pedidoId: pedido, tipo: 'ancora', payload: evs[1]!.payload, ts: evs[1]!.ts },
      h1,
    );
    const db = (store as unknown as { db: { query: (s: string) => Promise<unknown> } }).db;
    await db.query('ALTER TABLE events DISABLE TRIGGER ALL');
    await db.query(
      `UPDATE events SET payload='{"adulterado":true}', hash='${h1}' WHERE pedido_id='${pedido}' AND seq=1`,
    );
    await db.query(
      `UPDATE events SET prev_hash='${h1}', hash='${h2}' WHERE pedido_id='${pedido}' AND seq=2`,
    );
    await db.query('ALTER TABLE events ENABLE TRIGGER ALL');
    const audit = (await app.inject({ method: 'GET', url: `/api/pedidos/${pedido}/audit` })).json() as {
      valida: boolean;
      rootConfere: boolean | null;
    };
    expect(audit.valida).toBe(true);
    expect(audit.rootConfere).toBe(false);
  });

  it('POST /api/simulate devolve tarefas sem gravar', async () => {
    const antes = (await store.eventosDoPedido(CHAVE)).length;
    const res = await app.inject({
      method: 'POST',
      url: '/api/simulate',
      payload: { pedidoId: CHAVE, campos: { previsaoEntrega: '2026-02-01' } },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { simulacao: boolean; tarefas: unknown[] };
    expect(body.simulacao).toBe(true);
    expect(body.tarefas.length).toBe(5);
    expect((await store.eventosDoPedido(CHAVE)).length).toBe(antes);
  });

  it('POST /api/anchor sem config devolve 503 com motivo declarado', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/anchor',
      payload: { pedidoId: CHAVE },
    });
    expect(res.statusCode).toBe(503);
    const body = res.json() as { ok: boolean; motivo: string; root: string };
    expect(body.ok).toBe(false);
    expect(body.motivo).toContain('nao configurada');
    expect(body.root).toMatch(/^[0-9a-f]{64}$/);
  });

  it('GET /api/pedidos lista o pedido', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/pedidos' });
    const body = res.json() as { pedidos: Array<{ pedidoId: string }> };
    expect(body.pedidos.map((p) => p.pedidoId)).toContain(CHAVE);
  });

  it('GET /api/versoes devolve linha do tempo', async () => {
    const res = await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}/versoes` });
    expect((res.json() as { versoes: unknown[] }).versoes.length).toBeGreaterThanOrEqual(1);
  });

  it('isola pedidos por cookie de sessao e compartilha a seed', async () => {
    const wsA = '11111111-1111-4111-8111-111111111111';
    const wsB = '22222222-2222-4222-8222-222222222222';
    const pedidoSessao = 'pedido-so-da-sessao-a';
    const pedidoSeed = 'pedido-da-seed';
    await store.paraWorkspace(wsA).append(pedidoSessao, 'nfe', { fonte: 'nfe' });
    await seed.append(pedidoSeed, 'nfe', { fonte: 'nfe' });

    const cookieA = { cookie: `foundry_ws=${wsA}` };
    const cookieB = { cookie: `foundry_ws=${wsB}` };

    // A ve o proprio pedido e o pedido da seed; B nao ve o da sessao A.
    const listaA = (await app.inject({ method: 'GET', url: '/api/pedidos', headers: cookieA }))
      .json() as { pedidos: Array<{ pedidoId: string; workspaceId: string }> };
    const listaB = (await app.inject({ method: 'GET', url: '/api/pedidos', headers: cookieB }))
      .json() as { pedidos: Array<{ pedidoId: string; workspaceId: string }> };

    expect(listaA.pedidos.map((p) => p.pedidoId)).toContain(pedidoSessao);
    expect(listaA.pedidos.map((p) => p.pedidoId)).toContain(pedidoSeed); // seed compartilhado
    expect(listaB.pedidos.map((p) => p.pedidoId)).toContain(pedidoSeed); // seed compartilhado
    expect(listaB.pedidos.map((p) => p.pedidoId)).not.toContain(pedidoSessao);

    const getB = await app.inject({ method: 'GET', url: `/api/pedidos/${pedidoSessao}`, headers: cookieB });
    expect(getB.statusCode).toBe(404);
    const getA = await app.inject({ method: 'GET', url: `/api/pedidos/${pedidoSessao}`, headers: cookieA });
    expect(getA.statusCode).toBe(200);
  });

  it('emite cookie foundry_ws quando ausente e respeita um valido', async () => {
    const sem = await app.inject({ method: 'GET', url: '/api/pedidos' });
    expect(String(sem.headers['set-cookie'])).toContain('foundry_ws=');
    expect(String(sem.headers['set-cookie'])).toContain('HttpOnly');

    const ws = '33333333-3333-4333-8333-333333333333';
    const com = await app.inject({
      method: 'GET',
      url: '/api/pedidos',
      headers: { cookie: `foundry_ws=${ws}` },
    });
    expect(com.headers['set-cookie']).toBeUndefined();
  });
});

describe('CC-e com texto de data nao vira atraso (R-006, D-020)', () => {
  let app: Awaited<ReturnType<typeof buildServer>>['app'];

  beforeAll(async () => {
    app = (await buildServer(await createLiteDb(), { workspacePadrao: '00000000-0000-4000-8000-00000000a002' })).app;
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('data e palavra atraso no texto: so o evento informativo, sem divergencia, tarefa nem status atrasada', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'nfe-ok.xml', conteudo: ler('nfe-ok.xml') },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/ingest',
      payload: { nome: 'cce-com-data.xml', conteudo: cceComTexto(TEXTO_CCE_COM_DATA) },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { eventos: number }).eventos).toBe(1);

    const proj = (await app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` })).json() as Projecao;
    expect(proj.versoes.map((v) => v.fonte)).toEqual(['nfe', 'cce']);
    expect(proj.divergencias).toEqual([]);
    expect(proj.tarefas).toEqual([]);
    expect(proj.pedido.campos).toEqual({
      previsaoEntrega: '2026-01-20',
      pesoTotal: 510,
      volumes: 10,
      status: 'emitida',
    });
  });
});
