import { describe, expect, it } from 'vitest';
import type { RespostaMandato, ViewSpec } from '../../shared/model.ts';
import { deduplicarPedidos, extrairMensagemErroMandato } from './api.ts';
import { chaveCacheLente, criarCacheLente } from './lenteCache.ts';
import { interpretarResultadoMandato, resumoParaAnuncio } from './mandato.ts';
import {
  calcularAlvosBarras,
  calcularRmsTemporal,
  montarTranscricao,
  normalizarErroVoz,
  suavizarBarras,
  type EventoResultadoReconhecimento,
} from './useVoz.ts';

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

function criarResultadosVoz(
  itens: ReadonlyArray<{ texto: string; final?: boolean }>,
): EventoResultadoReconhecimento['results'] {
  return itens.map(({ texto, final = true }) => ({
    isFinal: final,
    length: 1,
    0: { transcript: texto },
  }));
}

describe('useVoz helpers', () => {
  describe('montarTranscricao', () => {
    it('junta segmentos com espaço no desktop/Safari e normaliza espaços múltiplos', () => {
      // Arrange
      const resultados = criarResultadosVoz([
        { texto: 'simular' },
        { texto: '   ' },
        { texto: 'atraso   no' },
        { texto: '  pedido 42 ' },
      ]);

      // Act
      const saida = montarTranscricao(resultados, false);

      // Assert
      expect(saida).toEqual({
        texto: 'simular atraso no pedido 42',
        provisorio: false,
      });
    });

    it('deduplica prefixos cumulativos e repetições consecutivas no Android', () => {
      // Arrange
      const cumulativo = criarResultadosVoz([
        { texto: 'Simular' },
        { texto: 'simular atraso' },
        { texto: 'simular atraso no pedido' },
      ]);
      const repetido = criarResultadosVoz([
        { texto: 'propagar pedido' },
        { texto: 'propagar pedido' },
        { texto: 'pedido' },
      ]);

      // Act
      const resCumulativo = montarTranscricao(cumulativo, true);
      const resRepetido = montarTranscricao(repetido, true);

      // Assert
      expect(resCumulativo).toEqual({
        texto: 'simular atraso no pedido',
        provisorio: false,
      });
      expect(resRepetido).toEqual({
        texto: 'propagar pedido',
        provisorio: false,
      });
    });

    it('detecta corretamente resultados provisórios e lista vazia', () => {
      // Arrange
      const comProvisorio = criarResultadosVoz([
        { texto: 'resumir', final: true },
        { texto: 'pedido 12', final: false },
      ]);
      const vazio = criarResultadosVoz([]);

      // Act
      const resProvisorio = montarTranscricao(comProvisorio, false);
      const resVazio = montarTranscricao(vazio, false);

      // Assert
      expect(resProvisorio).toEqual({
        texto: 'resumir pedido 12',
        provisorio: true,
      });
      expect(resVazio).toEqual({
        texto: '',
        provisorio: false,
      });
    });
  });

  describe('calcularRmsTemporal', () => {
    it('retorna 0 no silêncio (128) e RMS esperado para sinal com amplitude', () => {
      // Arrange
      const silencio = new Uint8Array(256).fill(128);
      const vazio = new Uint8Array(0);
      const ondaQuadrada = new Uint8Array(256);
      for (let i = 0; i < ondaQuadrada.length; i++) {
        ondaQuadrada[i] = i % 2 === 0 ? 192 : 64;
      }

      // Act
      const rmsSilencio = calcularRmsTemporal(silencio);
      const rmsVazio = calcularRmsTemporal(vazio);
      const rmsOnda = calcularRmsTemporal(ondaQuadrada);

      // Assert
      expect(rmsSilencio).toBe(0);
      expect(rmsVazio).toBe(0);
      expect(rmsOnda).toBeCloseTo(0.5, 5);
    });
  });

  describe('calcularAlvosBarras e suavizarBarras', () => {
    it('mantém piso 0.12 no silêncio e ignora frequências fora da banda vocal', () => {
      // Arrange
      const silencio = new Uint8Array(128);
      const foraBanda = new Uint8Array(128);
      foraBanda[0] = 255;
      foraBanda.fill(255, 24);

      // Act
      const alvosSilencio = calcularAlvosBarras(silencio, 0);
      const alvosForaBanda = calcularAlvosBarras(foraBanda, 0.01);

      // Assert
      expect(alvosSilencio).toHaveLength(20);
      expect(alvosSilencio.every((v) => v === 0.12)).toBe(true);
      expect(alvosForaBanda.every((v) => v === 0.12)).toBe(true);
    });

    it('eleva barras com energia em banda vocal (bins 1..16) com envelope simétrico de Hann e piso de RMS', () => {
      // Arrange
      const fala = new Uint8Array(128);
      fala.fill(180, 1, 17);
      const apenasRms = new Uint8Array(128);

      // Act
      const alvosFala = calcularAlvosBarras(fala, 0.15);
      const alvosRms = calcularAlvosBarras(apenasRms, 0.12);

      // Assert
      expect(alvosFala).toHaveLength(20);
      expect(alvosFala[9]).toBeGreaterThan(0.6);
      expect(alvosFala[9]).toBeGreaterThan(alvosFala[0] ?? 0);
      for (let i = 0; i < 20; i++) {
        expect(alvosFala[i]).toBeGreaterThanOrEqual(0.12);
        expect(alvosFala[i]).toBeLessThanOrEqual(1);
        expect(alvosFala[i]).toBe(alvosFala[19 - i]);
      }
      expect(alvosRms[9]).toBeGreaterThan(0.12);
    });

    it('aplica ataque mais rápido que queda e mantém independência de dtMs', () => {
      // Arrange
      const inicioBaixo = [0.12];
      const inicioAlto = [0.92];

      // Act
      const passoAtaque = suavizarBarras(inicioBaixo, inicioAlto, 16);
      const passoQueda = suavizarBarras(inicioAlto, inicioBaixo, 16);

      const umPasso32 = suavizarBarras(inicioBaixo, inicioAlto, 32);
      const passo16a = suavizarBarras(inicioBaixo, inicioAlto, 16);
      const doisPassos16 = suavizarBarras(passo16a, inicioAlto, 16);

      const queda32 = suavizarBarras(inicioAlto, inicioBaixo, 32);
      const queda16a = suavizarBarras(inicioAlto, inicioBaixo, 16);
      const quedaDois16 = suavizarBarras(queda16a, inicioBaixo, 16);

      const dtMinClamp = suavizarBarras(inicioBaixo, inicioAlto, 1);
      const dtMinLimite = suavizarBarras(inicioBaixo, inicioAlto, 4);
      const dtMaxClamp = suavizarBarras(inicioBaixo, inicioAlto, 500);
      const dtMaxLimite = suavizarBarras(inicioBaixo, inicioAlto, 64);

      // Assert
      const deltaAtaque = (passoAtaque[0] ?? 0) - 0.12;
      const deltaQueda = 0.92 - (passoQueda[0] ?? 0);
      expect(deltaAtaque).toBeGreaterThan(deltaQueda);

      expect(doisPassos16[0]).toBeCloseTo(umPasso32[0] ?? 0, 6);
      expect(quedaDois16[0]).toBeCloseTo(queda32[0] ?? 0, 6);

      expect(dtMinClamp[0]).toBe(dtMinLimite[0]);
      expect(dtMaxClamp[0]).toBe(dtMaxLimite[0]);
    });
  });

  it('traduz erros da Web Speech API para pt-BR', () => {
    expect(normalizarErroVoz('not-allowed')).toContain('Permissão');
    expect(normalizarErroVoz('no-speech')).toContain('Nenhuma fala');
    expect(normalizarErroVoz('network')).toContain('Brave');
    expect(normalizarErroVoz('language-not-supported')).toContain('pt-BR');
    expect(normalizarErroVoz('aborted')).toBe('');
  });
});

describe('deduplicarPedidos', () => {
  it('mantém uma entrada por pedidoId priorizando o pedido da sessão sobre o da seed', () => {
    const lista = deduplicarPedidos(
      [
        { pedidoId: 'p1', workspaceId: 'seed', totalEventos: 56, criadoEm: '2026-11-22', ultimoEm: '2026-11-22' },
        { pedidoId: 'p1', workspaceId: 'ws-user', totalEventos: 41, criadoEm: '2026-11-23', ultimoEm: '2026-11-23' },
        { pedidoId: 'p2', workspaceId: 'seed', totalEventos: 10, criadoEm: '2026-11-22', ultimoEm: '2026-11-22' },
      ],
      'ws-user',
    );

    expect(lista).toHaveLength(2);
    expect(lista[0]?.pedidoId).toBe('p1');
    expect(lista[0]?.daSessao).toBe(true);
    expect(lista[0]?.totalEventos).toBe(41);
    expect(lista[1]?.pedidoId).toBe('p2');
    expect(lista[1]?.daSessao).toBe(false);
  });
});
