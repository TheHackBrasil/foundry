// Resolucao de referencias de pedido (id exato, sufixo da chave, nome do
// emitente sem acento nem caixa) e a recusa padrao para pedidos da seed,
// que sao leitura compartilhada para todo workspace (A9).

import type { Parte, TipoBlocoGenUI } from '../../shared/model.js';
import { projetar } from '../../shared/projection.js';
import type { LedgerStore } from '../store.js';
import type { ContextoTools, PedidoResolvido, ResultadoTool } from './tipos.js';
import { erro } from './validacao.js';

export type { PedidoResolvido };

async function carregarPedido(sessao: LedgerStore, pedidoId: string, workspaceId: string): Promise<PedidoResolvido> {
  const leitor = sessao.paraWorkspace(workspaceId);
  return { pedidoId, workspaceId, projecao: projetar(await leitor.eventosDoPedido(pedidoId)) };
}

// Resolve a referencia do usuario a um pedido visivel: id exato, sufixo da
// chave (o operador cita os ultimos digitos) ou trecho do nome do emitente
// sem acento e sem caixa. Sem ref, cai no pedido em foco da conversa.
export async function resolverPedido(
  sessao: LedgerStore,
  ref?: string,
  padrao?: string,
): Promise<PedidoResolvido | null> {
  const alvo = (ref?.trim() || padrao?.trim()) ?? '';
  if (alvo === '') return null;

  const dono = await sessao.wsDoPedido(alvo);
  if (dono !== null) return carregarPedido(sessao, alvo, dono);

  const lista = await sessao.listarPedidos();
  const cauda = Math.max(alvo.length, 6);
  const porSufixo = lista.filter((p) => p.pedidoId.slice(-cauda).includes(alvo));
  const primeiro = porSufixo[0];
  if (primeiro) return carregarPedido(sessao, primeiro.pedidoId, primeiro.workspaceId);

  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const alvoNorm = norm(alvo);
  for (const p of lista) {
    const r = await carregarPedido(sessao, p.pedidoId, p.workspaceId);
    const emitente = r.projecao.pedido?.emitente.nome ?? '';
    if (emitente !== '' && emitente !== '?' && emitente !== 'a confirmar' && norm(emitente).includes(alvoNorm)) {
      return r;
    }
  }
  return null;
}

export type ResultadoResolucao = { resolvido: PedidoResolvido } | { falha: ResultadoTool };

export async function pedidoDaTool(ctx: ContextoTools, ref: string | undefined): Promise<ResultadoResolucao> {
  const r = await resolverPedido(ctx.sessao, ref, ctx.pedidoIdPadrao);
  if (!r) {
    return {
      falha: erro(
        'pedido_nao_encontrado',
        'Nao encontrei esse pedido na sessao nem nos exemplos. Peca a chave, os ultimos digitos ou o nome do fornecedor.',
        'Pedido não localizado',
      ),
    };
  }
  return { resolvido: r };
}

const MENSAGEM_SEED =
  'Este pedido e somente leitura (exemplo publico). Envie os arquivos na sua sessao para comandar de verdade.';

export function seedSomenteLeitura(): ResultadoTool {
  return erro('seed_somente_leitura', MENSAGEM_SEED, 'Pedido de exemplo: somente leitura');
}

// Mesma recusa, ja com o contexto do pedido: o modelo explica o bloqueio
// com chave e parte na mao, e o GenUI ainda compoe a visao do exemplo.
export function recusaSeedSomenteLeitura(opcoes: {
  pedidoId: string;
  parte?: Parte;
  blocos?: TipoBlocoGenUI[];
}): ResultadoTool {
  const base = seedSomenteLeitura();
  return {
    ...base,
    dados: {
      ...base.dados,
      pedidoId: opcoes.pedidoId,
      ...(opcoes.parte ? { parte: opcoes.parte } : {}),
    },
    pedidoIdResolvido: opcoes.pedidoId,
    ...(opcoes.blocos ? { blocosSugeridos: opcoes.blocos } : {}),
  };
}
