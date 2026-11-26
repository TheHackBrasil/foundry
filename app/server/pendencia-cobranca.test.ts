// Spec 0017, T710 e T711: a pendencia mede a ultima atualizacao so por
// documento (RF6) e a cobranca nasce uma vez por caso de pendencia aberto,
// sem renascer depois de respondida, expirada ou erro_envio (RF13). Banco
// PGlite em memoria, um workspace por teste; e-mail sintetico em transp.dev.

import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { projetarCasos } from '../shared/casos.js';
import type { Cobranca, Evento } from '../shared/model.js';
import { createLiteDb } from './db.js';
import { detectarPendencias, verificarWorkspace } from './pendencia.js';
import { CanalSSE } from './sse.js';
import { LedgerStore } from './store.js';

const H = 3_600_000;
const PEDIDO = '35260123456789000123550010000000011000000019';
const CONFIG = { horasSemAtualizacao: 24 };
const ENVS = ['COBRANCA_AUTO', 'COBRANCA_EXPIRA_HORAS', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_FROM', 'SMTP_TIMEOUT_MS'];

let base: LedgerStore;
const canal = new CanalSSE();
const envAntes: Record<string, string | undefined> = {};

beforeAll(async () => {
  for (const k of ENVS) {
    envAntes[k] = process.env[k];
    delete process.env[k];
  }
  base = new LedgerStore(await createLiteDb(), 'seed');
  await base.init();
});

afterAll(() => {
  for (const k of ENVS) {
    if (envAntes[k] === undefined) delete process.env[k];
    else process.env[k] = envAntes[k];
  }
});

const ws = (nome: string): LedgerStore => base.paraWorkspace(`ws-${nome}`);
const ha = (horas: number): string => new Date(Date.now() - horas * H).toISOString();
const daqui = (horas: number): Date => new Date(Date.now() + horas * H);
const pausa = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Tipo de evento fora do modelo atual: o operador vai gravar eventos novos
// e nenhum deles e documento.
const tipoDoOperador = 'contato_iniciado' as string as Evento['tipo'];

async function nfe(store: LedgerStore, ts: string, campos: Record<string, unknown> = {}): Promise<void> {
  await store.append(PEDIDO, 'nfe', { fonte: 'nfe', campos: { status: 'emitida', ...campos }, dados: {} }, ts);
}

async function tick(store: LedgerStore, agora = new Date()): Promise<number> {
  return verificarWorkspace(store, canal, agora, CONFIG);
}

async function cobrancas(store: LedgerStore): Promise<Cobranca[]> {
  return (await store.listarCobrancas()).filter((c) => c.workspaceId === store.workspace && c.pedidoId === PEDIDO);
}

// Caso de pendencia gravado a mao, sem cobranca: o mesmo estado de um caso
// legado ou de uma rodada que caiu entre o append e a cobranca.
async function pendenciaManual(store: LedgerStore): Promise<Evento> {
  return store.append(PEDIDO, 'pendencia_aberta', {
    motivo: 'sem_atualizacao',
    detalhe: 'caso gravado pelo teste',
    token: randomUUID(),
  });
}

describe('spec 0017 T710: so documento renova a ultima atualizacao', () => {
  const ev = (tipo: string, ts: string, seq: number, payload: Record<string, unknown> = {}): Evento => ({
    pedidoId: PEDIDO,
    seq,
    tipo: tipo as Evento['tipo'],
    payload,
    ts,
    prevHash: '',
    hash: '',
  });

  it('evento derivado ou do operador depois do ultimo documento nao impede a pendencia', () => {
    const agora = new Date();
    const doc = ev('nfe', ha(48), 1, { fonte: 'nfe', campos: { status: 'emitida' }, dados: {} });
    const depois = ['mandato', 'notificacao', 'caso_atribuido', 'sinal', tipoDoOperador].map((t, i) =>
      ev(t, ha(1), i + 2),
    );
    const motivos = detectarPendencias([doc, ...depois], agora, 24).map((p) => p.motivo);
    expect(motivos).toContain('sem_atualizacao');
  });

  it('documento novo renova a ultima atualizacao (controle)', () => {
    const agora = new Date();
    const velho = ev('nfe', ha(48), 1, { fonte: 'nfe', campos: { status: 'emitida' }, dados: {} });
    const novo = ev('planilha', ha(1), 2, { fonte: 'planilha', campos: { status: 'em_transito' }, dados: {} });
    expect(detectarPendencias([velho, novo], agora, 24).map((p) => p.motivo)).not.toContain('sem_atualizacao');
  });

  it('no verificador, notificacao, mandato e evento do operador recentes nao seguram a pendencia', async () => {
    const store = ws('t710');
    await nfe(store, ha(48));
    await store.append(PEDIDO, 'notificacao', { parte: 'transportadora', texto: 'aviso' });
    await store.append(PEDIDO, 'mandato', { texto: 'avisar a transportadora' });
    await store.append(PEDIDO, tipoDoOperador, { chave: 'k1' });
    expect(await tick(store)).toBe(1);
    expect(await store.pendenciaExiste(PEDIDO, 'sem_atualizacao')).toBe(true);
  });
});

describe('spec 0017 T711: cobranca uma vez por caso de pendencia aberto', () => {
  it('caso novo ganha a primeira cobranca, criada depois da abertura', async () => {
    const store = ws('primeira');
    await nfe(store, ha(48));
    expect(await tick(store)).toBe(1);
    const lista = await cobrancas(store);
    expect(lista).toHaveLength(1);
    // A transportadora da seed usa WhatsApp: a cobranca nasce sem envio.
    expect(['pendente', 'pendente_envio']).toContain(lista[0]!.status);
    const caso = projetarCasos(await store.eventosDoPedido(PEDIDO)).find((c) => c.origem === 'pendencia')!;
    expect(Date.parse(lista[0]!.criadaEm)).toBeGreaterThanOrEqual(Date.parse(caso.abertoEm));
  });

  it('caso legado aberto sem cobranca ganha a primeira na rodada seguinte', async () => {
    const store = ws('legado');
    await nfe(store, ha(1));
    await pendenciaManual(store);
    expect(await tick(store)).toBe(0);
    expect(await cobrancas(store)).toHaveLength(1);
  });

  it('caso novo no mesmo pedido, depois da cobranca anterior respondida, ganha a sua', async () => {
    const store = ws('segundo-caso');
    const previsao = daqui(240).toISOString().slice(0, 10);
    await nfe(store, ha(48), { previsaoEntrega: previsao });
    expect(await tick(store)).toBe(1);
    const [primeira] = await cobrancas(store);
    await store.atualizarCobranca(primeira!.id, { respondida: true });
    await pausa(5);
    // Previsao vencida: abre entrega_sem_confirmacao, outro caso.
    const depois = daqui(264);
    expect(await tick(store, depois)).toBe(1);
    expect(await cobrancas(store)).toHaveLength(2);
    for (let i = 1; i <= 3; i += 1) await tick(store, new Date(depois.getTime() + i * H));
    expect(await cobrancas(store)).toHaveLength(2);
  });

  const terminais: Array<{
    status: Cobranca['status'];
    levar: (store: LedgerStore, c: Cobranca) => Promise<Date>;
  }> = [
    {
      status: 'respondida',
      levar: async (store, c) => {
        await store.atualizarCobranca(c.id, { respondida: true });
        return new Date();
      },
    },
    {
      status: 'erro_envio',
      levar: async (store, c) => {
        await store.atualizarCobranca(c.id, { status: 'erro_envio', motivo: 'smtp recusou' });
        return new Date();
      },
    },
    {
      status: 'expirada',
      levar: async (store) => {
        // A propria rodada expira a cobranca vencida (COBRANCA_EXPIRA_HORAS).
        const agora = daqui(73);
        await tick(store, agora);
        return agora;
      },
    },
  ];

  for (const { status, levar } of terminais) {
    it(`depois de ${status}, tres rodadas seguidas nao criam segunda cobranca`, async () => {
      const store = ws(`terminal-${status}`);
      await nfe(store, ha(48));
      expect(await tick(store)).toBe(1);
      const [cobranca] = await cobrancas(store);
      const agora = await levar(store, cobranca!);
      expect((await store.cobrancaPorId(cobranca!.id))!.status).toBe(status);
      for (let i = 1; i <= 3; i += 1) await tick(store, new Date(agora.getTime() + i * H));
      const lista = await cobrancas(store);
      expect(lista).toHaveLength(1);
      expect(lista[0]!.status).toBe(status);
    });
  }

  it('COBRANCA_AUTO=1 com SMTP recusando: uma tentativa, sem cobranca nova a cada rodada', async () => {
    const store = ws('auto-smtp');
    await store.upsertContato({
      parte: 'transportadora',
      nome: 'Ops Transp',
      canal: 'email',
      destino: 'ops@transp.dev',
      fonte: 'manual',
    });
    await nfe(store, ha(48));
    process.env['COBRANCA_AUTO'] = '1';
    // Porta 1 do loopback: conexao recusada ou timeout curto, nunca envio.
    process.env['SMTP_HOST'] = '127.0.0.1';
    process.env['SMTP_PORT'] = '1';
    process.env['SMTP_FROM'] = 'sistema@foundry.dev';
    process.env['SMTP_TIMEOUT_MS'] = '1000';
    try {
      expect(await tick(store)).toBe(1);
      expect((await cobrancas(store)).map((c) => c.status)).toEqual(['erro_envio']);
      for (let i = 0; i < 3; i += 1) await tick(store);
      expect((await cobrancas(store)).map((c) => c.status)).toEqual(['erro_envio']);
    } finally {
      for (const k of ENVS) delete process.env[k];
    }
  }, 15_000);

  it('caso resolvido por caso_resolvido nao gera cobranca', async () => {
    const store = ws('resolvido');
    await nfe(store, ha(1));
    const origem = await pendenciaManual(store);
    await store.append(PEDIDO, 'caso_resolvido', { casoId: `${PEDIDO}:${origem.seq}`, texto: 'resolvido pelo analista' });
    for (let i = 0; i < 3; i += 1) await tick(store);
    expect(await cobrancas(store)).toHaveLength(0);
  });

  it('pedido com status_declarado entregue nao gera cobranca', async () => {
    const store = ws('entregue');
    await nfe(store, ha(1));
    await pendenciaManual(store);
    await store.append(PEDIDO, 'status_declarado', {
      fonte: 'email_transportadora',
      campos: { status: 'entregue' },
      dados: {},
    });
    for (let i = 0; i < 3; i += 1) await tick(store);
    expect(await cobrancas(store)).toHaveLength(0);
  });

  it('caso resolvido depois da primeira cobranca vencida nao gera outra', async () => {
    const store = ws('resolvido-depois');
    await nfe(store, ha(48));
    expect(await tick(store)).toBe(1);
    const [cobranca] = await cobrancas(store);
    await store.atualizarCobranca(cobranca!.id, { status: 'erro_envio', motivo: 'smtp recusou' });
    const caso = projetarCasos(await store.eventosDoPedido(PEDIDO)).find((c) => c.origem === 'pendencia')!;
    await store.append(PEDIDO, 'caso_resolvido', { casoId: caso.id, texto: 'transportadora respondeu por telefone' });
    for (let i = 0; i < 3; i += 1) await tick(store);
    expect(await cobrancas(store)).toHaveLength(1);
  });
});
