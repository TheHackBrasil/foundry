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

const PROMPT_MANDATO = `Voce traduz um comando em portugues sobre pedidos logisticos para JSON.
Responda APENAS JSON neste formato:
{"acao": "propagar" | "simular" | "resumir" | "notificar", "filtros": { ... }, "alvo": "string opcional"}

Acoes:
- propagar: repropagar divergencias e tarefas dos pedidos do filtro ("propague o atraso").
- simular: um "e se?" sem gravar nada ("simule a entrega sexta"); exige filtros.campo e filtros.valor.
- resumir: resumir o estado do pedido para um papel ("resuma para o CD").
- notificar: avisar uma parte sobre a tarefa dela ("avise a transportadora"); exige a parte.

Filtros (todos opcionais):
{"pedidoId": string, "fornecedor": string, "parte": "fornecedor"|"transportadora"|"cd"|"fiscal"|"financeiro", "campo": "previsaoEntrega"|"pesoTotal"|"volumes"|"status", "valor": string|number}
"atraso" no comando aponta para o campo "previsaoEntrega".
alvo: o destino em texto livre quando o comando nao encaixa nos filtros (ex.: "cd", "transportadora", numero do pedido).
Se o comando pedir algo fora dessas acoes, responda {"acao": "nenhuma"}.
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
function normalizarFiltros(m: MandatoParseado): FiltrosMandato {
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

// Resolve os pedidos alvo do filtro. So a sessao do chamador executa: a seed
// e somente leitura, e pedido dela citado de proposito responde 403.
async function resolverAlvos(sessao: LedgerStore, mandato: MandatoParseado, maxAlvos: number): Promise<string[]> {
  const f = normalizarFiltros(mandato);
  if (f.pedidoId) {
    const dono = await sessao.wsDoPedido(f.pedidoId);
    if (dono === null) throw new ErroMandato('sem_alvo', 'O comando não resolveu nenhum pedido da sua sessão.');
    if (dono !== sessao.workspace) throw new ErroRequisicao(403, mensagens.seedSomenteLeitura('agir sobre um pedido de exemplo'));
    return [f.pedidoId];
  }
  let alvos = (await sessao.listarPedidos())
    .filter((p) => p.workspaceId === sessao.workspace)
    .map((p) => p.pedidoId);
  if (f.fornecedor) {
    const fornecedor = f.fornecedor;
    const batidos: string[] = [];
    for (const id of alvos) {
      if (await bateFornecedor(sessao, id, fornecedor)) batidos.push(id);
    }
    alvos = batidos;
  }
  // Para notificar a parte e o destinatario, nao um filtro de pedidos.
  if (f.parte && mandato.acao !== 'notificar') {
    const parte = f.parte;
    const comTarefa: string[] = [];
    for (const id of alvos) {
      const proj = projetar(await sessao.eventosDoPedido(id));
      if (proj.tarefas.some((t) => t.parte === parte)) comTarefa.push(id);
    }
    alvos = comTarefa;
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
  return alvos;
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

// Mesma funcao do /api/simulate: hipotese 'manual' contra o valor real, sem
// gravar nada alem do evento mandato.
async function simularPedido(tx: LedgerStore, pedidoId: string, f: FiltrosMandato): Promise<ExecucaoPedido> {
  if (!f.campo || f.valor === undefined) {
    throw new ErroMandato('acao_ambigua', 'Simular precisa de campo e valor (ex.: "simule a entrega para 2026-02-01").');
  }
  const proj = projetar(await tx.eventosDoPedido(pedidoId));
  const hipotese: CamposObservados = { [f.campo]: f.valor } as CamposObservados;
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

// Texto para humano redigido pela LLM; sem ela ou com saida invalida, o
// resumo deterministico cobre (NFR-degradacao).
async function resumoParaPapel(proj: ProjecaoPedido, pedidoId: string, parte: Parte | undefined): Promise<{ texto: string; via: 'llm' | 'deterministico' }> {
  try {
    const porParte: Record<string, number> = {};
    for (const t of proj.tarefas) porParte[t.parte] = (porParte[t.parte] ?? 0) + 1;
    const contexto = {
      pedidoId,
      papel: parte ?? 'operacao',
      campos: proj.pedido?.campos ?? {},
      divergencias: proj.divergencias.map((d) => ({ campo: d.campo, de: `${d.fonteA}: ${String(d.valorA)}`, para: `${d.fonteB}: ${String(d.valorB)}` })),
      tarefasPorParte: porParte,
    };
    const r = (await chatJson(
      [
        {
          role: 'user',
          content:
            'Resuma em ate 3 frases em portugues o estado deste pedido para o papel indicado. ' +
            'Responda APENAS JSON: {"resumo": string}\n' + JSON.stringify(contexto),
        },
      ],
      { maxTokens: 300 },
    )) as { resumo?: unknown };
    if (typeof r.resumo === 'string' && r.resumo.trim()) return { texto: r.resumo.trim().slice(0, 600), via: 'llm' };
  } catch {
    // fallback deterministico cobre indisponivel e invalido
  }
  return { texto: resumoDeterministico(proj, pedidoId), via: 'deterministico' };
}

async function resumirPedido(tx: LedgerStore, pedidoId: string, parte: Parte | undefined): Promise<ExecucaoPedido> {
  const proj = projetar(await tx.eventosDoPedido(pedidoId));
  const r = await resumoParaPapel(proj, pedidoId, parte);
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

function executarAcao(tx: LedgerStore, pedidoId: string, mandato: MandatoParseado): Promise<ExecucaoPedido> {
  const f = normalizarFiltros(mandato);
  switch (mandato.acao) {
    case 'propagar':
      return propagarPedido(tx, pedidoId, f.campo);
    case 'simular':
      return simularPedido(tx, pedidoId, f);
    case 'resumir':
      return resumirPedido(tx, pedidoId, f.parte);
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
// transacao por pedido (RF5). O lock por (workspace, pedido) no topo e o mesmo
// do pipeline: sem ele dois propagar concorrentes leem eventoExiste=false
// juntos e inserem divergencia/tarefa duplicadas no append-only. O fetch de
// rede do notificar e o da LLM do resumir rolam dentro da tx, limitados pelos
// timeouts curtos das envs.
export async function executarMandato(
  sessao: LedgerStore,
  texto: string,
  mandato: MandatoParseado,
  opcoes: { maxAlvos: number },
): Promise<ResultadoExecucao> {
  const f = normalizarFiltros(mandato);
  if (mandato.acao === 'notificar' && !f.parte) {
    throw new ErroMandato('sem_alvo', 'Notificar precisa da parte a avisar (ex.: "avise o CD").');
  }
  if (mandato.acao === 'simular' && (!f.campo || f.valor === undefined)) {
    throw new ErroMandato('acao_ambigua', 'Simular precisa de campo e valor (ex.: "simule a entrega para 2026-02-01").');
  }
  const alvos = await resolverAlvos(sessao, mandato, opcoes.maxAlvos);
  const porPedido: Array<Record<string, unknown>> = [];
  const eventos: Evento[] = [];
  for (const pedidoId of alvos) {
    const exec = await sessao.transaction(async (tx) => {
      await tx.travarPedido(pedidoId);
      const parcial = await executarAcao(tx, pedidoId, mandato);
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
  if (mandato.acao === 'simular') resultado['simulacao'] = true;
  if (mandato.acao === 'propagar') {
    resultado['novosEventos'] = porPedido.reduce((acc, p) => acc + Number(p['eventosNovos'] ?? 0), 0);
  }
  return { acao: mandato.acao, alvos, resultado, eventos };
}
