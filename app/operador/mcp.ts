// Servidor MCP do operador (spec 0017, RF21): so leitura, para o agente de
// voz consultar o caso durante a ligacao. Expoe uma unica ferramenta, que
// devolve a projecao do caso em lista fechada: chave da nota, datas, status
// atual do pedido e pergunta pendente. O filtro e por campo permitido, entao
// campo a mais vindo da porta (token do caso da spec 0011, telefone, e-mail,
// .eml) nunca sai. Agente externo nunca grava no ledger (invariante 3): a
// porta so tem leitura e nao existe ferramenta de escrita.
//
// Autenticacao: token HMAC-SHA256 (segredo MCP_TOKEN_SEGREDO, lido por quem
// chama) emitido pelo operador antes de discar. Vale para um workspace, um
// caso e uma tentativa, expira com a duracao maxima da ligacao e e revogado
// quando a ligacao_concluida entra (a porta responde). O caso vem do token,
// nunca de argumento da ferramenta.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { StatusCaso } from '../shared/model.js';
import { contemEmail, contemTelefone } from './evidencia.js';

export const NOME_FERRAMENTA_MCP = 'consultar_caso';
export const CAMINHO_MCP = '/api/operador/mcp';

// A ligacao mais longa que o fornecedor deixa configurar fica bem abaixo
// disso; token com validade maior e erro de quem emite.
export const VALIDADE_MAX_TOKEN_MS = 60 * 60_000;
export const SEGREDO_MIN_CHARS = 32;

const PREFIXO_TOKEN = 'mcp1';
const LIMITE_ID = 200;

// A que o token da acesso. tentativa e um id opaco da tentativa de contato
// (por exemplo a chave do contato_iniciado, RF12).
export interface EscopoTokenMcp {
  workspaceId: string;
  casoId: string;
  tentativa: string;
}

export interface ClaimsTokenMcp extends EscopoTokenMcp {
  expiraEmMs: number;
}

export type MotivoTokenMcp = 'token_ausente' | 'token_invalido' | 'token_expirado' | 'token_revogado';

export type MotivoMcp = MotivoTokenMcp | 'caso_nao_encontrado' | 'caso_encerrado' | 'caso_invalido' | 'erro_interno';

function exigirSegredo(segredo: string): void {
  if (typeof segredo !== 'string' || segredo.length < SEGREDO_MIN_CHARS) {
    throw new RangeError(`MCP_TOKEN_SEGREDO precisa de pelo menos ${SEGREDO_MIN_CHARS} caracteres`);
  }
}

function idValido(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= LIMITE_ID;
}

function assinar(segredo: string, corpo: string): Buffer {
  return createHmac('sha256', segredo).update(`${PREFIXO_TOKEN}.${corpo}`).digest();
}

// Emite o token da tentativa. validadeMs = duracao maxima da ligacao mais a
// folga que o operador quiser; acima de VALIDADE_MAX_TOKEN_MS falha.
export function emitirTokenMcp(
  segredo: string,
  escopo: EscopoTokenMcp,
  opcoes: { agoraMs: number; validadeMs: number },
): string {
  exigirSegredo(segredo);
  if (!idValido(escopo.workspaceId) || !idValido(escopo.casoId) || !idValido(escopo.tentativa)) {
    throw new RangeError('escopo do token incompleto');
  }
  const { agoraMs, validadeMs } = opcoes;
  if (!Number.isFinite(agoraMs)) throw new RangeError(`instante invalido: ${agoraMs}`);
  if (!Number.isFinite(validadeMs) || validadeMs <= 0 || validadeMs > VALIDADE_MAX_TOKEN_MS) {
    throw new RangeError(`validade invalida: ${validadeMs}`);
  }
  const claims = { v: 1, ws: escopo.workspaceId, caso: escopo.casoId, tent: escopo.tentativa, exp: Math.floor(agoraMs + validadeMs) };
  const corpo = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${PREFIXO_TOKEN}.${corpo}.${assinar(segredo, corpo).toString('base64url')}`;
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function lerClaims(corpo: string): ClaimsTokenMcp | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(Buffer.from(corpo, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (typeof bruto !== 'object' || bruto === null) return null;
  const c = bruto as Record<string, unknown>;
  if (c.v !== 1 || !idValido(c.ws) || !idValido(c.caso) || !idValido(c.tent)) return null;
  if (typeof c.exp !== 'number' || !Number.isSafeInteger(c.exp)) return null;
  return { workspaceId: c.ws, casoId: c.caso, tentativa: c.tent, expiraEmMs: c.exp };
}

// Assinatura (comparacao em tempo constante) e validade. Segredo curto ou
// ausente recusa tudo: sem segredo forte nao ha token valido.
export function verificarTokenMcp(
  segredo: string,
  token: string | undefined,
  agoraMs: number,
): { ok: true; claims: ClaimsTokenMcp } | { ok: false; motivo: MotivoTokenMcp } {
  if (!token) return { ok: false, motivo: 'token_ausente' };
  if (typeof segredo !== 'string' || segredo.length < SEGREDO_MIN_CHARS) return { ok: false, motivo: 'token_invalido' };
  const partes = token.split('.');
  if (partes.length !== 3 || partes[0] !== PREFIXO_TOKEN) return { ok: false, motivo: 'token_invalido' };
  const corpo = partes[1]!;
  const assinatura = partes[2]!;
  if (!BASE64URL.test(corpo) || !BASE64URL.test(assinatura)) return { ok: false, motivo: 'token_invalido' };
  const esperada = assinar(segredo, corpo);
  const recebida = Buffer.from(assinatura, 'base64url');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return { ok: false, motivo: 'token_invalido' };
  }
  const claims = lerClaims(corpo);
  if (!claims) return { ok: false, motivo: 'token_invalido' };
  if (!Number.isFinite(agoraMs) || agoraMs >= claims.expiraEmMs) return { ok: false, motivo: 'token_expirado' };
  return { ok: true, claims };
}

// Caso como a porta le do ledger do workspace. A porta pode devolver mais
// campos; so os da projecao saem.
export interface CasoLidoMcp {
  statusCaso: StatusCaso;
  chaveNota: string;
  abertoEm: string;
  previsaoEntrega?: string | null;
  ultimaAtualizacaoEm?: string | null;
  statusPedido?: string | null;
  perguntaPendente?: string | null;
}

// Porta de leitura que a integracao liga ao store escopado pelo workspace.
// Nao ha metodo de escrita, de proposito.
export interface PortaMcp {
  // null quando o caso nao existe neste workspace.
  lerCaso(workspaceId: string, casoId: string): Promise<CasoLidoMcp | null>;
  // true depois da ligacao_concluida da tentativa.
  tentativaRevogada(escopo: EscopoTokenMcp): Promise<boolean>;
}

export interface DepsMcp {
  segredo: string;
  porta: PortaMcp;
  agora?: () => number;
}

// Lista fechada do que o agente de voz pode ver.
export const CAMPOS_PROJECAO_MCP = [
  'chaveNota',
  'abertoEm',
  'previsaoEntrega',
  'ultimaAtualizacaoEm',
  'statusPedido',
  'perguntaPendente',
] as const;

export type ProjecaoCasoMcp = Record<'chaveNota' | 'abertoEm', string> &
  Record<'previsaoEntrega' | 'ultimaAtualizacaoEm' | 'statusPedido' | 'perguntaPendente', string | null>;

const CHAVE_NOTA = /^\d{44}$/;
// Forma de data ou data e hora ISO; a validade fica com Date.parse.
const DATA_ISO = /^\d{4}-\d{2}-\d{2}(?:T[\d:.]{5,18}(?:Z|[+-][\d:]{5})?)?$/;
const STATUS = /^[a-z][a-z_]{0,31}$/;
const PERGUNTA_MAX = 280;

function data(v: unknown): string | null {
  return typeof v === 'string' && DATA_ISO.test(v) && Number.isFinite(Date.parse(v)) ? v : null;
}

// Pergunta vem do roteiro (perguntas fechadas, RF16). Texto com telefone ou
// e-mail nao sai, mesmo que a porta mande.
function pergunta(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.replace(/\s+/g, ' ').trim();
  if (!t || t.length > PERGUNTA_MAX || contemTelefone(t) || contemEmail(t)) return null;
  return t;
}

// Monta a projecao campo a campo; nada da entrada e copiado por espalhamento.
export function projetarCasoMcp(lido: CasoLidoMcp): ProjecaoCasoMcp | null {
  const chaveNota = typeof lido.chaveNota === 'string' && CHAVE_NOTA.test(lido.chaveNota) ? lido.chaveNota : null;
  const abertoEm = data(lido.abertoEm);
  if (!chaveNota || !abertoEm) return null;
  return {
    chaveNota,
    abertoEm,
    previsaoEntrega: data(lido.previsaoEntrega),
    ultimaAtualizacaoEm: data(lido.ultimaAtualizacaoEm),
    statusPedido: typeof lido.statusPedido === 'string' && STATUS.test(lido.statusPedido) ? lido.statusPedido : null,
    perguntaPendente: pergunta(lido.perguntaPendente),
  };
}

// Token valido, no prazo e nao revogado. Erro da porta propaga: quem chama
// responde erro interno sem detalhe.
export async function autorizarTokenMcp(
  deps: DepsMcp,
  token: string | undefined,
): Promise<{ ok: true; claims: ClaimsTokenMcp } | { ok: false; motivo: MotivoTokenMcp }> {
  const verificado = verificarTokenMcp(deps.segredo, token, (deps.agora ?? Date.now)());
  if (!verificado.ok) return verificado;
  const { workspaceId, casoId, tentativa } = verificado.claims;
  if (await deps.porta.tentativaRevogada({ workspaceId, casoId, tentativa })) return { ok: false, motivo: 'token_revogado' };
  return verificado;
}

function resultado(dados: Record<string, unknown>, erro: boolean): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify(dados) }],
    structuredContent: dados,
    ...(erro ? { isError: true } : {}),
  };
}

// Corpo da ferramenta, separado do servidor para o teste chamar direto.
// Toda falha vira codigo estavel; mensagem de erro da porta (SQL, pilha)
// nunca chega ao agente.
export async function consultarCasoMcp(deps: DepsMcp, token: string | undefined): Promise<CallToolResult> {
  try {
    const auth = await autorizarTokenMcp(deps, token);
    if (!auth.ok) return resultado({ erro: auth.motivo }, true);
    const lido = await deps.porta.lerCaso(auth.claims.workspaceId, auth.claims.casoId);
    if (!lido) return resultado({ erro: 'caso_nao_encontrado' }, true);
    // O roteiro encerra a conversa quando recebe caso_encerrado.
    if (lido.statusCaso === 'resolvido') return resultado({ erro: 'caso_encerrado' }, true);
    const caso = projetarCasoMcp(lido);
    if (!caso) return resultado({ erro: 'caso_invalido' }, true);
    return resultado({ caso }, false);
  } catch {
    return resultado({ erro: 'erro_interno' }, true);
  }
}

// Um servidor por conexao (ou por requisicao, no modo sem sessao). O token
// chega em extra.authInfo, posto pelo transporte, e e reverificado a cada
// chamada: expirar ou revogar no meio da ligacao corta o acesso na hora.
export function criarServidorMcp(deps: DepsMcp): McpServer {
  exigirSegredo(deps.segredo);
  const servidor = new McpServer(
    { name: 'forseti-operador', version: '0.1.0' },
    { instructions: 'Somente leitura. Consulte o caso desta ligação; não há ferramenta que grave ou mude dados.' },
  );
  servidor.registerTool(
    NOME_FERRAMENTA_MCP,
    {
      title: 'Consultar caso',
      description:
        'Lê o caso desta ligação: chave da nota, datas, status atual do pedido e a pergunta pendente. ' +
        'Não recebe argumentos; o caso vem da credencial da ligação. Se responder caso_encerrado, agradeça e encerre.',
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (extra) => consultarCasoMcp(deps, extra.authInfo?.token),
  );
  return servidor;
}

function tokenBearer(cabecalho: string | undefined): string | undefined {
  const m = /^Bearer[ \t]+(\S+)[ \t]*$/i.exec(cabecalho ?? '');
  return m?.[1];
}

// Cabecalhos que o transporte precisa; Authorization fica de fora para o
// token nao chegar a requestInfo das ferramentas.
const CABECALHOS_REPASSADOS = ['accept', 'content-type', 'mcp-protocol-version'] as const;

export interface OpcoesRotaMcp extends DepsMcp {
  caminho?: string;
  bodyLimit?: number;
}

// Rota Streamable HTTP sem sessao e com resposta JSON: cada POST monta
// servidor e transporte novos (o transporte sem sessao nao pode ser
// reutilizado). Token invalido responde 401 antes de tocar o MCP. GET e
// DELETE respondem 405: sem sessao nao ha stream nem sessao para encerrar.
export function registrarRotaMcp(app: FastifyInstance, opcoes: OpcoesRotaMcp): void {
  exigirSegredo(opcoes.segredo);
  const caminho = opcoes.caminho ?? CAMINHO_MCP;

  app.post(caminho, { bodyLimit: opcoes.bodyLimit ?? 64 * 1024 }, async (req, reply) => {
    reply.header('cache-control', 'no-store');
    const token = tokenBearer(req.headers.authorization);
    let auth: Awaited<ReturnType<typeof autorizarTokenMcp>>;
    try {
      auth = await autorizarTokenMcp(opcoes, token);
    } catch (err) {
      req.log.error({ err }, 'mcp: falha ao checar revogacao');
      return reply.code(500).send({ erro: 'erro_interno' });
    }
    if (!auth.ok) return reply.code(401).header('www-authenticate', 'Bearer').send({ erro: auth.motivo });

    const servidor = criarServidorMcp(opcoes);
    const transporte = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    try {
      await servidor.connect(transporte);
      const cabecalhos = new Headers();
      for (const nome of CABECALHOS_REPASSADOS) {
        const valor = req.headers[nome];
        if (typeof valor === 'string') cabecalhos.set(nome, valor);
      }
      // A URL so alimenta requestInfo; o host nao e chamado.
      const requisicao = new Request(new URL(req.url, 'https://mcp.local'), { method: 'POST', headers: cabecalhos });
      const authInfo: AuthInfo = {
        token: token!,
        clientId: 'agente-voz',
        scopes: ['caso:leitura'],
        expiresAt: Math.floor(auth.claims.expiraEmMs / 1000),
      };
      const resposta = await transporte.handleRequest(requisicao, { parsedBody: req.body, authInfo });
      const tipo = resposta.headers.get('content-type');
      if (tipo) reply.header('content-type', tipo);
      const corpo = await resposta.text();
      return reply.code(resposta.status).send(corpo);
    } finally {
      await transporte.close().catch(() => {});
      await servidor.close().catch(() => {});
    }
  });

  const naoPermitido = (_req: FastifyRequest, reply: FastifyReply): void => {
    void reply.code(405).header('allow', 'POST').send({ erro: 'metodo_nao_permitido' });
  };
  app.get(caminho, naoPermitido);
  app.delete(caminho, naoPermitido);
}
