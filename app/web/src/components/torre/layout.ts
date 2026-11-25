// Estado do tiling da torre (THE-18/THE-19): ordem, visibilidade e expansão dos
// cards persistem por pedido em localStorage com chave versionada; templates de
// vista são presets ou salvos pela pessoa. Tudo aqui é função pura ou I/O de
// borda (storage injetável) para ficar testável sem DOM.

export const CARD_IDS = [
  'matriz',
  'tarefas',
  'domino',
  'sinais',
  'cadeia',
  'simulador',
  'versoes',
] as const;

export type CardId = (typeof CARD_IDS)[number];

export interface LayoutTorre {
  ordem: CardId[];
  ocultos: CardId[];
  recolhidos: CardId[];
}

export interface VistaTemplate {
  id: string;
  nome: string;
  ordem: CardId[];
  custom?: boolean;
}

export interface StorageMinimo {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
  removeItem(chave: string): void;
}

export const LAYOUT_PADRAO: LayoutTorre = {
  ordem: [...CARD_IDS],
  ocultos: [],
  recolhidos: [],
};

// Templates prontos (THE-19): ordenam os cards visíveis e escondem o resto.
// Cards fora da lista ficam ocultos; quem reexibir cai no fim da ordem.
export const TEMPLATES_VISTA: readonly VistaTemplate[] = [
  { id: 'operacao', nome: 'Operação', ordem: [...CARD_IDS] },
  { id: 'atrasos', nome: 'Atrasos', ordem: ['matriz', 'domino', 'tarefas', 'sinais'] },
  { id: 'fiscal', nome: 'Fiscal', ordem: ['cadeia', 'matriz', 'sinais', 'versoes'] },
  { id: 'financeiro', nome: 'Financeiro', ordem: ['tarefas', 'sinais', 'cadeia'] },
  { id: 'despacho', nome: 'Despacho', ordem: ['domino', 'tarefas', 'simulador', 'sinais'] },
];

const ehCardId = (v: unknown): v is CardId =>
  typeof v === 'string' && (CARD_IDS as readonly string[]).includes(v);

// Dedup + anexa ids conhecidos que faltarem (versão nova do app pode criar card).
export function normalizarOrdem(ordem: readonly unknown[]): CardId[] {
  const vistos = new Set<CardId>();
  const saida: CardId[] = [];
  for (const item of ordem) {
    if (!ehCardId(item) || vistos.has(item)) continue;
    vistos.add(item);
    saida.push(item);
  }
  for (const id of CARD_IDS) {
    if (!vistos.has(id)) saida.push(id);
  }
  return saida;
}

const filtrarValidos = (lista: readonly unknown[]): CardId[] =>
  lista.filter(ehCardId).filter((v, i, a) => a.indexOf(v) === i);

export function normalizarLayout(raw: unknown): LayoutTorre {
  if (typeof raw !== 'object' || raw === null) return { ...LAYOUT_PADRAO };
  const parcial = raw as { ordem?: unknown; ocultos?: unknown; recolhidos?: unknown };
  const ocultos = Array.isArray(parcial.ocultos) ? filtrarValidos(parcial.ocultos) : [];
  return {
    ordem: normalizarOrdem(Array.isArray(parcial.ordem) ? parcial.ordem : []),
    ocultos,
    recolhidos: Array.isArray(parcial.recolhidos) ? filtrarValidos(parcial.recolhidos) : [],
  };
}

export function aplicarTemplate(template: VistaTemplate): Pick<LayoutTorre, 'ordem' | 'ocultos'> {
  // Sem normalizarOrdem aqui: o template decide o conjunto visível, e o resto
  // vai para ocultos (anexado ao fim da ordem, previsível ao reexibir).
  const visiveis = filtrarValidos(template.ordem);
  const noTemplate = new Set(visiveis);
  const ocultos = CARD_IDS.filter((id) => !noTemplate.has(id));
  return { ordem: [...visiveis, ...ocultos], ocultos: [...ocultos] };
}

// Reordena dentro da lista visível; cards ocultos ficam sempre ao final da ordem
// persistida para reaparecerem de forma previsível quando reexibidos.
export function inserirEm(ordem: readonly CardId[], id: CardId, destino: number): CardId[] {
  const sem = ordem.filter((c) => c !== id);
  const limite = Math.max(0, Math.min(sem.length, destino));
  return [...sem.slice(0, limite), id, ...sem.slice(limite)];
}

export function moverPorPasso(ordem: readonly CardId[], id: CardId, passo: number): CardId[] {
  const indice = ordem.indexOf(id);
  if (indice === -1) return [...ordem];
  return inserirEm(ordem, id, indice + passo);
}

export function assinaturaVista(ordem: readonly CardId[], ocultos: readonly CardId[]): string {
  const ocultosSet = new Set(ocultos);
  return `${ordem.filter((c) => !ocultosSet.has(c)).join('>')}|ocultos:${[...ocultos].sort().join(',')}`;
}

// Devolve o id do template (preset ou custom) que a vista atual reproduz, ou
// null quando a pessoa mexeu em ordem/visibilidade depois de aplicar.
export function templateCorrespondente(
  ordem: readonly CardId[],
  ocultos: readonly CardId[],
  templates: readonly VistaTemplate[],
): string | null {
  const atual = assinaturaVista(ordem, ocultos);
  for (const t of templates) {
    const aplicado = aplicarTemplate(t);
    if (assinaturaVista(aplicado.ordem, aplicado.ocultos) === atual) return t.id;
  }
  return null;
}

const CHAVE_PREFIXO = 'forseti:torre:v1';
export const chaveLayoutPedido = (pedidoId: string): string =>
  `${CHAVE_PREFIXO}:layout:${pedidoId}`;
export const CHAVE_TEMPLATES = `${CHAVE_PREFIXO}:templates`;

function storagePadrao(): StorageMinimo | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage : null;
  } catch {
    return null;
  }
}

export function lerLayoutPedido(
  pedidoId: string,
  storage: StorageMinimo | null = storagePadrao(),
): LayoutTorre | null {
  if (!storage) return null;
  try {
    const bruto = storage.getItem(chaveLayoutPedido(pedidoId));
    if (!bruto) return null;
    return normalizarLayout(JSON.parse(bruto));
  } catch {
    return null;
  }
}

export function guardarLayoutPedido(
  pedidoId: string,
  layout: LayoutTorre,
  storage: StorageMinimo | null = storagePadrao(),
): void {
  if (!storage) return;
  try {
    storage.setItem(chaveLayoutPedido(pedidoId), JSON.stringify(layout));
  } catch {
    // Quota ou modo privado: o tiling continua funcionando sem persistência.
  }
}

export function lerTemplatesCustom(
  storage: StorageMinimo | null = storagePadrao(),
): VistaTemplate[] {
  if (!storage) return [];
  try {
    const bruto = storage.getItem(CHAVE_TEMPLATES);
    if (!bruto) return [];
    const lista: unknown = JSON.parse(bruto);
    if (!Array.isArray(lista)) return [];
    const saida: VistaTemplate[] = [];
    for (const item of lista) {
      if (typeof item !== 'object' || item === null) continue;
      const t = item as { id?: unknown; nome?: unknown; ordem?: unknown };
      if (typeof t.id !== 'string' || typeof t.nome !== 'string' || !Array.isArray(t.ordem)) {
        continue;
      }
      saida.push({ id: t.id, nome: t.nome, ordem: normalizarOrdem(t.ordem), custom: true });
    }
    return saida;
  } catch {
    return [];
  }
}

export function guardarTemplatesCustom(
  templates: readonly VistaTemplate[],
  storage: StorageMinimo | null = storagePadrao(),
): void {
  if (!storage) return;
  try {
    storage.setItem(CHAVE_TEMPLATES, JSON.stringify(templates.filter((t) => t.custom)));
  } catch {
    // Mesma tolerância do layout: falha de escrita não derruba a torre.
  }
}
