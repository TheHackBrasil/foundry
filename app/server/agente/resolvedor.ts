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

// Referencia aproximada (sufixo de chave ou nome de emitente) so vale com
// texto suficiente: abaixo disso e palpite, e uma ferramenta de escrita
// nao pode mirar um pedido por palpite (revisao da onda 2, D-047).
const MIN_ALVO_APROXIMADO = 4;

type Tentativa =
  | { tipo: 'resolvido'; pedido: PedidoResolvido }
  | { tipo: 'ambigua'; candidatos: string[] }
  | { tipo: 'sem_match' };

async function tentarResolver(sessao: LedgerStore, ref: string | undefined, padrao: string | undefined): Promise<Tentativa> {
  const alvo = (ref?.trim() || padrao?.trim()) ?? '';
  if (alvo === '') return { tipo: 'sem_match' };

  const dono = await sessao.wsDoPedido(alvo);
  if (dono !== null) return { tipo: 'resolvido', pedido: await carregarPedido(sessao, alvo, dono) };

  if (alvo.length < MIN_ALVO_APROXIMADO) return { tipo: 'sem_match' };

  const lista = await sessao.listarPedidos();
  // Sufixo estrito da chave: o operador cita os ultimos digitos; substring
  // solta casaria no meio do id e erraria o pedido em silencio.
  const porSufixo = lista.filter((p) => p.pedidoId.endsWith(alvo));
  if (porSufixo.length > 1) return { tipo: 'ambigua', candidatos: porSufixo.map((p) => p.pedidoId) };
  const unicoSufixo = porSufixo[0];
  if (unicoSufixo) {
    return { tipo: 'resolvido', pedido: await carregarPedido(sessao, unicoSufixo.pedidoId, unicoSufixo.workspaceId) };
  }

  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const alvoNorm = norm(alvo);
  const porEmitente: PedidoResolvido[] = [];
  for (const p of lista) {
    const r = await carregarPedido(sessao, p.pedidoId, p.workspaceId);
    const emitente = r.projecao.pedido?.emitente.nome ?? '';
    if (emitente !== '' && emitente !== '?' && emitente !== 'a confirmar' && norm(emitente).includes(alvoNorm)) {
      porEmitente.push(r);
    }
  }
  if (porEmitente.length > 1) return { tipo: 'ambigua', candidatos: porEmitente.map((r) => r.pedidoId) };
  const unicoEmitente = porEmitente[0];
  if (unicoEmitente) return { tipo: 'resolvido', pedido: unicoEmitente };
  return { tipo: 'sem_match' };
}

// Resolve a referencia do usuario a um pedido visivel: id exato, sufixo da
// chave (o operador cita os ultimos digitos) ou trecho do nome do emitente
// sem acento e sem caixa. Sem ref, cai no pedido em foco da conversa.
// Ambiguidade retorna null: melhor pedir de novo do que chutar o pedido.
export async function resolverPedido(
  sessao: LedgerStore,
  ref?: string,
  padrao?: string,
): Promise<PedidoResolvido | null> {
  const t = await tentarResolver(sessao, ref, padrao);
  return t.tipo === 'resolvido' ? t.pedido : null;
}

export type ResultadoResolucao = { resolvido: PedidoResolvido } | { falha: ResultadoTool };

export async function pedidoDaTool(ctx: ContextoTools, ref: string | undefined): Promise<ResultadoResolucao> {
  const t = await tentarResolver(ctx.sessao, ref, ctx.pedidoIdPadrao);
  if (t.tipo === 'ambigua') {
    const caudas = t.candidatos.map((c) => c.slice(-6)).join(', ');
    return {
      falha: erro(
        'pedido_ambiguo',
        `Essa referencia casa com mais de um pedido (terminados em ${caudas}). Me passe a chave completa ou mais digitos.`,
        'Referência ambígua',
      ),
    };
  }
  if (t.tipo !== 'resolvido') {
    return {
      falha: erro(
        'pedido_nao_encontrado',
        'Nao encontrei esse pedido na sessao nem nos exemplos. Peca a chave, os ultimos digitos ou o nome do fornecedor.',
        'Pedido não localizado',
      ),
    };
  }
  return { resolvido: t.pedido };
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
