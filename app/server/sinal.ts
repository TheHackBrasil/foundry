// Sinais consultivos (spec 0007, RF3): a LLM le texto livre (corpo de .eml,
// xCorrecao/descEvento da CC-e) e devolve avisos tipados. Sinal nunca declara
// campo vigiado nem vira divergencia (R-006); abaixo do limiar e descartado
// sem fila de revisao, porque e informativo e nao documento.

import { TIPOS_SINAL, type FonteDocumento, type Sinal, type TipoSinal } from '../shared/model.js';
import { chatJson, llmConfigDoEnv } from './llm.js';

const LIMIAR_PADRAO = 0.7;
const MAX_SINAIS = 5;
const MAX_RESUMO = 300;
const MAX_TEXTO = 4_000;

const TIPOS = new Set<string>(TIPOS_SINAL);

const PROMPT = `Voce le um texto logistico em portugues (corpo de e-mail ou correcao de NF-e) e extrai sinais consultivos.
Responda APENAS JSON: {"sinais": [{"tipo": "atraso_avisado"|"reagendamento"|"instrucao"|"outro", "resumo": string, "confianca": 0..1}]}
Regras:
- atraso_avisado: o texto avisa de atraso ou entrega fora do prazo.
- reagendamento: o texto remarca data, janela ou coleta.
- instrucao: o texto pede uma acao de alguem (reagendar doca, segurar pagamento, avisar cliente).
- outro: aviso relevante que nao cabe nos tipos acima.
- resumo: uma frase curta em portugues, sem dados pessoais.
- confianca: 0 a 1, honesta; incerteza derruba o sinal pelo limiar de quem chama.
- Sem sinal claro, devolva {"sinais": []}.
Texto:
`;

interface SinalBruto {
  tipo?: unknown;
  resumo?: unknown;
  confianca?: unknown;
}

// Um item vale so com tipo conhecido, resumo nao vazio e confianca 0..1.
function paraSinal(bruto: SinalBruto, fonte: FonteDocumento): Sinal | null {
  if (typeof bruto.tipo !== 'string' || !TIPOS.has(bruto.tipo)) return null;
  if (typeof bruto.resumo !== 'string' || !bruto.resumo.trim()) return null;
  if (typeof bruto.confianca !== 'number' || !Number.isFinite(bruto.confianca)) return null;
  const confianca = Math.min(1, Math.max(0, bruto.confianca));
  return { tipo: bruto.tipo as TipoSinal, resumo: bruto.resumo.trim().slice(0, MAX_RESUMO), confianca, fonte };
}

// Extrai sinais do texto. Sem LLM configurada devolve []; qualquer falha de
// rede, envelope ou schema tambem devolve []: sinal e bonus, nunca quebra o
// fluxo do documento que o trouxe.
export async function extrairSinais(
  texto: string,
  fonte: FonteDocumento,
  opcoes: { limiar?: number } = {},
): Promise<Sinal[]> {
  const limiar = opcoes.limiar ?? LIMIAR_PADRAO;
  const limpo = texto.trim().slice(0, MAX_TEXTO);
  if (!limpo || !llmConfigDoEnv()) return [];
  try {
    const r = (await chatJson([{ role: 'user', content: PROMPT + limpo }], { maxTokens: 600 })) as {
      sinais?: unknown;
    };
    if (!Array.isArray(r.sinais)) return [];
    return r.sinais
      .map((s) => paraSinal(s as SinalBruto, fonte))
      .filter((s): s is Sinal => s !== null && s.confianca >= limiar)
      .slice(0, MAX_SINAIS);
  } catch {
    return [];
  }
}
