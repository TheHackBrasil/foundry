// Roteiro da ligacao (spec 0017, RF16; T761). O prompt do agente de voz e
// fixo e versionado aqui; o que muda por caso entra so como variavel
// dinamica, montada do roteiro aprovado (roteiro.ts). Evidencia de contato
// anterior nunca entra (RF16): as variaveis saem so dos campos tipados.
//
// Ordem obrigatoria: confirmar com quem fala, identificar-se como assistente
// automatica, avisar da gravacao, oferecer pessoa, respeitar opt-out,
// perguntas fechadas, nenhum compromisso, encerrar a ligacao.

import type { RoteiroPlano } from '../../roteiro.js';

export const VERSAO_PROMPT_LIGACAO = 2;

export const FRASE_INICIAL = 'Olá, boa tarde. Falo com alguém da {{transportadora}} que pode informar sobre entregas?';

export const PROMPT_LIGACAO = `Você é a assistente automática da Forseti, ligando em nome de {{embarcador}} para a transportadora {{transportadora}}.
Objetivo único: obter da transportadora uma declaração sobre a entrega da nota fiscal de final {{nf}}. Pergunta principal: {{pergunta}}

Siga estas regras, nesta ordem:
1. Confirme com quem fala. Só continue depois que a pessoa disser que é da {{transportadora}} e que pode informar sobre entregas. Se ela disser só o nome, pergunte se é da {{transportadora}}. Se não for, peça para indicar quem pode e encerre com educação.
2. Identifique-se: diga que é uma assistente automática da Forseti, falando em nome de {{embarcador}}, e que a ligação é gravada para registro.
3. Ofereça falar com uma pessoa: diga que, se preferir, a equipe de {{embarcador}} entra em contato. Se a pessoa preferir, agradeça e encerre.
4. Se a pessoa pedir para não ser mais contatada, diga que o pedido foi registrado, agradeça e encerre.
5. Faça perguntas curtas e fechadas, uma por vez: a pergunta principal, o status da entrega e a data prevista. Repita o que entendeu para confirmar.
6. Nunca prometa, negocie, aceite ou ofereça nada: prazo, multa, desconto, pagamento, troca, retorno de ligação. Se pedirem algo assim, diga que vai registrar o pedido para a equipe de {{embarcador}}.
7. Não invente dados. Não leia números longos; cite a nota só pelos quatro últimos dígitos, {{nf}}.
8. Fale português do Brasil, com frases curtas, tom cordial e objetivo.
9. Ao terminar, ou se a pessoa pedir para desligar, agradeça, despeça-se e use a ferramenta encerrar_ligacao. Não fique esperando na linha.`;

export const FERRAMENTA_ENCERRAR = {
  type: 'end_call',
  name: 'encerrar_ligacao',
  description:
    'Encerra a ligação. Use logo depois de agradecer e se despedir: quando a transportadora respondeu o que foi perguntado, pediu para desligar, pediu para não ser contatada, preferiu falar com uma pessoa, ou não é a pessoa certa.',
} as const;

// Trechos que o prompt tem de conter (teste e verificacao antes de publicar).
export const TRECHOS_OBRIGATORIOS = [
  'Confirme com quem fala',
  'assistente automática',
  'gravada para registro',
  'falar com uma pessoa',
  'não ser mais contatada',
  'Nunca prometa',
  'encerrar_ligacao',
] as const;

// Trechos obrigatorios que faltam no prompt; vazio = completo.
export function trechosFaltando(prompt: string = PROMPT_LIGACAO): string[] {
  return TRECHOS_OBRIGATORIOS.filter((t) => !prompt.includes(t));
}

export interface VariaveisLigacao {
  embarcador: string;
  transportadora: string;
  nf: string;
  pergunta: string;
  [k: string]: string;
}

const RE_LIMPA = /[\u0000-\u001f\u007f{}]/g;
const limpar = (s: string, max: number): string => s.replace(RE_LIMPA, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

// So campos do roteiro aprovado e o nome do contato da agenda. A chave de 44
// digitos vira os 4 ultimos; chaves e quebras de linha saem (nao viram
// variavel nem instrucao no prompt).
export function variaveisLigacao(roteiro: RoteiroPlano): VariaveisLigacao {
  const digitos = roteiro.campos.chaveNota.replace(/\D/g, '');
  return {
    embarcador: limpar(roteiro.campos.empresa, 80) || 'a empresa contratante',
    transportadora: limpar(roteiro.contato.nome, 80) || 'transportadora',
    nf: digitos.slice(-4) || '0000',
    pergunta: limpar(roteiro.perguntas.join(' '), 300),
  };
}
