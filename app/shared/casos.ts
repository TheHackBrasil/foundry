// Casos de excecao (spec 0011): projecao pura dos eventos. Um caso abre com
// 'divergencia' ou 'pendencia_aberta' (id = pedidoId:seq) e transita pelos
// eventos caso_*. Nenhum estado mutavel: reimportar a trilha reproduz tudo.

import { TIPOS_DOCUMENTO, type Caso, type CamposObservados, type Divergencia, type Evento, type Metricas, type Parte } from './model.js';

interface PayloadCaso {
  casoId?: string;
  parte?: Parte;
  texto?: string;
  acao?: 'confirmar' | 'contestar';
  token?: string;
  motivo?: string;
  detalhe?: string;
  resolvidoPor?: string;
}

function abrirCaso(ev: Evento): Caso {
  const p = ev.payload as PayloadCaso & Partial<Divergencia>;
  const divergencia =
    ev.tipo === 'divergencia'
      ? ({ campo: p.campo, fonteA: p.fonteA, fonteB: p.fonteB, valorA: p.valorA, valorB: p.valorB, tipo: p.tipo } as Divergencia)
      : undefined;
  return {
    id: `${ev.pedidoId}:${ev.seq}`,
    pedidoId: ev.pedidoId,
    origem: ev.tipo === 'divergencia' ? 'divergencia' : 'pendencia',
    origemSeq: ev.seq ?? 0,
    status: 'aberto',
    divergencia,
    pendencia:
      ev.tipo === 'pendencia_aberta'
        ? { motivo: String(p.motivo ?? ''), detalhe: typeof p.detalhe === 'string' ? p.detalhe : undefined }
        : undefined,
    abertoEm: ev.ts,
    ciclos: 0,
  };
}

// Fold por pedido (os eventos chegam ordenados por seq dentro do pedido).
export function projetarCasos(eventos: Evento[]): Caso[] {
  const casos = new Map<string, Caso>();
  for (const ev of eventos) {
    if (ev.tipo === 'divergencia' || ev.tipo === 'pendencia_aberta') {
      casos.set(`${ev.pedidoId}:${ev.seq}`, abrirCaso(ev));
      continue;
    }
    if (!ev.tipo.startsWith('caso_')) continue;
    const p = ev.payload as PayloadCaso;
    const caso = typeof p.casoId === 'string' ? casos.get(p.casoId) : undefined;
    if (!caso) continue;
    switch (ev.tipo) {
      case 'caso_atribuido':
        caso.status = 'atribuido';
        caso.donoPapel = p.parte;
        caso.assumidoEm = ev.ts;
        break;
      case 'caso_resolvido':
        caso.status = 'resolvido';
        caso.resolvidoEm = ev.ts;
        caso.resolucao = typeof p.texto === 'string' ? p.texto : undefined;
        if (p.resolvidoPor === 'motor') caso.resolvidoPor = 'motor';
        else delete caso.resolvidoPor;
        break;
      case 'caso_reaberto':
        caso.status = 'atribuido';
        caso.ciclos += 1;
        caso.resolvidoEm = undefined;
        caso.resolucao = undefined;
        delete caso.resolvidoPor;
        break;
      case 'caso_resposta_parceiro':
        caso.ultimaRespostaParceiro = {
          acao: p.acao === 'contestar' ? 'contestar' : 'confirmar',
          texto: typeof p.texto === 'string' ? p.texto : undefined,
          em: ev.ts,
        };
        // confirmar fecha; contestar devolve para o operador decidir e
        // zera o fechamento anterior — contestado nao conta como resolvido.
        caso.status = caso.ultimaRespostaParceiro.acao === 'contestar' ? 'contestado' : 'resolvido';
        if (caso.status === 'resolvido') caso.resolvidoEm = ev.ts;
        else caso.resolvidoEm = undefined;
        break;
    }
  }
  return [...casos.values()];
}

// Fechamento deterministico (spec 0017, RF5): a regra decide sozinha, sem
// IA e sem analista, quando um caso de pendencia acabou.
// - sem_atualizacao fecha com declaracao aceita (status_declarado no
//   ledger, com algum campo declarado) posterior ao caso;
// - entrega_sem_confirmacao fecha so com status 'entregue' declarado por
//   algum documento posterior ao caso.
// "Posterior" conta pela seq da cadeia, a partir da abertura ou da ultima
// reabertura: o analista que reabre um caso nao o ve fechar de novo pelo
// mesmo documento. Outros motivos e divergencias nao fecham pelo motor.
export type RegraFechamento = 'declaracao_aceita' | 'entrega_confirmada';

export interface FechamentoMotor {
  casoId: string;
  regra: RegraFechamento;
  seqDocumento: number; // seq do evento que fechou o caso
}

function regraDoMotivo(motivo: string | undefined): RegraFechamento | null {
  if (motivo === 'sem_atualizacao') return 'declaracao_aceita';
  if (motivo === 'entrega_sem_confirmacao') return 'entrega_confirmada';
  return null;
}

const TIPOS_DOC = new Set<string>(TIPOS_DOCUMENTO);

function fecha(regra: RegraFechamento, ev: Evento): boolean {
  if (!TIPOS_DOC.has(ev.tipo)) return false;
  const campos = ((ev.payload as { campos?: CamposObservados }).campos ?? {}) as CamposObservados;
  if (regra === 'entrega_confirmada') return campos.status === 'entregue';
  return ev.tipo === 'status_declarado' && Object.values(campos).some((v) => v !== undefined && v !== null);
}

// casoId -> seq da abertura ou da ultima reabertura do caso de pendencia.
function inicioDosCasos(eventos: Evento[]): Map<string, number> {
  const desde = new Map<string, number>();
  for (const ev of eventos) {
    const id = ev.tipo === 'pendencia_aberta' ? `${ev.pedidoId}:${ev.seq}` : (ev.payload as PayloadCaso).casoId;
    const conta = ev.tipo === 'pendencia_aberta' || (ev.tipo === 'caso_reaberto' && typeof id === 'string' && desde.has(id));
    if (conta && typeof id === 'string') desde.set(id, ev.seq ?? 0);
  }
  return desde;
}

// Casos que o app deve fechar agora com caso_resolvido (resolvidoPor
// 'motor'). Puro e idempotente: depois do caso_resolvido gravado, a mesma
// trilha nao devolve o caso de novo.
export function fechamentosDoMotor(eventos: Evento[]): FechamentoMotor[] {
  const desde = inicioDosCasos(eventos);
  const out: FechamentoMotor[] = [];
  for (const caso of projetarCasos(eventos)) {
    if (caso.origem !== 'pendencia' || caso.status === 'resolvido') continue;
    const regra = regraDoMotivo(caso.pendencia?.motivo);
    const inicio = desde.get(caso.id);
    if (!regra || inicio === undefined) continue;
    const doc = eventos.find(
      (ev) => ev.pedidoId === caso.pedidoId && (ev.seq ?? 0) > inicio && fecha(regra, ev),
    );
    if (doc) out.push({ casoId: caso.id, regra, seqDocumento: doc.seq ?? 0 });
  }
  return out;
}

// O token do parceiro fica no payload do evento de origem (divergencia ou
// pendencia): a rota de resposta confere ali, o caso so expõe via esta
// funcao — quem lista casos sem ser dono nao deveria ver o token.
export function tokenDoCaso(eventos: Evento[], caso: Caso): string | undefined {
  const origem = eventos.find((ev) => ev.pedidoId === caso.pedidoId && ev.seq === caso.origemSeq);
  const t = (origem?.payload as PayloadCaso | undefined)?.token;
  return typeof t === 'string' ? t : undefined;
}

const ms = (a: string, b: string): number => new Date(b).getTime() - new Date(a).getTime();

// Metricas so de eventos (RF6): medias por caso e taxa por pedido.
export function metricasDosCasos(casos: Caso[], totalPedidos: number): Metricas {
  const comDono = casos.filter((c) => c.assumidoEm !== undefined);
  const resolvidos = casos.filter((c) => c.resolvidoEm !== undefined);
  const media = (nums: number[]): number | null =>
    nums.length === 0 ? null : nums.reduce((a, b) => a + b, 0) / nums.length;
  const pedidosComExcecao = new Set(casos.map((c) => c.pedidoId)).size;
  return {
    totalPedidos,
    pedidosComExcecao,
    taxaExcecao: totalPedidos === 0 ? 0 : pedidosComExcecao / totalPedidos,
    casosAbertos: casos.filter((c) => c.status === 'aberto' || c.status === 'atribuido' || c.status === 'contestado').length,
    casosResolvidos: resolvidos.length,
    casosContestados: casos.filter((c) => c.status === 'contestado').length,
    tempoMedioAteDonoMs: media(comDono.map((c) => ms(c.abertoEm, c.assumidoEm!))),
    tempoMedioAteResolverMs: media(resolvidos.map((c) => ms(c.abertoEm, c.resolvidoEm!))),
  };
}
