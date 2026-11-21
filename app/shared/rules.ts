// Tabela de regras (spec 0004, RF11): divergência em um campo vira tarefa
// por parte. É dado, não lógica, para o Gab poder revisar sem ler código.
//
// RASCUNHO das ações: a redação e o corte por parte são decisão de
// negócio (Gab) e a tarefa fiscal depende de validação com contador
// (R-006). O que está garantido por teste é a estrutura, não o texto.

import type { Campo, Parte } from './model.ts';

export interface Tarefa {
  parte: Parte;
  acao: string;
  // Presente quando a tarefa só vale sob uma condição que o motor não decide.
  condicao?: string;
}

export const REGRAS: Readonly<Record<Campo, readonly Tarefa[]>> = {
  dataEntrega: [
    { parte: 'fornecedor', acao: 'Informar a nova data de entrega e a causa do atraso' },
    { parte: 'transportadora', acao: 'Confirmar a nova previsão de entrega' },
    { parte: 'cd', acao: 'Reprogramar a doca e a janela de recebimento' },
    { parte: 'financeiro', acao: 'Revisar vencimento e condição de pagamento do pedido' },
    {
      parte: 'fiscal',
      acao: 'Conferir se o atraso exige ação fiscal',
      condicao:
        'Cancelamento de NF-e só em até 24h e sem circulação da mercadoria; a CC-e não corrige a data de saída (R-006)',
    },
  ],
  pesoKg: [
    { parte: 'transportadora', acao: 'Conferir o peso informado no CT-e contra o da NF-e' },
    { parte: 'cd', acao: 'Pesar na conferência de recebimento' },
    { parte: 'financeiro', acao: 'Reavaliar o frete se o peso cobrado mudou' },
  ],
  volumes: [
    { parte: 'transportadora', acao: 'Conferir a contagem de volumes embarcados' },
    { parte: 'cd', acao: 'Conferir a contagem de volumes no recebimento' },
  ],
  status: [
    { parte: 'transportadora', acao: 'Atualizar o status da entrega' },
    { parte: 'cd', acao: 'Confirmar o recebimento ou registrar a recusa' },
  ],
};

export function tarefasPara(campo: Campo): readonly Tarefa[] {
  return REGRAS[campo];
}
