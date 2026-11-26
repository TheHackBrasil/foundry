// Agenda de contatos por workspace (spec 0007, RF7): a sessao le os seus mais
// os 4 ficticios da seed. PUT faz upsert por (workspace, parte, canal) desde a
// spec 0017 (T705); o bootstrap por documento so insere contato novo e nunca
// sobrescreve o manual.

import { CANAIS_CONTATO, PARTES, type CanalContato, type Contato, type DocData, type Parte } from '../shared/model.js';
import { canalPadraoDoEnv } from './nvoip.js';
import { ErroRequisicao } from './protecao.js';
import type { LedgerStore } from './store.js';
import { destinoWebhookValido } from './webhook.js';

// Os 4 contatos ficticios da seed (rotulados): inseridos idempotentemente por
// store.init(), compartilhados em leitura com todas as sessoes.
export const CONTATOS_SEED: Contato[] = [
  { parte: 'fornecedor', nome: 'Fornecedor Ficticio (seed)', canal: 'whatsapp', destino: '+55 11 90000-0001', fonte: 'seed' },
  { parte: 'transportadora', nome: 'Transportadora Ficticia (seed)', canal: 'whatsapp', destino: '+55 11 90000-0002', fonte: 'seed' },
  { parte: 'cd', nome: 'CD Ficticio (seed)', canal: 'sms', destino: '+55 11 90000-0003', fonte: 'seed' },
  { parte: 'financeiro', nome: 'Financeiro Ficticio (seed)', canal: 'email', destino: 'financeiro@ficticio.dev', fonte: 'seed' },
];

// Agenda visivel: a sessao e a seed somadas; numa parte repetida, os
// contatos da sessao sao os que valem (ela e quem edita a propria agenda) e
// os da seed somem daquela parte. Uma linha por canal (spec 0017, T705):
// as partes saem na ordem em que apareceram e, dentro da parte, o contato
// salvo por ultimo fica no fim. Quem le um contato por parte (a gaveta da
// agenda) segue vendo o ultimo salvo, como antes da chave por canal.
export async function listarAgenda(store: LedgerStore): Promise<Contato[]> {
  const porParte = new Map<Parte, Array<Contato & { workspaceId: string; ts: string }>>();
  for (const l of await store.listarContatos()) {
    const grupo = porParte.get(l.parte) ?? [];
    grupo.push(l);
    porParte.set(l.parte, grupo);
  }
  const agenda: Contato[] = [];
  for (const grupo of porParte.values()) {
    const daSessao = grupo.filter((l) => l.workspaceId === store.workspace);
    const visiveis = (daSessao.length > 0 ? daSessao : grupo).sort((a, b) => a.ts.localeCompare(b.ts));
    for (const { workspaceId: _ws, ts: _ts, ...contato } of visiveis) agenda.push(contato);
  }
  return agenda;
}

const MAX_TEXTO_CONTATO = 120;

function textoCurto(v: unknown, campo: string): string {
  if (typeof v !== 'string' || !v.trim() || v.trim().length > MAX_TEXTO_CONTATO) {
    throw new ErroRequisicao(400, `${campo} deve ser um texto de 1 a ${MAX_TEXTO_CONTATO} caracteres`);
  }
  return v.trim();
}

// Entrada do PUT /api/contatos validada a mao; fonte e sempre 'manual'.
export function validarContato(body: unknown): Contato {
  const b = (body ?? {}) as Record<string, unknown>;
  const parte = b['parte'];
  const canal = b['canal'];
  if (typeof parte !== 'string' || !(PARTES as readonly string[]).includes(parte)) {
    throw new ErroRequisicao(400, 'parte deve ser uma das partes conhecidas (fornecedor, transportadora, cd, fiscal, financeiro)');
  }
  if (typeof canal !== 'string' || !(CANAIS_CONTATO as readonly string[]).includes(canal)) {
    throw new ErroRequisicao(400, 'canal deve ser whatsapp, sms, ligacao, email ou webhook');
  }
  const destino = textoCurto(b['destino'], 'destino');
  if (canal === 'webhook' && !destinoWebhookValido(destino)) {
    throw new ErroRequisicao(400, 'destino webhook deve ser uma URL http(s) de host público');
  }
  // Spec 0017 (T705): naoContatarIa opcional; ausente, o upsert mantem o
  // valor gravado. So aceita booleano.
  const naoContatarIa = b['naoContatarIa'];
  if (naoContatarIa !== undefined && typeof naoContatarIa !== 'boolean') {
    throw new ErroRequisicao(400, 'naoContatarIa deve ser true ou false');
  }
  return {
    parte: parte as Parte,
    nome: textoCurto(b['nome'], 'nome'),
    canal: canal as CanalContato,
    destino,
    fonte: 'manual',
    ...(naoContatarIa === undefined ? {} : { naoContatarIa }),
  };
}

interface RefFone {
  nome?: unknown;
  fone?: unknown;
}

// Bootstrap por documento (decidido na spec): NF-e alimenta o fornecedor
// (emit) e CT-e a transportadora (emit), so quando trazem fone. Nunca
// sobrescreve contato existente (manual ou de outro documento). O pipeline da
// ai-ingest chama isto por DocData; os parsers escrevem o fone em
// dados.emitente.fone / dados.transportadora.fone.
export async function bootstrapContatos(store: LedgerStore, doc: DocData): Promise<number> {
  const alvo =
    doc.docTipo === 'nfe'
      ? { parte: 'fornecedor' as Parte, ref: doc.dados['emitente'] }
      : doc.docTipo === 'cte'
        ? { parte: 'transportadora' as Parte, ref: doc.dados['transportadora'] }
        : null;
  if (!alvo || typeof alvo.ref !== 'object' || alvo.ref === null) return 0;
  const { nome, fone } = alvo.ref as RefFone;
  if (typeof fone !== 'string' || !fone.trim()) return 0;
  const contato: Contato = {
    parte: alvo.parte,
    nome: typeof nome === 'string' && nome.trim() ? nome.trim().slice(0, MAX_TEXTO_CONTATO) : '?',
    canal: canalPadraoDoEnv(),
    destino: fone.trim().slice(0, MAX_TEXTO_CONTATO),
    fonte: 'documento',
  };
  return (await store.inserirContatoSeAusente(contato)) ? 1 : 0;
}
