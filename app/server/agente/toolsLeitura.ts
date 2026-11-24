// Tools de leitura do agente (spec 0009, RF6-RF7): consultam so a projecao
// do ledger e o motor compartilhado; a LLM escolhe a tool, nunca calcula.
// Cada uma sinaliza em blocosSugeridos quais blocos GenUI a resposta pede —
// o compositorGenUI transforma a trilha na visao composta ao fim do loop.

import { simularHipotese } from '../../shared/divergence.js';
import { raizMerkle } from '../../shared/merkle.js';
import {
  CAMPOS_VIGIADOS,
  type CamposObservados,
  type CampoVigiado,
  type Parte,
} from '../../shared/model.js';
import { camposPorFonte, projetar } from '../../shared/projection.js';
import { propagarTodas } from '../../shared/rules.js';
import { normalizarValorHipotese } from '../mandatos.js';
import { pedidoDaTool } from './resolvedor.js';
import type { ToolAgente } from './tipos.js';
import {
  ENUM_CAMPO,
  ENUM_PARTE,
  PROP_PEDIDO,
  ROTULO_PARTE,
  campoOpcional,
  definirTool,
  exigirObjeto,
  exigirPartes,
  textoOpcional,
} from './validacao.js';

// Blocos que cada leitura sugere: o dominio cobre divergencias, o
// comparador foca o conflito real e a linha do tempo conta a historia do
// pedido. Pedido consistente nao tem cascata nem conflito para mostrar.
const BLOCOS_PEDIDO_DIVERGENTE = ['domino_impacto', 'comparador_conflito', 'linha_tempo_causal', 'resumo_citado'] as const;
const BLOCOS_PEDIDO_CONSISTENTE = ['linha_tempo_causal', 'resumo_citado'] as const;

export const TOOLS_LEITURA: ToolAgente[] = [
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
        blocosSugeridos:
          proj.divergencias.length > 0 ? [...BLOCOS_PEDIDO_DIVERGENTE] : [...BLOCOS_PEDIDO_CONSISTENTE],
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
        dados: { pedidoId, ...(args.campo ? { campo: args.campo } : {}), comparacoes },
        resumo:
          comparacoes.length === 0
            ? 'Nenhum campo divergente para comparar'
            : `${comparacoes.length} ${comparacoes.length === 1 ? 'campo comparado' : 'campos comparados'} entre fontes`,
        pedidoIdResolvido: pedidoId,
        blocosSugeridos: ['comparador_conflito', 'matriz_focada', 'linha_tempo_causal'],
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
      const parteFoco = args.partes[0];
      return {
        ok: true,
        // parteFoco orienta a lente do GenUI: o compositor aplica o papel
        // do primeiro setor pedido na visao de decisao.
        dados: { pedidoId, setores, ...(parteFoco ? { parte: parteFoco } : {}) },
        resumo: `Tarefas por setor (${args.partes.map((p) => ROTULO_PARTE[p]).join(', ')}) do pedido ${pedidoId.slice(-6)}`,
        pedidoIdResolvido: pedidoId,
        blocosSugeridos: ['checklist_papel', 'domino_impacto', 'cartoes_despacho'],
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
        blocosSugeridos: ['linha_tempo_causal'],
      };
    },
  }),
];
