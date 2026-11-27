// Compositor deterministico da entrada (spec 0016): uma sequencia curta de
// insights, um por vez, montada por funcao pura sobre os GETs que a torre
// ja usa (pedidos, casos, metricas). Sem LLM: zero custo e zero latencia
// de modelo na demo publica. Insight sem dado suficiente nao entra na
// sequencia; sequencia vazia devolve o visitante ao estado vazio da torre.

import type { AlvoFocoGenUI, Metricas, Parte } from '../../shared/model.ts';
import { estimarCusto } from '../../shared/custo.ts';
import { deduplicarPedidos, type PedidoResumo } from './api.ts';
import { chaveCurta, formatarValor, rotuloCampo, rotuloFonte, rotuloParte } from './format.ts';
import type { CasoLista } from './operacao/dominio.ts';

export type IdInsight = 'divergencias' | 'atraso' | 'tarefas' | 'risco' | 'excecao';

export interface Insight {
  id: IdInsight;
  titulo: string;
  texto: string;
  // Todo insight leva a um pedido (decisao 3 da spec); o foco dentro do
  // painel so existe quando a fonte tem um alvo exato (AlvoFocoGenUI).
  pedidoId: string;
  foco?: AlvoFocoGenUI;
  // A7: agregado financeiro e estimativa declarada, nunca custo medido.
  simulacao?: boolean;
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

const FMT_BRL = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
  maximumFractionDigits: 0,
});

// O pedido sobe em duplicidade quando o visitante reenvia o exemplo na
// propria sessao: vale a copia da sessao, nao a da seed. Sem workspace o
// dedup fica deterministico pela primeira ocorrencia.
function unicos(pedidos: readonly PedidoResumo[]): PedidoResumo[] {
  return deduplicarPedidos(pedidos, pedidos.find((p) => p.daSessao)?.workspaceId);
}

const nomePedido = (resumo: PedidoResumo | undefined, pedidoId: string): string =>
  resumo?.emitente?.trim() || chaveCurta(pedidoId);

// O insight ancora no caso mais urgente: contestado pede decisao, depois
// aberto (mais antigo primeiro), depois atribuido; resolvido so entra se
// nao houver outro. Mesma urgencia da fila da #/operacao.
const URGENCIA: Record<CasoLista['status'], number> = {
  contestado: 0,
  aberto: 1,
  atribuido: 2,
  resolvido: 3,
};

function maisUrgente(casos: readonly CasoLista[]): CasoLista | undefined {
  return [...casos].sort(
    (a, b) => URGENCIA[a.status] - URGENCIA[b.status] || a.abertoEm.localeCompare(b.abertoEm),
  )[0];
}

function insightDivergencias(pedidos: PedidoResumo[], casos: readonly CasoLista[]): Insight | null {
  const total = pedidos.reduce((acc, p) => acc + (p.divergencias ?? 0), 0);
  if (total === 0) return null;
  const caso = maisUrgente(casos.filter((c) => c.origem === 'divergencia' && c.divergencia));
  const alvoId =
    caso?.pedidoId ??
    [...pedidos].sort((a, b) => (b.divergencias ?? 0) - (a.divergencias ?? 0))[0]!.pedidoId;
  const resumo = pedidos.find((p) => p.pedidoId === alvoId);
  const d = caso?.divergencia;
  const afetados = pedidos.filter((p) => (p.divergencias ?? 0) > 0).length;
  const texto = d
    ? d.tipo === 'mudanca'
      ? `${nomePedido(resumo, alvoId)}: ${rotuloFonte(d.fonteA)} mudou ${rotuloCampo(d.campo)} de versão.`
      : `${nomePedido(resumo, alvoId)}: ${rotuloFonte(d.fonteA)} declara ${formatarValor(d.campo, d.valorA)} em ${rotuloCampo(d.campo)} e ${rotuloFonte(d.fonteB)}, ${formatarValor(d.campo, d.valorB)}.`
    : `${plural(afetados, 'pedido afetado', 'pedidos afetados')} pelas fontes que se contradizem.`;
  return {
    id: 'divergencias',
    titulo: `${total} ${total === 1 ? 'divergência' : 'divergências'} entre as fontes`,
    texto,
    pedidoId: alvoId,
    ...(d
      ? { foco: { tipo: 'divergencia', campo: d.campo, fonteA: d.fonteA, fonteB: d.fonteB } as const }
      : {}),
  };
}

function insightAtraso(pedidos: PedidoResumo[], casos: readonly CasoLista[]): Insight | null {
  const com = pedidos.filter((p) => (p.atrasoDias ?? 0) > 0);
  if (com.length === 0) return null;
  const maior = com.reduce((a, b) => ((b.atrasoDias ?? 0) > (a.atrasoDias ?? 0) ? b : a));
  const dias = maior.atrasoDias ?? 0;
  // Foco na divergencia de previsao quando o caso dela existe; sem caso, o
  // CTA ainda leva ao pedido e o painel mostra a matriz inteira.
  const d = casos.find(
    (c) =>
      c.pedidoId === maior.pedidoId &&
      c.origem === 'divergencia' &&
      c.divergencia?.campo === 'previsaoEntrega',
  )?.divergencia;
  return {
    id: 'atraso',
    titulo: plural(com.length, 'pedido em atraso', 'pedidos em atraso'),
    texto: `Em ${nomePedido(maior, maior.pedidoId)}, a distância entre as datas declaradas chega a ${plural(dias, 'dia', 'dias')}.`,
    pedidoId: maior.pedidoId,
    ...(d
      ? { foco: { tipo: 'divergencia', campo: d.campo, fonteA: d.fonteA, fonteB: d.fonteB } as const }
      : {}),
  };
}

function insightTarefas(pedidos: PedidoResumo[], casos: readonly CasoLista[]): Insight | null {
  const total = pedidos.reduce((acc, p) => acc + (p.tarefas ?? 0), 0);
  if (total === 0) return null;
  const alvo = [...pedidos].sort((a, b) => (b.tarefas ?? 0) - (a.tarefas ?? 0))[0]!;
  // Setor com mais casos em aberto ja com dono: e o unico recorte por parte
  // que os GETs de hoje trazem (tarefa individual por setor nao sai na lista).
  const porParte = new Map<Parte, number>();
  for (const c of casos) {
    if (c.donoPapel && c.status !== 'resolvido') {
      porParte.set(c.donoPapel, (porParte.get(c.donoPapel) ?? 0) + 1);
    }
  }
  const lider = [...porParte.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  return {
    id: 'tarefas',
    titulo: plural(total, 'tarefa aberta', 'tarefas abertas'),
    texto: lider
      ? `A maioria das decisões em aberto está com ${rotuloParte(lider)}.`
      : 'Cada divergência já gerou a tarefa do setor que decide.',
    pedidoId: alvo.pedidoId,
    ...(lider ? { foco: { tipo: 'parte', parte: lider } as const } : {}),
  };
}

function insightRisco(casos: readonly CasoLista[]): Insight | null {
  const abertos = casos.filter((c) => c.status !== 'resolvido');
  if (abertos.length === 0) return null;
  const estimativas = abertos.map((caso) => ({ caso, est: estimarCusto(caso) }));
  const total = estimativas.reduce((acc, e) => acc + e.est.valor, 0);
  if (!(total > 0)) return null;
  const maior = estimativas.reduce((a, b) => (b.est.valor > a.est.valor ? b : a));
  const d = maior.caso.origem === 'divergencia' ? maior.caso.divergencia : undefined;
  return {
    id: 'risco',
    titulo: `${FMT_BRL.format(total)} em custo de exceção`,
    texto: `Estimativa sobre ${plural(abertos.length, 'caso aberto', 'casos abertos')}: doca ociosa, remanejamento e multa por dia de atraso.`,
    pedidoId: maior.caso.pedidoId,
    simulacao: true,
    ...(d
      ? { foco: { tipo: 'divergencia', campo: d.campo, fonteA: d.fonteA, fonteB: d.fonteB } as const }
      : {}),
  };
}

function insightExcecao(
  pedidos: PedidoResumo[],
  casos: readonly CasoLista[],
  metricas: Metricas | null,
): Insight | null {
  if (!metricas || metricas.pedidosComExcecao === 0) return null;
  const alvoId = maisUrgente(casos)?.pedidoId ?? pedidos[0]?.pedidoId;
  if (!alvoId) return null;
  const partes: string[] = [];
  if (metricas.casosAbertos > 0) partes.push(plural(metricas.casosAbertos, 'caso em aberto', 'casos em aberto'));
  if (metricas.casosResolvidos > 0) partes.push(plural(metricas.casosResolvidos, 'resolvido', 'resolvidos'));
  if (metricas.casosContestados > 0) partes.push(plural(metricas.casosContestados, 'contestado', 'contestados'));
  return {
    id: 'excecao',
    titulo: `${Math.round(metricas.taxaExcecao * 100)}% dos pedidos têm exceção`,
    texto: partes.length > 0 ? `${partes.join(', ')}.` : 'Nenhum caso pede decisão agora.',
    pedidoId: alvoId,
  };
}

// Ordem fixa por prioridade: prova do produto (divergencia), consequencia
// (atraso), trabalho gerado (tarefas), dinheiro (risco) e escala (excecao).
// O insight de sinais fica de fora: Sinal so existe na projecao por pedido
// e fanout de GETs por pedido esta fora de escopo na spec.
export function comporInsights(
  pedidosEntrada: readonly PedidoResumo[],
  casos: readonly CasoLista[],
  metricas: Metricas | null,
): Insight[] {
  const pedidos = unicos(pedidosEntrada);
  const seq: Array<Insight | null> = [
    insightDivergencias(pedidos, casos),
    insightAtraso(pedidos, casos),
    insightTarefas(pedidos, casos),
    insightRisco(casos),
    insightExcecao(pedidos, casos, metricas),
  ];
  return seq.filter((i): i is Insight => i !== null);
}
