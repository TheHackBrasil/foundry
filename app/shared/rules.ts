// Grafo de propagacao deterministico (spec 0004, RF11): divergencia ->
// tarefa por parte, como dado. A simulacao "e se?" (RF12) reusa o mapa.

import { formatarValor, rotuloFonte } from './formato.js';
import type { CampoVigiado, Divergencia, Tarefa } from './model.js';

type Gerador = (d: Divergencia) => Tarefa[];

// So o texto e formatado: a divergencia segue intacta em cada tarefa.
function legivel(d: Divergencia) {
  return {
    fonteA: rotuloFonte(d.fonteA),
    fonteB: rotuloFonte(d.fonteB),
    valorA: formatarValor(d.campo, d.valorA),
    valorB: formatarValor(d.campo, d.valorB),
  };
}

// Para cada campo vigiado, quem faz o que quando duas fontes divergem.
export const REGRAS_PROPAGACAO: Record<CampoVigiado, Gerador> = {
  previsaoEntrega: (d) => {
    const { fonteA, fonteB, valorA, valorB } = legivel(d);
    return [
      {
        parte: 'transportadora',
        titulo: 'Justificar nova data e reestimar ETA',
        detalhe: `Previsão divergente: ${fonteA} diz ${valorA}, ${fonteB} diz ${valorB}.`,
        divergencia: d,
      },
      {
        parte: 'cd',
        titulo: 'Reagendar janela de recebimento',
        detalhe: `Nova previsão de ${valorB} exige replanejar doca e equipe.`,
        divergencia: d,
      },
      // R-006: a CC-e nao corrige data de saida e o cancelamento tem janela
      // curta, entao o atraso nao se resolve por carta de correcao.
      {
        parte: 'fiscal',
        titulo: 'Conferir se o atraso exige ação fiscal',
        detalhe: `A previsão passou de ${valorA} para ${valorB}. O cancelamento da NF-e só cabe em até 24 h e sem circulação da mercadoria, e a CC-e não corrige data de saída.`,
        divergencia: d,
      },
      {
        parte: 'financeiro',
        titulo: 'Recalcular SLA e provisionar multa',
        detalhe: `Atraso da previsão de ${valorA} para ${valorB} pode gerar penalidade contratual.`,
        divergencia: d,
      },
      {
        parte: 'fornecedor',
        titulo: 'Avisar cliente da nova data',
        detalhe: `Comunicar o reagendamento: de ${valorA} para ${valorB}.`,
        divergencia: d,
      },
    ];
  },
  pesoTotal: (d) => {
    const { fonteA, fonteB, valorA, valorB } = legivel(d);
    return [
      {
        parte: 'transportadora',
        titulo: 'Verificar tara e lotação do veículo',
        detalhe: `Peso divergente: ${fonteA} declara ${valorA} kg, ${fonteB} declara ${valorB} kg.`,
        divergencia: d,
      },
      {
        parte: 'fiscal',
        titulo: 'Checar peso NF-e x CT-e junto ao emissor',
        detalhe: `Divergência de ${valorA} kg para ${valorB} kg pode indicar erro de emissão ou carga extra.`,
        divergencia: d,
      },
      {
        parte: 'financeiro',
        titulo: 'Recalcular frete por peso real',
        detalhe: `Frete cotado sobre ${valorA} kg; ${fonteB} indica ${valorB} kg.`,
        divergencia: d,
      },
    ];
  },
  volumes: (d) => {
    const { fonteA, fonteB, valorA, valorB } = legivel(d);
    return [
      {
        parte: 'cd',
        titulo: 'Separar conferência física no recebimento',
        detalhe: `Volumes divergentes: ${fonteA} diz ${valorA}, ${fonteB} diz ${valorB}.`,
        divergencia: d,
      },
      {
        parte: 'transportadora',
        titulo: 'Conferir romaneio contra o documento',
        detalhe: `Romaneio deve bater ${valorA} volumes ou justificar ${valorB}.`,
        divergencia: d,
      },
    ];
  },
  // O rotulo de status ("Em trânsito") fica depois de dois-pontos ou de
  // "diz", nunca como adjetivo no meio da frase.
  status: (d) => {
    const { fonteA, fonteB, valorA, valorB } = legivel(d);
    return [
      {
        parte: 'fiscal',
        titulo: 'Validar mudança de status junto à SEFAZ',
        detalhe: `Status divergente: ${fonteA} diz ${valorA}, ${fonteB} diz ${valorB}.`,
        divergencia: d,
      },
      {
        parte: 'financeiro',
        titulo: 'Estornar ou segurar provisão de pagamento',
        detalhe: `Cancelamento ou bloqueio muda a provisão. Status: de ${valorA} para ${valorB}.`,
        divergencia: d,
      },
      {
        parte: 'cd',
        titulo: 'Suspender ou liberar operação de recebimento',
        detalhe: `Novo status: ${valorB}. Pode exigir devolução ou guarda da carga.`,
        divergencia: d,
      },
      {
        parte: 'transportadora',
        titulo: 'Recalcular rota e instruir motorista',
        detalhe: `Novo status: ${valorB}. Isso altera a entrega planejada.`,
        divergencia: d,
      },
      {
        parte: 'fornecedor',
        titulo: 'Alinhar com cliente o novo status do pedido',
        detalhe: `O cliente precisa saber que o status mudou. Antes: ${valorA}; agora: ${valorB}.`,
        divergencia: d,
      },
    ];
  },
};

// Propaga uma divergencia em tarefas por parte (deterministico).
export function propagar(d: Divergencia): Tarefa[] {
  // campo vem de fora via /api/simulate: nomes herdados do
  // Object.prototype (constructor, hasOwnProperty) nao sao regra.
  const gerador = Object.hasOwn(REGRAS_PROPAGACAO, d.campo)
    ? REGRAS_PROPAGACAO[d.campo]
    : undefined;
  return gerador ? gerador(d) : [];
}

// Propaga um lote preservando a ordem das divergencias.
export function propagarTodas(divs: Divergencia[]): Tarefa[] {
  return divs.flatMap(propagar);
}
