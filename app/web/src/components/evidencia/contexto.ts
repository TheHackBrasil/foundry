// Contexto do painel de evidencia (spec 0014, THE-16): o painel deriva o
// que mostra do que existe — pedido selecionado, projecao da torre, foco
// clicado e ultima resposta do agente — em vez de props rigidamente
// casadas. Tudo neste modulo e puro e testavel sem DOM.

import type {
  AlvoFocoGenUI,
  BlocoGenUI,
  CampoVigiado,
  ProjecaoPedido,
} from '../../../../shared/model.ts';
import {
  formatarConfianca,
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloParte,
  rotuloTipoSinal,
} from '../../format.ts';
import { agruparTarefas, tarefasDaParte } from '../../matriz.ts';
import type { Carga } from '../../useTorre.ts';
import { alvoIgual, lerValorFonte } from '../genui/helpers.ts';

// Resumo da ultima resposta do agente que a PaginaAssistenteIA entrega ao
// painel: texto final e os blocos GenUI da visao (spec ou stream).
export interface ContextoAgente {
  pedidoId: string;
  texto: string;
  blocos: readonly BlocoGenUI[];
}

export interface ContextoEvidencia {
  pedidoId: string | null;
  projecao: Carga<ProjecaoPedido>;
  focoAtivo: AlvoFocoGenUI | null;
  agente: ContextoAgente | null;
}

// As secoes que o painel sabe montar; a ordem da lista e a ordem na tela.
export type SecaoEvidencia =
  | { tipo: 'foco'; alvo: AlvoFocoGenUI }
  | { tipo: 'agente'; texto: string; blocos: BlocoGenUI[] }
  | { tipo: 'campos' }
  | { tipo: 'partes' }
  | { tipo: 'sinais' };

// Blocos largos (domino, simulador, despacho) pedem estado de simulacao ou
// acao de escrita e nao cabem na coluna: fora. matriz_focada e resumo_citado
// so precisam de foco; os demais leem a projecao quando ela existe.
const BLOCOS_SEM_PROJECAO = new Set(['resumo_citado', 'matriz_focada']);
const BLOCOS_COM_PROJECAO = new Set([
  'comparador_conflito',
  'linha_tempo_causal',
  'checklist_papel',
]);

export function blocoEntraNoPainel(bloco: BlocoGenUI, temProjecao: boolean): boolean {
  if (BLOCOS_SEM_PROJECAO.has(bloco.tipo)) return true;
  return temProjecao && BLOCOS_COM_PROJECAO.has(bloco.tipo);
}

// A resposta do agente so vira secao quando fala do pedido que o painel
// mostra; sem pedido selecionado, ela e o unico contexto que existe.
export function agenteServeAoContexto(ctx: ContextoEvidencia): boolean {
  if (!ctx.agente) return false;
  return !ctx.pedidoId || ctx.agente.pedidoId === ctx.pedidoId;
}

export function derivarSecoesEvidencia(ctx: ContextoEvidencia): SecaoEvidencia[] {
  const secoes: SecaoEvidencia[] = [];
  const dados = ctx.projecao.estado === 'ok' ? ctx.projecao.dados : null;

  if (ctx.focoAtivo && ctx.pedidoId) {
    secoes.push({ tipo: 'foco', alvo: ctx.focoAtivo });
  }

  if (agenteServeAoContexto(ctx) && ctx.agente) {
    const blocos = ctx.agente.blocos.filter((b) => blocoEntraNoPainel(b, dados !== null));
    const texto = ctx.agente.texto.trim();
    if (blocos.length > 0 || texto) {
      secoes.push({ tipo: 'agente', texto, blocos });
    }
  }

  if (dados) {
    secoes.push({ tipo: 'campos' }, { tipo: 'partes' });
    if (dados.sinais.length > 0) secoes.push({ tipo: 'sinais' });
  }

  return secoes;
}

// Alvo de leitura detalhada (THE-17): todo AlvoFocoGenUI e clicavel, e o
// campo sozinho tambem pede explicacao sem apontar uma fonte especifica.
export type AlvoDescricao = AlvoFocoGenUI | { tipo: 'campo'; campo: CampoVigiado };

export function chaveFoco(foco: AlvoFocoGenUI | null): string {
  if (!foco) return '';
  switch (foco.tipo) {
    case 'celula':
      return `celula:${foco.campo}:${foco.fonte}`;
    case 'divergencia':
      return `divergencia:${foco.campo}:${foco.fonteA}:${foco.fonteB}`;
    case 'parte':
      return `parte:${foco.parte}`;
    case 'versao':
      return `versao:${foco.versao}`;
    case 'sinal':
      return `sinal:${foco.indice}`;
  }
}

export function chaveAlvoDescricao(alvo: AlvoDescricao | null): string {
  if (!alvo) return '';
  return alvo.tipo === 'campo' ? `campo:${alvo.campo}` : chaveFoco(alvo);
}

export function alvoDescricaoIgual(a: AlvoDescricao | null, b: AlvoDescricao | null): boolean {
  if (!a || !b) return false;
  if (a.tipo === 'campo' || b.tipo === 'campo') {
    return a.tipo === 'campo' && b.tipo === 'campo' && a.campo === b.campo;
  }
  return alvoIgual(a, b);
}

export function descreverFoco(foco: AlvoFocoGenUI): string {
  switch (foco.tipo) {
    case 'celula':
      return `${rotuloCampo(foco.campo)} · ${rotuloFonte(foco.fonte)}`;
    case 'divergencia':
      return `${rotuloCampo(foco.campo)} (${rotuloFonte(foco.fonteA)} × ${rotuloFonte(foco.fonteB)})`;
    case 'parte':
      return `Setor ${rotuloParte(foco.parte)}`;
    case 'versao':
      return `Versão v${foco.versao}`;
    case 'sinal':
      return `Sinal consultivo #${foco.indice + 1}`;
  }
}

export function descreverAlvoDescricao(alvo: AlvoDescricao): string {
  return alvo.tipo === 'campo' ? `Campo ${rotuloCampo(alvo.campo)}` : descreverFoco(alvo);
}

export function rotuloAbrirNaTorre(foco: AlvoFocoGenUI): string {
  switch (foco.tipo) {
    case 'celula':
    case 'divergencia':
      return 'Abrir esta célula na Torre';
    case 'parte':
      return 'Abrir este setor na Torre';
    case 'versao':
      return 'Abrir esta versão na Torre';
    case 'sinal':
      return 'Abrir este sinal na Torre';
  }
}

// Um item de evidencia concreta do registro: rotulo curto (a fonte ou a
// tarefa) e o detalhe que prova (valor, versao e momento reais do ledger).
export interface ItemEvidencia {
  id: string;
  rotulo: string;
  detalhe: string;
}

function metaVersao(versao?: number, em?: string): string {
  const partes: string[] = [];
  if (versao !== undefined) partes.push(`v${versao}`);
  if (em) partes.push(formatarMomento(em));
  return partes.join(' · ');
}

export function evidenciasDoAlvo(alvo: AlvoDescricao, dados: ProjecaoPedido | null): ItemEvidencia[] {
  switch (alvo.tipo) {
    case 'campo': {
      if (!dados) return [];
      const itens: ItemEvidencia[] = [];
      for (const v of [...dados.versoes].sort((a, b) => a.versao - b.versao)) {
        const valor = v.campos[alvo.campo];
        if (valor === undefined) continue;
        itens.push({
          id: `campo:${v.fonte}:v${v.versao}`,
          rotulo: rotuloFonte(v.fonte),
          detalhe: `${formatarValor(alvo.campo, valor)} · v${v.versao} · ${formatarMomento(v.geradaEm)}`,
        });
      }
      return itens;
    }
    case 'celula': {
      const lido = dados
        ? lerValorFonte(dados, alvo.fonte, alvo.campo)
        : { valor: undefined as unknown };
      const meta = metaVersao(lido.versao, lido.em);
      return [
        {
          id: `cel:${alvo.fonte}`,
          rotulo: rotuloFonte(alvo.fonte),
          detalhe:
            lido.valor !== undefined
              ? `${formatarValor(alvo.campo, lido.valor)}${meta ? ` · ${meta}` : ''}`
              : 'Sem valor declarado',
        },
      ];
    }
    case 'divergencia': {
      const registro = dados?.divergencias.find(
        (d) => d.campo === alvo.campo && d.fonteA === alvo.fonteA && d.fonteB === alvo.fonteB,
      );
      const lidoA = dados ? lerValorFonte(dados, alvo.fonteA, alvo.campo) : null;
      const lidoB = dados ? lerValorFonte(dados, alvo.fonteB, alvo.campo) : null;
      const valorA = registro?.valorA ?? lidoA?.valor;
      const valorB = registro?.valorB ?? lidoB?.valor;
      const itens: ItemEvidencia[] = [];
      itens.push({
        id: `div:${alvo.fonteA}`,
        rotulo: rotuloFonte(alvo.fonteA),
        detalhe:
          valorA !== undefined
            ? `${formatarValor(alvo.campo, valorA)}${lidoA?.versao !== undefined ? ` · v${lidoA.versao}` : ''}${lidoA?.em ? ` · ${formatarMomento(lidoA.em)}` : ''}`
            : 'Sem valor declarado',
      });
      itens.push({
        id: `div:${alvo.fonteB}`,
        rotulo: rotuloFonte(alvo.fonteB),
        detalhe:
          valorB !== undefined
            ? `${formatarValor(alvo.campo, valorB)}${lidoB?.versao !== undefined ? ` · v${lidoB.versao}` : ''}${lidoB?.em ? ` · ${formatarMomento(lidoB.em)}` : ''}`
            : 'Sem valor declarado',
      });
      return itens;
    }
    case 'parte': {
      if (!dados) return [];
      const grupos = agruparTarefas(tarefasDaParte(dados.tarefas, alvo.parte));
      return grupos.slice(0, 4).map((g, i) => ({
        id: `tar:${alvo.parte}:${i}`,
        rotulo: g.titulo,
        detalhe: g.ocorrencias[0]?.detalhe ?? '',
      }));
    }
    case 'versao': {
      const v = dados?.versoes.find((x) => x.versao === alvo.versao);
      if (!v) return [];
      const declarados = (Object.keys(v.campos) as CampoVigiado[]).filter(
        (c) => v.campos[c] !== undefined,
      );
      return [
        {
          id: `ver:${v.versao}`,
          rotulo: `v${v.versao} · ${rotuloFonte(v.fonte)}`,
          detalhe: `${formatarMomento(v.geradaEm)}${declarados.length > 0 ? ` · ${declarados.map(rotuloCampo).join(', ')}` : ''}`,
        },
      ];
    }
    case 'sinal': {
      const sinal = dados?.sinais[alvo.indice];
      if (!sinal) return [];
      return [
        {
          id: `sinal:${alvo.indice}`,
          rotulo: `${rotuloTipoSinal(sinal.tipo)} · ${rotuloFonte(sinal.fonte)}`,
          detalhe: `${sinal.resumo} · confiança ${formatarConfianca(sinal.confianca)}`,
        },
      ];
    }
  }
}
