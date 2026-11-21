import { describe, expect, it } from 'vitest';
import type { Divergencia, Tarefa, VersaoPedido } from '../../shared/model.ts';
import { FILTRO_TODAS, agruparTarefas, chaveTarefa, montarMatriz, tarefasDaParte } from './matriz.ts';

const versao = (n: number, fonte: VersaoPedido['fonte'], campos: VersaoPedido['campos']): VersaoPedido => ({
  pedidoId: 'p1',
  versao: n,
  fonte,
  campos,
  geradaEm: '2026-11-21T00:00:00Z',
});

const atraso: Divergencia = {
  campo: 'previsaoEntrega',
  fonteA: 'nfe',
  fonteB: 'planilha',
  valorA: '2026-01-22',
  valorB: '2026-01-25',
};

describe('montarMatriz', () => {
  it('ordena as colunas pela chegada da fonte e usa a última versão de cada uma', () => {
    const m = montarMatriz(
      [
        versao(1, 'nfe', { previsaoEntrega: '2026-01-22', pesoTotal: 500 }),
        versao(2, 'cte', { pesoTotal: 500 }),
        versao(3, 'nfe', { previsaoEntrega: '2026-01-23', pesoTotal: 500 }),
      ],
      [],
    );

    expect(m.fontes).toEqual(['nfe', 'cte']);
    expect(m.linhas.find((l) => l.campo === 'previsaoEntrega')?.celulas[0]?.valor).toBe('2026-01-23');
  });

  it('deixa a célula vazia quando a fonte não declara o campo', () => {
    const m = montarMatriz([versao(1, 'nfe', { volumes: 12 }), versao(2, 'cte', {})], []);

    expect(m.linhas.find((l) => l.campo === 'volumes')?.celulas.map((c) => c.valor)).toEqual([12, undefined]);
  });

  it('marca o conflito nas duas fontes enquanto o valor ainda é o último', () => {
    const m = montarMatriz(
      [
        versao(1, 'nfe', { previsaoEntrega: '2026-01-22' }),
        versao(2, 'planilha', { previsaoEntrega: '2026-01-25' }),
      ],
      [atraso],
    );

    const linha = m.linhas.find((l) => l.campo === 'previsaoEntrega');
    expect(linha?.divergente).toBe(true);
    expect(linha?.celulas.map((c) => c.emConflito)).toEqual([true, true]);
  });

  it('não marca divergência antiga depois que a fonte corrigiu o valor', () => {
    const m = montarMatriz(
      [
        versao(1, 'nfe', { previsaoEntrega: '2026-01-22' }),
        versao(2, 'planilha', { previsaoEntrega: '2026-01-25' }),
        versao(3, 'planilha', { previsaoEntrega: '2026-01-22' }),
      ],
      [atraso],
    );

    expect(m.linhas.find((l) => l.campo === 'previsaoEntrega')?.divergente).toBe(false);
  });
});

describe('tarefasDaParte', () => {
  const tarefa = (parte: Tarefa['parte']): Tarefa => ({ parte, titulo: 't', detalhe: 'd', divergencia: atraso });

  it('devolve tudo em "todas" e só a parte pedida nos demais filtros', () => {
    const lista = [tarefa('cd'), tarefa('fiscal'), tarefa('cd')];

    expect(tarefasDaParte(lista, FILTRO_TODAS)).toHaveLength(3);
    expect(tarefasDaParte(lista, 'cd')).toHaveLength(2);
    expect(tarefasDaParte(lista, 'financeiro')).toEqual([]);
  });

  it('gera chaves diferentes para tarefas de partes diferentes', () => {
    expect(chaveTarefa(tarefa('cd'))).not.toBe(chaveTarefa(tarefa('fiscal')));
  });
});

describe('agruparTarefas', () => {
  const tarefa = (parte: Tarefa['parte'], titulo: string, valorB: string): Tarefa => ({
    parte,
    titulo,
    detalhe: 'd',
    divergencia: { ...atraso, valorB },
  });

  it('junta a mesma ação da mesma parte e guarda uma ocorrência por origem', () => {
    const grupos = agruparTarefas([
      tarefa('cd', 'Conferir volumes', '8'),
      tarefa('cd', 'Conferir volumes', '9'),
      tarefa('fiscal', 'Conferir volumes', '8'),
    ]);

    expect(grupos).toHaveLength(2);
    expect(grupos[0]?.ocorrencias).toHaveLength(2);
    expect(grupos[1]?.parte).toBe('fiscal');
  });

  it('mantém a ordem em que as ações apareceram', () => {
    const grupos = agruparTarefas([tarefa('cd', 'B', '1'), tarefa('cd', 'A', '1'), tarefa('cd', 'B', '2')]);

    expect(grupos.map((g) => g.titulo)).toEqual(['B', 'A']);
  });
});
