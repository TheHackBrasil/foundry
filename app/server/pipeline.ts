// Pipeline de ingestao (spec 0004): doc -> DocData -> evento no ledger
// -> divergencias -> tarefas -> SSE. Entrada unica: rota, IMAP e seed.

import { divergenciasDaNovaFonte } from '../shared/divergence.js';
import { propagarTodas } from '../shared/rules.js';
import type { DocData, Evento } from '../shared/model.js';
import { camposPorFonte, docDataParaPayload } from '../shared/projection.js';
import type { Limites } from './config.js';
import { ErroRequisicao, mensagens } from './protecao.js';
import type { LedgerStore } from './store.js';
import type { CanalSSE } from './sse.js';
import { detectarTipo } from './ingest/detect.js';
import { ErroParser, parseNFe } from './ingest/nfe.js';
import { parseCTe } from './ingest/cte.js';
import { parseEventoNFe } from './ingest/eventos.js';
import { parseCsv } from './ingest/csv.js';
import { parsePdf } from './ingest/pdf.js';
import { extrairAnexosEml } from './ingest/eml.js';

// Resultado interno do pipeline (eventos gravados, nao o numero). O contrato
// publico ResultadoIngest, com eventos contados, fica em shared/model.ts.
export interface ResumoIngest {
  pedidoId: string | null;
  docs: number;
  eventos: Evento[];
  revisaoId: number | null;
  erro?: never;
}

// Doc sem pedido correspondente vai para a fila de revisao (RF7).
async function paraRevisao(store: LedgerStore, doc: DocData, motivo: string): Promise<number> {
  return store.enfileirarRevisao(doc.fonte, motivo, {
    pedidoId: doc.pedidoId,
    docTipo: doc.docTipo,
    fonte: doc.fonte,
    campos: doc.campos,
    dados: doc.dados,
  });
}

// Payload gravado no evento do documento; confianca entra so quando a extracao
// declarou (A7). O mesmo payload alimenta a checagem de reingestao.
function payloadDoDoc(doc: DocData): Record<string, unknown> {
  return {
    ...docDataParaPayload(doc),
    ...(doc.confianca !== undefined ? { confianca: doc.confianca } : {}),
  };
}

// Doc + divergencias + tarefas dentro da tx do chamador, que trava o pedido
// antes (appendVarios refaz o lock, no-op dentro da tx). O calculo compara a
// fonte nova com a ultima declaracao de cada outra fonte.
async function registrarDoc(tx: LedgerStore, doc: DocData): Promise<Evento[]> {
  const inseridos: Evento[] = [];
  inseridos.push(await tx.append(doc.pedidoId, doc.docTipo, payloadDoDoc(doc)));

  const historico = await tx.eventosDoPedido(doc.pedidoId);
  const porFonte = camposPorFonte(historico.slice(0, -1)); // exclui a doc nova
  const existentes = [...porFonte.entries()].map(([fonte, campos]) => ({ fonte, campos }));
  const divs = divergenciasDaNovaFonte({ fonte: doc.fonte, campos: doc.campos }, existentes);

  for (const d of divs) {
    inseridos.push(await tx.append(doc.pedidoId, 'divergencia', { ...d }));
  }
  for (const t of propagarTodas(divs)) {
    inseridos.push(await tx.append(doc.pedidoId, 'tarefa', { ...t }));
  }
  return inseridos;
}

// Doc + divergencias + tarefas numa unica tx.
async function processarDoc(
  store: LedgerStore,
  canal: CanalSSE,
  doc: DocData,
): Promise<{ eventos: Evento[]; revisaoId: number | null }> {
  const criadorDePedido = doc.docTipo === 'nfe' || doc.docTipo === 'planilha';
  if (!criadorDePedido && !(await store.pedidoExiste(doc.pedidoId))) {
    const revisaoId = await paraRevisao(store, doc, 'pedido_desconhecido');
    return { eventos: [], revisaoId };
  }

  const eventos = await store.transaction(async (tx) => {
    // Lock antes de ler: dois uploads identicos em paralelo decidem em serie,
    // um insere e o outro ve o doc ja gravado (no-op idempotente, sem duplicata).
    await tx.travarPedido(doc.pedidoId);
    if (await tx.eventoExiste(doc.pedidoId, doc.docTipo, payloadDoDoc(doc))) {
      return []; // reingestao identica: no-op
    }
    return registrarDoc(tx, doc);
  });

  for (const ev of eventos) canal.evento(ev, store.workspace);
  return { eventos, revisaoId: null };
}

// Aprovacao na revisao: o doc volta ao pipeline com aceite forcado e
// grava no workspace que gerou o item (nao no do aprovador). A rota so chega
// aqui com item da propria sessao; o status muda primeiro, na mesma tx, entao
// duas aprovacoes simultaneas nao gravam o documento duas vezes.
export async function aprovarRevisao(
  store: LedgerStore,
  canal: CanalSSE,
  id: number,
): Promise<Evento[] | null> {
  const item = await store.buscarRevisao(id);
  if (!item || item['status'] !== 'pendente') return null;
  // buscarRevisao tambem ve a fila da seed: so o workspace dono do item decide.
  // A rota responde 403 antes; aqui o pipeline fecha a porta para outros usos.
  if (item['workspace_id'] !== store.workspace) return null;
  const alvo = store.paraWorkspace(String(item['workspace_id']));
  const p = item['payload'] as { pedidoId: string; docTipo: DocData['docTipo']; fonte: DocData['fonte']; campos: DocData['campos']; dados: Record<string, unknown> };
  const doc: DocData = { fonte: p.fonte, docTipo: p.docTipo, pedidoId: p.pedidoId, campos: p.campos, dados: p.dados };
  const r = await alvo.transaction(async (tx) => {
    // Mesma ordem do processarDoc: o lock do pedido vem antes da decisao.
    await tx.travarPedido(doc.pedidoId);
    if (!(await tx.resolverRevisao(id, 'aprovado'))) return null;
    if (await tx.eventoExiste(doc.pedidoId, doc.docTipo, payloadDoDoc(doc))) {
      return []; // item irmao ja aprovado: doc identico ja esta no ledger
    }
    return registrarDoc(tx, doc);
  });
  if (r === null) return null;
  for (const ev of r) canal.evento(ev, alvo.workspace);
  return r;
}

// Limites da demo publica (rota /api/ingest). Seed e IMAP chamam sem opcoes.
export interface OpcoesIngest {
  limites?: Limites;
  // Uso da sessao antes deste envio (LedgerStore.uso()).
  uso?: { eventos: number; documentos: number };
  // Chamado antes de cada PDF: a extracao usa LLM externo com cota.
  antesDoPdf?: () => void;
}

// Entrada unica: nome+conteudo -> detecta -> parse -> store.
// .eml desembrulha os anexos e joga cada um pelo mesmo caminho.
export async function ingerir(
  store: LedgerStore,
  canal: CanalSSE,
  nome: string,
  conteudo: Buffer,
  opcoes: OpcoesIngest = {},
): Promise<ResumoIngest> {
  const todos: Evento[] = [];
  let pedidoId: string | null = null;
  let revisaoId: number | null = null;
  let docs = 0;
  const { limites } = opcoes;
  const uso = { eventos: opcoes.uso?.eventos ?? 0, documentos: opcoes.uso?.documentos ?? 0 };

  // A conta e por documento, dentro do laco: uma planilha ou um .eml carregam
  // muitos. Planilha e anexos sao contados antes de gravar o primeiro.
  const exigirCabe = (novos: number): void => {
    if (!limites) return;
    if (docs + novos > limites.documentosPorEnvio) {
      throw new ErroRequisicao(413, mensagens.documentosDemais(limites.documentosPorEnvio));
    }
    if (uso.documentos + novos > limites.documentosPorWorkspace || uso.eventos >= limites.eventosPorWorkspace) {
      throw new ErroRequisicao(429, mensagens.sessaoCheia(limites));
    }
  };

  const processar = async (doc: DocData): Promise<void> => {
    exigirCabe(1);
    docs += 1;
    uso.documentos += 1;
    pedidoId ??= doc.pedidoId;
    const r = await processarDoc(store, canal, doc);
    uso.eventos += r.eventos.length;
    todos.push(...r.eventos);
    revisaoId ??= r.revisaoId;
  };

  const processarArquivo = async (nomeArq: string, buf: Buffer, dentroDeEml = false): Promise<void> => {
    switch (detectarTipo(nomeArq, buf)) {
      case 'nfe':
        await processar(parseNFe(buf.toString('utf8')));
        break;
      case 'cte':
        await processar(parseCTe(buf.toString('utf8')));
        break;
      case 'eventoNFe':
        await processar(parseEventoNFe(buf.toString('utf8')));
        break;
      case 'csv': {
        const linhas = parseCsv(buf.toString('utf8'));
        exigirCabe(linhas.length);
        for (const doc of linhas) await processar(doc);
        break;
      }
      case 'pdf': {
        exigirCabe(1);
        opcoes.antesDoPdf?.();
        const r = await parsePdf(buf);
        if (r.doc) await processar(r.doc);
        if (r.revisao) {
          uso.documentos += 1;
          revisaoId = await store.enfileirarRevisao('pdf', r.revisao.motivo, r.revisao.payload);
        }
        break;
      }
      case 'eml': {
        if (dentroDeEml) throw new ErroParser('EML dentro de EML nao suportado');
        const anexos = await extrairAnexosEml(buf);
        exigirCabe(anexos.length);
        for (const anexo of anexos) {
          await processarArquivo(anexo.nome, anexo.conteudo, true);
        }
        break;
      }
    }
  };

  await processarArquivo(nome, conteudo);
  return { pedidoId, docs, eventos: todos, revisaoId };
}

export { ErroParser };
