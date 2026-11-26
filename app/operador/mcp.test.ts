import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  CAMINHO_MCP,
  CAMPOS_PROJECAO_MCP,
  consultarCasoMcp,
  criarServidorMcp,
  emitirTokenMcp,
  NOME_FERRAMENTA_MCP,
  projetarCasoMcp,
  registrarRotaMcp,
  VALIDADE_MAX_TOKEN_MS,
  verificarTokenMcp,
  type CasoLidoMcp,
  type DepsMcp,
  type EscopoTokenMcp,
  type PortaMcp,
} from './mcp.js';

// Tudo sintetico (A7): segredo de teste, chave de nota inventada, telefone e
// e-mail ficticios plantados na porta para provar que nao saem.
const SEGREDO = 'segredo-de-teste-com-mais-de-32-caracteres';
const AGORA = Date.UTC(2026, 10, 26, 13, 0);
const DEZ_MIN = 10 * 60_000;
const CHAVE_NOTA = '35261112345678000190550010000012341000012345';
const CASO = `${CHAVE_NOTA}:7`;
const ESCOPO: EscopoTokenMcp = { workspaceId: 'ws-a', casoId: CASO, tentativa: 'chave-tentativa-1' };
const FONE = '+5511987654321';

const CASO_LIDO: CasoLidoMcp = {
  statusCaso: 'aberto',
  chaveNota: CHAVE_NOTA,
  abertoEm: '2026-11-25T10:00:00.000Z',
  previsaoEntrega: '2026-11-27',
  ultimaAtualizacaoEm: '2026-11-24T18:30:00.000Z',
  statusPedido: 'em_transito',
  perguntaPendente: 'Qual a previsão de entrega desta nota?',
};

// Porta falsa que devolve, alem do caso, tudo o que nunca pode sair.
function portaFalsa(opcoes: { casos?: Record<string, CasoLidoMcp>; revogadas?: string[] } = {}) {
  const casos = opcoes.casos ?? { [`ws-a|${CASO}`]: CASO_LIDO };
  const revogadas = new Set(opcoes.revogadas ?? []);
  const chamadas: Array<[string, string]> = [];
  const porta: PortaMcp = {
    async lerCaso(ws, caso) {
      chamadas.push([ws, caso]);
      const lido = casos[`${ws}|${caso}`];
      if (!lido) return null;
      const comVazamento = {
        ...lido,
        token: 'token-do-parceiro-spec-0011',
        telefone: FONE,
        destino: FONE,
        email: 'ops@transportadora.dev',
        eml: 'Received: from mx...',
        contato: { nome: 'Fulano', fone: FONE },
      };
      return comVazamento;
    },
    async tentativaRevogada(e) {
      return revogadas.has(`${e.workspaceId}|${e.casoId}|${e.tentativa}`);
    },
  };
  return { porta, chamadas };
}

function deps(porta: PortaMcp, agoraMs = AGORA): DepsMcp {
  return { segredo: SEGREDO, porta, agora: () => agoraMs };
}

function token(escopo: EscopoTokenMcp = ESCOPO, validadeMs = DEZ_MIN, segredo = SEGREDO): string {
  return emitirTokenMcp(segredo, escopo, { agoraMs: AGORA, validadeMs });
}

// Cliente MCP real do SDK, ligado em memoria. O token entra como authInfo,
// como o transporte HTTP faria a partir do cabecalho Authorization.
const abertos: Array<() => Promise<void>> = [];
async function conectar(d: DepsMcp, tok?: string): Promise<Client> {
  const [ladoCliente, ladoServidor] = InMemoryTransport.createLinkedPair();
  const enviar = ladoCliente.send.bind(ladoCliente);
  ladoCliente.send = (mensagem, opcoes) =>
    enviar(mensagem, { ...opcoes, authInfo: tok ? { token: tok, clientId: 'teste', scopes: [] } : undefined });
  const servidor = criarServidorMcp(d);
  await servidor.connect(ladoServidor);
  const cliente = new Client({ name: 'agente-voz-teste', version: '0.0.0' });
  await cliente.connect(ladoCliente);
  abertos.push(async () => {
    await cliente.close();
    await servidor.close();
  });
  return cliente;
}

afterEach(async () => {
  for (const fechar of abertos.splice(0)) await fechar();
});

type ResultadoFerramenta = { isError?: boolean; structuredContent?: Record<string, unknown>; content: unknown };

async function consultar(cliente: Client, args: Record<string, unknown> = {}): Promise<ResultadoFerramenta> {
  return (await cliente.callTool({ name: NOME_FERRAMENTA_MCP, arguments: args })) as ResultadoFerramenta;
}

describe('token do MCP', () => {
  it('emite e verifica workspace, caso, tentativa e validade', () => {
    expect(verificarTokenMcp(SEGREDO, token(), AGORA + 1000)).toEqual({ ok: true, claims: { ...ESCOPO, expiraEmMs: AGORA + DEZ_MIN } });
  });

  it('recusa ausente, malformado, outro segredo e adulterado', () => {
    expect(verificarTokenMcp(SEGREDO, undefined, AGORA)).toEqual({ ok: false, motivo: 'token_ausente' });
    expect(verificarTokenMcp(SEGREDO, '', AGORA)).toEqual({ ok: false, motivo: 'token_ausente' });
    expect(verificarTokenMcp(SEGREDO, 'abc', AGORA)).toEqual({ ok: false, motivo: 'token_invalido' });
    expect(verificarTokenMcp(SEGREDO, token(ESCOPO, DEZ_MIN, 'outro-segredo-com-mais-de-32-caracteres!'), AGORA)).toEqual({
      ok: false,
      motivo: 'token_invalido',
    });
    // Troca o caso no corpo e mantem a assinatura original.
    const [prefixo, corpo, assinatura] = token().split('.');
    const claims = JSON.parse(Buffer.from(corpo!, 'base64url').toString('utf8'));
    const adulterado = Buffer.from(JSON.stringify({ ...claims, caso: `${CHAVE_NOTA}:8` })).toString('base64url');
    expect(verificarTokenMcp(SEGREDO, `${prefixo}.${adulterado}.${assinatura}`, AGORA)).toEqual({ ok: false, motivo: 'token_invalido' });
    const outroWs = Buffer.from(JSON.stringify({ ...claims, ws: 'ws-b' })).toString('base64url');
    expect(verificarTokenMcp(SEGREDO, `${prefixo}.${outroWs}.${assinatura}`, AGORA)).toEqual({ ok: false, motivo: 'token_invalido' });
  });

  it('expira no instante da validade', () => {
    const t = token();
    expect(verificarTokenMcp(SEGREDO, t, AGORA + DEZ_MIN - 1).ok).toBe(true);
    expect(verificarTokenMcp(SEGREDO, t, AGORA + DEZ_MIN)).toEqual({ ok: false, motivo: 'token_expirado' });
  });

  it('segredo curto nao emite nem verifica', () => {
    expect(() => emitirTokenMcp('curto', ESCOPO, { agoraMs: AGORA, validadeMs: DEZ_MIN })).toThrow(RangeError);
    expect(verificarTokenMcp('', token(), AGORA)).toEqual({ ok: false, motivo: 'token_invalido' });
  });

  it('validade fora do limite e escopo incompleto falham na emissao', () => {
    expect(() => token(ESCOPO, VALIDADE_MAX_TOKEN_MS + 1)).toThrow(RangeError);
    expect(() => token(ESCOPO, 0)).toThrow(RangeError);
    expect(() => token({ ...ESCOPO, tentativa: '' })).toThrow(RangeError);
  });
});

describe('ferramentas do MCP (RF21)', () => {
  it('so existe a ferramenta de leitura, sem recursos nem prompts', async () => {
    const cliente = await conectar(deps(portaFalsa().porta), token());
    const { tools } = await cliente.listTools();
    expect(tools.map((t) => t.name)).toEqual([NOME_FERRAMENTA_MCP]);
    expect(tools[0]!.annotations).toMatchObject({ readOnlyHint: true, destructiveHint: false });
    expect(tools[0]!.inputSchema).toMatchObject({ type: 'object' });
    expect(Object.keys(tools[0]!.inputSchema.properties ?? {})).toEqual([]);
    expect(cliente.getServerCapabilities()).not.toHaveProperty('resources');
    expect(cliente.getServerCapabilities()).not.toHaveProperty('prompts');
    await expect(cliente.listResources()).rejects.toThrow();
    await expect(cliente.listPrompts()).rejects.toThrow();
  });

  it('chamar ferramenta de escrita falha', async () => {
    const cliente = await conectar(deps(portaFalsa().porta), token());
    for (const nome of ['gravar_evento', 'registrar_status', 'status_declarado']) {
      const r = (await cliente.callTool({ name: nome, arguments: { status: 'entregue' } })) as ResultadoFerramenta;
      expect(r.isError).toBe(true);
    }
  });

  it('devolve so a projecao em lista fechada, mesmo com a porta mandando token e telefone', async () => {
    const cliente = await conectar(deps(portaFalsa().porta), token());
    const r = await consultar(cliente);
    expect(r.isError).toBeFalsy();
    expect(r.structuredContent).toEqual({
      caso: {
        chaveNota: CHAVE_NOTA,
        abertoEm: '2026-11-25T10:00:00.000Z',
        previsaoEntrega: '2026-11-27',
        ultimaAtualizacaoEm: '2026-11-24T18:30:00.000Z',
        statusPedido: 'em_transito',
        perguntaPendente: 'Qual a previsão de entrega desta nota?',
      },
    });
    expect(Object.keys((r.structuredContent as { caso: object }).caso).sort()).toEqual([...CAMPOS_PROJECAO_MCP].sort());
    const tudo = JSON.stringify(r);
    for (const proibido of ['token-do-parceiro', '98765', 'ops@', 'Received:', 'Fulano', 'telefone', 'email', 'eml']) {
      expect(tudo).not.toContain(proibido);
    }
  });

  it('recusa sem token, token invalido, vencido e revogado', async () => {
    const semToken = await conectar(deps(portaFalsa().porta));
    expect((await consultar(semToken)).structuredContent).toEqual({ erro: 'token_ausente' });

    const invalido = await conectar(deps(portaFalsa().porta), `${token()}x`);
    expect((await consultar(invalido)).structuredContent).toEqual({ erro: 'token_invalido' });

    const vencido = await conectar(deps(portaFalsa().porta, AGORA + DEZ_MIN + 1), token());
    const rv = await consultar(vencido);
    expect(rv.isError).toBe(true);
    expect(rv.structuredContent).toEqual({ erro: 'token_expirado' });

    const { porta } = portaFalsa({ revogadas: [`ws-a|${CASO}|chave-tentativa-1`] });
    const revogado = await conectar(deps(porta), token());
    expect((await consultar(revogado)).structuredContent).toEqual({ erro: 'token_revogado' });
  });

  it('token de outro caso ou workspace nao le este caso; argumento nao troca o caso', async () => {
    const { porta, chamadas } = portaFalsa();
    // Caso existe so no ws-a; token do ws-b para o mesmo caso nao acha nada.
    const outroWs = await conectar(deps(porta), token({ ...ESCOPO, workspaceId: 'ws-b' }));
    expect((await consultar(outroWs)).structuredContent).toEqual({ erro: 'caso_nao_encontrado' });
    const outroCaso = await conectar(deps(porta), token({ ...ESCOPO, casoId: `${CHAVE_NOTA}:8` }));
    expect((await consultar(outroCaso)).structuredContent).toEqual({ erro: 'caso_nao_encontrado' });
    // Token do ws-b pedindo por argumento o caso do ws-a: o argumento e ignorado.
    const comArgs = await conectar(deps(porta), token({ ...ESCOPO, workspaceId: 'ws-b' }));
    expect((await consultar(comArgs, { workspaceId: 'ws-a', casoId: CASO })).structuredContent).toEqual({ erro: 'caso_nao_encontrado' });
    expect(chamadas).toEqual([
      ['ws-b', CASO],
      ['ws-a', `${CHAVE_NOTA}:8`],
      ['ws-b', CASO],
    ]);
  });

  it('caso fechado responde caso_encerrado', async () => {
    const { porta } = portaFalsa({ casos: { [`ws-a|${CASO}`]: { ...CASO_LIDO, statusCaso: 'resolvido' } } });
    const cliente = await conectar(deps(porta), token());
    const r = await consultar(cliente);
    expect(r.isError).toBe(true);
    expect(r.structuredContent).toEqual({ erro: 'caso_encerrado' });
  });

  it('erro da porta nao vaza detalhe', async () => {
    const porta: PortaMcp = {
      async lerCaso() {
        throw new Error('SELECT * FROM events WHERE telefone = +5511987654321');
      },
      async tentativaRevogada() {
        return false;
      },
    };
    const r = await consultarCasoMcp(deps(porta), token());
    expect(r).toMatchObject({ isError: true, structuredContent: { erro: 'erro_interno' } });
    expect(JSON.stringify(r)).not.toContain('SELECT');
  });
});

describe('projecao do caso', () => {
  it('descarta campo fora do formato e pergunta com telefone ou e-mail', () => {
    expect(
      projetarCasoMcp({
        ...CASO_LIDO,
        previsaoEntrega: 'amanha de manha',
        statusPedido: 'Entregue para Fulano no 11 98765-4321',
        perguntaPendente: `Confirma com ${FONE}?`,
      }),
    ).toEqual({
      chaveNota: CHAVE_NOTA,
      abertoEm: CASO_LIDO.abertoEm,
      previsaoEntrega: null,
      ultimaAtualizacaoEm: CASO_LIDO.ultimaAtualizacaoEm,
      statusPedido: null,
      perguntaPendente: null,
    });
    expect(projetarCasoMcp({ ...CASO_LIDO, perguntaPendente: 'Mande para ops@transportadora.dev' })?.perguntaPendente).toBeNull();
  });

  it('sem chave de nota valida ou data de abertura nao ha projecao', () => {
    expect(projetarCasoMcp({ ...CASO_LIDO, chaveNota: '123' })).toBeNull();
    expect(projetarCasoMcp({ ...CASO_LIDO, abertoEm: 'ontem' })).toBeNull();
  });
});

describe('rota HTTP do MCP', () => {
  const ACCEPT = 'application/json, text/event-stream';

  async function app(porta: PortaMcp, agoraMs = AGORA) {
    const a = Fastify();
    registrarRotaMcp(a, deps(porta, agoraMs));
    await a.ready();
    abertos.push(() => a.close());
    return a;
  }

  function chamada(id: number) {
    return { jsonrpc: '2.0', id, method: 'tools/call', params: { name: NOME_FERRAMENTA_MCP, arguments: {} } };
  }

  it('sem token, com token invalido ou revogado responde 401 antes do MCP', async () => {
    const a = await app(portaFalsa({ revogadas: [`ws-a|${CASO}|chave-tentativa-1`] }).porta);
    const semToken = await a.inject({ method: 'POST', url: CAMINHO_MCP, headers: { accept: ACCEPT }, payload: chamada(1) });
    expect(semToken.statusCode).toBe(401);
    expect(semToken.json()).toEqual({ erro: 'token_ausente' });
    const invalido = await a.inject({
      method: 'POST',
      url: CAMINHO_MCP,
      headers: { accept: ACCEPT, authorization: 'Bearer mcp1.xx.yy' },
      payload: chamada(2),
    });
    expect(invalido.statusCode).toBe(401);
    const revogado = await a.inject({
      method: 'POST',
      url: CAMINHO_MCP,
      headers: { accept: ACCEPT, authorization: `Bearer ${token()}` },
      payload: chamada(3),
    });
    expect(revogado.statusCode).toBe(401);
    expect(revogado.json()).toEqual({ erro: 'token_revogado' });
  });

  it('com token valido responde a projecao por JSON-RPC', async () => {
    const a = await app(portaFalsa().porta);
    const r = await a.inject({
      method: 'POST',
      url: CAMINHO_MCP,
      headers: { accept: ACCEPT, authorization: `Bearer ${token()}` },
      payload: chamada(7),
    });
    expect(r.statusCode).toBe(200);
    const corpo = r.json() as { id: number; result: ResultadoFerramenta };
    expect(corpo.id).toBe(7);
    expect(corpo.result.structuredContent).toMatchObject({ caso: { chaveNota: CHAVE_NOTA, statusPedido: 'em_transito' } });
    expect(r.body).not.toContain('98765');
    expect(r.body).not.toContain('token-do-parceiro');
  });

  it('GET e DELETE respondem 405', async () => {
    const a = await app(portaFalsa().porta);
    expect((await a.inject({ method: 'GET', url: CAMINHO_MCP })).statusCode).toBe(405);
    expect((await a.inject({ method: 'DELETE', url: CAMINHO_MCP })).statusCode).toBe(405);
  });
});
