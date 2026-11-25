// Fachada das ferramentas do agente (spec 0009, RF5): monta o registro
// TOOLS_AGENTE a partir dos modulos de leitura e escrita e expoe o
// executarTool, a fronteira que nunca lanca — tool desconhecida, argumentos
// invalidos e falha interna viram ResultadoTool com ok:false para o modelo
// reagir dentro do loop. A implementacao vive nos modulos coesos:
// tipos.ts (contrato), validacao.ts (validadores), resolvedor.ts
// (resolucao de pedido), toolsLeitura.ts, toolsEscrita.ts e
// compositorGenUI.ts (blocos GenUI).

import { TOOLS_ESCRITA } from './toolsEscrita.js';
import { TOOLS_LEITURA } from './toolsLeitura.js';
import type { ContextoTools, ResultadoTool, ToolAgente } from './tipos.js';
import { erro } from './validacao.js';

export type { ClienteLlmAgente, ContextoTools, ResultadoTool, ToolAgente } from './tipos.js';
export { resolverPedido, type PedidoResolvido } from './resolvedor.js';

export const TOOLS_AGENTE: ToolAgente[] = [...TOOLS_LEITURA, ...TOOLS_ESCRITA];

export async function executarTool(ctx: ContextoTools, nome: string, argsBrutos: unknown): Promise<ResultadoTool> {
  // Cliente desconectou ou o turno foi abortado: a fila nao inicia novas
  // tools (em especial as de escrita, cujo efeito nao volta atras).
  if (ctx.signal?.aborted) {
    return erro('abortado', 'O pedido foi cancelado.', 'Cancelado');
  }
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
