// Entrada de webhook de fornecedor (spec 0017, RF17): fim de ligacao e, depois,
// resposta de WhatsApp chegam por POST do fornecedor. So entra com assinatura
// HMAC-SHA256 valida sobre o timestamp e o corpo bruto, timestamp dentro da
// janela e id de evento inedito. A tentativa de contato e achada so pelo id
// externo que o fornecedor devolveu no contato_aceito: id do app que venha no
// corpo (workspace, caso, pedido, contato) e ignorado, porque quem monta o
// corpo e o fornecedor. Verificacao pura; dedupe, mapeamento e o efeito
// entram por porta, e a rota do Fastify so junta as pecas.

import { createHmac, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

// Cabecalhos como o Fastify entrega (nomes em minusculas).
export type CabecalhosWebhook = Readonly<Record<string, string | string[] | undefined>>;

export interface RequisicaoWebhook {
  cabecalhos: CabecalhosWebhook;
  corpoBruto: Buffer;
}

export const JANELA_PADRAO_WEBHOOK_MS = 5 * 60_000;
export const CORPO_MAX_WEBHOOK_BYTES = 1024 * 1024;
export const CABECALHO_ASSINATURA_PADRAO = 'x-webhook-assinatura';
export const CABECALHO_TIMESTAMP_PADRAO = 'x-webhook-timestamp';

const LIMITE_ID = 200;

export interface AssinaturaWebhook {
  timestamp?: string; // segundos desde a epoch, so digitos
  assinatura?: string; // hex do HMAC-SHA256, com ou sem prefixo 'sha256='
}

export interface IdsWebhook {
  idEvento?: string; // id do evento no fornecedor: chave do dedupe
  idExterno?: string; // id da ligacao ou mensagem no fornecedor (contato_aceito)
}

// Um por fornecedor. O adaptador do fornecedor (T760, T762) diz onde ficam
// assinatura, timestamp e ids; o resto e igual para todos.
export interface ConfigWebhook {
  fornecedor: string;
  segredo: string;
  janelaMs?: number;
  extrairAssinatura?: (cabecalhos: CabecalhosWebhook) => AssinaturaWebhook;
  // Mensagem assinada; padrao `${timestamp}.${corpo bruto}`.
  montarMensagem?: (timestamp: string, corpoBruto: Buffer) => Buffer;
  // Timestamp em milissegundos (Retell); padrao em segundos.
  timestampEmMs?: boolean;
  extrairIds: (corpo: unknown, cabecalhos: CabecalhosWebhook) => IdsWebhook;
}

export const MOTIVOS_WEBHOOK = [
  'sem_assinatura',
  'sem_timestamp',
  'timestamp_invalido',
  'assinatura_invalida',
  'fora_da_janela',
  'corpo_invalido',
  'sem_id_evento',
  'sem_id_externo',
  'id_externo_desconhecido',
  'falha_interna',
] as const;

export type MotivoWebhook = (typeof MOTIVOS_WEBHOOK)[number];

function cabecalhoUnico(cabecalhos: CabecalhosWebhook, nome: string): string | undefined {
  const v = cabecalhos[nome];
  // Cabecalho repetido e ambiguo: conta como ausente.
  return typeof v === 'string' ? v.trim() : undefined;
}

export function extrairAssinaturaPadrao(cabecalhos: CabecalhosWebhook): AssinaturaWebhook {
  return {
    timestamp: cabecalhoUnico(cabecalhos, CABECALHO_TIMESTAMP_PADRAO),
    assinatura: cabecalhoUnico(cabecalhos, CABECALHO_ASSINATURA_PADRAO),
  };
}

function mensagemPadrao(timestamp: string, corpoBruto: Buffer): Buffer {
  return Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), corpoBruto]);
}

// Assina como o fornecedor assinaria: serve ao teste e a transportadora
// simulada da bancada (T780).
export function assinarWebhook(
  segredo: string,
  timestamp: string,
  corpoBruto: Buffer,
  montarMensagem: (timestamp: string, corpoBruto: Buffer) => Buffer = mensagemPadrao,
): string {
  return createHmac('sha256', segredo).update(montarMensagem(timestamp, corpoBruto)).digest('hex');
}

const HEX_SHA256 = /^(?:sha256=)?([0-9a-f]{64})$/i;
const TIMESTAMP = /^\d{1,13}$/;

// Assinatura e janela. Compara o HMAC em tempo constante; o tamanho comparado
// e sempre 32 bytes, entao a checagem de tamanho nao revela nada do segredo.
// Segredo vazio recusa tudo.
export function verificarAssinaturaWebhook(
  config: ConfigWebhook,
  req: RequisicaoWebhook,
  agoraMs: number,
): { ok: true } | { ok: false; motivo: MotivoWebhook } {
  const { timestamp, assinatura } = (config.extrairAssinatura ?? extrairAssinaturaPadrao)(req.cabecalhos);
  if (!assinatura) return { ok: false, motivo: 'sem_assinatura' };
  if (!timestamp) return { ok: false, motivo: 'sem_timestamp' };
  if (!TIMESTAMP.test(timestamp)) return { ok: false, motivo: 'timestamp_invalido' };
  const hex = HEX_SHA256.exec(assinatura)?.[1];
  if (!hex || !config.segredo) return { ok: false, motivo: 'assinatura_invalida' };
  const esperada = Buffer.from(assinarWebhook(config.segredo, timestamp, req.corpoBruto, config.montarMensagem), 'hex');
  const recebida = Buffer.from(hex, 'hex');
  if (recebida.length !== esperada.length || !timingSafeEqual(recebida, esperada)) {
    return { ok: false, motivo: 'assinatura_invalida' };
  }
  const janela = config.janelaMs ?? JANELA_PADRAO_WEBHOOK_MS;
  const instanteMs = config.timestampEmMs ? Number(timestamp) : Number(timestamp) * 1000;
  if (!Number.isFinite(agoraMs) || Math.abs(agoraMs - instanteMs) > janela) {
    return { ok: false, motivo: 'fora_da_janela' };
  }
  return { ok: true };
}

function idValido(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0 && v.length <= LIMITE_ID;
}

export interface CorpoWebhookLido {
  corpo: unknown; // dado do fornecedor: evidencia, nunca instrucao (RF23)
  idEvento: string;
  idExterno: string;
}

// JSON do corpo e os dois ids que o fornecedor controla. So roda depois da
// assinatura: corpo nao assinado nem e lido.
export function lerCorpoWebhook(
  config: ConfigWebhook,
  req: RequisicaoWebhook,
): ({ ok: true } & CorpoWebhookLido) | { ok: false; motivo: MotivoWebhook } {
  let corpo: unknown;
  try {
    corpo = JSON.parse(req.corpoBruto.toString('utf8'));
  } catch {
    return { ok: false, motivo: 'corpo_invalido' };
  }
  let ids: IdsWebhook;
  try {
    ids = config.extrairIds(corpo, req.cabecalhos);
  } catch {
    return { ok: false, motivo: 'corpo_invalido' };
  }
  if (!idValido(ids.idEvento)) return { ok: false, motivo: 'sem_id_evento' };
  if (!idValido(ids.idExterno)) return { ok: false, motivo: 'sem_id_externo' };
  return { ok: true, corpo, idEvento: ids.idEvento, idExterno: ids.idExterno };
}

// Tentativa de contato como o ledger registrou (contato_iniciado e
// contato_aceito do mesmo fornecedor). E a unica fonte de workspace e caso.
export interface TentativaWebhook {
  workspaceId: string;
  pedidoId: string;
  casoId: string;
  chave: string; // chave do contato_iniciado (RF12)
}

export interface PortaTentativasWebhook {
  // Busca pelo idExterno do contato_aceito daquele fornecedor; null se nao ha.
  porIdExterno(fornecedor: string, idExterno: string): Promise<TentativaWebhook | null>;
}

export interface PortaDedupeWebhook {
  // Atomico (INSERT ... ON CONFLICT DO NOTHING): true so na primeira vez.
  registrarSeInedito(fornecedor: string, idEvento: string): Promise<boolean>;
  // Desfaz o registro quando o efeito falha, para o reenvio do fornecedor
  // ser processado.
  esquecer?(fornecedor: string, idEvento: string): Promise<void>;
}

export interface WebhookAceito extends CorpoWebhookLido {
  fornecedor: string;
  tentativa: TentativaWebhook;
  recebidoEmMs: number;
}

export interface PortasWebhook {
  tentativas: PortaTentativasWebhook;
  dedupe: PortaDedupeWebhook;
  // Efeito: gravar ligacao_concluida, baixar evidencia, mandar para revisao.
  aoReceber(evento: WebhookAceito): Promise<void>;
}

export type ResultadoWebhook =
  | { status: 200; aceito: true; repetido: boolean }
  | { status: 400 | 401 | 404 | 500; aceito: false; motivo: MotivoWebhook };

const STATUS_DO_MOTIVO: Readonly<Record<MotivoWebhook, 400 | 401 | 404 | 500>> = {
  sem_assinatura: 401,
  sem_timestamp: 401,
  timestamp_invalido: 401,
  assinatura_invalida: 401,
  fora_da_janela: 401,
  corpo_invalido: 400,
  sem_id_evento: 400,
  sem_id_externo: 400,
  id_externo_desconhecido: 404,
  falha_interna: 500,
};

function recusa(motivo: MotivoWebhook): ResultadoWebhook {
  return { status: STATUS_DO_MOTIVO[motivo], aceito: false, motivo };
}

// Ordem: assinatura e janela, corpo, id externo, dedupe, efeito. O id externo
// desconhecido nao marca o evento como visto, entao o reenvio do fornecedor
// ainda entra se o contato_aceito chegar depois. Evento repetido responde 200
// para o fornecedor parar de reenviar.
export async function processarWebhook(
  config: ConfigWebhook,
  portas: PortasWebhook,
  req: RequisicaoWebhook,
  agoraMs: number,
): Promise<ResultadoWebhook> {
  const assinado = verificarAssinaturaWebhook(config, req, agoraMs);
  if (!assinado.ok) return recusa(assinado.motivo);
  const lido = lerCorpoWebhook(config, req);
  if (!lido.ok) return recusa(lido.motivo);
  const { corpo, idEvento, idExterno } = lido;

  let tentativa: TentativaWebhook | null;
  let inedito: boolean;
  try {
    tentativa = await portas.tentativas.porIdExterno(config.fornecedor, idExterno);
    if (!tentativa) return recusa('id_externo_desconhecido');
    inedito = await portas.dedupe.registrarSeInedito(config.fornecedor, idEvento);
  } catch {
    return recusa('falha_interna');
  }
  if (!inedito) return { status: 200, aceito: true, repetido: true };

  try {
    await portas.aoReceber({ fornecedor: config.fornecedor, tentativa, corpo, idEvento, idExterno, recebidoEmMs: agoraMs });
  } catch {
    await portas.dedupe.esquecer?.(config.fornecedor, idEvento).catch(() => {});
    return recusa('falha_interna');
  }
  return { status: 200, aceito: true, repetido: false };
}

export interface OpcoesRotaWebhook {
  caminho: string; // ex.: /api/operador/webhooks/<fornecedor>
  config: ConfigWebhook;
  portas: PortasWebhook;
  agora?: () => number;
  bodyLimit?: number;
}

// Registra a rota num escopo encapsulado do Fastify: o parser de corpo bruto
// (necessario para o HMAC) vale so ali e nao muda o JSON do resto do app.
// A resposta nunca ecoa o corpo nem detalhe interno.
export async function registrarRotaWebhook(app: FastifyInstance, opcoes: OpcoesRotaWebhook): Promise<void> {
  if (!opcoes.config.segredo) throw new Error(`webhook ${opcoes.config.fornecedor}: segredo ausente`);
  const bodyLimit = opcoes.bodyLimit ?? CORPO_MAX_WEBHOOK_BYTES;
  const agora = opcoes.agora ?? Date.now;

  await app.register(async (escopo) => {
    escopo.removeAllContentTypeParsers();
    escopo.addContentTypeParser('*', { parseAs: 'buffer', bodyLimit }, (_req, corpo, done) => done(null, corpo));
    escopo.post(opcoes.caminho, { bodyLimit }, async (req, reply) => {
      const corpoBruto = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const r = await processarWebhook(opcoes.config, opcoes.portas, { cabecalhos: req.headers, corpoBruto }, agora());
      reply.header('cache-control', 'no-store');
      if (!r.aceito) {
        if (r.status === 500) req.log.error({ fornecedor: opcoes.config.fornecedor }, 'webhook: falha interna');
        else req.log.info({ fornecedor: opcoes.config.fornecedor, motivo: r.motivo }, 'webhook recusado');
        return reply.code(r.status).send({ ok: false, motivo: r.motivo });
      }
      return reply.code(200).send(r.repetido ? { ok: true, repetido: true } : { ok: true });
    });
  });
}
