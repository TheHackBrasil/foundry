// Pipeline de ingestao (spec 0004): doc -> DocData -> evento no ledger
// -> divergencias -> tarefas -> SSE. Entrada unica: rota, IMAP e seed.
// Fios da camada AI (spec 0007): sinais de texto livre (T140), notificacao
// da tarefa propagada (T141), mapeamento de layout desconhecido (T124) e
// bootstrap da agenda por fone fiscal (T142). Todos degradam: sem LLM,
// sem provedora ou sem env, o fluxo fica igual ao da spec 0004.

import { randomUUID } from 'node:crypto';
import Papa from 'papaparse';
import { divergenciasDaNovaFonte, mudancasDaFonte } from '../shared/divergence.js';
import { propagarTodas } from '../shared/rules.js';
import { TIPOS_DOCUMENTO, type DocData, type Evento, type PropostaMapeamento, type Sinal } from '../shared/model.js';
import { camposPorFonte, docDataParaPayload } from '../shared/projection.js';
import type { Limites } from './config.js';
import { bootstrapContatos } from './contatos.js';
import { aplicarMapeamento, aplicarTemplate, proporMapeamento, registrarTemplate } from './mapeamento.js';
import { notificarEmTarefaDoEnv, notificarTarefa } from './nvoip.js';
import { ErroRequisicao, mensagens } from './protecao.js';
import { extrairSinais } from './sinal.js';
import type { LedgerStore } from './store.js';
import type { CanalSSE } from './sse.js';
import { detectarTipo } from './ingest/detect.js';
import { ErroParser, parseNFe } from './ingest/nfe.js';
import { parseCTe } from './ingest/cte.js';
import { parseEventoNFe, textoDoEvento } from './ingest/eventos.js';
import { parseCsv } from './ingest/csv.js';
import { parsePdf } from './ingest/pdf.js';
import { parseXlsx } from './ingest/xlsx.js';
import { extrairEml } from './ingest/eml.js';
import { nomeAnexoSeguro } from './ingest/imap.js';

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
// claims (spec 0011): cada campo vigiado declarado vira afirmacao com origem.
function payloadDoDoc(doc: DocData): Record<string, unknown> {
  // afirmadoEm = quando a fonte declarou (data do documento), com fallback
  // para o instante do ingest. Documento sem data declarada gera claim
  // volatil — a idempotencia ignora 'claims' na comparacao por isso.
  const declaradoEm =
    (typeof doc.dados['dataEmissao'] === 'string' && doc.dados['dataEmissao']) ||
    (typeof doc.dados['dhEmi'] === 'string' && doc.dados['dhEmi']) ||
    new Date().toISOString();
  const claims = Object.entries(doc.campos)
    .filter(([, v]) => v !== undefined)
    .map(([campo, valor]) => ({ campo, valor, fonte: doc.fonte, afirmadoEm: declaradoEm }));
  return {
    ...docDataParaPayload(doc),
    ...(claims.length > 0 ? { claims } : {}),
    ...(doc.confianca !== undefined ? { confianca: doc.confianca } : {}),
  };
}

// Referencias de identidade extraidas do documento (spec 0011): a chave
// declarada e os identificadores de negocio que o parser trouxe — tudo que
// permitiria reconhecer "e o mesmo pedido" por outra via.
function referenciasDoDoc(doc: DocData): string[] {
  const refs = new Set<string>([`doc:${doc.pedidoId}`]);
  const str = (v: unknown): v is string => typeof v === 'string' && v.length > 0;
  const d = doc.dados;
  if (str(d['chave'])) refs.add(`chave:${d['chave']}`);
  if (str(d['xPed'])) refs.add(`xped:${d['xPed']}`);
  if (str(d['chaveCte'])) refs.add(`cte:${d['chaveCte']}`);
  if (Array.isArray(d['chavesNfe'])) {
    for (const c of d['chavesNfe']) if (str(c)) refs.add(`chave:${c}`);
  }
  const emit = d['emitente'] as { cnpj?: string } | undefined;
  if (emit?.cnpj && str(d['serie']) && str(d['numero'])) {
    refs.add(`nfid:${emit.cnpj}:${d['serie']}:${d['numero']}`);
  }
  return [...refs];
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
  const nova = { fonte: doc.fonte, campos: doc.campos };
  const divs = [
    ...divergenciasDaNovaFonte(nova, existentes),
    // spec 0011: a mesma fonte mudou de versao tambem e excecao.
    ...mudancasDaFonte(existentes.find((f) => f.fonte === doc.fonte), nova),
  ];

  for (const d of divs) {
    // token por divergencia = link de resposta do parceiro do caso aberto.
    inseridos.push(await tx.append(doc.pedidoId, 'divergencia', { ...d, token: randomUUID() }));
  }
  const avisar = notificarEmTarefaDoEnv();
  for (const t of propagarTodas(divs)) {
    inseridos.push(await tx.append(doc.pedidoId, 'tarefa', { ...t }));
    // T141: desligada por padrao (NVOIP_NOTIFY_ON_TASK); ligada, a Nvoip
    // tenta avisar a parte e o resultado vira evento 'notificacao' — o
    // modulo nunca lanca e so registra quando a provedora esta configurada.
    if (avisar) {
      const n = await notificarTarefa(tx, doc.pedidoId, t);
      if (n) inseridos.push(n);
    }
  }
  return inseridos;
}

// Doc + divergencias + tarefas numa unica tx. Antes grava a identidade:
// referencias do documento podem religa-lo a um pedido ja conhecido
// (xPed igual, chave referenciada) — conflito entre dois pedidos vai
// para revisao, nunca merge silencioso (spec 0011).
async function processarDoc(
  store: LedgerStore,
  canal: CanalSSE,
  docOriginal: DocData,
): Promise<{ eventos: Evento[]; revisaoId: number | null }> {
  const referencias = referenciasDoDoc(docOriginal);
  const matches = await store.pedidosPorReferencias(referencias);
  const outros = [...new Set(matches.map((m) => m.pedidoId).filter((p) => p !== docOriginal.pedidoId))];
  if (outros.length > 1) {
    const revisaoId = await paraRevisao(store, docOriginal, 'identidade_conflitante');
    return { eventos: [], revisaoId };
  }
  // Revinculo so para doc de chave propria (o pedidoId e identidade do
  // proprio documento): NF-e complementar ou planilha com xPed igual cai no
  // pedido conhecido. CT-e/CC-e declaram pedidoId = chave do doc coberto:
  // referencia desconhecida continua 'pedido_desconhecido', sem desvio por
  // ref secundaria (o CT-e que aponta para NF-e errada e conflito, nao merge).
  const chavePropria = docOriginal.docTipo === 'nfe' || docOriginal.docTipo === 'planilha' || docOriginal.docTipo === 'pdf';
  const revinculado = outros.length === 1 && chavePropria;
  const doc: DocData = revinculado ? { ...docOriginal, pedidoId: outros[0]! } : docOriginal;

  const criadorDePedido = doc.docTipo === 'nfe' || doc.docTipo === 'planilha';
  if (!criadorDePedido && !revinculado && !(await store.pedidoExiste(doc.pedidoId))) {
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
    const inseridos = await registrarDoc(tx, doc);
    if (revinculado) {
      inseridos.push(
        await tx.append(doc.pedidoId, 'documento_vinculado', {
          docTipo: doc.docTipo,
          fonte: doc.fonte,
          chaveDeclarada: docOriginal.pedidoId,
          referencias,
        }),
      );
    }
    return inseridos;
  });
  if (eventos.length > 0) {
    await store.vincularDocumento(doc.pedidoId, doc.docTipo, referencias);
  }

  for (const ev of eventos) canal.evento(ev, store.workspace);
  return { eventos, revisaoId: null };
}

// Sinal consultivo (T140/RF3): a LLM ja devolveu os avisos tipados; aqui eles
// entram na cadeia do pedido. appendVarios refaz o lock por workspace+pedido.
// O texto bruto nunca entra: o payload e so {tipo, resumo, confianca, fonte}.
async function emitirSinais(store: LedgerStore, canal: CanalSSE, pedidoId: string, sinais: Sinal[]): Promise<Evento[]> {
  if (sinais.length === 0) return [];
  const eventos = await store.appendVarios(
    pedidoId,
    sinais.map((s) => ({ tipo: 'sinal', payload: { ...s } })),
  );
  for (const ev of eventos) canal.evento(ev, store.workspace);
  return eventos;
}

// Linhas de um CSV texto em objetos coluna -> valor: entrada de
// aplicarMapeamento/aplicarTemplate no fio do layout desconhecido (T124).
function csvParaLinhas(csv: string): Array<Record<string, string>> {
  const r = Papa.parse<Record<string, string>>(csv.trim(), { header: true, skipEmptyLines: true });
  return r.data;
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
  const p = item['payload'] as { pedidoId?: string; docTipo: DocData['docTipo']; fonte: DocData['fonte']; campos: DocData['campos']; dados: Record<string, unknown> };
  // Item sem doc completo: ou e a planilha de layout desconhecido com
  // proposta de mapeamento (RF11/T124) ou nao tem o que aprovar (extracao
  // falhou): null para a rota responder 404 em vez de 500.
  if (typeof p?.pedidoId !== 'string') {
    return aprovarComMapeamento(canal, alvo, id, item['payload'] as Record<string, unknown>);
  }
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

// Aprovacao do item de layout desconhecido (RF11/T124): a proposta aceita
// roda o parser deterministico linha a linha (a LLM propos coluna -> campo,
// nunca valor) e vira template por (workspace, remetente) — o proximo
// arquivo do remetente entra direto. Sem proposta ou sem o CSV completo no
// item nao ha o que executar: null para a rota responder 404.
async function aprovarComMapeamento(
  canal: CanalSSE,
  alvo: LedgerStore,
  id: number,
  p: Record<string, unknown> | undefined,
): Promise<Evento[] | null> {
  const proposta = p?.['proposta'] as PropostaMapeamento | undefined;
  const csv = p?.['csvCompleto'];
  if (!proposta || typeof csv !== 'string' || !csv.trim()) return null;
  const docs = csvParaLinhas(csv)
    .map((linha, i) => aplicarMapeamento(linha, proposta.mapeamento, i))
    .filter((d): d is DocData => d !== null);
  if (docs.length === 0) return null;

  const r = await alvo.transaction(async (tx) => {
    // Mesma ordem do caminho sem proposta: a decisao do item primeiro, na tx.
    if (!(await tx.resolverRevisao(id, 'aprovado'))) return null;
    const out: Evento[] = [];
    for (const doc of docs) {
      await tx.travarPedido(doc.pedidoId);
      if (await tx.eventoExiste(doc.pedidoId, doc.docTipo, payloadDoDoc(doc))) continue;
      out.push(...(await registrarDoc(tx, doc)));
    }
    return out;
  });
  if (r === null) return null;

  // remetente = nome do arquivo sanitizado: o unico identificador que
  // atravessa upload, IMAP e seed sem registrar cabecalho de quem enviou.
  const remetente = typeof p?.['remetente'] === 'string' ? p['remetente'] : p?.['arquivo'];
  if (typeof remetente === 'string' && remetente) {
    await registrarTemplate(alvo, remetente, proposta.mapeamento);
  }
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
    // T142: doc fiscal gravado alimenta a agenda de contatos pelo fone do
    // endereco; idempotente e nunca sobrescreve contato existente.
    if (r.eventos.length > 0 && (doc.docTipo === 'nfe' || doc.docTipo === 'cte')) {
      await bootstrapContatos(store, doc);
    }
  };

  const processarArquivo = async (nomeArq: string, buf: Buffer, dentroDeEml = false): Promise<void> => {
    switch (detectarTipo(nomeArq, buf)) {
      case 'nfe':
        await processar(parseNFe(buf.toString('utf8')));
        break;
      case 'cte':
        await processar(parseCTe(buf.toString('utf8')));
        break;
      case 'eventoNFe': {
        const doc = parseEventoNFe(buf.toString('utf8'));
        const antes = todos.length;
        await processar(doc);
        // T140: o texto da correcao/justificativa alimenta sinais consultivos,
        // so quando o pedido existe (doc gravou evento: revisao e no-op nao
        // emitem). R-006 intacto: sinal nao declara campo vigiado.
        if (todos.length > antes) {
          const evs = await emitirSinais(store, canal, doc.pedidoId, await extrairSinais(textoDoEvento(doc), doc.fonte));
          uso.eventos += evs.length;
          todos.push(...evs);
        }
        break;
      }
      case 'csv': {
        const linhas = parseCsv(buf.toString('utf8'));
        exigirCabe(linhas.length);
        for (const doc of linhas) await processar(doc);
        break;
      }
      case 'xlsx': {
        // Mesmo caminho do CSV: o parser devolve docs 'planilha' ou um item
        // de revisao (layout desconhecido, formula sem cache, mesclada). O
        // 422 estrutural sobe como ErroParser dentro do parseXlsx. A revisao
        // tambem cobra cota: o exigirCabe vem antes do parse (S1).
        exigirCabe(1);
        const r = await parseXlsx(buf, { nome: nomeArq });
        if (r.docs.length > 0) {
          exigirCabe(r.docs.length);
          for (const doc of r.docs) await processar(doc);
        }
        if (r.revisao) {
          uso.documentos += 1;
          let feito = false;
          const payload = { ...r.revisao.payload };
          const csvCompleto = payload['csvCompleto'];
          if (r.revisao.motivo === 'xlsx_layout_desconhecido' && typeof csvCompleto === 'string') {
            // T124: remetente = nome do arquivo sanitizado (o identificador
            // que atravessa upload, IMAP e seed). Template aprovado do mesmo
            // remetente entra direto, sem LLM e sem fila; fora isso a LLM
            // propoe o mapeamento coluna -> campo e o item carrega a proposta.
            const remetente = nomeAnexoSeguro(nomeArq);
            payload['remetente'] = remetente;
            const linhas = csvParaLinhas(csvCompleto);
            const viaTemplate = await aplicarTemplate(store, remetente, linhas);
            if (viaTemplate !== null && viaTemplate.length > 0) {
              exigirCabe(viaTemplate.length);
              for (const doc of viaTemplate) await processar(doc);
              feito = true;
            } else {
              const cabecalho = Array.isArray(payload['cabecalho']) ? (payload['cabecalho'] as string[]) : [];
              const amostra = linhas.slice(0, 5).map((l) => cabecalho.map((c) => l[c] ?? ''));
              const proposta = await proporMapeamento(cabecalho, amostra);
              if (proposta) payload['proposta'] = proposta;
            }
          }
          if (!feito) {
            revisaoId ??= await store.enfileirarRevisao('planilha', r.revisao.motivo, payload);
          }
        }
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
        const { anexos, corpo } = await extrairEml(buf);
        exigirCabe(anexos.length);
        // Pedidos que receberam documento neste .eml: o corpo so gera sinal
        // para eles (sinal sem pedido nao existe; o corpo nunca e gravado).
        const pedidosTocados = new Set<string>();
        for (const anexo of anexos) {
          const antes = todos.length;
          await processarArquivo(anexo.nome, anexo.conteudo, true);
          for (const ev of todos.slice(antes)) {
            if ((TIPOS_DOCUMENTO as readonly string[]).includes(ev.tipo)) pedidosTocados.add(ev.pedidoId);
          }
        }
        if (corpo && pedidosTocados.size > 0) {
          const sinais = await extrairSinais(corpo, 'imap');
          for (const pid of pedidosTocados) {
            const evs = await emitirSinais(store, canal, pid, sinais);
            uso.eventos += evs.length;
            todos.push(...evs);
          }
        }
        break;
      }
    }
  };

  await processarArquivo(nome, conteudo);
  return { pedidoId, docs, eventos: todos, revisaoId };
}

export { ErroParser };
