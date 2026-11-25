// Casos de excecao (spec 0011): projecao pura dos eventos. Um caso abre com
// 'divergencia' ou 'pendencia_aberta' (id = pedidoId:seq) e transita pelos
// eventos caso_*. Nenhum estado mutavel: reimportar a trilha reproduz tudo.

import type { Caso, Divergencia, Evento, Metricas, Parte } from './model.js';

interface PayloadCaso {
  casoId?: string;
  parte?: Parte;
  texto?: string;
  acao?: 'confirmar' | 'contestar';
  token?: string;
  motivo?: string;
  detalhe?: string;
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
        break;
      case 'caso_reaberto':
        caso.status = 'atribuido';
        caso.ciclos += 1;
        caso.resolvidoEm = undefined;
        caso.resolucao = undefined;
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
