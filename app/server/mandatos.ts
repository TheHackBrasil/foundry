// Mandatos (spec 0007, RF4/RF5): texto livre em pt-BR vira acao tipada no
// conjunto fechado {propagar, simular, resumir, notificar}; a execucao e so
// do motor deterministico existente e um evento 'mandato' cai na cadeia de
// cada pedido alvo na mesma transacao. A LLM nunca escreve campo vigiado,
// nunca vira regra: ela so traduz a intencao.

import { divergenciasDaNovaFonte, simularHipotese } from '../shared/divergence.js';
import { formatarData, rotuloStatus } from '../shared/formato.js';
import {
  ACOES_MANDATO,
  CAMPOS_VIGIADOS,
  PARTES,
  type AcaoMandato,
  type CamposObservados,
  type Divergencia,
  type Evento,
  type FiltrosMandato,
  type MandatoParseado,
  type Notificacao,
  type Parte,
  type ProjecaoPedido,
} from '../shared/model.js';
import { camposPorFonte, projetar } from '../shared/projection.js';
import { propagarTodas } from '../shared/rules.js';
import { chatJson } from './llm.js';
import { notificarTarefa } from './nvoip.js';
import { ErroRequisicao, mensagens } from './protecao.js';
import type { LedgerStore } from './store.js';

export type MotivoMandato = 'parse_falhou' | 'acao_ambigua' | 'sem_alvo' | 'filtro_largo';

// Recusa declarativa do mandato: a rota responde 422 com o motivo.
export class ErroMandato extends Error {
  constructor(
    readonly motivo: MotivoMandato,
    mensagem: string,
  ) {
    super(mensagem);
    this.name = 'ErroMandato';
  }
}

const MAX_TEXTO_COMANDO = 1_000;

const PROMPT_MANDATO = `Voce traduz uma pergunta ou comando em portugues sobre pedidos logisticos para JSON.
Responda APENAS JSON neste formato:
{"acao": "propagar" | "simular" | "resumir" | "notificar", "filtros": { ... }, "alvo": "string opcional"}

Acoes:
- resumir: QUALQUER pergunta, duvida, pedido de explicacao, diagnostico, status, atraso, divergencia, tarefas ou pedido de visao por papel ("resuma o estado", "qual o atraso?", "por que o peso esta diferente?", "o que o fiscal precisa fazer?", "mostre a visao do CD", "quais documentos divergem?").
- simular: cenario hipotetico "e se?" sem gravar nada ("simule a entrega para 28/01/2026", "e se o peso for 600 kg?"); exige filtros.campo e filtros.valor.
- propagar: repropagar divergencias e gerar tarefas pendentes na cadeia ("propague o atraso", "repropague tarefas").
- notificar: enviar aviso/notificacao para uma parte ("avise a transportadora", "notifique o CD"); exige filtros.parte.

Filtros (todos opcionais):
{"pedidoId": string, "fornecedor": string, "parte": "fornecedor"|"transportadora"|"cd"|"fiscal"|"financeiro", "campo": "previsaoEntrega"|"pesoTotal"|"volumes"|"status", "valor": string|number}
Regras importantes:
- Sempre preencha filtros.parte quando o usuario mencionar um papel (fornecedor, transportadora, cd, fiscal, financeiro).
- "atraso" ou "entrega" aponta para o campo "previsaoEntrega".
- Em simular, datas em filtros.valor devem sair no formato AAAA-MM-DD (ex.: "28/01/2026" -> "2026-01-28"); pesoTotal e volumes devem sair como numero.
- alvo: destino livre so quando nao encaixar nos filtros (ex.: nome de fornecedor ou chave de 44 digitos). Nao coloque frases inteiras em alvo.
- So responda {"acao": "nenhuma"} para pedidos destrutivos (apagar, excluir, cancelar nota, alterar campo diretamente) ou assuntos completamente alheios a pedidos logisticos.
Comando:
`;

const ACOES = new Set<string>(ACOES_MANDATO);
const PARTES_SET = new Set<string>(PARTES);
const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);

// Validacao a mao do JSON da LLM (sem zod): a forma fecha o schema, os
// valores fecham os enums. Acao fora do conjunto e ambiguidade, nao parse.
export function validarMandato(json: unknown): MandatoParseado {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) {
    throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
  }
  const r = json as Record<string, unknown>;
  const acao = r['acao'];
  if (typeof acao !== 'string') {
    throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
  }
  if (!ACOES.has(acao)) {
    throw new ErroMandato('acao_ambigua', 'O comando não corresponde a uma ação possível (propagar, simular, resumir, notificar).');
  }
  const filtros: FiltrosMandato = {};
  const f = r['filtros'];
  if (f !== undefined && f !== null) {
    if (typeof f !== 'object' || Array.isArray(f)) {
      throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
    }
    const fo = f as Record<string, unknown>;
    for (const chave of ['pedidoId', 'fornecedor'] as const) {
      if (fo[chave] !== undefined) {
        if (typeof fo[chave] !== 'string') throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
        filtros[chave] = fo[chave] as string;
      }
    }
    if (fo['parte'] !== undefined) {
      if (typeof fo['parte'] !== 'string' || !PARTES_SET.has(fo['parte'])) {
        throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
      }
      filtros.parte = fo['parte'] as Parte;
    }
    if (fo['campo'] !== undefined) {
      if (typeof fo['campo'] !== 'string' || !CAMPOS_SET.has(fo['campo'])) {
        throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
      }
      filtros.campo = fo['campo'] as FiltrosMandato['campo'];
    }
    if (fo['valor'] !== undefined) {
      const v = fo['valor'];
      if (typeof v !== 'string' && typeof v !== 'number') {
        throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
      }
      filtros.valor = v;
    }
  }
  const alvo = r['alvo'];
  if (alvo !== undefined && alvo !== null && typeof alvo !== 'string') {
    throw new ErroMandato('parse_falhou', 'A resposta da camada de linguagem nao veio no formato esperado.');
  }
  return { acao: acao as AcaoMandato, filtros, ...(typeof alvo === 'string' ? { alvo } : {}) };
}

// Traducao do comando pela LLM. ErroLlm sobe (a rota mapeia 503/422).
export async function interpretarMandato(texto: string): Promise<MandatoParseado> {
  const json = await chatJson([{ role: 'user', content: PROMPT_MANDATO + texto.slice(0, MAX_TEXTO_COMANDO) }], { maxTokens: 400 });
  return validarMandato(json);
}

// O campo 'alvo' da LLM e texto livre: quando e parte, chave ou nome de
// fornecedor ele completa o filtro vazio correspondente.
export function normalizarFiltros(m: MandatoParseado): FiltrosMandato {
  const f: FiltrosMandato = { ...m.filtros };
  const alvo = m.alvo?.trim();
  if (alvo) {
    if (f.parte === undefined && PARTES_SET.has(alvo)) f.parte = alvo as Parte;
    else if (f.pedidoId === undefined && /^\d{44}$/.test(alvo)) f.pedidoId = alvo;
    else if (f.fornecedor === undefined && f.parte === undefined && f.pedidoId === undefined) f.fornecedor = alvo;
  }
  return f;
}

// Fornecedor bate por CNPJ (digitos) ou por trecho do nome no emitente da NF-e.
async function bateFornecedor(sessao: LedgerStore, pedidoId: string, alvo: string): Promise<boolean> {
  const evs = await sessao.eventosDoPedido(pedidoId);
  const nfe = evs.find((e) => e.tipo === 'nfe');
  const emit = (nfe?.payload as { dados?: { emitente?: { nome?: unknown; cnpj?: unknown } } } | undefined)?.dados?.emitente;
  if (!emit) return false;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const digitos = alvo.replace(/\D/g, '');
  if (digitos.length >= 8) {
    const cnpj = String(emit.cnpj ?? '').replace(/\D/g, '');
    return cnpj !== '' && cnpj.includes(digitos);
  }
  const nome = typeof emit.nome === 'string' ? emit.nome : '';
  return nome !== '' && norm(nome).includes(norm(alvo));
}

// Acoes somente leitura (resumir e simular) podem ler a seed visivel quando a
// sessao ainda nao tem pedidos proprios, sem jamais gravar evento na seed.
const ehSomenteLeitura = (acao: AcaoMandato): boolean => acao === 'resumir' || acao === 'simular';

async function filtrarCandidatos(
  sessao: LedgerStore,
  candidatos: string[],
  mandato: MandatoParseado,
  f: FiltrosMandato,
): Promise<string[]> {
  let alvos = candidatos;
  if (f.fornecedor) {
    const fornecedor = f.fornecedor;
    const batidos: string[] = [];
    for (const id of alvos) {
      if (await bateFornecedor(sessao, id, fornecedor)) batidos.push(id);
    }
    alvos = batidos;
  }
  // Para notificar a parte e o destinatario; para resumir a resposta pode
  // explicar inclusive quando a parte nao tem tarefas abertas.
  if (f.parte && mandato.acao !== 'notificar' && mandato.acao !== 'resumir') {
    const parte = f.parte;
    const comTarefa: string[] = [];
    for (const id of alvos) {
      const proj = projetar(await sessao.eventosDoPedido(id));
      if (proj.tarefas.some((t) => t.parte === parte)) comTarefa.push(id);
    }
    alvos = comTarefa;
  }
  return alvos;
}

// Resolve os pedidos alvo do filtro. Escritas (propagar, notificar) exigem
// pedidos proprios da sessao; leituras/simulacoes podem consultar a seed em
// modo somente leitura quando a sessao ainda esta vazia ou seleciona a seed.
async function resolverAlvos(
  sessao: LedgerStore,
  mandato: MandatoParseado,
  maxAlvos: number,
  texto: string,
  pedidoIdPadrao?: string,
): Promise<{ alvos: string[]; somenteLeitura: boolean }> {
  const f = normalizarFiltros(mandato);
  const pedeTodos = /\btodos\s+os\s+pedidos\b|\btodos\s+pedidos\b|\bcada\s+pedido\b/i.test(texto);
  const padrao = !f.pedidoId && !f.fornecedor && !pedeTodos ? pedidoIdPadrao?.trim() : undefined;
  const pedidoDireto = f.pedidoId ?? (padrao || undefined);

  if (pedidoDireto) {
    const dono = await sessao.wsDoPedido(pedidoDireto);
    if (dono === null) throw new ErroMandato('sem_alvo', 'O comando não resolveu nenhum pedido da sua sessão.');
    if (dono !== sessao.workspace) {
      if (ehSomenteLeitura(mandato.acao)) {
        return { alvos: [pedidoDireto], somenteLeitura: true };
      }
      throw new ErroRequisicao(403, mensagens.seedSomenteLeitura('agir sobre um pedido de exemplo'));
    }
    return { alvos: [pedidoDireto], somenteLeitura: false };
  }
  const todos = await sessao.listarPedidos();
  const proprios = todos.filter((p) => p.workspaceId === sessao.workspace).map((p) => p.pedidoId);

  let alvos = await filtrarCandidatos(sessao, proprios, mandato, f);
  let somenteLeitura = false;

  if (alvos.length === 0 && (proprios.length === 0 || Boolean(f.fornecedor)) && ehSomenteLeitura(mandato.acao)) {
    const daSeed = todos.filter((p) => p.workspaceId !== sessao.workspace);
    const seedWs = daSeed[0]?.workspaceId;
    if (seedWs) {
      const leitorSeed = sessao.paraWorkspace(seedWs);
      const achadosSeed = await filtrarCandidatos(
        leitorSeed,
        daSeed.map((p) => p.pedidoId),
        mandato,
        f,
      );
      if (achadosSeed.length > 0) {
        alvos = achadosSeed;
        somenteLeitura = true;
      }
    }
  }

  if (alvos.length === 0) {
    throw new ErroMandato('sem_alvo', 'O comando não resolveu nenhum pedido da sua sessão.');
  }
  if (alvos.length > maxAlvos) {
    throw new ErroMandato(
      'filtro_largo',
      `O filtro resolve ${alvos.length} pedidos; o limite por comando é ${maxAlvos}. Refine com pedidoId ou fornecedor.`,
    );
  }
  return { alvos, somenteLeitura };
}

interface ExecucaoPedido {
  eventos: Evento[]; // eventos gravados na execucao (fora o 'mandato')
  resumo: Record<string, unknown>; // resultado resumido no payload do mandato
  resultado: Record<string, unknown>; // resultado por pedido na resposta da rota
}

// Repropagacao idempotente (decisao da spec): recomputa divergencias e
// tarefas pelo motor e grava so o que ainda nao existe no ledger.
async function propagarPedido(tx: LedgerStore, pedidoId: string, campo: FiltrosMandato['campo']): Promise<ExecucaoPedido> {
  const eventos = await tx.eventosDoPedido(pedidoId);
  const fontes = [...camposPorFonte(eventos).entries()].map(([fonte, campos]) => ({ fonte, campos }));
  const vistos = new Set<string>();
  const divs: Divergencia[] = [];
  for (let i = 1; i < fontes.length; i++) {
    for (const d of divergenciasDaNovaFonte(fontes[i]!, fontes.slice(0, i))) {
      const chave = `${d.campo}|${d.fonteA}|${d.fonteB}`;
      if (vistos.has(chave) || (campo && d.campo !== campo)) continue;
      vistos.add(chave);
      divs.push(d);
    }
  }
  const tarefas = propagarTodas(divs);
  const novos: Evento[] = [];
  for (const d of divs) {
    if (!(await tx.eventoExiste(pedidoId, 'divergencia', { ...d }))) {
      novos.push(await tx.append(pedidoId, 'divergencia', { ...d }));
    }
  }
  for (const t of tarefas) {
    if (!(await tx.eventoExiste(pedidoId, 'tarefa', { ...t }))) {
      novos.push(await tx.append(pedidoId, 'tarefa', { ...t }));
    }
  }
  return {
    eventos: novos,
    resumo: { divergencias: divs.length, tarefas: tarefas.length, eventosNovos: novos.length },
    resultado: { divergencias: divs, tarefas, eventosNovos: novos.length },
  };
}

export function normalizarValorHipotese(campo: FiltrosMandato['campo'], valor: string | number): string | number {
  if (campo === 'previsaoEntrega' && typeof valor === 'string') {
    const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(valor.trim());
    if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  }
  if ((campo === 'pesoTotal' || campo === 'volumes') && typeof valor === 'string') {
    const num = Number(valor.replace(/[^\d.,-]/g, '').replace(',', '.'));
    if (Number.isFinite(num)) return num;
  }
  return valor;
}

// Mesma funcao do /api/simulate: hipotese 'manual' contra o valor real, sem
// gravar nada alem do evento mandato (ou nada, em leitura da seed).
async function simularPedido(tx: LedgerStore, pedidoId: string, f: FiltrosMandato): Promise<ExecucaoPedido> {
  if (!f.campo || f.valor === undefined) {
    throw new ErroMandato('acao_ambigua', 'Simular precisa de campo e valor (ex.: "simule a entrega para 2026-02-01").');
  }
  const proj = projetar(await tx.eventosDoPedido(pedidoId));
  const valor = normalizarValorHipotese(f.campo, f.valor);
  const hipotese: CamposObservados = { [f.campo]: valor } as CamposObservados;
  const divs = simularHipotese(proj.versoes, hipotese);
  const tarefas = propagarTodas(divs);
  return {
    eventos: [],
    resumo: { divergencias: divs.length, tarefas: tarefas.length },
    resultado: { divergencias: divs, tarefas },
  };
}

function resumoDeterministico(proj: ProjecaoPedido, pedidoId: string): string {
  const p = proj.pedido;
  if (!p) return `Pedido ${pedidoId} sem dados consolidados.`;
  const estado: string[] = [];
  if (p.campos['status']) estado.push(`status ${rotuloStatus(String(p.campos['status']))}`);
  if (p.campos['previsaoEntrega']) estado.push(`previsão ${formatarData(String(p.campos['previsaoEntrega']))}`);
  const emitente = p.emitente.nome !== '?' ? ` do fornecedor ${p.emitente.nome}` : '';
  return `Pedido${emitente} com ${estado.join(', ') || 'sem campos declarados'}: ` +
    `${proj.divergencias.length} divergência(s) e ${proj.tarefas.length} tarefa(s) na cadeia.`;
}

// Texto para humano redigido pela LLM com base estrita no ledger; sem ela ou
// com saida invalida, o resumo deterministico cobre (NFR-degradacao).
async function resumoParaPapel(
  proj: ProjecaoPedido,
  pedidoId: string,
  parte: Parte | undefined,
  perguntaUsuario: string,
): Promise<{ texto: string; via: 'llm' | 'deterministico' }> {
  try {
    const porParte: Record<string, string[]> = {};
    for (const t of proj.tarefas) {
      const lista = porParte[t.parte] ?? [];
      if (!lista.includes(t.titulo)) lista.push(t.titulo);
      porParte[t.parte] = lista;
    }
    const contexto = {
      pedidoId,
      papel: parte ?? 'operacao',
      pergunta: perguntaUsuario.slice(0, 400),
      emitente: proj.pedido?.emitente.nome ?? null,
      destinatario: proj.pedido?.destinatario.nome ?? null,
      camposConsolidados: proj.pedido?.campos ?? {},
      fontes: proj.versoes.map((v) => ({ fonte: v.fonte, versao: v.versao, campos: v.campos })),
      divergencias: proj.divergencias.map((d) => ({
        campo: d.campo,
        de: `${d.fonteA}: ${String(d.valorA)}`,
        para: `${d.fonteB}: ${String(d.valorB)}`,
      })),
      tarefasPorParte: porParte,
      sinais: proj.sinais.map((s) => ({ tipo: s.tipo, fonte: s.fonte, resumo: s.resumo })),
    };
    const r = (await chatJson(
      [
        {
          role: 'user',
          content:
            'Responda diretamente em portugues (em ate 4 frases claras e objetivas) a pergunta ou solicitacao do usuario sobre este pedido logistico. ' +
            'Use APENAS os fatos do JSON abaixo: cite datas, valores e fontes reais (NF-e, CT-e, Planilha, CC-e). ' +
            'Nunca invente dados que nao estejam no registro. Responda APENAS JSON: {"resumo": string}\n' +
            JSON.stringify(contexto),
        },
      ],
      { maxTokens: 420 },
    )) as { resumo?: unknown };
    if (typeof r.resumo === 'string' && r.resumo.trim()) return { texto: r.resumo.trim().slice(0, 900), via: 'llm' };
  } catch {
    // fallback deterministico cobre indisponivel e invalido
  }
  return { texto: resumoDeterministico(proj, pedidoId), via: 'deterministico' };
}

async function resumirPedido(
  tx: LedgerStore,
  pedidoId: string,
  parte: Parte | undefined,
  perguntaUsuario: string,
): Promise<ExecucaoPedido> {
  const proj = projetar(await tx.eventosDoPedido(pedidoId));
  const r = await resumoParaPapel(proj, pedidoId, parte, perguntaUsuario);
  return { eventos: [], resumo: { via: r.via }, resultado: { resumo: r.texto, via: r.via } };
}

// Despacha a notificacao da ultima tarefa da parte pelo nvoip.ts; o evento
// 'notificacao' registra o que saiu de verdade ou o motivo da falha.
async function notificarPedido(tx: LedgerStore, pedidoId: string, f: FiltrosMandato): Promise<ExecucaoPedido> {
  const parte = f.parte;
  if (!parte) {
    throw new ErroMandato('sem_alvo', 'Notificar precisa da parte a avisar (ex.: "avise o CD").');
  }
  const proj = projetar(await tx.eventosDoPedido(pedidoId));
  const tarefa =
    [...proj.tarefas].reverse().find((t) => t.parte === parte && (!f.campo || t.divergencia.campo === f.campo)) ?? null;
  const ev = await notificarTarefa(tx, pedidoId, tarefa, { registrarSempre: true, parte });
  const n = ev?.payload as unknown as Notificacao | undefined;
  return {
    eventos: ev ? [ev] : [],
    resumo: { status: n?.status ?? 'nao_entregue', ...(n?.motivo ? { motivo: n.motivo } : {}) },
    resultado: { pedidoId, parte, status: n?.status ?? 'nao_entregue', ...(n?.motivo ? { motivo: n.motivo } : {}) },
  };
}

function executarAcao(
  tx: LedgerStore,
  pedidoId: string,
  mandato: MandatoParseado,
  texto: string,
): Promise<ExecucaoPedido> {
  const f = normalizarFiltros(mandato);
  switch (mandato.acao) {
    case 'propagar':
      return propagarPedido(tx, pedidoId, f.campo);
    case 'simular':
      return simularPedido(tx, pedidoId, f);
    case 'resumir':
      return resumirPedido(tx, pedidoId, f.parte, texto);
    case 'notificar':
      return notificarPedido(tx, pedidoId, f);
  }
}

export interface ResultadoExecucao {
  acao: AcaoMandato;
  alvos: string[];
  resultado: Record<string, unknown>;
  eventos: Evento[]; // para o SSE emitir apos o commit
}

// Resolve o filtro e executa pedido a pedido: acao + evento mandato na mesma
// transacao por pedido (RF5). Quando resumir/simular le a seed por ausencia de
// pedidos proprios na sessao, executa sem gravar nada na seed.
export async function executarMandato(
  sessao: LedgerStore,
  texto: string,
  mandato: MandatoParseado,
  opcoes: { maxAlvos: number; pedidoIdPadrao?: string },
): Promise<ResultadoExecucao> {
  const f = normalizarFiltros(mandato);
  if (mandato.acao === 'notificar' && !f.parte) {
    throw new ErroMandato('sem_alvo', 'Notificar precisa da parte a avisar (ex.: "avise o CD").');
  }
  if (mandato.acao === 'simular' && (!f.campo || f.valor === undefined)) {
    throw new ErroMandato('acao_ambigua', 'Simular precisa de campo e valor (ex.: "simule a entrega para 2026-02-01").');
  }
  const { alvos, somenteLeitura } = await resolverAlvos(
    sessao,
    mandato,
    opcoes.maxAlvos,
    texto,
    opcoes.pedidoIdPadrao,
  );
  const porPedido: Array<Record<string, unknown>> = [];
  const eventos: Evento[] = [];
  for (const pedidoId of alvos) {
    if (somenteLeitura) {
      // Le o pedido no workspace dono (seed) sem abrir escrita nem gravar evento.
      const dono = (await sessao.wsDoPedido(pedidoId)) ?? sessao.workspace;
      const leitor = dono === sessao.workspace ? sessao : sessao.paraWorkspace(dono);
      const parcial = await executarAcao(leitor, pedidoId, mandato, texto);
      porPedido.push({ pedidoId, ...parcial.resultado });
      continue;
    }
    const exec = await sessao.transaction(async (tx) => {
      await tx.travarPedido(pedidoId);
      const parcial = await executarAcao(tx, pedidoId, mandato, texto);
      const evMandato = await tx.append(pedidoId, 'mandato', {
        ator: 'workspace',
        texto: texto.slice(0, 500),
        acao: mandato.acao,
        filtros: mandato.filtros,
        ...(mandato.alvo !== undefined ? { alvo: mandato.alvo } : {}),
        resultado: parcial.resumo,
      });
      return { parcial, gravados: [...parcial.eventos, evMandato] };
    });
    porPedido.push({ pedidoId, ...exec.parcial.resultado });
    eventos.push(...exec.gravados);
  }
  const resultado: Record<string, unknown> = { porPedido };
  if (somenteLeitura) resultado['leituraExemplo'] = true;
  if (mandato.acao === 'simular') resultado['simulacao'] = true;
  if (mandato.acao === 'propagar') {
    resultado['novosEventos'] = porPedido.reduce((acc, p) => acc + Number(p['eventosNovos'] ?? 0), 0);
  }
  return { acao: mandato.acao, alvos, resultado, eventos };
}
