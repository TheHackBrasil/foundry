import { describe, expect, it } from 'vitest';
import type { Divergencia, Tarefa, VersaoPedido } from '../../shared/model.ts';
import { variacao, chaveAgrupada } from './format.ts';
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

describe('origem, valor anterior e referência na matriz', () => {
  const v = (n: number, fonte: VersaoPedido['fonte'], campos: VersaoPedido['campos'], geradaEm: string): VersaoPedido => ({
    pedidoId: 'p1',
    versao: n,
    fonte,
    campos,
    geradaEm,
  });

  it('guarda versão e momento da última versão de cada fonte', () => {
    const m = montarMatriz(
      [v(1, 'nfe', { pesoTotal: 510 }, '2026-11-18T09:12:00Z'), v(1, 'cte', { pesoTotal: 520 }, '2026-11-20T17:40:00Z')],
      [],
    );
    const cte = m.linhas.find((l) => l.campo === 'pesoTotal')?.celulas[1];
    expect(cte?.versao).toBe(1);
    expect(cte?.em).toBe('2026-11-20T17:40:00Z');
  });

  it('mostra o valor anterior só quando a mesma fonte mudou de valor', () => {
    const m = montarMatriz(
      [
        v(1, 'nfe', { previsaoEntrega: '2026-11-22' }, '2026-11-18T09:12:00Z'),
        v(1, 'planilha', { previsaoEntrega: '2026-11-22' }, '2026-11-19T10:00:00Z'),
        v(2, 'planilha', { previsaoEntrega: '2026-11-25' }, '2026-11-21T14:02:00Z'),
      ],
      [],
    );
    const celulas = m.linhas.find((l) => l.campo === 'previsaoEntrega')?.celulas ?? [];
    expect(celulas[0]?.antes).toBeUndefined();
    expect(celulas[1]?.antes).toBe('2026-11-22');
    expect(celulas[1]?.versao).toBe(2);
  });

  it('não confunde versão repetida com mudança de valor', () => {
    const m = montarMatriz(
      [v(1, 'nfe', { volumes: 10 }, '2026-11-18T09:12:00Z'), v(2, 'nfe', { volumes: 10 }, '2026-11-19T09:12:00Z')],
      [],
    );
    expect(m.linhas.find((l) => l.campo === 'volumes')?.celulas[0]?.antes).toBeUndefined();
  });

  it('a referência da linha é a primeira fonte que declara o campo', () => {
    const m = montarMatriz([v(1, 'nfe', {}, '2026-11-18T09:12:00Z'), v(1, 'cte', { pesoTotal: 520 }, '2026-11-20T17:40:00Z')], []);
    const linha = m.linhas.find((l) => l.campo === 'pesoTotal');
    expect(linha?.referencia?.fonte).toBe('cte');
    expect(linha?.celulas.map((c) => c.referencia)).toEqual([false, true]);
  });
});

describe('variacao e chave agrupada', () => {
  it('data: diferença em dias, com sinal e plural', () => {
    expect(variacao('previsaoEntrega', '2026-11-25', '2026-11-22')).toBe('+3 dias');
    expect(variacao('previsaoEntrega', '2026-11-23', '2026-11-22')).toBe('+1 dia');
    expect(variacao('previsaoEntrega', '2026-11-20', '2026-11-22')).toBe('\u22122 dias');
    expect(variacao('previsaoEntrega', '2026-11-22', '2026-11-22')).toBeNull();
  });

  it('peso e volumes: diferença com vírgula decimal pt-BR', () => {
    expect(variacao('pesoTotal', 520, 510)).toBe('+10 kg');
    expect(variacao('pesoTotal', 1312, 1284.5)).toBe('+27,5 kg');
    expect(variacao('volumes', 8, 10)).toBe('\u22122');
  });

  it('status e valores ausentes não têm variação', () => {
    expect(variacao('status', 'em_transito', 'emitida')).toBeNull();
    expect(variacao('pesoTotal', undefined, 510)).toBeNull();
  });

  it('agrupa a chave de 44 dígitos de quatro em quatro', () => {
    expect(chaveAgrupada('31261112345678000123550010000447110000004471')).toBe('3126 1112 3456 7800 0123 5500 1000 0447 1100 0000 4471');
    expect(chaveAgrupada('pedido-x')).toBe('pedido-x');
  });
});
