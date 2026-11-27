// Card da revisao mostra o que o extrator leu da resposta (fixture sintetica).
import { describe, expect, it } from 'vitest';
import { lerDeclarada } from './DrawerRevisao.tsx';

describe('lerDeclarada', () => {
  it('le campos vigiados, local, observacao e alerta da resposta declarada', () => {
    const d = lerDeclarada({
      docTipo: 'status_declarado',
      campos: { previsaoEntrega: '2027-01-25', inventado: 'x' },
      dados: { observacao: 'Peso 520 kg, 12 volumes', local: 'CD Cajamar', alertaInstrucao: true },
    });
    expect(d).toEqual({
      campos: [['previsaoEntrega', '2027-01-25']],
      observacao: 'Peso 520 kg, 12 volumes',
      local: 'CD Cajamar',
      alertaInstrucao: true,
    });
  });

  it('item que nao e declaracao nao ganha o bloco', () => {
    expect(lerDeclarada({ docTipo: 'nfe', campos: {} })).toBeNull();
    expect(lerDeclarada({ arquivo: 'planilha.xlsx' })).toBeNull();
  });

  it('declaracao sem campos devolve lista vazia', () => {
    expect(lerDeclarada({ docTipo: 'status_declarado' })).toEqual({ campos: [], observacao: null, local: null, alertaInstrucao: false });
  });
});
