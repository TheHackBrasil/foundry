// Adaptadores das portas do operador (spec 0017) sobre o LedgerStore real.
// mcp.ts, webhooks.ts e evidencia.ts definem as portas sem conhecer o banco;
// aqui cada uma vira consulta escopada pelo workspace que o token, o aceite
// do fornecedor ou o registro trazem. O store passado e o raiz: cada leitura
// abre paraWorkspace(ws) e nunca le a seed junto (A2).

import { projetarCasos, projetarTentativas } from '../shared/casos.js';
import { TIPOS_DOCUMENTO, type Evento } from '../shared/model.js';
import { projetar } from '../shared/projection.js';
import type { EstadoKillSwitch } from '../operador/politica.js';
import type { CasoLidoMcp, EscopoTokenMcp, PortaMcp } from '../operador/mcp.js';
import type { PortaDedupeWebhook, PortaTentativasWebhook, PortasWebhook, WebhookAceito } from '../operador/webhooks.js';
import type { PortaEvidencias, RegistroEvidencia } from '../operador/evidencia.js';
import type { LedgerStore } from './store.js';

// casoId = pedidoId:seq (spec 0011). null quando a forma nao bate.
export function pedidoDoCaso(casoId: string): string | null {
  const m = /^(.+):(\d+)$/.exec(casoId);
  return m ? m[1]! : null;
}

const DOCUMENTOS: ReadonlySet<string> = new Set(TIPOS_DOCUMENTO);

// Pergunta fechada do plano mais recente do caso, quando o fluxo a grava no
// payload como codigo (o roteiro preenchido fica fora do ledger, RF25).
function perguntaDoCaso(eventos: readonly Evento[], casoId: string): string | null {
  for (let i = eventos.length - 1; i >= 0; i -= 1) {
    const ev = eventos[i]!;
    if (ev.tipo !== 'contato_planejado') continue;
    const p = ev.payload as { casoId?: unknown; pergunta?: unknown };
    if (p.casoId === casoId && typeof p.pergunta === 'string') return p.pergunta;
  }
  return null;
}

// Projecao do caso para o MCP. Devolve campos a mais do que a lista fechada
// nao precisa; projetarCasoMcp filtra de novo campo a campo.
export async function lerCasoParaMcp(raiz: LedgerStore, workspaceId: string, casoId: string): Promise<CasoLidoMcp | null> {
  const pedidoId = pedidoDoCaso(casoId);
  if (!pedidoId) return null;
  const eventos = await raiz.paraWorkspace(workspaceId).eventosDoPedido(pedidoId);
  const caso = projetarCasos(eventos).find((c) => c.id === casoId);
  if (!caso) return null;
  const campos = projetar(eventos).pedido?.campos ?? {};
  const ultimoDoc = [...eventos].reverse().find((e) => DOCUMENTOS.has(e.tipo));
  return {
    statusCaso: caso.status,
    chaveNota: pedidoId,
    abertoEm: caso.abertoEm,
    previsaoEntrega: campos.previsaoEntrega ?? null,
    ultimaAtualizacaoEm: ultimoDoc?.ts ?? null,
    statusPedido: campos.status ?? null,
    perguntaPendente: perguntaDoCaso(eventos, casoId),
  };
}

// Token revogado: a tentativa nao existe no caso, ja concluiu (ligacao_
// concluida) ou terminou sem efeito. So iniciada e aceita seguem valendo.
export async function tentativaMcpRevogada(raiz: LedgerStore, escopo: EscopoTokenMcp): Promise<boolean> {
  const pedidoId = pedidoDoCaso(escopo.casoId);
  if (!pedidoId) return true;
  const eventos = await raiz.paraWorkspace(escopo.workspaceId).eventosDoPedido(pedidoId);
  const t = projetarTentativas(eventos).find((x) => x.chave === escopo.tentativa);
  if (!t || t.casoId !== escopo.casoId) return true;
  return t.estado !== 'iniciada' && t.estado !== 'aceita';
}

export function portaMcpDoStore(raiz: LedgerStore): PortaMcp {
  return {
    lerCaso: (workspaceId, casoId) => lerCasoParaMcp(raiz, workspaceId, casoId),
    tentativaRevogada: (escopo) => tentativaMcpRevogada(raiz, escopo),
  };
}

// Webhook (RF17): o id externo do contato_aceito e a unica ponte para
// workspace, pedido e caso. Ambiguo (dois aceites) ou sem caso: null, e a
// rota responde 404 sem gravar nada.
export function portaTentativasWebhookDoStore(raiz: LedgerStore): PortaTentativasWebhook {
  return {
    async porIdExterno(fornecedor, idExterno) {
      const aceites = await raiz.aceitesPorIdExterno(fornecedor, idExterno);
      if (aceites.length !== 1) return null;
      const a = aceites[0]!;
      const eventos = await raiz.paraWorkspace(a.workspaceId).eventosDoPedido(a.pedidoId);
      const t = projetarTentativas(eventos).find((x) => x.chave === a.chave);
      if (!t?.casoId) return null;
      return { workspaceId: a.workspaceId, pedidoId: a.pedidoId, casoId: t.casoId, chave: a.chave };
    },
  };
}

export function portaDedupeWebhookDoStore(raiz: LedgerStore): PortaDedupeWebhook {
  return {
    registrarSeInedito: (fornecedor, idEvento) => raiz.registrarWebhookSeInedito(fornecedor, idEvento),
    esquecer: (fornecedor, idEvento) => raiz.esquecerWebhook(fornecedor, idEvento),
  };
}

export function portasWebhookDoStore(raiz: LedgerStore, aoReceber: (evento: WebhookAceito) => Promise<void>): PortasWebhook {
  return { tentativas: portaTentativasWebhookDoStore(raiz), dedupe: portaDedupeWebhookDoStore(raiz), aoReceber };
}

// Evidencia (RF25): grava no workspace do registro, idempotente por
// (workspace, hash), com apagar_em para o job de retencao.
export function portaEvidenciasDoStore(raiz: LedgerStore): PortaEvidencias {
  return {
    gravar: (r: RegistroEvidencia) => raiz.paraWorkspace(r.workspaceId).guardarEvidencia(r.hash, r.tipo, r.conteudo, r.apagarEm),
  };
}

// Kill switch (RF10): o operador chama antes de cada efeito externo e passa
// o resultado para avaliarPolitica.
export function lerKillSwitchOperador(raiz: LedgerStore): Promise<EstadoKillSwitch> {
  return raiz.lerKillSwitch();
}

// true quando nenhum efeito pode sair neste workspace agora.
export async function efeitoBloqueado(raiz: LedgerStore, workspaceId: string): Promise<boolean> {
  const k = await raiz.lerKillSwitch();
  return k.global || k.workspaces.includes(workspaceId);
}
