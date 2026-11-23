// Worker do parser .xlsx (spec 0007, T120; caminho de volta de D-028/D-041):
// roda dentro de worker_threads com resourceLimits, fora do event loop. Le o
// livro com exceljs (datas do Excel sao seriais: cell.value ja sai como Date),
// escolhe a planilha (a primeira com cabecalho reconhecido, senao a primeira
// com conteudo) e emite texto CSV com valores primitivos. O texto volta ao
// processo principal e entra no parseCsv, que segue o unico parser tabular.
// Falha estrutural (formula sem valor cacheado, celula mesclada sobre os
// dados) nao derruba nem some linha: volta como 'estrutural' e vira revisao.

import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import ExcelJS from 'exceljs';
import { cabecalhoTemChave } from './csv.js';

export type ResultadoWorker =
  | { ok: true; csv: string; planilha: string; cabecalho: string[] }
  | { ok: false; tipo: 'corrompido'; detalhe: string }
  | { ok: false; tipo: 'estrutural'; motivo: string; detalhe: string; planilha: string; cabecalho: string[] };

class FormulaSemCache extends Error {}

function escapeCsv(texto: string): string {
  return /[",\n\r]/.test(texto) ? `"${texto.replaceAll('"', '""')}"` : texto;
}

// Valor primitivo da celula para o CSV. Data sai em AAAA-MM-DD: o exceljs
// devolve Date em UTC (medianoche do dia seriado), entao toISOString corta
// certo — cell.text renderizaria no fuso local e poderia andar um dia.
function valorTexto(v: unknown, endereco: string): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v !== 'object') return String(v);
  const o = v as Record<string, unknown>;
  if ('formula' in o || 'sharedFormula' in o) {
    // Celula de formula sem valor cacheado (arquivo que nunca passou pelo
    // Excel): nao ha como saber o valor; o motivo sobe para a revisao.
    if (o['result'] === undefined) throw new FormulaSemCache(endereco);
    return valorTexto(o['result'], endereco);
  }
  if ('richText' in o && Array.isArray(o['richText'])) {
    return (o['richText'] as Array<{ text: string }>).map((t) => t.text).join('');
  }
  if ('error' in o) return ''; // #N/A e afins nao carregam valor
  if ('text' in o) return String(o['text']); // hyperlink e afins
  return String(v);
}

function linhaTexto(row: ExcelJS.Row, colunas: number): string[] {
  const celulas: string[] = [];
  for (let c = 1; c <= colunas; c++) {
    celulas.push(valorTexto(row.getCell(c).value, row.getCell(c).address));
  }
  return celulas;
}

// Primeira linha com conteudo e o candidato a cabecalho; tolera celula com
// formula sem cache na varredura (o flag correto vem na serializacao).
function cabecalhoDaFolha(folha: ExcelJS.Worksheet): { numero: number; texto: string[] } {
  let achada: { numero: number; texto: string[] } = { numero: 1, texto: [] };
  folha.eachRow({ includeEmpty: false }, (row, numero) => {
    if (achada.texto.length === 0) {
      const texto: string[] = [];
      for (let c = 1; c <= folha.columnCount; c++) {
        const cell = row.getCell(c);
        try {
          texto.push(valorTexto(cell.value, cell.address));
        } catch {
          texto.push('');
        }
      }
      achada = { numero, texto };
    }
  });
  return achada;
}

// Linha final do range 'A1:B2' (ou a unica, 'A1'): mescla que alcanca o
// cabecalho ou os dados torna a leitura por coluna ambigua.
function linhaFinalDoRange(range: string): number {
  const ultima = range.split(':').at(-1) ?? range;
  return Number(ultima.replace(/\D/g, '')) || 0;
}

async function executar(arquivo: Buffer | Uint8Array): Promise<ResultadoWorker> {
  const livro = new ExcelJS.Workbook();
  try {
    // As tipagens do exceljs 4.4.0 pedem o `Buffer` da @types/node antiga;
    // no runtime o load aceita o buffer como esta.
    await livro.xlsx.load(Buffer.from(arquivo) as unknown as Parameters<typeof livro.xlsx.load>[0]);
  } catch (e) {
    return { ok: false, tipo: 'corrompido', detalhe: (e as Error).message };
  }

  // Primeiro a planilha cujo cabecalho o parseCsv reconhece; sem ela, a
  // primeira com conteudo (o layout desconhecido vira revisao adiante).
  let folha: ExcelJS.Worksheet | undefined;
  let cabecalho: string[] = [];
  let linhaCabecalho = 1;
  for (const ws of livro.worksheets) {
    const h = cabecalhoDaFolha(ws);
    if (h.texto.length > 0 && cabecalhoTemChave(h.texto)) {
      folha = ws;
      cabecalho = h.texto;
      linhaCabecalho = h.numero;
      break;
    }
  }
  folha ??= livro.worksheets.find((w) => w.actualRowCount > 0);
  if (!folha) return { ok: true, csv: '', planilha: '', cabecalho: [] };
  if (cabecalho.length === 0) {
    const h = cabecalhoDaFolha(folha);
    cabecalho = h.texto;
    linhaCabecalho = h.numero;
  }

  for (const range of folha.model?.merges ?? []) {
    if (linhaFinalDoRange(range) >= linhaCabecalho) {
      return {
        ok: false,
        tipo: 'estrutural',
        motivo: 'xlsx_mesclada',
        detalhe: `celulas mescladas em ${range}`,
        planilha: folha.name,
        cabecalho,
      };
    }
  }

  const linhas: string[] = [];
  try {
    folha.eachRow({ includeEmpty: false }, (row) => {
      linhas.push(linhaTexto(row, folha.columnCount).map(escapeCsv).join(','));
    });
  } catch (e) {
    if (e instanceof FormulaSemCache) {
      return {
        ok: false,
        tipo: 'estrutural',
        motivo: 'xlsx_formula_sem_cache',
        detalhe: `formula sem valor cacheado em ${e.message}`,
        planilha: folha.name,
        cabecalho,
      };
    }
    throw e;
  }
  return { ok: true, csv: linhas.join('\r\n'), planilha: folha.name, cabecalho };
}

if (!isMainThread && parentPort) {
  const porta = parentPort;
  void executar((workerData as { arquivo: Buffer }).arquivo).then(
    (r) => porta.postMessage(r),
    (e) => porta.postMessage({ ok: false, tipo: 'corrompido', detalhe: (e as Error).message }),
  );
}
