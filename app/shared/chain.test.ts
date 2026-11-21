import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  GENESIS,
  canonicalJson,
  encadear,
  hashEvento,
  sha256Hex,
  verificarCadeia,
} from './chain.ts';
import type { Evento, EventoEntrada, Json } from './model.ts';

// Chave fictícia de 44 dígitos: UF, AAMM, CNPJ, modelo, série, número,
// tipo de emissão, código e dígito.
const CHAVE = ['35', '2611', '12345678000190', '55', '001', '000000123', '1', '00000001', '0'].join('');

function entrada(n: number, extra: Partial<EventoEntrada> = {}): EventoEntrada {
  return {
    pedidoId: CHAVE,
    workspaceId: 'seed',
    tipo: 'nfe',
    autor: 'fornecedor',
    canal: 'seed',
    ocorridoEm: `2026-11-0${n + 1}T10:00:00Z`,
    payload: { n },
    ...extra,
  };
}

async function cadeia(tamanho: number): Promise<Evento[]> {
  const eventos: Evento[] = [];
  for (let n = 0; n < tamanho; n++) {
    eventos.push(await encadear(eventos.at(-1) ?? null, entrada(n)));
  }
  return eventos;
}

describe('sha256Hex', () => {
  it('bate com os vetores conhecidos do SHA-256', async () => {
    assert.equal(await sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('canonicalJson', () => {
  it('ordena as chaves em todos os níveis e mantém a ordem dos arrays', () => {
    const a = canonicalJson({ b: 1, a: { d: [3, 1, 2], c: null } });
    const b = canonicalJson({ a: { c: null, d: [3, 1, 2] }, b: 1 });

    assert.equal(a, '{"a":{"c":null,"d":[3,1,2]},"b":1}');
    assert.equal(a, b);
  });

  it('recusa o que o JSON não representa', () => {
    assert.throws(() => canonicalJson(Number.NaN), TypeError);
    assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), TypeError);
    assert.throws(() => canonicalJson({ x: undefined } as unknown as Json), TypeError);
    assert.throws(() => canonicalJson(10n as unknown as Json), TypeError);
  });
});

describe('hashEvento', () => {
  it('não depende da ordem das chaves do payload', async () => {
    const [base] = await cadeia(1);
    assert.ok(base);

    const a = await hashEvento({ ...base, payload: { x: 1, y: 2 } });
    const b = await hashEvento({ ...base, payload: { y: 2, x: 1 } });

    assert.equal(a, b);
  });

  it('muda quando qualquer campo coberto muda', async () => {
    const [base] = await cadeia(1);
    assert.ok(base);
    const original = await hashEvento(base);

    const variantes: Partial<Evento>[] = [
      { payload: { n: 99 } },
      { ocorridoEm: '2027-01-01T00:00:00Z' },
      { autor: 'transportadora' },
      { tipo: 'cte' },
      { canal: 'upload' },
      { workspaceId: 'outro' },
      { pedidoId: `${CHAVE.slice(0, 43)}1` },
      { prevHash: '1'.repeat(64) },
      { seq: 1 },
    ];

    for (const variante of variantes) {
      assert.notEqual(await hashEvento({ ...base, ...variante }), original, JSON.stringify(variante));
    }
  });

  it('ignora coluna que não faz parte do evento', async () => {
    const [base] = await cadeia(1);
    assert.ok(base);

    const comColunas = { ...base, id: 'uuid-qualquer', criadoEm: '2026-11-21T00:00:00Z' };

    assert.equal(await hashEvento(comColunas), base.hash);
  });
});

describe('encadear', () => {
  it('abre a cadeia no GENESIS com seq 0', async () => {
    const primeiro = await encadear(null, entrada(0));

    assert.equal(primeiro.seq, 0);
    assert.equal(primeiro.prevHash, GENESIS);
    assert.equal(primeiro.hash, await hashEvento(primeiro));
  });

  it('liga o evento seguinte ao hash do anterior', async () => {
    const [primeiro, segundo] = await cadeia(2);
    assert.ok(primeiro && segundo);

    assert.equal(segundo.seq, 1);
    assert.equal(segundo.prevHash, primeiro.hash);
  });

  it('recusa evento de outro pedido ou workspace', async () => {
    const [primeiro] = await cadeia(1);
    assert.ok(primeiro);

    await assert.rejects(encadear(primeiro, entrada(1, { pedidoId: '9'.repeat(44) })), /outro pedido/);
    await assert.rejects(encadear(primeiro, entrada(1, { workspaceId: 'visitante-1' })), /outro pedido/);
  });
});

describe('verificarCadeia', () => {
  it('aceita a cadeia vazia, com o GENESIS como cabeça', async () => {
    assert.deepEqual(await verificarCadeia([]), { ok: true, cabeca: GENESIS });
  });

  it('aceita a cadeia íntegra e devolve o hash do último evento', async () => {
    const eventos = await cadeia(4);

    const resultado = await verificarCadeia(eventos);

    assert.deepEqual(resultado, { ok: true, cabeca: eventos[3]?.hash });
  });

  it('aponta o evento cujo payload foi adulterado', async () => {
    const eventos = await cadeia(4);
    eventos[2] = { ...eventos[2]!, payload: { n: 'adulterado' } };

    const resultado = await verificarCadeia(eventos);

    assert.deepEqual(resultado, { ok: false, indice: 2, seq: 2, motivo: 'hash' });
  });

  it('pega quem recalcula o hash do evento adulterado: o seguinte deixa de bater', async () => {
    const eventos = await cadeia(4);
    const alterado = { ...eventos[1]!, payload: { n: 'adulterado' } };
    eventos[1] = { ...alterado, hash: await hashEvento(alterado) };

    const resultado = await verificarCadeia(eventos);

    assert.deepEqual(resultado, { ok: false, indice: 2, seq: 2, motivo: 'prev_hash' });
  });

  it('aponta a lacuna quando um evento do meio é removido', async () => {
    const eventos = await cadeia(4);
    eventos.splice(1, 1);

    const resultado = await verificarCadeia(eventos);

    assert.deepEqual(resultado, { ok: false, indice: 1, seq: 2, motivo: 'seq' });
  });

  it('aponta eventos fora de ordem', async () => {
    const [a, b, c] = await cadeia(3);
    assert.ok(a && b && c);

    const resultado = await verificarCadeia([a, c, b]);

    assert.deepEqual(resultado, { ok: false, indice: 1, seq: 2, motivo: 'seq' });
  });

  it('aponta evento de outro pedido emendado na cadeia', async () => {
    const eventos = await cadeia(2);
    const estranho = await encadear(null, entrada(0, { pedidoId: '9'.repeat(44) }));
    eventos[1] = { ...estranho, seq: 1, prevHash: eventos[0]!.hash };

    const resultado = await verificarCadeia(eventos);

    assert.deepEqual(resultado, { ok: false, indice: 1, seq: 1, motivo: 'pedido' });
  });
});
