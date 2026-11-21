// Grafo de propagacao deterministico (spec 0004, RF11): divergencia ->
// tarefa por parte, como dado. A simulacao "e se?" (RF12) reusa o mapa.

import type { CampoVigiado, Divergencia, Tarefa } from './model.js';

type Gerador = (d: Divergencia) => Tarefa[];

const fmt = (v: unknown): string => (v === undefined || v === null ? '?' : String(v));

// Para cada campo vigiado, quem faz o que quando duas fontes divergem.
export const REGRAS_PROPAGACAO: Record<CampoVigiado, Gerador> = {
  previsaoEntrega: (d) => [
    {
      parte: 'transportadora',
      titulo: 'Justificar nova data e reestimar ETA',
      detalhe: `Previsao divergente: ${fmt(d.fonteA)} diz ${fmt(d.valorA)}, ${fmt(d.fonteB)} diz ${fmt(d.valorB)}.`,
      divergencia: d,
    },
    {
      parte: 'cd',
      titulo: 'Reagendar janela de recebimento',
      detalhe: `Nova previsao ${fmt(d.valorB)} exige replanejar doca e equipe.`,
      divergencia: d,
    },
    {
      parte: 'fiscal',
      titulo: 'Conferir CC-e emitida para a correcao',
      detalhe: `Verificar se a carta de correcao cobre a mudanca de ${fmt(d.valorA)} para ${fmt(d.valorB)}.`,
      divergencia: d,
    },
    {
      parte: 'financeiro',
      titulo: 'Recalcular SLA e provisionar multa',
      detalhe: `Atraso de ${fmt(d.valorA)} para ${fmt(d.valorB)} pode gerar penalidade contratual.`,
      divergencia: d,
    },
    {
      parte: 'fornecedor',
      titulo: 'Avisar cliente da nova data',
      detalhe: `Comunicar reagendamento: ${fmt(d.valorA)} -> ${fmt(d.valorB)}.`,
      divergencia: d,
    },
  ],
  pesoTotal: (d) => [
    {
      parte: 'transportadora',
      titulo: 'Verificar tara e lotacao do veiculo',
      detalhe: `Peso divergente: ${fmt(d.fonteA)} declara ${fmt(d.valorA)} kg, ${fmt(d.fonteB)} declara ${fmt(d.valorB)} kg.`,
      divergencia: d,
    },
    {
      parte: 'fiscal',
      titulo: 'Checar peso NF-e x CT-e junto ao emissor',
      detalhe: `Divergencia de ${fmt(d.valorA)} kg para ${fmt(d.valorB)} kg pode indicar erro de emissao ou carga extra.`,
      divergencia: d,
    },
    {
      parte: 'financeiro',
      titulo: 'Recalcular frete por peso real',
      detalhe: `Frete cotado sobre ${fmt(d.valorA)} kg; fonte divergente indica ${fmt(d.valorB)} kg.`,
      divergencia: d,
    },
  ],
  volumes: (d) => [
    {
      parte: 'cd',
      titulo: 'Separar conferencia fisica no recebimento',
      detalhe: `Volumes divergentes: ${fmt(d.fonteA)} diz ${fmt(d.valorA)}, ${fmt(d.fonteB)} diz ${fmt(d.valorB)}.`,
      divergencia: d,
    },
    {
      parte: 'transportadora',
      titulo: 'Conferir romaneio contra o documento',
      detalhe: `Romaneio deve bater ${fmt(d.valorA)} volumes ou justificar ${fmt(d.valorB)}.`,
      divergencia: d,
    },
  ],
  status: (d) => [
    {
      parte: 'fiscal',
      titulo: 'Validar mudanca de status junto a SEFAZ',
      detalhe: `Status divergente: ${fmt(d.fonteA)} diz ${fmt(d.valorA)}, ${fmt(d.fonteB)} diz ${fmt(d.valorB)}.`,
      divergencia: d,
    },
    {
      parte: 'financeiro',
      titulo: 'Estornar ou segurar provisao de pagamento',
      detalhe: `Cancelamento ou bloqueio muda a provisao: ${fmt(d.valorA)} -> ${fmt(d.valorB)}.`,
      divergencia: d,
    },
    {
      parte: 'cd',
      titulo: 'Suspender ou liberar operacao de recebimento',
      detalhe: `Status ${fmt(d.valorB)} pode exigir devolucao ou guarda da carga.`,
      divergencia: d,
    },
    {
      parte: 'transportadora',
      titulo: 'Recalcular rota e instruir motorista',
      detalhe: `Status ${fmt(d.valorB)} altera a entrega planejada.`,
      divergencia: d,
    },
    {
      parte: 'fornecedor',
      titulo: 'Alinhar com cliente o novo status do pedido',
      detalhe: `Status mudou de ${fmt(d.valorA)} para ${fmt(d.valorB)}; cliente precisa saber.`,
      divergencia: d,
    },
  ],
};

// Propaga uma divergencia em tarefas por parte (deterministico).
export function propagar(d: Divergencia): Tarefa[] {
  return REGRAS_PROPAGACAO[d.campo](d);
}

// Propaga um lote preservando a ordem das divergencias.
export function propagarTodas(divs: Divergencia[]): Tarefa[] {
  return divs.flatMap(propagar);
}
