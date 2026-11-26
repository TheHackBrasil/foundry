// Domínio puro da tela #/operacao (specs 0010/0011): ordenação da fila de
// casos, rótulos de status e formatação das métricas. Sem DOM nem fetch —
// tudo testável como o matriz.ts.

import type {
  Caso,
  Cobranca,
  StatusCaso,
  StatusCobranca,
} from '../../../shared/model.ts';
import { rotuloCampo, rotuloFonte } from '../format.ts';

export type CasoLista = Caso & { daSessao?: boolean };
export type CobrancaLista = Cobranca & { daSessao?: boolean };

// A fila trabalha o urgente primeiro: contestado pede decisão, depois
// aberto, depois atribuído; resolvido fica no fim, mais recente primeiro.
const ORDEM_STATUS: Record<StatusCaso, number> = {
  contestado: 0,
  aberto: 1,
  atribuido: 2,
  resolvido: 3,
};

export function ordenarCasos(casos: readonly CasoLista[]): CasoLista[] {
  return [...casos].sort((a, b) => {
    const dif = ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status];
    if (dif !== 0) return dif;
    if (a.status === 'resolvido') {
      return (b.resolvidoEm ?? b.abertoEm).localeCompare(a.resolvidoEm ?? a.abertoEm);
    }
    return a.abertoEm.localeCompare(b.abertoEm);
  });
}

const ROTULO_STATUS_CASO = new Map<StatusCaso, string>([
  ['aberto', 'Aberto'],
  ['atribuido', 'Atribuído'],
  ['resolvido', 'Resolvido'],
  ['contestado', 'Contestado'],
]);

export const rotuloStatusCaso = (s: StatusCaso): string => ROTULO_STATUS_CASO.get(s) ?? s;

export function classeStatusCaso(s: StatusCaso): string {
  switch (s) {
    case 'contestado':
      return 'pilula-erro';
    case 'resolvido':
      return 'pilula-ok';
    case 'atribuido':
      return 'pilula-coord';
    default:
      return 'pilula-warn';
  }
}

const ROTULO_PENDENCIA = new Map<string, string>([
  ['sem_atualizacao', 'Pedido sem atualização além do limite'],
  ['cte_sem_nfe', 'CT-e presente sem a NF-e correspondente'],
  ['entrega_sem_confirmacao', 'Previsão passou sem status de entrega'],
]);

export const rotuloPendencia = (motivo: string): string =>
  ROTULO_PENDENCIA.get(motivo) ?? motivo.replaceAll('_', ' ');

// Título curto do caso na fila: campo + fontes na divergência, motivo na
// pendência. O detalhe completo fica no painel.
export function tituloCaso(c: Caso): string {
  if (c.origem === 'pendencia') return rotuloPendencia(c.pendencia?.motivo ?? 'pendencia');
  const d = c.divergencia;
  if (!d) return 'Divergência entre fontes';
  if (d.tipo === 'mudanca') {
    return `${rotuloCampo(d.campo)}: ${rotuloFonte(d.fonteA)} mudou de versão`;
  }
  return `${rotuloCampo(d.campo)}: ${rotuloFonte(d.fonteA)} vs ${rotuloFonte(d.fonteB)}`;
}

const ROTULO_STATUS_COBRANCA = new Map<StatusCobranca, string>([
  ['pendente', 'Aguardando aprovação'],
  ['pendente_envio', 'SMTP não configurado'],
  ['enviada', 'Enviada'],
  ['respondida', 'Respondida'],
  ['expirada', 'Expirada sem resposta'],
  ['erro_envio', 'Falha no envio'],
]);

export const rotuloStatusCobranca = (s: StatusCobranca): string =>
  ROTULO_STATUS_COBRANCA.get(s) ?? s;

export function classeStatusCobranca(s: StatusCobranca): string {
  switch (s) {
    case 'respondida':
      return 'pilula-ok';
    case 'enviada':
      return 'pilula-coord';
    case 'erro_envio':
    case 'expirada':
      return 'pilula-erro';
    case 'pendente_envio':
      return 'pilula-warn';
    default:
      return 'pilula-neutra';
  }
}

// O botão de enviar existe para a sessão dona em status que admitem envio
// ou reenvio; a janela anti-spam e o 409 final ficam no servidor.
export function podeEnviarCobranca(c: CobrancaLista): boolean {
  return (
    Boolean(c.daSessao) &&
    (c.status === 'pendente' ||
      c.status === 'pendente_envio' ||
      c.status === 'enviada' ||
      c.status === 'erro_envio')
  );
}

// Métricas vêm em ms; o painel mostra "—" sem amostra, segundos na demo e
// horas/dias em operação real.
export function formatarDuracaoMs(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  if (h < 24) return min % 60 === 0 ? `${h}h` : `${h}h${min % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d${h % 24}h`;
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`;

export function cartoesMetricas(m: {
  totalPedidos: number;
  pedidosComExcecao: number;
  taxaExcecao: number;
  casosAbertos: number;
  casosResolvidos: number;
  casosContestados: number;
  tempoMedioAteDonoMs: number | null;
  tempoMedioAteResolverMs: number | null;
}): Array<{ rotulo: string; valor: string; ajuda?: string }> {
  return [
    {
      rotulo: 'Taxa de exceção',
      valor: pct(m.taxaExcecao),
      ajuda: `${m.pedidosComExcecao} de ${m.totalPedidos} pedidos`,
    },
    { rotulo: 'Casos abertos', valor: String(m.casosAbertos) },
    { rotulo: 'Contestados', valor: String(m.casosContestados) },
    { rotulo: 'Resolvidos', valor: String(m.casosResolvidos) },
    { rotulo: 'Tempo até dono', valor: formatarDuracaoMs(m.tempoMedioAteDonoMs), ajuda: 'média' },
    { rotulo: 'Tempo até resolver', valor: formatarDuracaoMs(m.tempoMedioAteResolverMs), ajuda: 'média' },
  ];
}
