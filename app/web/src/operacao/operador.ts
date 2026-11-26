// Domínio da parte do operador na #/operacao (spec 0017, T752 e T771):
// rótulos dos planos e da linha do tempo, máscara de telefone e leitura
// tolerante do roteiro guardado em evidência. Funções puras, testáveis sem DOM.

import type { CategoriaLinhaTempo, ItemLinhaTempo, PlanoContatoProjetado } from '../../../shared/casos.ts';
import type { EstadoPlanoContato, Evento } from '../../../shared/model.ts';
import type { CamposRoteiro } from './api.ts';

const ROTULO_ESTADO_PLANO: Record<EstadoPlanoContato, string> = {
  proposto: 'Aguardando decisão',
  aprovado: 'Aprovado',
  recusado: 'Recusado',
  expirado: 'Expirou sem decisão',
  iniciado: 'Em andamento',
  aceito: 'Aceito pelo fornecedor',
  incerto: 'Resultado incerto',
  falhou: 'Falhou',
};

const CLASSE_ESTADO_PLANO: Record<EstadoPlanoContato, string> = {
  proposto: 'pilula-warn',
  aprovado: 'pilula-ok',
  recusado: 'pilula-sutil',
  expirado: 'pilula-sutil',
  iniciado: 'pilula-neutra',
  aceito: 'pilula-ok',
  incerto: 'pilula-warn',
  falhou: 'pilula-erro',
};

export const rotuloEstadoPlano = (e: EstadoPlanoContato): string => ROTULO_ESTADO_PLANO[e] ?? e;
export const classeEstadoPlano = (e: EstadoPlanoContato): string => CLASSE_ESTADO_PLANO[e] ?? 'pilula-sutil';

export const rotuloCanalOperador = (canal: string | undefined): string => {
  switch (canal) {
    case 'whatsapp':
      return 'WhatsApp';
    case 'ligacao':
      return 'Ligação';
    case 'email':
      return 'E-mail';
    case 'sms':
      return 'SMS';
    case undefined:
      return '';
    default:
      return rotuloCodigo(canal);
  }
};

// Código snake_case vira texto legível; o resto passa como veio.
export const rotuloCodigo = (codigo: string): string => codigo.replaceAll('_', ' ');

const FMT_BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const formatarBrl = (valor: number): string => FMT_BRL.format(Number.isFinite(valor) ? valor : 0);

// Mostra só DDI, DDD e os 4 últimos dígitos: "+55 11 •••••-0002".
export function mascararTelefone(destino: string): string {
  const digitos = destino.replace(/\D/g, '');
  if (digitos.length < 4) return '••••';
  const fim = digitos.slice(-4);
  if (digitos.length >= 12 && digitos.startsWith('55')) {
    return `+55 ${digitos.slice(2, 4)} •••••-${fim}`;
  }
  if (digitos.length >= 10) return `(${digitos.slice(0, 2)}) •••••-${fim}`;
  return `•••• ${fim}`;
}

// Roteiro preenchido, lido da evidência pelo hash do plano (RF16 e RF25). Só
// os campos tipados entram como editáveis; as perguntas são fechadas.
export interface RoteiroLido {
  campos: CamposRoteiro;
  perguntas: string[];
  motivo?: string;
  destino?: string;
  nomeContato?: string;
}

const textoCurto = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim().length > 0 && v.length <= 500 ? v.trim() : undefined;

export function lerRoteiro(conteudo: unknown): RoteiroLido | null {
  if (!conteudo || typeof conteudo !== 'object' || Array.isArray(conteudo)) return null;
  const r = conteudo as Record<string, unknown>;
  const campos: CamposRoteiro = {};
  const brutos = r['campos'];
  if (brutos && typeof brutos === 'object' && !Array.isArray(brutos)) {
    for (const [k, v] of Object.entries(brutos as Record<string, unknown>)) {
      if (typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))) {
        campos[k] = v;
      }
    }
  }
  const perguntas = Array.isArray(r['perguntas'])
    ? (r['perguntas'] as unknown[]).map((p) =>
        typeof p === 'string' ? p : textoCurto((p as Record<string, unknown> | null)?.['texto']),
      ).filter((p): p is string => typeof p === 'string' && p.length > 0)
    : [];
  const contato = (r['contato'] && typeof r['contato'] === 'object' ? r['contato'] : {}) as Record<string, unknown>;
  const motivo = textoCurto(r['motivo']);
  const destino = textoCurto(r['destino']) ?? textoCurto(r['telefone']) ?? textoCurto(contato['destino']);
  const nomeContato = textoCurto(contato['nome']) ?? textoCurto(r['nomeContato']);
  return {
    campos,
    perguntas,
    ...(motivo ? { motivo } : {}),
    ...(destino ? { destino } : {}),
    ...(nomeContato ? { nomeContato } : {}),
  };
}

// Espelho do contrato de app/operador/roteiro.ts (aquele módulo usa
// node:crypto e não entra no bundle): só estes campos aceitam ajuste, e a
// pergunta é uma lista fechada.
export const CAMPOS_AJUSTAVEIS: readonly string[] = ['pergunta', 'empresa'];
export const MAX_EMPRESA = 80;
export const OPCOES_PERGUNTA: ReadonlyArray<readonly [string, string]> = [
  ['status_entrega', 'Status atual da entrega'],
  ['previsao_entrega', 'Previsão de entrega'],
  ['confirmar_valor', 'Confirmar o valor informado'],
];

export const rotuloPergunta = (codigo: string): string =>
  OPCOES_PERGUNTA.find(([c]) => c === codigo)?.[1] ?? rotuloCodigo(codigo);

const ROTULO_CAMPO_ROTEIRO: Record<string, string> = {
  chaveNota: 'Chave da nota',
  pergunta: 'Pergunta',
  empresa: 'Empresa dita pelo agente',
};

// Rótulo de campo do roteiro: conhecido pelo nome; o resto, camelCase e
// snake_case viram palavras.
export function rotuloCampoRoteiro(chave: string): string {
  const conhecido = ROTULO_CAMPO_ROTEIRO[chave];
  if (conhecido) return conhecido;
  const s = chave.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ').toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Só os campos que mudaram vão no ajuste.
export function camposAlterados(originais: CamposRoteiro, editados: CamposRoteiro): CamposRoteiro {
  const out: CamposRoteiro = {};
  for (const [k, v] of Object.entries(editados)) {
    if (k in originais && originais[k] !== v) out[k] = v;
  }
  return out;
}

// Motivo do plano: vem como código no contato_planejado da linha do tempo.
export function motivoDoPlano(plano: PlanoContatoProjetado, linha: readonly ItemLinhaTempo[]): string | undefined {
  const item = [...linha]
    .reverse()
    .find((i) => i.tipo === 'contato_planejado' && i.planoId === plano.planoId && i.motivo);
  return item?.motivo ? rotuloCodigo(item.motivo) : undefined;
}

export const planoPedeDecisao = (plano: PlanoContatoProjetado): boolean => plano.estado === 'proposto';

// Planos abertos primeiro, depois os mais recentes.
export function ordenarPlanos(planos: readonly PlanoContatoProjetado[]): PlanoContatoProjetado[] {
  return [...planos].sort(
    (a, b) =>
      Number(planoPedeDecisao(b)) - Number(planoPedeDecisao(a)) || b.atualizadoEm.localeCompare(a.atualizadoEm),
  );
}

const ROTULO_CATEGORIA: Record<CategoriaLinhaTempo, string> = {
  caso: 'Caso',
  operador: 'Operador',
  aprovacao: 'Aprovação',
  tentativa: 'Tentativa',
  evidencia: 'Evidência',
  declaracao: 'Declaração',
};

export const rotuloCategoria = (c: CategoriaLinhaTempo): string => ROTULO_CATEGORIA[c] ?? c;

const ROTULO_TIPO: Partial<Record<Evento['tipo'], string>> = {
  divergencia: 'Caso aberto por divergência',
  pendencia_aberta: 'Caso aberto por pendência',
  caso_atribuido: 'Caso assumido',
  caso_resolvido: 'Caso resolvido',
  caso_reaberto: 'Caso reaberto',
  caso_resposta_parceiro: 'Resposta do parceiro',
  operador_assumiu: 'Operador assumiu o caso',
  operador_escalou: 'Operador subiu de degrau',
  operador_encerrou: 'Operador encerrou a escada',
  contato_optout: 'Pedido para não ser contatado pela IA',
  contato_planejado: 'Plano de contato proposto',
  contato_aprovado: 'Plano aprovado',
  contato_recusado: 'Plano recusado',
  contato_expirado: 'Plano expirou sem decisão',
  cobranca_enviada: 'Cobrança por e-mail enviada',
  cobranca_expirada: 'Cobrança sem resposta no prazo',
  contato_iniciado: 'Contato iniciado',
  contato_aceito: 'Fornecedor aceitou o contato',
  contato_incerto: 'Resultado do contato incerto',
  contato_falhou: 'Contato falhou',
  ligacao_concluida: 'Ligação concluída',
  status_declarado: 'Declaração extraída',
};

export const rotuloItemLinha = (item: ItemLinhaTempo): string => ROTULO_TIPO[item.tipo] ?? rotuloCodigo(item.tipo);
