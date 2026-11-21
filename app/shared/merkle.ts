// Raiz Merkle dos hashes de eventos (spec 0004, RF14): e o que vai para
// o contrato FoundryAnchor. Puro: recebe hex sha256, devolve hex sha256.

import { sha256Hex } from './chain.js';

export const MERKLE_VAZIO = '0'.repeat(64);

export function raizMerkle(hashes: string[]): string {
  if (hashes.length === 0) return MERKLE_VAZIO;
  let nivel = [...hashes].sort();
  while (nivel.length > 1) {
    const proximo: string[] = [];
    for (let i = 0; i < nivel.length; i += 2) {
      const a = nivel[i]!;
      const b = nivel[i + 1] ?? a; // folha impar duplica
      proximo.push(sha256Hex(a + b));
    }
    nivel = proximo;
  }
  return nivel[0]!;
}
