// Extracao de PDF (spec 0008, T222/T227): pdf-parse e fetch sao mockados,
// nenhum teste toca a rede. Cobre os motivos de revisao, o teto de expansao
// e o timeout do LLM.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ErroParser } from './nfe.js';

const estado = vi.hoisted(() => ({
  texto: 'DANFE documento auxiliar ficticio',
  total: 3,
}));

vi.mock('pdf-parse', () => ({
  PDFParse: class {
    constructor(_opts: unknown) {}
    async getText() {
      return { text: estado.texto, total: estado.total, pages: [] };
    }
    async destroy() {}
  },
}));

const { parsePdf } = await import('./pdf.js');

const CHAVE44 = '35260123456789000123550010000000011000000019';
const BUF = Buffer.from('%PDF-1.4\nficticio\n');
const ENV_GUARDADO: Record<string, string | undefined> = {};

const respostaLlm = (extracao: unknown) => ({
  ok: true,
  status: 200,
  json: async () => ({ choices: [{ message: { content: JSON.stringify(extracao) } }] }),
});

beforeEach(() => {
  estado.texto = 'DANFE documento auxiliar ficticio';
  estado.total = 3;
  for (const k of ['LLM_API_URL', 'LLM_API_KEY', 'LLM_MODEL']) {
    ENV_GUARDADO[k] = process.env[k];
  }
  process.env['LLM_API_URL'] = 'http://llm.invalid/v1/chat';
  process.env['LLM_API_KEY'] = 'sk-teste';
});

afterEach(() => {
  for (const [k, v] of Object.entries(ENV_GUARDADO)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.unstubAllGlobals();
});

describe('sem depender de rede', () => {
  it('sem texto extraido vai para revisao (documento escaneado)', async () => {
    estado.texto = '   ';
    const r = await parsePdf(BUF);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('pdf_sem_texto_extraivel');
  });

  it('sem LLM_API_URL vai para revisao declarando o motivo', async () => {
    delete process.env['LLM_API_URL'];
    const r = await parsePdf(BUF);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('llm_nao_configurada');
  });

  it('confianca baixa vai para revisao', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaLlm({ chave_nfe: CHAVE44, confianca: 0.4 })));
    const r = await parsePdf(BUF);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('confianca_baixa');
  });

  it('chave ausente na extracao vai para revisao', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaLlm({ chave_nfe: null, confianca: 0.95 })));
    const r = await parsePdf(BUF);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('chave_nfe_ausente');
  });

  it('erro HTTP do LLM vai para revisao como llm_falhou', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })));
    const r = await parsePdf(BUF);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('llm_falhou');
  });

  it('campo com tipo invalido invalida a extracao inteira', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => respostaLlm({ chave_nfe: CHAVE44, peso_kg: 'muito pesado', confianca: 0.9 })));
    const r = await parsePdf(BUF);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('extracao_invalida');
  });

  it('extracao boa vira DocData com campos mapeados', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        respostaLlm({ chave_nfe: `${CHAVE44.slice(0, 4)} ${CHAVE44.slice(4)}`, data_prevista: '2026-01-25', peso_kg: 480.5, volumes: 7, status: 'em_transito', confianca: 0.92 }),
      ),
    );
    const r = await parsePdf(BUF);
    expect(r.revisao).toBeNull();
    expect(r.doc?.pedidoId).toBe(CHAVE44);
    expect(r.doc?.campos).toEqual({ previsaoEntrega: '2026-01-25', pesoTotal: 480.5, volumes: 7, status: 'em_transito' });
    expect(r.doc?.confianca).toBe(0.92);
  });
});

describe('teto de expansao e timeout (T227)', () => {
  it('passou do teto de paginas: ErroParser (422), sem chamar o LLM', async () => {
    estado.total = 500;
    const fetchEspiao = vi.fn();
    vi.stubGlobal('fetch', fetchEspiao);
    await expect(parsePdf(BUF, { maxPaginas: 100 })).rejects.toBeInstanceOf(ErroParser);
    await expect(parsePdf(BUF, { maxPaginas: 100 })).rejects.toThrow(/paginas/);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it('passou do teto de texto extraido: ErroParser, sem chamar o LLM', async () => {
    estado.texto = 'x'.repeat(600_000);
    const fetchEspiao = vi.fn();
    vi.stubGlobal('fetch', fetchEspiao);
    await expect(parsePdf(BUF, { maxTexto: 500_000 })).rejects.toBeInstanceOf(ErroParser);
    expect(fetchEspiao).not.toHaveBeenCalled();
  });

  it('LLM que nao responde estoura o timeout e vai para revisao, sem travar', async () => {
    vi.stubGlobal('fetch', vi.fn((_url: unknown, init: { signal?: AbortSignal }) => {
      const { signal } = init;
      return new Promise((_res, rej) => {
        signal?.addEventListener('abort', () => rej(new Error('timeout')));
      });
    }));
    const inicio = Date.now();
    const r = await parsePdf(BUF, { timeoutMs: 50 });
    expect(Date.now() - inicio).toBeLessThan(5_000);
    expect(r.doc).toBeNull();
    expect(r.revisao?.motivo).toBe('llm_falhou');
  });
});
