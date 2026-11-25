// Leitura detalhada sob demanda (spec 0014, THE-17): um clique em campo,
// divergencia ou setor dispara um mandato de leitura no mesmo endpoint SSE
// do assistente e o texto volta fluido aqui dentro. Mandato de leitura
// honesto: pede explicacao citando a evidencia real do registro, nunca
// executa acao. O cache LRU evita repetir chamada ao revisitar o alvo.

import type {
  EventoStreamMandato,
  ProjecaoPedido,
  RespostaMandato,
} from '../../../../shared/model.ts';
import { transmitirMandatoStream } from '../../apiOps.ts';
import {
  formatarMomento,
  formatarValor,
  rotuloCampo,
  rotuloFonte,
  rotuloParte,
  rotuloTipoSinal,
} from '../../format.ts';
import { criarCacheLente } from '../../lenteCache.ts';
import { tarefasDaParte } from '../../matriz.ts';
import { lerValorFonte } from '../genui/helpers.ts';
import type { AlvoDescricao } from './contexto.ts';
import { chaveAlvoDescricao } from './contexto.ts';

// O limite do servidor e de 10 mandatos por 10 min por IP (mandatosPor10Min).
// O cache evita repetir pedido pelo mesmo alvo; totalEventos na chave
// invalida a resposta quando o ledger anda.
export const LIMITE_CACHE_DESCRICAO = 24;
const cacheDescricao = criarCacheLente<string>(LIMITE_CACHE_DESCRICAO);

export function chaveDescricao(pedidoId: string, alvo: AlvoDescricao, totalEventos: number): string {
  return `${pedidoId}|${totalEventos}|${chaveAlvoDescricao(alvo)}`;
}

export function lerDescricaoCache(chave: string): string | null {
  return cacheDescricao.obter(chave) ?? null;
}

export function guardarDescricaoCache(chave: string, texto: string): void {
  cacheDescricao.guardar(chave, texto);
}

const PREMISSA_LEITURA =
  'Somente leitura, sem executar acoes nem alterar nada no registro.';

function limitar(texto: string, max: number): string {
  return texto.length > max ? `${texto.slice(0, max - 1)}…` : texto;
}

// Monta o comando em linguagem natural que vai no POST /api/mandatos/stream.
// Os valores ja vem da projecao local para o agente nao precisar adivinhar.
export function montarMandatoDescricao(alvo: AlvoDescricao, dados: ProjecaoPedido | null): string {
  switch (alvo.tipo) {
    case 'campo': {
      const porFonte = dados
        ? [...dados.versoes]
            .sort((a, b) => a.versao - b.versao)
            .filter((v) => v.campos[alvo.campo] !== undefined)
            .map((v) => `${rotuloFonte(v.fonte)} v${v.versao}: "${formatarValor(alvo.campo, v.campos[alvo.campo])}"`)
            .join('; ')
        : '';
      return limitar(
        `${PREMISSA_LEITURA} Explique em ate 4 frases o campo ${rotuloCampo(alvo.campo)} deste pedido, citando a evidencia do registro` +
          (porFonte ? ` (declaracoes: ${porFonte}).` : ', mesmo que ainda nao haja valor declarado.'),
        900,
      );
    }
    case 'celula': {
      const lido = dados
        ? lerValorFonte(dados, alvo.fonte, alvo.campo)
        : { valor: undefined as unknown };
      const valorTxt =
        lido.valor !== undefined
          ? ` declarado como "${formatarValor(alvo.campo, lido.valor)}"` +
            `${lido.versao !== undefined ? ` na v${lido.versao}` : ''}` +
            `${lido.em ? ` em ${formatarMomento(lido.em)}` : ''}`
          : '';
      return limitar(
        `${PREMISSA_LEITURA} Explique em ate 4 frases o campo ${rotuloCampo(alvo.campo)} que ${rotuloFonte(alvo.fonte)}${valorTxt || ' ainda nao'} declara neste pedido, citando a evidencia do registro.`,
        900,
      );
    }
    case 'divergencia': {
      const d = dados?.divergencias.find(
        (x) => x.campo === alvo.campo && x.fonteA === alvo.fonteA && x.fonteB === alvo.fonteB,
      );
      const valores = d
        ? `, com ${rotuloFonte(d.fonteA)} declarando "${formatarValor(d.campo, d.valorA)}" e ${rotuloFonte(d.fonteB)} "${formatarValor(d.campo, d.valorB)}"`
        : '';
      return limitar(
        `${PREMISSA_LEITURA} Explique em ate 4 frases a divergencia do campo ${rotuloCampo(alvo.campo)} entre ${rotuloFonte(alvo.fonteA)} e ${rotuloFonte(alvo.fonteB)} neste pedido${valores}, citando a evidencia (versao e momento de cada declaracao) e o que falta para resolver.`,
        900,
      );
    }
    case 'parte': {
      const tarefas = dados ? tarefasDaParte(dados.tarefas, alvo.parte) : [];
      const fila = tarefas.length > 0 ? `; fila atual: ${tarefas.length} tarefa(s)` : '';
      return limitar(
        `${PREMISSA_LEITURA} Explique em ate 4 frases o que o setor ${rotuloParte(alvo.parte)} precisa resolver neste pedido${fila}, citando a divergencia ou evidencia do registro que originou a demanda.`,
        900,
      );
    }
    case 'versao': {
      const v = dados?.versoes.find((x) => x.versao === alvo.versao);
      const detalhe = v
        ? ` (${rotuloFonte(v.fonte)}, em ${formatarMomento(v.geradaEm)})`
        : '';
      return limitar(
        `${PREMISSA_LEITURA} Explique em ate 4 frases o que a versao v${alvo.versao}${detalhe} declarou neste pedido, citando os campos e a evidencia do documento.`,
        900,
      );
    }
    case 'sinal': {
      const s = dados?.sinais[alvo.indice];
      const detalhe = s ? ` "${limitar(s.resumo, 200)}" (${rotuloTipoSinal(s.tipo)} · ${rotuloFonte(s.fonte)})` : ` #${alvo.indice + 1}`;
      return limitar(
        `${PREMISSA_LEITURA} Explique em ate 4 frases o sinal consultivo ${detalhe} e o que ele muda na leitura deste pedido.`,
        900,
      );
    }
  }
}

function ehObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// Fallback de compat: se o stream nao emitir texto, a resposta porPedido
// do POST sincrono antigo ainda carrega um resumo aproveitavel.
export function extrairTextoResposta(resposta: RespostaMandato | null | undefined): string {
  const porPedido = resposta?.resultado?.['porPedido'];
  if (!Array.isArray(porPedido)) return '';
  for (const item of porPedido) {
    if (ehObjeto(item) && typeof item['resumo'] === 'string' && item['resumo'].trim()) {
      return item['resumo'].trim();
    }
  }
  return '';
}

export interface OpcoesDescricaoAlvo {
  pedidoId: string;
  alvo: AlvoDescricao;
  dados: ProjecaoPedido | null;
  signal: AbortSignal;
  aoDelta?: (textoAcumulado: string) => void;
  executar?: typeof transmitirMandatoStream;
}

// Retorna o texto final da leitura; string vazia quando nada veio (o
// chamador mostra o estado honesto em vez de inventar conteudo).
export async function pedirDescricaoAlvo(op: OpcoesDescricaoAlvo): Promise<string> {
  const executar = op.executar ?? transmitirMandatoStream;
  let acumulado = '';
  let textoFinal = '';
  let resumoCompat = '';
  let textoAgenteFinal = '';
  const resultado = await executar(montarMandatoDescricao(op.alvo, op.dados), {
    pedidoId: op.pedidoId,
    signal: op.signal,
    aoEvento: (ev: EventoStreamMandato) => {
      if (op.signal.aborted) return;
      if (ev.tipo === 'texto_delta') {
        acumulado += ev.delta;
        op.aoDelta?.(acumulado);
      } else if (ev.tipo === 'fim') {
        textoFinal = ev.resultado.textoFinal;
      } else if (ev.tipo === 'concluido') {
        resumoCompat = extrairTextoResposta(ev.resposta);
      }
    },
  });
  textoAgenteFinal = resultado.agente?.textoFinal ?? '';
  return (textoFinal || acumulado || textoAgenteFinal || resumoCompat).trim();
}
