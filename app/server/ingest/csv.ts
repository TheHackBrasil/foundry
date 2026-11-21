// Parser CSV de planilhas (spec 0004, T031): uma linha = um doc
// 'planilha'. Headers tolerados em PT-BR (chave_nf, data_prevista...).
// XLSX saiu do MVP: ver D-C13 em brief-core.md.

import Papa from 'papaparse';
import type { CamposObservados, DocData } from '../../shared/model.js';
import { ErroParser } from './nfe.js';

type Linha = Record<string, string>;

const ALIASES: Record<string, string[]> = {
  pedidoId: ['chave_nf', 'chave', 'nfe', 'chave_nfe', 'chave_nf-e', 'pedido', 'nf'],
  previsaoEntrega: ['data_prevista', 'previsao', 'previsao_entrega', 'data_entrega', 'eta', 'data'],
  pesoTotal: ['peso_kg', 'peso', 'peso_total', 'peso_bruto'],
  volumes: ['volumes', 'vols', 'qtd_volumes', 'volume'],
  status: ['status', 'situacao'],
};

function normalizarHeader(h: string): string {
  return h
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function achar(linha: Linha, chave: string): string | undefined {
  for (const alias of ALIASES[chave]!) {
    const v = linha[alias];
    if (v !== undefined && String(v).trim() !== '') return String(v).trim();
  }
  return undefined;
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function data(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const br = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

function linhaParaDoc(linha: Linha, idx: number): DocData | null {
  const pedidoId = achar(linha, 'pedidoId');
  if (!pedidoId) return null;
  const campos: CamposObservados = {};
  const previsao = data(achar(linha, 'previsaoEntrega'));
  const peso = num(achar(linha, 'pesoTotal'));
  const vols = num(achar(linha, 'volumes'));
  const status = achar(linha, 'status');
  if (previsao) campos.previsaoEntrega = previsao;
  if (peso !== undefined) campos.pesoTotal = peso;
  if (vols !== undefined) campos.volumes = vols;
  if (status) campos.status = status;
  return {
    fonte: 'planilha',
    docTipo: 'planilha',
    pedidoId,
    campos,
    dados: { linha: idx + 2, original: linha },
  };
}

function normalizar(linhas: Linha[]): DocData[] {
  return linhas
    .map((l, i) => {
      const norm: Linha = {};
      for (const [k, v] of Object.entries(l)) norm[normalizarHeader(k)] = v;
      return linhaParaDoc(norm, i);
    })
    .filter((d): d is DocData => d !== null);
}

export function parseCsv(texto: string): DocData[] {
  const r = Papa.parse<Linha>(texto, { header: true, skipEmptyLines: true });
  if (r.errors.length > 0 && r.data.length === 0) {
    throw new ErroParser(`CSV: falha de parse (${r.errors[0]!.message})`);
  }
  const docs = normalizar(r.data);
  if (docs.length === 0) throw new ErroParser('CSV: nenhuma linha com chave de pedido');
  return docs;
}
