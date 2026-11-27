// Degrau de ligacao pela Retell (spec 0017, RF15 a RF18; T760 e T762). A
// Retell faz a voz (Claude no cerebro, voz pt-BR) e o numero sai pelo tronco
// SIP da Telnyx importado nela. Este modulo tem tres pecas:
//
// - criarCanalLigacaoRetell: o adaptador do fluxo. Repete a checagem de
//   destino da politica (RF8), monta as variaveis so do roteiro aprovado
//   (RF11, RF16) e dispara a ligacao com chave de idempotencia derivada da
//   chave do efeito. O id externo e o call_id da Retell.
// - configWebhookRetell: assinatura `x-retell-signature: v=<ms>,d=<hex>`,
//   HMAC-SHA256 com a chave da API sobre corpo bruto + timestamp.
// - aoFimDaLigacaoRetell: no call_ended grava transcricao e audio como
//   evidencia por hash, a ligacao_concluida no ledger, o opt-out quando a
//   transportadora pede, e manda a declaracao extraida para a revisao.
//
// Sem credencial o canal nao e registrado e o degrau e pulado, declarado
// (canal_sem_adaptador). A consulta por chave devolve desconhecido: a API
// de listagem da Retell mudou e nao ha busca por metadado; o fluxo trata
// como incerto e devolve ao analista.

import { createHash } from 'node:crypto';
import type { Evento } from '../../../shared/model.js';
import type { LedgerStore } from '../../../server/store.js';
import { enfileirarDeclaracaoOperador } from '../../../server/pipeline.js';
import type { ClienteClaude } from '../../agente/claude.js';
import { extrairDeclaracao } from '../../agente/extracao.js';
import {
  baixarESalvarEvidencia,
  exigirPayloadSemDadoPessoal,
  salvarEvidencia,
  type FetchEvidencia,
  type PortaEvidencias,
} from '../../evidencia.js';
import type { AdaptadorCanal, PedidoEnvio, RespostaConsulta, RespostaEnvio } from '../../fluxo/caso.js';
import { normalizarTelefoneE164 } from '../../politica.js';
import type { RoteiroPlano } from '../../roteiro.js';
import type { CabecalhosWebhook, ConfigWebhook, WebhookAceito } from '../../webhooks.js';
import { variaveisLigacao } from './roteiro-ligacao.js';

export const FORNECEDOR_RETELL = 'retell';
export const URL_API_RETELL = 'https://api.retellai.com';
export const HOSTS_GRAVACAO_RETELL_PADRAO = ['dxc03zgurdly9.cloudfront.net'];
// Estimativa para a politica (teto por caso e por dia), nao custo medido: a
// ligacao de teste de 3 min 25 s custou US$ 0,27 na Retell.
export const CUSTO_ESTIMADO_LIGACAO_BRL = 2;

export interface ConfigRetell {
  apiKey: string;
  agentId: string;
  numeroOrigem: string; // E.164, importado na Retell
  hostsGravacao: readonly string[];
  cabecalhosSip?: Readonly<Record<string, string>>; // ex.: X-Telnyx-Username
}

type Env = Readonly<Record<string, string | undefined>>;

// null quando falta qualquer peca: o canal nao sobe.
export function configRetellDoEnv(env: Env = process.env): ConfigRetell | null {
  const apiKey = env['RETELL_API_KEY']?.trim();
  const agentId = env['RETELL_AGENT_ID']?.trim();
  const numeroOrigem = normalizarTelefoneE164(env['RETELL_FROM_NUMBER']?.trim() ?? '');
  if (!apiKey || !agentId || !numeroOrigem) return null;
  const hosts = (env['RETELL_HOSTS_GRAVACAO'] ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const usuarioSip = env['TELNYX_SIP_USER']?.trim();
  return {
    apiKey,
    agentId,
    numeroOrigem,
    hostsGravacao: hosts.length ? hosts : HOSTS_GRAVACAO_RETELL_PADRAO,
    ...(usuarioSip ? { cabecalhosSip: { 'X-Telnyx-Username': usuarioSip } } : {}),
  };
}

export type FetchRetell = (url: string, init: RequestInit) => Promise<Response>;

export interface OpcoesCanalRetell {
  config: ConfigRetell;
  destinosPermitidos: readonly string[];
  // Roteiro aprovado, lido da evidencia pelo hash do plano.
  lerRoteiro(workspace: string, hashRoteiro: string): Promise<RoteiroPlano | null>;
  fetch?: FetchRetell;
  custoEstimadoBrl?: number;
}

// A Retell aceita [A-Za-z0-9_-]{5,255} e guarda por uma hora.
export function chaveIdempotenciaRetell(chave: string): string {
  return `forseti-${createHash('sha256').update(chave).digest('hex').slice(0, 48)}`;
}

const RE_CALL_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function criarCanalLigacaoRetell(o: OpcoesCanalRetell): AdaptadorCanal {
  const fetcher = o.fetch ?? ((url, init) => fetch(url, init));
  const permitidos = new Set(o.destinosPermitidos.map((d) => normalizarTelefoneE164(d)).filter((d): d is string => !!d));
  return {
    canal: 'ligacao',
    fornecedor: FORNECEDOR_RETELL,
    custoEstimadoBrl: o.custoEstimadoBrl ?? CUSTO_ESTIMADO_LIGACAO_BRL,

    async enviar(pedido: PedidoEnvio): Promise<RespostaEnvio> {
      if (pedido.canal !== 'ligacao') return { status: 'recusado', motivo: 'canal_incompativel' };
      const destino = normalizarTelefoneE164(pedido.destino);
      if (!destino || !permitidos.has(destino)) return { status: 'recusado', motivo: 'destino_nao_permitido' };
      if (!pedido.hashRoteiro) return { status: 'recusado', motivo: 'sem_roteiro' };
      const roteiro = await o.lerRoteiro(pedido.workspace, pedido.hashRoteiro);
      if (!roteiro || roteiro.canal !== 'ligacao') return { status: 'recusado', motivo: 'roteiro_indisponivel' };

      const r = await fetcher(`${URL_API_RETELL}/v2/create-phone-call`, {
        method: 'POST',
        headers: { authorization: `Bearer ${o.config.apiKey}`, 'content-type': 'application/json' },
        body: JSON.stringify({
          from_number: o.config.numeroOrigem,
          to_number: destino,
          override_agent_id: o.config.agentId,
          idempotency_key: chaveIdempotenciaRetell(pedido.chave),
          metadata: { chave: pedido.chave },
          retell_llm_dynamic_variables: variaveisLigacao(roteiro),
          ...(o.config.cabecalhosSip ? { custom_sip_headers: o.config.cabecalhosSip } : {}),
        }),
      });
      // 5xx: nao se sabe se a ligacao saiu; lancar faz o fluxo consultar.
      if (r.status >= 500) throw new Error(`retell ${r.status}`);
      if (!r.ok) return { status: 'recusado', motivo: `retell_${r.status}` };
      const corpo = (await r.json().catch(() => null)) as { call_id?: unknown } | null;
      const callId = corpo?.call_id;
      if (typeof callId !== 'string' || !RE_CALL_ID.test(callId)) throw new Error('retell: call_id ausente');
      return { status: 'aceito', idExterno: callId };
    },

    async consultar(): Promise<RespostaConsulta> {
      return { status: 'desconhecido' };
    },
  };
}

// --- Webhook (RF17) ---

const RE_ASSINATURA_RETELL = /^v=(\d{1,13}),d=([0-9a-f]{64})$/i;

export function configWebhookRetell(apiKey: string): ConfigWebhook {
  return {
    fornecedor: FORNECEDOR_RETELL,
    segredo: apiKey,
    timestampEmMs: true,
    extrairAssinatura(cabecalhos: CabecalhosWebhook) {
      const v = cabecalhos['x-retell-signature'];
      const m = typeof v === 'string' ? RE_ASSINATURA_RETELL.exec(v.trim()) : null;
      return m ? { timestamp: m[1]!, assinatura: m[2]! } : {};
    },
    montarMensagem: (timestamp, corpoBruto) => Buffer.concat([corpoBruto, Buffer.from(timestamp, 'utf8')]),
    extrairIds(corpo) {
      const c = corpo as { event?: unknown; call?: { call_id?: unknown } } | null;
      const evento = typeof c?.event === 'string' ? c.event : undefined;
      const callId = typeof c?.call?.call_id === 'string' ? c.call.call_id : undefined;
      return {
        ...(evento && callId ? { idEvento: `${evento}:${callId}` } : {}),
        ...(callId ? { idExterno: callId } : {}),
      };
    },
  };
}

export interface Fala {
  quem: 'agente' | 'transportadora';
  texto: string;
}

const MAX_FALAS = 400;
const MAX_TEXTO_FALA = 2_000;

// transcript_object da Retell: [{ role: 'agent' | 'user', content }]. Dado do
// fornecedor: so role e content passam, o resto (palavras, tempos) fica fora.
export function falasDaLigacao(call: unknown): Fala[] {
  const lista = (call as { transcript_object?: unknown } | null)?.transcript_object;
  if (!Array.isArray(lista)) return [];
  const falas: Fala[] = [];
  for (const f of lista.slice(0, MAX_FALAS)) {
    const r = f as { role?: unknown; content?: unknown } | null;
    if (typeof r?.content !== 'string' || !r.content.trim()) continue;
    if (r.role !== 'agent' && r.role !== 'user') continue;
    falas.push({ quem: r.role === 'agent' ? 'agente' : 'transportadora', texto: r.content.trim().slice(0, MAX_TEXTO_FALA) });
  }
  return falas;
}

// Opt-out (RF17): a transportadora pede para nao ser mais contatada. Regra
// conservadora sobre as falas dela; o analista ve a transcricao de todo modo.
const RE_OPTOUT =
  /\bn[aã]o\s+(?:me\s+|nos\s+)?(?:ligu?[ea]m?|liga|contat[ea]m?|procur[ea]m?)\s+mais\b|\bn[aã]o\s+quero\s+(?:mais\s+)?(?:ser\s+)?(?:contatad[oa]|liga[cç][aã]o|receber)|\b(?:tir[ae]|remov[ae])\s+(?:meu|nosso|o)\s+(?:n[uú]mero|contato)\b|\bpar[ae]m?\s+de\s+(?:me\s+|nos\s+)?ligar\b/i;

export function pediuOptout(falas: readonly Fala[]): boolean {
  return falas.some((f) => f.quem === 'transportadora' && RE_OPTOUT.test(f.texto));
}

const RE_CODIGO = /^[a-z0-9_]{1,64}$/;

export interface DepsFimLigacao {
  raiz: LedgerStore;
  evidencias: PortaEvidencias;
  cliente: ClienteClaude;
  config: Pick<ConfigRetell, 'hostsGravacao'>;
  fetch?: FetchEvidencia;
  retencaoDias?: number;
  agora?: () => number;
  hoje?: () => string; // YYYY-MM-DD no fuso do operador
  aoEvento?: (evento: Evento, workspace: string) => void;
  acordarPedido?: (workspace: string, pedidoId: string) => Promise<unknown>;
  log?: (msg: string) => void;
}

const hojeSaoPaulo = (): string => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());

// Efeito do webhook aceito (assinatura, tentativa e dedupe ja conferidos).
// Lancar desfaz o dedupe e a Retell reenvia.
export function aoFimDaLigacaoRetell(deps: DepsFimLigacao): (ev: WebhookAceito) => Promise<void> {
  const agora = deps.agora ?? Date.now;
  const hoje = deps.hoje ?? hojeSaoPaulo;
  return async (ev) => {
    const corpo = ev.corpo as { event?: unknown; call?: Record<string, unknown> } | null;
    if (corpo?.event !== 'call_ended' || !corpo.call) return; // outros eventos: so o dedupe
    const call = corpo.call;
    const { workspaceId, pedidoId, casoId, chave } = ev.tentativa;
    const store = deps.raiz.paraWorkspace(workspaceId);
    const agoraMs = agora();
    const falas = falasDaLigacao(call);

    let hashTranscricao: string | undefined;
    if (falas.length > 0) {
      const salva = await salvarEvidencia(deps.evidencias, {
        workspaceId,
        tipo: 'transcricao',
        conteudo: Buffer.from(JSON.stringify({ falas }), 'utf8'),
        agoraMs,
        ...(deps.retencaoDias ? { retencaoDias: deps.retencaoDias } : {}),
      });
      hashTranscricao = salva.hash;
    }
    let hashAudio: string | undefined;
    if (typeof call['recording_url'] === 'string') {
      const r = await baixarESalvarEvidencia(
        deps.evidencias,
        { url: call['recording_url'], tipo: 'audio', workspaceId, agoraMs, ...(deps.retencaoDias ? { retencaoDias: deps.retencaoDias } : {}) },
        { hostsPermitidos: deps.config.hostsGravacao, fetch: deps.fetch ?? ((u, i) => fetch(u, i)) },
      );
      if (r.ok) hashAudio = r.hash;
      else deps.log?.(`retell: gravacao nao baixada (${r.motivo})`);
    }

    const motivoFim = typeof call['disconnection_reason'] === 'string' ? call['disconnection_reason'].toLowerCase() : '';
    const duracaoMs = typeof call['duration_ms'] === 'number' ? call['duration_ms'] : null;
    const concluida = {
      casoId,
      chave,
      canal: 'ligacao',
      fornecedor: FORNECEDOR_RETELL,
      idExterno: ev.idExterno,
      ...(RE_CODIGO.test(motivoFim) ? { resultado: motivoFim } : {}),
      ...(duracaoMs !== null && duracaoMs >= 0 ? { duracaoS: Math.round(duracaoMs / 1000) } : {}),
      ...(hashAudio ? { hashAudio } : {}),
      ...(hashTranscricao ? { hashTranscricao } : {}),
    };
    exigirPayloadSemDadoPessoal(concluida);
    const eventos: Evento[] = [await store.append(pedidoId, 'ligacao_concluida', concluida)];

    if (pediuOptout(falas)) {
      eventos.push(await store.append(pedidoId, 'contato_optout', { casoId, chave, canal: 'ligacao', fonte: 'ligacao' }));
    }

    if (falas.some((f) => f.quem === 'transportadora')) {
      const texto = falas.map((f) => `${f.quem === 'agente' ? 'Agente' : 'Transportadora'}: ${f.texto}`).join('\n');
      const extraida = await extrairDeclaracao(deps.cliente, {
        fonte: 'ligacao_transportadora',
        pedidoId,
        texto,
        hoje: hoje(),
        idExterno: ev.idExterno,
        ...(hashTranscricao ? { evidenciaHash: hashTranscricao } : {}),
      });
      await enfileirarDeclaracaoOperador(store, extraida);
    }

    for (const e of eventos) deps.aoEvento?.(e, workspaceId);
    await deps.acordarPedido?.(workspaceId, pedidoId);
  };
}
