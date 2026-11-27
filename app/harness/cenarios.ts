// Roteiros nomeados da transportadora simulada (frente harness-transp):
// arquetipos correlacionados, nao eixos ortogonais. Cada um junta persona,
// identidade SMTP e os dois livros (verdade x declarado) com datas relativas
// a hoje, para a demo nunca vencer.

import type { NomePersona, RoteiroPersona } from './personas.js';

export const DOMINIO_TRANSP = 'transp-sim.dev';

const roteiros: Record<NomePersona, RoteiroPersona> = {
  // Responde em segundos com status crivel: transito, trecho real e
  // previsao nova. A previsao declarada (hoje+2) diverge da planilha da
  // seed (vencida): e a divergencia que a plataforma mostra na tela.
  cooperativa: {
    nome: 'cooperativa',
    remetente: `Ops Rodovia <ops@${DOMINIO_TRANSP}>`,
    dominio: DOMINIO_TRANSP,
    verdade: {
      statusReal: 'em_transito',
      previsaoRealDias: 2,
      motivoReal: 'rota dentro do previsto, transito pesado no Rodoanel',
    },
    declarado: {
      status: 'em_transito',
      previsaoDias: 2,
      local: 'passou por Curitiba hoje cedo',
    },
    atrasoRespostaMs: 1_500,
  },
  // Primeiro "vou verificar e retorno" (o padrao do mercado); na segunda
  // cobranca declara versao otimista que diverge: diz em_transito com
  // entrega hoje+2 quando o caminhao quebrou e a previsao real e hoje+6.
  evasiva: {
    nome: 'evasiva',
    remetente: `Expedicao Serra <expedicao@${DOMINIO_TRANSP}>`,
    dominio: DOMINIO_TRANSP,
    verdade: {
      statusReal: 'atrasada',
      previsaoRealDias: 6,
      motivoReal: 'veiculo quebrou na serra, carga aguardando reboque',
    },
    declarado: {
      status: 'em_transito',
      previsaoDias: 2,
      local: 'seguindo viagem normalmente',
    },
    atrasoRespostaMs: 1_500,
  },
  // Nunca responde: e a demonstracao da escada subindo (e-mail, prazo
  // vencido, escalacao) e da cobranca expirando sem resposta.
  silenciosa: {
    nome: 'silenciosa',
    remetente: `Transportes Ermida <expedicao@${DOMINIO_TRANSP}>`,
    dominio: DOMINIO_TRANSP,
    verdade: {
      statusReal: 'em_transito',
      previsaoRealDias: 3,
      motivoReal: 'caixa de status nao monitorada',
    },
    declarado: {
      status: 'em_transito',
      previsaoDias: 3,
      local: '',
    },
    atrasoRespostaMs: 0,
  },
};

export function roteiro(nome: string): RoteiroPersona {
  const r = roteiros[nome as NomePersona];
  if (!r) throw new RangeError(`roteiro desconhecido: ${nome} (use ${Object.keys(roteiros).join(', ')})`);
  return r;
}

export const NOMES_CENARIOS = Object.keys(roteiros) as NomePersona[];
