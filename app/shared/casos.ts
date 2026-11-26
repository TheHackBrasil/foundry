// Casos de excecao (spec 0011): projecao pura dos eventos. Um caso abre com
// 'divergencia' ou 'pendencia_aberta' (id = pedidoId:seq) e transita pelos
// eventos caso_*. Nenhum estado mutavel: reimportar a trilha reproduz tudo.

import {
  TIPOS_DOCUMENTO,
  type Caso,
  type CamposObservados,
  type Divergencia,
  type EstadoPlanoContato,
  type Evento,
  type FonteDocumento,
  type Metricas,
  type Parte,
  type PlanoContato,
} from './model.js';

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

// ---------------------------------------------------------------------------
// Operador (spec 0017, T722): projecao pura do plano de contato, das
// tentativas e da linha do tempo do caso, so a partir dos eventos. Os
// payloads levam so ids, contatoId, hashes e codigos (RF24, RF25); aqui nada
// e copiado por espalhamento, cada campo sai de uma lista fechada.

// Estados finais do plano: o primeiro que chega vale, e nada depois o muda,
// nem uma versao nova (ajustar so cria versao enquanto o plano esta aberto).
export const ESTADOS_TERMINAIS_PLANO: ReadonlySet<EstadoPlanoContato> = new Set<EstadoPlanoContato>([
  'recusado',
  'expirado',
  'aceito',
  'incerto',
  'falhou',
]);

export interface PlanoContatoProjetado extends PlanoContato {
  pedidoId: string;
  casoId?: string;
  aprovador?: string; // id do aprovador, nunca o token
  chave?: string; // chave do contato_iniciado (RF12)
  atualizadoEm: string; // ts do ultimo evento que mudou o plano
}

interface PayloadOperador {
  casoId?: unknown;
  planoId?: unknown;
  versao?: unknown;
  canal?: unknown;
  contatoId?: unknown;
  hashRoteiro?: unknown;
  prazo?: unknown;
  custoEstimadoBrl?: unknown;
  aprovador?: unknown;
  chave?: unknown;
  fornecedor?: unknown;
  idExterno?: unknown;
  motivo?: unknown;
  resultado?: unknown;
  duracaoS?: unknown;
  custoBrl?: unknown;
  hashAudio?: unknown;
  hashTranscricao?: unknown;
}

const texto = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 && v.length <= 200 ? v : undefined);
const numero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
const HEX64 = /^[0-9a-f]{64}$/;
const hashHex = (v: unknown): string | undefined => (typeof v === 'string' && HEX64.test(v) ? v : undefined);
// Codigo curto (motivo, resultado, canal): texto livre nao passa.
const codigo = (v: unknown): string | undefined => (typeof v === 'string' && /^[a-z][a-z0-9_]{0,47}$/.test(v) ? v : undefined);

function porSeq(eventos: readonly Evento[]): Evento[] {
  return [...eventos].sort((a, b) => a.pedidoId.localeCompare(b.pedidoId) || (a.seq ?? 0) - (b.seq ?? 0));
}

const SEP = '\u0000';
const chaveComposta = (pedidoId: string, id: string): string => `${pedidoId}${SEP}${id}`;

// Fold dos eventos contato_*. Regras:
// - contato_planejado com versao maior substitui o plano aberto e volta a
//   pedir decisao; versao igual ou menor e ignorada (a ultima versao vale);
// - aprovado e recusado so valem para a versao atual (aprovacao de versao
//   antiga nao libera a nova, invariante 2);
// - expirado fecha o plano proposto ou aprovado que ainda nao saiu;
// - iniciado so sai de aprovado e liga a chave ao plano;
// - aceito, incerto e falhou chegam pela chave (ou pelo planoId) e fecham;
// - o primeiro estado terminal vale: evento posterior nao muda o plano.
export function projetarPlanosContato(eventos: readonly Evento[]): PlanoContatoProjetado[] {
  const planos = new Map<string, PlanoContatoProjetado>();
  const planoDaChave = new Map<string, string>();
  for (const ev of porSeq(eventos)) {
    if (!ev.tipo.startsWith('contato_') || ev.tipo === 'contato_optout') continue;
    const p = ev.payload as PayloadOperador;
    const chave = texto(p.chave);
    const planoId = texto(p.planoId);
    const id =
      planoId !== undefined
        ? chaveComposta(ev.pedidoId, planoId)
        : chave !== undefined
          ? planoDaChave.get(chaveComposta(ev.pedidoId, chave))
          : undefined;
    if (id === undefined) continue;
    const atual = planos.get(id);
    if (atual && ESTADOS_TERMINAIS_PLANO.has(atual.estado)) continue;
    const versao = numero(p.versao);

    if (ev.tipo === 'contato_planejado') {
      const canal = p.canal === 'whatsapp' || p.canal === 'ligacao' ? p.canal : undefined;
      if (!canal || !planoId || versao === undefined || (atual && versao <= atual.versao)) continue;
      // Plano que ja saiu (iniciado) nao ganha versao nova.
      if (atual && atual.estado !== 'proposto' && atual.estado !== 'aprovado') continue;
      const casoId = texto(p.casoId) ?? atual?.casoId;
      planos.set(id, {
        planoId,
        pedidoId: ev.pedidoId,
        versao,
        canal,
        contatoId: numero(p.contatoId) ?? 0,
        hashRoteiro: hashHex(p.hashRoteiro) ?? '',
        prazo: texto(p.prazo) ?? '',
        custoEstimadoBrl: numero(p.custoEstimadoBrl) ?? 0,
        estado: 'proposto',
        ...(casoId ? { casoId } : {}),
        atualizadoEm: ev.ts,
      });
      continue;
    }
    if (!atual) continue;
    const mesmaVersao = versao === undefined || versao === atual.versao;
    switch (ev.tipo) {
      case 'contato_aprovado':
      case 'contato_recusado':
        if (atual.estado !== 'proposto' || versao !== atual.versao) break;
        atual.estado = ev.tipo === 'contato_aprovado' ? 'aprovado' : 'recusado';
        if (texto(p.aprovador)) atual.aprovador = texto(p.aprovador)!;
        atual.atualizadoEm = ev.ts;
        break;
      case 'contato_expirado':
        if ((atual.estado !== 'proposto' && atual.estado !== 'aprovado') || !mesmaVersao) break;
        atual.estado = 'expirado';
        atual.atualizadoEm = ev.ts;
        break;
      case 'contato_iniciado':
        if (atual.estado !== 'aprovado' || !chave || !mesmaVersao) break;
        atual.estado = 'iniciado';
        atual.chave = chave;
        planoDaChave.set(chaveComposta(ev.pedidoId, chave), id);
        atual.atualizadoEm = ev.ts;
        break;
      case 'contato_aceito':
      case 'contato_incerto':
      case 'contato_falhou': {
        // Falha antes do efeito (politica barrou, canal sem credencial) pode
        // vir sem chave, direto do aprovado.
        const deIniciado = atual.estado === 'iniciado' && (chave === undefined || chave === atual.chave);
        const semEfeito = atual.estado === 'aprovado' && ev.tipo === 'contato_falhou' && chave === undefined;
        if (!deIniciado && !semEfeito) break;
        atual.estado = ev.tipo === 'contato_aceito' ? 'aceito' : ev.tipo === 'contato_incerto' ? 'incerto' : 'falhou';
        atual.atualizadoEm = ev.ts;
        break;
      }
    }
  }
  return [...planos.values()];
}

// Tentativa de contato (RF12): uma por chave de contato_iniciado, com o que o
// fornecedor devolveu e o resultado da ligacao quando o webhook chega.
export type EstadoTentativa = 'iniciada' | 'aceita' | 'incerta' | 'falhou' | 'concluida';

export interface TentativaProjetada {
  chave: string;
  pedidoId: string;
  casoId?: string;
  planoId?: string;
  canal?: string;
  fornecedor?: string;
  idExterno?: string;
  estado: EstadoTentativa;
  motivo?: string;
  resultado?: string;
  duracaoS?: number;
  custoBrl?: number;
  hashAudio?: string;
  hashTranscricao?: string;
  iniciadaEm: string;
  atualizadaEm: string;
}

export function projetarTentativas(eventos: readonly Evento[]): TentativaProjetada[] {
  const tentativas = new Map<string, TentativaProjetada>();
  const porIdExterno = new Map<string, TentativaProjetada>();
  // casoId sem payload: o do operador_assumiu mais recente do pedido (o
  // fluxo trabalha um caso por vez em cada pedido).
  const assumido = new Map<string, string>();
  for (const ev of porSeq(eventos)) {
    const p = ev.payload as PayloadOperador;
    if (ev.tipo === 'operador_assumiu') {
      const c = texto(p.casoId);
      if (c) assumido.set(ev.pedidoId, c);
      continue;
    }
    if (ev.tipo === 'ligacao_concluida') {
      const idExterno = texto(p.idExterno);
      const t = idExterno ? porIdExterno.get(chaveComposta(ev.pedidoId, idExterno)) : undefined;
      if (!t || t.estado === 'concluida') continue;
      t.estado = 'concluida';
      if (codigo(p.resultado)) t.resultado = codigo(p.resultado)!;
      if (numero(p.duracaoS) !== undefined) t.duracaoS = numero(p.duracaoS)!;
      if (numero(p.custoBrl) !== undefined) t.custoBrl = numero(p.custoBrl)!;
      if (hashHex(p.hashAudio)) t.hashAudio = hashHex(p.hashAudio)!;
      if (hashHex(p.hashTranscricao)) t.hashTranscricao = hashHex(p.hashTranscricao)!;
      t.atualizadaEm = ev.ts;
      continue;
    }
    const chave = texto(p.chave);
    if (!chave) continue;
    const k = chaveComposta(ev.pedidoId, chave);
    if (ev.tipo === 'contato_iniciado') {
      if (tentativas.has(k)) continue; // o indice unico ja impede no banco
      const casoId = texto(p.casoId) ?? assumido.get(ev.pedidoId);
      tentativas.set(k, {
        chave,
        pedidoId: ev.pedidoId,
        ...(casoId ? { casoId } : {}),
        ...(texto(p.planoId) ? { planoId: texto(p.planoId)! } : {}),
        ...(codigo(p.canal) ? { canal: codigo(p.canal)! } : {}),
        ...(texto(p.fornecedor) ? { fornecedor: texto(p.fornecedor)! } : {}),
        estado: 'iniciada',
        iniciadaEm: ev.ts,
        atualizadaEm: ev.ts,
      });
      continue;
    }
    const t = tentativas.get(k);
    if (!t || t.estado !== 'iniciada') continue; // o primeiro desfecho vale
    if (ev.tipo === 'contato_aceito') {
      t.estado = 'aceita';
      const idExterno = texto(p.idExterno);
      if (idExterno) {
        t.idExterno = idExterno;
        porIdExterno.set(chaveComposta(ev.pedidoId, idExterno), t);
      }
    } else if (ev.tipo === 'contato_incerto' || ev.tipo === 'contato_falhou') {
      t.estado = ev.tipo === 'contato_incerto' ? 'incerta' : 'falhou';
      if (codigo(p.motivo)) t.motivo = codigo(p.motivo)!;
    } else continue;
    t.atualizadaEm = ev.ts;
  }
  return [...tentativas.values()];
}

// Linha do tempo do caso (RF26): cada acao com canal, horario, aprovacao e
// custo, os hashes da evidencia e as declaracoes com a confianca.
export type CategoriaLinhaTempo = 'caso' | 'operador' | 'aprovacao' | 'tentativa' | 'evidencia' | 'declaracao';

export interface ItemLinhaTempo {
  seq: number;
  ts: string;
  tipo: Evento['tipo'];
  categoria: CategoriaLinhaTempo;
  canal?: string;
  planoId?: string;
  versao?: number;
  chave?: string;
  aprovador?: string;
  fornecedor?: string;
  motivo?: string;
  resultado?: string;
  custoEstimadoBrl?: number; // do plano: estimativa (A7)
  custoBrl?: number; // do fornecedor, quando ele informa
  hashes?: string[]; // evidencias por hash: audio, transcricao, roteiro, .eml
  fonte?: FonteDocumento;
  campos?: CamposObservados;
  confianca?: number;
}

const FONTES_DECLARACAO: ReadonlySet<string> = new Set<FonteDocumento>([
  'email_transportadora',
  'whatsapp_transportadora',
  'ligacao_transportadora',
]);

const CATEGORIA_OPERADOR: Partial<Record<Evento['tipo'], CategoriaLinhaTempo>> = {
  operador_assumiu: 'operador',
  operador_escalou: 'operador',
  operador_encerrou: 'operador',
  contato_optout: 'operador',
  contato_planejado: 'aprovacao',
  contato_aprovado: 'aprovacao',
  contato_recusado: 'aprovacao',
  contato_expirado: 'aprovacao',
  cobranca_enviada: 'tentativa',
  cobranca_expirada: 'tentativa',
  contato_iniciado: 'tentativa',
  contato_aceito: 'tentativa',
  contato_incerto: 'tentativa',
  contato_falhou: 'tentativa',
  ligacao_concluida: 'evidencia',
};

function camposDeclarados(v: unknown): CamposObservados | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const c = v as Record<string, unknown>;
  const out: CamposObservados = {};
  if (typeof c['status'] === 'string') out.status = c['status'];
  if (typeof c['previsaoEntrega'] === 'string') out.previsaoEntrega = c['previsaoEntrega'];
  if (typeof c['pesoTotal'] === 'number') out.pesoTotal = c['pesoTotal'];
  if (typeof c['volumes'] === 'number') out.volumes = c['volumes'];
  return Object.keys(out).length > 0 ? out : undefined;
}

function hashesDe(...vs: unknown[]): string[] | undefined {
  const hs = vs.map(hashHex).filter((h): h is string => h !== undefined);
  return hs.length > 0 ? hs : undefined;
}

// Eventos do pedido que pertencem ao caso (id pedidoId:seq): a origem, os
// caso_* dele, os do operador com o casoId (ou, sem casoId, ligados a um
// plano ou tentativa do caso, ou ao operador_assumiu mais recente) e as
// declaracoes de transportadora posteriores a abertura.
export function linhaDoTempoCaso(eventos: readonly Evento[], casoId: string): ItemLinhaTempo[] {
  const sep = casoId.lastIndexOf(':');
  const pedidoId = casoId.slice(0, sep);
  const origemSeq = Number(casoId.slice(sep + 1));
  const doPedido = porSeq(eventos.filter((e) => e.pedidoId === pedidoId));
  if (sep <= 0 || !doPedido.some((e) => e.seq === origemSeq)) return [];

  const tentativas = projetarTentativas(doPedido);
  const planosDoCaso = new Set(
    projetarPlanosContato(doPedido)
      .filter((pl) => pl.casoId === casoId)
      .map((pl) => pl.planoId),
  );
  const doCaso = tentativas.filter((t) => t.casoId === casoId || (t.planoId !== undefined && planosDoCaso.has(t.planoId)));
  const chaves = new Set(doCaso.map((t) => t.chave));
  const idsExternos = new Set(doCaso.map((t) => t.idExterno).filter((x): x is string => x !== undefined));

  const out: ItemLinhaTempo[] = [];
  let assumido: string | undefined;
  for (const ev of doPedido) {
    const seq = ev.seq ?? 0;
    const p = ev.payload as PayloadOperador & { fonte?: unknown; campos?: unknown; confianca?: unknown; dados?: unknown };
    const casoEv = texto(p.casoId);
    if (ev.tipo === 'operador_assumiu' && casoEv) assumido = casoEv;
    const base = { seq, ts: ev.ts, tipo: ev.tipo };

    if (seq === origemSeq) {
      out.push({ ...base, categoria: 'caso' });
      continue;
    }
    if (ev.tipo.startsWith('caso_')) {
      if (casoEv === casoId) out.push({ ...base, categoria: 'caso' });
      continue;
    }
    if (ev.tipo === 'status_declarado') {
      const fonte = texto(p.fonte);
      if (seq < origemSeq || !fonte || !FONTES_DECLARACAO.has(fonte)) continue;
      const d = (p.dados && typeof p.dados === 'object' ? p.dados : {}) as Record<string, unknown>;
      const campos = camposDeclarados(p.campos);
      const hs = hashesDe(d['emlHash'], d['evidenciaHash']);
      out.push({
        ...base,
        categoria: 'declaracao',
        fonte: fonte as FonteDocumento,
        ...(campos ? { campos } : {}),
        ...(numero(p.confianca) !== undefined ? { confianca: numero(p.confianca)! } : {}),
        ...(hs ? { hashes: hs } : {}),
      });
      continue;
    }
    const categoria = CATEGORIA_OPERADOR[ev.tipo];
    if (!categoria) continue;
    const planoId = texto(p.planoId);
    const chave = texto(p.chave);
    const idExterno = texto(p.idExterno);
    const ligado =
      casoEv !== undefined
        ? casoEv === casoId
        : (planoId !== undefined && planosDoCaso.has(planoId)) ||
          (chave !== undefined && chaves.has(chave)) ||
          (idExterno !== undefined && idsExternos.has(idExterno)) ||
          (planoId === undefined && chave === undefined && idExterno === undefined && assumido === casoId);
    if (!ligado) continue;
    const hs = hashesDe(p.hashAudio, p.hashTranscricao, p.hashRoteiro);
    out.push({
      ...base,
      categoria,
      ...(codigo(p.canal) ? { canal: codigo(p.canal)! } : {}),
      ...(planoId ? { planoId } : {}),
      ...(numero(p.versao) !== undefined ? { versao: numero(p.versao)! } : {}),
      ...(chave ? { chave } : {}),
      ...(texto(p.aprovador) ? { aprovador: texto(p.aprovador)! } : {}),
      ...(texto(p.fornecedor) ? { fornecedor: texto(p.fornecedor)! } : {}),
      ...(codigo(p.motivo) ? { motivo: codigo(p.motivo)! } : {}),
      ...(codigo(p.resultado) ? { resultado: codigo(p.resultado)! } : {}),
      ...(numero(p.custoEstimadoBrl) !== undefined ? { custoEstimadoBrl: numero(p.custoEstimadoBrl)! } : {}),
      ...(numero(p.custoBrl) !== undefined ? { custoBrl: numero(p.custoBrl)! } : {}),
      ...(hs ? { hashes: hs } : {}),
    });
  }
  return out;
}
