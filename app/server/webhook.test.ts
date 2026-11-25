// Suite do canal webhook (spec 0012): guard SSRF no destino, validacao
// do contato e despacho por POST direto sem depender da Nvoip. O fetch
// de rede e sempre stubado; chamadas ao app seguem a referencia real.

import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Evento, Tarefa } from '../shared/model.js';
import { validarContato } from './contatos.js';
import { createLiteDb } from './db.js';
import { notificarTarefa } from './nvoip.js';
import { ErroRequisicao } from './protecao.js';
import { LedgerStore } from './store.js';
import { destinoWebhookValido, enviarWebhook, payloadWebhook } from './webhook.js';

const fetchReal = globalThis.fetch;

afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ['NVOIP_API_URL', 'NVOIP_API_KEY', 'NVOIP_NOTIFY_ON_TASK', 'LLM_API_URL', 'LLM_API_KEY']) {
    delete process.env[k];
  }
});

describe('destinoWebhookValido (guard SSRF)', () => {
  it('aceita https e http em host publico', () => {
    expect(destinoWebhookValido('https://webhook.site/abc-123')).toBe(true);
    expect(destinoWebhookValido('http://meu-endpoint.example.com:8443/hook')).toBe(true);
  });

  it('recusa esquema que nao http(s) e URL invalida', () => {
    expect(destinoWebhookValido('ftp://exemplo.com/x')).toBe(false);
    expect(destinoWebhookValido('file:///etc/passwd')).toBe(false);
    expect(destinoWebhookValido('nao-e-url')).toBe(false);
  });

  it('recusa loopback, privado e link-local', () => {
    for (const d of [
      'http://localhost/hook',
      'http://127.0.0.1:9000/hook',
      'http://[::1]/hook',
      'http://10.1.2.3/hook',
      'http://192.168.1.10/hook',
      'http://172.16.0.5/hook',
      'http://169.254.169.254/latest/meta-data',
      'http://0.0.0.0/hook',
      'http://metadata/hook',
      'http://servico.internal/hook',
      'http://impressora.local/hook',
    ]) {
      expect(destinoWebhookValido(d)).toBe(false);
    }
  });

  it('enviarWebhook nem tenta fetch com destino recusado', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    const ok = await enviarWebhook('http://169.254.169.254/x', payloadWebhook('pedido', tarefaFake()));
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function tarefaFake(): Tarefa {
  return {
    parte: 'transportadora',
    titulo: 'Verificar atraso no CT-e',
    detalhe: 'CT-e mostra em transito enquanto planilha marca atraso.',
    divergencia: { campo: 'status', fonteA: 'planilha', valorA: 'atraso', fonteB: 'cte', valorB: 'em transito' } as Tarefa['divergencia'],
  };
}

describe('validarContato com canal webhook', () => {
  it('aceita URL https publica', () => {
    const c = validarContato({ parte: 'transportadora', nome: 'Hook', canal: 'webhook', destino: 'https://webhook.site/x' });
    expect(c.canal).toBe('webhook');
    expect(c.destino).toBe('https://webhook.site/x');
  });

  it('recusa host privado e esquema invalido com 400', () => {
    for (const destino of ['http://169.254.169.254/x', 'ftp://x.com', 'localhost:9999']) {
      try {
        validarContato({ parte: 'cd', nome: 'Hook', canal: 'webhook', destino });
        expect.unreachable('devia recusar');
      } catch (e) {
        expect(e).toBeInstanceOf(ErroRequisicao);
        expect((e as ErroRequisicao).status).toBe(400);
      }
    }
  });
});

describe('notificarTarefa com contato webhook', () => {
  async function storeComContato(destino: string): Promise<LedgerStore> {
    const db = await createLiteDb();
    const seed = new LedgerStore(db);
    await seed.init();
    const s = seed.paraWorkspace('ws-hook');
    await s.upsertContato({ parte: 'transportadora', nome: 'Hook', canal: 'webhook', destino, fonte: 'manual' });
    return s;
  }

  it('entrega por POST JSON sem Nvoip configurada e registra o evento', async () => {
    const chamadas: { url: string; corpo: string }[] = [];
    vi.stubGlobal('fetch', async (url: string | URL | Request, init?: RequestInit) => {
      chamadas.push({ url: String(url), corpo: String(init?.body ?? '') });
      return new Response('ok', { status: 200 });
    });
    const s = await storeComContato('https://webhook.site/abc');
    const ev = await notificarTarefa(s, 'pedido-1', tarefaFake());
    expect(ev).not.toBeNull();
    const n = ev!.payload as unknown as { canal: string; status: string; destino: string };
    expect(n.canal).toBe('webhook');
    expect(n.status).toBe('entregue');
    expect(n.destino).toBe('https://webhook.site/abc');
    expect(chamadas).toHaveLength(1);
    const corpo = JSON.parse(chamadas[0]!.corpo) as { tipo: string; pedidoId: string; parte: string; tarefa: { titulo: string } };
    expect(corpo.tipo).toBe('tarefa');
    expect(corpo.pedidoId).toBe('pedido-1');
    expect(corpo.parte).toBe('transportadora');
    expect(corpo.tarefa.titulo).toContain('Verificar atraso');
  });

  it('falha de rede vira nao_entregue com falha_envio', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new Error('rede caiu');
    });
    const s = await storeComContato('https://webhook.site/abc');
    const ev = await notificarTarefa(s, 'pedido-2', tarefaFake());
    const n = ev!.payload as unknown as { status: string; motivo: string };
    expect(n.status).toBe('nao_entregue');
    expect(n.motivo).toBe('falha_envio');
  });

  it('resposta nao-2xx vira falha_envio', async () => {
    vi.stubGlobal('fetch', async () => new Response('teapot', { status: 418 }));
    const s = await storeComContato('https://webhook.site/abc');
    const ev = await notificarTarefa(s, 'pedido-3', tarefaFake());
    const n = ev!.payload as unknown as { status: string; motivo: string };
    expect(n.status).toBe('nao_entregue');
    expect(n.motivo).toBe('falha_envio');
  });

  it('contato nao-webhook sem Nvoip segue desligado (regressao)', async () => {
    const db = await createLiteDb();
    const seed = new LedgerStore(db);
    await seed.init();
    const s = seed.paraWorkspace('ws-wa');
    await s.upsertContato({ parte: 'cd', nome: 'Zap', canal: 'whatsapp', destino: '+55 11 90000-0000', fonte: 'manual' });
    const ev = await notificarTarefa(s, 'pedido-4', tarefaFake(), { registrarSempre: true });
    const n = ev!.payload as unknown as { status: string; motivo: string };
    expect(n.status).toBe('nao_entregue');
    expect(n.motivo).toBe('desligado');
  });
});

// Evento nao usado diretamente, mas mantido no escopo do import para o
// tipo do retorno de notificarTarefa ficar evidente na leitura.
export type { Evento as _EventoDoc };
void fetchReal;
