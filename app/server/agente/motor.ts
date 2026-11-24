// Motor do agente conversacional (spec 0009, RF11-RF15): loop ReAct onde a
// LLM escolhe tools, o servidor executa no motor deterministico e devolve
// cada resultado como role:tool. O texto final sai por texto_delta e as
// tools visuais disparam a composicao GenUI deterministica no pedido que o
// loop resolveu. A LLM nunca calcula nem grava: quem escreve e o motor.

import type {
  Evento,
  EventoStreamMandato,
  RespostaMandato,
  ResultadoAgente,
  TipoBlocoGenUI,
  ToolExecutada,
  TurnoConversa,
  ViewSpecV2,
} from '../../shared/model.js';
import { projetar } from '../../shared/projection.js';
import { chatComTools, chatTextoStream, type ChamadaToolLlm, type DefinicaoToolLlm, type MensagemAgenteLlm } from '../llm.js';
import type { LedgerStore } from '../store.js';
import { comporViewSpecV2Deterministico, type OpcoesViewSpecV2 } from '../viewspec.js';
import { executarTool, TOOLS_AGENTE, type ContextoTools, type ResultadoTool } from './ferramentas.js';

const MAX_ITERACOES = 6;
const MAX_TURNOS_HISTORICO = 10;
const MAX_TEXTO_TURNO = 1_200;
const MAX_PERGUNTA = 4_000;

// System prompt do copiloto (RF13): direto, sem jargao de contrato; a regra
// de ouro e consultar as ferramentas antes de afirmar fato de pedido.
export const SYSTEM_AGENTE = `Voce e o copiloto senior de operacoes logisticas do Forseti, a torre de controle que vigia pedidos: le os documentos que cada parceiro emite (NF-e, CT-e, planilha, CC-e), compara os campos entre eles e aponta divergencias e tarefas por setor (fornecedor, transportadora, CD, fiscal, financeiro).

Como trabalhar:
- Antes de afirmar qualquer fato de pedido (numero, data, chave, status, divergencia ou tarefa), consulte as ferramentas. Nunca invente nem estime valores: tudo que voce afirmar precisa ter vindo de uma consulta.
- Responda em portugues brasileiro, direto e humano. Paragrafos curtos; pode usar **negrito** e listas simples.
- Explique o dominio em linguagem de operacao: divergencia e quando duas fontes declaram valores diferentes para o mesmo campo; CC-e e a carta de correcao da NF-e (nao muda data de saida); propagar e transformar as divergencias em tarefas por setor; simular e testar um "e se?" sem gravar nada.
- Se faltar contexto, pergunte so o minimo para destravar a resposta.
- Nunca exponha JSON, nomes de campos internos, schema ou bastidores de ferramenta na resposta.
- Os pedidos de exemplo sao compartilhados e somente leitura: se uma ferramenta responder seed_somente_leitura, explique que o visitante precisa enviar os proprios arquivos na sessao para comandar de verdade.
- Simulacao nunca grava no ledger: deixe isso claro quando simular um cenario.`;

function systemPrompt(pedidoIdPadrao?: string): string {
  if (!pedidoIdPadrao) return SYSTEM_AGENTE;
  const curto = pedidoIdPadrao.slice(-6);
  return (
    SYSTEM_AGENTE +
    `\n\nPedido em foco nesta conversa: chave terminada em "${curto}". Se o usuario disser "este pedido" ou "esse pedido" sem nomear outro, e a esse que ele se refere.`
  );
}

// RF12: so turnos validos {papel, texto} passam; teto de 10 turnos e 1200
// caracteres por texto, sempre o rabo recente da conversa.
function sanearHistorico(historico: TurnoConversa[] | undefined): MensagemAgenteLlm[] {
  if (!Array.isArray(historico)) return [];
  const validos = historico.filter(
    (t): t is TurnoConversa =>
      typeof t === 'object' &&
      t !== null &&
      (t.papel === 'usuario' || t.papel === 'assistente') &&
      typeof t.texto === 'string' &&
      t.texto.trim() !== '',
  );
  return validos.slice(-MAX_TURNOS_HISTORICO).map((t) => ({
    role: t.papel === 'usuario' ? 'user' : 'assistant',
    content: t.texto.trim().slice(0, MAX_TEXTO_TURNO),
  }));
}

// O texto final ja chegou inteiro do provedor (chamadas com tools nao
// streamam tokens): fatiar por palavra em pedacos de ~40-80 chars da o
// efeito de digitacao sem fingir streaming real. Estrategia documentada
// (T313): chunking honesto; streaming real so no passo de sintese final
// sem tools, onde chatTextoStream faz sentido.
function fatiarTexto(texto: string): string[] {
  const pedacos: string[] = [];
  let resto = texto;
  while (resto.length > 72) {
    let corte = resto.lastIndexOf(' ', 72);
    if (corte < 40) corte = 72;
    pedacos.push(resto.slice(0, corte + 1));
    resto = resto.slice(corte + 1);
  }
  if (resto !== '') pedacos.push(resto);
  return pedacos;
}

function resumoDoQueEncontrei(executadas: ToolExecutada[]): string {
  const concluidas = executadas.filter((t) => t.status === 'concluida');
  if (concluidas.length === 0) {
    return 'Cheguei ao limite de consultas internas sem conseguir concluir a análise. Reformule a pergunta que eu tento de novo.';
  }
  const linhas = concluidas.map((t) => `- ${t.resumo}`).join('\n');
  return `Cheguei ao limite de consultas internas; aqui está o que encontrei até agora:\n${linhas}`;
}

// Chave do resultado estruturado por nome de tool: o fim carrega os dados
// da ultima execucao bem-sucedida de cada uma.
const CHAVE_RESULTADO: Record<string, string> = {
  simular_cenario: 'simulacao',
  enviar_notificacao: 'notificacao',
  propagar_divergencias: 'propagacao',
  preparar_notificacao: 'despacho',
  consultar_auditoria: 'auditoria',
};

export interface OpcoesAgente {
  pergunta: string;
  pedidoId?: string;
  historico?: TurnoConversa[];
  sessao: LedgerStore;
  store: LedgerStore;
  seedWs: string;
  onEvento?: (ev: EventoStreamMandato) => void;
  signal?: AbortSignal;
}

// ResultadoAgente do fim + o RespostaMandato sintetizado do evento
// concluido legado + os eventos que as tools de escrita gravaram (a rota
// republica no canal SSE do workspace).
export type SaidaAgente = ResultadoAgente & {
  respostaCompat: RespostaMandato;
  eventos: Evento[];
};

export async function executarAgente(op: OpcoesAgente): Promise<SaidaAgente> {
  const emitir = op.onEvento ?? ((): void => undefined);
  emitir({ tipo: 'etapa', id: 'contexto', rotulo: 'Preparando contexto da conversa' });

  const ctx: ContextoTools = {
    sessao: op.sessao,
    store: op.store,
    seedWs: op.seedWs,
    texto: op.pergunta.slice(0, MAX_PERGUNTA),
    ...(op.pedidoId ? { pedidoIdPadrao: op.pedidoId } : {}),
  };
  const schemas: DefinicaoToolLlm[] = TOOLS_AGENTE.map((t) => ({
    nome: t.nome,
    descricao: t.descricao,
    parametros: t.schema,
  }));
  const mensagens: MensagemAgenteLlm[] = [
    { role: 'system', content: systemPrompt(op.pedidoId) },
    ...sanearHistorico(op.historico),
    { role: 'user', content: op.pergunta.slice(0, MAX_PERGUNTA) },
  ];

  const toolsExecutadas: ToolExecutada[] = [];
  const blocosSugeridos = new Set<TipoBlocoGenUI>();
  const resultadoEstruturado: Record<string, unknown> = {};
  const eventosGravados: Evento[] = [];
  let pedidoIdResolvido: string | undefined;
  let textoFinal = '';

  for (let i = 0; i < MAX_ITERACOES; i++) {
    emitir({
      tipo: 'etapa',
      id: `agente-${i}`,
      rotulo: i === 0 ? 'Interpretando e planejando' : 'Sintetizando o que encontrei',
    });
    const resposta = await chatComTools(mensagens, schemas, { signal: op.signal });
    if (resposta.toolCalls.length === 0) {
      textoFinal = resposta.texto;
      break;
    }

    // Assistant com tool_calls volta ao historico do jeito que o wire pede
    // (content pode ser null), depois uma role:tool por chamada.
    mensagens.push({
      role: 'assistant',
      content: resposta.texto !== '' ? resposta.texto : null,
      tool_calls: resposta.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.nome, arguments: JSON.stringify(tc.argumentos) },
      })),
    });

    const resultados = await Promise.all(
      resposta.toolCalls.map(async (tc: ChamadaToolLlm) => {
        emitir({ tipo: 'tool', nome: tc.nome, resumo: 'Executando…', status: 'executando' });
        let r: ResultadoTool;
        try {
          r = await executarTool(ctx, tc.nome, tc.argumentos);
        } catch {
          // executarTool nunca lanca; o cinto extra e para o dia em que
          // uma tool nova esquecer o contrato.
          r = {
            ok: false,
            dados: { erro: 'falha_execucao', mensagem: 'A consulta interna falhou desta vez.' },
            resumo: `Falha ao executar ${tc.nome}`,
          };
        }
        emitir({ tipo: 'tool', nome: tc.nome, resumo: r.resumo, status: r.ok ? 'concluida' : 'erro' });
        return { tc, r };
      }),
    );

    for (const { tc, r } of resultados) {
      mensagens.push({ role: 'tool', tool_call_id: tc.id, name: tc.nome, content: JSON.stringify(r.dados) });
      toolsExecutadas.push({ nome: tc.nome, resumo: r.resumo, status: r.ok ? 'concluida' : 'erro' });
      if (r.pedidoIdResolvido) {
        pedidoIdResolvido = r.pedidoIdResolvido;
        // O pedido resolvido vira o foco das proximas chamadas do loop.
        ctx.pedidoIdPadrao = pedidoIdResolvido;
      }
      for (const b of r.blocosSugeridos ?? []) blocosSugeridos.add(b);
      if (r.eventos) eventosGravados.push(...r.eventos);
      const chave = CHAVE_RESULTADO[tc.nome];
      if (chave && r.ok) resultadoEstruturado[chave] = r.dados;
    }
  }

  // Streaming do texto final: no caminho normal o texto ja veio inteiro na
  // resposta com tools, entao vai por fatias; no estouro do teto a chamada
  // de sintese sem tools pode streamar de verdade.
  if (textoFinal === '') {
    emitir({ tipo: 'etapa', id: 'sintese', rotulo: 'Sintetizando a resposta final' });
    try {
      textoFinal = await chatTextoStream(
        mensagens,
        (delta) => emitir({ tipo: 'texto_delta', delta }),
        { signal: op.signal },
      );
    } catch {
      textoFinal = resumoDoQueEncontrei(toolsExecutadas);
      for (const delta of fatiarTexto(textoFinal)) emitir({ tipo: 'texto_delta', delta });
    }
  } else {
    for (const delta of fatiarTexto(textoFinal)) emitir({ tipo: 'texto_delta', delta });
  }

  // GenUI: so compoe quando alguma tool visual sinalizou bloco e ha pedido
  // resolvido no loop (RF15).
  let viewSpec: ViewSpecV2 | undefined;
  if (pedidoIdResolvido && blocosSugeridos.size > 0) {
    const dono = await op.sessao.wsDoPedido(pedidoIdResolvido);
    const leitor = dono === null ? null : dono === op.sessao.workspace ? op.sessao : op.sessao.paraWorkspace(dono);
    if (leitor) {
      const proj = projetar(await leitor.eventosDoPedido(pedidoIdResolvido));
      const opcoes: OpcoesViewSpecV2 = { pergunta: op.pergunta.slice(0, 400) };
      const sim = resultadoEstruturado['simulacao'] as
        | { hipotese?: { campo?: OpcoesViewSpecV2['campoSimulado']; valor?: string | number } }
        | undefined;
      const notif = resultadoEstruturado['notificacao'] as { parte?: OpcoesViewSpecV2['papel'] } | undefined;
      const desp = resultadoEstruturado['despacho'] as { parte?: OpcoesViewSpecV2['papel'] } | undefined;
      if (sim) {
        opcoes.acao = 'simular';
        if (sim.hipotese?.campo) opcoes.campoSimulado = sim.hipotese.campo;
        if (sim.hipotese?.valor !== undefined) opcoes.valorSimulado = sim.hipotese.valor;
      } else if (notif ?? desp) {
        opcoes.acao = 'notificar';
        const papel = notif?.parte ?? desp?.parte;
        if (papel) opcoes.papel = papel;
      }
      viewSpec = comporViewSpecV2Deterministico(proj, opcoes);
      const relevantes = viewSpec.blocos.filter((b) => blocosSugeridos.has(b.tipo));
      const emitidos = relevantes.length > 0 ? relevantes : viewSpec.blocos.slice(0, 1);
      for (const bloco of emitidos) emitir({ tipo: 'bloco', bloco });
    }
  }

  const respostaCompat: RespostaMandato = {
    acao: 'resumir',
    alvos: pedidoIdResolvido ? [pedidoIdResolvido] : [],
    resultado: { porPedido: [{ pedidoId: pedidoIdResolvido ?? '', resumo: textoFinal, via: 'llm' }] },
    ...(viewSpec ? { viewSpec } : {}),
  };

  return {
    textoFinal,
    toolsExecutadas,
    ...(pedidoIdResolvido ? { pedidoIdResolvido } : {}),
    ...(viewSpec ? { viewSpec } : {}),
    ...(Object.keys(resultadoEstruturado).length > 0 ? { resultado: resultadoEstruturado } : {}),
    respostaCompat,
    eventos: eventosGravados,
  };
}
