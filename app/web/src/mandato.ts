import {
  CAMPOS_VIGIADOS,
  FONTES_DOCUMENTO,
  PARTES,
  type CampoVigiado,
  type Divergencia,
  type FonteDocumento,
  type Notificacao,
  type Parte,
  type RespostaMandato,
  type Tarefa,
} from '../../shared/model.ts';
import { chaveCurta, rotuloAcaoMandato, rotuloMotivoNotificacao, rotuloParte } from './format.ts';

export interface ItemPropagar {
  pedidoId: string;
  divergencias: Divergencia[];
  tarefas: Tarefa[];
  eventosNovos: number;
}

export interface ItemSimular {
  pedidoId: string;
  divergencias: Divergencia[];
  tarefas: Tarefa[];
  tarefasPorParte: Array<{ parte: Parte; quantidade: number }>;
}

export interface ItemResumir {
  pedidoId: string;
  resumo: string;
  via: 'llm' | 'deterministico';
}

export interface ItemNotificar {
  pedidoId: string;
  parte: Parte | null;
  status: 'entregue' | 'nao_entregue';
  motivo?: NonNullable<Notificacao['motivo']>;
}

interface ResultadoMandatoBase {
  alvos: string[];
  leituraExemplo?: boolean;
  parteSugerida?: Parte;
}

export type ResultadoMandatoInterpretado =
  | (ResultadoMandatoBase & { acao: 'propagar'; itens: ItemPropagar[]; novosEventos: number })
  | (ResultadoMandatoBase & { acao: 'simular'; itens: ItemSimular[]; simulacao: true })
  | (ResultadoMandatoBase & { acao: 'resumir'; itens: ItemResumir[] })
  | (ResultadoMandatoBase & { acao: 'notificar'; itens: ItemNotificar[] });

const PARTES_SET = new Set<string>(PARTES);
const CAMPOS_SET = new Set<string>(CAMPOS_VIGIADOS);
const FONTES_SET = new Set<string>(FONTES_DOCUMENTO);
const MOTIVOS_NOTIFICACAO = new Set<string>([
  'desligado',
  'sem_parte',
  'sem_tarefa',
  'sem_contato',
  'canal_incompativel',
  'falha_envio',
]);

function ehRegistro(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function comoDivergencia(v: unknown): Divergencia | null {
  if (!ehRegistro(v)) return null;
  const campo = v['campo'];
  const fonteA = v['fonteA'];
  const fonteB = v['fonteB'];
  if (typeof campo !== 'string' || !CAMPOS_SET.has(campo)) return null;
  if (typeof fonteA !== 'string' || !FONTES_SET.has(fonteA)) return null;
  if (typeof fonteB !== 'string' || !FONTES_SET.has(fonteB)) return null;
  return {
    campo: campo as CampoVigiado,
    fonteA: fonteA as FonteDocumento,
    fonteB: fonteB as FonteDocumento,
    valorA: v['valorA'],
    valorB: v['valorB'],
  };
}

function comoTarefa(v: unknown): Tarefa | null {
  if (!ehRegistro(v)) return null;
  const parte = v['parte'];
  const titulo = v['titulo'];
  const detalhe = v['detalhe'];
  const divergencia = comoDivergencia(v['divergencia']);
  if (typeof parte !== 'string' || !PARTES_SET.has(parte)) return null;
  if (typeof titulo !== 'string' || typeof detalhe !== 'string' || !divergencia) return null;
  return { parte: parte as Parte, titulo, detalhe, divergencia };
}

function contarPorParte(tarefas: readonly Tarefa[]): Array<{ parte: Parte; quantidade: number }> {
  const contagem = new Map<Parte, number>();
  for (const t of tarefas) {
    contagem.set(t.parte, (contagem.get(t.parte) ?? 0) + 1);
  }
  return PARTES.filter((p) => contagem.has(p)).map((parte) => ({
    parte,
    quantidade: contagem.get(parte) ?? 0,
  }));
}

function listaPorPedido(resultado: Record<string, unknown>): Record<string, unknown>[] {
  const bruto = resultado['porPedido'];
  if (!Array.isArray(bruto)) return [];
  return bruto.filter(ehRegistro);
}

function lerPedidoId(item: Record<string, unknown>, fallback: string): string {
  return typeof item['pedidoId'] === 'string' && item['pedidoId'] ? item['pedidoId'] : fallback;
}

function lerNumero(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function comoParte(v: unknown): Parte | undefined {
  if (typeof v !== 'string') return undefined;
  const limpo = v.trim();
  return PARTES_SET.has(limpo) ? (limpo as Parte) : undefined;
}

// Normaliza o payload livre de RespostaMandato.resultado.porPedido por acao,
// alinhado ao formato emitido por app/server/mandatos.ts.
export function interpretarResultadoMandato(resposta: RespostaMandato): ResultadoMandatoInterpretado {
  const alvos = Array.isArray(resposta.alvos) ? resposta.alvos.filter((a): a is string => typeof a === 'string') : [];
  const bruto = ehRegistro(resposta.resultado) ? resposta.resultado : {};
  const linhas = listaPorPedido(bruto);
  const leituraExemplo = Boolean(bruto['leituraExemplo']);
  const parteSugerida = comoParte(resposta.filtros?.parte) ?? comoParte(resposta.alvo);
  const comum: ResultadoMandatoBase = {
    alvos,
    leituraExemplo,
    ...(parteSugerida ? { parteSugerida } : {}),
  };

  switch (resposta.acao) {
    case 'propagar': {
      const itens: ItemPropagar[] = linhas.map((item, idx) => ({
        pedidoId: lerPedidoId(item, alvos[idx] ?? ''),
        divergencias: Array.isArray(item['divergencias'])
          ? item['divergencias'].map(comoDivergencia).filter((d): d is Divergencia => d !== null)
          : [],
        tarefas: Array.isArray(item['tarefas'])
          ? item['tarefas'].map(comoTarefa).filter((t): t is Tarefa => t !== null)
          : [],
        eventosNovos: lerNumero(item['eventosNovos']),
      }));
      const novosEventos =
        typeof bruto['novosEventos'] === 'number' && Number.isFinite(bruto['novosEventos'])
          ? Math.max(0, bruto['novosEventos'])
          : itens.reduce((acc, i) => acc + i.eventosNovos, 0);
      return { ...comum, acao: 'propagar', itens, novosEventos };
    }

    case 'simular': {
      const itens: ItemSimular[] = linhas.map((item, idx) => {
        const divergencias = Array.isArray(item['divergencias'])
          ? item['divergencias'].map(comoDivergencia).filter((d): d is Divergencia => d !== null)
          : [];
        const tarefas = Array.isArray(item['tarefas'])
          ? item['tarefas'].map(comoTarefa).filter((t): t is Tarefa => t !== null)
          : [];
        return {
          pedidoId: lerPedidoId(item, alvos[idx] ?? ''),
          divergencias,
          tarefas,
          tarefasPorParte: contarPorParte(tarefas),
        };
      });
      return { ...comum, acao: 'simular', itens, simulacao: true };
    }

    case 'resumir': {
      const itens: ItemResumir[] = linhas.map((item, idx) => ({
        pedidoId: lerPedidoId(item, alvos[idx] ?? ''),
        resumo: typeof item['resumo'] === 'string' && item['resumo'].trim() ? item['resumo'].trim() : 'Sem resumo disponível.',
        via: item['via'] === 'deterministico' ? 'deterministico' : 'llm',
      }));
      return { ...comum, acao: 'resumir', itens };
    }

    case 'notificar': {
      const itens: ItemNotificar[] = linhas.map((item, idx) => {
        const parte = comoParte(item['parte']) ?? null;
        const status = item['status'] === 'entregue' ? 'entregue' : 'nao_entregue';
        const motivoBruto = item['motivo'];
        const motivo =
          typeof motivoBruto === 'string' && MOTIVOS_NOTIFICACAO.has(motivoBruto)
            ? (motivoBruto as NonNullable<Notificacao['motivo']>)
            : undefined;
        return {
          pedidoId: lerPedidoId(item, alvos[idx] ?? ''),
          parte,
          status,
          ...(motivo ? { motivo } : {}),
        };
      });
      return { ...comum, acao: 'notificar', itens };
    }
  }
}

const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

export function resumoParaAnuncio(interpretado: ResultadoMandatoInterpretado): string {
  const titulo = rotuloAcaoMandato(interpretado.acao);
  const quantosAlvos = plural(interpretado.alvos.length, 'pedido', 'pedidos');

  switch (interpretado.acao) {
    case 'propagar': {
      const divs = interpretado.itens.reduce((acc, i) => acc + i.divergencias.length, 0);
      return `${titulo} em ${quantosAlvos}: ${plural(divs, 'divergência', 'divergências')}, ${plural(interpretado.novosEventos, 'evento novo', 'eventos novos')}.`;
    }
    case 'simular': {
      const divs = interpretado.itens.reduce((acc, i) => acc + i.divergencias.length, 0);
      const tarefas = interpretado.itens.reduce((acc, i) => acc + i.tarefas.length, 0);
      return `${titulo} em ${quantosAlvos}: ${plural(divs, 'divergência prevista', 'divergências previstas')} e ${plural(tarefas, 'tarefa prevista', 'tarefas previstas')}. Nenhum campo alterado.`;
    }
    case 'resumir': {
      const primeiro = interpretado.itens[0];
      if (!primeiro) return `${titulo} concluído em ${quantosAlvos}.`;
      return `${titulo} do pedido ${chaveCurta(primeiro.pedidoId)}: ${primeiro.resumo}`;
    }
    case 'notificar': {
      const primeiro = interpretado.itens[0];
      if (!primeiro) return `${titulo} concluído em ${quantosAlvos}.`;
      const parte = primeiro.parte ? rotuloParte(primeiro.parte) : 'parte';
      if (primeiro.status === 'entregue') return `${titulo} enviado para ${parte}.`;
      const motivo = primeiro.motivo ? ` (${rotuloMotivoNotificacao(primeiro.motivo)})` : '';
      return `${titulo} não entregue para ${parte}${motivo}.`;
    }
  }
}
