// Parser de eventos fiscais NF-e (spec 0004, T023): CC-e (110110) e
// cancelamento (110111) -> DocData. A CC-e e evento informativo: entra no
// ledger com o texto da correcao e sem campo observado, porque ela nao
// corrige data de emissao nem de saida (R-006, D-020; Convenio SINIEF s/n
// de 1970, art. 7, par. 1-A, III). O atraso entra pela planilha do
// fornecedor (e, no futuro, por OCOREN). O cancelamento vira status
// 'cancelada'.

import { XMLParser } from 'fast-xml-parser';
import type { DocData } from '../../shared/model.js';
import { ErroParser } from './nfe.js';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  parseTagValue: false,
  trimValues: true,
});

function texto(v: unknown): string | undefined {
  if (v === undefined || v === null) return undefined;
  return String(v).trim();
}

export function parseEventoNFe(xml: string): DocData {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new ErroParser(`Evento NF-e: XML malformado (${(e as Error).message})`);
  }

  const raiz = (doc['procEventoNFe'] ?? doc['evento'] ?? doc) as Record<string, unknown>;
  const evento = (raiz['evento'] ?? raiz) as Record<string, unknown>;
  const inf = evento['infEvento'] as Record<string, unknown> | undefined;
  if (!inf) throw new ErroParser('Evento NF-e: elemento infEvento ausente');

  const tp = texto(inf['tpEvento']);
  const chNFe = texto(inf['chNFe']);
  if (!chNFe || !/\d{44}/.test(chNFe)) {
    throw new ErroParser('Evento NF-e: chNFe ausente ou invalida');
  }
  const det = (inf['detEvento'] ?? {}) as Record<string, unknown>;
  const correcao = texto(det['xCorrecao']) ?? texto(det['xCondUso']) ?? '';
  const descricao = texto(det['descEvento']) ?? '';
  const dhEvento = texto(inf['dhEvento']);

  if (tp === '110110') {
    // Texto livre da correcao nunca vira campo: mesmo com data ou a palavra
    // "atraso" no texto, campos fica vazio.
    return {
      fonte: 'cce',
      docTipo: 'cce',
      pedidoId: chNFe,
      campos: {},
      dados: { chNFe, descricao, correcao, dhEvento },
    };
  }

  if (tp === '110111') {
    return {
      fonte: 'cce',
      docTipo: 'cancelamento',
      pedidoId: chNFe,
      campos: { status: 'cancelada' },
      dados: { chNFe, descricao, justificativa: texto(det['xJust']), dhEvento },
    };
  }

  throw new ErroParser(`Evento NF-e: tpEvento ${tp ?? '?'} nao suportado (esperado 110110 ou 110111)`);
}
