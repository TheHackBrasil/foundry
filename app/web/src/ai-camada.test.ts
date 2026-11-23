import { describe, expect, it } from 'vitest';
import type { RespostaMandato, ViewSpec } from '../../shared/model.ts';
import { extrairMensagemErroMandato } from './api.ts';
import { chaveCacheLente, criarCacheLente } from './lenteCache.ts';
import { interpretarResultadoMandato, resumoParaAnuncio } from './mandato.ts';
import { calcularBarrasAudio, normalizarErroVoz } from './useVoz.ts';

describe('extrairMensagemErroMandato', () => {
  it('prefere corpo.mensagem e preserva motivo em 422 e 503', () => {
    expect(
      extrairMensagemErroMandato(422, {
        erro: 'invalido',
        motivo: 'sem_alvo',
        mensagem: 'O comando não resolveu nenhum pedido da sua sessão.',
      }),
    ).toEqual({
      mensagem: 'O comando não resolveu nenhum pedido da sua sessão.',
      motivo: 'sem_alvo',
    });

    expect(
      extrairMensagemErroMandato(503, {
        erro: 'indisponivel',
        mensagem: 'Os comandos dependem de um serviço de IA indisponível.',
      }),
    ).toEqual({
      mensagem: 'Os comandos dependem de um serviço de IA indisponível.',
    });
  });

  it('lê corpo.erro amigável em 429 e 403 vindos de ErroRequisicao', () => {
    expect(
      extrairMensagemErroMandato(429, {
        erro: 'Muitos comandos seguidos a partir deste endereço.',
      }),
    ).toEqual({
      mensagem: 'Muitos comandos seguidos a partir deste endereço.',
    });

    expect(
      extrairMensagemErroMandato(403, {
        erro: 'Os pedidos de exemplo são compartilhados e só podem ser lidos.',
      }),
    ).toEqual({
      mensagem: 'Os pedidos de exemplo são compartilhados e só podem ser lidos.',
    });
  });

  it('nunca expõe código cru "indisponivel" ou "invalido" quando falta mensagem', () => {
    const r503 = extrairMensagemErroMandato(503, { erro: 'indisponivel' });
    expect(r503.mensagem).toContain('Serviço de IA indisponível');
    expect(r503.mensagem).not.toBe('indisponivel');

    const r422 = extrairMensagemErroMandato(422, { erro: 'invalido', motivo: 'parse_falhou' });
    expect(r422.mensagem).toContain('Não foi possível interpretar');
    expect(r422.motivo).toBe('parse_falhou');
  });
});

describe('interpretarResultadoMandato', () => {
  it('normaliza simular com divergências e contagem de tarefas por parte', () => {
    const resposta: RespostaMandato = {
      acao: 'simular',
      alvos: ['35260123456789000123550010000000110000000019'],
      resultado: {
        simulacao: true,
        porPedido: [
          {
            pedidoId: '35260123456789000123550010000000110000000019',
            divergencias: [
              {
                campo: 'previsaoEntrega',
                fonteA: 'nfe',
                fonteB: 'manual',
                valorA: '2026-01-20',
                valorB: '2026-01-28',
              },
            ],
            tarefas: [
              {
                parte: 'cd',
                titulo: 'Reagendar doca',
                detalhe: 'Nova previsão em 28/01/2026.',
                divergencia: {
                  campo: 'previsaoEntrega',
                  fonteA: 'nfe',
                  fonteB: 'manual',
                  valorA: '2026-01-20',
                  valorB: '2026-01-28',
                },
              },
              {
                parte: 'transportadora',
                titulo: 'Confirmar janela',
                detalhe: 'Ajuste de coleta.',
                divergencia: {
                  campo: 'previsaoEntrega',
                  fonteA: 'nfe',
                  fonteB: 'manual',
                  valorA: '2026-01-20',
                  valorB: '2026-01-28',
                },
              },
            ],
          },
        ],
      },
    };

    const res = interpretarResultadoMandato(resposta);
    expect(res.acao).toBe('simular');
    if (res.acao !== 'simular') return;
    expect(res.simulacao).toBe(true);
    expect(res.itens[0]?.divergencias).toHaveLength(1);
    expect(res.itens[0]?.tarefasPorParte).toEqual([
      { parte: 'transportadora', quantidade: 1 },
      { parte: 'cd', quantidade: 1 },
    ]);
    expect(resumoParaAnuncio(res)).toContain('Nenhum campo alterado');
  });

  it('normaliza propagar, resumir e notificar com fallback seguro', () => {
    const prop = interpretarResultadoMandato({
      acao: 'propagar',
      alvos: ['p1'],
      resultado: {
        novosEventos: 0,
        porPedido: [{ pedidoId: 'p1', divergencias: [], tarefas: [], eventosNovos: 0 }],
      },
    });
    expect(prop.acao).toBe('propagar');
    if (prop.acao === 'propagar') expect(prop.novosEventos).toBe(0);

    const resu = interpretarResultadoMandato({
      acao: 'resumir',
      alvos: ['p1'],
      resultado: {
        porPedido: [{ pedidoId: 'p1', resumo: 'Pedido com 2 divergências.', via: 'deterministico' }],
      },
    });
    expect(resu.acao).toBe('resumir');
    if (resu.acao === 'resumir') {
      expect(resu.itens[0]?.via).toBe('deterministico');
      expect(resumoParaAnuncio(resu)).toContain('Pedido com 2 divergências.');
    }

    const notif = interpretarResultadoMandato({
      acao: 'notificar',
      alvos: ['p1'],
      resultado: {
        porPedido: [{ pedidoId: 'p1', parte: 'transportadora', status: 'nao_entregue', motivo: 'desligado' }],
      },
    });
    expect(notif.acao).toBe('notificar');
    if (notif.acao === 'notificar') {
      expect(notif.itens[0]?.motivo).toBe('desligado');
      expect(resumoParaAnuncio(notif)).toContain('Envio automático desligado');
    }
  });
});

describe('cacheLente', () => {
  const spec = (lente: ViewSpec['lente']): ViewSpec => ({
    versao: 1,
    fontesVisiveis: ['nfe'],
    colunas: ['status'],
    lente,
    destacarDivergencias: true,
  });

  it('invalida a chave quando totalEventos muda e respeita o limite de entradas', () => {
    const k1 = chaveCacheLente('p1', 'cd', 10);
    const k2 = chaveCacheLente('p1', 'cd', 11);
    expect(k1).not.toBe(k2);

    const cache = criarCacheLente(2);
    cache.guardar('a', spec('cd'));
    cache.guardar('b', spec('fiscal'));
    cache.guardar('c', spec('transportadora'));

    expect(cache.obter('a')).toBeUndefined();
    expect(cache.obter('b')?.lente).toBe('fiscal');
    expect(cache.obter('c')?.lente).toBe('transportadora');
  });
});

describe('useVoz helpers', () => {
  it('mantém piso no silêncio e eleva barras com energia vocal', () => {
    const silencio = calcularBarrasAudio(new Uint8Array(32), [0.16, 0.16, 0.16, 0.16, 0.16]);
    expect(silencio).toEqual([0.16, 0.16, 0.16, 0.16, 0.16]);

    const fala = new Uint8Array(32).fill(180);
    const ativo = calcularBarrasAudio(fala, silencio);
    expect(ativo).toHaveLength(5);
    for (const v of ativo) {
      expect(v).toBeGreaterThan(0.5);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('traduz erros da Web Speech API para pt-BR', () => {
    expect(normalizarErroVoz('not-allowed')).toContain('Permissão');
    expect(normalizarErroVoz('no-speech')).toContain('Nenhuma fala');
    expect(normalizarErroVoz('aborted')).toBe('');
  });
});
