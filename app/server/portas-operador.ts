// Adaptadores das portas do operador (spec 0017) sobre o LedgerStore real.
// mcp.ts, webhooks.ts e evidencia.ts definem as portas sem conhecer o banco;
// aqui cada uma vira consulta escopada pelo workspace que o token, o aceite
// do fornecedor ou o registro trazem. O store passado e o raiz: cada leitura
// abre paraWorkspace(ws) e nunca le a seed junto (A2).

import { projetarCasos, projetarPlanosContato, projetarTentativas, type PlanoContatoProjetado } from '../shared/casos.js';
import { TIPOS_DOCUMENTO, type Evento } from '../shared/model.js';
import { projetar } from '../shared/projection.js';
import {
  CANAIS_COM_APROVACAO,
  normalizarTelefoneE164,
  type ContadoresPolitica,
  type EstadoKillSwitch,
} from '../operador/politica.js';
import type { EstadoCasoFluxo, PortasFluxo } from '../operador/fluxo/caso.js';
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

// --- Portas do fluxo do caso (spec 0017, T724 a T751) ---

const HORA_MS = 3_600_000;
const DIA_MS = 24 * HORA_MS;
// America/Sao_Paulo sem horario de verao desde 2019: UTC-3 o ano todo
// (o mesmo que politica.ts assume para a janela).
const OFFSET_SP_MS = -3 * HORA_MS;

export function inicioDoDiaSaoPaulo(agoraMs: number): number {
  return Math.floor((agoraMs + OFFSET_SP_MS) / DIA_MS) * DIA_MS - OFFSET_SP_MS;
}

// Contadores da politica (RF9) a partir dos contato_iniciado: tentativas do
// dia por destino E.164 somando workspaces, gasto do caso e gasto do dia.
// O custo e a estimativa gravada na intencao (A7), reservada antes do efeito.
export async function contadoresDoStore(
  raiz: LedgerStore,
  consulta: { workspace: string; casoId: string; destinoE164: string | null; agoraMs: number },
): Promise<ContadoresPolitica> {
  const inicioDia = inicioDoDiaSaoPaulo(consulta.agoraMs);
  const linhas = await raiz.intencoesParaContadores(new Date(inicioDia).toISOString(), consulta.workspace, consulta.casoId);
  const hoje = linhas.filter((l) => Date.parse(l.ts) >= inicioDia);
  let tentativasHojeDestino = 0;
  if (consulta.destinoE164) {
    const porTelefone = hoje.filter((l) => l.contatoId !== null && (CANAIS_COM_APROVACAO as readonly string[]).includes(l.canal ?? ''));
    const destinos = await raiz.destinosDosContatos(porTelefone.map((l) => l.contatoId!));
    tentativasHojeDestino = porTelefone.filter((l) => normalizarTelefoneE164(destinos.get(l.contatoId!) ?? '') === consulta.destinoE164).length;
  }
  const doCaso = linhas.filter((l) => l.workspaceId === consulta.workspace && l.casoId === consulta.casoId);
  const soma = (ls: typeof linhas): number => ls.reduce((a, l) => a + l.custo, 0);
  return { tentativasHojeDestino, gastoCasoBrl: soma(doCaso), gastoDiaBrl: soma(hoje) };
}

// Estado do caso relido pelo fluxo ao acordar (o ledger e a fonte). A
// declaracao aprovada na revisao chega como sinal em operador_sinais (RF18):
// lido aqui e marcado, ele reinicia o prazo do degrau uma vez.
export async function estadoCasoDoStore(raiz: LedgerStore, workspace: string, pedidoId: string, casoId: string): Promise<EstadoCasoFluxo> {
  const s = raiz.paraWorkspace(workspace);
  const eventos = await s.eventosDoPedido(pedidoId);
  const caso = projetarCasos(eventos).find((c) => c.id === casoId);
  const casoFechado = !caso || caso.status === 'resolvido';
  const optout = eventos.some((e) => e.tipo === 'contato_optout');
  let declaracao: EstadoCasoFluxo['declaracao'] = 'nenhuma';
  if (await s.declaracaoEmRevisao(pedidoId)) declaracao = 'em_revisao';
  else {
    const sinais = await s.sinaisOperadorPendentes(pedidoId);
    for (const sinal of sinais) await s.marcarSinalLido(sinal.id);
    if (sinais.length > 0) declaracao = 'aceita';
  }
  return { casoFechado, optout, declaracao };
}

export async function planoDoStore(raiz: LedgerStore, workspace: string, pedidoId: string, planoId: string): Promise<PlanoContatoProjetado | null> {
  const eventos = await raiz.paraWorkspace(workspace).eventosDoPedido(pedidoId);
  return projetarPlanosContato(eventos).find((p) => p.planoId === planoId) ?? null;
}

export interface OpcoesPortasServidor {
  raiz: LedgerStore; // store raiz, com o seed certo
  base: PortasFluxo; // portas padrao do modulo (ledger do DBOS)
  destinosPermitidos: readonly string[];
  canais: PortasFluxo['canais'];
  aoEvento?: (evento: Evento, workspace: string) => void; // repasse ao SSE
  agora?: () => number;
  retencaoDias?: number;
}

// Portas reais do fluxo sobre o store do app. O kill switch e lido do banco
// antes de cada efeito (RF10); os eventos gravados pelo fluxo vao ao SSE.
export function portasDoServidor(o: OpcoesPortasServidor): PortasFluxo {
  const retencaoMs = (o.retencaoDias ?? 90) * DIA_MS;
  const agora = o.agora ?? (() => Date.now());
  return {
    ...o.base,
    ledger: {
      ...o.base.ledger,
      async registrar(nome, workspace, pedidoId, eventos) {
        const gravados = await o.base.ledger.registrar(nome, workspace, pedidoId, eventos);
        for (const ev of gravados) o.aoEvento?.(ev, workspace);
        return gravados;
      },
    },
    canais: o.canais,
    killSwitch: () => lerKillSwitchOperador(o.raiz),
    contato: (workspace, parte, canal) => o.raiz.paraWorkspace(workspace).contatoDaParte(parte, canal),
    contadores: (consulta) => contadoresDoStore(o.raiz, consulta),
    destinosPermitidos: async () => o.destinosPermitidos,
    estadoCaso: (workspace, pedidoId, casoId) => estadoCasoDoStore(o.raiz, workspace, pedidoId, casoId),
    planoContato: (workspace, pedidoId, planoId) => planoDoStore(o.raiz, workspace, pedidoId, planoId),
    guardarEvidencia: (workspace, hash, tipo, conteudo) =>
      o.raiz.paraWorkspace(workspace).guardarEvidencia(hash, tipo, conteudo, new Date(agora() + retencaoMs)),
    async nomeEmpresa(workspace, pedidoId) {
      const proj = projetar(await o.raiz.paraWorkspace(workspace).eventosDoPedido(pedidoId));
      return proj.pedido?.emitente.nome ?? null;
    },
    agora,
  };
}
