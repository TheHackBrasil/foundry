// View-spec (spec 0007, RF9): a LLM sugere a visao do pedido por papel; o
// servidor valida contra o schema e os enums antes de devolver. Sem LLM,
// envelope ruim ou spec fora do schema, o padrao deterministico responde:
// essa rota nunca devolve 500 por causa da camada de linguagem.

import {
  CAMPOS_VIGIADOS,
  FONTES_DOCUMENTO,
  PARTES,
  type CampoVigiado,
  type FonteDocumento,
  type Parte,
  type ProjecaoPedido,
  type ViewSpec,
} from '../shared/model.js';
import { chatJson, llmConfigDoEnv } from './llm.js';

const FONTES_SET = new Set<string>(FONTES_DOCUMENTO);
const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);
const PARTES_SET = new Set<string>(PARTES);

// Visao padrao: todas as fontes, todas as colunas, lente do papel pedido.
export function viewSpecPadrao(papel: Parte): ViewSpec {
  return {
    versao: 1,
    fontesVisiveis: [...FONTES_DOCUMENTO],
    colunas: [...CAMPOS_VIGIADOS],
    lente: papel,
    destacarDivergencias: true,
  };
}

// Aceita so o que o front sabe renderizar: enums conhecidos, sem componente
// inventado. Dedup de arrays; qualquer falha devolve null (padrao fora).
export function validarViewSpec(json: unknown): ViewSpec | null {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return null;
  const r = json as Record<string, unknown>;
  if (r['versao'] !== 1) return null;
  if (!Array.isArray(r['fontesVisiveis']) || r['fontesVisiveis'].length === 0) return null;
  if (!Array.isArray(r['colunas']) || r['colunas'].length === 0) return null;
  if (typeof r['lente'] !== 'string' || !PARTES_SET.has(r['lente'])) return null;
  if (typeof r['destacarDivergencias'] !== 'boolean') return null;
  const fontes = [...new Set(r['fontesVisiveis'])];
  const colunas = [...new Set(r['colunas'])];
  if (fontes.some((f) => typeof f !== 'string' || !FONTES_SET.has(f))) return null;
  if (colunas.some((c) => typeof c !== 'string' || !CAMPOS_SET.has(c))) return null;
  return {
    versao: 1,
    fontesVisiveis: fontes as FonteDocumento[],
    colunas: colunas as CampoVigiado[],
    lente: r['lente'] as Parte,
    destacarDivergencias: r['destacarDivergencias'],
  };
}

const PROMPT = `Voce monta a especificacao de visao (GenUI) de um pedido logistico para um papel especifico.
Responda APENAS JSON:
{"versao": 1, "fontesVisiveis": FonteDocumento[], "colunas": CampoVigiado[], "lente": Parte, "destacarDivergencias": boolean}
Enums: FonteDocumento em nfe|cte|cce|planilha|pdf|imap|manual; CampoVigiado em previsaoEntrega|pesoTotal|volumes|status; Parte em fornecedor|transportadora|cd|fiscal|financeiro.
Filtre de verdade para reduzir ruido cognitivo — cada papel decide coisas diferentes (use apenas fontes presentes no pedido):
- fornecedor: foca na divergencia entre a NF-e emitida e o reportado (ex.: nfe + planilha ou cte; campos com divergencia relevante para o emissor).
- transportadora: foca em entrega, rota e carga (ex.: nfe, cte, planilha; colunas previsaoEntrega, pesoTotal, volumes, status — omita cce fiscal).
- cd: foca em doca e recebimento fisico (ex.: nfe, planilha; colunas previsaoEntrega, volumes, status — omita cce).
- fiscal: foca nos documentos fiscais (nfe, cte, cce; colunas pesoTotal, volumes, status — omita planilha e previsaoEntrega).
- financeiro: foca em faturamento, frete e multa/SLA (nfe, cte, planilha; colunas pesoTotal, previsaoEntrega, status — omita cce e volumes).
Mantenha pelo menos 1 fonte presente e 1 coluna. Destaque divergencias quando importam para o papel.
Pedido:
`;

// Gera e valida; qualquer desvio cai no padrao deterministico.
export async function gerarViewSpec(proj: ProjecaoPedido, papel: Parte): Promise<ViewSpec> {
  if (!llmConfigDoEnv()) return viewSpecPadrao(papel);
  try {
    const contexto = {
      pedidoId: proj.pedido?.id ?? null,
      papel,
      fontesPresentes: [...new Set(proj.versoes.map((v) => v.fonte))],
      campos: proj.pedido?.campos ?? {},
      divergencias: proj.divergencias.map((d) => d.campo),
      tarefasPorParte: proj.tarefas.reduce<Record<string, number>>((acc, t) => {
        acc[t.parte] = (acc[t.parte] ?? 0) + 1;
        return acc;
      }, {}),
    };
    const json = await chatJson([{ role: 'user', content: PROMPT + JSON.stringify(contexto) }], { maxTokens: 300 });
    return validarViewSpec(json) ?? viewSpecPadrao(papel);
  } catch {
    return viewSpecPadrao(papel);
  }
}
