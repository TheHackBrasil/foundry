// Mapeamento de layout por IA (spec 0007, RF11): planilha cujo cabecalho o
// parser nao reconhece ganha uma proposta coluna -> campo canonico da LLM,
// que vai anexa na fila de revisao. Aprovada, vira template por (workspace,
// remetente) e o proximo arquivo aplica direto, sem LLM e sem revisao.
// A LLM propoe mapeamento, nunca dado: os valores saem do parser
// deterministico rodando com o mapeamento aprovado.

import { CAMPOS_VIGIADOS, type CamposObservados, type DocData, type PropostaMapeamento } from '../shared/model.js';
import { chatJson, llmConfigDoEnv } from './llm.js';
import type { LedgerStore } from './store.js';

// Campos canonicos que uma linha de planilha pode alimentar (os mesmos que o
// parser tabular reconhece, mais a chave do pedido).
export const CAMPOS_MAPEAVEIS = ['pedidoId', ...CAMPOS_VIGIADOS] as const;

export type CampoMapeavel = (typeof CAMPOS_MAPEAVEIS)[number];

const CAMPOS_SET = new Set<string>(CAMPOS_MAPEAVEIS);
const MAX_AMOSTRA = 5;
const MAX_COLUNAS = 40;

const PROMPT = `Voce mapeia as colunas de uma planilha de logistica para os campos canonicos.
Campos canonicos possiveis: pedidoId (chave de 44 digitos da NF-e), previsaoEntrega (data AAAA-MM-DD), pesoTotal (kg), volumes, status.
Responda APENAS JSON:
{"mapeamento": {"<nome da coluna>": "<campo canonico>"}, "confianca": 0..1, "motivo": "uma frase em portugues"}
So mapeie colunas que voce reconhece; coluna irreconhecivel fica de fora.
Colunas e amostra:
`;

function validarProposta(json: unknown, cabecalho: string[]): PropostaMapeamento | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  const m = r['mapeamento'];
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return null;
  const nomes = new Set(cabecalho);
  const mapeamento: Record<string, string> = {};
  for (const [coluna, campo] of Object.entries(m as Record<string, unknown>)) {
    // So conta coluna que existe de verdade e campo do conjunto fechado.
    if (!nomes.has(coluna) || typeof campo !== 'string' || !CAMPOS_SET.has(campo)) continue;
    mapeamento[coluna] = campo;
  }
  if (Object.keys(mapeamento).length === 0) return null;
  const confianca = r['confianca'];
  if (typeof confianca !== 'number' || !Number.isFinite(confianca)) return null;
  const motivo = r['motivo'];
  if (typeof motivo !== 'string' || !motivo.trim()) return null;
  return { mapeamento, confianca: Math.min(1, Math.max(0, confianca)), motivo: motivo.trim().slice(0, 300) };
}

// Proposta de mapeamento pela LLM. Sem LLM ou com saida invalida devolve
// null: o documento vai para a revisao sem proposta, como hoje.
export async function proporMapeamento(cabecalho: string[], amostra: string[][]): Promise<PropostaMapeamento | null> {
  const colunas = cabecalho.slice(0, MAX_COLUNAS).map((c) => c.trim()).filter(Boolean);
  if (colunas.length === 0 || !llmConfigDoEnv()) return null;
  try {
    const contexto = { colunas, amostra: amostra.slice(0, MAX_AMOSTRA) };
    const json = await chatJson([{ role: 'user', content: PROMPT + JSON.stringify(contexto) }], { maxTokens: 500 });
    return validarProposta(json, colunas);
  } catch {
    return null;
  }
}

function numero(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

function data(s: string | undefined): string | undefined {
  if (!s) return undefined;
  const br = s.match(/(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : undefined;
}

// Aplica o mapeamento coluna -> campo numa linha, com a mesma normalizacao
// do parser tabular. Sem chave de pedido a linha nao vira documento.
export function aplicarMapeamento(
  linha: Record<string, string>,
  mapeamento: Record<string, string>,
  idx: number,
): DocData | null {
  const valorDe = (campo: string): string | undefined => {
    const coluna = Object.entries(mapeamento).find(([, c]) => c === campo)?.[0];
    // Coluna herdada do prototipo (constructor, toString...) ou valor
    // nao-string nunca chega ao trim: um template envenenado nao pode
    // derrubar o arquivo seguinte do remetente.
    if (coluna === undefined || !Object.hasOwn(linha, coluna)) return undefined;
    const v = linha[coluna];
    return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
  };
  const pedidoId = valorDe('pedidoId');
  if (!pedidoId) return null;
  const campos: CamposObservados = {};
  const previsao = data(valorDe('previsaoEntrega'));
  const peso = numero(valorDe('pesoTotal'));
  const vols = numero(valorDe('volumes'));
  const status = valorDe('status');
  if (previsao) campos.previsaoEntrega = previsao;
  if (peso !== undefined) campos.pesoTotal = peso;
  if (vols !== undefined) campos.volumes = vols;
  if (status) campos.status = status;
  return {
    fonte: 'planilha',
    docTipo: 'planilha',
    pedidoId,
    campos,
    dados: { linha: idx + 2, original: linha, mapeamento: 'template' },
  };
}

// Template aprovado do remetente neste workspace aplicado direto (RF11):
// devolve DocData[] ou null quando nao ha template guardado.
export async function aplicarTemplate(
  store: LedgerStore,
  remetente: string,
  linhas: Array<Record<string, string>>,
): Promise<DocData[] | null> {
  const mapeamento = await store.templatePara(remetente);
  if (!mapeamento) return null;
  return linhas.map((l, i) => aplicarMapeamento(l, mapeamento, i)).filter((d): d is DocData => d !== null);
}

// Guarda o mapeamento aprovado na revisao como template do remetente.
export async function registrarTemplate(
  store: LedgerStore,
  remetente: string,
  mapeamento: Record<string, string>,
): Promise<void> {
  await store.salvarTemplate(remetente, mapeamento);
}
