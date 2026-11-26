// Pendencia por tempo e por documento esperado (specs 0010/0011): o
// verificador roda em tick e abre 'pendencia_aberta' — que na projecao vira
// caso como qualquer divergencia. Idempotente por (pedido, motivo).

import { randomUUID } from 'node:crypto';
import { projetarCasos } from '../shared/casos.js';
import { consolidarCampos, camposPorFonte } from '../shared/projection.js';
import { TIPOS_DOCUMENTO, type Caso, type Evento } from '../shared/model.js';
import { configCobrancaDoEnv, criarCobrancaParaPendencia, enviarCobranca } from './cobranca.js';
import type { LedgerStore } from './store.js';
import type { CanalSSE } from './sse.js';

export interface ConfigPendencia {
  horasSemAtualizacao: number; // PENDENCIA_HORAS, default 24
}

export function configPendenciaDoEnv(): ConfigPendencia {
  const h = Number(process.env['PENDENCIA_HORAS']);
  return { horasSemAtualizacao: Number.isFinite(h) && h > 0 ? h : 24 };
}

// Spec 0017, RF20: com OPERADOR_ATIVO=1 e o workspace em OPERADOR_WORKSPACES
// (lista separada por virgula), o operador e o unico que contata a
// transportadora; COBRANCA_AUTO e NVOIP_NOTIFY_ON_TASK nao enviam nada em
// paralelo nesse workspace.
export function operadorAtivoNoWorkspace(
  workspace: string,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (env['OPERADOR_ATIVO']?.trim() !== '1') return false;
  const lista = (env['OPERADOR_WORKSPACES'] ?? '').split(',').map((w) => w.trim());
  return lista.includes(workspace);
}

interface PendenciaDetectada {
  motivo: string;
  detalhe: string;
}

const TIPOS_DOC = new Set<string>(TIPOS_DOCUMENTO);

// Spec 0017, RF6: atualizacao do pedido e so documento recebido. Evento
// derivado (mandato, notificacao, caso_*, pendencia_aberta) e evento do
// operador nao renovam a ultima atualizacao.
export function eventosDeDocumento(eventos: Evento[]): Evento[] {
  return eventos.filter((e) => TIPOS_DOC.has(e.tipo));
}

// Pedido entregue ou cancelado por alguma fonte: nao abre pendencia por
// tempo nem pede status a transportadora.
const STATUS_ENCERRADO = new Set<string | undefined>(['entregue', 'cancelada']);

function pedidoEncerrado(eventos: Evento[]): boolean {
  return STATUS_ENCERRADO.has(consolidarCampos(camposPorFonte(eventos)).status);
}

// Regras de pendencia por pedido (spec 0011, RF9):
// - sem_atualizacao: ultimo documento mais velho que o limite
// - cte_sem_nfe: CT-e presente sem NF-e alem do limite
// - entrega_sem_confirmacao: previsao passou e nenhuma fonte disse 'entregue'
export function detectarPendencias(
  eventos: Evento[],
  agora: Date,
  limiteHoras: number,
): PendenciaDetectada[] {
  const docs = eventosDeDocumento(eventos);
  if (docs.length === 0) return [];
  const limiteMs = limiteHoras * 3_600_000;
  const primeiro = new Date(docs[0]!.ts);
  const ultimo = new Date(docs[docs.length - 1]!.ts);
  const tipos = new Set(docs.map((e) => e.tipo));
  const campos = consolidarCampos(camposPorFonte(docs));
  const idade = (d: Date) => agora.getTime() - d.getTime() > limiteMs;
  const encerrado = STATUS_ENCERRADO.has(campos.status);

  const out: PendenciaDetectada[] = [];
  if (!encerrado && idade(ultimo)) {
    out.push({
      motivo: 'sem_atualizacao',
      detalhe: `pedido sem evento novo ha mais de ${limiteHoras}h`,
    });
  }
  if (tipos.has('cte') && !tipos.has('nfe') && idade(primeiro)) {
    out.push({
      motivo: 'cte_sem_nfe',
      detalhe: 'CT-e presente sem a NF-e correspondente',
    });
  }
  const prev = campos.previsaoEntrega ? Date.parse(campos.previsaoEntrega) : NaN;
  if (!encerrado && !Number.isNaN(prev) && agora.getTime() > prev) {
    out.push({
      motivo: 'entrega_sem_confirmacao',
      detalhe: `previsao ${campos.previsaoEntrega} passou sem status de entrega`,
    });
  }
  return out;
}

// Spec 0017, RF13: a cobranca so nasce com caso de pendencia aberto (status
// diferente de 'resolvido' na projecao) e uma vez por caso, ligada a ele
// pelo caso_id (T705). Caso que ja teve a sua (respondida, expirada,
// erro_envio ou ainda aberta) nao ganha outra; caso novo ganha a primeira.
// Pedido entregue ou cancelado nao pede status.
export async function casoSemCobranca(
  store: LedgerStore,
  pedidoId: string,
  eventos: Evento[],
): Promise<Caso | null> {
  if (pedidoEncerrado(eventos)) return null;
  const abertos = projetarCasos(eventos).filter((c) => c.origem === 'pendencia' && c.status !== 'resolvido');
  for (const caso of abertos) {
    if (!(await store.cobrancaDoCaso(pedidoId, caso.id, caso.abertoEm))) return caso;
  }
  return null;
}

// Expira as cobrancas vencidas e grava cobranca_expirada no pedido de cada
// uma (spec 0017, T712), na mesma transacao: o status e o evento mudam
// juntos. Payload so com ids.
export async function expirarCobrancasComEvento(store: LedgerStore, agora: Date): Promise<Evento[]> {
  return store.transaction(async (tx) => {
    const eventos: Evento[] = [];
    for (const c of await tx.expirarCobrancas(agora)) {
      eventos.push(
        await tx.append(c.pedidoId, 'cobranca_expirada', {
          cobrancaId: c.id,
          ...(c.casoId ? { casoId: c.casoId } : {}),
        }),
      );
    }
    return eventos;
  });
}

// Uma rodada num workspace: abre pendencia so onde ainda nao existe.
export async function verificarWorkspace(
  store: LedgerStore,
  canal: CanalSSE,
  agora = new Date(),
  config = configPendenciaDoEnv(),
): Promise<number> {
  const pedidos = await store.listarPedidos();
  const cobCfg = configCobrancaDoEnv();
  const enviarSozinho = cobCfg.auto && !operadorAtivoNoWorkspace(store.workspace);
  let abertas = 0;
  for (const p of pedidos) {
    if (p.workspaceId !== store.workspace) continue;
    const eventos = await store.eventosDoPedido(p.pedidoId);
    const novos: Evento[] = [];
    for (const pend of detectarPendencias(eventos, agora, config.horasSemAtualizacao)) {
      if (await store.pendenciaExiste(p.pedidoId, pend.motivo)) continue;
      const ev = await store.append(p.pedidoId, 'pendencia_aberta', {
        motivo: pend.motivo,
        detalhe: pend.detalhe,
        token: randomUUID(),
      });
      canal.evento(ev, store.workspace);
      abertas += 1;
      novos.push(ev);
    }
    // spec 0010: caso de pendencia aberto tambem sugere cobranca de status a
    // transportadora, uma por caso (RF13 da 0017). Com COBRANCA_AUTO=1 o
    // envio sai sem aprovacao humana; default deixa pendente para o operador.
    // Com o operador ativo no workspace, a cobranca nasce mas nao sai (RF20).
    // `novos` entra na projecao porque `eventos` foi lida antes dos appends.
    const caso = await casoSemCobranca(store, p.pedidoId, [...eventos, ...novos]);
    if (caso) {
      const { cobranca, criada } = await criarCobrancaParaPendencia(store, p.pedidoId, cobCfg.expiraHoras, caso.id);
      if (criada && enviarSozinho && cobranca.status === 'pendente') {
        const r = await enviarCobranca(store, cobranca);
        if (r.evento) canal.evento(r.evento, store.workspace);
      }
    }
  }
  // Cobrancas sem resposta expiram: a pendencia segue visivel, o reenvio e
  // manual e respeita a janela (RF5, caso de borda da spec).
  for (const ev of await expirarCobrancasComEvento(store, agora)) canal.evento(ev, store.workspace);
  return abertas;
}

// Tick global: cada workspace com eventos e verificado em sequencia.
export async function verificarPendencias(
  store: LedgerStore,
  canal: CanalSSE,
  agora = new Date(),
): Promise<number> {
  const workspaces = await store.workspacesAtivos();
  let total = 0;
  for (const ws of workspaces) {
    total += await verificarWorkspace(store.paraWorkspace(ws), canal, agora);
  }
  return total;
}

// Liga o tick no boot do servidor: primeira rodada imediata, depois a cada
// PENDENCIA_TICK_MS (default 5 min). Devolve funcao de parada para testes.
export function iniciarTickPendencias(store: LedgerStore, canal: CanalSSE): () => void {
  const tickMs = Number(process.env['PENDENCIA_TICK_MS']) || 5 * 60_000;
  let parado = false;
  const rodar = () => {
    if (parado) return;
    verificarPendencias(store, canal).catch((e) =>
      console.error(`pendencias: tick falhou (${e instanceof Error ? e.message : e})`),
    );
  };
  rodar();
  const timer = setInterval(rodar, tickMs);
  timer.unref?.();
  return () => {
    parado = true;
    clearInterval(timer);
  };
}
