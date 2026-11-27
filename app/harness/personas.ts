// Personas da transportadora simulada (frente harness-transp): maquinas de
// estado deterministicas, sem LLM nesta fatia. Cada persona tem DOIS LIVROS:
// `verdade` e o que o mundo sabe (a carga quebrou/atrasou) e `declarado` e o
// que ela afirma na resposta. A divergencia controlada entre os dois, somada
// ao que a planilha do embarcador ja declarou, e o que a plataforma detecta.

export type NomePersona = 'cooperativa' | 'evasiva' | 'silenciosa';

// O que aconteceu de verdade com a carga: nunca sai na mensagem; serve para
// o roteirista conferir que o declarado diverge (ou nao) do real.
export interface LivroVerdade {
  statusReal: string; // 'em_transito' | 'atrasada' | 'entregue' ...
  previsaoRealDias: number; // previsao honesta: hoje + N dias
  motivoReal: string; // causa interna ("veiculo quebrou na serra")
}

// O que a transportadora declara quando fala de status.
export interface LivroDeclarado {
  status: string; // mesmo vocabulario do extrator (em_transito, atrasada...)
  previsaoDias: number; // previsao declarada: hoje + N dias
  local: string; // trecho citado ("passou por Curitiba")
}

export interface RoteiroPersona {
  nome: NomePersona;
  remetente: string; // From da transportadora
  dominio: string; // dominio do Message-ID da resposta
  verdade: LivroVerdade;
  declarado: LivroDeclarado;
  atrasoRespostaMs: number; // realismo: a resposta nao cai no mesmo segundo
}

export interface PedidoDaThread {
  sequencia: number; // qual mensagem da thread (1a, 2a...)
  pedidoId: string | null; // chave de 44 digitos citada na cobranca
  agora: Date;
}

export type DecisaoPersona = { tipo: 'responder'; corpo: string } | { tipo: 'silencio' };

const pad2 = (n: number): string => String(n).padStart(2, '0');

// dd/mm/aaaa a partir de hoje + N dias (o roteiro nao carrega data fixa:
// a demo roda em qualquer dia).
export function dataRelativa(agora: Date, dias: number): { iso: string; br: string } {
  const d = new Date(agora.getTime() + dias * 86_400_000);
  const br = `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
  const iso = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  return { iso, br };
}

// Rotulo de status em texto natural, no vocabulario que o extrator conhece.
const STATUS_TEXTO: Record<string, string> = {
  em_transito: 'em transito',
  atrasada: 'em atraso',
  entregue: 'entregue',
  emitida: 'emitida',
  cancelada: 'cancelada',
};

function trechoPedido(pedidoId: string | null): string {
  return pedidoId ? ` referente a NF-e ${pedidoId}` : '';
}

// Corpo de cada resposta. Texto com data e status em formato que o extrator
// le (LLM ou revisao humana): "entrega prevista para DD/MM/AAAA, em transito".
function corpoCooperativa(roteiro: RoteiroPersona, t: PedidoDaThread): string {
  const prev = dataRelativa(t.agora, roteiro.declarado.previsaoDias);
  const status = STATUS_TEXTO[roteiro.declarado.status] ?? roteiro.declarado.status;
  return [
    'Ola,',
    '',
    `Sobre a entrega${trechoPedido(t.pedidoId)}: a carga segue ${status},`,
    `${roteiro.declarado.local}. A previsao de entrega atual e ${prev.br}.`,
    '',
    'Qualquer mudanca na posicao eu aviso por aqui.',
    '',
    `${roteiro.remetente}`,
  ].join('\n');
}

function corpoEvasiva(roteiro: RoteiroPersona, t: PedidoDaThread): string {
  if (t.sequencia === 1) {
    // O evento mais comum do Brasil, segundo o juiz de logistica: nada de
    // status, so a promessa de retorno. Fecha a cobranca sem declarar nada.
    return [
      'Bom dia,',
      '',
      `Recebi a cobranca${trechoPedido(t.pedidoId)}. Vou verificar com o`,
      'motorista e ja retorno com a posicao da carga.',
      '',
      `${roteiro.remetente}`,
    ].join('\n');
  }
  // Na segunda cobranca declara a versao otimista: diverge da planilha do
  // embarcador e da verdade do roteiro (atraso real maior).
  const prev = dataRelativa(t.agora, roteiro.declarado.previsaoDias);
  const status = STATUS_TEXTO[roteiro.declarado.status] ?? roteiro.declarado.status;
  return [
    'Ola,',
    '',
    `Retornando sobre a entrega${trechoPedido(t.pedidoId)}: esta tudo certo,`,
    `a carga segue ${status} e a previsao de entrega e ${prev.br}.`,
    '',
    `${roteiro.remetente}`,
  ].join('\n');
}

// Decisao da persona para a mensagem `sequencia` da thread. Silenciosa nunca
// responde: serve para a escada subir na frente da plateia.
export function decidir(roteiro: RoteiroPersona, t: PedidoDaThread): DecisaoPersona {
  switch (roteiro.nome) {
    case 'cooperativa':
      return { tipo: 'responder', corpo: corpoCooperativa(roteiro, t) };
    case 'evasiva':
      return { tipo: 'responder', corpo: corpoEvasiva(roteiro, t) };
    case 'silenciosa':
      return { tipo: 'silencio' };
  }
}

// Contador de mensagens por thread. A chave e o pedidoId (a cobranca cita a
// NF-e na linha de assunto); sem chave, cada cobranca e thread propria pelo
// Message-ID que a originou.
export class EstadoPersonas {
  private recebidas = new Map<string, number>();

  proximaSequencia(chave: string): number {
    const n = (this.recebidas.get(chave) ?? 0) + 1;
    this.recebidas.set(chave, n);
    return n;
  }
}
