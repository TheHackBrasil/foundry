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

// --- Fila de trabalho (triagem) ---
// A fila separa a sessão do analista dos exemplos da seed (somente leitura),
// esconde os resolvidos por padrão, busca por pedido ou campo e agrupa por
// pedido: um pedido costuma abrir vários casos de uma vez (peso, volumes,
// status), e o grupo evita repetir a mesma chave em cada linha.

export type OrigemFila = 'sessao' | 'exemplos';

export interface FiltroFila {
  origem: OrigemFila;
  mostrarResolvidos: boolean;
  busca: string;
}

export interface GrupoFila {
  pedidoId: string;
  casos: CasoLista[];
  maisRecente: string; // abertoEm do caso mais novo do grupo
}

const normalizar = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const daOrigem = (c: CasoLista, origem: OrigemFila): boolean => (origem === 'sessao' ? c.daSessao === true : c.daSessao !== true);

// Abertos (não resolvidos) por origem: os números das abas.
export function contarOrigens(casos: readonly CasoLista[]): Record<OrigemFila, number> {
  const conta = { sessao: 0, exemplos: 0 };
  for (const c of casos) if (c.status !== 'resolvido') conta[c.daSessao ? 'sessao' : 'exemplos'] += 1;
  return conta;
}

// A aba inicial: a sessão quando ela tem caso, senão os exemplos.
export function origemInicial(casos: readonly CasoLista[]): OrigemFila {
  return casos.some((c) => c.daSessao) ? 'sessao' : 'exemplos';
}

// Busca: todas as palavras precisam aparecer no título ou na chave do pedido.
export function casaBusca(c: CasoLista, busca: string): boolean {
  const termos = normalizar(busca).split(/\s+/).filter(Boolean);
  if (termos.length === 0) return true;
  const alvo = normalizar(`${tituloCaso(c)} ${c.pedidoId}`);
  return termos.every((t) => alvo.includes(t));
}

// Grupos do mais recente para o mais antigo; dentro do grupo, o urgente
// primeiro (contestado, aberto, atribuído, resolvido) e depois o mais novo.
export function montarFila(casos: readonly CasoLista[], filtro: FiltroFila): GrupoFila[] {
  const grupos = new Map<string, GrupoFila>();
  for (const c of casos) {
    if (!daOrigem(c, filtro.origem)) continue;
    if (!filtro.mostrarResolvidos && c.status === 'resolvido') continue;
    if (!casaBusca(c, filtro.busca)) continue;
    const g = grupos.get(c.pedidoId) ?? { pedidoId: c.pedidoId, casos: [], maisRecente: c.abertoEm };
    g.casos.push(c);
    if (c.abertoEm > g.maisRecente) g.maisRecente = c.abertoEm;
    grupos.set(c.pedidoId, g);
  }
  const lista = [...grupos.values()];
  for (const g of lista) {
    g.casos.sort((a, b) => ORDEM_STATUS[a.status] - ORDEM_STATUS[b.status] || b.abertoEm.localeCompare(a.abertoEm));
  }
  return lista.sort((a, b) => b.maisRecente.localeCompare(a.maisRecente) || a.pedidoId.localeCompare(b.pedidoId));
}

// Divergência nascida da resposta a um canal do operador (e-mail, WhatsApp
// ou ligação): o servidor não abre escada nova nela (invariante 7), então a
// tela explica em vez de oferecer o botão.
const FONTES_DO_OPERADOR = new Set(['email_transportadora', 'whatsapp_transportadora', 'ligacao_transportadora']);

export function nasceuDoOperador(c: Pick<Caso, 'divergencia'>): boolean {
  const d = c.divergencia;
  return !!d && (FONTES_DO_OPERADOR.has(d.fonteA) || FONTES_DO_OPERADOR.has(d.fonteB));
}

// --- Próximo passo do caso ---
// Uma resposta só para "o que faço agora?": título, o porquê em uma frase e,
// quando há, a ação principal. A tela mostra isto no topo do caso.

export type AcaoPasso = 'acionar' | 'ver_plano' | 'resolver' | 'reabrir' | 'nenhuma';

export interface PassoCaso {
  titulo: string;
  texto: string;
  acao: AcaoPasso;
  rotuloAcao?: string;
  tom: 'acao' | 'espera' | 'neutro' | 'feito';
}

export interface ContextoPasso {
  operadorAcionado: boolean;
  // Plano de WhatsApp ou ligação esperando a decisão do analista.
  planoPendente: { canal: string } | null;
  // Rótulo do último registro do operador na linha do tempo, se houver.
  ultimoRegistro: string | null;
}

const ROTULO_CANAL_PASSO: Record<string, string> = { whatsapp: 'mandar WhatsApp', ligacao: 'ligar' };

export function proximoPassoCaso(c: CasoLista, ctx: ContextoPasso): PassoCaso {
  if (!c.daSessao) {
    return {
      titulo: 'Exemplo da demonstração',
      texto: 'Só leitura. Para testar as ações, abra um caso na aba Sua sessão.',
      acao: 'nenhuma',
      tom: 'neutro',
    };
  }
  if (c.status === 'resolvido') {
    return {
      titulo: 'Caso resolvido',
      texto: c.resolucao ? `Nota: ${c.resolucao}` : 'Reabra se o problema voltar.',
      acao: 'reabrir',
      rotuloAcao: 'Reabrir caso',
      tom: 'feito',
    };
  }
  if (ctx.planoPendente) {
    const verbo = ROTULO_CANAL_PASSO[ctx.planoPendente.canal] ?? 'contatar';
    return {
      titulo: 'Sua aprovação é necessária',
      texto: `O operador quer ${verbo} para a transportadora. Confira o roteiro e aprove ou recuse.`,
      acao: 'ver_plano',
      rotuloAcao: 'Ver o plano',
      tom: 'acao',
    };
  }
  if (ctx.operadorAcionado) {
    return {
      titulo: 'O operador está cuidando',
      texto: ctx.ultimoRegistro
        ? `Último passo: ${ctx.ultimoRegistro}. Você é avisado aqui quando precisar decidir algo.`
        : 'Você é avisado aqui quando precisar decidir algo.',
      acao: 'nenhuma',
      tom: 'espera',
    };
  }
  if (nasceuDoOperador(c)) {
    return {
      titulo: 'Confira a resposta e resolva',
      texto:
        'Este caso nasceu da resposta da transportadora. O operador não cobra de novo o que ela acabou de declarar: compare os valores e resolva com uma nota.',
      acao: 'resolver',
      rotuloAcao: 'Resolver com nota',
      tom: 'acao',
    };
  }
  if (c.origem !== 'divergencia') {
    return {
      titulo: 'Cobre o status ou resolva',
      texto: 'É uma pendência de prazo. Use a cobrança por e-mail na lista à esquerda ou resolva com uma nota.',
      acao: 'resolver',
      rotuloAcao: 'Resolver com nota',
      tom: 'acao',
    };
  }
  return {
    titulo: 'Acione o operador',
    texto:
      'Ele manda e-mail para quem é responsável pelo valor. Sem resposta no prazo, propõe WhatsApp ou ligação, que só saem com a sua aprovação.',
    acao: 'acionar',
    rotuloAcao: 'Acionar o operador',
    tom: 'acao',
  };
}
