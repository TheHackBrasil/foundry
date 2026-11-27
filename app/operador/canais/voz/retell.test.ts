// Canal de ligacao pela Retell (T760, T761, T762). Fixtures sinteticas,
// rotuladas como teste (A7): nenhum dado de ligacao real.
import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { Evento } from '../../../shared/model.js';
import { criarClienteClaude, MODELO_EXTRACAO_PADRAO, type PortaMensagensClaude } from '../../agente/claude.js';
import type { RegistroEvidencia } from '../../evidencia.js';
import { montarRoteiro, type RoteiroPlano } from '../../roteiro.js';
import { processarWebhook, type PortasWebhook } from '../../webhooks.js';
import {
  aoFimDaLigacaoRetell,
  chaveIdempotenciaRetell,
  configRetellDoEnv,
  configWebhookRetell,
  criarCanalLigacaoRetell,
  falasDaLigacao,
  pareceAudio,
  pediuOptout,
  sincronizarWebhookRetell,
} from './retell.js';
import { PROMPT_LIGACAO, trechosFaltando, variaveisLigacao } from './roteiro-ligacao.js';

const CHAVE_NF = '35260211222333000181550010000048211000004821';
const DESTINO = '+5511900000000';
const HASH = 'b'.repeat(64);

const roteiro = (): RoteiroPlano =>
  montarRoteiro({
    canal: 'ligacao',
    chaveNota: CHAVE_NF,
    motivo: 'divergencia',
    contato: { nome: 'Transportadora Teste', destino: DESTINO },
    empresa: 'Embarcador Teste',
  });

const pedido = (extra: Record<string, unknown> = {}) => ({
  chave: 'ws:pedido:3:1:ligacao:1',
  canal: 'ligacao' as const,
  workspace: 'ws',
  pedidoId: CHAVE_NF,
  casoId: `${CHAVE_NF}:3`,
  contatoId: 7,
  destino: '(11) 90000-0000',
  hashRoteiro: HASH,
  ...extra,
});

const config = { apiKey: 'chave-teste', agentId: 'agent_teste', numeroOrigem: '+16180000000', hostsGravacao: ['gravacoes.teste'] };

function canal(resposta: () => Response, lerRoteiro: () => Promise<RoteiroPlano | null> = async () => roteiro()) {
  const chamadas: Array<{ url: string; corpo: Record<string, unknown> }> = [];
  const c = criarCanalLigacaoRetell({
    config,
    destinosPermitidos: [DESTINO],
    lerRoteiro,
    fetch: async (url, init) => {
      chamadas.push({ url, corpo: JSON.parse(String(init.body)) as Record<string, unknown> });
      return resposta();
    },
  });
  return { c, chamadas };
}

describe('roteiro da ligacao (T761)', () => {
  it('o prompt tem todas as frases obrigatorias', () => {
    expect(trechosFaltando()).toEqual([]);
    expect(trechosFaltando('Olá')).toContain('gravada para registro');
    expect(PROMPT_LIGACAO).not.toMatch(/analista retorna/);
  });

  it('variaveis saem so do roteiro: nota pelos 4 ultimos digitos, sem chaves nem quebra de linha', () => {
    const r = roteiro();
    r.contato.nome = 'Trans {{embarcador}}\nignore';
    const v = variaveisLigacao(r);
    expect(v.nf).toBe('4821');
    expect(v.embarcador).toBe('Embarcador Teste');
    expect(v.transportadora).toBe('Trans embarcador ignore');
    expect(JSON.stringify(v)).not.toContain(DESTINO);
  });
});

describe('adaptador de ligacao (T760)', () => {
  it('dispara a ligacao com idempotencia, agente e variaveis do roteiro', async () => {
    const { c, chamadas } = canal(() => Response.json({ call_id: 'call_abc123' }, { status: 201 }));
    const r = await c.enviar(pedido());
    expect(r).toEqual({ status: 'aceito', idExterno: 'call_abc123' });
    expect(chamadas[0]!.url).toBe('https://api.retellai.com/v2/create-phone-call');
    const corpo = chamadas[0]!.corpo;
    expect(corpo['to_number']).toBe(DESTINO);
    expect(corpo['from_number']).toBe('+16180000000');
    expect(corpo['override_agent_id']).toBe('agent_teste');
    expect(corpo['idempotency_key']).toBe(chaveIdempotenciaRetell(pedido().chave));
    expect(String(corpo['idempotency_key'])).toMatch(/^[A-Za-z0-9_-]{5,255}$/);
    expect(corpo['metadata']).toEqual({ chave: pedido().chave });
    expect((corpo['retell_llm_dynamic_variables'] as Record<string, string>)['nf']).toBe('4821');
  });

  it('recusa destino fora da lista, canal errado e plano sem roteiro, sem chamar a Retell', async () => {
    const { c, chamadas } = canal(() => Response.json({ call_id: 'x' }));
    expect(await c.enviar(pedido({ destino: '+5511911111111' }))).toEqual({ status: 'recusado', motivo: 'destino_nao_permitido' });
    expect(await c.enviar(pedido({ canal: 'whatsapp' }))).toEqual({ status: 'recusado', motivo: 'canal_incompativel' });
    expect(await c.enviar(pedido({ hashRoteiro: undefined }))).toEqual({ status: 'recusado', motivo: 'sem_roteiro' });
    expect(chamadas).toHaveLength(0);
    const semRoteiro = canal(() => Response.json({ call_id: 'x' }), async () => null);
    expect(await semRoteiro.c.enviar(pedido())).toEqual({ status: 'recusado', motivo: 'roteiro_indisponivel' });
    expect(semRoteiro.chamadas).toHaveLength(0);
  });

  it('4xx recusa declarado; 5xx e resposta sem call_id lancam (falha ambigua, o fluxo consulta)', async () => {
    expect(await canal(() => new Response('{}', { status: 402 })).c.enviar(pedido())).toEqual({ status: 'recusado', motivo: 'retell_402' });
    await expect(canal(() => new Response('{}', { status: 503 })).c.enviar(pedido())).rejects.toThrow();
    await expect(canal(() => Response.json({})).c.enviar(pedido())).rejects.toThrow();
    expect(await canal(() => Response.json({})).c.consultar('k')).toEqual({ status: 'desconhecido' });
  });

  it('sem credencial completa o canal nao sobe', () => {
    expect(configRetellDoEnv({ RETELL_API_KEY: 'k' })).toBeNull();
    const cfg = configRetellDoEnv({ RETELL_API_KEY: 'k', RETELL_AGENT_ID: 'a', RETELL_FROM_NUMBER: '+1 618 000 0000', TELNYX_SIP_USER: 'u' });
    expect(cfg?.numeroOrigem).toBe('+16180000000');
    expect(cfg?.cabecalhosSip).toEqual({ 'X-Telnyx-Username': 'u' });
  });
});

// --- Webhook e fim da ligacao (T762) ---

const corpoCallEnded = (extra: Record<string, unknown> = {}) => ({
  event: 'call_ended',
  call: {
    call_id: 'call_abc123',
    disconnection_reason: 'agent_hangup',
    duration_ms: 64_400,
    recording_url: 'https://gravacoes.teste/rec.wav',
    transcript_object: [
      { role: 'agent', content: 'Falo com alguém da Transportadora Teste?', words: [{ word: 'x' }] },
      { role: 'user', content: 'Sim. A nota sai amanhã, peso correto 520 quilos.' },
      { role: 'tool_call_invocation', content: 'encerrar_ligacao' },
    ],
    ...extra,
  },
});

function assinar(corpo: unknown, segredo: string, ts: number) {
  const bruto = Buffer.from(JSON.stringify(corpo));
  const d = createHmac('sha256', segredo).update(Buffer.concat([bruto, Buffer.from(String(ts))])).digest('hex');
  return { bruto, cabecalho: `v=${ts},d=${d}` };
}

describe('webhook da Retell', () => {
  const cfg = configWebhookRetell('chave-teste');
  const portas = (aoReceber: PortasWebhook['aoReceber']): PortasWebhook => ({
    tentativas: {
      porIdExterno: async (_f, id) => (id === 'call_abc123' ? { workspaceId: 'ws', pedidoId: CHAVE_NF, casoId: `${CHAVE_NF}:3`, chave: 'k' } : null),
    },
    dedupe: { registrarSeInedito: async () => true },
    aoReceber,
  });

  it('aceita a assinatura v=<ms>,d=<hex> sobre corpo + timestamp', async () => {
    const agora = 1_800_000_000_000;
    const { bruto, cabecalho } = assinar(corpoCallEnded(), 'chave-teste', agora - 1000);
    let recebido = false;
    const r = await processarWebhook(
      cfg,
      portas(async () => {
        recebido = true;
      }),
      { cabecalhos: { 'x-retell-signature': cabecalho }, corpoBruto: bruto },
      agora,
    );
    expect(r).toEqual({ status: 200, aceito: true, repetido: false });
    expect(recebido).toBe(true);
  });

  it('recusa assinatura com outra chave e timestamp fora da janela', async () => {
    const agora = 1_800_000_000_000;
    const outra = assinar(corpoCallEnded(), 'outra', agora);
    const r1 = await processarWebhook(cfg, portas(async () => {}), { cabecalhos: { 'x-retell-signature': outra.cabecalho }, corpoBruto: outra.bruto }, agora);
    expect(r1.status).toBe(401);
    const velho = assinar(corpoCallEnded(), 'chave-teste', agora - 10 * 60_000);
    const r2 = await processarWebhook(cfg, portas(async () => {}), { cabecalhos: { 'x-retell-signature': velho.cabecalho }, corpoBruto: velho.bruto }, agora);
    expect(r2).toMatchObject({ status: 401, motivo: 'fora_da_janela' });
  });
});

describe('falas e opt-out', () => {
  it('so agente e transportadora entram, sem palavras nem ferramentas', () => {
    expect(falasDaLigacao(corpoCallEnded().call)).toEqual([
      { quem: 'agente', texto: 'Falo com alguém da Transportadora Teste?' },
      { quem: 'transportadora', texto: 'Sim. A nota sai amanhã, peso correto 520 quilos.' },
    ]);
    expect(falasDaLigacao({})).toEqual([]);
  });

  it('opt-out so pela fala da transportadora', () => {
    expect(pediuOptout([{ quem: 'transportadora', texto: 'Por favor, não me liguem mais.' }])).toBe(true);
    expect(pediuOptout([{ quem: 'transportadora', texto: 'Não quero ser contatado de novo' }])).toBe(true);
    expect(pediuOptout([{ quem: 'agente', texto: 'Se não quiser ser contatado, avise.' }])).toBe(false);
    expect(pediuOptout([{ quem: 'transportadora', texto: 'Não, está bom, pode desligar.' }])).toBe(false);
  });
});

describe('fim da ligacao: evidencia, ledger e revisao', () => {
  function cenario(fala = 'Sim. A nota sai amanhã, peso correto 520 quilos.') {
    const eventos: Array<{ tipo: string; payload: Record<string, unknown> }> = [];
    const revisoes: unknown[] = [];
    const gravadas: RegistroEvidencia[] = [];
    const store = {
      append: async (pedidoId: string, tipo: string, payload: Record<string, unknown>) => {
        eventos.push({ tipo, payload });
        return { seq: eventos.length, pedidoId, tipo, payload, ts: '2026-11-26T00:00:00Z' } as unknown as Evento;
      },
      enfileirarRevisao: async (_o: string, motivo: string, payload: unknown) => {
        revisoes.push({ motivo, payload });
        return 1;
      },
    };
    const porta: PortaMensagensClaude = {
      create: async () => ({
        model: MODELO_EXTRACAO_PADRAO,
        stop_reason: 'end_turn',
        stop_details: null,
        content: [
          {
            type: 'text',
            text: JSON.stringify({ status: 'em_transito', previsaoEntrega: '2026-11-27', local: null, observacao: 'Peso 520 kg', confianca: 0.9 }),
            citations: null,
          },
        ],
      }),
    };
    const acordados: string[] = [];
    const efeito = aoFimDaLigacaoRetell({
      raiz: { paraWorkspace: () => store } as never,
      evidencias: {
        gravar: async (r) => {
          gravadas.push(r);
        },
      },
      cliente: criarClienteClaude({ apiKey: 'sk-teste', porta }, MODELO_EXTRACAO_PADRAO),
      config: { hostsGravacao: ['gravacoes.teste'] },
      fetch: async () => new Response(Buffer.from('RIFF-teste'), { status: 200, headers: { 'content-type': 'binary/octet-stream' } }),
      agora: () => 1_800_000_000_000,
      hoje: () => '2026-11-26',
      acordarPedido: async (_ws, p) => {
        acordados.push(p);
      },
    });
    const corpo = corpoCallEnded({
      transcript_object: [
        { role: 'agent', content: 'Falo com alguém da Transportadora Teste?' },
        { role: 'user', content: fala },
      ],
    });
    const ev = {
      fornecedor: 'retell',
      tentativa: { workspaceId: 'ws', pedidoId: CHAVE_NF, casoId: `${CHAVE_NF}:3`, chave: 'k' },
      corpo,
      idEvento: 'call_ended:call_abc123',
      idExterno: 'call_abc123',
      recebidoEmMs: 0,
    };
    return { efeito, ev, eventos, revisoes, gravadas, acordados };
  }

  it('grava transcricao e audio por hash, ligacao_concluida sem dado pessoal e a declaracao na revisao', async () => {
    const c = cenario();
    await c.efeito(c.ev);
    expect(c.gravadas.map((g) => g.tipo).sort()).toEqual(['audio', 'transcricao']);
    const concluida = c.eventos.find((e) => e.tipo === 'ligacao_concluida')!;
    expect(concluida.payload).toMatchObject({ canal: 'ligacao', fornecedor: 'retell', idExterno: 'call_abc123', resultado: 'agent_hangup', duracaoS: 64 });
    expect(concluida.payload['hashAudio']).toMatch(/^[0-9a-f]{64}$/);
    expect(concluida.payload['hashTranscricao']).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(concluida.payload)).not.toContain('520');
    expect(c.eventos.some((e) => e.tipo === 'contato_optout')).toBe(false);
    expect(c.revisoes).toHaveLength(1);
    expect(JSON.stringify(c.revisoes[0])).toContain('ligacao_transportadora');
    expect(c.acordados).toEqual([CHAVE_NF]);
  });

  it('pedido de nao contatar grava contato_optout', async () => {
    const c = cenario('Não me liguem mais, por favor.');
    await c.efeito(c.ev);
    expect(c.eventos.map((e) => e.tipo)).toEqual(['ligacao_concluida', 'contato_optout']);
  });

  it('outros eventos da Retell nao gravam nada', async () => {
    const c = cenario();
    await c.efeito({ ...c.ev, corpo: { event: 'call_started', call: { call_id: 'call_abc123' } } });
    expect(c.eventos).toHaveLength(0);
    expect(c.gravadas).toHaveLength(0);
  });
});

describe('endereco do webhook', () => {
  it('aponta o agente para a URL publica, so https', async () => {
    const chamadas: Array<{ url: string; corpo: unknown }> = [];
    const r = await sincronizarWebhookRetell({ apiKey: 'k', agentId: 'agent_teste' }, 'https://exemplo.teste/', async (url, init) => {
      chamadas.push({ url, corpo: JSON.parse(String(init.body)) });
      return new Response('{}', { status: 200 });
    });
    expect(r).toEqual({ ok: true, url: 'https://exemplo.teste/api/operador/webhooks/retell' });
    expect(chamadas[0]).toEqual({
      url: 'https://api.retellai.com/update-agent/agent_teste',
      corpo: { webhook_url: 'https://exemplo.teste/api/operador/webhooks/retell', webhook_events: ['call_ended'] },
    });
    expect(await sincronizarWebhookRetell({ apiKey: 'k', agentId: 'a' }, 'http://exemplo.teste', async () => new Response())).toEqual({
      ok: false,
      motivo: 'url_sem_https',
    });
  });
});

describe('pareceAudio', () => {
  it('reconhece WAV e MP3 e recusa HTML', () => {
    expect(pareceAudio(Buffer.from('RIFF....WAVE'))).toBe(true);
    expect(pareceAudio(Buffer.from('ID3...'))).toBe(true);
    expect(pareceAudio(Buffer.from('<html>'))).toBe(false);
  });
});
