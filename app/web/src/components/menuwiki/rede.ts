// Infra compartilhada de leitura (spec 0015, F2): useTorre e MenuWiki bebiam
// das mesmas rotas em donos separados e cada rajada de SSE refazia GETs
// identicos. Aqui fica o dedupe de promises em voo, o cache de projecao por
// revisao e as assinaturas baratas usadas para pular setState quando a
// resposta nao mudou. O desenho ideal (MenuWiki recebendo contatos/revisao por
// props do useTorre) exige mudar App.tsx, que e territorio de outra frente;
// ate la, este modulo e o dono unico dos GETs auxiliares.
import type {
  Contato,
  ItemRevisao,
  Pedido,
  ProjecaoPedido,
  RespostaAuditoria,
} from '../../../../shared/model.ts';
import { auditarPedido, listarPedidos, obterPedido, type PedidoResumo } from '../../api.ts';
import { listarContatos, listarRevisao } from '../../apiOps.ts';

const emVoo = new Map<string, Promise<unknown>>();
const recente = new Map<string, { ts: number; valor: unknown }>();

// Consumidor que chega ate ~1,5s depois da resposta reusa o valor: cobre o
// caso do efeito do MenuWiki rodar um tick apos o refetch do useTorre sem
// abrir uma janela de obsolescencia relevante (qualquer escrita local ou
// evento SSE passa por um GET novo que sobrescreve a entrada).
const JANELA_REUSO_MS = 1500;

function dedupeRecente<T>(chave: string, buscar: () => Promise<T>): Promise<T> {
  const guardado = recente.get(chave);
  if (guardado && Date.now() - guardado.ts < JANELA_REUSO_MS) {
    return Promise.resolve(guardado.valor as T);
  }
  const atual = emVoo.get(chave);
  if (atual) return atual as Promise<T>;
  const promessa = buscar()
    .then((valor) => {
      recente.set(chave, { ts: Date.now(), valor });
      return valor;
    })
    .finally(() => {
      emVoo.delete(chave);
    });
  emVoo.set(chave, promessa);
  return promessa;
}

export function buscarContatos(): Promise<Contato[]> {
  return dedupeRecente('contatos', listarContatos);
}

// Lista de pedidos: a remontagem do StrictMode e a rajada SSE chegam juntas;
// dedupe in-flight + janela curta colapsam o par de GETs em um so.
export function buscarPedidos(): Promise<PedidoResumo[]> {
  return dedupeRecente('pedidos', listarPedidos);
}

export function buscarRevisao(): Promise<{ itens: ItemRevisao[] }> {
  return dedupeRecente('revisao', listarRevisao);
}

// Projecao cacheada por revisao: o servidor so altera o pedido gravando
// evento, entao totalEventos igual significa conteudo igual.
const cacheProjecao = new Map<string, ProjecaoPedido>();
const LIMITE_PROJECOES = 16;

function guardarProjecao(p: ProjecaoPedido): void {
  const id = p.pedido?.id ?? '';
  if (!id) return;
  if (cacheProjecao.has(id)) cacheProjecao.delete(id);
  cacheProjecao.set(id, p);
  while (cacheProjecao.size > LIMITE_PROJECOES) {
    const maisAntiga = cacheProjecao.keys().next().value;
    if (maisAntiga === undefined) break;
    cacheProjecao.delete(maisAntiga);
  }
}

export function projecaoCacheada(
  id: string,
  totalEventos: number | undefined,
): ProjecaoPedido | undefined {
  if (totalEventos === undefined) return undefined;
  const entrada = cacheProjecao.get(id);
  return entrada && entrada.totalEventos === totalEventos ? entrada : undefined;
}

// Versoes do pedido para a secao Documentos do indice: hit no cache quando a
// lista ja diz quantos eventos o pedido tem; miss cai no GET dedupado.
export function buscarVersoesPedido(
  resumo: PedidoResumo,
): Promise<{ versoes: ProjecaoPedido['versoes']; pedido: Pedido | null }> {
  const hit = projecaoCacheada(resumo.pedidoId, resumo.totalEventos);
  if (hit) return Promise.resolve({ versoes: hit.versoes, pedido: hit.pedido });
  return buscarProjecao(resumo.pedidoId).then((p) => ({ versoes: p.versoes, pedido: p.pedido }));
}

export function buscarProjecao(id: string): Promise<ProjecaoPedido> {
  const atual = emVoo.get(`pedido:${id}`);
  if (atual) return atual as Promise<ProjecaoPedido>;
  const promessa = obterPedido(id)
    .then((p) => {
      guardarProjecao(p);
      return p;
    })
    .finally(() => {
      emVoo.delete(`pedido:${id}`);
    });
  emVoo.set(`pedido:${id}`, promessa);
  return promessa;
}

// Auditoria sem cache: cada verificacao vale como conferencia nova, mas dois
// chamadores simultaneos (carregarPedido + selo da cadeia) dividem o mesmo GET.
export function buscarAuditoria(id: string): Promise<RespostaAuditoria> {
  const atual = emVoo.get(`audit:${id}`);
  if (atual) return atual as Promise<RespostaAuditoria>;
  const promessa = auditarPedido(id)
    .finally(() => {
      emVoo.delete(`audit:${id}`);
    });
  emVoo.set(`audit:${id}`, promessa);
  return promessa;
}

// Hash FNV-1a de 32 bits: chave numerica estavel para string que muda raro
// (raiz Merkle) entrar na chave de pulso do shader sem estado extra.
export function hashCurto(texto: string): number {
  let h = 2166136261;
  for (let i = 0; i < texto.length; i += 1) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function assinaturaPedidos(lista: readonly PedidoResumo[]): string {
  return lista
    .map(
      (p) =>
        `${p.pedidoId}:${p.totalEventos}:${p.ultimoEm}:${p.status ?? ''}:${p.divergencias ?? ''}` +
        `:${p.tarefas ?? ''}:${p.atrasoDias ?? ''}:${p.daSessao ? 1 : 0}:${p.ancorado ? 1 : 0}` +
        `:${p.emitente ?? ''}:${p.destinatario ?? ''}`,
    )
    .join('|');
}

export function assinaturaContatos(lista: readonly Contato[]): string {
  return lista.map((c) => `${c.parte}:${c.canal}:${c.destino}:${c.nome}:${c.fonte}`).join('|');
}

export function assinaturaProjecao(p: ProjecaoPedido): string {
  return `${p.totalEventos}|${p.versoes.length}|${p.tarefas.length}|${p.divergencias.length}` +
    `|${p.sinais.length}|${p.notificacoes.length}`;
}

export function assinaturaAuditoria(a: RespostaAuditoria): string {
  return `${a.valida}|${a.total}|${a.indiceFalha ?? ''}|${a.rootAtual}`;
}

// Comparacao shallow de registros numericos (posicoes medidas do DOM): objeto
// novo com os mesmos numeros nao deve derrubar o bail-out do setState.
export function registroNumericoIgual(
  a: Readonly<Record<string, number>>,
  b: Readonly<Record<string, number>>,
): boolean {
  const chavesA = Object.keys(a);
  const chavesB = Object.keys(b);
  if (chavesA.length !== chavesB.length) return false;
  for (const k of chavesA) {
    if (a[k] !== b[k]) return false;
  }
  return true;
}
