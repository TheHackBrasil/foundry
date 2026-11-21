// Parser NF-e (spec 0004, T012): XML v4.00 -> DocData. XML invalido
// vira erro de parser explicito (RF7).

import { XMLParser } from 'fast-xml-parser';
import type { CamposObservados, DocData, ItemPedido } from '../../shared/model.js';

export class ErroParser extends Error {
  constructor(mensagem: string) {
    super(mensagem);
    this.name = 'ErroParser';
  }
}

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

export function parseNFe(xml: string): DocData {
  let doc: Record<string, unknown>;
  try {
    doc = parser.parse(xml) as Record<string, unknown>;
  } catch (e) {
    throw new ErroParser(`NF-e: XML malformado (${(e as Error).message})`);
  }

  const raiz = (doc['nfeProc'] ?? doc['NFe'] ?? doc) as Record<string, unknown>;
  const nfe = (raiz['NFe'] ?? raiz) as Record<string, unknown>;
  const inf = nfe['infNFe'] as Record<string, unknown> | undefined;
  if (!inf) throw new ErroParser('NF-e: elemento infNFe ausente');

  const idAttr = texto(inf['@_Id']) ?? '';
  const chaveMatch = idAttr.match(/\d{44}/);
  const chave = chaveMatch?.[0];
  if (!chave) throw new ErroParser('NF-e: chave de 44 digitos nao encontrada em infNFe/@Id');

  const ide = (inf['ide'] ?? {}) as Record<string, unknown>;
  const emit = (inf['emit'] ?? {}) as Record<string, unknown>;
  const dest = (inf['dest'] ?? {}) as Record<string, unknown>;
  const total = ((inf['total'] ?? {}) as Record<string, unknown>)['ICMSTot'] as
    | Record<string, unknown>
    | undefined;
  const transp = (inf['transp'] ?? {}) as Record<string, unknown>;

  const dets = lista(inf['det']);
  const itens: ItemPedido[] = dets.map((d) => {
    const prod = ((d as Record<string, unknown>)['prod'] ?? {}) as Record<string, unknown>;
    return {
      codigo: texto(prod['cProd']),
      descricao: texto(prod['xProd']) ?? '?',
      quantidade: numero(prod['qCom']) ?? 0,
      unidade: texto(prod['uCom']) ?? 'UN',
    };
  });

  const vols = lista(transp['vol']) as Array<Record<string, unknown>>;
  const pesoBruto = vols.reduce((acc, v) => acc + (numero(v['pesoB']) ?? 0), 0);
  const qVol = vols.reduce((acc, v) => acc + (numero(v['qVol']) ?? 0), 0);

  const dhEmi = texto(ide['dhEmi']) ?? texto(ide['dEmi']);

  const campos: CamposObservados = { status: 'emitida' };
  if (pesoBruto > 0) campos.pesoTotal = pesoBruto;
  if (qVol > 0) campos.volumes = qVol;
  if (dhEmi) campos.previsaoEntrega = dhEmi.slice(0, 10);

  return {
    fonte: 'nfe',
    docTipo: 'nfe',
    pedidoId: chave,
    campos,
    dados: {
      chave,
      emitente: { cnpj: texto(emit['CNPJ']) ?? texto(emit['CPF']), nome: texto(emit['xNome']) ?? '?' },
      destinatario: { cnpj: texto(dest['CNPJ']) ?? texto(dest['CPF']), nome: texto(dest['xNome']) ?? '?' },
      itens,
      valorNF: numero(total?.['vNF']),
      dataEmissao: dhEmi,
      natureza: texto(ide['natOp']),
    },
  };
}
