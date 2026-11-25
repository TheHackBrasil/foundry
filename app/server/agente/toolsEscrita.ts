// Tools de escrita do agente (spec 0009, RF8-RF10): rascunho deterministico
// e escritas reais por notificarTarefa e pelo motor de propagacao, dentro
// de transacao e so sobre pedido gravavel da sessao. Pedido da seed volta
// seed_somente_leitura estruturado — o GenUI do exemplo ainda compoe, e o
// modelo explica o bloqueio sem quebrar o loop.

import { divergenciasDaNovaFonte } from '../../shared/divergence.js';
import { type CampoVigiado, type Divergencia, type Evento, type Notificacao, type Parte } from '../../shared/model.js';
import { camposPorFonte } from '../../shared/projection.js';
import { propagarTodas } from '../../shared/rules.js';
import { canalCompativel, notificarTarefa } from '../nvoip.js';
import { pedidoDaTool, recusaSeedSomenteLeitura } from './resolvedor.js';
import type { ToolAgente } from './tipos.js';
import {
  ENUM_CAMPO,
  ENUM_PARTE,
  PROP_PEDIDO,
  ROTULO_PARTE,
  campoOpcional,
  definirTool,
  destinoParcial,
  exigirObjeto,
  exigirParte,
  textoOpcional,
} from './validacao.js';

export const TOOLS_ESCRITA: ToolAgente[] = [
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
          contato: contato ? { nome: contato.nome, canal: contato.canal, destino: destinoParcial(contato.destino) } : null,
          podeEnviar,
          ...(motivoBloqueio ? { motivoBloqueio } : {}),
        },
        resumo:
          tarefa === null
            ? `Sem tarefa aberta para ${ROTULO_PARTE[args.parte]} no pedido ${pedidoId.slice(-6)}`
            : `Rascunho para ${ROTULO_PARTE[args.parte]} pronto${canalOk ? '' : ' (sem canal de envio)'}`,
        pedidoIdResolvido: pedidoId,
        blocosSugeridos: ['cartoes_despacho', 'checklist_papel'],
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
      // A recusa carrega a parte pedida: o GenUI ainda monta os cartoes de
      // despacho do exemplo para ilustrar o que seria enviado.
      if (workspaceId === ctx.seedWs) {
        return recusaSeedSomenteLeitura({ pedidoId, parte: args.parte, blocos: ['cartoes_despacho'] });
      }
      // Tarefa projetada fora do lock: textoParaTarefa (LLM) e o POST da
      // provedora ja ocupam a transacao tempo demais para carregar tambem
      // a leitura+projecao do pedido (a projecao resolvida ja veio da
      // tool). A tx segura o lock so para a sequencia enviar->registrar.
      const tarefa = [...r.resolvido.projecao.tarefas].reverse().find((t) => t.parte === args.parte) ?? null;
      const exec = await ctx.sessao.transaction(async (tx) => {
        await tx.travarPedido(pedidoId);
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
        blocosSugeridos: ['cartoes_despacho', 'checklist_papel'],
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
        return recusaSeedSomenteLeitura({ pedidoId, blocos: ['domino_impacto'] });
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
        blocosSugeridos: ['domino_impacto', 'checklist_papel'],
        eventos: exec.gravados,
      };
    },
  }),
];
