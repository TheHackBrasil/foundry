// Projecao (spec 0008, T214/RF5): planilha que chega antes da NF-e ja cria
// um pedido minimo "a confirmar"; a NF-e depois completa os dados.

import { describe, expect, it } from 'vitest';
import type { Evento } from './model.js';
import { projetar } from './projection.js';

const CHAVE = '35260123456789000123550010000000011000000019';

const doc = (tipo: Evento['tipo'], campos: Evento['payload']['campos'], dados: Record<string, unknown> = {}, ts = '2026-01-20T10:00:00Z'): Evento => ({
  pedidoId: CHAVE,
  tipo,
  payload: { fonte: tipo === 'planilha' ? 'planilha' : 'nfe', campos, dados },
  ts,
  prevHash: '',
  hash: '',
});

describe('planilha solitaria', () => {
  it('cria pedido minimo "a confirmar" com os campos da planilha', () => {
    const p = projetar([doc('planilha', { previsaoEntrega: '2026-01-25', pesoTotal: 500 })]);

    expect(p.pedido).not.toBeNull();
    expect(p.pedido!.id).toBe(CHAVE);
    expect(p.pedido!.emitente.nome).toBe('a confirmar');
    expect(p.pedido!.destinatario.nome).toBe('a confirmar');
    expect(p.pedido!.itens).toEqual([]);
    expect(p.pedido!.campos['previsaoEntrega']).toBe('2026-01-25');
    expect(p.pedido!.campos['pesoTotal']).toBe(500);
    expect(p.pedido!.partes).toHaveLength(5);
  });

  it('a NF-e que chega depois completa o pedido minimo', () => {
    const p = projetar([
      doc('planilha', { previsaoEntrega: '2026-01-25' }),
      doc('nfe', { previsaoEntrega: '2026-01-20' }, {
        emitente: { cnpj: '1', nome: 'Fornecedor Ficticio Ltda' },
        destinatario: { nome: 'Cliente Ficticio' },
        itens: [{ descricao: 'item', quantidade: 1, unidade: 'un' }],
      }),
    ]);

    expect(p.pedido!.emitente.nome).toBe('Fornecedor Ficticio Ltda');
    expect(p.pedido!.itens).toHaveLength(1);
    // A planilha continua declarando a data dela: divergencia a cargo do pipeline.
    expect(p.pedido!.campos['previsaoEntrega']).toBe('2026-01-20');
  });
});
