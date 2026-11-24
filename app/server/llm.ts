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
    readonly status?: number,
    readonly detalhe?: string,
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
    modelo: env['LLM_MODEL']?.trim() || 'gpt-6.2-sol',
    timeoutMs: inteiroOuPadrao(env['LLM_TIMEOUT_MS'], 25_000),
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

// Timeout da chamada encadeado com o cancelamento do chamador (fechar o SSE
// aborta o loop do agente): o que disparar primeiro vence.
function sinalDaChamada(cfg: LlmConfig, externo?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(cfg.timeoutMs);
  if (!externo) return timeout;
  const anyOf = (AbortSignal as { any?: (sinais: AbortSignal[]) => AbortSignal }).any;
  return typeof anyOf === 'function' ? anyOf([timeout, externo]) : timeout;
}

// POST compartilhado pelas tres formas de chat: mesmo endpoint, headers e
// timeout; quem chama decide se o corpo e JSON unico ou stream SSE.
async function postLlm(cfg: LlmConfig, corpo: Record<string, unknown>, externo?: AbortSignal): Promise<Response> {
  let resp: Response;
  try {
    resp = await fetch(cfg.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.chave}` },
      // LLM externo nao pode segurar o fluxo para sempre.
      signal: sinalDaChamada(cfg, externo),
      body: JSON.stringify({ model: cfg.modelo, ...corpo }),
    });
  } catch (e) {
    throw new ErroLlm('indisponivel', `LLM inalcancavel (${(e as Error).message})`);
  }
  if (!resp.ok) {
    let detalhe = '';
    try {
      detalhe = (await resp.text()).slice(0, 280).replace(/\s+/g, ' ').trim();
    } catch {
      // ignora erro ao ler corpo de diagnostico
    }
    console.warn(`[llm] HTTP ${resp.status} modelo=${cfg.modelo}${detalhe ? ` corpo=${detalhe}` : ''}`);
    throw new ErroLlm('indisponivel', `LLM HTTP ${resp.status}`, resp.status, detalhe);
  }
  return resp;
}

// Uma chamada de chat com resposta JSON obrigatoria. Devolve o conteudo ja
// parseado; a forma esperada e responsabilidade de quem chama validar.
export async function chatJson(mensagens: MensagemChat[], opcoes: OpcoesChat = {}): Promise<unknown> {
  const cfg = opcoes.cfg !== undefined ? opcoes.cfg : llmConfigDoEnv();
  if (!cfg) throw new ErroLlm('indisponivel', 'LLM nao configurada (LLM_API_URL/LLM_API_KEY ausentes)');

  const resp = await postLlm(cfg, {
    messages: mensagens,
    response_format: { type: 'json_object' },
    ...(opcoes.maxTokens !== undefined ? { max_completion_tokens: opcoes.maxTokens } : {}),
  });

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

// Agente conversacional (spec 0009): chat com tool calling no formato
// OpenAI-compativel e streaming de texto. As tools sao declaradas pelo
// chamador; a LLM so escolhe qual chamar — quem executa e sempre o motor.

// parameters e o JSON Schema dos argumentos da tool, validado pelo servidor.
export interface DefinicaoToolLlm {
  nome: string;
  descricao: string;
  parametros: Record<string, unknown>;
}

// Chamada de tool ja validada na forma: id e nome garantidos, argumentos
// parseados; argumento quebrado vira {} (a tool responde erro estruturado).
export interface ChamadaToolLlm {
  id: string;
  nome: string;
  argumentos: Record<string, unknown>;
}

// Os 4 papeis do wire OpenAI: assistant com tool_calls pode trazer content
// null; role tool devolve o resultado de uma chamada pelo id dela.
export type MensagemAgenteLlm =
  | { role: 'system' | 'user'; content: string }
  | {
      role: 'assistant';
      content: string | null;
      tool_calls?: Array<{
        id: string;
        type: 'function';
        function: { name: string; arguments: string };
      }>;
    }
  | { role: 'tool'; tool_call_id: string; name: string; content: string };

export interface OpcoesChatAgente {
  cfg?: LlmConfig | null; // default: llmConfigDoEnv()
  modelo?: string; // sobrescreve cfg.modelo quando presente
  temperatura?: number;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
}

export interface RespostaChatTools {
  texto: string;
  toolCalls: ChamadaToolLlm[];
  finishReason: string;
  streamouTexto?: boolean;
}

function parseArgumentosTool(argBruto: unknown): Record<string, unknown> {
  if (typeof argBruto === 'string' && argBruto.trim() !== '') {
    try {
      const p = JSON.parse(argBruto) as unknown;
      if (typeof p === 'object' && p !== null && !Array.isArray(p)) return p as Record<string, unknown>;
    } catch {
      // JSON quebrado vira {}: a tool devolve erro estruturado legivel
      // para o modelo corrigir, nunca excecao solta no loop.
    }
    return {};
  }
  if (typeof argBruto === 'object' && argBruto !== null && !Array.isArray(argBruto)) {
    return argBruto as Record<string, unknown>;
  }
  return {};
}

// Leitor SSE compartilhado para chat com tools em streaming: acumula
// delta.content (emitindo cada token via onDelta em tempo real) e
// delta.tool_calls fragmentados por indice ate [DONE].
async function lerStreamChatTools(
  resp: Response,
  onDelta?: (delta: string) => void,
): Promise<RespostaChatTools> {
  if (!resp.body) throw new ErroLlm('invalido', 'resposta SSE do LLM sem corpo');
  const leitor = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let texto = '';
  let finishReason = '';
  let streamouTexto = false;
  const chamadasPorIndice = new Map<number, { id: string; nome: string; args: string }>();

  const finalizar = (): RespostaChatTools => {
    const toolCalls: ChamadaToolLlm[] = [];
    const ordenadas = [...chamadasPorIndice.entries()].sort((a, b) => a[0] - b[0]);
    for (const [idx, item] of ordenadas) {
      if (!item.nome) continue;
      toolCalls.push({
        id: item.id || `call_${idx}`,
        nome: item.nome,
        argumentos: parseArgumentosTool(item.args),
      });
    }
    return { texto, toolCalls, finishReason, streamouTexto };
  };

  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let fim = buf.indexOf('\n');
      while (fim >= 0) {
        const linha = buf.slice(0, fim).trim();
        buf = buf.slice(fim + 1);
        if (linha.startsWith('data:')) {
          const dados = linha.slice(5).trim();
          if (dados === '[DONE]') return finalizar();
          try {
            const frame = JSON.parse(dados) as {
              choices?: Array<{
                finish_reason?: unknown;
                delta?: {
                  content?: unknown;
                  tool_calls?: Array<{
                    index?: unknown;
                    id?: unknown;
                    function?: { name?: unknown; arguments?: unknown };
                  }>;
                };
              }>;
            };
            const escolha = frame.choices?.[0];
            if (typeof escolha?.finish_reason === 'string' && escolha.finish_reason !== '') {
              finishReason = escolha.finish_reason;
            }
            const delta = escolha?.delta;
            if (typeof delta?.content === 'string' && delta.content !== '') {
              texto += delta.content;
              streamouTexto = true;
              onDelta?.(delta.content);
            }
            if (Array.isArray(delta?.tool_calls)) {
              for (const [pos, tc] of delta.tool_calls.entries()) {
                const idx = typeof tc?.index === 'number' && Number.isInteger(tc.index) ? tc.index : pos;
                const atual = chamadasPorIndice.get(idx) ?? { id: '', nome: '', args: '' };
                if (typeof tc?.id === 'string' && tc.id !== '') atual.id = tc.id;
                if (typeof tc?.function?.name === 'string') atual.nome += tc.function.name;
                if (typeof tc?.function?.arguments === 'string') atual.args += tc.function.arguments;
                chamadasPorIndice.set(idx, atual);
              }
            }
          } catch {
            // frame incompleto ou fora do formato: ignora sem derrubar o stream
          }
        }
        fim = buf.indexOf('\n');
      }
    }
    return finalizar();
  } catch (e) {
    if (e instanceof ErroLlm) throw e;
    throw new ErroLlm('indisponivel', `stream do LLM interrompido (${(e as Error).message})`);
  }
}

// Uma chamada de chat com tools declaradas: devolve o texto livre e as
// chamadas pedidas pelo modelo. Quando onDelta e fornecido, pede stream:true
// para entregar tokens em tempo real; se o provedor responder JSON comum,
// faz fallback transparente.
export async function chatComTools(
  mensagens: MensagemAgenteLlm[],
  tools: DefinicaoToolLlm[],
  opcoes: OpcoesChatAgente = {},
): Promise<RespostaChatTools> {
  const cfg = opcoes.cfg !== undefined ? opcoes.cfg : llmConfigDoEnv();
  if (!cfg) throw new ErroLlm('indisponivel', 'LLM nao configurada (LLM_API_URL/LLM_API_KEY ausentes)');

  const corpoBase: Record<string, unknown> = {
    messages: mensagens,
    ...(opcoes.onDelta ? { stream: true } : {}),
    // tools vazio pede resposta final ao modelo: omitir a chave evita
    // provedor que recusa array vazio.
    ...(tools.length > 0
      ? {
          tools: tools.map((t) => ({
            type: 'function',
            function: { name: t.nome, description: t.descricao, parameters: t.parametros },
          })),
          tool_choice: 'auto',
        }
      : {}),
    ...(opcoes.modelo ? { model: opcoes.modelo } : {}),
    ...(opcoes.temperatura !== undefined ? { temperature: opcoes.temperatura } : {}),
  };

  let resp: Response;
  if (tools.length > 0) {
    // Modelos de raciocinio OpenAI em /v1/chat/completions exigem
    // reasoning_effort: 'none' para aceitar function tools; se outro provedor
    // recusar o campo por 400, repetimos uma vez sem ele.
    try {
      resp = await postLlm(cfg, { ...corpoBase, reasoning_effort: 'none' }, opcoes.signal);
    } catch (e) {
      if (e instanceof ErroLlm && e.status === 400 && /reasoning_effort/i.test(e.detalhe ?? '')) {
        resp = await postLlm(cfg, corpoBase, opcoes.signal);
      } else {
        throw e;
      }
    }
  } else {
    resp = await postLlm(cfg, corpoBase, opcoes.signal);
  }

  const contentType = resp.headers?.get?.('content-type') ?? '';
  if (contentType.includes('text/event-stream')) {
    return lerStreamChatTools(resp, opcoes.onDelta);
  }

  interface MsgResposta {
    content?: unknown;
    tool_calls?: unknown;
  }
  let json: { choices?: Array<{ message?: MsgResposta; finish_reason?: unknown }> };
  try {
    json = (await resp.json()) as typeof json;
  } catch {
    throw new ErroLlm('invalido', 'resposta do LLM nao e um envelope JSON');
  }
  const escolha = json.choices?.[0];
  const msg = escolha?.message;
  if (typeof msg !== 'object' || msg === null) {
    throw new ErroLlm('invalido', 'resposta do LLM sem choices[0].message');
  }

  const toolCalls: ChamadaToolLlm[] = [];
  if (Array.isArray(msg.tool_calls)) {
    for (const [i, bruto] of msg.tool_calls.entries()) {
      const tc = bruto as { id?: unknown; function?: { name?: unknown; arguments?: unknown } } | null;
      const nome = tc?.function?.name;
      // Call sem nome nao tem como ser enderecada a uma tool registrada.
      if (typeof nome !== 'string' || nome === '') continue;
      toolCalls.push({
        id: typeof tc?.id === 'string' && tc.id !== '' ? tc.id : `call_${i}`,
        nome,
        argumentos: parseArgumentosTool(tc?.function?.arguments),
      });
    }
  }
  return {
    texto: typeof msg.content === 'string' ? msg.content : '',
    toolCalls,
    finishReason: typeof escolha?.finish_reason === 'string' ? escolha.finish_reason : '',
    streamouTexto: false,
  };
}

// Chat com texto streamado: cada fragmento de delta.content chama onDelta e
// acumula no retorno. Provedor que responde JSON comum apesar de stream:true
// emite o conteudo de uma vez.
export async function chatTextoStream(
  mensagens: MensagemAgenteLlm[],
  onDelta: (delta: string) => void,
  opcoes: OpcoesChatAgente = {},
): Promise<string> {
  const cfg = opcoes.cfg !== undefined ? opcoes.cfg : llmConfigDoEnv();
  if (!cfg) throw new ErroLlm('indisponivel', 'LLM nao configurada (LLM_API_URL/LLM_API_KEY ausentes)');

  const resp = await postLlm(
    cfg,
    {
      messages: mensagens,
      stream: true,
      ...(opcoes.modelo ? { model: opcoes.modelo } : {}),
      ...(opcoes.temperatura !== undefined ? { temperature: opcoes.temperatura } : {}),
    },
    opcoes.signal,
  );

  const contentType = resp.headers?.get?.('content-type') ?? '';
  if (!contentType.includes('text/event-stream')) {
    let json: { choices?: Array<{ message?: { content?: unknown } }> };
    try {
      json = (await resp.json()) as typeof json;
    } catch {
      throw new ErroLlm('invalido', 'resposta do LLM nao e um envelope JSON');
    }
    const conteudo = json.choices?.[0]?.message?.content;
    if (typeof conteudo !== 'string') throw new ErroLlm('invalido', 'resposta do LLM sem choices[0].message.content');
    if (conteudo !== '') onDelta(conteudo);
    return conteudo;
  }

  if (!resp.body) throw new ErroLlm('invalido', 'resposta SSE do LLM sem corpo');
  const leitor = resp.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  let acumulado = '';
  try {
    for (;;) {
      const { value, done } = await leitor.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let fim = buf.indexOf('\n');
      while (fim >= 0) {
        const linha = buf.slice(0, fim).trim();
        buf = buf.slice(fim + 1);
        if (linha.startsWith('data:')) {
          const dados = linha.slice(5).trim();
          if (dados === '[DONE]') return acumulado;
          try {
            const frame = JSON.parse(dados) as { choices?: Array<{ delta?: { content?: unknown } }> };
            const delta = frame.choices?.[0]?.delta?.content;
            if (typeof delta === 'string' && delta !== '') {
              acumulado += delta;
              onDelta(delta);
            }
          } catch {
            // frame incompleto ou fora do formato: ignora, nao derruba o stream
          }
        }
        fim = buf.indexOf('\n');
      }
    }
    return acumulado;
  } catch (e) {
    if (e instanceof ErroLlm) throw e;
    throw new ErroLlm('indisponivel', `stream do LLM interrompido (${(e as Error).message})`);
  }
}
