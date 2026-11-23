import type {
  Parte,
  ProjecaoPedido,
  RespostaAuditoria,
  RespostaMandato,
  ResultadoIngest,
  ViewSpec,
} from '../../shared/model.ts';

// A resposta de GET /api/pedidos não tem tipo em shared/model.ts; fica aqui
// até a app-infra promover o tipo.
export interface PedidoResumo {
  pedidoId: string;
  totalEventos: number;
  criadoEm: string;
  ultimoEm: string;
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
  return (await pedirJson<{ pedidos: PedidoResumo[] }>('/api/pedidos')).pedidos;
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

export async function enviarMandato(texto: string): Promise<RespostaMandato> {
  let resposta: Response;
  try {
    resposta = await fetch('/api/mandatos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ texto }),
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

const EXEMPLOS_SESSAO = [
  { arquivo: 'nfe-ok.xml', tipo: 'application/xml' },
  { arquivo: 'cte-ok.xml', tipo: 'application/xml' },
  { arquivo: 'planilha.csv', tipo: 'text/csv' },
] as const;

// Ingestao real dos exemplos ficticios na sessao do visitante, em ordem: a NF-e
// cria o pedido e os arquivos seguintes anexam divergencias ao mesmo ledger.
export async function carregarExemplosNaSessao(): Promise<{
  pedidoId: string | null;
  enviados: number;
  falhas: string[];
}> {
  let pedidoId: string | null = null;
  let enviados = 0;
  const falhas: string[] = [];

  for (const item of EXEMPLOS_SESSAO) {
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
