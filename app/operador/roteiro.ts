// Roteiro do plano de contato (spec 0017, RF11, RF16 e RF25). O roteiro
// preenchido fica em `evidencias`, enderecado pelo sha256 do JSON canonico;
// no ledger entra so o hash. O analista ajusta so os campos tipados desta
// lista fechada; as perguntas sao fechadas e saem do codigo da pergunta.
// Evidencia de contato anterior nunca entra aqui (RF16).
//
// A T761 traz o roteiro completo da ligacao (aviso de gravacao, oferta de
// pessoa, opt-out); este modulo cobre o que a aprovacao precisa: campos,
// hash e ajuste com versao nova.

import { createHash } from 'node:crypto';

export const PERGUNTAS_ROTEIRO = ['status_entrega', 'previsao_entrega', 'confirmar_valor'] as const;
export type PerguntaRoteiro = (typeof PERGUNTAS_ROTEIRO)[number];

const TEXTO_PERGUNTA: Record<PerguntaRoteiro, string> = {
  status_entrega: 'Qual é o status atual da entrega desta nota?',
  previsao_entrega: 'Qual é a previsão de entrega desta nota?',
  confirmar_valor: 'Pode confirmar o valor informado para esta nota?',
};

export interface CamposRoteiro {
  chaveNota: string; // so leitura: identifica a nota na conversa
  pergunta: PerguntaRoteiro;
  empresa: string; // nome da empresa contratante dito pelo agente
}

// Campos que o analista pode mudar no ajuste. chaveNota fica de fora.
export const CAMPOS_AJUSTAVEIS = ['pergunta', 'empresa'] as const;

export interface RoteiroPlano {
  versao: 1; // versao do formato, nao do plano
  canal: 'whatsapp' | 'ligacao';
  campos: CamposRoteiro;
  perguntas: string[];
  motivo: string; // codigo do motivo do plano
  contato: { nome: string; destino: string }; // evidencia, nunca no ledger
}

export const EMPRESA_PADRAO = 'empresa contratante';

const RE_EMPRESA = /^[^\u0000-\u001f\u007f]{1,80}$/;

export function montarRoteiro(entrada: {
  canal: 'whatsapp' | 'ligacao';
  chaveNota: string;
  motivo: string;
  contato: { nome: string; destino: string };
  empresa?: string | null;
  pergunta?: PerguntaRoteiro;
}): RoteiroPlano {
  const empresa = entrada.empresa && RE_EMPRESA.test(entrada.empresa.trim()) ? entrada.empresa.trim() : EMPRESA_PADRAO;
  const pergunta = entrada.pergunta ?? (entrada.motivo === 'divergencia' ? 'confirmar_valor' : 'status_entrega');
  const campos: CamposRoteiro = { chaveNota: entrada.chaveNota, pergunta, empresa };
  return {
    versao: 1,
    canal: entrada.canal,
    campos,
    perguntas: [TEXTO_PERGUNTA[pergunta]],
    motivo: entrada.motivo,
    contato: { nome: entrada.contato.nome, destino: entrada.contato.destino },
  };
}

// JSON com chaves ordenadas: o mesmo roteiro da sempre o mesmo hash.
function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v as Record<string, unknown>)
        .sort()
        .map((k) => [k, canonico((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

export function serializarRoteiro(r: RoteiroPlano): Buffer {
  return Buffer.from(JSON.stringify(canonico(r)), 'utf8');
}

export function hashRoteiro(conteudo: Buffer): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

// Le o roteiro guardado. null quando o conteudo nao tem a forma esperada.
export function lerRoteiroGuardado(conteudo: Buffer): RoteiroPlano | null {
  let bruto: unknown;
  try {
    bruto = JSON.parse(conteudo.toString('utf8'));
  } catch {
    return null;
  }
  const r = bruto as Partial<RoteiroPlano> | null;
  const c = r?.campos as Partial<CamposRoteiro> | undefined;
  if (!r || (r.canal !== 'whatsapp' && r.canal !== 'ligacao') || !c) return null;
  if (typeof c.chaveNota !== 'string' || typeof c.empresa !== 'string') return null;
  if (!(PERGUNTAS_ROTEIRO as readonly string[]).includes(String(c.pergunta))) return null;
  if (!r.contato || typeof r.contato.nome !== 'string' || typeof r.contato.destino !== 'string') return null;
  return montarRoteiro({
    canal: r.canal,
    chaveNota: c.chaveNota,
    motivo: typeof r.motivo === 'string' ? r.motivo : 'plano',
    contato: r.contato,
    empresa: c.empresa,
    pergunta: c.pergunta as PerguntaRoteiro,
  });
}

export type ResultadoAjuste = { ok: true; roteiro: RoteiroPlano } | { ok: false; erro: string };

// Aplica o ajuste do analista: so campos da lista, com tipo e valor
// validados, e pelo menos um campo mudado.
export function ajustarRoteiro(atual: RoteiroPlano, campos: unknown): ResultadoAjuste {
  if (!campos || typeof campos !== 'object' || Array.isArray(campos)) return { ok: false, erro: 'campos deve ser um objeto' };
  const entrada = campos as Record<string, unknown>;
  const chaves = Object.keys(entrada);
  if (chaves.length === 0) return { ok: false, erro: 'nenhum campo para ajustar' };
  const fora = chaves.filter((k) => !(CAMPOS_AJUSTAVEIS as readonly string[]).includes(k));
  if (fora.length > 0) return { ok: false, erro: `campo não ajustável: ${fora.join(', ')}` };
  let pergunta = atual.campos.pergunta;
  let empresa = atual.campos.empresa;
  if ('pergunta' in entrada) {
    if (!(PERGUNTAS_ROTEIRO as readonly unknown[]).includes(entrada['pergunta'])) {
      return { ok: false, erro: `pergunta deve ser uma de: ${PERGUNTAS_ROTEIRO.join(', ')}` };
    }
    pergunta = entrada['pergunta'] as PerguntaRoteiro;
  }
  if ('empresa' in entrada) {
    const v = entrada['empresa'];
    if (typeof v !== 'string' || !RE_EMPRESA.test(v.trim())) return { ok: false, erro: 'empresa deve ter de 1 a 80 caracteres, sem quebra de linha' };
    empresa = v.trim();
  }
  if (pergunta === atual.campos.pergunta && empresa === atual.campos.empresa) return { ok: false, erro: 'nenhum campo mudou' };
  return {
    ok: true,
    roteiro: montarRoteiro({
      canal: atual.canal,
      chaveNota: atual.campos.chaveNota,
      motivo: atual.motivo,
      contato: atual.contato,
      empresa,
      pergunta,
    }),
  };
}
