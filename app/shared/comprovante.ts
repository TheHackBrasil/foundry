// Comprovante verificavel (spec 0011): o link read-only que a terceira parte
// abre sem sessao. A trilha vai completa (seq, tipo, ts, hash e o elo
// anterior) para qualquer um refazer a cadeia elo a elo e a raiz Merkle da
// ancora. O payload vai como assinado quando pode ser publico: tirar o
// 'token' quebraria a conferencia. Quem tem o link tem, por desenho da
// demo, a mesma credencial do parceiro para os casos abertos.
// Spec 0017, RF25: o link nunca mostra dado pessoal. Evento do operador e
// notificacao saem sem payload; nos outros eventos o payload so sai quando
// nao traz telefone, e-mail, transcricao nem campo de contato (o fone da
// NF-e, o remetente da resposta de cobranca). Sem o payload, o evento ainda
// prova a ordem: prevHash liga ao anterior e o hash entra na raiz Merkle.

import { verificarCadeia } from './chain.js';
import { projetarCasos } from './casos.js';
import { raizMerkle } from './merkle.js';
import { TIPOS_OPERADOR, type Caso, type Evento } from './model.js';

export interface EventoComprovante {
  seq: number;
  tipo: string;
  ts: string;
  prevHash: string;
  hash: string;
  // Ausente quando o payload poderia expor dado pessoal (payloadOmitido).
  payload?: Record<string, unknown>;
  payloadOmitido?: true;
}

export interface Comprovante {
  pedidoId: string;
  geradoEm: string;
  cadeiaIntegra: boolean;
  totalEventos: number;
  ancora: Record<string, unknown> | null;
  rootHistorico: string | null;
  rootConfere: boolean | null;
  eventosAncorados: number | null;
  casos: Caso[];
  trilha: EventoComprovante[];
}

// Tipos que nunca mostram payload: o operador (ids de contato, hashes de
// roteiro e de audio) e a notificacao (destino e mensagem enviada).
const TIPOS_SEM_PAYLOAD = new Set<string>([...TIPOS_OPERADOR, 'notificacao']);

// Chaves que carregam contato em qualquer nivel do payload.
const CHAVES_CONTATO = new Set([
  'fone',
  'telefone',
  'celular',
  'whatsapp',
  'email',
  'remetente',
  'destino',
  'mensagem',
  'transcricao',
  'audio',
  'roteiro',
]);

const RE_EMAIL = /[^\s@<>"',;:()]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+/i;
// Telefone com DDD (10 ou 11 digitos, com ou sem +DDI e separadores). Os
// limites por digito deixam de fora a chave de 44 digitos e o CNPJ.
const RE_TELEFONE = /(?<!\d)(?:\+\d{1,3}[\s.-]?)?\(?\d{2}\)?[\s.-]?\d{4,5}[\s.-]?\d{4}(?!\d)/;

function textoComContato(texto: string): boolean {
  return RE_EMAIL.test(texto) || RE_TELEFONE.test(texto);
}

function temContato(valor: unknown): boolean {
  if (typeof valor === 'string') return textoComContato(valor);
  if (Array.isArray(valor)) return valor.some(temContato);
  if (valor !== null && typeof valor === 'object') {
    return Object.entries(valor as Record<string, unknown>).some(
      ([k, v]) => (CHAVES_CONTATO.has(k.toLowerCase()) && v !== null && v !== undefined && v !== '') || temContato(v),
    );
  }
  return false;
}

export function payloadPublico(ev: Pick<Evento, 'tipo' | 'payload'>): boolean {
  return !TIPOS_SEM_PAYLOAD.has(ev.tipo) && !temContato(ev.payload);
}

// Texto livre do caso (resolucao, resposta do parceiro) com contato sai do
// comprovante; o resto do caso e projecao de ids, campos e datas.
function casoPublico(caso: Caso): Caso {
  const c: Caso = { ...caso };
  if (c.resolucao !== undefined && textoComContato(c.resolucao)) delete c.resolucao;
  if (c.pendencia?.detalhe !== undefined && textoComContato(c.pendencia.detalhe)) {
    c.pendencia = { motivo: c.pendencia.motivo };
  }
  if (c.ultimaRespostaParceiro?.texto !== undefined && textoComContato(c.ultimaRespostaParceiro.texto)) {
    const { texto: _texto, ...resto } = c.ultimaRespostaParceiro;
    c.ultimaRespostaParceiro = resto;
  }
  return c;
}

export function montarComprovante(
  pedidoId: string,
  eventos: Evento[],
  ancora: Record<string, unknown> | null,
): Comprovante {
  const verificacao = verificarCadeia(eventos);
  const seqAncora = [...eventos].reverse().find((e) => e.tipo === 'ancora')?.seq;
  const cobertos =
    seqAncora === undefined
      ? []
      : eventos.filter((e) => e.seq !== undefined && e.seq < seqAncora);
  const rootHistorico = seqAncora === undefined ? null : raizMerkle(cobertos.map((e) => e.hash));
  return {
    pedidoId,
    geradoEm: new Date().toISOString(),
    cadeiaIntegra: verificacao.valida,
    totalEventos: eventos.length,
    ancora,
    rootHistorico,
    rootConfere:
      ancora !== null && rootHistorico !== null ? rootHistorico === ancora['root'] : null,
    eventosAncorados: seqAncora === undefined ? null : seqAncora - 1,
    casos: projetarCasos(eventos).map(casoPublico),
    trilha: eventos.map((e) => ({
      seq: e.seq ?? 0,
      tipo: e.tipo,
      ts: e.ts,
      prevHash: e.prevHash,
      hash: e.hash,
      ...(payloadPublico(e) ? { payload: e.payload } : { payloadOmitido: true as const }),
    })),
  };
}
