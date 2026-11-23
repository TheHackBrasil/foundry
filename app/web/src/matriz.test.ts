import { describe, expect, it } from 'vitest';
import type { Divergencia, Tarefa, VersaoPedido, ViewSpec } from '../../shared/model.ts';
import { variacao, chaveAgrupada } from './format.ts';
import {
  FILTRO_TODAS,
  agruparTarefas,
  aplicarViewSpec,
  chaveTarefa,
  montarMatriz,
  tarefasDaParte,
} from './matriz.ts';

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

  it('mesma divergência de campo e valor com fontes distintas gera chaves distintas', () => {
    const entre = (fonteA: Tarefa['divergencia']['fonteA'], fonteB: Tarefa['divergencia']['fonteB']): Tarefa => ({
      parte: 'cd',
      titulo: 't',
      detalhe: 'd',
      divergencia: { ...atraso, fonteA, fonteB },
    });
    expect(chaveTarefa(entre('nfe', 'planilha'))).not.toBe(chaveTarefa(entre('nfe', 'pdf')));
    expect(chaveTarefa(entre('cte', 'planilha'))).not.toBe(chaveTarefa(entre('planilha', 'cte')));
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

describe('aplicarViewSpec', () => {
  const matrizBase = () =>
    montarMatriz(
      [
        versao(1, 'nfe', { previsaoEntrega: '2026-01-22', pesoTotal: 510, volumes: 10, status: 'emitida' }),
        versao(2, 'cte', { pesoTotal: 520, volumes: 12, status: 'em_transito' }),
        versao(3, 'planilha', { previsaoEntrega: '2026-01-25', status: 'atrasada' }),
      ],
      [atraso],
    );

  it('filtra fontes e colunas no spec parcial e informa o que ficou oculto', () => {
    const spec: ViewSpec = {
      versao: 1,
      fontesVisiveis: ['nfe', 'cte'],
      colunas: ['previsaoEntrega', 'pesoTotal'],
      lente: 'transportadora',
      destacarDivergencias: true,
    };

    const res = aplicarViewSpec(matrizBase(), spec);

    expect(res.ajustada).toBe(true);
    expect(res.lente).toBe('transportadora');
    expect(res.destacarDivergencias).toBe(true);
    expect(res.matriz.fontes).toEqual(['nfe', 'cte']);
    expect(res.matriz.linhas.map((l) => l.campo)).toEqual(['previsaoEntrega', 'pesoTotal']);
    expect(res.matriz.linhas[0]?.celulas.map((c) => c.fonte)).toEqual(['nfe', 'cte']);
    expect(res.fontesOcultas).toEqual(['planilha']);
    expect(res.camposOcultos).toEqual(['volumes', 'status']);
  });

  it('ignora fonte ausente na matriz e faz dedup de fontes e colunas repetidas', () => {
    const spec: ViewSpec = {
      versao: 1,
      fontesVisiveis: ['pdf', 'planilha', 'planilha', 'nfe', 'imap'],
      colunas: ['status', 'status', 'previsaoEntrega'],
      lente: 'cd',
      destacarDivergencias: true,
    };

    const res = aplicarViewSpec(matrizBase(), spec);

    expect(res.ajustada).toBe(true);
    expect(res.matriz.fontes).toEqual(['nfe', 'planilha']);
    expect(res.matriz.linhas.map((l) => l.campo)).toEqual(['previsaoEntrega', 'status']);
    expect(res.fontesOcultas).toEqual(['cte']);
    expect(res.camposOcultos).toEqual(['pesoTotal', 'volumes']);
  });

  it('cai na visão completa quando nenhuma fonte do spec existe na matriz', () => {
    const base = matrizBase();
    const spec: ViewSpec = {
      versao: 1,
      fontesVisiveis: ['pdf', 'imap'],
      colunas: ['previsaoEntrega'],
      lente: 'fiscal',
      destacarDivergencias: false,
    };

    const res = aplicarViewSpec(base, spec);

    expect(res.ajustada).toBe(false);
    expect(res.destacarDivergencias).toBe(true);
    expect(res.matriz).toBe(base);
    expect(res.fontesOcultas).toEqual([]);
    expect(res.camposOcultos).toEqual([]);
  });

  it('cai na visão completa quando nenhuma coluna válida coincide com a matriz', () => {
    const base = matrizBase();
    const spec = {
      versao: 1 as const,
      fontesVisiveis: ['nfe' as const],
      colunas: [],
      lente: 'financeiro' as const,
      destacarDivergencias: true,
    };

    const res = aplicarViewSpec(base, spec);

    expect(res.ajustada).toBe(false);
    expect(res.matriz).toBe(base);
  });

  it('não marca como ajustada quando o spec padrão mantém tudo visível e com destaque', () => {
    const specPadrao: ViewSpec = {
      versao: 1,
      fontesVisiveis: ['nfe', 'cte', 'cce', 'planilha', 'pdf', 'imap', 'manual'],
      colunas: ['previsaoEntrega', 'pesoTotal', 'volumes', 'status'],
      lente: 'fornecedor',
      destacarDivergencias: true,
    };

    const res = aplicarViewSpec(matrizBase(), specPadrao);

    expect(res.ajustada).toBe(false);
    expect(res.fontesOcultas).toEqual([]);
    expect(res.camposOcultos).toEqual([]);
  });

  it('marca como ajustada quando só destacarDivergencias muda para false', () => {
    const spec: ViewSpec = {
      versao: 1,
      fontesVisiveis: ['nfe', 'cte', 'planilha'],
      colunas: ['previsaoEntrega', 'pesoTotal', 'volumes', 'status'],
      lente: 'financeiro',
      destacarDivergencias: false,
    };

    const res = aplicarViewSpec(matrizBase(), spec);

    expect(res.ajustada).toBe(true);
    expect(res.destacarDivergencias).toBe(false);
    expect(res.fontesOcultas).toEqual([]);
    expect(res.camposOcultos).toEqual([]);
  });

  it('preserva referência e conflito da linha mesmo quando a fonte de referência é ocultada', () => {
    const spec: ViewSpec = {
      versao: 1,
      fontesVisiveis: ['planilha'],
      colunas: ['previsaoEntrega'],
      lente: 'cd',
      destacarDivergencias: true,
    };

    const res = aplicarViewSpec(matrizBase(), spec);
    const linha = res.matriz.linhas[0];

    expect(linha?.divergente).toBe(true);
    expect(linha?.referencia?.fonte).toBe('nfe');
    expect(linha?.celulas.map((c) => c.fonte)).toEqual(['planilha']);
    expect(res.fontesOcultas).toEqual(['nfe', 'cte']);
  });
});
