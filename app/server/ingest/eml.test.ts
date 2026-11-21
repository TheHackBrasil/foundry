// Upload de .eml (spec 0004, RF28/D-021) e privacidade dos cabecalhos (RF27).
// O e-mail e sintetico, montado no proprio teste, com enderecos em
// example.com: nenhum dado real.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Evento } from '../../shared/model.js';
import { buildServer } from '../index.js';
import { detectarTipo } from './detect.js';
import { MAX_ANEXOS, MAX_BYTES_ANEXO, extrairAnexos } from './eml.js';
import { ErroParser } from './nfe.js';

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
  contentId?: string;
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
    if (p.contentId) linhas.push(`Content-ID: ${p.contentId}`);
    linhas.push('Content-Transfer-Encoding: base64', '', b64);
  }
  linhas.push('', `--${b}--`, '');
  return Buffer.from(linhas.join(CRLF));
}

const anexoXml = (corpo: Buffer, nome = 'doc.xml'): Parte => ({ tipo: 'application/xml', corpo, nome, disposicao: 'attachment' });

describe('detectarTipo com e-mail', () => {
  it('extensao .eml e e-mail', () => {
    expect(detectarTipo('mensagem.eml', Buffer.from('qualquer coisa'))).toBe('eml');
  });

  it('cabecalho MIME sem extensao e e-mail, mesmo com "<" no From (nao cai no ramo de XML)', () => {
    expect(detectarTipo('mensagem', montarEml([anexoXml(NFE)]))).toBe('eml');
    const soContentType = Buffer.from('From: A <a@example.com>\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n');
    expect(detectarTipo('mensagem', soContentType)).toBe('eml');
  });

  it('XML e planilha seguem como antes', () => {
    expect(detectarTipo('nfe-ok.xml', NFE)).toBe('nfe');
    expect(detectarTipo('cte-ok.xml', CTE)).toBe('cte');
    expect(detectarTipo('planilha.csv', lerBuf('planilha.csv'))).toBe('csv');
  });
});

describe('extrairAnexos', () => {
  it('devolve o anexo da NF-e com os mesmos bytes e so nome e conteudo', async () => {
    const r = await extrairAnexos(montarEml([anexoXml(NFE, 'NF Maria Ficticia.xml')]));
    expect(r).toHaveLength(1);
    expect(Object.keys(r[0]!).sort()).toEqual(['conteudo', 'nome']);
    expect(r[0]!.nome).toBe('anexo-1.xml');
    expect(r[0]!.conteudo.equals(NFE)).toBe(true);
  });

  it('ignora imagem inline e anexo de outro tipo, mantendo xml e csv', async () => {
    const r = await extrairAnexos(
      montarEml([
        { tipo: 'image/png', corpo: Buffer.from([0x89, 0x50, 0x4e, 0x47]), nome: 'logo.png', disposicao: 'inline', contentId: '<logo@example.com>' },
        { tipo: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', corpo: 'docx', nome: 'termo.docx', disposicao: 'attachment' },
        { tipo: 'text/plain', corpo: 'texto', nome: 'leia-me.txt', disposicao: 'attachment' },
        anexoXml(NFE),
        { tipo: 'text/csv', corpo: lerBuf('planilha.csv'), nome: 'planilha.csv', disposicao: 'attachment' },
      ]),
    );
    expect(r.map((a) => a.nome)).toEqual(['anexo-1.xml', 'anexo-2.csv']);
  });

  it('aceita anexo sem nome quando o content-type e de um formato suportado', async () => {
    const r = await extrairAnexos(montarEml([{ tipo: 'application/xml', corpo: NFE, disposicao: 'attachment' }]));
    expect(r.map((a) => a.nome)).toEqual(['anexo-1.xml']);
  });

  it('coloca a NF-e antes do CT-e, qualquer que seja a ordem no e-mail', async () => {
    const r = await extrairAnexos(montarEml([anexoXml(CTE, 'cte.xml'), anexoXml(NFE, 'nfe.xml')]));
    expect(r.map((a) => detectarTipo(a.nome, a.conteudo))).toEqual(['nfe', 'cte']);
  });

  it('e-mail sem anexo aproveitavel vira ErroParser explicito', async () => {
    const msg = montarEml([{ tipo: 'image/png', corpo: Buffer.from([1, 2, 3]), nome: 'a.png', disposicao: 'inline', contentId: '<a@example.com>' }]);
    await expect(extrairAnexos(msg)).rejects.toThrowError(ErroParser);
    await expect(extrairAnexos(msg)).rejects.toThrowError(/nenhum anexo aproveitavel/);
  });

  it('arquivo que nao e mensagem vira ErroParser, nao "sem anexo"', async () => {
    await expect(extrairAnexos(Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f]))).rejects.toThrowError(/malformada/);
  });

  it('rejeita e-mail dentro de e-mail (message/rfc822), mesmo com NF-e ao lado', async () => {
    const interno = montarEml([anexoXml(NFE)]);
    const msg = montarEml([anexoXml(NFE), { tipo: 'message/rfc822', corpo: interno, nome: 'encaminhado.eml', disposicao: 'attachment' }]);
    await expect(extrairAnexos(msg)).rejects.toThrowError(/outro e-mail/);
  });

  it('rejeita e-mail aninhado disfarçado de application/octet-stream', async () => {
    const interno = montarEml([anexoXml(NFE)]);
    const comExtensao = montarEml([{ tipo: 'application/octet-stream', corpo: interno, nome: 'x.eml', disposicao: 'attachment' }]);
    const semNome = montarEml([{ tipo: 'application/octet-stream', corpo: interno, disposicao: 'attachment' }]);
    await expect(extrairAnexos(comExtensao)).rejects.toThrowError(/outro e-mail/);
    await expect(extrairAnexos(semNome)).rejects.toThrowError(/outro e-mail/);
  });

  it(`aceita ${MAX_ANEXOS} anexos e rejeita ${MAX_ANEXOS + 1}`, async () => {
    const gerar = (n: number): Buffer =>
      montarEml(Array.from({ length: n }, (_, i) => ({ tipo: 'text/csv', corpo: `a;b\n${i};1\n`, nome: `p${i}.csv`, disposicao: 'attachment' as const })));
    expect(await extrairAnexos(gerar(MAX_ANEXOS))).toHaveLength(MAX_ANEXOS);
    await expect(extrairAnexos(gerar(MAX_ANEXOS + 1))).rejects.toThrowError(/maximo/);
  });

  it('rejeita anexo acima do limite de tamanho e aceita o do limite', async () => {
    const noLimite = Buffer.alloc(MAX_BYTES_ANEXO, 'a');
    const acima = Buffer.alloc(MAX_BYTES_ANEXO + 1, 'a');
    const ok = await extrairAnexos(montarEml([{ tipo: 'application/pdf', corpo: noLimite, nome: 'a.pdf', disposicao: 'attachment' }]));
    expect(ok[0]!.conteudo.length).toBe(MAX_BYTES_ANEXO);
    await expect(
      extrairAnexos(montarEml([{ tipo: 'application/pdf', corpo: acima, nome: 'a.pdf', disposicao: 'attachment' }])),
    ).rejects.toThrowError(/limite por anexo/);
  });

  it('anexo de tipo desconhecido derruba o e-mail inteiro antes de qualquer gravacao', async () => {
    const msg = montarEml([anexoXml(NFE), anexoXml(Buffer.from('<outro><coisa/></outro>'), 'x.xml')]);
    await expect(extrairAnexos(msg)).rejects.toThrowError(/Tipo de XML nao reconhecido/);
  });

  it('o erro nunca repete cabecalho da mensagem', async () => {
    const mensagens = await Promise.all([
      extrairAnexos(montarEml([])).catch((e: Error) => e.message),
      extrairAnexos(montarEml([{ tipo: 'message/rfc822', corpo: montarEml([]), nome: 'x.eml' }])).catch((e: Error) => e.message),
      extrairAnexos(Buffer.from(`${CABECALHOS.from}\r\n${CABECALHOS.subject}`)).catch((e: Error) => e.message),
    ]);
    for (const m of mensagens) {
      expect(typeof m).toBe('string');
      for (const v of VALORES_SENSIVEIS) expect(m).not.toContain(v);
    }
  });
});

// Cada teste de ledger usa um servidor novo (PGlite em memoria): o
// pedido da NF-e ja existente num store compartilhado faria o .eml virar
// reingestao idempotente, sem evento nenhum para comparar.
const normalizar = (evs: Evento[]) => evs.map((e) => ({ pedidoId: e.pedidoId, seq: e.seq, tipo: e.tipo, payload: e.payload }));

type Servidor = Awaited<ReturnType<typeof buildServer>>;

async function enviar(s: Servidor, nome: string, conteudo: Buffer) {
  const res = await s.app.inject({
    method: 'POST',
    url: '/api/ingest',
    payload: { nome, conteudoBase64: conteudo.toString('base64') },
  });
  return { status: res.statusCode, corpo: res.json() as Record<string, unknown>, texto: res.body };
}

describe('POST /api/ingest com .eml', () => {
  const abertos: Servidor[] = [];
  const novo = async (): Promise<Servidor> => {
    const s = await buildServer();
    await s.app.ready();
    abertos.push(s);
    return s;
  };
  let solto: Servidor;
  let porEml: Servidor;
  
  beforeAll(async () => {
    solto = await novo();
    porEml = await novo();
  });
  afterAll(async () => {
    for (const s of abertos) await s.app.close();
  });

  it('NF-e e CT-e em anexo geram os mesmos eventos que os XML soltos', async () => {
    await enviar(solto, 'nfe-ok.xml', NFE);
    const soltoCte = await enviar(solto, 'cte-ok.xml', CTE);

    // CT-e antes da NF-e no e-mail: a ordem do pipeline tem que se corrigir sozinha
    const r = await enviar(porEml, 'pedido.eml', montarEml([anexoXml(CTE, 'cte.xml'), anexoXml(NFE, 'nfe.xml')]));

    expect(r.status).toBe(200);
    expect(r.corpo['pedidoId']).toBe(CHAVE);
    expect(r.corpo['docs']).toBe(2);
    expect(r.corpo['revisaoId']).toBeNull();
    expect(r.corpo['eventos']).toBeGreaterThan(2);
    const esperado = normalizar(await solto.store.todosEventos());
    expect(normalizar(await porEml.store.todosEventos())).toEqual(esperado);
    expect(esperado.map((e) => e.tipo)).toContain('divergencia');
    expect(soltoCte.status).toBe(200);
  });

  it('o exemplo.eml da fixture gera os mesmos eventos que o nfe-ok.xml solto', async () => {
    const a = await novo();
    const b = await novo();
    const direto = await enviar(a, 'nfe-ok.xml', NFE);
    const viaEml = await enviar(b, 'exemplo.eml', lerBuf('exemplo.eml'));

    expect(viaEml.status).toBe(200);
    expect(viaEml.corpo['pedidoId']).toBe(CHAVE);
    expect(viaEml.corpo['eventos']).toBe(direto.corpo['eventos']);
    expect(normalizar(await b.store.todosEventos())).toEqual(normalizar(await a.store.todosEventos()));
  });

  it('upload multipart de .eml segue o mesmo caminho do XML', async () => {
    const s = await novo();
    const fronteira = 'xB0undaryTeste';
    const eml = lerBuf('exemplo.eml');
    const corpo = Buffer.concat([
      Buffer.from(
        `--${fronteira}${CRLF}Content-Disposition: form-data; name="file"; filename="exemplo.eml"${CRLF}Content-Type: message/rfc822${CRLF}${CRLF}`,
      ),
      eml,
      Buffer.from(`${CRLF}--${fronteira}--${CRLF}`),
    ]);
    const res = await s.app.inject({
      method: 'POST',
      url: '/api/ingest',
      headers: { 'content-type': `multipart/form-data; boundary=${fronteira}` },
      payload: corpo,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { pedidoId: string }).pedidoId).toBe(CHAVE);
  });

  it('NF-e e planilha CSV no mesmo e-mail somam docs e eventos', async () => {
    const a = await novo();
    await enviar(a, 'nfe-ok.xml', NFE);
    const csv = await enviar(a, 'planilha.csv', lerBuf('planilha.csv'));
    const b = await novo();
    const r = await enviar(
      b,
      'pedido.eml',
      montarEml([{ tipo: 'text/csv', corpo: lerBuf('planilha.csv'), nome: 'planilha.csv', disposicao: 'attachment' }, anexoXml(NFE)]),
    );

    expect(r.status).toBe(200);
    expect(r.corpo['docs']).toBe(2);
    expect(r.corpo['eventos']).toBe((await a.store.todosEventos()).length);
    expect(normalizar(await b.store.todosEventos())).toEqual(normalizar(await a.store.todosEventos()));
    expect(csv.status).toBe(200);
  });

  it('dois CT-e sem pedido: revisaoId e o do primeiro e os dois entram na fila', async () => {
    const s = await novo();
    const orfao = (chave: string): Buffer => Buffer.from(CTE.toString('utf8').replaceAll(CHAVE, chave));
    const r = await enviar(
      s,
      'orfaos.eml',
      montarEml([anexoXml(orfao('35260100000000000100550010000099991000099991'), 'a.xml'), anexoXml(orfao('35260100000000000100550010000099992000099992'), 'b.xml')]),
    );
    const fila = await s.store.listarRevisao();

    expect(r.status).toBe(200);
    expect(r.corpo['docs']).toBe(2);
    expect(fila).toHaveLength(2);
    expect(r.corpo['revisaoId']).toBe(fila[0]!['id']);
  });

  it('.eml sem anexo aproveitavel responde 422 explicito e nao grava nada', async () => {
    const s = await novo();
    const r = await enviar(s, 'vazio.eml', montarEml([]));
    expect(r.status).toBe(422);
    expect(r.corpo['tipo']).toBe('parser');
    expect(r.corpo['erro']).toContain('nenhum anexo aproveitavel');
    expect(await s.store.todosEventos()).toHaveLength(0);
  });

  it('.eml dentro de .eml responde 422 e nao grava nada', async () => {
    const s = await novo();
    const interno = montarEml([anexoXml(NFE)]);
    const r = await enviar(s, 'externo.eml', montarEml([{ tipo: 'message/rfc822', corpo: interno, nome: 'interno.eml', disposicao: 'attachment' }]));
    expect(r.status).toBe(422);
    expect(r.corpo['erro']).toContain('outro e-mail');
    expect(await s.store.todosEventos()).toHaveLength(0);
  });

  it('anexo de tipo desconhecido ao lado de uma NF-e valida responde 422 sem ingestao parcial', async () => {
    const s = await novo();
    const r = await enviar(s, 'misto.eml', montarEml([anexoXml(NFE), anexoXml(Buffer.from('<foo><bar/></foo>'), 'x.xml')]));
    expect(r.status).toBe(422);
    expect(await s.store.todosEventos()).toHaveLength(0);
  });

  it('NF-e valida com planilha XLSX no mesmo e-mail responde 422 e nao grava nada (D-C13)', async () => {
    const s = await novo();
    const xlsx = { tipo: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', corpo: 'PK', nome: 'planilha.xlsx', disposicao: 'attachment' as const };
    const r = await enviar(s, 'pedido.eml', montarEml([anexoXml(NFE), xlsx]));
    expect(r.status).toBe(422);
    expect(r.corpo['erro']).toContain('exporte a planilha como CSV');
    expect(await s.store.todosEventos()).toHaveLength(0);
  });

  it('nenhum cabecalho do e-mail aparece em resposta, evento, revisao ou erro (RF27)', async () => {
    const s = await novo();
    const orfao = Buffer.from(CTE.toString('utf8').replaceAll(CHAVE, '35260100000000000100550010000099991000099991'));
    const respostas = [
      await enviar(s, 'ok.eml', montarEml([anexoXml(NFE)])),
      await enviar(s, 'orfao.eml', montarEml([anexoXml(orfao)])),
      await enviar(s, 'vazio.eml', montarEml([])),
      await enviar(s, 'aninhado.eml', montarEml([{ tipo: 'message/rfc822', corpo: montarEml([anexoXml(NFE)]), nome: 'x.eml' }])),
      await enviar(s, 'lixo.eml', Buffer.from(`${CABECALHOS.from}\n${CABECALHOS.subject}\n`)),
    ];
    const revisao = await s.app.inject({ method: 'GET', url: '/api/revisao' });
    const pedido = await s.app.inject({ method: 'GET', url: `/api/pedidos/${CHAVE}` });
    const superficies = [
      ...respostas.map((r) => r.texto),
      JSON.stringify(await s.store.todosEventos()),
      JSON.stringify(await s.store.listarRevisao()),
      revisao.body,
      pedido.body,
    ];

    expect(respostas.map((r) => r.status)).toEqual([200, 200, 422, 422, 422]);
    for (const texto of superficies) {
      for (const v of VALORES_SENSIVEIS) expect(texto).not.toContain(v);
    }
  });
});
