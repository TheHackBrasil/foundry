// Camada de dados da #/operacao: casos, métricas, cobranças e o link do
// comprovante. Mesmo contrato de erro do api.ts (ErroApi com status).

import type {
  Caso,
  Cobranca,
  Metricas,
  Parte,
  RespostaParceiroBody,
} from '../../../shared/model.ts';
import type { ItemLinhaTempo, PlanoContatoProjetado } from '../../../shared/casos.ts';
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

// ---------------------------------------------------------------------------
// Operador (spec 0017, T752 e T771): planos de contato, linha do tempo do
// caso, evidência por hash e as decisões do analista. Aprovar, ajustar e
// recusar levam a credencial de aprovador no cabeçalho Authorization; o
// cookie da sessão não basta (RF11). O token chega por parâmetro e nunca é
// gravado em armazenamento do navegador.

export type { ItemLinhaTempo, PlanoContatoProjetado };

// A rota pode devolver o array puro ou embrulhado; aceita os dois.
function listaDe<T>(corpo: unknown, chaves: readonly string[]): T[] {
  if (Array.isArray(corpo)) return corpo as T[];
  if (corpo && typeof corpo === 'object') {
    for (const k of chaves) {
      const v = (corpo as Record<string, unknown>)[k];
      if (Array.isArray(v)) return v as T[];
    }
  }
  return [];
}

const rotaCaso = (casoId: string): string => `/api/casos/${encodeURIComponent(casoId)}`;

export async function listarPlanos(casoId: string): Promise<PlanoContatoProjetado[]> {
  const corpo = await pedirJson<unknown>(`${rotaCaso(casoId)}/planos`);
  return listaDe<PlanoContatoProjetado>(corpo, ['planos']);
}

export async function obterLinhaTempo(casoId: string): Promise<ItemLinhaTempo[]> {
  const corpo = await pedirJson<unknown>(`${rotaCaso(casoId)}/linha-tempo`);
  return listaDe<ItemLinhaTempo>(corpo, ['itens', 'linhaTempo', 'linha']);
}

export const urlEvidencia = (casoId: string, hash: string): string =>
  `${rotaCaso(casoId)}/evidencias/${encodeURIComponent(hash)}`;

export interface EvidenciaBaixada {
  tipoConteudo: string; // media type sem parâmetros, em minúsculas
  blob: Blob;
}

export async function obterEvidencia(casoId: string, hash: string): Promise<EvidenciaBaixada> {
  let resposta: Response;
  try {
    resposta = await fetch(urlEvidencia(casoId, hash));
  } catch {
    throw new ErroApi('Sem conexão com o servidor.', 0);
  }
  if (!resposta.ok) {
    throw new ErroApi(
      resposta.status === 404
        ? 'Evidência não encontrada. Ela pode ter passado do prazo de retenção.'
        : `O servidor respondeu ${resposta.status}.`,
      resposta.status,
    );
  }
  const tipoConteudo = (resposta.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  return { tipoConteudo, blob: await resposta.blob() };
}

function postAprovador<T>(caminho: string, token: string, corpo: unknown): Promise<T> {
  return pedirJson<T>(caminho, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo),
  });
}

const rotaPlano = (planoId: string): string => `/api/planos/${encodeURIComponent(planoId)}`;

export type CamposRoteiro = Record<string, string | number | boolean>;

export const aprovarPlano = (
  planoId: string,
  token: string,
  corpo: { versao: number; hashRoteiro: string },
): Promise<unknown> => postAprovador(`${rotaPlano(planoId)}/aprovar`, token, corpo);

export const recusarPlano = (
  planoId: string,
  token: string,
  corpo: { versao: number; motivo: string },
): Promise<unknown> => postAprovador(`${rotaPlano(planoId)}/recusar`, token, corpo);

export const ajustarPlano = (
  planoId: string,
  token: string,
  corpo: { versao: number; campos: CamposRoteiro },
): Promise<unknown> => postAprovador(`${rotaPlano(planoId)}/ajustar`, token, corpo);

// US3: abre a escada do operador num caso de divergência. 409 = já acionado.
export const acionarOperador = (casoId: string): Promise<unknown> => post(`${rotaCaso(casoId)}/acionar`);

// --- Backoffice (/#/admin, spec 0017) ---

export interface AjustesAdmin {
  prazoEmailMin: number;
  prazoWhatsappMin: number;
  validadeAprovacaoMin: number;
  tentativasDia: number;
  tetoCasoBrl: number;
  tetoDiaBrl: number;
  janelaInicio: number;
  janelaFim: number;
  janelaTodosDias: boolean;
}

export interface ConfigAdmin {
  destinos: string[];
  origemDestinos: 'banco' | 'env';
  aprovacaoAberta: boolean;
  ajustes: AjustesAdmin;
}

const comSenha = (senha: string): Record<string, string> => ({ authorization: `Bearer ${senha}` });

export const lerConfigAdmin = (senha: string): Promise<ConfigAdmin> =>
  pedirJson('/api/admin/config', { headers: comSenha(senha) });

export const salvarConfigAdmin = (
  senha: string,
  mudanca: { destinos?: string[]; aprovacaoAberta?: boolean; ajustes?: Partial<AjustesAdmin> },
): Promise<ConfigAdmin> =>
  pedirJson('/api/admin/config', {
    method: 'PUT',
    headers: { ...comSenha(senha), 'content-type': 'application/json' },
    body: JSON.stringify(mudanca),
  });

// Público: a tela de aprovação só precisa saber se pede senha.
export const lerAprovacaoAberta = (): Promise<{ aberta: boolean }> => pedirJson('/api/operador/aprovacao');
