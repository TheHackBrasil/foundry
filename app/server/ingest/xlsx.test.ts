// Parser .xlsx (spec 0007, T120-T123; D-028/D-041): o .xlsx legitimo gera os
// mesmos documentos e os mesmos eventos do CSV equivalente; zip malformado,
// falso ou com expansao absurda responde 422 sem inflar nem travar; layout
// fora do schema vai para a revisao com motivo (RF11, T124 completa depois).
// Fixtures .xlsx sao geradas com exceljs; os zips "corrompidos" dos testes sao
// feitos remendando bytes de uma fixture valida ou montando o zip na mao.

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { createLiteDb } from '../db.js';
import { buildServer } from '../index.js';
import { aprovarRevisao, ingerir } from '../pipeline.js';
import { carregarSeed } from '../seed.js';
import { CanalSSE } from '../sse.js';
import { LedgerStore } from '../store.js';
import { detectarTipo } from './detect.js';
import { ErroParser } from './nfe.js';
import { parseCsv } from './csv.js';
import { parseXlsx } from './xlsx.js';

const FIX = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const ler = (f: string): Buffer => readFileSync(join(FIX, f));
const CHAVE = '35260123456789000123550010000000011000000019';
const WS = '00000000-0000-4000-8000-00000000d001';

async function novo() {
  const db = await createLiteDb();
  const store = new LedgerStore(db, WS, 'seed');
  await store.init();
  return { db, store, canal: new CanalSSE('seed') };
}

// Offset do registro EOCD e da primeira entrada do diretorio central, para
// remendar bytes da fixture valida nos testes de recusa.
function offsets(buf: Buffer): { eocd: number; cd: number } {
  let eocd = -1;
  for (let p = buf.length - 22; p >= Math.max(0, buf.length - 22 - 0xffff); p--) {
    if (buf.readUInt32LE(p) === 0x06054b50 && p + 22 + buf.readUInt16LE(p + 20) === buf.length) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) throw new Error('fixture sem EOCD');
  return { eocd, cd: buf.readUInt32LE(eocd + 16) };
}

describe('detectarTipo', () => {
  const zip = ler('planilha.xlsx');
  it('.xlsx e .XLSX viram tipo xlsx', () => {
    expect(detectarTipo('planilha.xlsx', zip)).toBe('xlsx');
    expect(detectarTipo('planilha.XLSX', zip)).toBe('xlsx');
  });
  it('.xls (formato antigo) segue 422 com orientacao', () => {
    expect(() => detectarTipo('planilha.xls', zip)).toThrowError(/nao suportada/);
    expect(() => detectarTipo('planilha.XLS', zip)).toThrowError(/exporte a planilha como CSV/);
  });
});

describe('parseXlsx: equivalencia com o CSV', () => {
  it('planilha.xlsx da fixture gera os mesmos DocData da planilha.csv', async () => {
    const viaCsv = parseCsv(ler('planilha.csv').toString('utf8'));
    const r = await parseXlsx(ler('planilha.xlsx'), { nome: 'planilha.xlsx' });
    expect(r.revisao).toBeNull();
    expect(r.docs).toEqual(viaCsv);
  });

  it('data serial sai AAAA-MM-DD e data em texto dd/mm/aaaa converte igual', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dados');
    ws.addRow(['chave_nf', 'data_prevista']);
    const linha = ws.addRow([CHAVE, new Date(Date.UTC(2026, 0, 25))]);
    linha.getCell(2).numFmt = 'dd/mm/yyyy';
    ws.addRow(['35260100000000000100550010000099991000099991', '30/01/2026']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await parseXlsx(buf);
    expect(r.docs).toHaveLength(2);
    expect(r.docs[0]!.campos.previsaoEntrega).toBe('2026-01-25'); // serial real
    expect(r.docs[1]!.campos.previsaoEntrega).toBe('2026-01-30'); // texto BR
  });

  it('escolhe a planilha com o cabecalho esperado, nao a primeira', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Capa').addRow(['Relatorio de embarques — janeiro']);
    const dados = wb.addWorksheet('Dados');
    dados.addRow(['chave_nf', 'peso_kg']);
    dados.addRow([CHAVE, 520]);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await parseXlsx(buf);
    expect(r.docs).toHaveLength(1);
    expect(r.docs[0]!.campos.pesoTotal).toBe(520);
  });
});

describe('checagem do zip: falha estrutural nunca infla (D-028)', () => {
  it('falso .xlsx (PK mas sem diretorio central): 422, sem worker', async () => {
    const inicio = Date.now();
    await expect(parseXlsx(Buffer.from('PK\x03\x04 conteudo qualquer'))).rejects.toBeInstanceOf(ErroParser);
    await expect(parseXlsx(Buffer.from('PK\x03\x04 conteudo qualquer'))).rejects.toThrowError(/diretorio central/);
    expect(Date.now() - inicio).toBeLessThan(2_000); // recusa e imediata, nada inflou
  });

  it('arquivo que nem e zip: 422', async () => {
    await expect(parseXlsx(Buffer.from('isto nao e uma planilha'))).rejects.toThrowError(ErroParser);
  });

  it('zip cortado no meio: 422 e o processo segue em pe', async () => {
    const buf = ler('planilha.xlsx');
    await expect(parseXlsx(buf.subarray(0, 40))).rejects.toThrowError(ErroParser);
    const r = await parseXlsx(buf); // processo vivo: a fixture boa continua lendo
    expect(r.docs).toHaveLength(1);
  });

  it('expansao absurda declarada no diretorio: 422 antes de inflar', async () => {
    const buf = Buffer.from(ler('planilha.xlsx'));
    const { cd } = offsets(buf);
    buf.writeUInt32LE(300 * 1024 * 1024, cd + 24); // tamanho descomprimido declarado
    const inicio = Date.now();
    await expect(parseXlsx(buf)).rejects.toThrowError(/acima do limite/);
    expect(Date.now() - inicio).toBeLessThan(2_000);
    // E o processo segue atendendo: a mesma fixture sem remendo le normal.
    expect((await parseXlsx(ler('planilha.xlsx'))).docs).toHaveLength(1);
  });

  it('razao de expansao acima do limite: 422', async () => {
    const buf = Buffer.from(ler('planilha.xlsx'));
    const { cd } = offsets(buf);
    buf.writeUInt32LE(4 * 1024 * 1024, cd + 24); // 4 MB declarado num zip de ~7 KB
    await expect(parseXlsx(buf)).rejects.toThrowError(/razao de expansao/);
  });

  it('mais arquivos que o teto do diretorio: 422', async () => {
    const buf = Buffer.from(ler('planilha.xlsx'));
    const { eocd } = offsets(buf);
    buf.writeUInt16LE(600, eocd + 10); // total de entradas do diretorio
    await expect(parseXlsx(buf, { maxPartes: 512 })).rejects.toThrowError(/arquivos no zip/);
  });

  it('zip64 declarado: 422', async () => {
    const buf = Buffer.from(ler('planilha.xlsx'));
    const { eocd } = offsets(buf);
    buf.writeUInt16LE(0xffff, eocd + 10);
    await expect(parseXlsx(buf)).rejects.toThrowError(/zip64/);
  });

  it('entrada com senha ou metodo desconhecido: 422', async () => {
    const comSenha = Buffer.from(ler('planilha.xlsx'));
    comSenha.writeUInt16LE(0x1, offsets(comSenha).cd + 8);
    await expect(parseXlsx(comSenha)).rejects.toThrowError(/senha/);

    const metodoEstranho = Buffer.from(ler('planilha.xlsx'));
    metodoEstranho.writeUInt16LE(99, offsets(metodoEstranho).cd + 10);
    await expect(parseXlsx(metodoEstranho)).rejects.toThrowError(/compressao/);
  });

  it('zip valido que nao e planilha: o worker responde 422, sem travar', async () => {
    // Zip minimo feito a mao: uma entrada "stored" com lixo dentro. Passa na
    // checagem estrutural (diretorio coerente) e o exceljs falha no worker.
    const conteudo = Buffer.from('isso nao e uma planilha');
    const nome = Buffer.from('xl/workbook.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // versao
    local.writeUInt16LE(8, 8); // flags
    local.writeUInt16LE(0, 10); // metodo stored
    local.writeUInt32LE(conteudo.length, 18);
    local.writeUInt32LE(conteudo.length, 22);
    local.writeUInt16LE(nome.length, 26);
    const cdEntrada = Buffer.alloc(46);
    cdEntrada.writeUInt32LE(0x02014b50, 0);
    cdEntrada.writeUInt16LE(20, 4);
    cdEntrada.writeUInt16LE(20, 6);
    cdEntrada.writeUInt16LE(8, 8);
    cdEntrada.writeUInt16LE(0, 10);
    cdEntrada.writeUInt32LE(0, 16); // crc zerado
    cdEntrada.writeUInt32LE(conteudo.length, 20);
    cdEntrada.writeUInt32LE(conteudo.length, 24);
    cdEntrada.writeUInt16LE(nome.length, 28);
    const corpo = Buffer.concat([local, nome, conteudo]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cdEntrada.length + nome.length, 12);
    eocd.writeUInt32LE(corpo.length, 16);
    const zip = Buffer.concat([corpo, cdEntrada, nome, eocd]);

    await expect(parseXlsx(zip)).rejects.toThrowError(ErroParser);
    expect((await parseXlsx(ler('planilha.xlsx'))).docs).toHaveLength(1); // processo segue
  });

  it('worker estourando o teto de memoria: 422 de leitura interrompida', async () => {
    await expect(parseXlsx(ler('planilha.xlsx'), { memoriaMb: 4 })).rejects.toThrowError(/interrompida/);
  });

  it('worker mais lento que o timeout: 422 de leitura interrompida', async () => {
    await expect(parseXlsx(ler('planilha.xlsx'), { timeoutMs: 1 })).rejects.toThrowError(/interrompida/);
  });

  it('diretorio mentiroso (declara 1 KB, deflates ~64 MB): 422 e processo em pe (S3)', async () => {
    // A checagem estrutural le o que o diretorio central DECLARA; um arquivo
    // pode mentir tamanho pequeno e carregar um deflate que explode de
    // verdade. Quem segura e a segunda linha de defesa: o inflate roda no
    // worker, onde resourceLimits mata o excesso sem derrubar o processo —
    // ou o proprio jszip rejeita o livro. As duas saidas sao ErroParser e
    // o servidor segue atendendo.
    const { deflateRawSync } = await import('node:zlib');
    const dados = deflateRawSync(Buffer.alloc(64 * 1024 * 1024, 0x61)); // 64 MB de 'a'
    const nome = Buffer.from('xl/worksheets/sheet1.xml');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(8, 8); // metodo deflate
    local.writeUInt32LE(0, 16); // crc mentiroso tambem
    local.writeUInt32LE(dados.length, 18);
    local.writeUInt32LE(1024, 22); // descomprimido mentiroso: 1 KB
    local.writeUInt16LE(nome.length, 26);
    const cdEntrada = Buffer.alloc(46);
    cdEntrada.writeUInt32LE(0x02014b50, 0);
    cdEntrada.writeUInt16LE(20, 4);
    cdEntrada.writeUInt16LE(20, 6);
    cdEntrada.writeUInt16LE(8, 10);
    cdEntrada.writeUInt32LE(0, 16);
    cdEntrada.writeUInt32LE(dados.length, 20);
    cdEntrada.writeUInt32LE(1024, 24); // mentira repetida no diretorio
    cdEntrada.writeUInt16LE(nome.length, 28);
    const corpo = Buffer.concat([local, nome, dados]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(cdEntrada.length + nome.length, 12);
    eocd.writeUInt32LE(corpo.length, 16);
    const zip = Buffer.concat([corpo, cdEntrada, nome, eocd]);

    // Passa na checagem (tudo declarado e coerente) e morre no worker com
    // memoria baixa — 422, nunca 500 nem queda.
    await expect(parseXlsx(zip, { memoriaMb: 32 })).rejects.toThrowError(ErroParser);
    expect((await parseXlsx(ler('planilha.xlsx'))).docs).toHaveLength(1);
  });
});

describe('falha estrutural legitima: revisao com motivo, nunca 422 nem linha sumida', () => {
  it('cabecalho fora do schema (fixture t124): revisao xlsx_layout_desconhecido', async () => {
    const r = await parseXlsx(ler(join('t124', 'planilha-desconhecida.xlsx')), { nome: '../../etc/planilha.xlsx' });
    expect(r.docs).toHaveLength(0);
    expect(r.revisao?.motivo).toBe('xlsx_layout_desconhecido');
    expect(r.revisao?.payload['cabecalho']).toEqual(['Rastreio', 'Janela', 'Motorista', 'Observacao']);
    expect(String(r.revisao?.payload['amostraCsv'])).toContain('BR-7731');
    expect(r.revisao?.payload['arquivo']).toBe('planilha.xlsx'); // basename seguro
    // O CSV inteiro viaja no item: e o que a aprovacao re-ingere com o
    // mapeamento (T124); acima do teto XLSX_REVISAO_MAX_CSV vira truncado.
    expect(String(r.revisao?.payload['csvCompleto'])).toContain('BR-7731');
  });

  it('layout desconhecido com CSV acima do teto: item vai truncado', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Grande');
    ws.addRow(['ColunaEstranha', 'Outra']);
    ws.addRow(['valor-longo-'.repeat(20), 'mais-valor']);
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const antes = process.env['XLSX_REVISAO_MAX_CSV'];
    process.env['XLSX_REVISAO_MAX_CSV'] = '64'; // teto minusculo so para o teste
    try {
      const r = await parseXlsx(buf, { nome: 'grande.xlsx' });
      expect(r.revisao?.motivo).toBe('xlsx_layout_desconhecido');
      expect(r.revisao?.payload['csvCompleto']).toBeUndefined();
      expect(r.revisao?.payload['truncado']).toBe(true);
      // A amostra segue disponivel para a proposta de mapeamento.
      expect(String(r.revisao?.payload['amostraCsv'])).toContain('ColunaEstranha');
    } finally {
      if (antes === undefined) delete process.env['XLSX_REVISAO_MAX_CSV'];
      else process.env['XLSX_REVISAO_MAX_CSV'] = antes;
    }
  });

  it('formula sem valor cacheado: revisao xlsx_formula_sem_cache', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dados');
    ws.addRow(['chave_nf', 'peso_kg']);
    ws.addRow([CHAVE, 520]);
    ws.getCell('B3').value = { formula: 'B2*2' } as ExcelJS.CellValue;
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await parseXlsx(buf);
    expect(r.docs).toHaveLength(0);
    expect(r.revisao?.motivo).toBe('xlsx_formula_sem_cache');
    expect(String(r.revisao?.payload['detalhe'])).toContain('B3');
  });

  it('celula mesclada sobre os dados: revisao xlsx_mesclada', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Dados');
    ws.addRow(['chave_nf', 'peso_kg']);
    ws.addRow([CHAVE, 520]);
    ws.mergeCells('A3:B3');
    const buf = Buffer.from(await wb.xlsx.writeBuffer());

    const r = await parseXlsx(buf);
    expect(r.docs).toHaveLength(0);
    expect(r.revisao?.motivo).toBe('xlsx_mesclada');
  });
});

describe('pipeline: upload, .eml e seed com xlsx (T121)', () => {
  it('xlsx legitimo gera os mesmos eventos que o CSV equivalente', async () => {
    const { db, store, canal } = await novo();
    await ingerir(store, canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    const csv = await ingerir(store, canal, 'planilha.csv', ler('planilha.csv'));
    const xlsx = await ingerir(store, canal, 'planilha.xlsx', ler('planilha.xlsx'));

    // CSV gravou o documento; o xlsx identico e no-op idempotente (eventoExiste).
    expect(csv.eventos.map((e) => e.tipo)).toContain('planilha');
    expect(xlsx.eventos).toHaveLength(0);
    const evs = await store.eventosDoPedido(CHAVE);
    expect(evs.filter((e) => e.tipo === 'planilha')).toHaveLength(1);
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });

  it('xlsx sozinho grava o mesmo conjunto de eventos que o CSV sozinho', async () => {
    const a = await novo();
    const b = await novo();
    await ingerir(a.store, a.canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    await ingerir(b.store, b.canal, 'nfe-ok.xml', ler('nfe-ok.xml'));
    const ra = await ingerir(a.store, a.canal, 'planilha.csv', ler('planilha.csv'));
    const rb = await ingerir(b.store, b.canal, 'planilha.xlsx', ler('planilha.xlsx'));

    // spec 0011: claims e token sao volateis por design.
    const limpar = (p: Record<string, unknown>) => {
      const { claims, token, ...resto } = p;
      return resto;
    };
    const norm = (evs: { tipo: string; payload: unknown }[]) =>
      evs.map((e) => ({ tipo: e.tipo, payload: limpar(e.payload as Record<string, unknown>) }));
    expect(norm(rb.eventos)).toEqual(norm(ra.eventos));
    await a.db.close();
    await b.db.close();
  });

  it('.eml com anexo xlsx segue o mesmo caminho', async () => {
    const { db, store, canal } = await novo();
    const b64 = ler('planilha.xlsx').toString('base64').match(/.{1,76}/g)!.join('\r\n');
    const eml = Buffer.from(
      [
        'From: fornecedor@exemplo.com.br',
        'To: foundry@exemplo.com.br',
        'Subject: planilha',
        'MIME-Version: 1.0',
        'Content-Type: multipart/mixed; boundary=BX',
        '',
        '--BX',
        'Content-Type: text/plain; charset=utf-8',
        '',
        'segue a planilha',
        '',
        '--BX',
        'Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet; name=planilha.xlsx',
        'Content-Transfer-Encoding: base64',
        'Content-Disposition: attachment; filename=planilha.xlsx',
        '',
        b64,
        '',
        '--BX--',
        '',
      ].join('\r\n'),
    );
    const r = await ingerir(store, canal, 'email.eml', eml);
    expect(r.docs).toBe(1);
    expect(r.eventos.map((e) => e.tipo)).toEqual(['planilha']);
    await db.close();
  });

  it('xlsx fora do schema vai para a fila de revisao e aprovacao nao grava doc', async () => {
    const { db, store, canal } = await novo();
    const r = await ingerir(store, canal, 'desconhecida.xlsx', ler(join('t124', 'planilha-desconhecida.xlsx')));
    expect(r.revisaoId).not.toBeNull();
    const item = await store.buscarRevisao(r.revisaoId!);
    expect(item?.['motivo']).toBe('xlsx_layout_desconhecido');
    // Aprovar um item sem doc completo nao quebra: nada acontece (404 na rota).
    expect(await aprovarRevisao(store, canal, r.revisaoId!)).toBeNull();
    expect((await store.buscarRevisao(r.revisaoId!))?.['status']).toBe('pendente');
    await db.close();
  });

  it('seed ingere o .xlsx na ordem, como no-op depois da planilha.csv', async () => {
    const db = await createLiteDb();
    const store = new LedgerStore(db, 'seed', 'seed');
    await store.init();
    const canal = new CanalSSE('seed');
    const logs: string[] = [];
    const r = await carregarSeed(store, canal, (m) => logs.push(m));

    expect(r.ingeridos).toBeGreaterThan(0);
    const evs = await store.eventosDoPedido(CHAVE);
    // planilha.csv e planilha.xlsx produzem o mesmo evento: um so foi gravado.
    expect(evs.filter((e) => e.tipo === 'planilha')).toHaveLength(1);
    expect(evs.filter((e) => e.tipo === 'cce')).toHaveLength(2); // correcao + reagendamento
    expect((await store.auditar(CHAVE)).valida).toBe(true);
    await db.close();
  });
});

describe('POST /api/ingest com .xlsx', () => {
  it('xlsx legitimo responde 200 com os mesmos eventos do CSV; falso responde 422', async () => {
    const s = await buildServer(await createLiteDb());
    await s.app.ready();
    const novaSessao = async (): Promise<string> => {
      const res = await s.app.inject({ method: 'GET', url: '/api/pedidos' });
      const bruto = res.headers['set-cookie'];
      return (Array.isArray(bruto) ? String(bruto[0]) : String(bruto)).split(';')[0]!;
    };
    const enviar = (cookie: string, nome: string, conteudo: Buffer) =>
      s.app.inject({ method: 'POST', url: '/api/ingest', headers: { cookie }, payload: { nome, conteudoBase64: conteudo.toString('base64') } });

    const a = await novaSessao();
    const b = await novaSessao();
    const viaCsv = await enviar(a, 'planilha.csv', ler('planilha.csv'));
    const viaXlsx = await enviar(b, 'planilha.xlsx', ler('planilha.xlsx'));
    expect(viaCsv.statusCode).toBe(200);
    expect(viaXlsx.statusCode).toBe(200);
    // Mesmos eventos: a planilha cria o pedido, entao o conjunto gravado fecha igual.
    expect(viaXlsx.json()['eventos']).toBe(viaCsv.json()['eventos']);
    // spec 0011: claims e token sao volateis por design.
    const limpar = (p: Record<string, unknown>) => {
      const { claims, token, ...resto } = p;
      return resto;
    };
    const evsA = (await s.store.paraWorkspace(a.split('=')[1]!).todosEventos()).map((e) => ({ tipo: e.tipo, payload: limpar(e.payload) }));
    const evsB = (await s.store.paraWorkspace(b.split('=')[1]!).todosEventos()).map((e) => ({ tipo: e.tipo, payload: limpar(e.payload) }));
    expect(evsB).toEqual(evsA);

    const falso = await enviar(await novaSessao(), 'falso.xlsx', Buffer.from('PK\x03\x04 lixo'));
    expect(falso.statusCode).toBe(422);
    expect(falso.json()['tipo']).toBe('parser');
    await s.app.close();
  });
});
