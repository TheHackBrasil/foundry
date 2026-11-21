// Cadeia de hashes do ledger (spec 0004, RF9). Puro e testado.
// Cada pedido tem uma cadeia propria ordenada por seq; o hash cobre o
// conteudo do evento mais o hash do anterior (prev_hash).

import { createHash } from 'node:crypto';
import type { Evento } from './model.js';

export const GENESIS_HASH = '0'.repeat(64);

// Serializacao canonica: chaves ordenadas em qualquer profundidade.
// Sem ela, reordenar chaves do payload mudaria o hash.
export function canonico(valor: unknown): string {
  if (valor === null || typeof valor !== 'object') return JSON.stringify(valor);
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  const obj = valor as Record<string, unknown>;
  const chaves = Object.keys(obj).sort();
  return `{${chaves.map((k) => `${JSON.stringify(k)}:${canonico(obj[k])}`).join(',')}}`;
}

export function sha256Hex(texto: string): string {
  return createHash('sha256').update(texto, 'utf8').digest('hex');
}

// Material hasheado: identidade do pedido, tipo, payload canonico, ts e elo.
export function hashEvento(
  evento: Pick<Evento, 'pedidoId' | 'tipo' | 'payload' | 'ts'>,
  prevHash: string,
): string {
  const material =
    canonico({
      pedidoId: evento.pedidoId,
      tipo: evento.tipo,
      payload: evento.payload,
      ts: evento.ts,
    }) + prevHash;
  return sha256Hex(material);
}

export interface VerificacaoCadeia {
  valida: boolean;
  total: number;
  indiceFalha: number | null; // posicao do 1o evento adulterado (0-based)
  eventoFalha: Evento | null;
  hashEsperado: string | null; // hash que o evento deveria ter
  hashEncontrado: string | null;
}

// Verifica elo a elo. Cadeia vazia e valida. Rejeita adulteracao de
// conteudo (payload/ts/tipo), de sequencia (seq fora de ordem) e de elo
// (prevHash quebrado).
export function verificarCadeia(eventos: Evento[]): VerificacaoCadeia {
  let prev = GENESIS_HASH;
  for (let i = 0; i < eventos.length; i++) {
    const ev = eventos[i]!;
    const esperado = hashEvento(ev, prev);
    const seqEsperada = i + 1;
    if (
      ev.prevHash !== prev ||
      ev.hash !== esperado ||
      (ev.seq !== undefined && ev.seq !== seqEsperada)
    ) {
      return {
        valida: false,
        total: eventos.length,
        indiceFalha: i,
        eventoFalha: ev,
        hashEsperado: esperado,
        hashEncontrado: ev.hash,
      };
    }
    prev = ev.hash;
  }
  return {
    valida: true,
    total: eventos.length,
    indiceFalha: null,
    eventoFalha: null,
    hashEsperado: null,
    hashEncontrado: null,
  };
}
