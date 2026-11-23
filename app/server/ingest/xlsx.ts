// Parser .xlsx (spec 0007, T120; caminho de volta de D-028/D-041): checa o
// zip ANTES de inflar (diretorio central, n. de arquivos, tamanho declarado e
// razao de expansao — arquivo que falha nunca infla nem chega ao worker) e
// le a planilha em worker_threads com resourceLimits + timeout, nunca no
// event loop. O worker devolve texto CSV com valores formatados, que entra
// no parseCsv sem mudanca. Sem a lib xlsx (CVE-2024-22363 + prototype
// pollution): o leitor e o exceljs 4.4.0 pinned.
// Falha estrutural (formula sem cache, mesclada ambigua, cabecalho fora do
// schema) nao e 422 e nao some linha: volta como item de revisao com motivo
// (o mapeamento por LLM de T124 anexa a proposta depois).

import { Worker } from 'node:worker_threads';
import type { DocData } from '../../shared/model.js';
import { nomeAnexoSeguro } from './imap.js';
import { ErroParser } from './nfe.js';
import { parseCsv } from './csv.js';
import type { ResultadoWorker } from './xlsx.worker.js';

// 'interrompido' so existe do lado de ca: o worker nao o emite, e o timer ou
// o kill por resourceLimits que decide (timeout/OOM tambem e 422, D-028).
type ResultadoLeitura = ResultadoWorker | { ok: false; tipo: 'interrompido'; detalhe: string };

export interface ResultadoXlsx {
  docs: DocData[];
  // Preenchido quando o arquivo e legitimo mas a estrutura nao fecha
  // (layout desconhecido, formula sem cache, mesclada): vai para a revisao.
  revisao: { motivo: string; payload: Record<string, unknown> } | null;
}

export interface OpcoesXlsx {
  // Nome do arquivo de origem: so entra na revisao na forma segura (basename).
  nome?: string;
  timeoutMs?: number;
  memoriaMb?: number;
  maxPartes?: number;
  maxInflado?: number;
  maxRazao?: number;
}

const inteiroOuPadrao = (env: string | undefined, padrao: number): number => {
  const n = Number(env);
  return Number.isSafeInteger(n) && n > 0 ? n : padrao;
};

const SUFIXO_CSV = 'exporte a planilha como CSV';
const corrompido = (motivo: string): ErroParser =>
  new ErroParser(`Planilha .xlsx nao suportada ou corrompida: ${motivo}; ${SUFIXO_CSV}`);
const recusada = (motivo: string): ErroParser => new ErroParser(`Planilha .xlsx recusada: ${motivo}`);

// ---- Checagem estrutural do zip (roda na thread principal, sem inflar) ----
// Le apenas o diretorio central no fim do arquivo: EOCD + entradas de 46+
// bytes, O(n) no numero de entradas, que ja sai limitado. Nada de inflate.

const ASSINATURA_EOCD = 0x06054b50;
const ASSINATURA_CD = 0x02014b50;
const ASSINATURA_LOCAL = 0x04034b50;

interface EntradaZip {
  comprimido: number;
  descomprimido: number;
}

// Acha o End Of Central Directory: assinatura nos ultimos 64 KB, com a
// condicao de que o comentario declarado feche exatamente o arquivo.
function acharEocd(buf: Buffer): number {
  const minimo = Math.max(0, buf.length - 22 - 0xffff);
  for (let p = buf.length - 22; p >= minimo; p--) {
    if (buf.readUInt32LE(p) !== ASSINATURA_EOCD) continue;
    const comentario = buf.readUInt16LE(p + 20);
    if (p + 22 + comentario === buf.length) return p;
  }
  throw corrompido('diretorio central do zip nao encontrado');
}

function checarZip(buf: Buffer, op: Required<Pick<OpcoesXlsx, 'maxPartes' | 'maxInflado' | 'maxRazao'>>): void {
  if (buf.length < 22) throw corrompido('arquivo menor que um registro de diretorio');
  const eocd = acharEocd(buf);

  // Multi-disco e zip64 nao sao produzidos pelo fluxo de planilha e nem o
  // exceljs (jszip) os le: rejeita antes de qualquer inflate.
  if (buf.readUInt16LE(eocd + 4) !== 0 || buf.readUInt16LE(eocd + 6) !== 0) {
    throw corrompido('zip multi-disco');
  }
  const entradas = buf.readUInt16LE(eocd + 10);
  const cdTamanho = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (entradas === 0xffff || cdTamanho === 0xffffffff || cdOffset === 0xffffffff) {
    throw corrompido('zip64 nao suportado');
  }
  if (entradas === 0) throw corrompido('zip sem arquivos');
  if (cdOffset + cdTamanho > eocd) throw corrompido('diretorio central fora dos limites do arquivo');
  if (entradas > op.maxPartes) {
    throw recusada(`${entradas.toLocaleString('pt-BR')} arquivos no zip, acima do limite de ${op.maxPartes.toLocaleString('pt-BR')}`);
  }

  const lidas: EntradaZip[] = [];
  let pos = cdOffset;
  for (let i = 0; i < entradas; i++) {
    if (pos + 46 > eocd || buf.readUInt32LE(pos) !== ASSINATURA_CD) {
      throw corrompido('entrada do diretorio central truncada ou invalida');
    }
    const flags = buf.readUInt16LE(pos + 8);
    const metodo = buf.readUInt16LE(pos + 10);
    const comprimido = buf.readUInt32LE(pos + 20);
    const descomprimido = buf.readUInt32LE(pos + 24);
    const nomeLen = buf.readUInt16LE(pos + 28);
    const extraLen = buf.readUInt16LE(pos + 30);
    const comentarioLen = buf.readUInt16LE(pos + 32);
    const localOff = buf.readUInt32LE(pos + 42);

    if (flags & 0x1) throw recusada('zip protegido por senha');
    if (metodo !== 0 && metodo !== 8) throw recusada(`metodo de compressao nao suportado (${metodo})`);
    // Tamanhos 0xFFFFFFFF pedem o extra zip64 que nao lemos.
    if (comprimido === 0xffffffff || descomprimido === 0xffffffff || localOff === 0xffffffff) {
      throw corrompido('zip64 nao suportado');
    }
    if (localOff + 4 > buf.length || buf.readUInt32LE(localOff) !== ASSINATURA_LOCAL) {
      throw corrompido('cabecalho local apontado pelo diretorio nao confere');
    }
    lidas.push({ comprimido, descomprimido });
    pos += 46 + nomeLen + extraLen + comentarioLen;
  }
  if (pos !== cdOffset + cdTamanho) throw corrompido('diretorio central com tamanho inconsistente');

  const totalDescomprimido = lidas.reduce((acc, e) => acc + e.descomprimido, 0);
  if (totalDescomprimido > op.maxInflado) {
    throw recusada(
      `declara ${(totalDescomprimido / 1024 / 1024).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} MB descomprimidos, acima do limite de ${Math.round(op.maxInflado / 1024 / 1024)} MB`,
    );
  }
  // Razao de expansao so decide acima do piso: em arquivo pequeno a razao e
  // ruido, e o teto absoluto acima ja limita o dano real.
  const razao = totalDescomprimido / buf.length;
  if (totalDescomprimido > 1024 * 1024 && razao > op.maxRazao) {
    throw recusada(`razao de expansao ${razao.toFixed(0)}:1, acima do limite de ${op.maxRazao}:1`);
  }
}

// ---- Leitura no worker (um por vez: a soma dos limites de memoria nao pode
// derrubar o processo da demo) ----

const WORKER_URL = new URL('./xlsx.worker.ts', import.meta.url);
// O worker e sempre node puro + tsx: resolve exceljs da mesma instalacao e
// nao herda flags do vitest nem do tsx pai.
const WORKER_EXEC_ARGV = ['--import', 'tsx'];

// Um worker por vez: dois arquivos com o teto de memoria abririam ~2x o
// limite e poderiam derrubar o processo da demo; a fila serializa a leitura.
let filaWorker: Promise<unknown> = Promise.resolve();

function lerNoWorker(buf: Buffer, timeoutMs: number, memoriaMb: number): Promise<ResultadoLeitura> {
  const rodar = (): Promise<ResultadoLeitura> =>
    new Promise((resolve) => {
      const worker = new Worker(WORKER_URL, {
        workerData: { arquivo: buf },
        resourceLimits: { maxOldGenerationSizeMb: memoriaMb, maxYoungGenerationSizeMb: 32 },
        execArgv: WORKER_EXEC_ARGV,
      });
      worker.unref();
      let feito = false;
      const fim = (r: ResultadoLeitura): void => {
        if (feito) return;
        feito = true;
        clearTimeout(timer);
        void worker.terminate().catch(() => {});
        resolve(r);
      };
      const timer = setTimeout(
        () => fim({ ok: false, tipo: 'interrompido', detalhe: `tempo excedido (${timeoutMs} ms)` }),
        timeoutMs,
      );
      timer.unref();
      worker.once('message', (m) => fim(m as ResultadoWorker));
      worker.once('error', (e: Error) => {
        // Kill por resourceLimits chega como erro, nao como exit != 0.
        if (/memory limit|heap out of memory/i.test(e.message)) {
          fim({ ok: false, tipo: 'interrompido', detalhe: 'memoria do worker excedida' });
        } else {
          fim({ ok: false, tipo: 'corrompido', detalhe: e.message });
        }
      });
      worker.once('exit', (code) => {
        if (code !== 0) {
          fim({ ok: false, tipo: 'interrompido', detalhe: `worker encerrado (codigo ${code}): tempo ou memoria excedidos` });
        } else {
          fim({ ok: false, tipo: 'interrompido', detalhe: 'worker saiu sem responder' });
        }
      });
    });
  const enfileirado = filaWorker.then(rodar, rodar);
  filaWorker = enfileirado.catch(() => {});
  return enfileirado;
}

export async function parseXlsx(buf: Buffer, opcoes: OpcoesXlsx = {}): Promise<ResultadoXlsx> {
  const limites = {
    maxPartes: opcoes.maxPartes ?? inteiroOuPadrao(process.env['XLSX_MAX_PARTES'], 512),
    maxInflado: opcoes.maxInflado ?? inteiroOuPadrao(process.env['XLSX_MAX_INFLADO_BYTES'], 64 * 1024 * 1024),
    maxRazao: opcoes.maxRazao ?? inteiroOuPadrao(process.env['XLSX_MAX_RAZAO'], 100),
  };
  const timeoutMs = opcoes.timeoutMs ?? inteiroOuPadrao(process.env['XLSX_TIMEOUT_MS'], 10_000);
  const memoriaMb = opcoes.memoriaMb ?? inteiroOuPadrao(process.env['XLSX_WORKER_MEM_MB'], 256);

  checarZip(buf, limites); // 422 aqui: arquivo que falha nunca infla.
  const r = await lerNoWorker(buf, timeoutMs, memoriaMb);
  const arquivo = opcoes.nome ? nomeAnexoSeguro(opcoes.nome) : undefined;

  if (!r.ok) {
    if (r.tipo === 'interrompido') throw recusada(`leitura interrompida: ${r.detalhe}`);
    if (r.tipo === 'corrompido') throw corrompido(r.detalhe);
    return {
      docs: [],
      revisao: {
        motivo: r.motivo,
        payload: { arquivo, planilha: r.planilha, cabecalho: r.cabecalho, detalhe: r.detalhe },
      },
    };
  }

  try {
    return { docs: parseCsv(r.csv), revisao: null };
  } catch (e) {
    if (!(e instanceof ErroParser)) throw e;
    // Layout legitimo fora do schema: nao e 422 e nenhuma linha some — vai
    // para a revisao com o contexto que T124 usa para propor o mapeamento.
    return {
      docs: [],
      revisao: {
        motivo: 'xlsx_layout_desconhecido',
        payload: { arquivo, planilha: r.planilha, cabecalho: r.cabecalho, amostraCsv: r.csv.slice(0, 4000) },
      },
    };
  }
}
