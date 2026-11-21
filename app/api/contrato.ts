// Contrato HTTP e SSE entre o servidor (app-infra, dona deste arquivo) e a
// web (app-demo). Rascunho de 21/11: a infra ajusta ao implementar e avisa
// a demo no Linear antes de mudar um formato.

import type { FalhaCadeia } from '../shared/chain.ts';
import type { Campo, Evento, Parte, VersaoPedido } from '../shared/model.ts';
import type { Tarefa } from '../shared/rules.ts';

// A seed é compartilhada e só leitura. O upload de cada visitante vai para
// um workspace próprio, criado pela infra e guardado em cookie (RF27).
export const WORKSPACE_SEED = 'seed';
export const COOKIE_WORKSPACE = 'foundry_ws';

export interface Divergencia {
  campo: Campo;
  valores: Partial<Record<Parte, string | number>>;
  tarefas: readonly Tarefa[];
}

export interface PedidoResumo {
  id: string;
  workspaceId: string;
  eventos: number;
  divergencias: number;
}

export interface PedidoDetalhe {
  id: string;
  workspaceId: string;
  eventos: readonly Evento[];
  versoes: readonly VersaoPedido[];
  divergencias: readonly Divergencia[];
}

// GET /api/pedidos            -> PedidoResumo[]
// GET /api/pedidos/:id        -> PedidoDetalhe
// GET /api/pedidos/:id/audit  -> AuditResposta
export type AuditResposta =
  | { ok: true; cabeca: string; eventos: number }
  | { ok: false; seq: number; motivo: FalhaCadeia };

// POST /api/ingest (multipart, um arquivo por requisição) -> IngestResposta
export type IngestResposta =
  | { status: 'ok'; pedidos: string[]; eventos: number }
  | { status: 'rejeitado'; erro: string }
  | { status: 'revisao'; motivo: string };

// GET /api/stream (SSE). Só chegam mensagens do workspace da sessão e da
// seed. A infra manda um comentário de heartbeat a cada 20 s, porque o
// roteador da hospedagem derruba conexão ociosa.
export type MensagemStream =
  | { tipo: 'evento'; pedidoId: string; evento: Evento }
  | { tipo: 'divergencia'; pedidoId: string; divergencia: Divergencia };
