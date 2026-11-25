import type {
  AcaoMandato,
  CampoVigiado,
  CanalContato,
  FonteDocumento,
  Notificacao,
  Parte,
  TipoSinal,
} from '../../shared/model.ts';

// Rotulos em Map: a chave vem do ledger (qualquer texto pode chegar) e um
// objeto literal resolveria nomes de Object.prototype como "constructor".
const ROTULO_FONTE = new Map<string, string>(
  Object.entries({
    nfe: 'NF-e',
    cte: 'CT-e',
    cce: 'CC-e',
    planilha: 'Planilha',
    pdf: 'PDF',
    imap: 'E-mail',
    manual: 'Manual',
  } satisfies Record<FonteDocumento, string>),
);

const ROTULO_PARTE = new Map<string, string>(
  Object.entries({
    fornecedor: 'Fornecedor',
    transportadora: 'Transportadora',
    cd: 'CD',
    fiscal: 'Fiscal',
    financeiro: 'Financeiro',
  } satisfies Record<Parte, string>),
);

const ROTULO_CAMPO = new Map<string, string>(
  Object.entries({
    previsaoEntrega: 'Previsão de entrega',
    pesoTotal: 'Peso total',
    volumes: 'Volumes',
    status: 'Status',
  } satisfies Record<CampoVigiado, string>),
);

const ROTULO_STATUS = new Map<string, string>(
  Object.entries({
    emitida: 'Emitida',
    em_transito: 'Em trânsito',
    entregue: 'Entregue',
    atrasada: 'Atrasada',
    cancelada: 'Cancelada',
  }),
);

const ROTULO_ACAO = new Map<string, string>(
  Object.entries({
    propagar: 'Propagação',
    simular: 'Simulação',
    resumir: 'Resumo',
    notificar: 'Aviso',
  } satisfies Record<AcaoMandato, string>),
);

const ROTULO_SINAL = new Map<string, string>(
  Object.entries({
    atraso_avisado: 'Atraso avisado',
    reagendamento: 'Reagendamento',
    instrucao: 'Instrução',
    outro: 'Outro sinal',
  } satisfies Record<TipoSinal, string>),
);

const ROTULO_CANAL = new Map<string, string>(
  Object.entries({
    whatsapp: 'WhatsApp',
    sms: 'SMS',
    ligacao: 'Ligação',
    email: 'E-mail',
    webhook: 'Webhook',
  } satisfies Record<CanalContato, string>),
);

const ROTULO_MOTIVO_NOTIFICACAO = new Map<string, string>(
  Object.entries({
    desligado: 'Envio automático desligado nesta instalação',
    sem_parte: 'Parte destinatária não identificada',
    sem_tarefa: 'Nenhuma tarefa aberta para esta parte',
    sem_contato: 'Sem contato cadastrado para esta parte',
    canal_incompativel: 'Canal cadastrado incompatível com o provedor',
    falha_envio: 'Falha na entrega pelo provedor',
  } satisfies Record<NonNullable<Notificacao['motivo']>, string>),
);

// Valor fora da lista conhecida renderiza como veio. Snake_case legitimo
// (palavra_palavra) vira espaco; qualquer forma estranha fica crua, senao
// "__proto__" viraria " proto ".
const textoCru = (valor: unknown): string => {
  const s = String(valor);
  return /^[A-Za-z0-9]+(_[A-Za-z0-9]+)+$/.test(s) ? s.replaceAll('_', ' ') : s;
};

export const rotuloFonte = (fonte: FonteDocumento): string => ROTULO_FONTE.get(fonte) ?? String(fonte);
export const rotuloParte = (parte: Parte): string => ROTULO_PARTE.get(parte) ?? String(parte);
export const rotuloCampo = (campo: CampoVigiado): string => ROTULO_CAMPO.get(campo) ?? String(campo);
export const rotuloAcaoMandato = (acao: AcaoMandato): string => ROTULO_ACAO.get(acao) ?? String(acao);
export const rotuloTipoSinal = (tipo: TipoSinal): string => ROTULO_SINAL.get(tipo) ?? textoCru(tipo);
export const rotuloCanalContato = (canal: CanalContato): string => ROTULO_CANAL.get(canal) ?? String(canal);
export const rotuloMotivoNotificacao = (motivo: NonNullable<Notificacao['motivo']>): string =>
  ROTULO_MOTIVO_NOTIFICACAO.get(motivo) ?? textoCru(motivo);

export function formatarConfianca(valor: number): string {
  if (!Number.isFinite(valor)) return '0%';
  const pct = Math.round(Math.min(1, Math.max(0, valor)) * 100);
  return `${pct}%`;
}

// Formatadores Intl custam ~microssegundos por instancia; criados por celula
// viravam custo de render. Uma instancia por opcao, reutilizada para sempre.
const FMT_NUMERO = new Intl.NumberFormat('pt-BR');
const FMT_NUMERO_2CASAS = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });
const FMT_MOMENTO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const FMT_MOMENTO_COMPLETO = new Intl.DateTimeFormat('pt-BR', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
});

export const numeroPtBR = (n: number): string => FMT_NUMERO.format(n);

export function formatarDuracao(segundos: number): string {
  const seguro = Number.isFinite(segundos) ? Math.max(0, Math.floor(segundos)) : 0;
  const min = Math.floor(seguro / 60);
  const seg = seguro % 60;
  return `${String(min).padStart(2, '0')}:${String(seg).padStart(2, '0')}`;
}

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
      return `${numeroPtBR(Number(valor))} kg`;
    case 'status':
      return ROTULO_STATUS.get(String(valor)) ?? textoCru(valor);
    default:
      return String(valor);
  }
}

export const chaveCurta = (id: string): string =>
  id.length > 14 ? `${id.slice(0, 4)}…${id.slice(-6)}` : id;

// O Postgres devolve "2026-11-21 01:29:59.1+00"; o Date pede "T" e o fuso com minutos.
function parseMomento(texto: string): Date | null {
  const iso = (texto.includes('T') ? texto : texto.replace(' ', 'T')).replace(/([+-]\d{2})$/, '$1:00');
  const data = new Date(iso);
  return Number.isNaN(data.getTime()) ? null : data;
}

export function formatarMomento(texto: string): string {
  const data = parseMomento(texto);
  if (!data) return texto;
  return FMT_MOMENTO.format(data).replace(/,\s*/, ' ');
}

// Variante com ano para title/tooltip: a celula da matriz mostra "25/11 16:44"
// em uma linha e o completo fica a um hover de distancia (F8 da spec 0015).
export function formatarMomentoCompleto(texto: string): string {
  const data = parseMomento(texto);
  if (!data) return texto;
  return FMT_MOMENTO_COMPLETO.format(data).replace(/,\s*/, ' ');
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
    const num = FMT_NUMERO_2CASAS.format(Math.abs(dif));
    return `${sinal(dif)}${num}${campo === 'pesoTotal' ? ' kg' : ''}`;
  }
  return null;
}
