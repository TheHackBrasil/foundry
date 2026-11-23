// Eventos fiscais NF-e (spec 0004, T023): CC-e (110110) e cancelamento
// (110111). CC-e e evento de correcao, nunca gatilho de atraso (R-006):
// o atraso entra pela planilha do fornecedor. Cancelamento vira
// status 'cancelada'.

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
    // CC-e registra a correcao em dados (trilha), mas nao declara campo
    // vigiado: nao e a fonte do atraso (R-006).
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

// Texto livre do evento para a extracao de sinais (T140/RF3): correcao e
// justificativa sao o que o emissor escreveu; a descricao entra como contexto
// curto do tipo. O texto bruto nunca sai daqui para evento nem log.
export function textoDoEvento(doc: DocData): string {
  const d = doc.dados;
  return [d['correcao'], d['justificativa'], d['descricao']]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .join('. ');
}
