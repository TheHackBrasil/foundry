// T742: degrau de e-mail sobre a cobranca da spec 0010. PGlite em memoria,
// SMTP falso (rotulado como teste); chave, contato e endereco sinteticos (A7).
// A subida de degrau em 4 h roda com o fluxo real em fluxo/fatia.test.ts.

import { beforeEach, describe, expect, it } from 'vitest';
import { createLiteDb } from '../../server/db.js';
import type { Remetente, SmtpConfig } from '../../server/smtp.js';
import { LedgerStore } from '../../server/store.js';
import type { PedidoEnvio } from '../fluxo/caso.js';
import { criarCanalEmail } from './email.js';

const CHAVE = '35260123456789000123550010000000011000000019';
const WS = 'ws-canal-email';
const SMTP: SmtpConfig = { host: 'smtp.teste.invalid', port: 587, from: 'operador@teste.invalid', dominio: 'teste.invalid', timeoutMs: 1_000 };

class RemetenteFalso implements Remetente {
  enviadas: Array<{ para: string; messageId: string }> = [];
  falha: Error | null = null;
  async enviar(m: { para: string; messageId: string }) {
    if (this.falha) throw this.falha;
    this.enviadas.push({ para: m.para, messageId: m.messageId });
  }
}

describe('canal de e-mail do operador (T742)', () => {
  let raiz: LedgerStore;
  let ws: LedgerStore;
  let remetente: RemetenteFalso;
  let casoId: string;
  let pedido: PedidoEnvio;

  beforeEach(async () => {
    const db = await createLiteDb();
    raiz = new LedgerStore(db, 'seed', 'seed');
    await raiz.init();
    ws = raiz.paraWorkspace(WS);
    remetente = new RemetenteFalso();
    await ws.upsertContato({ parte: 'transportadora', nome: 'Equipe (teste)', canal: 'email', destino: 'equipe@teste.invalid', fonte: 'manual' });
    const ab = await ws.append(CHAVE, 'pendencia_aberta', { motivo: 'sem_atualizacao' });
    casoId = `${CHAVE}:${ab.seq}`;
    const contato = (await ws.contatoDaParte('transportadora', 'email'))!;
    pedido = { chave: 'a'.repeat(64), canal: 'email', workspace: WS, pedidoId: CHAVE, casoId, contatoId: contato.id, destino: contato.destino };
  });

  it('envia uma vez por caso, grava cobranca_enviada so com ids e repete o aceite sem reenviar', async () => {
    const canal = criarCanalEmail({ raiz, expiraHoras: 72, remetente, smtp: SMTP });
    const r1 = await canal.enviar(pedido);
    expect(r1).toEqual({ status: 'aceito', idExterno: expect.stringMatching(/^cobranca:\d+$/) });
    expect(remetente.enviadas).toHaveLength(1);
    expect(remetente.enviadas[0]!.messageId).toMatch(/^<cobranca\.\d+\.1\.[0-9a-f]{16}@teste\.invalid>$/);
    const r2 = await canal.enviar(pedido);
    expect(r2).toEqual(r1);
    expect(remetente.enviadas).toHaveLength(1);
    const eventos = await ws.eventosDoPedido(CHAVE);
    const enviada = eventos.filter((e) => e.tipo === 'cobranca_enviada');
    expect(enviada).toHaveLength(1);
    expect(enviada[0]!.payload).toMatchObject({ casoId, tentativa: 1 });
    expect(JSON.stringify(eventos)).not.toContain('equipe@teste.invalid');
  });

  it('consulta pela chave: so responde aceito depois que a cobranca do caso saiu', async () => {
    const canal = criarCanalEmail({ raiz, expiraHoras: 72, remetente, smtp: SMTP });
    expect(await canal.consultar(pedido.chave)).toEqual({ status: 'desconhecido' });
    await ws.append(CHAVE, 'contato_iniciado', { chave: pedido.chave, casoId, canal: 'email', fornecedor: canal.fornecedor });
    expect(await canal.consultar(pedido.chave)).toEqual({ status: 'desconhecido' });
    const r = await canal.enviar(pedido);
    expect(await canal.consultar(pedido.chave)).toEqual(r);
  });

  it('sem SMTP recusa declarado; erro de envio nao renasce', async () => {
    const semSmtp = criarCanalEmail({ raiz, expiraHoras: 72, remetente: null, smtp: null });
    expect(await semSmtp.enviar(pedido)).toEqual({ status: 'recusado', motivo: 'smtp_indisponivel' });
    remetente.falha = new Error('550 caixa inexistente');
    const canal = criarCanalEmail({ raiz, expiraHoras: 72, remetente, smtp: SMTP });
    expect(await canal.enviar(pedido)).toEqual({ status: 'recusado', motivo: 'erro_envio' });
    remetente.falha = null;
    expect(await canal.enviar(pedido)).toEqual({ status: 'recusado', motivo: 'erro_envio' });
    expect(remetente.enviadas).toHaveLength(0);
  });

  it('repete a checagem do contato: outro id, fonte nao manual ou nao contatar pela IA', async () => {
    const canal = criarCanalEmail({ raiz, expiraHoras: 72, remetente, smtp: SMTP });
    expect(await canal.enviar({ ...pedido, contatoId: pedido.contatoId + 99 })).toEqual({ status: 'recusado', motivo: 'contato_mudou' });
    await ws.upsertContato({ parte: 'transportadora', nome: 'Equipe (teste)', canal: 'email', destino: 'equipe@teste.invalid', fonte: 'manual', naoContatarIa: true });
    expect(await canal.enviar(pedido)).toEqual({ status: 'recusado', motivo: 'contato_nao_contatar_ia' });
    // Contato criado a partir de documento nao serve (RF8).
    const outra = raiz.paraWorkspace('ws-contato-documento');
    await outra.inserirContatoSeAusente({ parte: 'transportadora', nome: 'Do XML (teste)', canal: 'email', destino: 'xml@teste.invalid', fonte: 'documento' });
    const doc = (await outra.contatoDaParte('transportadora', 'email'))!;
    expect(doc.fonte).toBe('documento');
    expect(await canal.enviar({ ...pedido, workspace: outra.workspace, contatoId: doc.id })).toEqual({ status: 'recusado', motivo: 'contato_nao_manual' });
    expect(remetente.enviadas).toHaveLength(0);
  });
});
