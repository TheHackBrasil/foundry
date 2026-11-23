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
  chave_nfe?: unknown;
  data_prevista?: unknown;
  peso_kg?: unknown;
  volumes?: unknown;
  status?: unknown;
  confianca?: unknown;
}

// Registro do que a validacao de tipo fez com cada campo (RF2 da spec 0007):
// normalizado por regra explicita ou descartado com motivo. Vai em doc.dados,
// na mesma trilha auditavel da extracao.
interface AjusteCampo {
  campo: string;
  de: unknown;
  para?: unknown;
  regra: string;
}

// Numero: aceita o number da LLM ou extrai o primeiro numero de uma string
// ("12kg" -> 12; "1.234,56" -> 1234.56). Qualquer outra coisa e descarte.
function normalizarNumero(v: unknown): { n: number; regra: string } | null {
  if (typeof v === 'number' && Number.isFinite(v)) return { n: v, regra: 'numero' };
  if (typeof v !== 'string') return null;
  const bruto = v.replace(/\s/g, '').match(/-?\d[\d.,]*/)?.[0];
  if (!bruto) return null;
  const texto = bruto.includes(',') ? bruto.replaceAll('.', '').replace(',', '.') : bruto;
  const n = Number(texto);
  return Number.isFinite(n) ? { n, regra: 'numero_extraido_de_texto' } : null;
}

// Data: AAAA-MM-DD (com ou sem hora a mais) ou DD/MM/AAAA; valida os rangos
// dos pedacos porque a regex sozinha deixaria passar 2026-13-45.
function normalizarData(v: unknown): { iso: string; regra: string } | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  const plausivel = (a: number, m: number, d: number): string | null =>
    a >= 1900 && a <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31
      ? `${String(a).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      : null;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const ok = plausivel(Number(iso[1]), Number(iso[2]), Number(iso[3]));
    return ok ? { iso: ok, regra: s.length > 10 ? 'iso_com_hora_cortada' : 'iso' } : null;
  }
  const br = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) {
    const ok = plausivel(Number(br[3]), Number(br[2]), Number(br[1]));
    return ok ? { iso: ok, regra: 'ddmmaaaa_para_iso' } : null;
  }
  return null;
}

interface CamposValidados {
  campos: CamposObservados;
  normalizados: AjusteCampo[];
  descartados: AjusteCampo[];
}

// Cada campo vigiado entra por tipo, normalizacao explicita ou descarte com
// registro: nunca NaN nem string crua em CamposObservados (RF2, T122).
function validarCampos(ext: RespostaLlm): CamposValidados {
  const campos: CamposObservados = {};
  const normalizados: AjusteCampo[] = [];
  const descartados: AjusteCampo[] = [];
  const campo = (
    nome: keyof CamposObservados,
    bruto: unknown,
    r: { valor: string | number | undefined; regra: string | null },
  ): void => {
    if (r.valor === undefined) {
      descartados.push({ campo: nome, de: bruto, regra: 'tipo_invalido' });
      return;
    }
    // So entra em `normalizados` o que mudou de forma: tipo ja certo nao e ajuste.
    if (r.regra !== null) normalizados.push({ campo: nome, de: bruto, para: r.valor, regra: r.regra });
    (campos as Record<string, unknown>)[nome] = r.valor;
  };

  if (ext.data_prevista !== undefined && ext.data_prevista !== null) {
    const d = normalizarData(ext.data_prevista);
    campo('previsaoEntrega', ext.data_prevista, { valor: d?.iso, regra: d !== null && d.regra !== 'iso' ? d.regra : null });
  }
  if (ext.peso_kg !== undefined && ext.peso_kg !== null) {
    const n = normalizarNumero(ext.peso_kg);
    campo('pesoTotal', ext.peso_kg, { valor: n?.n, regra: n !== null && n.regra !== 'numero' ? n.regra : null });
  }
  if (ext.volumes !== undefined && ext.volumes !== null) {
    const n = normalizarNumero(ext.volumes);
    campo('volumes', ext.volumes, { valor: n?.n, regra: n !== null && n.regra !== 'numero' ? n.regra : null });
  }
  if (ext.status !== undefined && ext.status !== null) {
    const ok = typeof ext.status === 'string' && ext.status.trim() !== '';
    campo('status', ext.status, { valor: ok ? (ext.status as string).trim() : undefined, regra: null });
  }
  return { campos, normalizados, descartados };
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
    const bruto = JSON.parse(conteudo) as unknown;
    // Extracao que nao e um objeto nao tem como carregar campos.
    const ext: RespostaLlm =
      typeof bruto === 'object' && bruto !== null && !Array.isArray(bruto) ? (bruto as RespostaLlm) : {};

    // Essenciais da resposta: tipo errado na chave ou na confianca invalida a
    // extracao inteira, como antes. Nos campos vigiados a validacao e por
    // campo (normaliza ou descarta com registro, nunca NaN nem string crua).
    const tiposOk =
      (ext.chave_nfe == null || typeof ext.chave_nfe === 'string') &&
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
    const conf = typeof ext.confianca === 'number' && Number.isFinite(ext.confianca) ? ext.confianca : 0;

    // DANFE imprime a chave em grupos de 4 com espacos; normaliza para digitos.
    const chaveDigitos = (typeof ext.chave_nfe === 'string' ? ext.chave_nfe : '').replace(/\D/g, '');
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

    const { campos, normalizados, descartados } = validarCampos(ext);

    return {
      doc: {
        fonte: 'pdf',
        docTipo: 'pdf',
        pedidoId,
        campos,
        confianca: conf,
        dados: {
          extracao: ext,
          ...(normalizados.length > 0 ? { normalizados } : {}),
          ...(descartados.length > 0 ? { descartados } : {}),
        },
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
