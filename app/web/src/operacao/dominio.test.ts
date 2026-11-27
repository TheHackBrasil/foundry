// Domínio da #/operacao: ordenação da fila, rótulos e métricas formatadas.

import { describe, expect, it } from 'vitest';
import type { Caso } from '../../../shared/model.ts';
import {
  cartoesMetricas,
  contarOrigens,
  montarFila,
  origemInicial,
  formatarDuracaoMs,
  ordenarCasos,
  pct,
  podeEnviarCobranca,
  tituloCaso,
  type CasoLista,
  type CobrancaLista,
} from './dominio.ts';

const caso = (id: string, status: Caso['status'], abertoEm: string, resolvidoEm?: string): CasoLista => ({
  id,
  pedidoId: 'P1',
  origem: 'divergencia',
  origemSeq: 1,
  status,
  abertoEm,
  ciclos: 0,
  ...(resolvidoEm ? { resolvidoEm } : {}),
});

describe('ordenarCasos', () => {
  it('contestado e aberto mais antigo primeiro; resolvido no fim', () => {
    const fila = ordenarCasos([
      caso('c-res', 'resolvido', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z'),
      caso('c-ab-novo', 'aberto', '2026-01-04T00:00:00Z'),
      caso('c-con', 'contestado', '2026-01-03T00:00:00Z'),
      caso('c-ab-velho', 'aberto', '2026-01-01T00:00:00Z'),
      caso('c-atu', 'atribuido', '2026-01-02T00:00:00Z'),
    ]);
    expect(fila.map((c) => c.id)).toEqual(['c-con', 'c-ab-velho', 'c-ab-novo', 'c-atu', 'c-res']);
  });
});

describe('tituloCaso', () => {
  it('divergência cita campo e fontes; mudança marca a mesma fonte', () => {
    const base: Caso = {
      id: 'P:1',
      pedidoId: 'P',
      origem: 'divergencia',
      origemSeq: 1,
      status: 'aberto',
      abertoEm: '2026-01-01T00:00:00Z',
      ciclos: 0,
      divergencia: { campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'planilha', valorA: 'a', valorB: 'b' },
    };
    expect(tituloCaso(base)).toContain('NF-e');
    expect(tituloCaso({ ...base, divergencia: { ...base.divergencia!, fonteB: 'nfe', tipo: 'mudanca' } }))
      .toContain('mudou');
    expect(tituloCaso({ ...base, origem: 'pendencia', divergencia: undefined, pendencia: { motivo: 'sem_atualizacao' } }))
      .toContain('atualização');
  });
});

describe('formatarDuracaoMs e pct', () => {
  it('sem amostra vira traço; escala sobe de segundos a dias', () => {
    expect(formatarDuracaoMs(null)).toBe('—');
    expect(formatarDuracaoMs(45_000)).toBe('45s');
    expect(formatarDuracaoMs(12 * 60_000)).toBe('12min');
    expect(formatarDuracaoMs((2 * 60 + 14) * 60_000)).toBe('2h14m');
    expect(formatarDuracaoMs(3 * 24 * 3_600_000)).toBe('3d0h');
    expect(pct(0.423)).toBe('42%');
  });
});

describe('podeEnviarCobranca', () => {
  const cb = (status: CobrancaLista['status'], daSessao = true): CobrancaLista =>
    ({ id: 1, pedidoId: 'P', workspaceId: 'w', canal: 'email', contatoId: null, status, criadaEm: '', expiraEm: '', daSessao });
  it('só a sessão dona envia, e só em status que admitem envio', () => {
    expect(podeEnviarCobranca(cb('pendente'))).toBe(true);
    expect(podeEnviarCobranca(cb('enviada'))).toBe(true);
    expect(podeEnviarCobranca(cb('respondida'))).toBe(false);
    expect(podeEnviarCobranca(cb('expirada'))).toBe(false);
    expect(podeEnviarCobranca(cb('pendente', false))).toBe(false);
  });
});

describe('cartoesMetricas', () => {
  it('deriva os seis cartões do shape da API', () => {
    const cards = cartoesMetricas({
      totalPedidos: 10,
      pedidosComExcecao: 4,
      taxaExcecao: 0.4,
      casosAbertos: 3,
      casosResolvidos: 7,
      casosContestados: 1,
      tempoMedioAteDonoMs: 3_600_000,
      tempoMedioAteResolverMs: null,
    });
    expect(cards).toHaveLength(6);
    expect(cards[0]).toMatchObject({ valor: '40%', ajuda: '4 de 10 pedidos' });
    expect(cards[4]!.valor).toBe('1h');
    expect(cards[5]!.valor).toBe('—');
  });
});

describe('fila de trabalho', () => {
  const c = (id: string, pedidoId: string, status: Caso['status'], abertoEm: string, daSessao: boolean): CasoLista => ({
    ...caso(id, status, abertoEm),
    pedidoId,
    daSessao,
    divergencia: { tipo: 'contradicao', campo: id.startsWith('peso') ? 'pesoTotal' : 'volumes', fonteA: 'nfe', fonteB: 'cte', valorA: 1, valorB: 2 },
  }) as unknown as CasoLista;
  const casos = [
    c('peso-a', 'PED-A', 'aberto', '2026-11-20T10:00:00Z', true),
    c('vol-a', 'PED-A', 'contestado', '2026-11-20T09:00:00Z', true),
    c('peso-b', 'PED-B', 'aberto', '2026-11-26T10:00:00Z', true),
    c('vol-b', 'PED-B', 'resolvido', '2026-11-26T11:00:00Z', true),
    c('peso-seed', 'SEED', 'aberto', '2026-11-27T10:00:00Z', false),
  ];

  it('separa sessão de exemplos, esconde resolvidos e põe o pedido mais recente em cima', () => {
    const grupos = montarFila(casos, { origem: 'sessao', mostrarResolvidos: false, busca: '' });
    expect(grupos.map((g) => g.pedidoId)).toEqual(['PED-B', 'PED-A']);
    expect(grupos[0]!.casos.map((x) => x.id)).toEqual(['peso-b']);
    expect(grupos[1]!.casos.map((x) => x.id)).toEqual(['vol-a', 'peso-a']);
    expect(montarFila(casos, { origem: 'exemplos', mostrarResolvidos: false, busca: '' }).map((g) => g.pedidoId)).toEqual(['SEED']);
  });

  it('mostrar resolvidos e buscar por campo ou pedido, sem acento', () => {
    expect(montarFila(casos, { origem: 'sessao', mostrarResolvidos: true, busca: '' })[0]!.casos.map((x) => x.id)).toEqual(['peso-b', 'vol-b']);
    const porCampo = montarFila(casos, { origem: 'sessao', mostrarResolvidos: false, busca: 'peso' });
    expect(porCampo.flatMap((g) => g.casos.map((x) => x.id))).toEqual(['peso-b', 'peso-a']);
    expect(montarFila(casos, { origem: 'sessao', mostrarResolvidos: false, busca: 'ped-a VOLUMES' }).flatMap((g) => g.casos.map((x) => x.id))).toEqual(['vol-a']);
  });

  it('contagem das abas e aba inicial', () => {
    expect(contarOrigens(casos)).toEqual({ sessao: 3, exemplos: 1 });
    expect(origemInicial(casos)).toBe('sessao');
    expect(origemInicial(casos.filter((x) => !x.daSessao))).toBe('exemplos');
  });
});
