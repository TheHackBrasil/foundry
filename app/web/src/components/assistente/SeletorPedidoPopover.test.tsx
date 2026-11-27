import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { PedidoResumo } from '../../api.ts';
import { filtrarPedidos, SeletorPedidoPopover, textoBuscaPedido } from './SeletorPedidoPopover.tsx';

function pedido(id: string, emitente: string, divergencias = 0): PedidoResumo {
  return {
    pedidoId: id,
    totalEventos: 10,
    criadoEm: '2026-01-01T00:00:00Z',
    ultimoEm: '2026-01-02T00:00:00Z',
    emitente,
    divergencias,
  };
}

const KRONA = pedido('35260211222333000181550010000048211000004821', 'Krona Eletrônicos Ltda', 2);
const PACKSUL = pedido('35260244555666000192550010000073101000007310', 'Packsul Embalagens SA', 0);
const SERRA = pedido('p-serra', 'Transportes Serra Verde', 1);
const PEDIDOS = [KRONA, PACKSUL, SERRA];

describe('filtrarPedidos', () => {
  it('consulta vazia devolve a lista toda', () => {
    expect(filtrarPedidos(PEDIDOS, '')).toHaveLength(3);
    expect(filtrarPedidos(PEDIDOS, '   ')).toHaveLength(3);
  });

  it('filtra por emitente sem acento e sem caixa', () => {
    expect(filtrarPedidos(PEDIDOS, 'KRONA').map((p) => p.emitente)).toEqual([
      'Krona Eletrônicos Ltda',
    ]);
    expect(filtrarPedidos(PEDIDOS, 'eletronicos')).toHaveLength(1);
    expect(filtrarPedidos(PEDIDOS, 'serra')).toHaveLength(1);
  });

  it('filtra pelo código exibido na opção', () => {
    // Krona termina em …004821; Packsul em …007310.
    expect(filtrarPedidos(PEDIDOS, '4821')).toHaveLength(1);
    expect(filtrarPedidos(PEDIDOS, '007310')).toHaveLength(1);
    expect(filtrarPedidos(PEDIDOS, 'p-serra')).toHaveLength(1);
  });

  it('filtra por status textual (conflito / consistente)', () => {
    const conflito = filtrarPedidos(PEDIDOS, 'conflito');
    expect(conflito.map((p) => p.emitente)).toEqual([
      'Krona Eletrônicos Ltda',
      'Transportes Serra Verde',
    ]);
    const consistente = filtrarPedidos(PEDIDOS, 'consistente');
    expect(consistente.map((p) => p.emitente)).toEqual(['Packsul Embalagens SA']);
  });

  it('sem correspondência devolve lista vazia', () => {
    expect(filtrarPedidos(PEDIDOS, 'zzz inexistente')).toEqual([]);
  });

  it('não altera a ordem nem os objetos', () => {
    const out = filtrarPedidos(PEDIDOS, '');
    expect(out.map((p) => p.pedidoId)).toEqual(PEDIDOS.map((p) => p.pedidoId));
    expect(out[0]).toBe(KRONA);
  });
});

describe('textoBuscaPedido', () => {
  it('monta emitente + código + status textual', () => {
    const t = textoBuscaPedido(KRONA);
    expect(t).toContain('Krona Eletrônicos Ltda');
    expect(t).toContain('004821');
    expect(t).toContain('2 conflitos');
    expect(textoBuscaPedido(PACKSUL)).toContain('consistente');
    expect(textoBuscaPedido(SERRA)).toContain('1 conflito');
  });
});

describe('SeletorPedidoPopover (SSR)', () => {
  it('renderiza o gatilho com aria-haspopup listbox', () => {
    const html = renderToStaticMarkup(
      createElement(SeletorPedidoPopover, {
        pedidos: PEDIDOS,
        pedidoId: KRONA.pedidoId,
        divergenteAtual: true,
        aoSelecionar: () => {},
      }),
    );
    expect(html).toContain('aria-haspopup="listbox"');
    expect(html).toContain('Pedido ativo para consulta');
    // Fechado, o menu não monta: nem busca nem listbox saem no markup.
    expect(html).not.toContain('ia-pedido-busca');
    expect(html).not.toContain('role="listbox"');
  });
});
