// Ancoragem (spec 0004): Merkle root -> FoundryAnchor na Base Sepolia.
// Sem RPC/chave ou tx revertida: devolve motivo e o ledger segue (RF15).

import { Contract, JsonRpcProvider, Wallet, isHexString } from 'ethers';
import ABI from '../contracts/abi/FoundryAnchor.abi.json' with { type: 'json' };
import { raizMerkle } from '../shared/merkle.js';
import type { LedgerStore } from './store.js';

export interface ResultadoAncora {
  ok: boolean;
  motivo?: string;
  root?: string;
  txHash?: string;
  url?: string;
}

export interface ConfigAncora {
  rpcUrl?: string;
  privateKey?: string;
  contrato?: string;
}

export function configAncoraDoEnv(): ConfigAncora {
  return {
    rpcUrl: process.env['BASE_SEPOLIA_RPC_URL'],
    privateKey: process.env['ANCHOR_PRIVATE_KEY'],
    contrato: process.env['ANCHOR_CONTRACT_ADDRESS'],
  };
}

export async function ancorar(
  store: LedgerStore,
  pedidoId: string,
  cfg: ConfigAncora = configAncoraDoEnv(),
): Promise<ResultadoAncora> {
  const eventos = await store.eventosDoPedido(pedidoId);
  if (eventos.length === 0) {
    return { ok: false, motivo: `pedido ${pedidoId} sem eventos para ancorar` };
  }
  const root = raizMerkle(eventos.map((e) => e.hash));

  if (!cfg.rpcUrl || !cfg.privateKey || !cfg.contrato) {
    return {
      ok: false,
      motivo: 'ancoragem nao configurada (BASE_SEPOLIA_RPC_URL, ANCHOR_PRIVATE_KEY, ANCHOR_CONTRACT_ADDRESS)',
      root,
    };
  }
  if (!isHexString(cfg.contrato, 20)) {
    return { ok: false, motivo: 'ANCHOR_CONTRACT_ADDRESS invalido', root };
  }

  try {
    const provider = new JsonRpcProvider(cfg.rpcUrl, 84532);
    const wallet = new Wallet(cfg.privateKey, provider);
    const contrato = new Contract(cfg.contrato, ABI, wallet);
    const tx = await (contrato['anchor'] as (r: string) => Promise<{
      hash: string;
      wait(): Promise<{ status: number | null } | null>;
    }>)(`0x${root}`);
    // wait() null ou status 0: sem ancoragem real, nada e gravado.
    const recibo = await tx.wait();
    if (!recibo || recibo.status !== 1) {
      return { ok: false, motivo: 'tx revertida ou substituida na rede', root };
    }
    await store.append(pedidoId, 'ancora', {
      root,
      txHash: tx.hash,
      rede: 'base-sepolia',
      contrato: cfg.contrato,
      url: `https://sepolia.basescan.org/tx/${tx.hash}`,
    });
    return { ok: true, root, txHash: tx.hash, url: `https://sepolia.basescan.org/tx/${tx.hash}` };
  } catch (e) {
    return { ok: false, motivo: `falha na ancoragem: ${(e as Error).message}`, root };
  }
}
