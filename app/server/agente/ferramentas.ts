// Ferramentas do agente conversacional (spec 0009, RF5-RF10): registro
// modular {nome, descricao, schema, validar, executar}. Toda leitura sai da
// projecao do ledger e toda escrita passa pelo motor deterministico dentro
// de transacao; a LLM escolhe a tool, nunca monta evento nem calcula.
// Erro de tool nunca lanca: volta {ok:false, erro, mensagem} em pt-BR para
// o modelo corrigir a chamada ou explicar a limitacao ao usuario.

import { divergenciasDaNovaFonte, simularHipotese } from '../../shared/divergence.js';
import { raizMerkle } from '../../shared/merkle.js';
import {
  CAMPOS_VIGIADOS,
  PARTES,
  type CamposObservados,
  type CampoVigiado,
  type Divergencia,
  type Evento,
  type Notificacao,
  type Parte,
  type ProjecaoPedido,
  type TipoBlocoGenUI,
} from '../../shared/model.js';
import { camposPorFonte, projetar } from '../../shared/projection.js';
import { propagarTodas } from '../../shared/rules.js';
import { normalizarValorHipotese } from '../mandatos.js';
import { canalCompativel, notificarTarefa } from '../nvoip.js';
import type { LedgerStore } from '../store.js';

export interface ContextoTools {
  sessao: LedgerStore;
  store: LedgerStore;
  seedWs: string;
  pedidoIdPadrao?: string;
  // Pergunta original do usuario: alimenta o evento 'mandato' das escritas,
  // a mesma intencao que o fluxo classico registra (A10).
  texto?: string;
}

export interface ResultadoTool {
  ok: boolean;
  dados: Record<string, unknown>; // serializado como content da role tool
  resumo: string; // uma linha legivel para a trilha de execucao do SSE
  pedidoIdResolvido?: string;
  blocosSugeridos?: TipoBlocoGenUI[];
  // Eventos gravados pelas tools de escrita: a rota republica no canal SSE.
  eventos?: Evento[];
}

export interface ToolAgente {
  nome: string;
  descricao: string;
  schema: Record<string, unknown>; // JSON Schema dos parametros
  validar: (args: unknown) => unknown;
  executar: (ctx: ContextoTools, args: unknown) => Promise<ResultadoTool>;
}

const PARTES_SET = new Set<string>(PARTES);
const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);

const ROTULO_PARTE: Record<Parte, string> = {
  fornecedor: 'fornecedor',
  transportadora: 'transportadora',
  cd: 'CD',
  fiscal: 'fiscal',
  financeiro: 'financeiro',
};

function erro(codigo: string, mensagem: string, resumo?: string): ResultadoTool {
  return { ok: false, dados: { erro: codigo, mensagem }, resumo: resumo ?? mensagem };
}

// definirTool centraliza o unico cast do arquivo: o registro e heterogeneo
// (args: unknown), mas validar ja fechou o formato quando executar roda.
function definirTool<A>(t: {
  nome: string;
  descricao: string;
  schema: Record<string, unknown>;
  validar: (args: unknown) => A;
  executar: (ctx: ContextoTools, args: A) => Promise<ResultadoTool>;
}): ToolAgente {
  return {
    nome: t.nome,
    descricao: t.descricao,
    schema: t.schema,
    validar: (a) => t.validar(a),
    executar: (ctx, a) => t.executar(ctx, a as A),
  };
}

// Validacao a mao (sem zod, como o resto do server): qualquer throw vira
// 'argumentos_invalidos' no executarTool.
function exigirObjeto(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('Os argumentos da ferramenta precisam ser um objeto.');
  }
  return args as Record<string, unknown>;
}

function textoOpcional(obj: Record<string, unknown>, campo: string): string | undefined {
  const v = obj[campo];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`O argumento "${campo}" precisa ser texto.`);
  const limpo = v.trim();
  return limpo === '' ? undefined : limpo;
}

function campoOpcional(obj: Record<string, unknown>): CampoVigiado | undefined {
  const v = obj['campo'];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !CAMPOS_SET.has(v)) {
    throw new Error(`O campo precisa ser um dos campos vigiados: ${CAMPOS_VIGIADOS.join(', ')}.`);
  }
  return v as CampoVigiado;
}

function exigirParte(obj: Record<string, unknown>): Parte {
  const v = obj['parte'];
  if (typeof v !== 'string' || !PARTES_SET.has(v)) {
    throw new Error(`A parte precisa ser uma destas: ${PARTES.join(', ')}.`);
  }
  return v as Parte;
}

function exigirPartes(obj: Record<string, unknown>): Parte[] {
  const v = obj['partes'];
  if (!Array.isArray(v) || v.length === 0 || v.some((p) => typeof p !== 'string' || !PARTES_SET.has(p))) {
    throw new Error(`As partes precisam ser uma lista nao vazia com itens de: ${PARTES.join(', ')}.`);
  }
  return [...new Set(v as Parte[])];
}

export interface PedidoResolvido {
  pedidoId: string;
  workspaceId: string;
  projecao: ProjecaoPedido;
}

async function carregarPedido(sessao: LedgerStore, pedidoId: string, workspaceId: string): Promise<PedidoResolvido> {
  const leitor = sessao.paraWorkspace(workspaceId);
  return { pedidoId, workspaceId, projecao: projetar(await leitor.eventosDoPedido(pedidoId)) };
}

// Resolve a referencia do usuario a um pedido visivel: id exato, sufixo da
// chave (o operador cita os ultimos digitos) ou trecho do nome do emitente
// sem acento e sem caixa. Sem ref, cai no pedido em foco da conversa.
export async function resolverPedido(
  sessao: LedgerStore,
  ref?: string,
  padrao?: string,
): Promise<PedidoResolvido | null> {
  const alvo = (ref?.trim() || padrao?.trim()) ?? '';
  if (alvo === '') return null;

  const dono = await sessao.wsDoPedido(alvo);
  if (dono !== null) return carregarPedido(sessao, alvo, dono);

  const lista = await sessao.listarPedidos();
  const cauda = Math.max(alvo.length, 6);
  const porSufixo = lista.filter((p) => p.pedidoId.slice(-cauda).includes(alvo));
  const primeiro = porSufixo[0];
  if (primeiro) return carregarPedido(sessao, primeiro.pedidoId, primeiro.workspaceId);

  const norm = (s: string): string => s.toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
  const alvoNorm = norm(alvo);
  for (const p of lista) {
    const r = await carregarPedido(sessao, p.pedidoId, p.workspaceId);
    const emitente = r.projecao.pedido?.emitente.nome ?? '';
    if (emitente !== '' && emitente !== '?' && emitente !== 'a confirmar' && norm(emitente).includes(alvoNorm)) {
      return r;
    }
  }
  return null;
}

type ResultadoResolucao = { resolvido: PedidoResolvido } | { falha: ResultadoTool };

async function pedidoDaTool(ctx: ContextoTools, ref: string | undefined): Promise<ResultadoResolucao> {
  const r = await resolverPedido(ctx.sessao, ref, ctx.pedidoIdPadrao);
  if (!r) {
    return {
      falha: erro(
        'pedido_nao_encontrado',
        'Nao encontrei esse pedido na sessao nem nos exemplos. Peca a chave, os ultimos digitos ou o nome do fornecedor.',
        'Pedido não localizado',
      ),
    };
  }
  return { resolvido: r };
}

function seedSomenteLeitura(): ResultadoTool {
  return erro(
    'seed_somente_leitura',
    'Este pedido e somente leitura (exemplo publico). Envie os arquivos na sua sessao para comandar de verdade.',
    'Pedido de exemplo: somente leitura',
  );
}

const PROP_PEDIDO = {
  pedido: { type: 'string', description: 'Chave completa, ultimos digitos da chave ou nome do fornecedor. Omita para usar o pedido em foco.' },
} as const;

const ENUM_CAMPO = { type: 'string', enum: [...CAMPOS_VIGIADOS] } as const;
const ENUM_PARTE = { type: 'string', enum: [...PARTES] } as const;

export const TOOLS_AGENTE: ToolAgente[] = [
  definirTool<{ limite?: number }>({
    nome: 'listar_pedidos',
    descricao:
      'Lista os pedidos visiveis no workspace (sessao do visitante + exemplos) com emitente, status, contagens de divergencias e tarefas.',
    schema: {
      type: 'object',
      properties: {
        limite: { type: 'integer', description: 'Maximo de pedidos a listar (padrao 15)' },
      },
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      const raw = obj['limite'];
      if (raw === undefined || raw === null) return {};
      if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 1) {
        throw new Error('O argumento "limite" precisa ser um numero positivo.');
      }
      return { limite: Math.min(30, Math.floor(raw)) };
    },
    executar: async (ctx, args) => {
      const lista = await ctx.sessao.listarPedidos();
      const pedidos = [];
      for (const item of lista.slice(0, args.limite ?? 15)) {
        const leitor = ctx.sessao.paraWorkspace(item.workspaceId);
        const proj = projetar(await leitor.eventosDoPedido(item.pedidoId));
        pedidos.push({
          pedidoId: item.pedidoId,
          chaveCurta: item.pedidoId.slice(-6),
          emitente: proj.pedido?.emitente.nome ?? null,
          destinatario: proj.pedido?.destinatario.nome ?? null,
          status: proj.pedido?.campos.status ?? null,
          divergencias: new Set(proj.divergencias.map((d) => d.campo)).size,
          tarefasAbertas: new Set(proj.tarefas.map((t) => `${t.parte}|${t.titulo}`)).size,
          daSessao: item.workspaceId === ctx.sessao.workspace,
        });
      }
      return {
        ok: true,
        dados: { total: lista.length, pedidos },
        resumo: `${lista.length} ${lista.length === 1 ? 'pedido visível' : 'pedidos visíveis'} no workspace`,
      };
    },
  }),

  definirTool<{ pedido?: string }>({
    nome: 'consultar_pedido',
    descricao:
      'Consulta um pedido: rota emitente-destinatario, itens, valores declarados por fonte, divergencias ativas, tarefas por setor, sinais e integridade da cadeia.',
    schema: { type: 'object', properties: { ...PROP_PEDIDO } },
    validar: (args) => ({ pedido: textoOpcional(exigirObjeto(args), 'pedido') }),
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, workspaceId, projecao: proj } = r.resolvido;
      const leitor = ctx.sessao.paraWorkspace(workspaceId);
      const porFonte = camposPorFonte(await leitor.eventosDoPedido(pedidoId));
      const tarefasPorParte: Record<string, Array<{ titulo: string; detalhe: string; campo: CampoVigiado }>> = {};
      for (const t of proj.tarefas) {
        const lista = tarefasPorParte[t.parte] ?? [];
        lista.push({ titulo: t.titulo, detalhe: t.detalhe, campo: t.divergencia.campo });
        tarefasPorParte[t.parte] = lista;
      }
      return {
        ok: true,
        dados: {
          pedidoId,
          chaveCurta: pedidoId.slice(-6),
          emitente: proj.pedido?.emitente ?? null,
          destinatario: proj.pedido?.destinatario ?? null,
          itens: proj.pedido?.itens ?? [],
          camposConsolidados: proj.pedido?.campos ?? {},
          valoresPorFonte: proj.versoes.map((v) => ({
            fonte: v.fonte,
            versao: v.versao,
            campos: porFonte.get(v.fonte) ?? v.campos,
          })),
          divergencias: proj.divergencias,
          tarefasPorParte,
          sinais: proj.sinais.map((s) => ({ tipo: s.tipo, fonte: s.fonte, resumo: s.resumo })),
          notificacoes: proj.notificacoes.map((n) => ({ parte: n.parte, status: n.status, motivo: n.motivo ?? null })),
          integridade: { totalEventos: proj.totalEventos },
          daSessao: workspaceId === ctx.sessao.workspace,
        },
        resumo: `Pedido ${pedidoId.slice(-6)}: ${proj.divergencias.length} divergência(s), ${proj.tarefas.length} tarefa(s)`,
        pedidoIdResolvido: pedidoId,
      };
    },
  }),

  definirTool<{ pedido?: string; campo?: CampoVigiado }>({
    nome: 'comparar_fontes',
    descricao:
      'Compara o valor de um campo vigiado entre as fontes do pedido (ou de todos os campos divergentes), com a versao que declarou cada valor.',
    schema: {
      type: 'object',
      properties: { ...PROP_PEDIDO, campo: { ...ENUM_CAMPO, description: 'Campo vigiado a comparar; omita para todos os divergentes' } },
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      return { pedido: textoOpcional(obj, 'pedido'), campo: campoOpcional(obj) };
    },
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, projecao: proj } = r.resolvido;
      const campos = args.campo ? [args.campo] : [...new Set(proj.divergencias.map((d) => d.campo))];
      const comparacoes = campos.map((campo) => {
        const porFonte = proj.versoes
          .filter((v) => v.campos[campo] !== undefined)
          .map((v) => ({ fonte: v.fonte, versao: v.versao, valor: v.campos[campo] }));
        return {
          campo,
          porFonte,
          divergencias: proj.divergencias.filter((d) => d.campo === campo),
        };
      });
      return {
        ok: true,
        dados: { pedidoId, comparacoes },
        resumo:
          comparacoes.length === 0
            ? 'Nenhum campo divergente para comparar'
            : `${comparacoes.length} ${comparacoes.length === 1 ? 'campo comparado' : 'campos comparados'} entre fontes`,
        pedidoIdResolvido: pedidoId,
      };
    },
  }),

  definirTool<{ pedido?: string; campo: CampoVigiado; valor: string | number }>({
    nome: 'simular_cenario',
    descricao:
      'Simula um "e se?" sobre um campo vigiado (ex.: outra data de entrega, outro peso) sem gravar nada no ledger. Devolve divergencias e tarefas previstas.',
    schema: {
      type: 'object',
      properties: {
        ...PROP_PEDIDO,
        campo: { ...ENUM_CAMPO, description: 'Campo vigiado a alterar na hipotese' },
        valor: { type: 'string', description: 'Valor hipotetico em texto: data AAAA-MM-DD ou DD/MM/AAAA, numero (ex.: "600", "15") ou status' },
      },
      required: ['campo', 'valor'],
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      const campo = campoOpcional(obj);
      if (!campo) throw new Error(`Falta o campo a simular: use um de ${CAMPOS_VIGIADOS.join(', ')}.`);
      const valor = obj['valor'];
      if (typeof valor !== 'string' && typeof valor !== 'number') {
        throw new Error('Falta o valor da hipotese: texto ou numero (ex.: "2026-02-01", 600, "atrasada").');
      }
      return { pedido: textoOpcional(obj, 'pedido'), campo, valor };
    },
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, projecao: proj } = r.resolvido;
      // R-006: simulacao nunca grava. Mesma normalizacao do mandato classico
      // (data BR e numero em texto viram o formato do motor).
      const valor = normalizarValorHipotese(args.campo, args.valor);
      const hipotese = { [args.campo]: valor } as CamposObservados;
      const divergencias = simularHipotese(proj.versoes, hipotese);
      const tarefas = propagarTodas(divergencias);
      const partesImpactadas = [...new Set(tarefas.map((t) => t.parte))];
      return {
        ok: true,
        dados: {
          pedidoId,
          hipotese: { campo: args.campo, valor },
          divergencias,
          tarefas,
          partesImpactadas,
          simulacao: true,
        },
        resumo: `Simulação sem gravação: ${divergencias.length} divergência(s) e ${tarefas.length} tarefa(s) previstas`,
        pedidoIdResolvido: pedidoId,
        blocosSugeridos: ['simulador_interativo', 'domino_impacto'],
      };
    },
  }),

  definirTool<{ pedido?: string; partes: Parte[] }>({
    nome: 'listar_tarefas_setor',
    descricao:
      'Lista as tarefas abertas do pedido agrupadas por setor, com o contato da agenda de cada setor pedido.',
    schema: {
      type: 'object',
      properties: {
        ...PROP_PEDIDO,
        partes: { type: 'array', items: { ...ENUM_PARTE }, description: 'Setores a listar (fornecedor, transportadora, cd, fiscal, financeiro)' },
      },
      required: ['partes'],
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      return { pedido: textoOpcional(obj, 'pedido'), partes: exigirPartes(obj) };
    },
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, projecao: proj } = r.resolvido;
      const setores = [];
      for (const parte of args.partes) {
        const contato = await ctx.sessao.contatoDaParte(parte);
        setores.push({
          parte,
          tarefas: proj.tarefas
            .filter((t) => t.parte === parte)
            .map((t) => ({ titulo: t.titulo, detalhe: t.detalhe, campo: t.divergencia.campo })),
          contato: contato ? { nome: contato.nome, canal: contato.canal, destino: contato.destino } : null,
        });
      }
      return {
        ok: true,
        dados: { pedidoId, setores },
        resumo: `Tarefas por setor (${args.partes.map((p) => ROTULO_PARTE[p]).join(', ')}) do pedido ${pedidoId.slice(-6)}`,
        pedidoIdResolvido: pedidoId,
      };
    },
  }),

  definirTool<{ pedido?: string }>({
    nome: 'consultar_auditoria',
    descricao:
      'Verifica a integridade da cadeia de eventos do pedido: hash elo a elo, total de eventos, raiz Merkle e ultima ancora registrada.',
    schema: { type: 'object', properties: { ...PROP_PEDIDO } },
    validar: (args) => ({ pedido: textoOpcional(exigirObjeto(args), 'pedido') }),
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, workspaceId } = r.resolvido;
      const leitor = ctx.sessao.paraWorkspace(workspaceId);
      const eventos = await leitor.eventosDoPedido(pedidoId);
      const verificacao = await leitor.auditar(pedidoId);
      const ancora = await leitor.ultimoAncora(pedidoId);
      return {
        ok: true,
        dados: {
          pedidoId,
          valida: verificacao.valida,
          totalEventos: verificacao.total,
          raizMerkle: raizMerkle(eventos.map((e) => e.hash)),
          ultimoAncora: ancora,
        },
        resumo: `Cadeia ${verificacao.valida ? 'íntegra' : 'com falha'}: ${verificacao.total} evento(s)`,
        pedidoIdResolvido: pedidoId,
      };
    },
  }),

  definirTool<{ pedido?: string; parte: Parte }>({
    nome: 'preparar_notificacao',
    descricao:
      'Prepara o rascunho de aviso para um setor a partir da tarefa real do pedido (campo divergente e valores das fontes), conferindo contato e canal na agenda. Nao envia nada.',
    schema: {
      type: 'object',
      properties: { ...PROP_PEDIDO, parte: { ...ENUM_PARTE, description: 'Setor a avisar' } },
      required: ['parte'],
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      return { pedido: textoOpcional(obj, 'pedido'), parte: exigirParte(obj) };
    },
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, projecao: proj } = r.resolvido;
      const tarefa = [...proj.tarefas].reverse().find((t) => t.parte === args.parte) ?? null;
      const contato = await ctx.sessao.contatoDaParte(args.parte);
      const canalOk = contato !== null && canalCompativel(contato.canal);
      const podeEnviar = tarefa !== null && canalOk;
      const motivoBloqueio = tarefa === null ? 'sem_tarefa' : contato === null ? 'sem_contato' : !canalOk ? 'canal_incompativel' : undefined;
      return {
        ok: true,
        dados: {
          pedidoId,
          parte: args.parte,
          rascunho: tarefa
            ? {
                parte: args.parte,
                campo: tarefa.divergencia.campo,
                mensagemSugerida: `${tarefa.titulo}: ${tarefa.detalhe}`.slice(0, 220),
                via: 'deterministico',
              }
            : null,
          contato: contato ? { nome: contato.nome, canal: contato.canal, destino: contato.destino } : null,
          podeEnviar,
          ...(motivoBloqueio ? { motivoBloqueio } : {}),
        },
        resumo:
          tarefa === null
            ? `Sem tarefa aberta para ${ROTULO_PARTE[args.parte]} no pedido ${pedidoId.slice(-6)}`
            : `Rascunho para ${ROTULO_PARTE[args.parte]} pronto${canalOk ? '' : ' (sem canal de envio)'}`,
        pedidoIdResolvido: pedidoId,
        blocosSugeridos: ['cartoes_despacho'],
      };
    },
  }),

  definirTool<{ pedido?: string; parte: Parte }>({
    nome: 'enviar_notificacao',
    descricao:
      'Envia de verdade o aviso da ultima tarefa do setor pela provedora configurada e grava o evento de notificacao no pedido. So funciona em pedido da sessao, nunca nos exemplos.',
    schema: {
      type: 'object',
      properties: { ...PROP_PEDIDO, parte: { ...ENUM_PARTE, description: 'Setor a avisar' } },
      required: ['parte'],
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      return { pedido: textoOpcional(obj, 'pedido'), parte: exigirParte(obj) };
    },
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, workspaceId } = r.resolvido;
      // A9: pedido do exemplo compartilhado e somente leitura para todos.
      if (workspaceId === ctx.seedWs) {
        return { ...seedSomenteLeitura(), pedidoIdResolvido: pedidoId };
      }
      const exec = await ctx.sessao.transaction(async (tx) => {
        await tx.travarPedido(pedidoId);
        const proj = projetar(await tx.eventosDoPedido(pedidoId));
        const tarefa = [...proj.tarefas].reverse().find((t) => t.parte === args.parte) ?? null;
        const ev = await notificarTarefa(tx, pedidoId, tarefa, { registrarSempre: true, parte: args.parte });
        const n = ev?.payload as unknown as Notificacao | undefined;
        const gravados: Evento[] = ev ? [ev] : [];
        const evMandato = await tx.append(pedidoId, 'mandato', {
          ator: 'workspace',
          texto: (ctx.texto ?? '').slice(0, 500),
          acao: 'notificar',
          filtros: { parte: args.parte },
          resultado: { status: n?.status ?? 'nao_entregue', ...(n?.motivo ? { motivo: n.motivo } : {}) },
        });
        gravados.push(evMandato);
        return { n, gravados };
      });
      const n = exec.n;
      return {
        ok: true,
        dados: {
          pedidoId,
          parte: args.parte,
          status: n?.status ?? 'nao_entregue',
          ...(n?.motivo !== undefined ? { motivo: n.motivo } : {}),
          ...(n?.canal !== undefined && n.canal !== null ? { canal: n.canal } : {}),
          ...(n?.mensagem ? { mensagem: n.mensagem } : {}),
        },
        resumo:
          n?.status === 'entregue'
            ? `Aviso entregue para ${ROTULO_PARTE[args.parte]}${n.canal ? ` por ${n.canal}` : ''}`
            : `Aviso não entregue para ${ROTULO_PARTE[args.parte]}${n?.motivo ? ` (${n.motivo})` : ''}`,
        pedidoIdResolvido: pedidoId,
        blocosSugeridos: ['cartoes_despacho'],
        eventos: exec.gravados,
      };
    },
  }),

  definirTool<{ pedido?: string; campo?: CampoVigiado }>({
    nome: 'propagar_divergencias',
    descricao:
      'Repropaga as divergencias do pedido pelo motor deterministico e grava so o que ainda nao existe na cadeia (divergencias e tarefas novas). So funciona em pedido da sessao.',
    schema: {
      type: 'object',
      properties: { ...PROP_PEDIDO, campo: { ...ENUM_CAMPO, description: 'Restringe a propagacao a um campo vigiado' } },
    },
    validar: (args) => {
      const obj = exigirObjeto(args);
      return { pedido: textoOpcional(obj, 'pedido'), campo: campoOpcional(obj) };
    },
    executar: async (ctx, args) => {
      const r = await pedidoDaTool(ctx, args.pedido);
      if ('falha' in r) return r.falha;
      const { pedidoId, workspaceId } = r.resolvido;
      if (workspaceId === ctx.seedWs) {
        return { ...seedSomenteLeitura(), pedidoIdResolvido: pedidoId };
      }
      // Mesmo caminho do propagarPedido do mandato classico: recomputa pelo
      // motor e grava so o que falta, dentro de transacao com lock do pedido.
      const exec = await ctx.sessao.transaction(async (tx) => {
        await tx.travarPedido(pedidoId);
        const eventos = await tx.eventosDoPedido(pedidoId);
        const fontes = [...camposPorFonte(eventos).entries()].map(([fonte, campos]) => ({ fonte, campos }));
        const vistos = new Set<string>();
        const divs: Divergencia[] = [];
        for (let i = 1; i < fontes.length; i++) {
          for (const d of divergenciasDaNovaFonte(fontes[i]!, fontes.slice(0, i))) {
            const chave = `${d.campo}|${d.fonteA}|${d.fonteB}`;
            if (vistos.has(chave) || (args.campo && d.campo !== args.campo)) continue;
            vistos.add(chave);
            divs.push(d);
          }
        }
        const tarefas = propagarTodas(divs);
        const gravados: Evento[] = [];
        for (const d of divs) {
          if (!(await tx.eventoExiste(pedidoId, 'divergencia', { ...d }))) {
            gravados.push(await tx.append(pedidoId, 'divergencia', { ...d }));
          }
        }
        for (const t of tarefas) {
          if (!(await tx.eventoExiste(pedidoId, 'tarefa', { ...t }))) {
            gravados.push(await tx.append(pedidoId, 'tarefa', { ...t }));
          }
        }
        const evMandato = await tx.append(pedidoId, 'mandato', {
          ator: 'workspace',
          texto: (ctx.texto ?? '').slice(0, 500),
          acao: 'propagar',
          filtros: { ...(args.campo ? { campo: args.campo } : {}) },
          resultado: { divergencias: divs.length, tarefas: tarefas.length, eventosNovos: gravados.length },
        });
        gravados.push(evMandato);
        return { divs, tarefas, gravados };
      });
      return {
        ok: true,
        dados: {
          pedidoId,
          divergencias: exec.divs.length,
          tarefas: exec.tarefas.length,
          eventosNovos: exec.gravados.length - 1, // fora o evento mandato
        },
        resumo: `Propagação concluída: ${exec.gravados.length - 1} evento(s) novo(s) no pedido ${pedidoId.slice(-6)}`,
        pedidoIdResolvido: pedidoId,
        eventos: exec.gravados,
      };
    },
  }),
];

// Executa uma tool do registro sem nunca lancar: tool desconhecida,
// argumentos invalidos e falha interna viram ResultadoTool com ok:false
// para o modelo reagir dentro do loop.
export async function executarTool(ctx: ContextoTools, nome: string, argsBrutos: unknown): Promise<ResultadoTool> {
  const tool = TOOLS_AGENTE.find((t) => t.nome === nome);
  if (!tool) {
    return erro(
      'tool_desconhecida',
      `A ferramenta "${nome}" nao existe. As disponiveis sao: ${TOOLS_AGENTE.map((t) => t.nome).join(', ')}.`,
      `Ferramenta desconhecida: ${nome}`,
    );
  }
  let args: unknown;
  try {
    args = tool.validar(argsBrutos);
  } catch (e) {
    return erro('argumentos_invalidos', (e as Error).message, `Argumentos inválidos em ${nome}`);
  }
  try {
    return await tool.executar(ctx, args);
  } catch {
    return erro(
      'falha_execucao',
      'A consulta interna falhou desta vez. Tente de outra forma ou explique a limitacao ao usuario.',
      `Falha ao executar ${nome}`,
    );
  }
}
