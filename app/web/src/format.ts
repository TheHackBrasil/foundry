import type { CampoVigiado, FonteDocumento, Parte, TipoEvento } from '../../shared/model.ts';

export const ROTULO_FONTE: Record<FonteDocumento, string> = {
  nfe: 'NF-e',
  cte: 'CT-e',
  cce: 'CC-e',
  planilha: 'Planilha',
  pdf: 'PDF',
  imap: 'E-mail',
  manual: 'Manual',
};

export const ROTULO_PARTE: Record<Parte, string> = {
  fornecedor: 'Fornecedor',
  transportadora: 'Transportadora',
  cd: 'CD',
  fiscal: 'Fiscal',
  financeiro: 'Financeiro',
};

export const ROTULO_CAMPO: Record<CampoVigiado, string> = {
  previsaoEntrega: 'Previsão de entrega',
  pesoTotal: 'Peso total',
  volumes: 'Volumes',
  status: 'Status',
};

const ROTULO_TIPO: Record<TipoEvento, string> = {
  nfe: 'NF-e',
  cte: 'CT-e',
  cce: 'CC-e',
  cancelamento: 'cancelamento',
  planilha: 'planilha',
  pdf: 'PDF',
  divergencia: 'divergência',
  tarefa: 'tarefa',
  ancora: 'âncora',
  revisao: 'revisão',
};

export const rotuloTipo = (tipo: TipoEvento): string => ROTULO_TIPO[tipo];

const ROTULO_STATUS: Record<string, string> = {
  emitida: 'Emitida',
  em_transito: 'Em trânsito',
  entregue: 'Entregue',
  atrasada: 'Atrasada',
  cancelada: 'Cancelada',
};

// O servidor guarda a data como AAAA-MM-DD; a tela mostra DD/MM/AAAA.
function formatarData(valor: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(valor);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : valor;
}

export function formatarValor(campo: CampoVigiado, valor: unknown): string {
  if (valor === undefined || valor === null) return '';
  switch (campo) {
    case 'previsaoEntrega':
      return formatarData(String(valor));
    case 'pesoTotal':
      return `${Number(valor).toLocaleString('pt-BR')} kg`;
    case 'status':
      return ROTULO_STATUS[String(valor)] ?? String(valor).replaceAll('_', ' ');
    default:
      return String(valor);
  }
}

export const chaveCurta = (id: string): string =>
  id.length > 14 ? `${id.slice(0, 4)}…${id.slice(-6)}` : id;

// O Postgres devolve "2026-11-21 01:29:59.1+00"; o Date pede "T" e o fuso com minutos.
export function formatarMomento(texto: string): string {
  const iso = (texto.includes('T') ? texto : texto.replace(' ', 'T')).replace(/([+-]\d{2})$/, '$1:00');
  const data = new Date(iso);
  if (Number.isNaN(data.getTime())) return texto;
  return data.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// "3126 1112 ..." em grupos de quatro, como a chave de acesso no documento fiscal.
export const chaveAgrupada = (id: string): string => (/^\d+$/.test(id) ? (id.match(/.{1,4}/g) ?? [id]).join(' ') : id);

const DIA_MS = 86_400_000;
const sinal = (n: number): string => (n > 0 ? '+' : '\u2212');

// Quanto o valor da célula se afasta da referência, em unidade humana. Sem variação
// para status (texto) nem para valores que não dá para subtrair.
export function variacao(campo: CampoVigiado, valor: unknown, referencia: unknown): string | null {
  if (valor === undefined || referencia === undefined) return null;
  if (campo === 'previsaoEntrega') {
    const a = Date.parse(`${String(valor).slice(0, 10)}T00:00:00Z`);
    const b = Date.parse(`${String(referencia).slice(0, 10)}T00:00:00Z`);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    const dias = Math.round((a - b) / DIA_MS);
    if (dias === 0) return null;
    return `${sinal(dias)}${Math.abs(dias)} ${Math.abs(dias) === 1 ? 'dia' : 'dias'}`;
  }
  if (campo === 'pesoTotal' || campo === 'volumes') {
    const dif = Number(valor) - Number(referencia);
    if (!Number.isFinite(dif) || dif === 0) return null;
    const num = Math.abs(dif).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    return `${sinal(dif)}${num}${campo === 'pesoTotal' ? ' kg' : ''}`;
  }
  return null;
}
