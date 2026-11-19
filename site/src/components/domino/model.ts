// Domino island: one order, five systems. Pure functions, safe during SSR.
// Every number here is fictional; the panel says so on screen.

export interface Party {
  name: string;
  /** What this company's own system tracks for the order. */
  tracks: string;
  /** Planned time as absolute hour, SEG 00:00 = 0. */
  plan: number;
}

export type RowState = 'ok' | 'wrong' | 'synced';

export interface Row {
  shows: string; // what the company's own system says
  real: string; // what actually happened
  state: RowState;
}

export interface Model {
  rows: Row[];
  wrong: number;
  verdict: string;
}

export const PARTIES: Party[] = [
  { name: 'Fornecedor', tracks: 'Expedição', plan: 8 }, // SEG 08:00
  { name: 'Transportadora', tracks: 'Coleta', plan: 9 }, // SEG 09:00
  { name: 'Centro de distribuição', tracks: 'Doca reservada', plan: 33 }, // TER 09:00
  { name: 'Fiscal', tracks: 'Saída na nota fiscal', plan: 8 }, // SEG 08:00
  { name: 'Financeiro', tracks: 'Pagamento', plan: 40 }, // TER 16:00
];

const DIAS = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];

/** Absolute hour (SEG 00:00 = 0) as "TER 10:30". */
export function stamp(abs: number): string {
  const day = DIAS[(1 + Math.floor(abs / 24)) % 7];
  const rest = abs % 24;
  const h = Math.floor(rest);
  const m = Math.round((rest - h) * 60);
  return `${day} ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export function computeModel(h: number, layer: boolean): Model {
  const [forn, transp, cd, fiscal, fin] = PARTIES;
  const leaves = forn.plan + h;
  const arrives = cd.plan + h;

  if (h <= 0) {
    return {
      rows: PARTIES.map((p) => ({ shows: stamp(p.plan), real: 'Como planejado', state: 'ok' })),
      wrong: 0,
      verdict: 'Sem atraso, os cinco sistemas contam a mesma história.',
    };
  }

  if (layer) {
    const told = `Avisado ${stamp(forn.plan).slice(4)} pelo fornecedor`;
    const rows: Row[] = [
      { shows: stamp(leaves), real: 'Atraso registrado na origem', state: 'synced' },
      { shows: stamp(Math.max(transp.plan, leaves)), real: told, state: 'synced' },
      { shows: stamp(arrives), real: told, state: 'synced' },
      { shows: stamp(leaves), real: told, state: 'synced' },
      { shows: stamp(Math.max(fin.plan, arrives)), real: told, state: 'synced' },
    ];
    return { rows, wrong: 0, verdict: 'Os cinco sistemas mostram o mesmo pedido, atualizado no minuto do atraso.' };
  }

  const waits = leaves - transp.plan;
  const paidEarly = arrives > fin.plan;
  const rows: Row[] = [
    { shows: stamp(leaves), real: `Saiu ${h}h depois do plano`, state: 'ok' },
    { shows: stamp(transp.plan), real: waits > 0 ? `Caminhão parado ${waits}h na porta` : 'Coleta mantida', state: waits > 0 ? 'wrong' : 'ok' },
    { shows: stamp(cd.plan), real: `Doca vazia; a carga chega ${stamp(arrives)}`, state: 'wrong' },
    { shows: stamp(fiscal.plan), real: `Nota com saída errada; saiu ${stamp(leaves)}`, state: 'wrong' },
    paidEarly
      ? { shows: stamp(fin.plan), real: `Paga antes da carga chegar (${stamp(arrives)})`, state: 'wrong' }
      : { shows: stamp(fin.plan), real: 'A carga chega antes do pagamento', state: 'ok' },
  ];
  const wrong = rows.filter((r) => r.state === 'wrong').length;
  return {
    rows,
    wrong,
    verdict: `${wrong} de 5 sistemas mostram uma versão errada do mesmo pedido. Ninguém foi avisado.`,
  };
}
