import Fastify from 'fastify';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assinarWebhook,
  CABECALHO_ASSINATURA_PADRAO,
  CABECALHO_TIMESTAMP_PADRAO,
  processarWebhook,
  registrarRotaWebhook,
  verificarAssinaturaWebhook,
  type ConfigWebhook,
  type PortasWebhook,
  type TentativaWebhook,
  type WebhookAceito,
} from './webhooks.js';

// Fixtures sinteticas (A7): fornecedor, segredo e ids de teste.
const SEGREDO = 'whsec_teste_sintetico';
const AGORA = Date.UTC(2026, 10, 26, 13, 0);
const TS = String(Math.floor(AGORA / 1000));
const CHAVE_NOTA = '35261112345678000190550010000012341000012345';

const TENTATIVA: TentativaWebhook = {
  workspaceId: 'ws-a',
  pedidoId: CHAVE_NOTA,
  casoId: `${CHAVE_NOTA}:7`,
  chave: 'chave-contato-iniciado',
};

const CONFIG: ConfigWebhook = {
  fornecedor: 'fornecedor-teste',
  segredo: SEGREDO,
  extrairIds: (corpo) => {
    const c = corpo as { evento_id?: string; ligacao_id?: string };
    return { idEvento: c.evento_id, idExterno: c.ligacao_id };
  },
};

function corpo(extra: Record<string, unknown> = {}): Buffer {
  return Buffer.from(JSON.stringify({ evento_id: 'evt-1', ligacao_id: 'call-123', tipo: 'ligacao_concluida', ...extra }));
}

function cabecalhos(bruto: Buffer, ts = TS, segredo = SEGREDO): Record<string, string> {
  return { [CABECALHO_TIMESTAMP_PADRAO]: ts, [CABECALHO_ASSINATURA_PADRAO]: assinarWebhook(segredo, ts, bruto) };
}

function portas(conhecidos: Record<string, TentativaWebhook> = { 'call-123': TENTATIVA }) {
  const vistos = new Set<string>();
  const recebidos: WebhookAceito[] = [];
  const p = {
    tentativas: { porIdExterno: vi.fn(async (_f: string, id: string) => conhecidos[id] ?? null) },
    dedupe: {
      registrarSeInedito: vi.fn(async (f: string, id: string) => {
        const k = `${f}|${id}`;
        if (vistos.has(k)) return false;
        vistos.add(k);
        return true;
      }),
      esquecer: vi.fn(async (f: string, id: string) => {
        vistos.delete(`${f}|${id}`);
      }),
    },
    aoReceber: vi.fn(async (e: WebhookAceito) => {
      recebidos.push(e);
    }),
  } satisfies PortasWebhook;
  return { p, recebidos };
}

describe('assinatura e janela (RF17)', () => {
  it('aceita assinatura valida dentro da janela, com ou sem prefixo sha256=', () => {
    const b = corpo();
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: cabecalhos(b), corpoBruto: b }, AGORA)).toEqual({ ok: true });
    const comPrefixo = { ...cabecalhos(b), [CABECALHO_ASSINATURA_PADRAO]: `sha256=${assinarWebhook(SEGREDO, TS, b)}` };
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: comPrefixo, corpoBruto: b }, AGORA)).toEqual({ ok: true });
  });

  it('sem assinatura ou sem timestamp', () => {
    const b = corpo();
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: { [CABECALHO_TIMESTAMP_PADRAO]: TS }, corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'sem_assinatura',
    });
    const semTs = { [CABECALHO_ASSINATURA_PADRAO]: assinarWebhook(SEGREDO, TS, b) };
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: semTs, corpoBruto: b }, AGORA)).toEqual({ ok: false, motivo: 'sem_timestamp' });
    // Cabecalho repetido e ambiguo e conta como ausente.
    const repetido = { ...cabecalhos(b), [CABECALHO_ASSINATURA_PADRAO]: ['a', 'b'] };
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: repetido, corpoBruto: b }, AGORA)).toEqual({ ok: false, motivo: 'sem_assinatura' });
  });

  it('assinatura errada: outro segredo, corpo alterado, timestamp alterado ou formato ruim', () => {
    const b = corpo();
    const outroSegredo = cabecalhos(b, TS, 'outro');
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: outroSegredo, corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
    const alterado = corpo({ resultado: 'entregue' });
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: cabecalhos(b), corpoBruto: alterado }, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
    const tsTrocado = { ...cabecalhos(b), [CABECALHO_TIMESTAMP_PADRAO]: String(Number(TS) - 1) };
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: tsTrocado, corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
    const curta = { ...cabecalhos(b), [CABECALHO_ASSINATURA_PADRAO]: 'abcd' };
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: curta, corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
    const tsRuim = { ...cabecalhos(b), [CABECALHO_TIMESTAMP_PADRAO]: '2026-11-26' };
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: tsRuim, corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'timestamp_invalido',
    });
  });

  it('segredo vazio recusa tudo', () => {
    const b = corpo();
    const semSegredo = { ...CONFIG, segredo: '' };
    expect(verificarAssinaturaWebhook(semSegredo, { cabecalhos: cabecalhos(b, TS, ''), corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'assinatura_invalida',
    });
  });

  it('fora da janela, no passado e no futuro; janela configuravel', () => {
    const b = corpo();
    const antigo = String(Number(TS) - 301);
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: cabecalhos(b, antigo), corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'fora_da_janela',
    });
    const futuro = String(Number(TS) + 301);
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: cabecalhos(b, futuro), corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'fora_da_janela',
    });
    const limite = String(Number(TS) - 300);
    expect(verificarAssinaturaWebhook(CONFIG, { cabecalhos: cabecalhos(b, limite), corpoBruto: b }, AGORA)).toEqual({ ok: true });
    const janelaCurta = { ...CONFIG, janelaMs: 10_000 };
    const onzeSeg = String(Number(TS) - 11);
    expect(verificarAssinaturaWebhook(janelaCurta, { cabecalhos: cabecalhos(b, onzeSeg), corpoBruto: b }, AGORA)).toEqual({
      ok: false,
      motivo: 'fora_da_janela',
    });
  });

  it('extrator e mensagem do fornecedor sao configuraveis', () => {
    // Formato combinado "t=...,v0=..." como o de alguns fornecedores.
    const cfg: ConfigWebhook = {
      ...CONFIG,
      extrairAssinatura: (cab) => {
        const v = String(cab['x-assinatura-combinada'] ?? '');
        return { timestamp: /t=(\d+)/.exec(v)?.[1], assinatura: /v0=([0-9a-f]+)/.exec(v)?.[1] };
      },
    };
    const b = corpo();
    const cab = { 'x-assinatura-combinada': `t=${TS},v0=${assinarWebhook(SEGREDO, TS, b)}` };
    expect(verificarAssinaturaWebhook(cfg, { cabecalhos: cab, corpoBruto: b }, AGORA)).toEqual({ ok: true });
  });
});

describe('processamento do webhook', () => {
  it('caso valido: mapeia pelo id externo e ignora ids do app no corpo', async () => {
    const { p, recebidos } = portas();
    // O fornecedor ecoa metadados: workspace e caso de outro tenant no corpo.
    const b = corpo({ metadata: { workspaceId: 'ws-atacado', casoId: 'outro:1', pedidoId: 'x' }, workspaceId: 'ws-atacado' });
    const r = await processarWebhook(CONFIG, p, { cabecalhos: cabecalhos(b), corpoBruto: b }, AGORA);
    expect(r).toEqual({ status: 200, aceito: true, repetido: false });
    expect(p.tentativas.porIdExterno).toHaveBeenCalledWith('fornecedor-teste', 'call-123');
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]).toMatchObject({
      fornecedor: 'fornecedor-teste',
      idEvento: 'evt-1',
      idExterno: 'call-123',
      tentativa: TENTATIVA,
      recebidoEmMs: AGORA,
    });
    expect(recebidos[0]!.tentativa.workspaceId).toBe('ws-a');
  });

  it('id externo desconhecido responde 404 e nao marca o evento como visto', async () => {
    const { p } = portas({});
    const b = corpo();
    const r = await processarWebhook(CONFIG, p, { cabecalhos: cabecalhos(b), corpoBruto: b }, AGORA);
    expect(r).toEqual({ status: 404, aceito: false, motivo: 'id_externo_desconhecido' });
    expect(p.dedupe.registrarSeInedito).not.toHaveBeenCalled();
    expect(p.aoReceber).not.toHaveBeenCalled();
  });

  it('id de evento repetido responde 200 sem repetir o efeito', async () => {
    const { p } = portas();
    const b = corpo();
    const req = { cabecalhos: cabecalhos(b), corpoBruto: b };
    expect(await processarWebhook(CONFIG, p, req, AGORA)).toEqual({ status: 200, aceito: true, repetido: false });
    // Reenvio com assinatura nova (timestamp novo), mesmo id de evento.
    const ts2 = String(Number(TS) + 5);
    const reenvio = { cabecalhos: cabecalhos(b, ts2), corpoBruto: b };
    expect(await processarWebhook(CONFIG, p, reenvio, AGORA + 5000)).toEqual({ status: 200, aceito: true, repetido: true });
    expect(p.aoReceber).toHaveBeenCalledTimes(1);
  });

  it('corpo nao assinado nem e lido; corpo sem ids responde 400', async () => {
    const { p } = portas();
    const extrairIds = vi.fn(CONFIG.extrairIds);
    const cfg = { ...CONFIG, extrairIds };
    const b = corpo();
    const semAssinatura = await processarWebhook(cfg, p, { cabecalhos: {}, corpoBruto: b }, AGORA);
    expect(semAssinatura).toEqual({ status: 401, aceito: false, motivo: 'sem_assinatura' });
    expect(extrairIds).not.toHaveBeenCalled();

    const naoJson = Buffer.from('nao e json');
    expect(await processarWebhook(cfg, p, { cabecalhos: cabecalhos(naoJson), corpoBruto: naoJson }, AGORA)).toEqual({
      status: 400,
      aceito: false,
      motivo: 'corpo_invalido',
    });
    const semEvento = Buffer.from(JSON.stringify({ ligacao_id: 'call-123' }));
    expect(await processarWebhook(cfg, p, { cabecalhos: cabecalhos(semEvento), corpoBruto: semEvento }, AGORA)).toEqual({
      status: 400,
      aceito: false,
      motivo: 'sem_id_evento',
    });
    const semExterno = Buffer.from(JSON.stringify({ evento_id: 'e' }));
    expect(await processarWebhook(cfg, p, { cabecalhos: cabecalhos(semExterno), corpoBruto: semExterno }, AGORA)).toEqual({
      status: 400,
      aceito: false,
      motivo: 'sem_id_externo',
    });
    expect(p.tentativas.porIdExterno).not.toHaveBeenCalled();
  });

  it('falha no efeito libera o id de evento para o reenvio entrar', async () => {
    const { p } = portas();
    p.aoReceber.mockRejectedValueOnce(new Error('banco fora'));
    const b = corpo();
    const req = { cabecalhos: cabecalhos(b), corpoBruto: b };
    expect(await processarWebhook(CONFIG, p, req, AGORA)).toEqual({ status: 500, aceito: false, motivo: 'falha_interna' });
    expect(p.dedupe.esquecer).toHaveBeenCalledWith('fornecedor-teste', 'evt-1');
    expect(await processarWebhook(CONFIG, p, req, AGORA)).toEqual({ status: 200, aceito: true, repetido: false });
  });

  it('falha da porta de mapeamento vira 500 sem efeito', async () => {
    const { p } = portas();
    p.tentativas.porIdExterno.mockRejectedValueOnce(new Error('timeout'));
    const b = corpo();
    expect(await processarWebhook(CONFIG, p, { cabecalhos: cabecalhos(b), corpoBruto: b }, AGORA)).toEqual({
      status: 500,
      aceito: false,
      motivo: 'falha_interna',
    });
    expect(p.aoReceber).not.toHaveBeenCalled();
  });
});

describe('rota do Fastify', () => {
  const CAMINHO = '/api/operador/webhooks/fornecedor-teste';
  const apps: Array<{ close(): Promise<unknown> }> = [];
  afterEach(async () => {
    for (const a of apps.splice(0)) await a.close();
  });

  async function montar(p: PortasWebhook) {
    const app = Fastify();
    // Rota JSON comum do app, para provar que o parser bruto nao vaza do escopo.
    app.post('/api/eco', async (req) => ({ corpo: req.body }));
    await registrarRotaWebhook(app, { caminho: CAMINHO, config: CONFIG, portas: p, agora: () => AGORA });
    await app.ready();
    apps.push(app);
    return app;
  }

  it('assina sobre o corpo bruto exato e responde 200 uma vez, 200 repetido depois', async () => {
    const { p, recebidos } = portas();
    const app = await montar(p);
    // Espacos e ordem de campos preservados: o HMAC e sobre os bytes recebidos.
    const bruto = Buffer.from('{ "ligacao_id":"call-123",  "evento_id":"evt-1" }');
    const headers = { 'content-type': 'application/json', ...cabecalhos(bruto) };
    const r1 = await app.inject({ method: 'POST', url: CAMINHO, headers, payload: bruto });
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ok: true });
    const r2 = await app.inject({ method: 'POST', url: CAMINHO, headers, payload: bruto });
    expect(r2.statusCode).toBe(200);
    expect(r2.json()).toEqual({ ok: true, repetido: true });
    expect(recebidos).toHaveLength(1);
    expect(recebidos[0]!.corpo).toEqual({ ligacao_id: 'call-123', evento_id: 'evt-1' });
  });

  it('sem assinatura, assinatura errada e fora da janela respondem 401 sem ecoar o corpo', async () => {
    const { p } = portas();
    const app = await montar(p);
    const bruto = corpo();
    const semAssinatura = await app.inject({ method: 'POST', url: CAMINHO, headers: { 'content-type': 'application/json' }, payload: bruto });
    expect(semAssinatura.statusCode).toBe(401);
    expect(semAssinatura.json()).toEqual({ ok: false, motivo: 'sem_assinatura' });
    const errada = await app.inject({
      method: 'POST',
      url: CAMINHO,
      headers: { 'content-type': 'application/json', ...cabecalhos(bruto, TS, 'outro') },
      payload: bruto,
    });
    expect(errada.statusCode).toBe(401);
    expect(errada.body).not.toContain('call-123');
    const velho = await app.inject({
      method: 'POST',
      url: CAMINHO,
      headers: { 'content-type': 'application/json', ...cabecalhos(bruto, String(Number(TS) - 3600)) },
      payload: bruto,
    });
    expect(velho.statusCode).toBe(401);
    expect(velho.json()).toEqual({ ok: false, motivo: 'fora_da_janela' });
    expect(p.aoReceber).not.toHaveBeenCalled();
  });

  it('id externo desconhecido responde 404; outro content-type tambem chega bruto', async () => {
    const { p } = portas({});
    const app = await montar(p);
    const bruto = corpo();
    const r = await app.inject({
      method: 'POST',
      url: CAMINHO,
      headers: { 'content-type': 'text/plain', ...cabecalhos(bruto) },
      payload: bruto,
    });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ ok: false, motivo: 'id_externo_desconhecido' });
  });

  it('o resto do app continua com o parser JSON padrao', async () => {
    const { p } = portas();
    const app = await montar(p);
    const r = await app.inject({ method: 'POST', url: '/api/eco', payload: { a: 1 } });
    expect(r.json()).toEqual({ corpo: { a: 1 } });
  });

  it('registrar sem segredo falha cedo', async () => {
    const app = Fastify();
    apps.push(app);
    await expect(registrarRotaWebhook(app, { caminho: CAMINHO, config: { ...CONFIG, segredo: '' }, portas: portas().p })).rejects.toThrow(
      /segredo/,
    );
  });
});
