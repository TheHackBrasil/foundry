// Upload de .eml (spec 0004, RF28/D-021) e privacidade dos cabecalhos (RF27).
// O e-mail e sintetico, montado no proprio teste, com enderecos em
// example.com: nenhum dado real. Um servidor sobe uma vez; cada caso usa
// uma sessao nova por cookie, como o visitante da demo.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Evento } from '../../shared/model.js';
import { createLiteDb } from '../db.js';
import { buildServer } from '../index.js';
import { extrairAnexosEml } from './eml.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const lerBuf = (f: string): Buffer => readFileSync(join(FIX, f));
const NFE = lerBuf('nfe-ok.xml');
const CTE = lerBuf('cte-ok.xml');
const CHAVE = '35260123456789000123550010000000011000000019';
const CRLF = '\r\n';

// Valores que identificam uma pessoa ou a mensagem: nenhum pode aparecer
// em payload, erro, fila de revisao nem no que o ingest devolve.
const CABECALHOS = {
  from: 'Maria Ficticia <maria.ficticia@example.com>',
  to: 'joao.ficticio@example.com',
  cc: 'copia.ficticia@example.com',
  subject: 'Assunto sigiloso ficticio 7731',
  messageId: '<id-unico-7731@mail.example.com>',
};
const VALORES_SENSIVEIS = [
  'maria.ficticia@example.com',
  'Maria Ficticia',
  'joao.ficticio@example.com',
  'copia.ficticia@example.com',
  'Assunto sigiloso ficticio 7731',
  'id-unico-7731@mail.example.com',
];

interface Parte {
  tipo: string;
  corpo: Buffer | string;
  nome?: string;
  disposicao?: 'attachment' | 'inline';
}

function montarEml(partes: Parte[]): Buffer {
  const b = '----=_Parte_teste_7731';
  const linhas = [
    `From: ${CABECALHOS.from}`,
    `To: ${CABECALHOS.to}`,
    `Cc: ${CABECALHOS.cc}`,
    `Subject: ${CABECALHOS.subject}`,
    'Date: Tue, 20 Jan 2026 10:05:00 -0300',
    `Message-ID: ${CABECALHOS.messageId}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/mixed; boundary="${b}"`,
    '',
    `--${b}`,
    'Content-Type: text/plain; charset=UTF-8',
    '',
    'Corpo da mensagem de teste.',
  ];
  for (const p of partes) {
    const b64 = (Buffer.isBuffer(p.corpo) ? p.corpo : Buffer.from(p.corpo)).toString('base64').match(/.{1,76}/g)!.join(CRLF);
    linhas.push('', `--${b}`);
    linhas.push(`Content-Type: ${p.tipo}${p.nome ? `; name="${p.nome}"` : ''}`);
    if (p.disposicao) {
      linhas.push(`Content-Disposition: ${p.disposicao}${p.nome ? `; filename="${p.nome}"` : ''}`);
    }
    linhas.push('Content-Transfer-Encoding: base64', '', b64);
  }
  linhas.push('', `--${b}--`, '');
  return Buffer.from(linhas.join(CRLF));
}

const anexoXml = (corpo: Buffer, nome = 'doc.xml'): Parte => ({ tipo: 'application/xml', corpo, nome, disposicao: 'attachment' });

describe('extrairAnexosEml', () => {
  it('o erro nunca repete cabecalho da mensagem', async () => {
    const mensagens = await Promise.all([
      extrairAnexosEml(montarEml([])).catch((e: Error) => e.message),
      extrairAnexosEml(montarEml([{ tipo: 'message/rfc822', corpo: montarEml([]), nome: 'x.eml' }])).catch((e: Error) => e.message),
      extrairAnexosEml(Buffer.from(`${CABECALHOS.from}\r\n${CABECALHOS.subject}`)).catch((e: Error) => e.message),
    ]);
    for (const m of mensagens) {
      expect(typeof m).toBe('string');
      for (const v of VALORES_SENSIVEIS) expect(m).not.toContain(v);
    }
  });
});

type Servidor = Awaited<ReturnType<typeof buildServer>>;

describe('POST /api/ingest com .eml', () => {
  let s: Servidor;
  beforeAll(async () => {
    s = await buildServer(await createLiteDb());
    await s.app.ready();
  });
  afterAll(async () => {
    await s.app.close();
  });

  // Sessao do visitante: cookie emitido pelo servidor, como na demo publica.
  async function novaSessao(): Promise<{ cookie: string; ws: string }> {
    const res = await s.app.inject({ method: 'GET', url: '/api/pedidos' });
    const bruto = res.headers['set-cookie'];
    const cookie = (Array.isArray(bruto) ? String(bruto[0]) : String(bruto)).split(';')[0]!;
    return { cookie, ws: cookie.split('=')[1]! };
  }

  async function enviar(cookie: string, nome: string, conteudo: Buffer) {
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: { cookie },
      payload: { nome, conteudoBase64: conteudo.toString('base64') },
    });
    return { status: res.statusCode, corpo: res.json() as Record<string, unknown>, texto: res.body };
  }

  const normalizar = (evs: Evento[]) => evs.map((e) => ({ pedidoId: e.pedidoId, seq: e.seq, tipo: e.tipo, payload: e.payload }));

  it('email-nfe.eml gera os mesmos eventos que o nfe-ok.xml solto', async () => {
    const a = await novaSessao();
    const b = await novaSessao();
    const direto = await enviar(a.cookie, 'nfe-ok.xml', NFE);
    const viaEml = await enviar(b.cookie, 'email-nfe.eml', lerBuf('email-nfe.eml'));

    expect(viaEml.status).toBe(200);
    expect(viaEml.corpo['pedidoId']).toBe(CHAVE);
    expect(viaEml.corpo['eventos']).toBe(direto.corpo['eventos']);
    const eventosA = await s.store.paraWorkspace(a.ws).todosEventos();
    const eventosB = await s.store.paraWorkspace(b.ws).todosEventos();
    expect(normalizar(eventosB)).toEqual(normalizar(eventosA));
  });

  it('upload multipart de .eml segue o mesmo caminho do XML', async () => {
    const { cookie } = await novaSessao();
    const fronteira = 'xB0undaryTeste';
    const corpo = Buffer.concat([
      Buffer.from(
        `--${fronteira}${CRLF}Content-Disposition: form-data; name="file"; filename="email-nfe.eml"${CRLF}Content-Type: message/rfc822${CRLF}${CRLF}`,
      ),
      lerBuf('email-nfe.eml'),
      Buffer.from(`${CRLF}--${fronteira}--${CRLF}`),
    ]);
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: { cookie, 'content-type': `multipart/form-data; boundary=${fronteira}` },
      payload: corpo,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { pedidoId: string }).pedidoId).toBe(CHAVE);
  });

  it('dois CT-e sem pedido: revisaoId e o do primeiro e os dois entram na fila', async () => {
    const { cookie, ws } = await novaSessao();
    const orfao = (chave: string): Buffer => Buffer.from(CTE.toString('utf8').replaceAll(CHAVE, chave));
    const r = await enviar(
      cookie,
      'orfaos.eml',
      montarEml([anexoXml(orfao('35260100000000000100550010000099991000099991'), 'a.xml'), anexoXml(orfao('35260100000000000100550010000099992000099992'), 'b.xml')]),
    );
    const fila = await s.store.paraWorkspace(ws).listarRevisao();

    expect(r.status).toBe(200);
    expect(r.corpo['docs']).toBe(2);
    expect(fila).toHaveLength(2);
    expect(r.corpo['revisaoId']).toBe(fila[0]!.id);
  });

  it('.eml sem anexo elegivel responde 422 explicito e nao grava nada', async () => {
    const { cookie, ws } = await novaSessao();
    const r = await enviar(cookie, 'vazio.eml', montarEml([]));
    expect(r.status).toBe(422);
    expect(r.corpo['tipo']).toBe('parser');
    expect(r.corpo['erro']).toContain('sem anexo elegivel');
    expect(await s.store.paraWorkspace(ws).todosEventos()).toHaveLength(0);
  });

  it('nenhum cabecalho do e-mail aparece em resposta, evento, revisao ou erro (RF27)', async () => {
    const { cookie, ws } = await novaSessao();
    const orfao = Buffer.from(CTE.toString('utf8').replaceAll(CHAVE, '35260100000000000100550010000099991000099991'));
    const respostas = [
      await enviar(cookie, 'ok.eml', montarEml([anexoXml(NFE)])),
      await enviar(cookie, 'orfao.eml', montarEml([anexoXml(orfao)])),
      await enviar(cookie, 'vazio.eml', montarEml([])),
      await enviar(cookie, 'aninhado.eml', montarEml([{ tipo: 'message/rfc822', corpo: montarEml([anexoXml(NFE)]), nome: 'x.eml' }])),
      await enviar(cookie, 'lixo.eml', Buffer.from(`${CABECALHOS.from}\n${CABECALHOS.subject}\n`)),
    ];
    const revisao = await s.app.inject({ method: 'GET', url: '/api/revisao', headers: { cookie } });
    const pedido = await s.app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}`, headers: { cookie } });
    const superficies = [
      ...respostas.map((r) => r.texto),
      JSON.stringify(await s.store.paraWorkspace(ws).todosEventos()),
      JSON.stringify(await s.store.paraWorkspace(ws).listarRevisao()),
      revisao.body,
      pedido.body,
    ];

    expect(respostas.map((r) => r.status)).toEqual([200, 200, 422, 422, 422]);
    for (const texto of superficies) {
      for (const v of VALORES_SENSIVEIS) expect(texto).not.toContain(v);
    }
  });
});
