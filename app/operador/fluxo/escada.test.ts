import { describe, expect, it } from 'vitest';
import {
  configEscada,
  degrauInicial,
  ORDEM_ESCADA,
  proximoPasso,
  type CanalEscada,
  type EntradaEscada,
} from './escada.js';

const H = 3_600_000;
const config = configEscada({ emailH: 4, whatsappH: 1 });
const todos: CanalEscada[] = ['email', 'whatsapp', 'ligacao'];

const entrada = (extra: Partial<EntradaEscada> = {}): EntradaEscada => ({
  degrau: 'email',
  decorridoMs: 0,
  declaracao: 'nenhuma',
  optout: false,
  casoFechado: false,
  canaisDisponiveis: todos,
  ...extra,
});

describe('ordem e configuracao', () => {
  it('a ordem e fixa: e-mail, WhatsApp, ligacao, analista', () => {
    expect(ORDEM_ESCADA).toEqual(['email', 'whatsapp', 'ligacao', 'analista']);
  });

  it('prazos vem das horas passadas; ligacao sobe logo apos o fim da chamada', () => {
    expect(config.prazoMs).toEqual({ email: 4 * H, whatsapp: 1 * H, ligacao: 0 });
  });

  it('prazo negativo ou nao numerico falha cedo', () => {
    expect(() => configEscada({ emailH: -1, whatsappH: 1 })).toThrow(RangeError);
    expect(() => configEscada({ emailH: 4, whatsappH: Number.NaN })).toThrow(RangeError);
  });
});

describe('escalada normal', () => {
  it('e-mail sem declaracao em 4 h sobe para WhatsApp', () => {
    const passo = proximoPasso(entrada({ decorridoMs: 4 * H }), config);
    expect(passo).toMatchObject({ acao: 'subir', de: 'email', para: 'whatsapp', motivo: 'prazo_vencido', pulos: [] });
    expect(passo.cancelarPendentes).toBe(false);
  });

  it('WhatsApp sem declaracao em 1 h sobe para ligacao', () => {
    const passo = proximoPasso(entrada({ degrau: 'whatsapp', decorridoMs: 1 * H }), config);
    expect(passo).toMatchObject({ acao: 'subir', de: 'whatsapp', para: 'ligacao' });
  });

  it('ligacao concluida sem declaracao devolve ao analista na hora', () => {
    const passo = proximoPasso(entrada({ degrau: 'ligacao', decorridoMs: 0 }), config);
    expect(passo).toMatchObject({ acao: 'encerrar', de: 'ligacao', para: 'analista', motivo: 'escada_esgotada' });
  });

  it('prazo vem da config, nunca de constante interna', () => {
    const curta = configEscada({ emailH: 0.5, whatsappH: 1 });
    expect(proximoPasso(entrada({ decorridoMs: 0.5 * H }), curta).acao).toBe('subir');
    expect(proximoPasso(entrada({ decorridoMs: 0.5 * H }), config).acao).toBe('manter');
  });
});

describe('prazo ainda nao vencido', () => {
  it('mantem o degrau e informa quanto falta', () => {
    const passo = proximoPasso(entrada({ decorridoMs: 3 * H }), config);
    expect(passo).toMatchObject({ acao: 'manter', de: 'email', para: 'email', motivo: 'no_prazo', restanteMs: 1 * H });
    expect(passo.cancelarPendentes).toBe(false);
  });

  it('um ms antes do prazo ainda mantem', () => {
    expect(proximoPasso(entrada({ decorridoMs: 4 * H - 1 }), config).acao).toBe('manter');
  });

  it('contato que ainda nao saiu (plano esperando o OK) nao corre prazo', () => {
    const passo = proximoPasso(entrada({ degrau: 'ligacao', decorridoMs: null }), config);
    expect(passo).toMatchObject({ acao: 'manter', para: 'ligacao', motivo: 'aguardando_contato' });
    expect(passo.restanteMs).toBeUndefined();
  });
});

describe('canal sem contato', () => {
  it('pula o WhatsApp sem contato e registra o motivo', () => {
    const passo = proximoPasso(
      entrada({
        decorridoMs: 4 * H,
        canaisDisponiveis: ['email', 'ligacao'],
        motivosPulo: { whatsapp: 'contato_documento' },
      }),
      config,
    );
    expect(passo).toMatchObject({ acao: 'subir', de: 'email', para: 'ligacao' });
    expect(passo.pulos).toEqual([{ degrau: 'whatsapp', motivo: 'contato_documento' }]);
  });

  it('canal fora da lista sem motivo conta como sem_contato', () => {
    const passo = proximoPasso(entrada({ decorridoMs: 4 * H, canaisDisponiveis: ['email', 'ligacao'] }), config);
    expect(passo.pulos).toEqual([{ degrau: 'whatsapp', motivo: 'sem_contato' }]);
  });

  it('sem WhatsApp nem telefone, o e-mail vencido devolve ao analista com os dois pulos', () => {
    const passo = proximoPasso(
      entrada({ decorridoMs: 4 * H, canaisDisponiveis: ['email'], motivosPulo: { ligacao: 'contato_seed' } }),
      config,
    );
    expect(passo).toMatchObject({ acao: 'encerrar', para: 'analista', motivo: 'escada_esgotada' });
    expect(passo.pulos).toEqual([
      { degrau: 'whatsapp', motivo: 'sem_contato' },
      { degrau: 'ligacao', motivo: 'contato_seed' },
    ]);
  });

  it('o degrau inicial pula o e-mail sem contato', () => {
    expect(degrauInicial({ canaisDisponiveis: ['whatsapp', 'ligacao'] })).toEqual({
      degrau: 'whatsapp',
      pulos: [{ degrau: 'email', motivo: 'sem_contato' }],
    });
  });

  it('sem nenhum canal, o caso comeca e termina no analista', () => {
    const inicio = degrauInicial({ canaisDisponiveis: [], motivosPulo: { email: 'nao_contatar_ia' } });
    expect(inicio.degrau).toBe('analista');
    expect(inicio.pulos.map((p) => p.degrau)).toEqual(['email', 'whatsapp', 'ligacao']);
    expect(inicio.pulos[0]?.motivo).toBe('nao_contatar_ia');
  });
});

describe('encerramento', () => {
  it('caso fechado encerra em qualquer degrau e cancela o que nao saiu', () => {
    for (const degrau of ORDEM_ESCADA) {
      const passo = proximoPasso(entrada({ degrau, decorridoMs: 10 * H, casoFechado: true }), config);
      expect(passo).toMatchObject({ acao: 'encerrar', de: degrau, para: degrau, motivo: 'caso_fechado' });
      expect(passo.cancelarPendentes).toBe(true);
    }
  });

  it('caso fechado vale mais que declaracao em revisao e opt-out', () => {
    const passo = proximoPasso(entrada({ casoFechado: true, optout: true, declaracao: 'em_revisao' }), config);
    expect(passo.motivo).toBe('caso_fechado');
  });

  it('opt-out para a escada e devolve ao analista, mesmo no prazo', () => {
    const passo = proximoPasso(entrada({ degrau: 'whatsapp', decorridoMs: 0, optout: true }), config);
    expect(passo).toMatchObject({ acao: 'encerrar', de: 'whatsapp', para: 'analista', motivo: 'optout' });
    expect(passo.cancelarPendentes).toBe(true);
  });

  it('no analista a escada acabou: encerra sem subir', () => {
    const passo = proximoPasso(entrada({ degrau: 'analista', decorridoMs: 100 * H }), config);
    expect(passo).toMatchObject({ acao: 'encerrar', de: 'analista', para: 'analista', motivo: 'escada_esgotada' });
  });
});

describe('declaracao nova', () => {
  it('resposta em revisao pausa a escada mesmo com o prazo vencido (RF18)', () => {
    const passo = proximoPasso(entrada({ degrau: 'whatsapp', decorridoMs: 5 * H, declaracao: 'em_revisao' }), config);
    expect(passo).toMatchObject({ acao: 'pausar', de: 'whatsapp', para: 'whatsapp', motivo: 'declaracao_em_revisao' });
    expect(passo.cancelarPendentes).toBe(true);
  });

  it('declaracao aceita sem fechar o caso reinicia o prazo do degrau', () => {
    const passo = proximoPasso(entrada({ decorridoMs: 9 * H, declaracao: 'aceita' }), config);
    expect(passo).toMatchObject({ acao: 'reiniciar', de: 'email', para: 'email', motivo: 'declaracao_aceita' });
    expect(passo.cancelarPendentes).toBe(true);
  });

  it('resposta que chega depois da subida cancela o passo ainda nao enviado', () => {
    // subiu para WhatsApp, plano esperando o OK, e a resposta do e-mail chegou
    const passo = proximoPasso(entrada({ degrau: 'whatsapp', decorridoMs: null, declaracao: 'em_revisao' }), config);
    expect(passo.acao).toBe('pausar');
    expect(passo.cancelarPendentes).toBe(true);
  });

  it('opt-out vale mais que declaracao nova', () => {
    expect(proximoPasso(entrada({ optout: true, declaracao: 'aceita' }), config).motivo).toBe('optout');
  });
});

describe('pureza', () => {
  it('mesma entrada, mesma saida, sem mexer na entrada', () => {
    const e = entrada({ decorridoMs: 4 * H, canaisDisponiveis: ['email', 'ligacao'] });
    const copia = structuredClone(e);
    expect(proximoPasso(e, config)).toEqual(proximoPasso(e, config));
    expect(e).toEqual(copia);
  });
});
