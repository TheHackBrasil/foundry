// Evidencia do operador (spec 0017, RF17 e RF25): audio, transcricao e
// mensagem de WhatsApp ficam na tabela evidencias, enderecados por
// (workspace_id, hash sha256) e apagados em apagar_em (90 dias por padrao).
// Fora dela circula so o hash. O download aceita so https em host de uma
// lista fechada, com limite de tamanho e de tipo; o fetch entra por parametro.
// A gravacao passa pela PortaEvidencias, que a integracao liga ao store.
//
// Tambem fica aqui a varredura do invariante 6: payload de evento do operador
// leva so ids, contatoId e hashes; telefone, e-mail ou texto com cara de
// transcricao fazem a varredura falhar.

import { createHash } from 'node:crypto';
import { normalizarTelefoneE164 } from './politica.js';

export const TIPOS_EVIDENCIA = ['audio', 'transcricao', 'whatsapp'] as const;

export type TipoEvidencia = (typeof TIPOS_EVIDENCIA)[number];

// OPERADOR_RETENCAO_DIAS, lido fora daqui (RF25 e resposta do clarify).
export const RETENCAO_PADRAO_DIAS = 90;

const DIA_MS = 86_400_000;
const MIB = 1024 * 1024;

// Limites padrao por tipo. Uma ligacao de 10 min em WAV mono de 8 kHz tem
// perto de 10 MB; o teto de audio deixa folga para estereo ou taxa maior.
export const LIMITE_BYTES_PADRAO: Readonly<Record<TipoEvidencia, number>> = {
  audio: 25 * MIB,
  transcricao: 2 * MIB,
  whatsapp: 5 * MIB,
};

// Media types aceitos por tipo (sem parametros, em minusculas). O fornecedor
// que servir outro tipo precisa entrar pela opcao tiposConteudo.
export const TIPOS_CONTEUDO_PADRAO: Readonly<Record<TipoEvidencia, readonly string[]>> = {
  audio: ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/webm', 'audio/mp4', 'audio/aac', 'audio/flac'],
  transcricao: ['application/json', 'text/plain'],
  whatsapp: ['application/json', 'text/plain', 'audio/ogg'],
};

export const TIMEOUT_DOWNLOAD_PADRAO_MS = 30_000;
export const MAX_REDIRECIONAMENTOS_PADRAO = 3;

// Linha da tabela evidencias, chave (workspace_id, hash). A porta grava de
// forma idempotente: o mesmo conteudo no mesmo workspace nao duplica.
export interface RegistroEvidencia {
  workspaceId: string;
  hash: string; // sha256 hex do conteudo
  tipo: TipoEvidencia;
  conteudo: Buffer;
  apagarEm: Date; // coluna apagar_em TIMESTAMPTZ
}

export interface PortaEvidencias {
  gravar(registro: RegistroEvidencia): Promise<void>;
}

export function sha256Hex(conteudo: Uint8Array | string): string {
  return createHash('sha256').update(conteudo).digest('hex');
}

// Instante de apagar a evidencia: agora mais a retencao em dias. Retencao
// invalida falha cedo em vez de gravar evidencia sem prazo.
export function calcularApagarEm(agoraMs: number, retencaoDias: number = RETENCAO_PADRAO_DIAS): Date {
  if (!Number.isFinite(agoraMs)) throw new RangeError(`instante invalido: ${agoraMs}`);
  if (!Number.isFinite(retencaoDias) || retencaoDias <= 0) throw new RangeError(`retencao invalida: ${retencaoDias}`);
  return new Date(agoraMs + retencaoDias * DIA_MS);
}

export interface EntradaEvidencia {
  workspaceId: string;
  tipo: TipoEvidencia;
  conteudo: Buffer;
  agoraMs: number;
  retencaoDias?: number;
}

export interface EvidenciaSalva {
  hash: string;
  apagarEm: Date;
  bytes: number;
}

// Calcula o hash e grava pela porta. O hash devolvido e o que vai para o
// payload do evento (ligacao_concluida, por exemplo).
export async function salvarEvidencia(porta: PortaEvidencias, entrada: EntradaEvidencia): Promise<EvidenciaSalva> {
  if (!entrada.workspaceId.trim()) throw new RangeError('workspace vazio');
  if (!(TIPOS_EVIDENCIA as readonly string[]).includes(entrada.tipo)) throw new RangeError(`tipo de evidencia invalido: ${entrada.tipo}`);
  const apagarEm = calcularApagarEm(entrada.agoraMs, entrada.retencaoDias);
  const hash = sha256Hex(entrada.conteudo);
  await porta.gravar({ workspaceId: entrada.workspaceId, hash, tipo: entrada.tipo, conteudo: entrada.conteudo, apagarEm });
  return { hash, apagarEm, bytes: entrada.conteudo.byteLength };
}

// fetch injetado: o global serve, e o teste passa um falso.
export type FetchEvidencia = (url: string, init: RequestInit) => Promise<Response>;

export interface OpcoesDownload {
  hostsPermitidos: readonly string[]; // nomes exatos, sem curinga
  fetch: FetchEvidencia;
  // Ex.: chave de API do fornecedor. Vai so para o host da URL original;
  // redirecionamento para outro host perde os cabecalhos.
  cabecalhos?: Readonly<Record<string, string>>;
  limiteBytes?: number;
  tiposConteudo?: readonly string[];
  timeoutMs?: number;
  maxRedirecionamentos?: number;
}

export type MotivoDownload =
  | 'url_invalida'
  | 'nao_https'
  | 'host_nao_permitido'
  | 'redirecionamento_invalido'
  | 'muitos_redirecionamentos'
  | 'status_http'
  | 'tipo_nao_permitido'
  | 'tamanho_excedido'
  | 'vazio'
  | 'falha_rede';

export type ResultadoDownload =
  | { ok: true; conteudo: Buffer; hash: string; tipoConteudo: string; bytes: number }
  | { ok: false; motivo: MotivoDownload; status?: number };

// URL aceita para download: https, porta padrao, sem usuario nem senha e
// host na lista (comparacao exata, sem subdominio implicito).
export function validarUrlEvidencia(
  bruta: string,
  hostsPermitidos: readonly string[],
): { ok: true; url: URL } | { ok: false; motivo: 'url_invalida' | 'nao_https' | 'host_nao_permitido' } {
  let url: URL;
  try {
    url = new URL(bruta);
  } catch {
    return { ok: false, motivo: 'url_invalida' };
  }
  if (url.protocol !== 'https:') return { ok: false, motivo: 'nao_https' };
  if (url.username || url.password || url.port !== '') return { ok: false, motivo: 'url_invalida' };
  const permitidos = new Set(hostsPermitidos.map((h) => h.trim().toLowerCase()).filter(Boolean));
  if (!permitidos.has(url.hostname.toLowerCase())) return { ok: false, motivo: 'host_nao_permitido' };
  return { ok: true, url };
}

function tipoDeConteudo(cabecalho: string | null): string {
  return (cabecalho ?? '').split(';')[0]!.trim().toLowerCase();
}

// Le o corpo contando bytes e desiste ao passar do limite: o Content-Length
// e checado antes, mas nao e confiavel sozinho.
async function lerComLimite(resposta: Response, limite: number): Promise<Buffer | null> {
  if (!resposta.body) return Buffer.alloc(0);
  const leitor = resposta.body.getReader();
  const partes: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await leitor.read();
    if (done) break;
    total += value.byteLength;
    if (total > limite) {
      await leitor.cancel().catch(() => {});
      return null;
    }
    partes.push(value);
  }
  return Buffer.concat(partes);
}

function descartar(resposta: Response): void {
  resposta.body?.cancel().catch(() => {});
}

const REDIRECIONAMENTOS = new Set([301, 302, 303, 307, 308]);

type Falha = Extract<ResultadoDownload, { ok: false }>;

// Destino de um redirecionamento, validado contra a mesma lista de hosts.
function proximoSalto(resposta: Response, atual: URL, hostsPermitidos: readonly string[]): URL | Falha {
  const destino = resposta.headers.get('location');
  if (!destino) return { ok: false, motivo: 'redirecionamento_invalido' };
  let proxima: URL;
  try {
    proxima = new URL(destino, atual);
  } catch {
    return { ok: false, motivo: 'redirecionamento_invalido' };
  }
  const valida = validarUrlEvidencia(proxima.href, hostsPermitidos);
  return valida.ok ? valida.url : { ok: false, motivo: 'redirecionamento_invalido' };
}

// Resposta final (sem redirecionamento): status, tipo e tamanho.
async function aceitarResposta(resposta: Response, tipos: ReadonlySet<string>, limite: number): Promise<ResultadoDownload> {
  if (resposta.status < 200 || resposta.status > 299) {
    descartar(resposta);
    return { ok: false, motivo: 'status_http', status: resposta.status };
  }
  const tipoConteudo = tipoDeConteudo(resposta.headers.get('content-type'));
  if (!tipos.has(tipoConteudo)) {
    descartar(resposta);
    return { ok: false, motivo: 'tipo_nao_permitido' };
  }
  const declarado = Number(resposta.headers.get('content-length') ?? Number.NaN);
  if (Number.isFinite(declarado) && declarado > limite) {
    descartar(resposta);
    return { ok: false, motivo: 'tamanho_excedido' };
  }
  const conteudo = await lerComLimite(resposta, limite);
  if (conteudo === null) return { ok: false, motivo: 'tamanho_excedido' };
  if (conteudo.byteLength === 0) return { ok: false, motivo: 'vazio' };
  return { ok: true, conteudo, hash: sha256Hex(conteudo), tipoConteudo, bytes: conteudo.byteLength };
}

// Baixa a evidencia do fornecedor. Nunca lanca: falha vira motivo, e a URL
// (que pode levar assinatura do fornecedor) nao entra no resultado.
// Redirecionamento e seguido a mao, com cada salto validado contra a lista.
export async function baixarEvidencia(bruta: string, tipo: TipoEvidencia, opcoes: OpcoesDownload): Promise<ResultadoDownload> {
  const limite = opcoes.limiteBytes ?? LIMITE_BYTES_PADRAO[tipo];
  const tipos = new Set((opcoes.tiposConteudo ?? TIPOS_CONTEUDO_PADRAO[tipo]).map((t) => t.toLowerCase()));
  const maxSaltos = opcoes.maxRedirecionamentos ?? MAX_REDIRECIONAMENTOS_PADRAO;
  const inicial = validarUrlEvidencia(bruta, opcoes.hostsPermitidos);
  if (!inicial.ok) return { ok: false, motivo: inicial.motivo };
  const hostOriginal = inicial.url.hostname.toLowerCase();
  const sinal = AbortSignal.timeout(opcoes.timeoutMs ?? TIMEOUT_DOWNLOAD_PADRAO_MS);

  try {
    let url = inicial.url;
    for (let salto = 0; ; salto += 1) {
      const mesmoHost = url.hostname.toLowerCase() === hostOriginal;
      const resposta = await opcoes.fetch(url.href, {
        method: 'GET',
        headers: mesmoHost ? { ...opcoes.cabecalhos } : {},
        redirect: 'manual',
        signal: sinal,
      });
      if (!REDIRECIONAMENTOS.has(resposta.status)) return await aceitarResposta(resposta, tipos, limite);
      descartar(resposta);
      if (salto >= maxSaltos) return { ok: false, motivo: 'muitos_redirecionamentos' };
      const proxima = proximoSalto(resposta, url, opcoes.hostsPermitidos);
      if (!(proxima instanceof URL)) return proxima;
      url = proxima;
    }
  } catch {
    // Timeout, DNS, conexao recusada: o detalhe pode levar a URL, entao fica fora.
    return { ok: false, motivo: 'falha_rede' };
  }
}

export interface EntradaDownload {
  url: string;
  tipo: TipoEvidencia;
  workspaceId: string;
  agoraMs: number;
  retencaoDias?: number;
}

export type ResultadoEvidencia =
  | ({ ok: true; tipoConteudo: string } & EvidenciaSalva)
  | { ok: false; motivo: MotivoDownload | 'falha_gravacao'; status?: number };

// Baixa e grava. O hash do resultado e o mesmo gravado na tabela.
export async function baixarESalvarEvidencia(
  porta: PortaEvidencias,
  entrada: EntradaDownload,
  opcoes: OpcoesDownload,
): Promise<ResultadoEvidencia> {
  const baixado = await baixarEvidencia(entrada.url, entrada.tipo, opcoes);
  if (!baixado.ok) return baixado;
  try {
    const salva = await salvarEvidencia(porta, {
      workspaceId: entrada.workspaceId,
      tipo: entrada.tipo,
      conteudo: baixado.conteudo,
      agoraMs: entrada.agoraMs,
      retencaoDias: entrada.retencaoDias,
    });
    return { ok: true, tipoConteudo: baixado.tipoConteudo, ...salva };
  } catch {
    return { ok: false, motivo: 'falha_gravacao' };
  }
}

// ---------------------------------------------------------------------------
// Invariante 6: nenhum dado pessoal no payload de evento.

export type TipoAchado = 'telefone' | 'email' | 'texto_livre' | 'chave_proibida' | 'binario';

// Onde estava e o que parecia; o valor encontrado nunca entra no achado,
// para o erro poder ir para o log sem vazar o dado.
export interface AchadoDadoPessoal {
  caminho: string;
  tipo: TipoAchado;
}

// Nomes de campo que so carregam dado pessoal ou conteudo. Comparacao exata
// depois de normalizar (minusculas, sem acento, sem '_' e '-'): hashAudio e
// hashTranscricao passam, audio e transcricao nao. 'email' fica fora porque
// tambem e nome de canal (prazos por canal no snapshot da politica).
export const CHAVES_PROIBIDAS = [
  'telefone',
  'fone',
  'phone',
  'celular',
  'destino',
  'destinatario',
  'nome',
  'mensagem',
  'roteiro',
  'transcricao',
  'transcript',
  'audio',
  'eml',
] as const;

// A partir de quantas palavras um texto deixa de ser codigo ou id e passa a
// ser texto livre (mensagem, roteiro, transcricao). Palavra = trecho entre
// espacos com pelo menos duas letras; hash e snake_case contam como uma.
export const LIMITE_PALAVRAS_PAYLOAD = 8;

// Quantificadores limitados (tamanhos do RFC 5321) para a busca seguir
// linear em texto grande. Pega um pouco a mais que e-mail valido: na
// duvida, recusar o payload e o lado seguro.
const EMAIL = /[\p{L}\p{N}._%+-]{1,64}@[\p{L}\p{N}-]{1,63}(?:\.[\p{L}\p{N}-]{1,63}){1,8}/u;

// Fala com rotulo de quem fala, no inicio de uma linha: "Atendente: ...".
const ROTULO_FALA =
  /^[ \t]*(?:agente|atendente|assistente|usu[aá]rio|cliente|operador|transportadora|motorista|user|agent|assistant|caller|callee)[ \t]*:/imu;

export function contemEmail(texto: string): boolean {
  return EMAIL.test(texto);
}

// Procura telefone em texto livre sem confundir com hash, uuid, data ou a
// chave de 44 digitos: so vale trecho de digitos (com + ( ) . - e espaco)
// separado de letras por algo que nao e letra nem digito, e o candidato tem
// de normalizar para E.164 pela mesma regra da politica. Janelas de ate
// cinco pedacos cobrem "+55 (11) 9 8765-4321".
export function contemTelefone(texto: string): boolean {
  for (const trecho of texto.split(/[^\p{L}\p{N}\s+().-]+/u)) {
    const pedacos = trecho.split(/\s+/).filter(Boolean);
    for (let i = 0; i < pedacos.length; i += 1) {
      if (janelaTemTelefone(pedacos, i)) return true;
    }
  }
  return false;
}

const TEM_LETRA = /[\p{L}_]/u;

// Pedaco com letra (hash, uuid, palavra) interrompe a janela.
function janelaTemTelefone(pedacos: readonly string[], inicio: number): boolean {
  const janela: string[] = [];
  for (const pedaco of pedacos.slice(inicio, inicio + 5)) {
    if (TEM_LETRA.test(pedaco)) return false;
    janela.push(pedaco);
    // A normalizacao ja ignora ponto e hifen soltos nas pontas.
    if (normalizarTelefoneE164(janela.join(' '))) return true;
  }
  return false;
}

export function pareceTextoLivre(texto: string): boolean {
  if (ROTULO_FALA.test(texto)) return true;
  const palavras = texto.split(/\s+/).filter((p) => (p.match(/\p{L}/gu)?.length ?? 0) >= 2);
  return palavras.length >= LIMITE_PALAVRAS_PAYLOAD;
}

function normalizarChave(chave: string): string {
  return chave
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[_-]/g, '');
}

const CHAVES_PROIBIDAS_NORMALIZADAS = new Set<string>(CHAVES_PROIBIDAS);

// Numero como telefone: so celular nacional (11 digitos) ou com DDI 55 sem
// '+' (12 ou 13). Fixo de 10 digitos fica fora porque colide com epoch em
// segundos; telefone de verdade chega como texto.
function numeroPareceTelefone(n: number | bigint): boolean {
  const s = typeof n === 'bigint' ? n.toString() : Number.isSafeInteger(n) ? String(Math.abs(n)) : '';
  if (!(s.length === 11 || ((s.length === 12 || s.length === 13) && s.startsWith('55')))) return false;
  return normalizarTelefoneE164(s) !== null;
}

function varrerTexto(texto: string, caminho: string, achados: AchadoDadoPessoal[]): void {
  if (contemTelefone(texto)) achados.push({ caminho, tipo: 'telefone' });
  if (contemEmail(texto)) achados.push({ caminho, tipo: 'email' });
  if (pareceTextoLivre(texto)) achados.push({ caminho, tipo: 'texto_livre' });
}

// Varre o payload inteiro (objetos, listas, chaves e valores) e devolve tudo
// o que parece dado pessoal. Lista vazia = payload limpo.
export function varrerDadoPessoal(payload: unknown): AchadoDadoPessoal[] {
  const achados: AchadoDadoPessoal[] = [];
  const vistos = new WeakSet<object>();
  const visitar = (valor: unknown, caminho: string): void => {
    if (typeof valor === 'string') return varrerTexto(valor, caminho, achados);
    if (typeof valor === 'number' || typeof valor === 'bigint') {
      if (numeroPareceTelefone(valor)) achados.push({ caminho, tipo: 'telefone' });
      return;
    }
    if (valor === null || typeof valor !== 'object') return;
    if (vistos.has(valor)) return;
    vistos.add(valor);
    if (ArrayBuffer.isView(valor) || valor instanceof ArrayBuffer) {
      // Bytes crus (audio, .eml) nunca vao para o payload.
      achados.push({ caminho, tipo: 'binario' });
      return;
    }
    if (Array.isArray(valor)) {
      valor.forEach((item, i) => visitar(item, `${caminho}[${i}]`));
      return;
    }
    for (const [chave, filho] of Object.entries(valor)) {
      const caminhoFilho = `${caminho}.${chave}`;
      if (filho !== null && filho !== undefined && CHAVES_PROIBIDAS_NORMALIZADAS.has(normalizarChave(chave))) {
        achados.push({ caminho: caminhoFilho, tipo: 'chave_proibida' });
      }
      varrerTexto(chave, `${caminhoFilho}(chave)`, achados);
      visitar(filho, caminhoFilho);
    }
  };
  visitar(payload, '$');
  return achados;
}

export class ErroDadoPessoal extends Error {
  readonly achados: readonly AchadoDadoPessoal[];
  constructor(achados: readonly AchadoDadoPessoal[]) {
    const lista = achados.map((a) => a.tipo + ' em ' + a.caminho).join(', ');
    super(`payload com dado pessoal: ${lista}`);
    this.name = 'ErroDadoPessoal';
    this.achados = achados;
  }
}

// Guarda para chamar antes do append de qualquer evento do operador.
export function exigirPayloadSemDadoPessoal(payload: unknown): void {
  const achados = varrerDadoPessoal(payload);
  if (achados.length > 0) throw new ErroDadoPessoal(achados);
}
