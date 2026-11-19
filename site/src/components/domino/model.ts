// Domino island — propagation model (specs/0002, brief-domino).
// Pure functions: no DOM access, safe to run during SSR.

export type Scenario = 'bare' | 'layer'; // 01 sem camada / 02 com camada

export interface NodeDef {
  name: string;
  role: string;
  /** Absolute hour anchored on SEG (Monday) 00:00. */
  base: number;
}

export interface NodeState {
  status: string;
  /** Whether a recomputed timestamp is shown next to the base one. */
  shifted: boolean;
  /** Absolute hour of the recomputed timestamp. */
  abs: number;
  cls: '' | 'hit' | 'absorbed';
}

export type VerdictTone = 'neutral' | 'bad' | 'ok';

export interface Model {
  nodes: NodeState[];
  tone: VerdictTone;
  mark: string;
  main: string;
  sub: string;
}

export const NODES: NodeDef[] = [
  { name: 'FORNECEDOR', role: 'expedição do pedido', base: 8 }, // SEG 08:00
  { name: 'TRANSPORTADORA', role: 'coleta', base: 14 }, // SEG 14:00
  { name: 'CENTRO DE DISTRIBUIÇÃO', role: 'janela de doca', base: 33 }, // TER 09:00
  { name: 'FISCAL', role: 'NF e documentos', base: 34.5 }, // TER 10:30
  { name: 'FINANCEIRO', role: 'pagamento programado', base: 40 }, // TER 16:00
];

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB']; // getDay order

/** Formats an absolute hour (SEG 00:00 = 0) as "TER 10:30". */
export function stamp(abs: number): string {
  const day = DIAS[(1 + Math.floor(abs / 24)) % 7];
  const rest = abs % 24;
  const h = Math.floor(rest);
  const m = Math.round((rest - h) * 60);
  return `${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeModel(h: number, layer: boolean): Model {
  if (h <= 0) {
    return {
      nodes: NODES.map(() => ({ status: 'no trilho', shifted: false, abs: 0, cls: '' })),
      tone: 'neutral',
      mark: '●',
      main: 'OPERAÇÃO NO TRILHO',
      sub: 'Nenhum desvio registrado na simulação.',
    };
  }

  if (!layer) {
    const docBlocked = h >= 24;
    const payCut = h >= 48;
    // CD pays the delay plus 6h of dock queue once the slip passes a day.
    const shifts = [h, h, h + (docBlocked ? 6 : 0), h, h];
    const statuses = [
      'atraso registrado na expedição',
      'coleta remarcada',
      docBlocked ? 'doca remarcada · fila de espera +6h' : 'doca remarcada',
      docBlocked ? 'doc bloqueado · NF sem emissão' : 'NF reagendada',
      payCut ? 'pagamento cancelado' : 'contrato em revalidação',
    ];
    const gone = [false, false, false, docBlocked, payCut];
    return {
      nodes: NODES.map((n, i) => ({
        status: statuses[i],
        shifted: !gone[i],
        abs: n.base + shifts[i],
        cls: 'hit',
      })),
      tone: 'bad',
      mark: '✕',
      main:
        '4 REAGENDAMENTOS' +
        (docBlocked ? ' · 1 DOC BLOQUEADO' : '') +
        (payCut ? ' · PAGTO CANCELADO' : ''),
      sub: 'Ninguém foi avisado. Cada sistema descobriu sozinho.',
    };
  }

  // Com camada: o atraso na origem é real; a propagação é amortecida.
  const damped = Math.round(h * 0.4);
  const shifts = [h, damped, damped, damped, damped];
  const statuses = [
    'atraso registrado · alerta emitido',
    'coleta remarcada cedo',
    'doca realocada em tempo',
    'NF emitida na nova data',
    'pagamento reagendado',
  ];
  return {
    nodes: NODES.map((n, i) => ({
      status: statuses[i],
      shifted: true,
      abs: n.base + shifts[i],
      cls: i === 0 ? 'hit' : 'absorbed',
    })),
    tone: 'ok',
    mark: '✓',
    main: '4 AVISOS ANTECIPADOS · 0 CANCELAMENTOS',
    sub: 'O alerta saiu da origem antes do efeito chegar nas pontas.',
  };
}
