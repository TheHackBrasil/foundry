// Comprovante verificavel (spec 0011): o link read-only que a terceira parte
// abre sem sessao. A trilha vai completa (seq, tipo, ts, hash, payload como
// assinado) para qualquer um refazer a cadeia elo a elo e a raiz Merkle da
// ancora. O payload vai inteiro porque o hash cobre ele: tirar o 'token'
// quebraria a conferencia. Quem tem o link tem, por desenho da demo, a mesma
// credencial do parceiro para os casos abertos.

import { verificarCadeia } from './chain.js';
import { projetarCasos } from './casos.js';
import { raizMerkle } from './merkle.js';
import type { Caso, Evento } from './model.js';

export interface EventoComprovante {
  seq: number;
  tipo: string;
  ts: string;
  hash: string;
  payload: Record<string, unknown>;
}

export interface Comprovante {
  pedidoId: string;
  geradoEm: string;
  cadeiaIntegra: boolean;
  totalEventos: number;
  ancora: Record<string, unknown> | null;
  rootHistorico: string | null;
  rootConfere: boolean | null;
  eventosAncorados: number | null;
  casos: Caso[];
  trilha: EventoComprovante[];
}

export function montarComprovante(
  pedidoId: string,
  eventos: Evento[],
  ancora: Record<string, unknown> | null,
): Comprovante {
  const verificacao = verificarCadeia(eventos);
  const seqAncora = [...eventos].reverse().find((e) => e.tipo === 'ancora')?.seq;
  const cobertos =
    seqAncora === undefined
      ? []
      : eventos.filter((e) => e.seq !== undefined && e.seq < seqAncora);
  const rootHistorico = seqAncora === undefined ? null : raizMerkle(cobertos.map((e) => e.hash));
  return {
    pedidoId,
    geradoEm: new Date().toISOString(),
    cadeiaIntegra: verificacao.valida,
    totalEventos: eventos.length,
    ancora,
    rootHistorico,
    rootConfere:
      ancora !== null && rootHistorico !== null ? rootHistorico === ancora['root'] : null,
    eventosAncorados: seqAncora === undefined ? null : seqAncora - 1,
    casos: projetarCasos(eventos),
    trilha: eventos.map((e) => ({
      seq: e.seq ?? 0,
      tipo: e.tipo,
      ts: e.ts,
      hash: e.hash,
      payload: e.payload,
    })),
  };
}
