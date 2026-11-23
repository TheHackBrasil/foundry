// Lookups com valor vindo de fora (planilha, ledger): nomes de
// Object.prototype nao podem resolver metodo nem virar "[object Object]".

import { describe, expect, it } from 'vitest';
import type { FonteDocumento } from '../../shared/model.ts';
import { formatarValor, rotuloFonte } from './format.ts';

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
