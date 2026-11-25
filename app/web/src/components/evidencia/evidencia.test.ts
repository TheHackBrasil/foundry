import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type {
  BlocoGenUI,
  ProjecaoPedido,
  RespostaMandato,
  ResultadoAgente,
  VersaoPedido,
} from '../../../../shared/model.ts';
import type { OpcoesStreamMandato, ResultadoStreamMandato } from '../../apiOps.ts';
import { EvidenciaLateralIA } from '../EvidenciaLateralIA.tsx';
import {
  agenteServeAoContexto,
  alvoDescricaoIgual,
  blocoEntraNoPainel,
  chaveAlvoDescricao,
  derivarSecoesEvidencia,
  descreverAlvoDescricao,
  evidenciasDoAlvo,
  type AlvoDescricao,
  type ContextoEvidencia,
} from './contexto.ts';
import {
  chaveDescricao,
  extrairTextoResposta,
  guardarDescricaoCache,
  lerDescricaoCache,
  montarMandatoDescricao,
  pedirDescricaoAlvo,
} from './descricao.ts';

const versoes: VersaoPedido[] = [
  {
    pedidoId: 'p1',
    versao: 1,
    fonte: 'nfe',
    campos: { previsaoEntrega: '2026-01-28', pesoTotal: 1200 },
    geradaEm: '2026-01-20T10:00:00Z',
  },
  {
    pedidoId: 'p1',
    versao: 2,
    fonte: 'cte',
    campos: { previsaoEntrega: '2026-01-30', pesoTotal: 1200 },
    geradaEm: '2026-01-21T11:00:00Z',
  },
  {
    pedidoId: 'p1',
    versao: 3,
    fonte: 'cce',
    campos: {},
    geradaEm: '2026-01-22T09:00:00Z',
  },
];

const projecao: ProjecaoPedido = {
  pedido: null,
  versoes,
  divergencias: [
    {
      campo: 'previsaoEntrega',
      fonteA: 'nfe',
      fonteB: 'cte',
      valorA: '2026-01-28',
      valorB: '2026-01-30',
    },
  ],
  tarefas: [
    {
      parte: 'transportadora',
      titulo: 'Conferir previsão de entrega',
      detalhe: 'NF-e e CT-e divergem na data.',
      divergencia: {
        campo: 'previsaoEntrega',
        fonteA: 'nfe',
        fonteB: 'cte',
        valorA: '2026-01-28',
        valorB: '2026-01-30',
      },
    },
  ],
  sinais: [
    {
      tipo: 'atraso_avisado',
      resumo: 'Transportadora avisou atraso de dois dias.',
      confianca: 0.9,
      fonte: 'imap',
    },
  ],
  notificacoes: [],
  totalEventos: 7,
};

function ctx(parcial: Partial<ContextoEvidencia>): ContextoEvidencia {
  return {
    pedidoId: 'p1',
    projecao: { estado: 'ok', dados: projecao },
    focoAtivo: null,
    agente: null,
    ...parcial,
  };
}

function bloco(tipo: string): BlocoGenUI {
  return { tipo } as unknown as BlocoGenUI;
}

describe('derivarSecoesEvidencia', () => {
  it('sem pedido e sem agente nao monta nenhuma secao', () => {
    expect(
      derivarSecoesEvidencia(
        ctx({ pedidoId: null, projecao: { estado: 'carregando' } }),
      ),
    ).toEqual([]);
  });

  it('com pedido e projecao ok monta campos, partes e sinais', () => {
    const secoes = derivarSecoesEvidencia(ctx({}));
    expect(secoes.map((s) => s.tipo)).toEqual(['campos', 'partes', 'sinais']);
  });

  it('omite sinais quando o registro nao tem nenhum', () => {
    const sem: ProjecaoPedido = { ...projecao, sinais: [] };
    const secoes = derivarSecoesEvidencia(
      ctx({ projecao: { estado: 'ok', dados: sem } }),
    );
    expect(secoes.map((s) => s.tipo)).toEqual(['campos', 'partes']);
  });

  it('foco clicado abre a secao de foco na frente', () => {
    const secoes = derivarSecoesEvidencia(
      ctx({ focoAtivo: { tipo: 'celula', campo: 'pesoTotal', fonte: 'nfe' } }),
    );
    expect(secoes[0]).toEqual({
      tipo: 'foco',
      alvo: { tipo: 'celula', campo: 'pesoTotal', fonte: 'nfe' },
    });
  });

  it('resposta do agente so entra quando o pedido bate', () => {
    const agente = { pedidoId: 'outro', texto: 'Resposta de outro pedido.', blocos: [] };
    const secoes = derivarSecoesEvidencia(ctx({ agente }));
    expect(secoes.some((s) => s.tipo === 'agente')).toBe(false);
  });

  it('sem pedido selecionado a resposta do agente e o unico contexto', () => {
    const agente = { pedidoId: 'p1', texto: 'Resumo do pedido.', blocos: [] };
    const secoes = derivarSecoesEvidencia(
      ctx({ pedidoId: null, projecao: { estado: 'carregando' }, agente }),
    );
    expect(secoes).toEqual([{ tipo: 'agente', texto: 'Resumo do pedido.', blocos: [] }]);
  });

  it('filtra blocos que nao cabem na coluna e ignora secao vazia', () => {
    const agente = {
      pedidoId: 'p1',
      texto: '',
      blocos: [bloco('domino_impacto'), bloco('cartoes_despacho')],
    };
    const secoes = derivarSecoesEvidencia(ctx({ agente }));
    expect(secoes.some((s) => s.tipo === 'agente')).toBe(false);
  });

  it('mantem resumo_citado mesmo sem projecao carregada', () => {
    const agente = {
      pedidoId: 'p1',
      texto: '',
      blocos: [bloco('resumo_citado'), bloco('comparador_conflito')],
    };
    const secoes = derivarSecoesEvidencia(
      ctx({ projecao: { estado: 'carregando' }, agente }),
    );
    const secao = secoes.find((s) => s.tipo === 'agente');
    expect(secao && 'blocos' in secao ? secao.blocos.length : 0).toBe(1);
  });
});

describe('blocoEntraNoPainel e agenteServeAoContexto', () => {
  it('resumo_citado e matriz_focada nao precisam de projecao', () => {
    expect(blocoEntraNoPainel(bloco('resumo_citado'), false)).toBe(true);
    expect(blocoEntraNoPainel(bloco('matriz_focada'), false)).toBe(true);
  });

  it('comparador, linha do tempo e checklist pedem projecao', () => {
    for (const tipo of ['comparador_conflito', 'linha_tempo_causal', 'checklist_papel']) {
      expect(blocoEntraNoPainel(bloco(tipo), false)).toBe(false);
      expect(blocoEntraNoPainel(bloco(tipo), true)).toBe(true);
    }
  });

  it('blocos de acao ou simulacao nunca entram na coluna', () => {
    for (const tipo of ['domino_impacto', 'simulador_interativo', 'cartoes_despacho']) {
      expect(blocoEntraNoPainel(bloco(tipo), true)).toBe(false);
    }
  });

  it('agente sem registro nao vira secao', () => {
    expect(agenteServeAoContexto(ctx({ agente: null }))).toBe(false);
    expect(
      agenteServeAoContexto(ctx({ pedidoId: null, agente: { pedidoId: '', texto: 'x', blocos: [] } })),
    ).toBe(true);
  });
});

describe('alvo de descricao', () => {
  it('chave do campo sozinho nao carrega fonte', () => {
    const campo: AlvoDescricao = { tipo: 'campo', campo: 'pesoTotal' };
    expect(chaveAlvoDescricao(campo)).toBe('campo:pesoTotal');
    expect(chaveAlvoDescricao({ tipo: 'celula', campo: 'pesoTotal', fonte: 'nfe' })).toBe(
      'celula:pesoTotal:nfe',
    );
  });

  it('campo nao e igual a celula do mesmo campo', () => {
    expect(
      alvoDescricaoIgual(
        { tipo: 'campo', campo: 'pesoTotal' },
        { tipo: 'celula', campo: 'pesoTotal', fonte: 'nfe' },
      ),
    ).toBe(false);
    expect(
      alvoDescricaoIgual(
        { tipo: 'campo', campo: 'pesoTotal' },
        { tipo: 'campo', campo: 'pesoTotal' },
      ),
    ).toBe(true);
  });

  it('descricao do campo nao aponta fonte', () => {
    expect(descreverAlvoDescricao({ tipo: 'campo', campo: 'pesoTotal' })).toBe(
      'Campo Peso total',
    );
  });
});

describe('evidenciasDoAlvo', () => {
  it('celula traz valor, versao e momento da fonte', () => {
    const itens = evidenciasDoAlvo(
      { tipo: 'celula', campo: 'previsaoEntrega', fonte: 'cte' },
      projecao,
    );
    expect(itens).toHaveLength(1);
    expect(itens[0]!.rotulo).toBe('CT-e');
    expect(itens[0]!.detalhe).toContain('v2');
  });

  it('celula sem valor declara a ausencia', () => {
    const itens = evidenciasDoAlvo(
      { tipo: 'celula', campo: 'volumes', fonte: 'nfe' },
      projecao,
    );
    expect(itens[0]!.detalhe).toBe('Sem valor declarado');
  });

  it('divergencia traz uma linha por fonte com os dois valores', () => {
    const itens = evidenciasDoAlvo(
      { tipo: 'divergencia', campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'cte' },
      projecao,
    );
    expect(itens).toHaveLength(2);
    expect(itens[0]!.rotulo).toBe('NF-e');
    expect(itens[1]!.rotulo).toBe('CT-e');
  });

  it('campo lista as declaracoes de cada versao em ordem', () => {
    const itens = evidenciasDoAlvo({ tipo: 'campo', campo: 'previsaoEntrega' }, projecao);
    expect(itens).toHaveLength(2);
    expect(itens[0]!.detalhe).toContain('v1');
    expect(itens[1]!.detalhe).toContain('v2');
  });

  it('parte lista as tarefas abertas do setor', () => {
    const itens = evidenciasDoAlvo({ tipo: 'parte', parte: 'transportadora' }, projecao);
    expect(itens.length).toBeGreaterThan(0);
    expect(itens[0]!.rotulo).toContain('entrega');
  });

  it('sinal traz tipo, fonte e confianca', () => {
    const itens = evidenciasDoAlvo({ tipo: 'sinal', indice: 0 }, projecao);
    expect(itens).toHaveLength(1);
    expect(itens[0]!.rotulo).toContain('E-mail');
    expect(itens[0]!.detalhe).toContain('confiança');
  });

  it('sem projecao a evidencia concreta sai vazia', () => {
    expect(evidenciasDoAlvo({ tipo: 'versao', versao: 2 }, null)).toEqual([]);
    expect(evidenciasDoAlvo({ tipo: 'parte', parte: 'cd' }, null)).toEqual([]);
  });
});

describe('montarMandatoDescricao', () => {
  it('todo mandato e de leitura e curto', () => {
    const alvos: AlvoDescricao[] = [
      { tipo: 'campo', campo: 'pesoTotal' },
      { tipo: 'celula', campo: 'pesoTotal', fonte: 'nfe' },
      { tipo: 'divergencia', campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'cte' },
      { tipo: 'parte', parte: 'fiscal' },
      { tipo: 'versao', versao: 2 },
      { tipo: 'sinal', indice: 0 },
    ];
    for (const alvo of alvos) {
      const mandato = montarMandatoDescricao(alvo, projecao);
      expect(mandato).toContain('Somente leitura');
      expect(mandato.length).toBeLessThanOrEqual(900);
    }
  });

  it('celula cita fonte e valor declarado', () => {
    const mandato = montarMandatoDescricao(
      { tipo: 'celula', campo: 'previsaoEntrega', fonte: 'cte' },
      projecao,
    );
    expect(mandato).toContain('CT-e');
    expect(mandato).toContain('30/01/2026');
  });

  it('divergencia cita as duas fontes com valores', () => {
    const mandato = montarMandatoDescricao(
      { tipo: 'divergencia', campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'cte' },
      projecao,
    );
    expect(mandato).toContain('NF-e');
    expect(mandato).toContain('CT-e');
    expect(mandato).toContain('divergencia');
  });

  it('sem projecao o mandato ainda nomeia o alvo', () => {
    const mandato = montarMandatoDescricao({ tipo: 'parte', parte: 'cd' }, null);
    expect(mandato).toContain('CD');
  });
});

describe('extrairTextoResposta', () => {
  it('le o resumo do primeiro item porPedido com texto', () => {
    const resposta = {
      acao: 'resumir',
      alvos: ['p1'],
      resultado: {
        porPedido: [
          { pedidoId: 'p1' },
          { pedidoId: 'p1', resumo: '  Texto da resposta. ' },
        ],
      },
    } as unknown as RespostaMandato;
    expect(extrairTextoResposta(resposta)).toBe('Texto da resposta.');
  });

  it('sem porPedido devolve vazio', () => {
    expect(extrairTextoResposta(null)).toBe('');
    expect(extrairTextoResposta({ resultado: {} } as unknown as RespostaMandato)).toBe('');
  });
});

describe('cache de descricao', () => {
  it('guarda e devolve por chave com pedido e totalEventos', () => {
    const chave = chaveDescricao('p1', { tipo: 'parte', parte: 'cd' }, 7);
    guardarDescricaoCache(chave, 'Leitura guardada.');
    expect(lerDescricaoCache(chave)).toBe('Leitura guardada.');
    // Evento novo no ledger invalida a leitura.
    expect(
      lerDescricaoCache(chaveDescricao('p1', { tipo: 'parte', parte: 'cd' }, 8)),
    ).toBeNull();
  });
});

describe('pedirDescricaoAlvo', () => {
  function fakeStream(
    eventos: Array<{ tipo: string; [k: string]: unknown }>,
    resultado: ResultadoStreamMandato = {},
  ) {
    return async (_comando: string, op: OpcoesStreamMandato) => {
      for (const ev of eventos) op.aoEvento(ev as never);
      return resultado;
    };
  }

  const agente: ResultadoAgente = { textoFinal: '', toolsExecutadas: [] };

  it('acumula texto_delta e devolve o texto completo', async () => {
    const deltas: string[] = [];
    const texto = await pedirDescricaoAlvo({
      pedidoId: 'p1',
      alvo: { tipo: 'parte', parte: 'cd' },
      dados: projecao,
      signal: new AbortController().signal,
      aoDelta: (t) => deltas.push(t),
      executar: fakeStream(
        [
          { tipo: 'texto_delta', delta: 'O CD ' },
          { tipo: 'texto_delta', delta: 'confere volumes.' },
          { tipo: 'fim', resultado: agente },
        ],
        { agente },
      ),
    });
    expect(texto).toBe('O CD confere volumes.');
    expect(deltas.at(-1)).toBe('O CD confere volumes.');
  });

  it('sem delta usa textoFinal do fim e depois o resumo de concluido', async () => {
    const viaFim = await pedirDescricaoAlvo({
      pedidoId: 'p1',
      alvo: { tipo: 'versao', versao: 1 },
      dados: projecao,
      signal: new AbortController().signal,
      executar: fakeStream([
        { tipo: 'fim', resultado: { ...agente, textoFinal: 'Texto do fim.' } },
      ]),
    });
    expect(viaFim).toBe('Texto do fim.');

    const resposta = {
      acao: 'resumir',
      alvos: ['p1'],
      resultado: { porPedido: [{ resumo: 'Resumo compat.' }] },
    } as unknown as RespostaMandato;
    const viaCompat = await pedirDescricaoAlvo({
      pedidoId: 'p1',
      alvo: { tipo: 'versao', versao: 1 },
      dados: projecao,
      signal: new AbortController().signal,
      executar: fakeStream([{ tipo: 'concluido', resposta }], { resposta }),
    });
    expect(viaCompat).toBe('Resumo compat.');
  });

  it('passa o pedidoId e o comando de leitura para o transporte', async () => {
    let comando = '';
    let pid = '';
    await pedirDescricaoAlvo({
      pedidoId: 'p1',
      alvo: { tipo: 'campo', campo: 'volumes' },
      dados: projecao,
      signal: new AbortController().signal,
      executar: async (cmd, op) => {
        comando = cmd;
        pid = op.pedidoId ?? '';
        return {};
      },
    });
    expect(pid).toBe('p1');
    expect(comando).toContain('Somente leitura');
    expect(comando).toContain('Volumes');
  });

  it('sem nenhum texto devolve vazio para o estado honesto', async () => {
    const texto = await pedirDescricaoAlvo({
      pedidoId: 'p1',
      alvo: { tipo: 'sinal', indice: 0 },
      dados: projecao,
      signal: new AbortController().signal,
      executar: fakeStream([{ tipo: 'fim', resultado: agente }]),
    });
    expect(texto).toBe('');
  });

  it('propaga erro do transporte', async () => {
    await expect(
      pedirDescricaoAlvo({
        pedidoId: 'p1',
        alvo: { tipo: 'celula', campo: 'pesoTotal', fonte: 'nfe' },
        dados: projecao,
        signal: new AbortController().signal,
        executar: async () => {
          throw new Error('falhou');
        },
      }),
    ).rejects.toThrow('falhou');
  });
});

// Render estatico via react-dom/server: cobre a montagem do painel com o
// contexto minimo (o projeto nao tem jsdom nem testing-library). Efeitos
// nao rodam em SSR, entao a leitura detalhada fica no estado ocioso — que
// e justamente o que um foco externo deve mostrar.
describe('render do painel com contexto minimo', () => {
  const noop = () => {};

  function renderPainel(props: Partial<Parameters<typeof EvidenciaLateralIA>[0]> = {}) {
    return renderToStaticMarkup(
      createElement(EvidenciaLateralIA, {
        id: 'ev',
        pedidoId: 'p1',
        projecao: { estado: 'ok', dados: projecao },
        daSessao: true,
        focoAtivo: null,
        aoFocar: noop,
        aoAbrirNaTorre: noop,
        ...props,
      }),
    );
  }

  it('sem pedido mostra o convite e nao quebra', () => {
    const html = renderPainel({ pedidoId: null, projecao: { estado: 'carregando' } });
    expect(html).toContain('Evidências do registro');
    expect(html).toContain('Selecione um pedido');
  });

  it('com projecao mostra campos, partes e sinais', () => {
    const html = renderPainel();
    expect(html).toContain('Campos vigiados');
    expect(html).toContain('Diverge');
    expect(html).toContain('Partes afetadas');
    expect(html).toContain('Sinais consultivos');
  });

  it('foco externo abre banner com evidencia e botao de leitura explicito', () => {
    const html = renderPainel({
      focoAtivo: { tipo: 'divergencia', campo: 'previsaoEntrega', fonteA: 'nfe', fonteB: 'cte' },
    });
    expect(html).toContain('Destaque ativo');
    expect(html).toContain('Gerar leitura detalhada');
    // A evidencia do registro aparece sem gerar texto: duas fontes, dois valores.
    expect(html).toContain('28/01/2026');
    expect(html).toContain('30/01/2026');
  });

  it('resposta do agente de outro pedido nao aparece no painel', () => {
    const html = renderPainel({
      contextoAgente: { pedidoId: 'outro', texto: 'Nao deve aparecer.', blocos: [] },
    });
    expect(html).not.toContain('Nao deve aparecer.');
    expect(html).not.toContain('Da última resposta');
  });
});
