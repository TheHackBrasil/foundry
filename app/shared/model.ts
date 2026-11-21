// Modelo canônico (spec 0004, RF8). Puro: sem I/O, importável por server e web.

export type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [chave: string]: Json };

export const PARTES = ['fornecedor', 'transportadora', 'cd', 'fiscal', 'financeiro'] as const;
export type Parte = (typeof PARTES)[number];

export const CANAIS = ['upload', 'email', 'planilha', 'seed'] as const;
export type Canal = (typeof CANAIS)[number];

// O ledger guarda fatos de entrada. Divergência e tarefa são projeção
// (recalculável), não evento: o que a cadeia prova é o que chegou.
export const TIPOS_EVENTO = ['nfe', 'cte', 'evento_fiscal', 'atraso_informado'] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

// Campos que o motor compara entre fontes (RF10).
export const CAMPOS = ['dataEntrega', 'pesoKg', 'volumes', 'status'] as const;
export type Campo = (typeof CAMPOS)[number];

// Peso e valor entram como string decimal: o hash passa por JSON e float
// perde precisão.
export interface CamposPedido {
  dataEntrega?: string;
  pesoKg?: string;
  volumes?: number;
  status?: string;
}

export interface EventoEntrada {
  // Chave de acesso de 44 dígitos da NF-e.
  pedidoId: string;
  // Isola o upload de cada visitante (regulamento 6.9, RF27). A seed usa
  // o workspace compartilhado e só leitura.
  workspaceId: string;
  tipo: TipoEvento;
  // Quem emitiu o fato e por onde ele chegou.
  autor: Parte;
  canal: Canal;
  // Data do fato conforme o documento, ISO 8601.
  ocorridoEm: string;
  payload: Json;
}

// A cadeia é por pedido: inserções de pedidos diferentes não competem pela
// mesma cabeça. A âncora pública (P1) cobre a cabeça de cada cadeia.
export interface Evento extends EventoEntrada {
  seq: number;
  prevHash: string;
  hash: string;
}

export interface Pedido {
  id: string;
  workspaceId: string;
  eventos: readonly Evento[];
}

// Retrato do pedido segundo uma fonte, até um ponto da cadeia.
export interface VersaoPedido {
  autor: Parte;
  ate: number;
  campos: CamposPedido;
}
