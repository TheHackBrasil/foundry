// Cobre o dedupe de rede da spec 0015 (F2): promises em voo divididas entre
// chamadores, janela de reuso curta, cache de projecao por totalEventos e as
// assinaturas/comparadores usados para pular setState.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Contato,
  ProjecaoPedido,
  RespostaAuditoria,
} from '../../../../shared/model.ts';
import type { PedidoResumo } from '../../api.ts';
import {
  assinaturaAuditoria,
  assinaturaContatos,
  assinaturaPedidos,
  assinaturaProjecao,
  buscarAuditoria,
  buscarContatos,
  buscarProjecao,
  buscarVersoesPedido,
  hashCurto,
  registroNumericoIgual,
} from './rede.ts';

const contato: Contato = {
  parte: 'transportadora',
  nome: 'Packsul',
  canal: 'whatsapp',
  destino: '+55 11 90000-0001',
  fonte: 'seed',
};

const projecao = (id: string, totalEventos: number): ProjecaoPedido => ({
  pedido: {
    id,
    emitente: { nome: 'Krona', cnpj: '00.000.000/0001-00' },
    destinatario: { nome: 'Packsul', fone: '+55 11 90000-0001' },
    itens: [],
    campos: {},
    partes: [],
    criadoEm: '2026-11-20T10:00:00Z',
  },
  versoes: [
    { pedidoId: id, versao: 1, fonte: 'nfe', campos: {}, geradaEm: '2026-11-20T10:00:00Z' },
  ],
  divergencias: [],
  tarefas: [],
  sinais: [],
  notificacoes: [],
  totalEventos,
});

const auditoria: RespostaAuditoria = {
  valida: true,
  total: 5,
  indiceFalha: null,
  eventoFalha: null,
  hashEsperado: null,
  hashEncontrado: null,
  ancora: null,
  rootAtual: 'ab'.repeat(32),
  rootHistorico: null,
  rootConfere: null,
  eventosAncorados: null,
};

const resumo = (id: string, totalEventos: number): PedidoResumo => ({
  pedidoId: id,
  totalEventos,
  criadoEm: '2026-11-20T10:00:00Z',
  ultimoEm: '2026-11-21T01:29:59+00:00',
});

describe('dedupe de rede', () => {
  const chamadas: string[] = [];

  const responder = (url: string): unknown => {
    if (url === '/api/contatos') return [contato];
    if (url === '/api/revisao') return { itens: [] };
    const auditMatch = /\/api\/pedidos\/(.+)\/audit$/.exec(url);
    if (auditMatch) return auditoria;
    const pedidoMatch = /\/api\/pedidos\/([^/?]+)$/.exec(url);
    if (pedidoMatch) return projecao(decodeURIComponent(pedidoMatch[1] ?? ''), 7);
    return {};
  };

  beforeEach(() => {
    chamadas.length = 0;
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        chamadas.push(url);
        return { ok: true, json: async () => responder(url) } as Response;
      }),
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('duas chamadas simultaneas ao mesmo endpoint dividem um unico GET', async () => {
    vi.setSystemTime(100_000);
    const [a, b] = await Promise.all([buscarContatos(), buscarContatos()]);
    expect(a).toEqual([contato]);
    expect(b).toEqual([contato]);
    expect(chamadas.filter((u) => u === '/api/contatos')).toHaveLength(1);
  });

  it('resposta recente e reusada dentro da janela e refeita depois dela', async () => {
    vi.setSystemTime(200_000);
    await buscarContatos();
    await buscarContatos();
    expect(chamadas).toHaveLength(1);
    vi.setSystemTime(202_001);
    await buscarContatos();
    expect(chamadas).toHaveLength(2);
  });

  it('pedidos diferentes nao dividem promise; mesmo id em voo sim', async () => {
    vi.setSystemTime(300_000);
    await Promise.all([
      buscarProjecao('pedido-a'),
      buscarProjecao('pedido-b'),
      buscarProjecao('pedido-a'),
    ]);
    const urls = chamadas.filter((u) => /\/api\/pedidos\/[^/]+$/.test(u));
    expect(urls).toHaveLength(2);
    expect(urls).toContain('/api/pedidos/pedido-a');
    expect(urls).toContain('/api/pedidos/pedido-b');
  });

  it('auditoria divide a chamada em voo mas nunca cacheia a verificacao', async () => {
    vi.setSystemTime(400_000);
    await Promise.all([buscarAuditoria('pedido-x'), buscarAuditoria('pedido-x')]);
    const audit = () => chamadas.filter((u) => u.endsWith('/audit')).length;
    expect(audit()).toBe(1);
    await buscarAuditoria('pedido-x');
    expect(audit()).toBe(2);
  });

  it('versoes saem do cache quando o resumo tem o mesmo totalEventos', async () => {
    vi.setSystemTime(500_000);
    await buscarProjecao('pedido-doc');
    const antes = chamadas.length;
    const r = await buscarVersoesPedido(resumo('pedido-doc', 7));
    expect(r.versoes).toHaveLength(1);
    expect(chamadas).toHaveLength(antes);
    await buscarVersoesPedido(resumo('pedido-doc', 9));
    expect(chamadas).toHaveLength(antes + 1);
  });
});

describe('assinaturas e comparadores', () => {
  it('assinaturaPedidos ignora identidade do array e reage ao conteudo', () => {
    const a = [resumo('p1', 3), resumo('p2', 5)];
    const b = [resumo('p1', 3), resumo('p2', 5)];
    expect(assinaturaPedidos(a)).toBe(assinaturaPedidos(b));
    const c = [resumo('p1', 3), resumo('p2', 6)];
    expect(assinaturaPedidos(a)).not.toBe(assinaturaPedidos(c));
  });

  it('assinaturaContatos reage a canal e destino', () => {
    expect(assinaturaContatos([contato])).toBe(assinaturaContatos([{ ...contato }]));
    expect(assinaturaContatos([contato])).not.toBe(
      assinaturaContatos([{ ...contato, destino: '+55 11 90000-0002' }]),
    );
  });

  it('assinaturaProjecao cobre as contagens que mudam junto dos eventos', () => {
    const base = projecao('p1', 7);
    expect(assinaturaProjecao(base)).toBe(assinaturaProjecao({ ...base }));
    expect(assinaturaProjecao(base)).not.toBe(assinaturaProjecao({ ...base, totalEventos: 8 }));
    expect(assinaturaProjecao(base)).not.toBe(
      assinaturaProjecao({ ...base, versoes: [] }),
    );
  });

  it('assinaturaAuditoria inclui validade, total e a raiz', () => {
    expect(assinaturaAuditoria(auditoria)).toBe(assinaturaAuditoria({ ...auditoria }));
    expect(assinaturaAuditoria(auditoria)).not.toBe(
      assinaturaAuditoria({ ...auditoria, rootAtual: 'cd'.repeat(32) }),
    );
    expect(assinaturaAuditoria(auditoria)).not.toBe(
      assinaturaAuditoria({ ...auditoria, valida: false, indiceFalha: 2 }),
    );
  });

  it('hashCurto e deterministico e distingue raizes diferentes', () => {
    const raiz = 'ab'.repeat(32);
    expect(hashCurto(raiz)).toBe(hashCurto(raiz));
    expect(hashCurto(raiz)).not.toBe(hashCurto('cd'.repeat(32)));
    expect(hashCurto('')).toBe(hashCurto(''));
  });

  it('registroNumericoIgual compara chaves e valores, nao a instancia', () => {
    const a = { x: 10, y: 20 };
    expect(registroNumericoIgual(a, { x: 10, y: 20 })).toBe(true);
    expect(registroNumericoIgual(a, { x: 10, y: 21 })).toBe(false);
    expect(registroNumericoIgual(a, { x: 10 })).toBe(false);
    expect(registroNumericoIgual(a, { x: 10, y: 20, z: 0 })).toBe(false);
    expect(registroNumericoIgual({}, {})).toBe(true);
  });
});
