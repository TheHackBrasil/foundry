// Estimativa de custo da excecao (spec 0011, RF5): coeficientes declarados,
// retorno sempre rotulado 'simulacao' — nunca apresentado como medida real
// (A7). Base: atraso em dias derivado da divergencia de previsaoEntrega.

import type { Caso } from './model.js';

export interface ItemCusto {
  rotulo: string;
  valor: number; // R$
}

export interface EstimativaCusto {
  valor: number;
  metodo: 'simulacao';
  itens: ItemCusto[];
}

// Coeficientes da simulacao (por dia de atraso, por pedido).
export const CUSTO = {
  docaOciosaPorDia: 400,
  freteExtraPorDia: 250,
  multaPorDia: 150,
} as const;

function diasDeAtraso(caso: Caso): number {
  const d = caso.divergencia;
  if (!d || d.campo !== 'previsaoEntrega') return 1; // pendencia/outros: 1 dia base
  const a = Date.parse(String(d.valorA));
  const b = Date.parse(String(d.valorB));
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}

export function estimarCusto(caso: Caso): EstimativaCusto {
  const dias = diasDeAtraso(caso);
  const itens: ItemCusto[] = [
    { rotulo: `Doca/equipe ociosa (${dias}d)`, valor: dias * CUSTO.docaOciosaPorDia },
    { rotulo: `Frete/remanejamento extra (${dias}d)`, valor: dias * CUSTO.freteExtraPorDia },
    { rotulo: `Multa contratual estimada (${dias}d)`, valor: dias * CUSTO.multaPorDia },
  ];
  return {
    valor: itens.reduce((acc, i) => acc + i.valor, 0),
    metodo: 'simulacao',
    itens,
  };
}
