// Pendencia por tempo e por documento esperado (specs 0010/0011): o
// verificador roda em tick e abre 'pendencia_aberta' — que na projecao vira
// caso como qualquer divergencia. Idempotente por (pedido, motivo).

import { randomUUID } from 'node:crypto';
import { consolidarCampos, camposPorFonte } from '../shared/projection.js';
import type { Evento } from '../shared/model.js';
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

interface PendenciaDetectada {
  motivo: string;
  detalhe: string;
}

// Regras de pendencia por pedido (spec 0011, RF9):
// - sem_atualizacao: ultimo evento mais velho que o limite
// - cte_sem_nfe: CT-e presente sem NF-e alem do limite
// - entrega_sem_confirmacao: previsao passou e nenhuma fonte disse 'entregue'
export function detectarPendencias(
  eventos: Evento[],
  agora: Date,
  limiteHoras: number,
): PendenciaDetectada[] {
  if (eventos.length === 0) return [];
  const limiteMs = limiteHoras * 3_600_000;
  const primeiro = new Date(eventos[0]!.ts);
  const ultimo = new Date(eventos[eventos.length - 1]!.ts);
  const tipos = new Set(eventos.map((e) => e.tipo));
  const campos = consolidarCampos(camposPorFonte(eventos));
  const idade = (d: Date) => agora.getTime() - d.getTime() > limiteMs;
  const encerrado = campos.status === 'entregue' || campos.status === 'cancelada';

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

// Uma rodada num workspace: abre pendencia so onde ainda nao existe.
export async function verificarWorkspace(
  store: LedgerStore,
  canal: CanalSSE,
  agora = new Date(),
  config = configPendenciaDoEnv(),
): Promise<number> {
  const pedidos = await store.listarPedidos();
  const cobCfg = configCobrancaDoEnv();
  let abertas = 0;
  for (const p of pedidos) {
    if (p.workspaceId !== store.workspace) continue;
    const eventos = await store.eventosDoPedido(p.pedidoId);
    let abriuNeste = false;
    for (const pend of detectarPendencias(eventos, agora, config.horasSemAtualizacao)) {
      if (await store.pendenciaExiste(p.pedidoId, pend.motivo)) continue;
      const ev = await store.append(p.pedidoId, 'pendencia_aberta', {
        motivo: pend.motivo,
        detalhe: pend.detalhe,
        token: randomUUID(),
      });
      canal.evento(ev, store.workspace);
      abertas += 1;
      abriuNeste = true;
    }
    // spec 0010: pedido pendente tambem sugere cobranca de status a
    // transportadora (idempotente por pedido). Com COBRANCA_AUTO=1 o envio
    // sai sem aprovacao humana; default deixa pendente para o operador.
    // `abriuNeste` cobre a rodada que acabou de abrir a pendencia: a lista
    // `eventos` foi lida antes dos appends e nao os contem.
    if (abriuNeste || eventos.some((e) => e.tipo === 'pendencia_aberta')) {
      const { cobranca, criada } = await criarCobrancaParaPendencia(store, p.pedidoId, cobCfg.expiraHoras);
      if (criada && cobCfg.auto && cobranca.status === 'pendente') {
        await enviarCobranca(store, cobranca);
      }
    }
  }
  // Cobrancas sem resposta expiram: a pendencia segue visivel, o reenvio e
  // manual e respeita a janela (RF5, caso de borda da spec).
  await store.expirarCobrancas(agora);
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
