// Personas da transportadora simulada: decisao deterministica por sequencia
// da thread, dois livros (verdade x declarado) e datas relativas.

import { describe, expect, it } from 'vitest';
import { NOMES_CENARIOS, roteiro } from './cenarios.js';
import { EstadoPersonas, dataRelativa, decidir } from './personas.js';

const AGORA = new Date('2026-11-28T12:00:00Z');
const PEDIDO = '35260211222333000181550010000048211000004821';

describe('personas', () => {
  it('cooperativa responde ja na primeira cobranca com status e previsao', () => {
    const r = roteiro('cooperativa');
    const d = decidir(r, { sequencia: 1, pedidoId: PEDIDO, agora: AGORA });
    expect(d.tipo).toBe('responder');
    if (d.tipo !== 'responder') return;
    expect(d.corpo).toContain(PEDIDO);
    expect(d.corpo).toContain('em transito');
    expect(d.corpo).toContain('30/11/2026'); // hoje + previsaoDias=2
  });

  it('evasiva enrola na primeira e diverge na segunda cobranca', () => {
    const r = roteiro('evasiva');
    const primeira = decidir(r, { sequencia: 1, pedidoId: PEDIDO, agora: AGORA });
    const segunda = decidir(r, { sequencia: 2, pedidoId: PEDIDO, agora: AGORA });
    expect(primeira.tipo).toBe('responder');
    expect(segunda.tipo).toBe('responder');
    if (primeira.tipo !== 'responder' || segunda.tipo !== 'responder') return;
    expect(primeira.corpo).toContain('verificar');
    // Segunda resposta declara o livro otimista: em transito + hoje+2, enquanto
    // a verdade do roteiro e atrasada com hoje+6 (quebra na serra).
    expect(segunda.corpo).toContain('em transito');
    expect(segunda.corpo).toContain('30/11/2026');
    expect(r.verdade.statusReal).toBe('atrasada');
    expect(r.declarado.previsaoDias).toBeLessThan(r.verdade.previsaoRealDias);
  });

  it('silenciosa nunca responde', () => {
    const r = roteiro('silenciosa');
    expect(decidir(r, { sequencia: 1, pedidoId: PEDIDO, agora: AGORA }).tipo).toBe('silencio');
    expect(decidir(r, { sequencia: 9, pedidoId: PEDIDO, agora: AGORA }).tipo).toBe('silencio');
  });

  it('conta mensagens por chave de thread', () => {
    const e = new EstadoPersonas();
    expect(e.proximaSequencia('a')).toBe(1);
    expect(e.proximaSequencia('b')).toBe(1);
    expect(e.proximaSequencia('a')).toBe(2);
  });

  it('dataRelativa devolve ISO e dd/mm/aaaa', () => {
    expect(dataRelativa(AGORA, 2)).toEqual({ iso: '2026-11-30', br: '30/11/2026' });
  });

  it('os tres roteiros nomeados existem', () => {
    expect(NOMES_CENARIOS).toEqual(['cooperativa', 'evasiva', 'silenciosa']);
    for (const n of NOMES_CENARIOS) expect(roteiro(n).nome).toBe(n);
  });
});
