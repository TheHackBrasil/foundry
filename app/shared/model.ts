// Modelo canonico (spec 0004, RF8): contrato unico server x web.

export type Parte = 'fornecedor' | 'transportadora' | 'cd' | 'fiscal' | 'financeiro';

export const PARTES: readonly Parte[] = [
  'fornecedor',
  'transportadora',
  'cd',
  'fiscal',
  'financeiro',
] as const;

// Origem do documento que entrou na camada (o que cada parceiro ja produz).
export type FonteDocumento = 'nfe' | 'cte' | 'cce' | 'planilha' | 'pdf' | 'imap' | 'manual';

export type TipoEvento =
  | 'nfe'
  | 'cte'
  | 'cce'
  | 'cancelamento'
  | 'planilha'
  | 'pdf'
  | 'divergencia'
  | 'tarefa'
  | 'ancora'
  | 'revisao'
  | 'mandato'
  | 'sinal'
  | 'notificacao';

// Tipos que representam um documento recebido (o resto e evento derivado):
// usados para contar documentos por workspace e para ler o fold da projecao.
// mandato, sinal e notificacao sao derivados como divergencia e tarefa (RF6).
export const TIPOS_DOCUMENTO = ['nfe', 'cte', 'cce', 'cancelamento', 'planilha', 'pdf'] as const;

// Todas as fontes que um pedido pode declarar ('manual' so aparece como
// fonteB de hipotese no simulate). Enum completo para validar ViewSpec.
export const FONTES_DOCUMENTO = ['nfe', 'cte', 'cce', 'planilha', 'pdf', 'imap', 'manual'] as const;

// Campos que a camada vigia entre fontes (RF10). Ausente = a fonte nao declara.
export interface CamposObservados {
  previsaoEntrega?: string; // ISO 8601 (YYYY-MM-DD)
  pesoTotal?: number; // kg
  volumes?: number;
  status?: string; // 'emitida' | 'em_transito' | 'entregue' | 'atrasada' | 'cancelada'
}

export const CAMPOS_VIGIADOS = [
  'previsaoEntrega',
  'pesoTotal',
  'volumes',
  'status',
] as const;

export type CampoVigiado = (typeof CAMPOS_VIGIADOS)[number];

export interface ItemPedido {
  descricao: string;
  quantidade: number;
  unidade: string;
  codigo?: string;
}

export interface ContatoDoc {
  cnpj?: string;
  nome: string;
  // fone do enderEmit/enderDest quando o documento traz; alimenta o
  // bootstrap da agenda de contatos (spec 0007, RF7).
  fone?: string;
}

// Saida normalizada de qualquer parser: documento vira DocData antes de virar Evento.
export interface DocData {
  fonte: FonteDocumento;
  docTipo: TipoEvento;
  pedidoId: string; // chave de 44 digitos da NF-e ou chave referenciada
  campos: CamposObservados;
  dados: Record<string, unknown>; // payload parseado completo (vai para o ledger)
  confianca?: number; // 0..1, usado pela extracao por LLM (A7: rotulado na UI)
}

// Evento do ledger append-only. hash/prevHash preenchidos na gravacao (chain.ts).
export interface Evento {
  id?: number;
  pedidoId: string;
  seq?: number; // posicao na cadeia do pedido (1..n)
  tipo: TipoEvento;
  payload: Record<string, unknown>;
  ts: string; // ISO 8601
  prevHash: string;
  hash: string;
}

export interface Pedido {
  id: string; // chave de 44 digitos
  emitente: ContatoDoc;
  destinatario: ContatoDoc;
  itens: ItemPedido[];
  campos: CamposObservados; // estado consolidado das fontes
  partes: Parte[];
  criadoEm: string;
}

// Uma versao do pedido por documento recebido (linha do tempo, RF18).
export interface VersaoPedido {
  pedidoId: string;
  versao: number;
  fonte: FonteDocumento;
  campos: CamposObservados;
  geradaEm: string;
}

export interface Divergencia {
  campo: CampoVigiado;
  fonteA: FonteDocumento;
  fonteB: FonteDocumento;
  valorA: unknown;
  valorB: unknown;
}

export interface Tarefa {
  parte: Parte;
  titulo: string;
  detalhe: string;
  divergencia: Divergencia;
}

// Canais que a agenda de contatos aceita; a Nvoip entrega nos tres primeiros.
export type CanalContato = 'whatsapp' | 'sms' | 'ligacao' | 'email';

export const CANAIS_CONTATO = ['whatsapp', 'sms', 'ligacao', 'email'] as const;

// Contato de uma parte num workspace (spec 0007, RF7). fonte: 'manual' (PUT),
// 'documento' (bootstrap por fone de NF-e/CT-e) ou 'seed' (ficticio da demo).
export interface Contato {
  parte: Parte;
  nome: string;
  canal: CanalContato;
  destino: string;
  fonte: 'manual' | 'documento' | 'seed';
}

// Sinal consultivo lido de texto livre por LLM (RF3): trilha informativa,
// nunca declara campo vigiado nem vira divergencia (R-006).
export type TipoSinal = 'atraso_avisado' | 'reagendamento' | 'instrucao' | 'outro';

export const TIPOS_SINAL = ['atraso_avisado', 'reagendamento', 'instrucao', 'outro'] as const;

export interface Sinal {
  tipo: TipoSinal;
  resumo: string;
  confianca: number; // 0..1, declarada pela extracao (A7)
  fonte: FonteDocumento;
}

// Acoes do mandato (RF4): conjunto fechado; a execucao e so do motor
// deterministico. Texto gerado nunca vira regra nem campo vigiado.
export type AcaoMandato = 'propagar' | 'simular' | 'resumir' | 'notificar';

export const ACOES_MANDATO = ['propagar', 'simular', 'resumir', 'notificar'] as const;

export interface FiltrosMandato {
  pedidoId?: string;
  fornecedor?: string;
  parte?: Parte;
  campo?: CampoVigiado;
  valor?: string | number;
}

// Saida validada da traducao LLM do comando (schema fechado, RF4).
export interface MandatoParseado {
  acao: AcaoMandato;
  filtros: FiltrosMandato;
  alvo?: string;
}

export interface RespostaMandato {
  acao: AcaoMandato;
  alvos: string[];
  resultado: Record<string, unknown>;
}

// Payload do evento 'notificacao' (RF8): o que saiu de verdade ou a falha
// registrada com motivo. canal/destino nulos quando nem houve tentativa.
export interface Notificacao {
  parte: Parte;
  canal: CanalContato | null;
  destino: string | null;
  mensagem: string;
  status: 'entregue' | 'nao_entregue';
  motivo?: string;
}

// Contrato de interface generativa (RF9): o servidor valida contra o schema
// e os enums antes de devolver; o front renderiza com componentes existentes.
export interface ViewSpec {
  versao: 1;
  fontesVisiveis: FonteDocumento[];
  colunas: CampoVigiado[];
  lente: Parte;
  destacarDivergencias: boolean;
}

// Proposta de mapeamento coluna -> campo canonico (RF11): a LLM propoe, a
// revisao aprova e o template fica por (workspace, remetente).
export interface PropostaMapeamento {
  mapeamento: Record<string, string>;
  confianca: number;
  motivo: string;
}

// Resultado de GET /api/pedidos/:id (projecao do ledger, T024).
export interface ProjecaoPedido {
  pedido: Pedido | null;
  versoes: VersaoPedido[];
  divergencias: Divergencia[];
  tarefas: Tarefa[];
  // Eventos derivados expostos em campos proprios (RF6): nao entram no
  // calculo de divergencias nem de tarefas.
  sinais: Sinal[];
  notificacoes: Notificacao[];
  totalEventos: number;
}

// Contratos de resposta da API (contrato unico server x web, RF8).

export interface ItemRevisao {
  id: number;
  origem: string;
  motivo: string;
  payload: Record<string, unknown>;
  status: 'pendente' | 'aprovado' | 'descartado';
  ts: string;
  // Presente quando o item carrega uma proposta de mapeamento (RF11):
  // a aprovacao executa o ingest com ela e guarda o template.
  proposta?: PropostaMapeamento;
}

export interface ResultadoIngest {
  pedidoId: string | null;
  docs: number;
  eventos: number;
  revisaoId: number | null;
  ok?: boolean;
}

export interface ResultadoAncora {
  ok: boolean;
  motivo?: string;
  root?: string;
  txHash?: string;
  url?: string;
}

export interface RespostaAuditoria {
  valida: boolean;
  total: number;
  indiceFalha: number | null;
  eventoFalha: Evento | null;
  hashEsperado: string | null;
  hashEncontrado: string | null;
  ancora: Record<string, unknown> | null;
  rootAtual: string;
  rootHistorico: string | null;
  rootConfere: boolean | null;
  eventosAncorados: number | null;
}

export interface RespostaSimulacao {
  divergencias: Divergencia[];
  tarefas: Tarefa[];
  simulacao: true;
}
