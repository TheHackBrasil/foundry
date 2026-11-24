// Lookups com valor vindo de fora (planilha, ledger): nomes de
// Object.prototype nao podem resolver metodo nem virar "[object Object]".

import { describe, expect, it } from 'vitest';
import type { AcaoMandato, CanalContato, FonteDocumento, Notificacao, TipoSinal } from '../../shared/model.ts';
import {
  formatarConfianca,
  formatarDuracao,
  formatarMomento,
  formatarValor,
  rotuloAcaoMandato,
  rotuloCanalContato,
  rotuloFonte,
  rotuloMotivoNotificacao,
  rotuloTipoSinal,
} from './format.ts';

describe('formatarValor status', () => {
  it.each(['constructor', 'hasOwnProperty', 'toString', '__proto__'])(
    'status externo "%s" renderiza como texto, nao resolve o prototipo',
    (status) => {
      const saida = formatarValor('status', status);
      expect(saida).toBe(status);
      expect(saida).not.toContain('function');
      expect(saida).not.toContain('[object');
    },
  );

  it('status conhecido segue com rótulo e desconhecido snake_case vira texto', () => {
    expect(formatarValor('status', 'em_transito')).toBe('Em trânsito');
    expect(formatarValor('status', 'em_transito_aduaneira')).toBe('em transito aduaneira');
    expect(formatarValor('status', 'valor_com_outra_coisa')).toBe('valor com outra coisa');
  });
});

describe('rotuloFonte', () => {
  it.each(['constructor', 'hasOwnProperty', 'toString', '__proto__'])(
    'fonte adulterada "%s" renderiza como veio',
    (fonte) => {
      const saida = rotuloFonte(fonte as FonteDocumento);
      expect(saida).toBe(fonte);
      expect(saida).not.toContain('function');
    },
  );

  it('fonte conhecida segue com o rótulo da marca', () => {
    expect(rotuloFonte('nfe')).toBe('NF-e');
    expect(rotuloFonte('imap')).toBe('E-mail');
  });
});

describe('rótulos da camada AI e formatação numérica', () => {
  it('traduz ações, sinais, canais e motivos de notificação sem resolver protótipo', () => {
    expect(rotuloAcaoMandato('simular')).toBe('Simulação');
    expect(rotuloTipoSinal('atraso_avisado')).toBe('Atraso avisado');
    expect(rotuloCanalContato('whatsapp')).toBe('WhatsApp');
    expect(rotuloMotivoNotificacao('canal_incompativel')).toBe('Canal cadastrado incompatível com o provedor');

    expect(rotuloAcaoMandato('constructor' as AcaoMandato)).toBe('constructor');
    expect(rotuloTipoSinal('__proto__' as TipoSinal)).toBe('__proto__');
    expect(rotuloCanalContato('toString' as CanalContato)).toBe('toString');
    expect(rotuloMotivoNotificacao('hasOwnProperty' as NonNullable<Notificacao['motivo']>)).toBe('hasOwnProperty');
  });

  it('limita confiança entre 0% e 100% e formata duração em mm:ss', () => {
    expect(formatarConfianca(0.846)).toBe('85%');
    expect(formatarConfianca(1.4)).toBe('100%');
    expect(formatarConfianca(-0.2)).toBe('0%');
    expect(formatarConfianca(Number.NaN)).toBe('0%');

    expect(formatarDuracao(0)).toBe('00:00');
    expect(formatarDuracao(7)).toBe('00:07');
    expect(formatarDuracao(65)).toBe('01:05');
    expect(formatarDuracao(-3)).toBe('00:00');
  });

  it('formata momento sem vírgula entre data e hora', () => {
    const saida = formatarMomento('2026-11-23 19:32:00+00');
    expect(saida).not.toContain(',');
    expect(saida).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
    expect(formatarMomento('invalido')).toBe('invalido');
  });
});
