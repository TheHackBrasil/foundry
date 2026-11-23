// Deteccao de tipo (spec 0004): XML pelo conteudo, CSV/PDF pela extensao.
// .xlsx volta em D-041 (worker + checagem de zip); .xls, formato binario
// antigo fora do zip, segue no 422 que D-028 deixou.

import { ErroParser } from './nfe.js';

export type TipoDoc = 'nfe' | 'cte' | 'eventoNFe' | 'csv' | 'pdf' | 'eml' | 'xlsx';

export function detectarTipo(nome: string, conteudo: Buffer): TipoDoc {
  const ext = nome.toLowerCase().split('.').pop() ?? '';
  const inicio = conteudo.subarray(0, 2048).toString('utf8');

  if (ext === 'eml') return 'eml';
  if (ext === 'pdf' || inicio.startsWith('%PDF')) return 'pdf';
  if (ext === 'xlsx') return 'xlsx';
  if (ext === 'xls') {
    throw new ErroParser('Planilha .xls (formato antigo) nao suportada: salve como .xlsx ou exporte a planilha como CSV');
  }
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
