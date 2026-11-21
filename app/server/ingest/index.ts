// Único módulo do ingest que a app-infra importa (contrato app-core para
// app-infra). Despacha pelo tipo do arquivo (NF-e, CT-e, evento fiscal,
// planilha, .eml) e desembrulha os anexos do .eml, então a infra nunca
// importa um parser avulso.
//
// Não grava nada: gravar e encadear é da infra. Entrada ruim volta como
// 'rejeitado' com mensagem explícita, nunca como exceção (A3). Cabeçalho de
// .eml traz endereço de pessoa: não entra em log nem em payload (RF27).

import type { EventoEntrada } from '../../shared/model.ts';

export interface EntradaIngestao {
  nome: string;
  mime: string;
  bytes: Uint8Array;
  // Quem sorteia é a infra (cookie da sessão); o ingest só carimba os eventos.
  workspaceId: string;
}

export type ResultadoIngestao =
  | { status: 'ok'; eventos: EventoEntrada[] }
  | { status: 'rejeitado'; erro: string }
  // Extração ambígua (PDF por LLM, P1): vai para a fila de revisão humana.
  | { status: 'revisao'; motivo: string; eventos: EventoEntrada[] };

export async function ingerir(_entrada: EntradaIngestao): Promise<ResultadoIngestao> {
  return { status: 'rejeitado', erro: 'ingest ainda não implementado' };
}
