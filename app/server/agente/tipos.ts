// Tipos do contrato interno do agente (spec 0009): contexto compartilhado
// das tools, resultado padrao que nunca lanca e a superficie minima do
// cliente LLM que o motor consome (DIP: a implementacao concreta fica em
// llm.ts; em teste entra um cliente de mentira, sem stub global de fetch).

import type { Evento, ProjecaoPedido, TipoBlocoGenUI } from '../../shared/model.js';
import type {
  DefinicaoToolLlm,
  MensagemAgenteLlm,
  OpcoesChatAgente,
  RespostaChatTools,
} from '../llm.js';
import type { LedgerStore } from '../store.js';

export interface ContextoTools {
  sessao: LedgerStore;
  store: LedgerStore;
  seedWs: string;
  pedidoIdPadrao?: string;
  // Pergunta original do usuario: alimenta o evento 'mandato' das escritas,
  // a mesma intencao que o fluxo classico registra (A10).
  texto?: string;
}

export interface ResultadoTool {
  ok: boolean;
  dados: Record<string, unknown>; // serializado como content da role tool
  resumo: string; // uma linha legivel para a trilha de execucao do SSE
  pedidoIdResolvido?: string;
  blocosSugeridos?: TipoBlocoGenUI[];
  // Eventos gravados pelas tools de escrita: a rota republica no canal SSE.
  eventos?: Evento[];
}

export interface ToolAgente {
  nome: string;
  descricao: string;
  schema: Record<string, unknown>; // JSON Schema dos parametros
  validar: (args: unknown) => unknown;
  executar: (ctx: ContextoTools, args: unknown) => Promise<ResultadoTool>;
}

export interface PedidoResolvido {
  pedidoId: string;
  workspaceId: string;
  projecao: ProjecaoPedido;
}

// Superficie minima que o motor precisa da camada LLM: chat com tools e
// sintese final streamada. Qualquer implementacao com essa forma serve;
// OpcoesAgente.llm injeta a dependencia sem acoplar a fetch.
export interface ClienteLlmAgente {
  chatComTools: (
    mensagens: MensagemAgenteLlm[],
    tools: DefinicaoToolLlm[],
    opcoes?: OpcoesChatAgente,
  ) => Promise<RespostaChatTools>;
  chatTextoStream: (
    mensagens: MensagemAgenteLlm[],
    onDelta: (delta: string) => void,
    opcoes?: OpcoesChatAgente,
  ) => Promise<string>;
}
