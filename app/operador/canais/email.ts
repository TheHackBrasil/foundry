// Degrau de e-mail do operador (spec 0017, RF13; T742). Adaptador de canal
// sobre a cobranca da spec 0010 (app/server/cobranca.ts): o e-mail sai pelo
// template do servidor, com o Message-ID derivado da cobranca e gravado
// antes do envio, e vira cobranca_enviada no ledger. O fluxo grava o
// contato_iniciado antes de chamar enviar (RF12).
//
// - Envia uma vez por caso: a cobranca e ligada ao caso pelo caso_id; se ela
//   ja saiu (enviada, respondida ou expirada), enviar devolve o aceite dela
//   sem mandar de novo. erro_envio nao renasce (RF13).
// - Repete a checagem da politica (RF8): so contato manual de e-mail, o
//   mesmo que o fluxo leu, e sem o pedido de nao contatar pela IA.
// - Sem SMTP, recusa declarada ('smtp_indisponivel'): o fluxo grava
//   contato_falhou e sobe de degrau (NFR-demo).
// - O id externo e `cobranca:<id>`; o Message-ID leva o segredo da cobranca
//   e fica fora do ledger.

import type { Cobranca, Evento } from '../../shared/model.js';
import { criarCobrancaParaPendencia, enviarCobranca } from '../../server/cobranca.js';
import type { Remetente, SmtpConfig } from '../../server/smtp.js';
import type { LedgerStore } from '../../server/store.js';
import type { AdaptadorCanal, PedidoEnvio, RespostaConsulta, RespostaEnvio } from '../fluxo/caso.js';

export const FORNECEDOR_EMAIL = 'smtp';

export interface OpcoesCanalEmail {
  raiz: LedgerStore; // store raiz; cada envio abre paraWorkspace(ws)
  expiraHoras: number; // COBRANCA_EXPIRA_HORAS
  remetente?: Remetente | null; // ausente: o do env
  smtp?: SmtpConfig | null; // ausente: o do env
  aoEvento?: (evento: Evento, workspace: string) => void; // repasse ao SSE
}

const JA_SAIU: ReadonlySet<Cobranca['status']> = new Set(['enviada', 'respondida', 'expirada']);

const idExterno = (c: Cobranca): string => `cobranca:${c.id}`;

export function criarCanalEmail(opcoes: OpcoesCanalEmail): AdaptadorCanal {
  return {
    canal: 'email',
    fornecedor: FORNECEDOR_EMAIL,
    custoEstimadoBrl: 0,

    async enviar(pedido: PedidoEnvio): Promise<RespostaEnvio> {
      if (pedido.canal !== 'email') return { status: 'recusado', motivo: 'canal_incompativel' };
      const s = opcoes.raiz.paraWorkspace(pedido.workspace);
      const contato = await s.contatoDaParte('transportadora', 'email');
      if (!contato || contato.id !== pedido.contatoId) return { status: 'recusado', motivo: 'contato_mudou' };
      if (contato.fonte !== 'manual') return { status: 'recusado', motivo: 'contato_nao_manual' };
      if (contato.naoContatarIa) return { status: 'recusado', motivo: 'contato_nao_contatar_ia' };

      let cobranca = await s.cobrancaPorCasoId(pedido.pedidoId, pedido.casoId);
      if (cobranca && JA_SAIU.has(cobranca.status)) return { status: 'aceito', idExterno: idExterno(cobranca) };
      if (cobranca?.status === 'erro_envio') return { status: 'recusado', motivo: 'erro_envio' };
      if (!cobranca) {
        cobranca = (await criarCobrancaParaPendencia(s, pedido.pedidoId, opcoes.expiraHoras, pedido.casoId)).cobranca;
        // Cobranca aberta de outro caso do mesmo pedido: vale a dela.
        if (JA_SAIU.has(cobranca.status)) return { status: 'aceito', idExterno: idExterno(cobranca) };
      }
      const r = await enviarCobranca(s, cobranca, opcoes.remetente, opcoes.smtp);
      if (r.evento) opcoes.aoEvento?.(r.evento, s.workspace);
      if (r.ok) return { status: 'aceito', idExterno: idExterno(cobranca) };
      if (r.status === 'erro_envio') return { status: 'recusado', motivo: 'erro_envio' };
      return { status: 'recusado', motivo: /SMTP/.test(r.motivo ?? '') ? 'smtp_indisponivel' : 'sem_destinatario' };
    },

    // Consulta pela chave (queda entre a intencao e o aceite): a cobranca do
    // caso da intencao ja saiu? Sem resposta, o fluxo devolve ao analista.
    async consultar(chave: string): Promise<RespostaConsulta> {
      const intencoes = await opcoes.raiz.intencoesPorChave(chave);
      const i = intencoes.length === 1 ? intencoes[0]! : null;
      if (!i?.casoId) return { status: 'desconhecido' };
      const c = await opcoes.raiz.paraWorkspace(i.workspaceId).cobrancaPorCasoId(i.pedidoId, i.casoId);
      return c && JA_SAIU.has(c.status) ? { status: 'aceito', idExterno: idExterno(c) } : { status: 'desconhecido' };
    },
  };
}
