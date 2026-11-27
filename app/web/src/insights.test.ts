// Compositor da entrada (spec 0016, AC9): inventario por fonte, degradacao
// quando falta dado, dedup do pedido de sessao e rotulo de simulacao.

import { describe, expect, it } from 'vitest';
import type { Metricas } from '../../shared/model.ts';
import type { PedidoResumo } from './api.ts';
import type { CasoLista } from './operacao/dominio.ts';
import { comporInsights } from './insights.ts';

const PED = '35260211222333000181550010000048211000004821';

const pedido = (id: string, extra: Partial<PedidoResumo> = {}): PedidoResumo => ({
  pedidoId: id,
  totalEventos: 5,
  criadoEm: '2026-11-26T10:00:00Z',
  ultimoEm: '2026-11-26T10:00:00Z',
  ...extra,
});

const casoDiv = (
  id: string,
  pedidoId: string,
  extra: Partial<CasoLista> = {},
): CasoLista => ({
  id,
  pedidoId,
  origem: 'divergencia',
  origemSeq: 3,
  status: 'aberto',
  abertoEm: '2026-11-26T10:00:00Z',
  ciclos: 0,
  divergencia: {
    campo: 'previsaoEntrega',
    fonteA: 'cte',
    fonteB: 'planilha',
    valorA: '2026-01-22',
    valorB: '2026-01-25',
  },
  ...extra,
});

const metricasBase: Metricas = {
  totalPedidos: 2,
  pedidosComExcecao: 1,
  taxaExcecao: 0.5,
  casosAbertos: 2,
  casosResolvidos: 1,
  casosContestados: 0,
  tempoMedioAteDonoMs: null,
  tempoMedioAteResolverMs: null,
};

describe('comporInsights: degradacao', () => {
  it('zero pedidos devolve sequencia vazia (fallback do estado vazio)', () => {
    expect(comporInsights([], [], null)).toEqual([]);
  });

  it('seed minima (1 pedido sem divergencia nem caso) devolve vazio', () => {
    const lista = [pedido(PED)];
    const metricas: Metricas = { ...metricasBase, totalPedidos: 1, pedidosComExcecao: 0, taxaExcecao: 0, casosAbertos: 0, casosResolvidos: 0 };
    expect(comporInsights(lista, [], metricas)).toEqual([]);
  });

  it('pedido consistente nao gera insight de divergencia nem de atraso', () => {
    const lista = [pedido(PED, { divergencias: 0, atrasoDias: null })];
    const ids = comporInsights(lista, [], null).map((i) => i.id);
    expect(ids).not.toContain('divergencias');
    expect(ids).not.toContain('atraso');
  });
});

describe('comporInsights: inventario por fonte', () => {
  it('divergencias saem do contador por pedido e focam o caso mais urgente', () => {
    const lista = [pedido(PED, { divergencias: 2, emitente: 'Krona Eletrônicos' })];
    const casos = [casoDiv(`${PED}:3`, PED)];
    const [insight] = comporInsights(lista, casos, null);
    expect(insight?.id).toBe('divergencias');
    expect(insight?.titulo).toBe('2 divergências entre as fontes');
    expect(insight?.texto).toContain('Krona Eletrônicos');
    expect(insight?.pedidoId).toBe(PED);
    expect(insight?.foco).toEqual({
      tipo: 'divergencia',
      campo: 'previsaoEntrega',
      fonteA: 'cte',
      fonteB: 'planilha',
    });
  });

  it('divergencia sem caso na lista ainda navega para o pedido mais afetado', () => {
    const lista = [pedido(PED, { divergencias: 3 })];
    const [insight] = comporInsights(lista, [], null);
    expect(insight?.id).toBe('divergencias');
    expect(insight?.pedidoId).toBe(PED);
    expect(insight?.foco).toBeUndefined();
  });

  it('atraso sai de atrasoDias e cita o maior deslocamento', () => {
    const lista = [
      pedido(PED, { atrasoDias: 1 }),
      pedido('P2', { atrasoDias: 4, emitente: 'Packsul' }),
    ];
    const [insight] = comporInsights(lista, [], null);
    expect(insight?.id).toBe('atraso');
    expect(insight?.titulo).toBe('2 pedidos em atraso');
    expect(insight?.texto).toContain('4 dias');
    expect(insight?.pedidoId).toBe('P2');
  });

  it('tarefas saem do contador por pedido', () => {
    const lista = [pedido(PED, { tarefas: 3 })];
    const [insight] = comporInsights(lista, [], null);
    expect(insight?.id).toBe('tarefas');
    expect(insight?.titulo).toBe('3 tarefas abertas');
    expect(insight?.pedidoId).toBe(PED);
  });

  it('risco soma estimarCusto dos casos em aberto e carrega rotulo de simulacao', () => {
    const lista = [pedido(PED)];
    const casos = [
      casoDiv(`${PED}:3`, PED),
      casoDiv(`${PED}:5`, PED, { status: 'resolvido' }),
    ];
    const insights = comporInsights(lista, casos, null);
    const risco = insights.find((i) => i.id === 'risco');
    // 1 caso aberto, 3 dias de divergencia na previsao: 3*(400+250+150) = 2400.
    expect(risco?.titulo).toContain('2.400');
    expect(risco?.simulacao).toBe(true);
    expect(risco?.pedidoId).toBe(PED);
  });

  it('excecao sai das metricas e aponta o caso mais urgente', () => {
    const lista = [pedido(PED), pedido('P2')];
    const casos = [casoDiv(`${PED}:3`, PED)];
    const excecao = comporInsights(lista, casos, metricasBase).find((i) => i.id === 'excecao');
    expect(excecao?.titulo).toBe('50% dos pedidos têm exceção');
    expect(excecao?.texto).toContain('2 casos em aberto');
    expect(excecao?.texto).toContain('1 resolvido');
    expect(excecao?.pedidoId).toBe(PED);
  });

  it('sem metricas o insight de excecao nao entra', () => {
    const lista = [pedido(PED, { divergencias: 1 })];
    const ids = comporInsights(lista, [casoDiv(`${PED}:3`, PED)], null).map((i) => i.id);
    expect(ids).not.toContain('excecao');
  });

  it('ordem fixa: divergencias, atraso, tarefas, risco, excecao', () => {
    const lista = [pedido(PED, { divergencias: 1, atrasoDias: 2, tarefas: 2 })];
    const casos = [casoDiv(`${PED}:3`, PED)];
    const ids = comporInsights(lista, casos, metricasBase).map((i) => i.id);
    expect(ids).toEqual(['divergencias', 'atraso', 'tarefas', 'risco', 'excecao']);
  });
});

describe('comporInsights: dedup de sessao', () => {
  it('pedido reenviado na sessao conta uma vez e fica com os dados da copia', () => {
    const lista = [
      pedido(PED, { workspaceId: 'seed', divergencias: 2 }),
      pedido(PED, { workspaceId: 'ws-1', daSessao: true, divergencias: 2 }),
      pedido('P2', { workspaceId: 'seed' }),
    ];
    // Sem dedup, divergencias somaria 4; com dedup fica 2.
    const [insight] = comporInsights(lista, [], null);
    expect(insight?.titulo).toBe('2 divergências entre as fontes');
    expect(insight?.pedidoId).toBe(PED);
  });
});
