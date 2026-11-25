// Validacao a mao dos argumentos das tools (sem zod, como o resto do
// server): qualquer throw vira 'argumentos_invalidos' no executarTool.
// Tambem concentra a fabrica de erro estruturado e definirTool, o unico
// cast do registro: validar ja fechou o formato quando executar roda.

import { CAMPOS_VIGIADOS, PARTES, type CampoVigiado, type Parte } from '../../shared/model.js';
import type { ContextoTools, ResultadoTool, ToolAgente } from './tipos.js';

export const PARTES_SET = new Set<string>(PARTES);
export const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);

export const ROTULO_PARTE: Record<Parte, string> = {
  fornecedor: 'fornecedor',
  transportadora: 'transportadora',
  cd: 'CD',
  fiscal: 'fiscal',
  financeiro: 'financeiro',
};

export function erro(codigo: string, mensagem: string, resumo?: string): ResultadoTool {
  return { ok: false, dados: { erro: codigo, mensagem }, resumo: resumo ?? mensagem };
}

export function definirTool<A>(t: {
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

export function exigirObjeto(args: unknown): Record<string, unknown> {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    throw new Error('Os argumentos da ferramenta precisam ser um objeto.');
  }
  return args as Record<string, unknown>;
}

export function textoOpcional(obj: Record<string, unknown>, campo: string): string | undefined {
  const v = obj[campo];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string') throw new Error(`O argumento "${campo}" precisa ser texto.`);
  const limpo = v.trim();
  return limpo === '' ? undefined : limpo;
}

export function campoOpcional(obj: Record<string, unknown>): CampoVigiado | undefined {
  const v = obj['campo'];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'string' || !CAMPOS_SET.has(v)) {
    throw new Error(`O campo precisa ser um dos campos vigiados: ${CAMPOS_VIGIADOS.join(', ')}.`);
  }
  return v as CampoVigiado;
}

export function exigirParte(obj: Record<string, unknown>): Parte {
  const v = obj['parte'];
  if (typeof v !== 'string' || !PARTES_SET.has(v)) {
    throw new Error(`A parte precisa ser uma destas: ${PARTES.join(', ')}.`);
  }
  return v as Parte;
}

export function exigirPartes(obj: Record<string, unknown>): Parte[] {
  const v = obj['partes'];
  if (!Array.isArray(v) || v.length === 0 || v.some((p) => typeof p !== 'string' || !PARTES_SET.has(p))) {
    throw new Error(`As partes precisam ser uma lista nao vazia com itens de: ${PARTES.join(', ')}.`);
  }
  return [...new Set(v as Parte[])];
}

export const PROP_PEDIDO = {
  pedido: { type: 'string', description: 'Chave completa, ultimos digitos da chave ou nome do fornecedor. Omita para usar o pedido em foco.' },
} as const;

export const ENUM_CAMPO = { type: 'string', enum: [...CAMPOS_VIGIADOS] } as const;
export const ENUM_PARTE = { type: 'string', enum: [...PARTES] } as const;

// O destino real do contato (telefone, e-mail) nao sai no contexto da
// LLM nem no payload 'fim' do navegador: a agenda e confirmacao interna
// e qualquer visitante pediria os telefones da demo de graca. O rabo
// identifica a linha sem expor o numero.
export function destinoParcial(destino: string): string {
  const arroba = destino.indexOf('@');
  if (arroba > 0) return `…@${destino.slice(arroba + 1)}`;
  const digitos = destino.replace(/\D/g, '');
  return digitos.length >= 4 ? `…${digitos.slice(-4)}` : '…';
}
