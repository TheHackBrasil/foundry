// Logica pura do indice wiki do rail (spec 0014, THE-20): constroi os itens de
// cada secao a partir de dados reais (pedidos, agenda, versoes e fila de
// revisao), aplica o filtro local e le/grava o colapso das secoes. Resumo e
// selo saem de campos do contrato; quando o campo falta, a linha nao sai (A7).
import {
  FONTES_DOCUMENTO,
  PARTES,
  type Contato,
  type FonteDocumento,
  type ItemRevisao,
  type VersaoPedido,
} from '../../../../shared/model.ts';
import type { PedidoResumo } from '../../api.ts';
import {
  chaveCurta,
  formatarMomento,
  rotuloCanalContato,
  rotuloFonte,
  rotuloParte,
} from '../../format.ts';
import type { RotaTorre } from '../../useTorre.ts';

export type SecaoId = 'pedidos' | 'parceiros' | 'documentos' | 'regras';

export const SECOES_ORDEM: readonly SecaoId[] = ['pedidos', 'parceiros', 'documentos', 'regras'];

export const TITULO_SECAO: Record<SecaoId, string> = {
  pedidos: 'Pedidos',
  parceiros: 'Parceiros',
  documentos: 'Documentos',
  regras: 'Regras',
};

// Tons mapeiam para as classes rail-badge-* ja medidas em contraste sobre o
// monolito; 'sutil' e o unico tom novo (rail-soft) e vive em menuwiki.css.
export type SeloTom = 'ok' | 'warn' | 'coord' | 'erro' | 'sutil';

export interface SeloWiki {
  texto: string;
  tom: SeloTom;
  mono?: boolean;
}

export interface ItemWiki {
  id: string;
  titulo: string;
  resumo?: string;
  selo?: SeloWiki;
  href?: string;
  pedidoId?: string;
  tituloCompleto?: string;
}

export interface SecaoWiki {
  id: SecaoId;
  titulo: string;
  itens: ItemWiki[];
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

// Mesma precedencia do selo operacional da lista anterior: cancelada, atraso,
// desvios, confere. O tom 'coord' e a lavanda de coordenacao do brandbook.
export function seloPedido(p: PedidoResumo): SeloWiki {
  if (p.status === 'cancelada') {
    return { texto: 'Cancelada', tom: 'erro' };
  }
  if (typeof p.atrasoDias === 'number' && p.atrasoDias > 0) {
    return { texto: `+${p.atrasoDias}d`, tom: 'coord', mono: true };
  }
  const divs = p.divergencias ?? 0;
  if (divs > 0) {
    return { texto: plural(divs, 'desvio', 'desvios'), tom: 'coord', mono: true };
  }
  return { texto: 'Confere', tom: 'ok' };
}

export function hrefPedido(rota: RotaTorre, pedidoId: string): string {
  return rota === 'ia'
    ? `#/ia/${encodeURIComponent(pedidoId)}`
    : `#/pedido/${encodeURIComponent(pedidoId)}`;
}

export function itemPedido(p: PedidoResumo, rota: RotaTorre): ItemWiki {
  const emitente = p.emitente?.trim();
  const destinatario = p.destinatario?.trim();
  return {
    id: `pedido:${p.pedidoId}`,
    titulo: emitente ?? chaveCurta(p.pedidoId),
    tituloCompleto: emitente ? `${emitente} · ${p.pedidoId}` : p.pedidoId,
    resumo: destinatario ? `→ ${destinatario}` : formatarMomento(p.ultimoEm),
    selo: seloPedido(p),
    href: hrefPedido(rota, p.pedidoId),
    pedidoId: p.pedidoId,
  };
}

// Rotulos de fonte do contato, mesmos do DrawerAgenda.
const ROTULO_FONTE_CONTATO = new Map<Contato['fonte'], string>([
  ['manual', 'Manual'],
  ['documento', 'NF-e/CT-e'],
  ['seed', 'Exemplo'],
]);

export function itemContato(c: Contato): ItemWiki {
  const origem = ROTULO_FONTE_CONTATO.get(c.fonte) ?? c.fonte;
  return {
    id: `contato:${c.parte}:${c.destino}`,
    titulo: c.nome,
    tituloCompleto: `${c.nome} · ${rotuloParte(c.parte)} · ${rotuloCanalContato(c.canal)} · ${c.destino}`,
    resumo: `${rotuloParte(c.parte)} · ${rotuloCanalContato(c.canal)}`,
    // Contato de exemplo e dado ficticio: o selo diz isso em vez de esconder.
    selo: c.fonte === 'seed' ? { texto: origem, tom: 'sutil' } : undefined,
  };
}

export function itensContatos(contatos: readonly Contato[]): ItemWiki[] {
  const ordem = new Map<Contato['parte'], number>(PARTES.map((p, i) => [p, i]));
  return [...contatos]
    .sort((a, b) => (ordem.get(a.parte) ?? PARTES.length) - (ordem.get(b.parte) ?? PARTES.length))
    .map(itemContato);
}

// Uma versao da projecao equivale a um documento recebido (RF18): e o
// inventario real de documentos por pedido.
export function itemDocumento(
  v: VersaoPedido,
  emitente: string | null,
  rota: RotaTorre,
): ItemWiki {
  const fonte = rotuloFonte(v.fonte);
  return {
    id: `doc:${v.pedidoId}:${v.versao}`,
    titulo: emitente ? `${fonte} · ${emitente}` : fonte,
    tituloCompleto: `${fonte} · ${v.pedidoId}`,
    resumo: `${formatarMomento(v.geradaEm)} · ${chaveCurta(v.pedidoId)}`,
    href: hrefPedido(rota, v.pedidoId),
    pedidoId: v.pedidoId,
  };
}

export function itensDocumentos(
  entradas: readonly { pedido: PedidoResumo; versoes: readonly VersaoPedido[] }[],
  rota: RotaTorre,
  limite = 20,
): ItemWiki[] {
  return entradas
    .flatMap(({ pedido, versoes }) =>
      versoes.map((v) => ({ v, emitente: pedido.emitente?.trim() || null })),
    )
    .sort((a, b) => b.v.geradaEm.localeCompare(a.v.geradaEm))
    .slice(0, limite)
    .map(({ v, emitente }) => itemDocumento(v, emitente, rota));
}

const FONTES_SET = new Set<string>(FONTES_DOCUMENTO);

function rotuloOrigem(origem: string): string {
  return FONTES_SET.has(origem) ? rotuloFonte(origem as FonteDocumento) : origem;
}

// Palavras iguais as do DrawerRevisao: Pendente, Aprovado, Descartado.
const SELO_STATUS_REVISAO: Record<ItemRevisao['status'], SeloWiki> = {
  pendente: { texto: 'Pendente', tom: 'warn' },
  aprovado: { texto: 'Aprovado', tom: 'ok' },
  descartado: { texto: 'Descartado', tom: 'sutil' },
};

function lerString(obj: Record<string, unknown>, chave: string): string | null {
  const v = obj[chave];
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

// So entra item com proposta: e o mapeamento coluna -> campo que a fila ja
// viu. Item sem proposta e triagem de ingest, nao regra.
export function itemRegra(item: ItemRevisao): ItemWiki | null {
  if (!item.proposta) return null;
  const colunas = Object.keys(item.proposta.mapeamento).length;
  const arquivo = lerString(item.payload ?? {}, 'arquivo');
  return {
    id: `regra:${item.id}`,
    titulo: arquivo ?? `Mapeamento ${rotuloOrigem(item.origem)}`,
    tituloCompleto: `Item de revisão #${item.id}`,
    resumo: `${plural(colunas, 'coluna', 'colunas')} · ${formatarMomento(item.ts)}`,
    selo: SELO_STATUS_REVISAO[item.status],
  };
}

const ORDEM_STATUS: Record<ItemRevisao['status'], number> = {
  pendente: 0,
  aprovado: 1,
  descartado: 2,
};

export function itensRegras(itens: readonly ItemRevisao[], limite = 10): ItemWiki[] {
  return [...itens]
    .sort((a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] || b.id - a.id)
    .map(itemRegra)
    .filter((i): i is ItemWiki => i !== null)
    .slice(0, limite);
}

// Filtro local: compara com titulo, resumo e texto do selo, sem acento e sem
// caixa. Digitar "desvio" ou "cancelada" reproduce o recorte do antigo botao
// Conflitos dentro da busca unica.
export function normalizarConsulta(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .trim();
}

export function filtrarSecoes(secoes: readonly SecaoWiki[], consulta: string): SecaoWiki[] {
  const q = normalizarConsulta(consulta);
  if (!q) return [...secoes];
  return secoes
    .map((sec) => ({
      ...sec,
      itens: sec.itens.filter((item) =>
        normalizarConsulta(`${item.titulo} ${item.resumo ?? ''} ${item.selo?.texto ?? ''}`).includes(q),
      ),
    }))
    .filter((sec) => sec.itens.length > 0);
}

// Colapso por secao persistido em chave versionada (D-M6).
export const CHAVE_COLAPSO = 'forseti:menuwiki:v1';

export type Colapso = Record<SecaoId, boolean>;

export function colapsoInicial(): Colapso {
  return { pedidos: true, parceiros: true, documentos: true, regras: true };
}

export function lerColapso(bruto: string | null | undefined): Colapso {
  const base = colapsoInicial();
  if (!bruto) return base;
  try {
    const dado: unknown = JSON.parse(bruto);
    if (typeof dado !== 'object' || dado === null) return base;
    const salvas = (dado as Record<string, unknown>)['abertas'];
    if (typeof salvas !== 'object' || salvas === null) return base;
    for (const id of SECOES_ORDEM) {
      const v = (salvas as Record<string, unknown>)[id];
      if (typeof v === 'boolean') base[id] = v;
    }
    return base;
  } catch {
    return base;
  }
}

export function serializarColapso(abertas: Colapso): string {
  return JSON.stringify({ v: 1, abertas });
}
