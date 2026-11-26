import { describe, expect, it, vi } from 'vitest';
import {
  baixarESalvarEvidencia,
  baixarEvidencia,
  calcularApagarEm,
  contemEmail,
  contemTelefone,
  ErroDadoPessoal,
  exigirPayloadSemDadoPessoal,
  pareceTextoLivre,
  RETENCAO_PADRAO_DIAS,
  salvarEvidencia,
  sha256Hex,
  validarUrlEvidencia,
  varrerDadoPessoal,
  type FetchEvidencia,
  type PortaEvidencias,
  type RegistroEvidencia,
} from './evidencia.js';

// Fixture sintetica (A7): bytes que imitam um cabecalho WAV, nao e audio real.
const AUDIO_SINTETICO = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(512, 7)]);
const HOST = 'gravacoes.fornecedor.teste';
const URL_AUDIO = `https://${HOST}/v1/ligacoes/abc/audio`;
const AGORA = Date.UTC(2026, 10, 26, 13, 0);
const DIA = 86_400_000;
const CHAVE_NOTA = '35261112345678000190550010000012341000012345';

function portaEmMemoria(): PortaEvidencias & { linhas: RegistroEvidencia[] } {
  const linhas: RegistroEvidencia[] = [];
  return {
    linhas,
    async gravar(r) {
      if (!linhas.some((l) => l.workspaceId === r.workspaceId && l.hash === r.hash)) linhas.push(r);
    },
  };
}

function resposta(corpo: ConstructorParameters<typeof Response>[0], init: ResponseInit & { headers?: Record<string, string> } = {}): Response {
  return new Response(corpo, { status: 200, ...init, headers: { 'content-type': 'audio/wav', ...init.headers } });
}

function fetchFalso(...respostas: Response[]) {
  const fila = [...respostas];
  return vi.fn<FetchEvidencia>(async () => {
    const r = fila.shift();
    if (!r) throw new Error('chamada inesperada');
    return r;
  });
}

describe('retencao (RF25)', () => {
  it('apagar_em padrao e agora mais 90 dias', () => {
    expect(RETENCAO_PADRAO_DIAS).toBe(90);
    expect(calcularApagarEm(AGORA).getTime()).toBe(AGORA + 90 * DIA);
    expect(calcularApagarEm(AGORA, 30).getTime()).toBe(AGORA + 30 * DIA);
  });

  it('retencao ou instante invalido falha cedo', () => {
    expect(() => calcularApagarEm(AGORA, 0)).toThrow(RangeError);
    expect(() => calcularApagarEm(AGORA, Number.NaN)).toThrow(RangeError);
    expect(() => calcularApagarEm(Number.NaN)).toThrow(RangeError);
  });

  it('salvarEvidencia grava workspace, hash, tipo, conteudo e apagar_em', async () => {
    const porta = portaEmMemoria();
    const salva = await salvarEvidencia(porta, { workspaceId: 'ws-1', tipo: 'audio', conteudo: AUDIO_SINTETICO, agoraMs: AGORA });
    expect(salva.hash).toBe(sha256Hex(AUDIO_SINTETICO));
    expect(salva.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(porta.linhas).toEqual([
      { workspaceId: 'ws-1', hash: salva.hash, tipo: 'audio', conteudo: AUDIO_SINTETICO, apagarEm: new Date(AGORA + 90 * DIA) },
    ]);
  });

  it('recusa workspace vazio e tipo fora da lista', async () => {
    const porta = portaEmMemoria();
    await expect(salvarEvidencia(porta, { workspaceId: ' ', tipo: 'audio', conteudo: AUDIO_SINTETICO, agoraMs: AGORA })).rejects.toThrow(
      RangeError,
    );
    await expect(
      salvarEvidencia(porta, { workspaceId: 'ws-1', tipo: 'eml' as never, conteudo: AUDIO_SINTETICO, agoraMs: AGORA }),
    ).rejects.toThrow(RangeError);
    expect(porta.linhas).toHaveLength(0);
  });
});

describe('url de download (RF17)', () => {
  it('aceita https em host da lista e recusa o resto', () => {
    expect(validarUrlEvidencia(URL_AUDIO, [HOST]).ok).toBe(true);
    expect(validarUrlEvidencia(URL_AUDIO, [HOST.toUpperCase()]).ok).toBe(true);
    expect(validarUrlEvidencia(`http://${HOST}/a`, [HOST])).toEqual({ ok: false, motivo: 'nao_https' });
    expect(validarUrlEvidencia('https://outro.teste/a', [HOST])).toEqual({ ok: false, motivo: 'host_nao_permitido' });
    // Subdominio e sufixo nao valem: comparacao exata.
    expect(validarUrlEvidencia(`https://x.${HOST}/a`, [HOST])).toEqual({ ok: false, motivo: 'host_nao_permitido' });
    expect(validarUrlEvidencia(`https://${HOST}.evil.teste/a`, [HOST])).toEqual({ ok: false, motivo: 'host_nao_permitido' });
    expect(validarUrlEvidencia(`https://u:p@${HOST}/a`, [HOST])).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(validarUrlEvidencia(`https://${HOST}:8443/a`, [HOST])).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(validarUrlEvidencia('nao e url', [HOST])).toEqual({ ok: false, motivo: 'url_invalida' });
    expect(validarUrlEvidencia(URL_AUDIO, [])).toEqual({ ok: false, motivo: 'host_nao_permitido' });
  });
});

describe('download de evidencia', () => {
  it('baixa audio sintetico, calcula sha256 e manda o cabecalho so ao host original', async () => {
    const fetch = fetchFalso(resposta(AUDIO_SINTETICO));
    const r = await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch, cabecalhos: { 'xi-api-key': 'teste' } });
    expect(r).toEqual({
      ok: true,
      conteudo: AUDIO_SINTETICO,
      hash: sha256Hex(AUDIO_SINTETICO),
      tipoConteudo: 'audio/wav',
      bytes: AUDIO_SINTETICO.byteLength,
    });
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe(URL_AUDIO);
    expect(init).toMatchObject({ method: 'GET', redirect: 'manual', headers: { 'xi-api-key': 'teste' } });
  });

  it('host fora da lista nem chega ao fetch', async () => {
    const fetch = fetchFalso();
    expect(await baixarEvidencia('https://atacante.teste/a.wav', 'audio', { hostsPermitidos: [HOST], fetch })).toEqual({
      ok: false,
      motivo: 'host_nao_permitido',
    });
    expect(await baixarEvidencia(`http://${HOST}/a.wav`, 'audio', { hostsPermitidos: [HOST], fetch })).toEqual({
      ok: false,
      motivo: 'nao_https',
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('tipo de conteudo fora da lista e recusado', async () => {
    const fetch = fetchFalso(resposta('<html>', { headers: { 'content-type': 'text/html; charset=utf-8' } }));
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch })).toEqual({
      ok: false,
      motivo: 'tipo_nao_permitido',
    });
  });

  it('transcricao aceita json e recusa audio', async () => {
    const json = resposta('{"falas":[]}', { headers: { 'content-type': 'application/json; charset=utf-8' } });
    const ok = await baixarEvidencia(URL_AUDIO, 'transcricao', { hostsPermitidos: [HOST], fetch: fetchFalso(json) });
    expect(ok).toMatchObject({ ok: true, tipoConteudo: 'application/json' });
    const audio = await baixarEvidencia(URL_AUDIO, 'transcricao', { hostsPermitidos: [HOST], fetch: fetchFalso(resposta(AUDIO_SINTETICO)) });
    expect(audio).toEqual({ ok: false, motivo: 'tipo_nao_permitido' });
  });

  it('content-length acima do limite recusa antes de ler', async () => {
    const fetch = fetchFalso(resposta(AUDIO_SINTETICO, { headers: { 'content-length': '999999999' } }));
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch, limiteBytes: 1000 })).toEqual({
      ok: false,
      motivo: 'tamanho_excedido',
    });
  });

  it('corpo maior que o limite sem content-length e cortado na leitura', async () => {
    const grande = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < 10; i += 1) c.enqueue(new Uint8Array(400));
        c.close();
      },
    });
    const fetch = fetchFalso(resposta(grande));
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch, limiteBytes: 1000 })).toEqual({
      ok: false,
      motivo: 'tamanho_excedido',
    });
  });

  it('status de erro e corpo vazio nao viram evidencia', async () => {
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch: fetchFalso(resposta('x', { status: 404 })) })).toEqual({
      ok: false,
      motivo: 'status_http',
      status: 404,
    });
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch: fetchFalso(resposta(new Uint8Array(0))) })).toEqual({
      ok: false,
      motivo: 'vazio',
    });
  });

  it('segue redirecionamento so para host da lista e sem os cabecalhos de outro host', async () => {
    const ARMAZEM = 'armazem.fornecedor.teste';
    const fetch = fetchFalso(
      new Response(null, { status: 302, headers: { location: `https://${ARMAZEM}/assinado?x=1` } }),
      resposta(AUDIO_SINTETICO),
    );
    const r = await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST, ARMAZEM], fetch, cabecalhos: { 'xi-api-key': 'teste' } });
    expect(r.ok).toBe(true);
    expect(fetch.mock.calls[1]![0]).toBe(`https://${ARMAZEM}/assinado?x=1`);
    expect(fetch.mock.calls[1]![1].headers).toEqual({});
  });

  it('redirecionamento para host fora da lista ou http e recusado', async () => {
    const paraFora = fetchFalso(new Response(null, { status: 302, headers: { location: 'https://atacante.teste/a' } }));
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch: paraFora })).toEqual({
      ok: false,
      motivo: 'redirecionamento_invalido',
    });
    const paraHttp = fetchFalso(new Response(null, { status: 301, headers: { location: `http://${HOST}/a` } }));
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch: paraHttp })).toEqual({
      ok: false,
      motivo: 'redirecionamento_invalido',
    });
    expect(paraFora).toHaveBeenCalledTimes(1);
  });

  it('para depois de muitos redirecionamentos', async () => {
    const volta = () => new Response(null, { status: 302, headers: { location: URL_AUDIO } });
    const fetch = fetchFalso(volta(), volta(), volta());
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch, maxRedirecionamentos: 2 })).toEqual({
      ok: false,
      motivo: 'muitos_redirecionamentos',
    });
  });

  it('falha de rede vira motivo, sem lancar', async () => {
    const fetch = vi.fn<FetchEvidencia>(async () => {
      throw new TypeError('fetch failed');
    });
    expect(await baixarEvidencia(URL_AUDIO, 'audio', { hostsPermitidos: [HOST], fetch })).toEqual({ ok: false, motivo: 'falha_rede' });
  });

  it('baixar e salvar grava o mesmo hash do download, uma vez por workspace', async () => {
    const porta = portaEmMemoria();
    const entrada = { url: URL_AUDIO, tipo: 'audio' as const, workspaceId: 'ws-1', agoraMs: AGORA, retencaoDias: 90 };
    const r1 = await baixarESalvarEvidencia(porta, entrada, { hostsPermitidos: [HOST], fetch: fetchFalso(resposta(AUDIO_SINTETICO)) });
    const r2 = await baixarESalvarEvidencia(porta, entrada, { hostsPermitidos: [HOST], fetch: fetchFalso(resposta(AUDIO_SINTETICO)) });
    expect(r1).toEqual({
      ok: true,
      tipoConteudo: 'audio/wav',
      hash: sha256Hex(AUDIO_SINTETICO),
      apagarEm: new Date(AGORA + 90 * DIA),
      bytes: AUDIO_SINTETICO.byteLength,
    });
    expect(r2).toEqual(r1);
    expect(porta.linhas).toHaveLength(1);
    expect(porta.linhas[0]).toMatchObject({ workspaceId: 'ws-1', tipo: 'audio' });
  });

  it('falha da porta vira falha_gravacao', async () => {
    const porta: PortaEvidencias = {
      async gravar() {
        throw new Error('relation "evidencias" does not exist');
      },
    };
    const r = await baixarESalvarEvidencia(
      porta,
      { url: URL_AUDIO, tipo: 'audio', workspaceId: 'ws-1', agoraMs: AGORA },
      { hostsPermitidos: [HOST], fetch: fetchFalso(resposta(AUDIO_SINTETICO)) },
    );
    expect(r).toEqual({ ok: false, motivo: 'falha_gravacao' });
  });
});

describe('detectores de dado pessoal', () => {
  it('telefone em formatos comuns', () => {
    for (const t of [
      '+5511987654321',
      '11987654321',
      '(11) 98765-4321',
      'ligar para 11 98765 4321 amanha',
      '+55 (11) 9 8765-4321',
      'tel:+55-11-98765-4321',
      '5511987654321@s.whatsapp.net',
      '(011) 3456-7890',
      '+1 415 555 2671',
    ]) {
      expect(contemTelefone(t), t).toBe(true);
    }
  });

  it('nao confunde chave da nota, hash, uuid, data e codigo com telefone', () => {
    for (const t of [
      CHAVE_NOTA,
      `${CHAVE_NOTA}:7`,
      sha256Hex('qualquer'),
      'a3f5119876543210bb',
      '550e8400-e29b-41d4-a716-446655440000',
      '2026-11-26T13:00:00.000Z',
      '2026-11-26',
      'sem_contato',
      'contato_incerto',
      '1795000000000',
    ]) {
      expect(contemTelefone(t), t).toBe(false);
    }
  });

  it('e-mail', () => {
    expect(contemEmail('ops@transportadora.dev')).toBe(true);
    expect(contemEmail('Fulano <fulano.silva+x@empresa.com.br>')).toBe(true);
    expect(contemEmail('sem arroba aqui')).toBe(false);
    expect(contemEmail(sha256Hex('x'))).toBe(false);
  });

  it('texto com cara de transcricao ou mensagem', () => {
    expect(pareceTextoLivre('Atendente: a carga saiu ontem')).toBe(true);
    expect(pareceTextoLivre('agente: bom dia\nusuario: oi')).toBe(true);
    expect(pareceTextoLivre('Sim, a mercadoria saiu do centro de distribuicao hoje cedo')).toBe(true);
    expect(pareceTextoLivre('timeout_depois_do_pedido_de_discagem')).toBe(false);
    expect(pareceTextoLivre('fetch failed')).toBe(false);
    expect(pareceTextoLivre(sha256Hex('x'))).toBe(false);
  });
});

describe('varredura de payload (invariante 6)', () => {
  const limpo = {
    planoId: 'plano-1',
    versao: 2,
    canal: 'ligacao',
    contatoId: 42,
    casoId: `${CHAVE_NOTA}:7`,
    chave: sha256Hex('fluxo:ligacao:1'),
    idExterno: 'conv_01HZX8M2',
    resultado: 'sem_contato',
    duracaoS: 125,
    custoBrl: 0.42,
    hashAudio: sha256Hex(AUDIO_SINTETICO),
    hashTranscricao: sha256Hex('t'),
    em: '2026-11-26T13:00:00.000Z',
    snapshot: { prazoMs: { email: 14_400_000, whatsapp: 3_600_000, ligacao: 0 }, destinosHash: sha256Hex('+5511987654321') },
  };

  it('payload so com ids, hashes e codigos passa', () => {
    expect(varrerDadoPessoal(limpo)).toEqual([]);
    expect(() => exigirPayloadSemDadoPessoal(limpo)).not.toThrow();
  });

  it('acha telefone, e-mail e transcricao em qualquer profundidade, sem expor o valor', () => {
    const sujo = {
      ...limpo,
      extra: { contatos: [{ x: 'whatsapp:+5511987654321' }] },
      motivo: 'erro ao ligar para ops@transportadora.dev',
      notas: 'Atendente: a carga saiu ontem, confirma o recebimento na sexta',
    };
    const achados = varrerDadoPessoal(sujo);
    expect(achados).toEqual(
      expect.arrayContaining([
        { caminho: '$.extra.contatos[0].x', tipo: 'telefone' },
        { caminho: '$.motivo', tipo: 'email' },
        { caminho: '$.notas', tipo: 'texto_livre' },
      ]),
    );
    let erro: unknown;
    try {
      exigirPayloadSemDadoPessoal(sujo);
    } catch (e) {
      erro = e;
    }
    expect(erro).toBeInstanceOf(ErroDadoPessoal);
    expect((erro as Error).message).not.toContain('98765');
    expect((erro as Error).message).not.toContain('ops@');
  });

  it('chave de dado pessoal e telefone numerico tambem falham', () => {
    expect(varrerDadoPessoal({ telefone: '***' })).toEqual([{ caminho: '$.telefone', tipo: 'chave_proibida' }]);
    expect(varrerDadoPessoal({ Destinatário: 'x' })).toEqual([{ caminho: '$.Destinatário', tipo: 'chave_proibida' }]);
    expect(varrerDadoPessoal({ transcricao: null, audio: undefined })).toEqual([]);
    expect(varrerDadoPessoal({ n: 5511987654321 })).toEqual([{ caminho: '$.n', tipo: 'telefone' }]);
    expect(varrerDadoPessoal({ n: 11987654321 })).toEqual([{ caminho: '$.n', tipo: 'telefone' }]);
    expect(varrerDadoPessoal({ conteudo: AUDIO_SINTETICO })).toEqual([{ caminho: '$.conteudo', tipo: 'binario' }]);
    expect(varrerDadoPessoal({ '+5511987654321': 1 })).toEqual([{ caminho: '$.+5511987654321(chave)', tipo: 'telefone' }]);
  });
});
