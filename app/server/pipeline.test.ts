// Concorrencia e aprovacao na fila de revisao (spec 0008, T210/T215):
// dois uploads identicos simultaneos gravam um documento so (RF1); aprovacao
// escreve no workspace do item, uma vez so, e item da seed nao se decide.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createLiteDb } from './db.js';
import { aprovarRevisao, ingerir } from './pipeline.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
const ler = (f: string): Buffer => readFileSync(join(FIX, f));
const CHAVE = '35260123456789000123550010000000011000000019';
const WS = '00000000-0000-4000-8000-00000000c001';

async function novo() {
  const db = await createLiteDb();
  const store = new LedgerStore(db, WS, 'seed');
  await store.init();
  return { db, store, canal: new CanalSSE('seed') };
}

describe('uploads simultaneos identicos', () => {
  it('gravam um documento so, com sequencia continua e cadeia valida', async () => {
    const { db, store, canal } = await novo();
    const nfe = ler('nfe-ok.xml');

    const [a, b] = await Promise.all([ingerir(store, canal, 'nfe-ok.xml', nfe), ingerir(store, canal, 'nfe-ok.xml', nfe)]);
    const evs = await store.eventosDoPedido(CHAVE);

    expect(evs.filter((e) => e.tipo === 'nfe')).toHaveLength(1);
    expect(a.eventos.length + b.eventos.length).toBe(evs.length); // um ganha, o outro e no-op
    expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });

  it('docs diferentes do mesmo pedido nao perdem nem duplicam evento', async () => {
    const { db, store, canal } = await novo();

    await Promise.all([ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml')), ingerir(store, canal, 'cte-ok.xml', ler('cte-ok.xml'))]);
    const evs = await store.eventosDoPedido(CHAVE);

    expect(evs.map((e) => e.tipo)).toEqual(expect.arrayContaining(['nfe', 'cte']));
    expect(evs.map((e) => e.seq)).toEqual(evs.map((_, i) => i + 1));
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });
});

describe('aprovarRevisao', () => {
  const CHAVE_ORFA = '35260100000000000100550010000099991000099991';
  const cteOrfao = (): Buffer => Buffer.from(ler('cte-ok.xml').toString('utf8').replaceAll(CHAVE, CHAVE_ORFA));

  it('aprova uma vez, grava no workspace do item e a segunda aprovacao falha', async () => {
    const { db, store, canal } = await novo();
    const outroWs = '00000000-0000-4000-8000-00000000c002';
    const outro = store.paraWorkspace(outroWs);

    const r = await ingerir(store, canal, 'orfao.xml', cteOrfao());
    expect(r.revisaoId).not.toBeNull();
    const eventos = await aprovarRevisao(store, canal, r.revisaoId!);

    expect(eventos).not.toBeNull();
    expect(eventos!.some((e) => e.tipo === 'cte')).toBe(true);
    expect(await store.eventosDoPedido(CHAVE_ORFA)).toHaveLength(eventos!.length);
    expect(await outro.eventosDoPedido(CHAVE_ORFA)).toHaveLength(0); // ws alheio nao recebe
    expect(await aprovarRevisao(store, canal, r.revisaoId!)).toBeNull(); // segunda vez: nada
    await db.close();
  });

  it('item da fila da seed nao e aprovado por uma sessao', async () => {
    const { db, store, canal } = await novo();
    const seed = store.paraWorkspace('seed');
    const id = await seed.enfileirarRevisao('imap', 'pedido_desconhecido', {
      pedidoId: CHAVE_ORFA,
      docTipo: 'cte',
      fonte: 'cte',
      campos: {},
      dados: {},
    });

    expect(await aprovarRevisao(store, canal, id)).toBeNull();
    expect((await seed.buscarRevisao(id))?.['status']).toBe('pendente');
    await db.close();
  });
});
