import type {
  Parte,
  ProjecaoPedido,
  RespostaAuditoria,
  RespostaMandato,
  ResultadoIngest,
  ViewSpec,
} from '../../shared/model.ts';

// Resumo enriquecido de GET /api/pedidos (compatível com ResumoPedidoLista de shared/model.ts).
export interface PedidoResumo {
  pedidoId: string;
  workspaceId?: string;
  totalEventos: number;
  criadoEm: string;
  ultimoEm: string;
  daSessao?: boolean;
  emitente?: string | null;
  destinatario?: string | null;
  status?: string | null;
  previsaoEntrega?: string | null;
  atrasoDias?: number | null;
  divergencias?: number;
  tarefas?: number;
  ancorado?: boolean;
}

const PEDIDO_KRONA = '35260211222333000181550010000048211000004821';
const PEDIDO_PACKSUL = '35260244555666000192550010000073101000007310';

// Prioriza pedidos da sessão do visitante no topo e, entre os exemplos da seed,
// abre primeiro o caso realista com divergências abertas (Krona Eletrônicos).
export function ordenarPedidosOperacionais(lista: readonly PedidoResumo[]): PedidoResumo[] {
  return [...lista].sort((a, b) => {
    const sessaoDif = Number(Boolean(b.daSessao)) - Number(Boolean(a.daSessao));
    if (sessaoDif !== 0) return sessaoDif;
    const kronaDif = Number(b.pedidoId === PEDIDO_KRONA) - Number(a.pedidoId === PEDIDO_KRONA);
    if (kronaDif !== 0) return kronaDif;
    const divDif = (b.divergencias ?? 0) - (a.divergencias ?? 0);
    if (divDif !== 0) return divDif;
    return b.ultimoEm.localeCompare(a.ultimoEm);
  });
}

// Quando o visitante sobe o mesmo pedido da seed na propria sessao, /api/pedidos
// devolve as duas entradas: priorizamos a da sessao para nao duplicar na barra.
export function deduplicarPedidos(
  lista: readonly PedidoResumo[],
  workspace?: string,
): PedidoResumo[] {
  const mapa = new Map<string, PedidoResumo>();
  for (const item of lista) {
    const daSessao = Boolean(workspace && item.workspaceId === workspace);
    const enriquecido: PedidoResumo = { ...item, daSessao };
    const existente = mapa.get(item.pedidoId);
    if (!existente) {
      mapa.set(item.pedidoId, enriquecido);
    } else if (daSessao && !existente.daSessao) {
      mapa.set(item.pedidoId, enriquecido);
    }
  }
  return [...mapa.values()];
}

export class ErroApi extends Error {
  readonly status: number;

  constructor(mensagem: string, status: number) {
    super(mensagem);
    this.name = 'ErroApi';
    this.status = status;
  }
}

export class ErroMandatoApi extends ErroApi {
  readonly motivo?: string;

  constructor(mensagem: string, status: number, motivo?: string) {
    super(mensagem, status);
    this.name = 'ErroMandatoApi';
    if (motivo !== undefined) this.motivo = motivo;
  }
}

const CODIGOS_CRUS = new Set(['invalido', 'indisponivel']);

function fallbackMandato(status: number): string {
  switch (status) {
    case 503:
      return 'Serviço de IA indisponível nesta instalação. O restante da torre funciona normalmente.';
    case 429:
      return 'Muitos comandos seguidos a partir deste endereço. Tente de novo em alguns minutos.';
    case 422:
      return 'Não foi possível interpretar o comando. Reformule ou seja mais específico.';
    case 403:
      return 'Os pedidos de exemplo são somente leitura. Envie arquivos na sua sessão para comandar.';
    case 400:
      return 'Digite um comando em português para continuar.';
    default:
      return `O servidor respondeu ${status}.`;
  }
}

// 422 e 503 mandam a frase pt-BR em corpo.mensagem (e um codigo curto em
// corpo.erro); 400, 403, 429 e 507 vem de ErroRequisicao e usam corpo.erro.
export function extrairMensagemErroMandato(
  status: number,
  corpo: unknown,
): { mensagem: string; motivo?: string } {
  const obj =
    typeof corpo === 'object' && corpo !== null && !Array.isArray(corpo)
      ? (corpo as Record<string, unknown>)
      : null;
  const motivo = typeof obj?.['motivo'] === 'string' && obj['motivo'].trim() ? obj['motivo'].trim() : undefined;
  const mensagemApi = typeof obj?.['mensagem'] === 'string' ? obj['mensagem'].trim() : '';
  if (mensagemApi) return motivo ? { mensagem: mensagemApi, motivo } : { mensagem: mensagemApi };

  const erroApi = typeof obj?.['erro'] === 'string' ? obj['erro'].trim() : '';
  if (erroApi && !CODIGOS_CRUS.has(erroApi)) {
    return motivo ? { mensagem: erroApi, motivo } : { mensagem: erroApi };
  }
  const fallback = fallbackMandato(status);
  return motivo ? { mensagem: fallback, motivo } : { mensagem: fallback };
}

async function pedirJson<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, init);
  } catch {
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }
  if (!resposta.ok) {
    const corpo = (await resposta.json().catch(() => null)) as { erro?: string } | null;
    throw new ErroApi(corpo?.erro ?? `O servidor respondeu ${resposta.status}.`, resposta.status);
  }
  return (await resposta.json()) as T;
}

export async function listarPedidos(): Promise<PedidoResumo[]> {
  const r = await pedirJson<{ pedidos: PedidoResumo[]; workspace?: string }>('/api/pedidos');
  return ordenarPedidosOperacionais(deduplicarPedidos(r.pedidos, r.workspace));
}

export const obterPedido = (id: string): Promise<ProjecaoPedido> =>
  pedirJson<ProjecaoPedido>(`/api/pedidos/${encodeURIComponent(id)}`);

export const auditarPedido = (id: string): Promise<RespostaAuditoria> =>
  pedirJson<RespostaAuditoria>(`/api/pedidos/${encodeURIComponent(id)}/audit`);

export const obterViewSpec = (
  pedidoId: string,
  papel: Parte,
  signal?: AbortSignal,
): Promise<ViewSpec> =>
  pedirJson<ViewSpec>(
    `/api/pedidos/${encodeURIComponent(pedidoId)}/view-spec?papel=${encodeURIComponent(papel)}`,
    signal ? { signal } : undefined,
  );

export async function enviarMandato(texto: string, pedidoId?: string): Promise<RespostaMandato> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/mandatos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pedidoId ? { texto, pedidoId } : { texto }),
    });
  } catch {
    throw new ErroMandatoApi('Sem conexão com o servidor.', 0);
  }
  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    const { mensagem, motivo } = extrairMensagemErroMandato(resposta.status, corpo);
    throw new ErroMandatoApi(mensagem, resposta.status, motivo);
  }
  return (await resposta.json()) as RespostaMandato;
}

export function enviarArquivo(arquivo: File): Promise<ResultadoIngest> {
  const form = new FormData();
  form.append('file', arquivo, arquivo.name);
  return pedirJson<ResultadoIngest>('/api/ingest', { method: 'POST', body: form });
}

interface ArquivoExemploSpec {
  readonly arquivo: string;
  readonly tipo: string;
}

const EXEMPLOS_SESSAO: readonly ArquivoExemploSpec[] = [
  { arquivo: 'nfe-ok.xml', tipo: 'application/xml' },
  { arquivo: 'cte-ok.xml', tipo: 'application/xml' },
  { arquivo: 'planilha.csv', tipo: 'text/csv' },
];

const EXEMPLOS_POR_PEDIDO: Readonly<Record<string, readonly ArquivoExemploSpec[]>> = {
  [PEDIDO_KRONA]: [
    { arquivo: 'krona-01-nfe.xml', tipo: 'application/xml' },
    { arquivo: 'krona-02-cte.xml', tipo: 'application/xml' },
    { arquivo: 'krona-03-planilha.csv', tipo: 'text/csv' },
  ],
  [PEDIDO_PACKSUL]: [
    { arquivo: 'packsull-01-nfe.xml', tipo: 'application/xml' },
    { arquivo: 'packsull-02-planilha.csv', tipo: 'text/csv' },
  ],
};

// Ingestao real dos exemplos ficticios na sessao do visitante, em ordem: a NF-e
// cria o pedido e os arquivos seguintes anexam divergencias ao mesmo ledger.
async function carregarConjuntoNaSessao(conjunto: readonly ArquivoExemploSpec[]): Promise<{
  pedidoId: string | null;
  enviados: number;
  falhas: string[];
}> {
  let pedidoId: string | null = null;
  let enviados = 0;
  const falhas: string[] = [];

  for (const item of conjunto) {
    try {
      const resp = await fetch(`/exemplos/${item.arquivo}`);
      if (!resp.ok) {
        falhas.push(`${item.arquivo}: exemplo indisponível (${resp.status}).`);
        continue;
      }
      const blob = await resp.blob();
      const arquivo = new File([blob], item.arquivo, { type: item.tipo });
      const r = await enviarArquivo(arquivo);
      enviados += 1;
      if (r.pedidoId) pedidoId = r.pedidoId;
    } catch (e) {
      falhas.push(`${item.arquivo}: ${e instanceof Error ? e.message : 'falhou.'}`);
    }
  }
  return { pedidoId, enviados, falhas };
}

export function carregarExemplosNaSessao(): Promise<{
  pedidoId: string | null;
  enviados: number;
  falhas: string[];
}> {
  return carregarConjuntoNaSessao(EXEMPLOS_SESSAO);
}

// Copia silenciosamente o mesmo pedido da seed para a sessão isolada do visitante
// antes de ações de escrita (notificar, propagar, aplicar hipótese, ancorar).
export function autoForkPedidoNaSessao(pedidoId?: string | null): Promise<{
  pedidoId: string | null;
  enviados: number;
  falhas: string[];
}> {
  const conjunto = (pedidoId ? EXEMPLOS_POR_PEDIDO[pedidoId] : undefined) ?? EXEMPLOS_POR_PEDIDO[PEDIDO_KRONA] ?? EXEMPLOS_SESSAO;
  return carregarConjuntoNaSessao(conjunto);
}
