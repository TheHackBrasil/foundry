// Extracao de PDF (spec 0004, T035): texto via pdf-parse; campos via
// LLM quando LLM_API_URL esta configurada. Sem LLM ou confianca baixa
// vai para a fila de revisao (A7).

import { PDFParse } from 'pdf-parse';
import type { CamposObservados, DocData } from '../../shared/model.js';
import { ErroParser } from './nfe.js';

export interface ResultadoPdf {
  doc: DocData | null; // null = foi para revisao
  revisao: { motivo: string; payload: Record<string, unknown> } | null;
}

const PROMPT = `Extraia deste documento logistico os campos abaixo e responda APENAS JSON:
{"chave_nfe": string|null, "data_prevista": "AAAA-MM-DD"|null, "peso_kg": number|null, "volumes": number|null, "status": string|null, "confianca": 0..1}
Documento:
`;

interface RespostaLlm {
  chave_nfe?: string | null;
  data_prevista?: string | null;
  peso_kg?: number | null;
  volumes?: number | null;
  status?: string | null;
  confianca?: number;
}

export interface OpcoesPdf {
  maxPaginas?: number;
  maxTexto?: number;
  timeoutMs?: number;
}

const inteiroOuPadrao = (env: string | undefined, padrao: number): number => {
  const n = Number(env);
  return Number.isSafeInteger(n) && n > 0 ? n : padrao;
};

export async function parsePdf(buffer: Buffer, opcoes: OpcoesPdf = {}): Promise<ResultadoPdf> {
  const maxPaginas = opcoes.maxPaginas ?? inteiroOuPadrao(process.env['PDF_MAX_PAGINAS'], 100);
  const maxTexto = opcoes.maxTexto ?? inteiroOuPadrao(process.env['PDF_MAX_TEXTO_CHARS'], 500_000);
  const timeoutMs = opcoes.timeoutMs ?? inteiroOuPadrao(process.env['LLM_TIMEOUT_MS'], 15_000);

  let texto: string;
  try {
    const parser = new PDFParse({ data: new Uint8Array(buffer) });
    try {
      const r = await parser.getText();
      // Teto de expansao: um PDF inflado nao pode estourar memoria nem a cota.
      if (r.total > maxPaginas) {
        throw new ErroParser(`PDF: ${r.total} paginas, acima do limite de ${maxPaginas} da demonstracao`);
      }
      texto = r.text?.trim() ?? '';
      if (texto.length > maxTexto) {
        throw new ErroParser(`PDF: texto extraido acima do limite de ${maxTexto} caracteres da demonstracao`);
      }
    } finally {
      await parser.destroy();
    }
  } catch (e) {
    if (e instanceof ErroParser) throw e;
    throw new ErroParser(`PDF: falha ao ler (${(e as Error).message})`);
  }
  if (!texto) {
    return {
      doc: null,
      revisao: { motivo: 'pdf_sem_texto_extraivel', payload: { tamanho: buffer.length } },
    };
  }

  const url = process.env['LLM_API_URL'];
  const chave = process.env['LLM_API_KEY'];
  if (!url || !chave) {
    return {
      doc: null,
      revisao: {
        motivo: 'llm_nao_configurada',
        payload: { textoPreview: texto.slice(0, 500) },
      },
    };
  }

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${chave}` },
      signal: AbortSignal.timeout(timeoutMs), // LLM externo nao pode segurar o envio para sempre
      body: JSON.stringify({
        model: process.env['LLM_MODEL'] ?? 'gpt-4o-mini',
        messages: [{ role: 'user', content: PROMPT + texto.slice(0, 8000) }],
        response_format: { type: 'json_object' },
      }),
    });
    if (!resp.ok) throw new Error(`LLM HTTP ${resp.status}`);
    const json = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const conteudo = json.choices?.[0]?.message?.content ?? '{}';
    const ext = JSON.parse(conteudo) as RespostaLlm;
    const conf = ext.confianca ?? 0;

    // Extracao de fora: tipo errado num campo invalida a resposta inteira.
    const tiposOk =
      (ext.chave_nfe == null || typeof ext.chave_nfe === 'string') &&
      (ext.data_prevista == null || typeof ext.data_prevista === 'string') &&
      (ext.peso_kg == null || (typeof ext.peso_kg === 'number' && Number.isFinite(ext.peso_kg))) &&
      (ext.volumes == null || (typeof ext.volumes === 'number' && Number.isFinite(ext.volumes))) &&
      (ext.status == null || typeof ext.status === 'string') &&
      (ext.confianca === undefined || (typeof ext.confianca === 'number' && Number.isFinite(ext.confianca)));
    if (!tiposOk) {
      return {
        doc: null,
        revisao: {
          motivo: 'extracao_invalida',
          payload: { extracao: ext, textoPreview: texto.slice(0, 500) },
        },
      };
    }

    // DANFE imprime a chave em grupos de 4 com espacos; normaliza para digitos.
    const chaveDigitos = ext.chave_nfe?.replace(/\D/g, '') ?? '';
    const pedidoId = /^\d{44}$/.test(chaveDigitos) ? chaveDigitos : null;
    if (!pedidoId || conf < 0.7) {
      return {
        doc: null,
        revisao: {
          motivo: pedidoId ? 'confianca_baixa' : 'chave_nfe_ausente',
          payload: { confianca: conf, extracao: ext, textoPreview: texto.slice(0, 500) },
        },
      };
    }

    const campos: CamposObservados = {};
    if (ext.data_prevista) campos.previsaoEntrega = ext.data_prevista;
    if (ext.peso_kg != null) campos.pesoTotal = ext.peso_kg;
    if (ext.volumes != null) campos.volumes = ext.volumes;
    if (ext.status) campos.status = ext.status;

    return {
      doc: {
        fonte: 'pdf',
        docTipo: 'pdf',
        pedidoId,
        campos,
        confianca: conf,
        dados: { extracao: ext },
      },
      revisao: null,
    };
  } catch (e) {
    return {
      doc: null,
      revisao: {
        motivo: 'llm_falhou',
        payload: { erro: (e as Error).message, textoPreview: texto.slice(0, 500) },
      },
    };
  }
}
