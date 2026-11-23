import type { ProjecaoPedido, RespostaAuditoria, ResultadoIngest } from '../../shared/model.ts';

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

export function enviarArquivo(arquivo: File): Promise<ResultadoIngest> {
  const form = new FormData();
  form.append('file', arquivo, arquivo.name);
  return pedirJson<ResultadoIngest>('/api/ingest', { method: 'POST', body: form });
}
