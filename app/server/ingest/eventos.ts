// Eventos fiscais NF-e (spec 0004, T023): CC-e (110110) e cancelamento
// (110111). Correcao de data vira previsaoEntrega; cancelamento vira
// status 'cancelada'.

import { XMLParser } from 'fast-xml-parser';
import type { CamposObservados, DocData } from '../../shared/model.js';
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

// Extrai data DD/MM/AAAA (ou AAAA-MM-DD) de texto livre da correcao.
function dataNoTexto(s: string): string | undefined {
  const br = s.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = s.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return iso[0];
  return undefined;
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
    // CC-e com data nova vira previsaoEntrega (atraso).
    const novaData = dataNoTexto(correcao);
    const campos: CamposObservados = {};
    if (novaData) campos.previsaoEntrega = novaData;
    if (/atras|posterg|adiad|reagend/i.test(correcao)) campos.status = 'atrasada';
    return {
      fonte: 'cce',
      docTipo: 'cce',
      pedidoId: chNFe,
      campos,
      dados: { chNFe, descricao, correcao, dhEvento, novaData: novaData ?? null },
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
