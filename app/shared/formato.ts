// Formatacao pt-BR dos valores que entram em texto legivel (tarefas, detalhes).
// Funcoes puras, sem Intl e sem Date em hora local: a data e convertida por
// regex sobre a string, entao o texto sai igual em qualquer fuso e locale.

import type { CampoVigiado, FonteDocumento } from './model.js';

// satisfies: o compilador exige um rotulo para cada fonte nova do modelo.
const ROTULO_FONTE = {
  nfe: 'NF-e',
  cte: 'CT-e',
  cce: 'CC-e',
  planilha: 'planilha',
  pdf: 'PDF',
  imap: 'e-mail',
  manual: 'entrada manual',
  email_transportadora: 'resposta da transportadora',
} satisfies Record<FonteDocumento, string>;

// Map, nao objeto: o status da planilha e texto livre e 'constructor' nao
// pode resolver para um membro de Object.prototype.
const ROTULO_STATUS = new Map<string, string>([
  ['emitida', 'Emitida'],
  ['em_transito', 'Em trânsito'],
  ['entregue', 'Entregue'],
  ['atrasada', 'Atrasada'],
  ['cancelada', 'Cancelada'],
]);

const DATA_ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

export function rotuloFonte(fonte: FonteDocumento): string {
  return ROTULO_FONTE[fonte];
}

// AAAA-MM-DD -> DD/MM/AAAA. Valor que nao e data de calendario volta como veio.
export function formatarData(valor: string): string {
  const m = DATA_ISO.exec(valor);
  if (!m) return valor;
  const ano = Number(m[1]);
  const mes = Number(m[2]);
  const dia = Number(m[3]);
  // Date.UTC(ano, mes, 0) e o ultimo dia do mes `mes` (1 a 12), sem depender de fuso.
  const ultimoDia = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
  if (mes < 1 || mes > 12 || dia < 1 || dia > ultimoDia) return valor;
  return `${m[3]}/${m[2]}/${m[1]}`;
}

// Codigo de status -> texto legivel. Aceita 'em_transito', 'Em Transito' e
// 'em-transito'. Sem mapeamento, devolve o texto original.
export function rotuloStatus(codigo: string): string {
  const chave = codigo
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[\s-]+/g, '_');
  return ROTULO_STATUS.get(chave) ?? codigo;
}

// O campo da divergencia escolhe o formatador, em vez de adivinhar pelo
// formato do valor. Peso e volumes saem como estao.
export function formatarValor(campo: CampoVigiado, valor: unknown): string {
  if (valor === undefined || valor === null) return '?';
  const texto = String(valor);
  if (campo === 'previsaoEntrega') return formatarData(texto);
  if (campo === 'status') return rotuloStatus(texto);
  return texto;
}
