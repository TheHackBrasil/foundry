// Sanitizacao do /api/anchor (spec 0008, T225): o provedor ethers embute a URL
// da RPC e parametros da tx nas mensagens. O motivo devolvido ao cliente e
// sempre uma frase fixa; o erro cru so vai para o log interno.

import { describe, expect, it, vi } from 'vitest';
import { ancorar } from './anchor.js';
import type { LedgerStore } from './store.js';
import type { Evento } from '../shared/model.js';

const storeCom = (eventos: Partial<Evento>[], anexados: object[] = []): LedgerStore =>
  ({
    eventosDoPedido: async () => eventos,
    append: async (_p: string, _t: string, dados: object) => anexados.push(dados),
  }) as unknown as LedgerStore;

const UM_EVENTO = [{ hash: 'a'.repeat(64) }];
const CFG = {
  rpcUrl: 'http://rpc.secreto-exemplo.invalid:8545',
  privateKey: '0xCHAVE_PRIVADA_SECRETA_EXEMPLO',
  contrato: '0x0000000000000000000000000000000000000abc',
};

vi.mock('ethers', async (importOriginal) => {
  const real = await importOriginal<typeof import('ethers')>();
  class ContratoQuebrado {
    constructor(_a: string, _b: unknown, _c: unknown) {}
    anchor(_r: string): Promise<never> {
      // Mensagem tipica de provedor: vaza endpoint e material da tx.
      return Promise.reject(
        new Error(`could not coalesce to http://rpc.secreto-exemplo.invalid:8545 with key 0xCHAVE_PRIVADA_SECRETA_EXEMPLO`),
      );
    }
  }
  return {
    ...real,
    Contract: ContratoQuebrado,
    JsonRpcProvider: class {
      constructor(_url: string, _rede: number) {}
    },
    Wallet: class {
      constructor(_chave: string, _p: unknown) {}
    },
  };
});

describe('motivos seguros (sem credencial)', () => {
  it('pedido sem eventos', async () => {
    const r = await ancorar(storeCom([]), 'pedido-x', CFG);
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/sem eventos/);
  });

  it('configuracao ausente lista variaveis, nunca valores', async () => {
    const r = await ancorar(storeCom(UM_EVENTO), 'p', {});
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/nao configurada/);
    expect(r.motivo).not.toContain('secreto');
  });

  it('endereco de contrato invalido', async () => {
    const r = await ancorar(storeCom(UM_EVENTO), 'p', { ...CFG, contrato: 'nao-e-hex' });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/CONTRACT_ADDRESS/);
  });
});

describe('falha do provedor (T225)', () => {
  it('motivo generico: nada de URL, chave ou mensagem crua', async () => {
    const erros: unknown[] = [];
    const r = await ancorar(storeCom(UM_EVENTO), 'p', CFG, (e) => erros.push(e));
    expect(r.ok).toBe(false);
    expect(r.motivo).toBe('falha na ancoragem: provedor de rede indisponivel');
    expect(r.motivo).not.toMatch(/rpc\.secreto|8545|CHAVE|PRIVADA|coalesce|http/);
    // O detalhe cru continua disponivel para o operador no log.
    expect(erros).toHaveLength(1);
    expect(String(erros[0])).toContain('rpc.secreto-exemplo.invalid');
  });
});
