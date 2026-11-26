// Camada de dados da #/operacao: casos, métricas, cobranças e o link do
// comprovante. Mesmo contrato de erro do api.ts (ErroApi com status).

import type {
  Caso,
  Cobranca,
  Metricas,
  Parte,
  RespostaParceiroBody,
} from '../../../shared/model.ts';
import type { EstimativaCusto } from '../../../shared/custo.ts';
import { ErroApi } from '../api.ts';
import type { CasoLista, CobrancaLista } from './dominio.ts';

async function pedirJson<T>(caminho: string, init?: RequestInit): Promise<T> {
  let resposta: Response;
  try {
    resposta = await fetch(caminho, init);
  } catch {
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }
  if (!resposta.ok) {
    const corpo: unknown = await resposta.json().catch(() => null);
    const msg =
      (typeof (corpo as Record<string, unknown> | null)?.['mensagem'] === 'string' &&
        (corpo as Record<string, unknown>)['mensagem']) ||
      (typeof (corpo as Record<string, unknown> | null)?.['erro'] === 'string' &&
        (corpo as Record<string, unknown>)['erro']) ||
      `O servidor respondeu ${resposta.status}.`;
    throw new ErroApi(String(msg), resposta.status);
  }
  return (await resposta.json()) as T;
}

export const listarCasos = (): Promise<{ casos: CasoLista[] }> => pedirJson('/api/casos');

export interface CasoDetalhe {
  caso: Caso & { daSessao: boolean; tokenParceiro?: string };
  custo: EstimativaCusto;
  documentos: string[];
}

export const obterCaso = (id: string): Promise<CasoDetalhe> =>
  pedirJson(`/api/casos/${encodeURIComponent(id)}`);

function post<T>(caminho: string, corpo?: unknown): Promise<T> {
  return pedirJson<T>(caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo ?? {}),
  });
}

export const assumirCaso = (id: string, parte: Parte): Promise<{ ok: boolean }> =>
  post(`/api/casos/${encodeURIComponent(id)}/assumir`, { parte });

export const resolverCaso = (id: string, texto: string): Promise<{ ok: boolean }> =>
  post(`/api/casos/${encodeURIComponent(id)}/resolver`, { texto });

export const reabrirCaso = (id: string): Promise<{ ok: boolean }> =>
  post(`/api/casos/${encodeURIComponent(id)}/reabrir`);

// Resposta do parceiro pelo token do link (spec 0011): a tela da sessão
// dona também serve a demonstração — responde com o token visível.
export const responderComoParceiro = (
  id: string,
  corpo: RespostaParceiroBody,
): Promise<{ ok: boolean }> => post(`/api/casos/${encodeURIComponent(id)}/resposta`, corpo);

export const listarMetricas = (): Promise<{ metricas: Metricas }> => pedirJson('/api/metricas');

export const listarCobrancas = (): Promise<{ cobrancas: CobrancaLista[] }> =>
  pedirJson('/api/cobrancas');

export interface RespostaEnvioCobranca {
  ok?: boolean;
  erro?: string;
  cobranca?: Cobranca;
}

export const enviarCobranca = (id: number): Promise<RespostaEnvioCobranca> =>
  post(`/api/cobrancas/${id}/enviar`);

export const obterLinkComprovante = (pedidoId: string): Promise<{ url: string }> =>
  pedirJson(`/api/pedidos/${encodeURIComponent(pedidoId)}/comprovante`);
