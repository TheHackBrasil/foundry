// Modelo canonico (spec 0004, RF8): contrato unico server x web.

export type Parte = 'fornecedor' | 'transportadora' | 'cd' | 'fiscal' | 'financeiro';

export const PARTES: readonly Parte[] = [
  'fornecedor',
  'transportadora',
  'cd',
  'fiscal',
  'financeiro',
] as const;

// Origem do documento que entrou na camada (o que cada parceiro ja produz).
export type FonteDocumento = 'nfe' | 'cte' | 'cce' | 'planilha' | 'pdf' | 'imap' | 'manual';

export type TipoEvento =
  | 'nfe'
  | 'cte'
  | 'cce'
  | 'cancelamento'
  | 'planilha'
  | 'pdf'
  | 'divergencia'
  | 'tarefa'
  | 'ancora'
  | 'revisao';

// Tipos que representam um documento recebido (o resto e evento derivado):
// usados para contar documentos por workspace e para ler o fold da projecao.
export const TIPOS_DOCUMENTO = ['nfe', 'cte', 'cce', 'cancelamento', 'planilha', 'pdf'] as const;

// Campos que a camada vigia entre fontes (RF10). Ausente = a fonte nao declara.
export interface CamposObservados {
  previsaoEntrega?: string; // ISO 8601 (YYYY-MM-DD)
  pesoTotal?: number; // kg
  volumes?: number;
  status?: string; // 'emitida' | 'em_transito' | 'entregue' | 'atrasada' | 'cancelada'
}

export const CAMPOS_VIGIADOS = [
  'previsaoEntrega',
  'pesoTotal',
  'volumes',
  'status',
] as const;

export type CampoVigiado = (typeof CAMPOS_VIGIADOS)[number];

export interface ItemPedido {
  descricao: string;
  quantidade: number;
  unidade: string;
  codigo?: string;
}

export interface ContatoDoc {
  cnpj?: string;
  nome: string;
}

// Saida normalizada de qualquer parser: documento vira DocData antes de virar Evento.
export interface DocData {
  fonte: FonteDocumento;
  docTipo: TipoEvento;
  pedidoId: string; // chave de 44 digitos da NF-e ou chave referenciada
  campos: CamposObservados;
  dados: Record<string, unknown>; // payload parseado completo (vai para o ledger)
  confianca?: number; // 0..1, usado pela extracao por LLM (A7: rotulado na UI)
}

// Evento do ledger append-only. hash/prevHash preenchidos na gravacao (chain.ts).
export interface Evento {
  id?: number;
  pedidoId: string;
  seq?: number; // posicao na cadeia do pedido (1..n)
  tipo: TipoEvento;
  payload: Record<string, unknown>;
  ts: string; // ISO 8601
  prevHash: string;
  hash: string;
}

export interface Pedido {
  id: string; // chave de 44 digitos
  emitente: ContatoDoc;
  destinatario: ContatoDoc;
  itens: ItemPedido[];
  campos: CamposObservados; // estado consolidado das fontes
  partes: Parte[];
  criadoEm: string;
}

// Uma versao do pedido por documento recebido (linha do tempo, RF18).
export interface VersaoPedido {
  pedidoId: string;
  versao: number;
  fonte: FonteDocumento;
  campos: CamposObservados;
  geradaEm: string;
}

export interface Divergencia {
  campo: CampoVigiado;
  fonteA: FonteDocumento;
  fonteB: FonteDocumento;
  valorA: unknown;
  valorB: unknown;
}

export interface Tarefa {
  parte: Parte;
  titulo: string;
  detalhe: string;
  divergencia: Divergencia;
}

// Resultado de GET /api/pedidos/:id (projecao do ledger, T024).
export interface ProjecaoPedido {
  pedido: Pedido | null;
  versoes: VersaoPedido[];
  divergencias: Divergencia[];
  tarefas: Tarefa[];
  totalEventos: number;
}

// Contratos de resposta da API (contrato unico server x web, RF8).

export interface ItemRevisao {
  id: number;
  origem: string;
  motivo: string;
  payload: Record<string, unknown>;
  status: 'pendente' | 'aprovado' | 'descartado';
  ts: string;
}

export interface ResultadoIngest {
  pedidoId: string | null;
  docs: number;
  eventos: number;
  revisaoId: number | null;
  ok?: boolean;
}

export interface ResultadoAncora {
  ok: boolean;
  motivo?: string;
  root?: string;
  txHash?: string;
  url?: string;
}

export interface RespostaAuditoria {
  valida: boolean;
  total: number;
  indiceFalha: number | null;
  eventoFalha: Evento | null;
  hashEsperado: string | null;
  hashEncontrado: string | null;
  ancora: Record<string, unknown> | null;
  rootAtual: string;
  rootHistorico: string | null;
  rootConfere: boolean | null;
  eventosAncorados: number | null;
}

export interface RespostaSimulacao {
  divergencias: Divergencia[];
  tarefas: Tarefa[];
  simulacao: true;
}
