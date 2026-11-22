import { describe, expect, it } from 'vitest';
import { formatarData, formatarValor, rotuloFonte, rotuloStatus } from './formato.js';
import type { FonteDocumento } from './model.js';

describe('formatarData', () => {
  it('converte AAAA-MM-DD para DD/MM/AAAA', () => {
    expect(formatarData('2026-01-25')).toBe('25/01/2026');
    expect(formatarData('2026-11-22')).toBe('22/11/2026');
  });

  it('nao desloca o dia nas bordas do ano (sem depender de fuso)', () => {
    expect(formatarData('2026-01-01')).toBe('01/01/2026');
    expect(formatarData('2026-12-31')).toBe('31/12/2026');
  });

  it('aceita 29/02 so em ano bissexto', () => {
    expect(formatarData('2028-02-29')).toBe('29/02/2028');
    expect(formatarData('2026-02-29')).toBe('2026-02-29');
  });

  it('devolve como veio o que nao e data de calendario', () => {
    expect(formatarData('2026-13-01')).toBe('2026-13-01');
    expect(formatarData('2026-04-31')).toBe('2026-04-31');
    expect(formatarData('2026-00-10')).toBe('2026-00-10');
    expect(formatarData('25/01/2026')).toBe('25/01/2026');
    expect(formatarData('2026-01-25T10:00:00-03:00')).toBe('2026-01-25T10:00:00-03:00');
    expect(formatarData('')).toBe('');
  });
});

describe('rotuloStatus', () => {
  it('traduz os cinco codigos do modelo', () => {
    expect(rotuloStatus('emitida')).toBe('Emitida');
    expect(rotuloStatus('em_transito')).toBe('Em trânsito');
    expect(rotuloStatus('entregue')).toBe('Entregue');
    expect(rotuloStatus('atrasada')).toBe('Atrasada');
    expect(rotuloStatus('cancelada')).toBe('Cancelada');
  });

  it('reconhece a grafia livre que vem da planilha', () => {
    expect(rotuloStatus('Em Transito')).toBe('Em trânsito');
    expect(rotuloStatus('em-transito')).toBe('Em trânsito');
    expect(rotuloStatus('  ATRASADA ')).toBe('Atrasada');
  });

  it('devolve como veio o status sem mapeamento', () => {
    expect(rotuloStatus('aguardando coleta')).toBe('aguardando coleta');
    expect(rotuloStatus('constructor')).toBe('constructor');
  });
});

describe('rotuloFonte', () => {
  it('rotula todas as fontes do modelo', () => {
    const esperado: Record<FonteDocumento, string> = {
      nfe: 'NF-e',
      cte: 'CT-e',
      cce: 'CC-e',
      planilha: 'planilha',
      pdf: 'PDF',
      imap: 'e-mail',
      manual: 'entrada manual',
    };
    for (const [fonte, rotulo] of Object.entries(esperado)) {
      expect(rotuloFonte(fonte as FonteDocumento)).toBe(rotulo);
    }
  });
});

describe('formatarValor', () => {
  it('previsaoEntrega vira data brasileira', () => {
    expect(formatarValor('previsaoEntrega', '2026-01-25')).toBe('25/01/2026');
  });

  it('status vira texto legivel', () => {
    expect(formatarValor('status', 'em_transito')).toBe('Em trânsito');
  });

  it('peso e volumes saem como estao', () => {
    expect(formatarValor('pesoTotal', 520)).toBe('520');
    expect(formatarValor('volumes', 12)).toBe('12');
  });

  it('o campo decide o formato, nao o aspecto do valor', () => {
    expect(formatarValor('volumes', '2026-01-25')).toBe('2026-01-25');
    expect(formatarValor('pesoTotal', 'em_transito')).toBe('em_transito');
  });

  it('valor ausente vira ?', () => {
    expect(formatarValor('previsaoEntrega', undefined)).toBe('?');
    expect(formatarValor('status', null)).toBe('?');
  });
});
