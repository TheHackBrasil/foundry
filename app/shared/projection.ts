// Projecao do ledger (spec 0004, T024): fold dos eventos em versoes,
// divergencias, tarefas e pedido consolidado. Puro, sem banco.

import type {
  CamposObservados,
  ContatoDoc,
  Divergencia,
  DocData,
  Evento,
  FonteDocumento,
  ItemPedido,
  Pedido,
  ProjecaoPedido,
  Tarefa,
  VersaoPedido,
} from './model.js';

const FONTES_DOC = new Set(['nfe', 'cte', 'cce', 'cancelamento', 'planilha', 'pdf']);

interface PayloadDoc {
  fonte: FonteDocumento;
  campos: CamposObservados;
  dados: Record<string, unknown>;
}

function comoDoc(ev: Evento): PayloadDoc | null {
  if (!FONTES_DOC.has(ev.tipo)) return null;
  const p = ev.payload as Partial<PayloadDoc>;
  if (typeof p.fonte !== 'string' || typeof p.campos !== 'object' || p.campos === null) {
    return null;
  }
  return {
    fonte: p.fonte,
    campos: p.campos as CamposObservados,
    dados: (p.dados ?? {}) as Record<string, unknown>,
  };
}

// Estado consolidado: ultima declaracao de cada campo vence, por fonte.
export function consolidarCampos(
  porFonte: Map<FonteDocumento, CamposObservados>,
): CamposObservados {
  const out: CamposObservados = {};
  for (const campos of porFonte.values()) {
    for (const [k, v] of Object.entries(campos)) {
      if (v !== undefined) (out as Record<string, unknown>)[k] = v;
    }
  }
  return out;
}

export function projetar(eventos: Evento[]): ProjecaoPedido {
  const porFonte = new Map<FonteDocumento, CamposObservados>();
  const versoes: VersaoPedido[] = [];
  const divergencias: Divergencia[] = [];
  const tarefas: Tarefa[] = [];
  let pedido: Pedido | null = null;

  for (const ev of eventos) {
    const doc = comoDoc(ev);
    if (doc) {
      porFonte.set(doc.fonte, doc.campos);
      versoes.push({
        pedidoId: ev.pedidoId,
        versao: versoes.length + 1,
        fonte: doc.fonte,
        campos: doc.campos,
        geradaEm: ev.ts,
      });
      if (ev.tipo === 'nfe') {
        pedido = {
          id: ev.pedidoId,
          emitente: (doc.dados['emitente'] as ContatoDoc) ?? { nome: '?' },
          destinatario: (doc.dados['destinatario'] as ContatoDoc) ?? { nome: '?' },
          itens: (doc.dados['itens'] as ItemPedido[]) ?? [],
          campos: {},
          partes: ['fornecedor', 'transportadora', 'cd', 'fiscal', 'financeiro'],
          criadoEm: ev.ts,
        };
      }
      continue;
    }
    if (ev.tipo === 'divergencia') {
      divergencias.push(ev.payload as unknown as Divergencia);
      continue;
    }
    if (ev.tipo === 'tarefa') {
      tarefas.push(ev.payload as unknown as Tarefa);
    }
  }

  if (pedido) pedido.campos = consolidarCampos(porFonte);
  return { pedido, versoes, divergencias, tarefas, totalEventos: eventos.length };
}

// Campos por fonte do historico: base do calculo incremental no ingest.
export function camposPorFonte(eventos: Evento[]): Map<FonteDocumento, CamposObservados> {
  const map = new Map<FonteDocumento, CamposObservados>();
  for (const ev of eventos) {
    const doc = comoDoc(ev);
    if (doc) map.set(doc.fonte, doc.campos);
  }
  return map;
}

export function docDataParaPayload(doc: DocData): Record<string, unknown> {
  return { fonte: doc.fonte, campos: doc.campos, dados: doc.dados };
}
