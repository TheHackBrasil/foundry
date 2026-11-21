// Cadeia de hashes do ledger (spec 0004, RF9 e RF15). Pura: usa só o
// WebCrypto, que existe no Node e no navegador.
//
// Limite conhecido: quem controla o banco e recalcula a cadeia inteira a
// partir do evento adulterado passa por esta verificação. Quem fecha esse
// caso é uma testemunha externa (recibo com o hash no alerta, âncora
// pública), não este arquivo.

import type { Evento, EventoEntrada, Json } from './model.ts';

export const GENESIS = '0'.repeat(64);

// JSON com chaves ordenadas e sem espaço, para o mesmo objeto gerar sempre
// os mesmos bytes (o jsonb do Postgres não preserva a ordem das chaves).
// Recusa o que o JSON não representa: undefined, NaN, Infinity, bigint.
export function canonicalJson(valor: Json): string {
  if (valor === null || typeof valor === 'boolean' || typeof valor === 'string') {
    return JSON.stringify(valor);
  }
  if (typeof valor === 'number') {
    if (!Number.isFinite(valor)) throw new TypeError('número não finito não é JSON');
    return JSON.stringify(valor);
  }
  if (Array.isArray(valor)) {
    return `[${valor.map(canonicalJson).join(',')}]`;
  }
  if (typeof valor === 'object') {
    const campos = Object.keys(valor)
      .sort()
      .map((chave) => `${JSON.stringify(chave)}:${canonicalJson(valor[chave] as Json)}`);
    return `{${campos.join(',')}}`;
  }
  throw new TypeError(`valor fora do JSON: ${typeof valor}`);
}

export async function sha256Hex(texto: string): Promise<string> {
  const bytes = new TextEncoder().encode(texto);
  const resumo = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(resumo), (b) => b.toString(16).padStart(2, '0')).join('');
}

type SemHash = Omit<Evento, 'hash'>;

// Lista os campos de propósito: coluna extra do banco (id, criadoEm) não
// entra no hash.
export function hashEvento(e: SemHash): Promise<string> {
  return sha256Hex(
    canonicalJson({
      pedidoId: e.pedidoId,
      workspaceId: e.workspaceId,
      seq: e.seq,
      prevHash: e.prevHash,
      tipo: e.tipo,
      autor: e.autor,
      canal: e.canal,
      ocorridoEm: e.ocorridoEm,
      payload: e.payload,
    }),
  );
}

export async function encadear(anterior: Evento | null, entrada: EventoEntrada): Promise<Evento> {
  if (
    anterior &&
    (anterior.pedidoId !== entrada.pedidoId || anterior.workspaceId !== entrada.workspaceId)
  ) {
    throw new Error('evento de outro pedido ou workspace não encadeia nesta cadeia');
  }
  const base: SemHash = {
    ...entrada,
    seq: anterior ? anterior.seq + 1 : 0,
    prevHash: anterior ? anterior.hash : GENESIS,
  };
  return { ...base, hash: await hashEvento(base) };
}

export type FalhaCadeia = 'pedido' | 'seq' | 'prev_hash' | 'hash';

export type ResultadoCadeia =
  | { ok: true; cabeca: string }
  | { ok: false; indice: number; seq: number; motivo: FalhaCadeia };

// Aponta o primeiro evento que não confere. Cadeia vazia é válida e a
// cabeça dela é o GENESIS.
export async function verificarCadeia(eventos: readonly Evento[]): Promise<ResultadoCadeia> {
  const primeiro = eventos[0];
  if (!primeiro) return { ok: true, cabeca: GENESIS };

  let prevEsperado = GENESIS;
  for (const [indice, e] of eventos.entries()) {
    const falha = (motivo: FalhaCadeia): ResultadoCadeia => ({
      ok: false,
      indice,
      seq: e.seq,
      motivo,
    });
    if (e.pedidoId !== primeiro.pedidoId || e.workspaceId !== primeiro.workspaceId) {
      return falha('pedido');
    }
    if (e.seq !== indice) return falha('seq');
    if (e.prevHash !== prevEsperado) return falha('prev_hash');
    if (e.hash !== (await hashEvento(e))) return falha('hash');
    prevEsperado = e.hash;
  }
  return { ok: true, cabeca: prevEsperado };
}
