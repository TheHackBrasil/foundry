// Parser CT-e (spec 0004, T023): XML v4.00 -> DocData; vincula ao
// pedido pela chave NF-e em infNFe.

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

function numero(v: unknown): number | undefined {
  const s = texto(v);
  if (!s) return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

function lista<T>(v: T | T[] | undefined): T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

export function parseCTe(xml: string): DocData {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new ErroParser(`CT-e: XML malformado (${(e as Error).message})`);
  }

  const raiz = (doc['cteProc'] ?? doc['CTe'] ?? doc) as Record<string, unknown>;
  const cte = (raiz['CTe'] ?? raiz) as Record<string, unknown>;
  const inf = cte['infCte'] as Record<string, unknown> | undefined;
  if (!inf) throw new ErroParser('CT-e: elemento infCte ausente');

  const idAttr = texto(inf['@_Id']) ?? '';
  const chaveCte = idAttr.match(/\d{44}/)?.[0];

  const ide = (inf['ide'] ?? {}) as Record<string, unknown>;
  const emit = (inf['emit'] ?? {}) as Record<string, unknown>;
  const enderEmit = (emit['enderEmit'] ?? {}) as Record<string, unknown>;
  const norm = (inf['infCTeNorm'] ?? inf['infCteComp'] ?? {}) as Record<string, unknown>;
  const carga = (norm['infCarga'] ?? {}) as Record<string, unknown>;
  const infDoc = (norm['infDoc'] ?? {}) as Record<string, unknown>;

  // Sem NF-e referenciada usa a propria chave (cai na revisao).
  const nfes = lista(infDoc['infNFe']);
  const chaveNfe = nfes
    .map((n) => texto((n as Record<string, unknown>)['chave']))
    .find((c) => c && /\d{44}/.test(c));
  const pedidoId = chaveNfe ?? chaveCte;
  if (!pedidoId) throw new ErroParser('CT-e: sem chave NF-e referenciada nem chave propria');

  // Carga: infQ traz medidas tipadas (peso, volumes, unidades).
  let peso: number | undefined;
  let volumes: number | undefined;
  for (const q of lista(carga['infQ'])) {
    const med = texto((q as Record<string, unknown>)['tpMed'])?.toUpperCase() ?? '';
    const qtd = numero((q as Record<string, unknown>)['qCarga']);
    if (qtd === undefined) continue;
    if (med.includes('PESO')) peso = (peso ?? 0) + qtd;
    else if (med.includes('VOL') || med.includes('UNIDADE')) volumes = (volumes ?? 0) + qtd;
  }

  const dhEmi = texto(ide['dhEmi']);

  // CT-e autorizado nao prova movimento: o documento e emitido antes da
  // prestacao do servico e diz so que o frete foi contratado. Nascer
  // 'em_transito' criava divergencia falsa de status com a NF-e e com a
  // planilha. O CT-e contribui peso e volumes conferidos na coleta; o
  // status operacional so entra por declaracao ou documento de ocorrencia.
  const campos: CamposObservados = {};
  if (peso !== undefined) campos.pesoTotal = peso;
  if (volumes !== undefined) campos.volumes = volumes;

  return {
    fonte: 'cte',
    docTipo: 'cte',
    pedidoId,
    campos,
    dados: {
      chaveCte,
      chaveNfe: chaveNfe ?? null,
      // fone da transportadora alimenta o bootstrap da agenda (T142/RF7).
      transportadora: {
        cnpj: texto(emit['CNPJ']),
        nome: texto(emit['xNome']) ?? '?',
        ...(texto(enderEmit['fone']) ? { fone: texto(enderEmit['fone']) } : {}),
      },
      valorFrete: numero(((inf['vPrest'] ?? {}) as Record<string, unknown>)['vTPrest']),
      dataEmissao: dhEmi,
      modalidade: texto(ide['modal']),
    },
  };
}
