// Deteccao de tipo de documento (spec 0004, T012/T023/T031/T035):
// XML pelo conteudo, CSV/XLSX/PDF pela extensao. Tipo desconhecido vira
// erro explicito 422 na rota, nunca 500.

import { ErroParser } from './nfe.js';

export type TipoDoc = 'nfe' | 'cte' | 'eventoNFe' | 'csv' | 'xlsx' | 'pdf';

export function detectarTipo(nome: string, conteudo: Buffer): TipoDoc {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  const inicio = conteudo.subarray(0, 2048).toString('utf8');

  if (ext === 'pdf' || inicio.startsWith('%PDF')) return 'pdf';
  if (ext === 'xlsx' || ext === 'xls') return 'xlsx';
  if (ext === 'csv' || ext === 'txt') return 'csv';
  if (ext === 'xml' || inicio.includes('<')) {
    if (/<\s*(cteProc|CTe|infCte)\b/.test(inicio) || conteudo.toString('utf8').includes('infCte')) {
      return 'cte';
    }
    const inteiro = conteudo.toString('utf8');
    if (/<\s*(procEventoNFe|evento|infEvento)\b/.test(inteiro) && /tpEvento/.test(inteiro)) {
      return 'eventoNFe';
    }
    if (/infNFe/.test(inteiro)) return 'nfe';
    throw new ErroParser('Tipo de XML nao reconhecido (esperado NF-e, CT-e ou evento NF-e)');
  }
  throw new ErroParser(`Tipo de documento nao suportado (.${ext || '?'})`);
}
