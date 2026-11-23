// Cliente LLM unico (spec 0007): chat JSON OpenAI-compativel usado por
// mandatos, sinais, view-spec, texto de notificacao e mapeamento. A LLM e
// camada de acesso, nunca de verdade: toda saida e validada por quem chama
// antes de virar evento ou resposta.

export interface LlmConfig {
  url: string;
  chave: string;
  modelo: string;
  timeoutMs: number;
}

export type ErroLlmTipo = 'indisponivel' | 'invalido';

// indisponivel: sem config, HTTP nao-ok, rede ou timeout (503/declarativo no
// chamador). invalido: envelope ou JSON fora do esperado (422 no chamador).
export class ErroLlm extends Error {
  constructor(
    readonly tipo: ErroLlmTipo,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroLlm';
  }
}

type Ambiente = Record<string, string | undefined>;

function inteiroOuPadrao(env: string | undefined, padrao: number): number {
  const n = Number(env);
  return Number.isSafeInteger(n) && n > 0 ? n : padrao;
}

// Mesmo par de envs de ingest/pdf.ts (D-026): sem URL e chave, a camada de
// linguagem esta fora e cada consumidor degrada declarado.
export function llmConfigDoEnv(env: Ambiente = process.env): LlmConfig | null {
  const url = env['LLM_API_URL']?.trim();
  const chave = env['LLM_API_KEY']?.trim();
  if (!url || !chave) return null;
  return {
    url,
    chave,
    modelo: env['LLM_MODEL']?.trim() || 'gpt-4o-mini',
    timeoutMs: inteiroOuPadrao(env['LLM_TIMEOUT_MS'], 15_000),
  };
}

export interface MensagemChat {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpcoesChat {
  cfg?: LlmConfig | null; // default: llmConfigDoEnv()
  maxTokens?: number;
}

// Uma chamada de chat com resposta JSON obrigatoria. Devolve o conteudo ja
// parseado; a forma esperada e responsabilidade de quem chama validar.
export async function chatJson(mensagens: MensagemChat[], opcoes: OpcoesChat = {}): Promise<unknown> {
  const cfg = opcoes.cfg !== undefined ? opcoes.cfg : llmConfigDoEnv();
  if (!cfg) throw new ErroLlm('indisponivel', 'LLM nao configurada (LLM_API_URL/LLM_API_KEY ausentes)');

  let resp: Response;
  try {
    resp = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.chave}` },
      // LLM externo nao pode segurar o fluxo para sempre.
      signal: AbortSignal.timeout(cfg.timeoutMs),
      body: JSON.stringify({
        model: cfg.modelo,
        messages: mensagens,
        response_format: { type: 'json_object' },
        ...(opcoes.maxTokens !== undefined ? { max_tokens: opcoes.maxTokens } : {}),
      }),
    });
  } catch (e) {
    throw new ErroLlm('indisponivel', `LLM inalcancavel (${(e as Error).message})`);
  }
  if (!resp.ok) throw new ErroLlm('indisponivel', `LLM HTTP ${resp.status}`);

  let json: { choices?: Array<{ message?: { content?: unknown } }> };
  try {
    json = (await resp.json()) as typeof json;
  } catch {
    throw new ErroLlm('invalido', 'resposta do LLM nao e um envelope JSON');
  }
  const conteudo = json.choices?.[0]?.message?.content;
  if (typeof conteudo !== 'string') throw new ErroLlm('invalido', 'resposta do LLM sem choices[0].message.content');
  try {
    return JSON.parse(conteudo) as unknown;
  } catch {
    throw new ErroLlm('invalido', 'conteudo do LLM nao e JSON valido');
  }
}
