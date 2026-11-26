// Projecao do ledger (spec 0004, T024): fold dos eventos em versoes,
// divergencias, tarefas e pedido consolidado. Puro, sem banco.

import { PARTES, TIPOS_DOCUMENTO } from './model.js';
import type {
  CamposObservados,
  ContatoDoc,
  Divergencia,
  DocData,
  Evento,
  FonteDocumento,
  ItemPedido,
  Notificacao,
  Pedido,
  ProjecaoPedido,
  Sinal,
  Tarefa,
  VersaoPedido,
} from './model.js';

const FONTES_DOC = new Set<string>(TIPOS_DOCUMENTO);

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

// Mescla campos declarados por fonte sem apagar campos anteriores quando um
// evento posterior da mesma fonte chega vazio (ex.: cancelamento seguido de CC-e).
function mesclarFonte(
  porFonte: Map<FonteDocumento, CamposObservados>,
  fonte: FonteDocumento,
  campos: CamposObservados,
): void {
  const anterior = porFonte.get(fonte) ?? {};
  const mesclado: CamposObservados = { ...anterior };
  for (const [k, v] of Object.entries(campos)) {
    if (v !== undefined) (mesclado as Record<string, unknown>)[k] = v;
  }
  porFonte.set(fonte, mesclado);
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
  const sinais: Sinal[] = [];
  const notificacoes: Notificacao[] = [];
  let pedido: Pedido | null = null;

  for (const ev of eventos) {
    const doc = comoDoc(ev);
    if (doc) {
      mesclarFonte(porFonte, doc.fonte, doc.campos);
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
          partes: [...PARTES],
          criadoEm: ev.ts,
        };
      } else if (ev.tipo === 'planilha' && pedido === null) {
        // Planilha que chega antes da NF-e cria pedido: pedido minimo "a
        // confirmar" ate o documento fiscal completar os dados (RF5).
        pedido = {
          id: ev.pedidoId,
          emitente: { nome: 'a confirmar' },
          destinatario: { nome: 'a confirmar' },
          itens: [],
          campos: {},
          partes: [...PARTES],
          criadoEm: ev.ts,
        };
      }
      continue;
    }
    if (ev.tipo === 'divergencia') {
      // spec 0011: 'token' e a credencial do link do parceiro — fica so no
      // evento cru, nunca na projecao que as rotas devolvem.
      const { token: _token, ...divergencia } = ev.payload;
      divergencias.push(divergencia as unknown as Divergencia);
      continue;
    }
    if (ev.tipo === 'tarefa') {
      tarefas.push(ev.payload as unknown as Tarefa);
      continue;
    }
    // mandato fica fora da projecao: ele ja e trilha do proprio ledger.
    if (ev.tipo === 'sinal') {
      sinais.push(ev.payload as unknown as Sinal);
      continue;
    }
    if (ev.tipo === 'notificacao') {
      notificacoes.push(ev.payload as unknown as Notificacao);
    }
  }

  if (pedido) pedido.campos = consolidarCampos(porFonte);
  return { pedido, versoes, divergencias, tarefas, sinais, notificacoes, totalEventos: eventos.length };
}

// Campos por fonte do historico: base do calculo incremental no ingest.
export function camposPorFonte(eventos: Evento[]): Map<FonteDocumento, CamposObservados> {
  const map = new Map<FonteDocumento, CamposObservados>();
  for (const ev of eventos) {
    const doc = comoDoc(ev);
    if (doc) mesclarFonte(map, doc.fonte, doc.campos);
  }
  return map;
}

export function docDataParaPayload(doc: DocData): Record<string, unknown> {
  return { fonte: doc.fonte, campos: doc.campos, dados: doc.dados };
}
