// Fluxo duravel por caso (spec 0017, RF1, RF12, NFR-dados; T725). Um fluxo
// DBOS por caso, com id `workspace:pedidoId:seqOrigem:ciclo`, e no maximo um
// fluxo ativo por workspace, pedido e contraparte.
//
// O fluxo guarda passos, nunca fatos: o estado de negocio fica no ledger, e
// todo evento do operador e gravado num passo transacional (db-dbos.ts), com
// evento e checkpoint na mesma transacao. A excecao e o `contato_iniciado`,
// gravado com commit proprio dentro do passo do efeito, logo antes da chamada
// ao fornecedor: e a marca duravel da intencao (invariante 1) e o indice
// unico da chave (store.ts) impede duas intencoes iguais.
//
// Efeito externo (RF12): `contato_iniciado` e depois `contato_aceito`,
// `contato_incerto` ou `contato_falhou`. O passo do efeito nao tem retry.
// Se o passo roda de novo (queda no meio) e acha a intencao ja gravada, ele
// nao reenvia: consulta o fornecedor pela chave e, sem resposta, o caso volta
// ao analista.
//
// A politica do caso entra como snapshot no `operador_assumiu` (destinos e
// workspaces so como hash) e o fluxo nao le env depois disso. Kill switch,
// contato, contadores e lista de destinos vem por porta e sao lidos antes de
// cada efeito; a lista de destinos so vale se o hash bater com o snapshot.

import { createHash } from 'node:crypto';
import { DBOS, type WorkflowHandle } from '@dbos-inc/dbos-sdk';
import { projetarCasos, projetarPlanosContato, type PlanoContatoProjetado } from '../../shared/casos.js';
import type { Evento, Parte, TipoEvento } from '../../shared/model.js';
import type { ContatoDaAgenda } from '../../server/store.js';
import { hashRoteiro, montarRoteiro, serializarRoteiro } from '../roteiro.js';
import {
  avaliarPolitica,
  CANAIS_COM_APROVACAO,
  normalizarTelefoneE164,
  type CanalOperador,
  type ConfigPolitica,
  type ContadoresPolitica,
  type EstadoKillSwitch,
  type JanelaPolitica,
} from '../politica.js';
import {
  CANAIS_ESCADA,
  configEscada,
  degrauInicial,
  proximoPasso,
  type CanalEscada,
  type DegrauEscada,
  type MotivoPulo,
  type PuloDegrau,
} from './escada.js';

// --- Portas -----------------------------------------------------------------

export interface EventoNovo {
  tipo: TipoEvento;
  payload: Record<string, unknown>;
}

// Ledger do caso. `registrar` roda no passo transacional do DBOS (evento e
// checkpoint juntos); `registrarIntencao` grava com commit proprio e devolve
// 'ja_existia' quando o indice unico da chave recusa a segunda intencao.
// Com `revalidar`, a intencao so e gravada sob a trava do pedido (a mesma
// das rotas de plano) e depois de a funcao, lendo os eventos ja travados,
// devolver null; um codigo devolvido barra o efeito (T751).
export type ResultadoIntencao = 'gravado' | 'ja_existia' | { bloqueado: string };

export interface PortaLedger {
  registrar(nome: string, workspace: string, pedidoId: string, eventos: EventoNovo[]): Promise<Evento[]>;
  registrarIntencao(
    workspace: string,
    pedidoId: string,
    payload: Record<string, unknown>,
    revalidar?: (eventos: Evento[]) => string | null,
  ): Promise<ResultadoIntencao>;
  intencaoExiste(workspace: string, pedidoId: string, chave: string): Promise<boolean>;
}

// O que o fluxo le do caso ao acordar (o ledger e a fonte; o sinal so acelera).
export interface EstadoCasoFluxo {
  casoFechado: boolean;
  optout: boolean;
  declaracao: 'nenhuma' | 'em_revisao' | 'aceita';
  // Fim do contato do degrau (na ligacao, fim da chamada). null: ainda nao
  // terminou. Ausente: vale o instante do aceite.
  fimContatoMs?: number | null;
}

export interface PedidoEnvio {
  chave: string;
  canal: CanalOperador;
  workspace: string;
  pedidoId: string;
  casoId: string;
  contatoId: number;
  destino: string; // so atravessa a porta; nunca vai para evento nem checkpoint
  // WhatsApp e ligacao: o roteiro aprovado, pelo hash da evidencia (RF11).
  hashRoteiro?: string;
}

export type RespostaEnvio =
  | { status: 'aceito'; idExterno: string }
  | { status: 'recusado'; motivo: string };

export type RespostaConsulta = { status: 'aceito'; idExterno: string } | { status: 'desconhecido' };

// Um adaptador por canal e fornecedor. `enviar` que lanca e falha ambigua
// (timeout depois do pedido): o fluxo consulta pela chave antes de concluir.
// O adaptador repete a checagem de destino da politica (RF8).
export interface AdaptadorCanal {
  readonly canal: CanalOperador;
  readonly fornecedor: string;
  readonly custoEstimadoBrl: number;
  enviar(pedido: PedidoEnvio): Promise<RespostaEnvio>;
  consultar(chave: string): Promise<RespostaConsulta>;
}

export interface PortasFluxo {
  ledger: PortaLedger;
  canais: Partial<Record<CanalOperador, AdaptadorCanal>>;
  killSwitch(): Promise<EstadoKillSwitch>;
  contato(workspace: string, parte: Parte, canal: CanalOperador): Promise<ContatoDaAgenda | null>;
  contadores(consulta: { workspace: string; casoId: string; destinoE164: string | null; agoraMs: number }): Promise<ContadoresPolitica>;
  destinosPermitidos(): Promise<readonly string[]>;
  estadoCaso(workspace: string, pedidoId: string, casoId: string): Promise<EstadoCasoFluxo>;
  // Plano projetado do ledger (relido a cada vez que o fluxo acorda).
  planoContato(workspace: string, pedidoId: string, planoId: string): Promise<PlanoContatoProjetado | null>;
  // Roteiro preenchido e outras evidencias: fora do ledger (RF25).
  guardarEvidencia(workspace: string, hash: string, tipo: string, conteudo: Buffer): Promise<void>;
  // Nome da empresa contratante dito no roteiro; null usa o padrao.
  nomeEmpresa?(workspace: string, pedidoId: string): Promise<string | null>;
  agora(): number;
}

// Revalidacao sob a trava, antes do efeito (RF11, invariante 2): o caso
// segue aberto e o plano esta aprovado na versao e no roteiro que o fluxo
// leu, dentro da validade da aprovacao. Pura; devolve o codigo do bloqueio.
export function motivoAprovacaoInvalida(
  eventos: readonly Evento[],
  alvo: { casoId: string; planoId: string; versao: number; hashRoteiro: string; agoraMs: number; validadeMin: number },
): string | null {
  const caso = projetarCasos([...eventos]).find((c) => c.id === alvo.casoId);
  if (!caso || caso.status === 'resolvido') return 'caso_fechado';
  const plano = projetarPlanosContato(eventos).find((p) => p.planoId === alvo.planoId);
  if (!plano) return 'plano_ausente';
  if (plano.estado !== 'aprovado') return 'plano_nao_aprovado';
  if (plano.versao !== alvo.versao) return 'versao_antiga';
  if (plano.hashRoteiro !== alvo.hashRoteiro) return 'roteiro_mudou';
  const aprovadoEm = Date.parse(plano.atualizadoEm);
  if (!Number.isFinite(aprovadoEm) || alvo.agoraMs - aprovadoEm > alvo.validadeMin * 60_000) return 'aprovacao_vencida';
  return null;
}

// --- Entrada e snapshot -----------------------------------------------------

// Politica gravada no operador_assumiu: so o que pode ir para o ledger.
export interface SnapshotPolitica {
  workspaceHabilitado: boolean;
  workspacesHash: string;
  destinosHash: string;
  janela: JanelaPolitica;
  tentativasPorDestinoDia: number;
  tetoCasoBrl: number;
  tetoDiaBrl: number;
  prazoEmailH: number;
  prazoWhatsappH: number;
  aprovacaoValidadeMin: number;
}

export interface EntradaFluxoCaso {
  workspace: string;
  pedidoId: string;
  casoId: string;
  seqOrigem: number;
  ciclo: number;
  parte: Parte;
  gatilho: 'pendencia_aberta' | 'acionar_operador';
  politica: SnapshotPolitica;
}

export function sha256(texto: string): string {
  return createHash('sha256').update(texto).digest('hex');
}

// Hash da lista de destinos: E.164 normalizado, ordenado e sem repeticao.
export function hashDestinos(destinos: readonly string[]): string {
  const norm = [...new Set(destinos.map((d) => normalizarTelefoneE164(d) ?? `invalido:${d.trim()}`))].sort();
  return sha256(`destinos:${norm.join(',')}`);
}

export function hashWorkspaces(workspaces: readonly string[]): string {
  return sha256(`workspaces:${[...new Set(workspaces.map((w) => w.trim()))].sort().join(',')}`);
}

// Monta o snapshot uma vez, a partir da config lida do env fora daqui.
export function snapshotPolitica(
  workspace: string,
  config: ConfigPolitica,
  prazos: { emailH: number; whatsappH: number; aprovacaoValidadeMin: number },
): SnapshotPolitica {
  return {
    workspaceHabilitado: workspace.trim() !== '' && config.workspacesHabilitados.includes(workspace),
    workspacesHash: hashWorkspaces(config.workspacesHabilitados),
    destinosHash: hashDestinos(config.destinosPermitidos),
    janela: { ...config.janela },
    tentativasPorDestinoDia: config.tentativasPorDestinoDia,
    tetoCasoBrl: config.tetoCasoBrl,
    tetoDiaBrl: config.tetoDiaBrl,
    prazoEmailH: prazos.emailH,
    prazoWhatsappH: prazos.whatsappH,
    aprovacaoValidadeMin: prazos.aprovacaoValidadeMin,
  };
}

export function idFluxo(e: Pick<EntradaFluxoCaso, 'workspace' | 'pedidoId' | 'seqOrigem' | 'ciclo'>): string {
  return `${e.workspace}:${e.pedidoId}:${e.seqOrigem}:${e.ciclo}`;
}

// Chave do efeito (RF12): hash de fluxo, degrau e tentativa.
export function chaveEfeito(fluxoId: string, degrau: CanalEscada, tentativa: number): string {
  return sha256(`efeito:${fluxoId}:${degrau}:${tentativa}`);
}

// --- Resultado do efeito ----------------------------------------------------

export type ResultadoEfeito =
  | { tipo: 'bloqueado'; motivos: string[] }
  | { tipo: 'aceito'; chave: string; idExterno: string; instanteMs: number; consultado: boolean }
  | { tipo: 'falhou'; chave: string; motivo: string }
  | { tipo: 'incerto'; chave: string; motivo: string };

export type FimFluxo = { motivo: string; degrau: DegrauEscada };

export const TOPICO_ACORDAR = 'acordar';
export const TOPICO_APROVACAO = 'aprovacao';
const ESPERA_LONGA_S = 3600;
export const NOME_FLUXO_CASO = 'fluxoCaso';

// --- Fluxo ------------------------------------------------------------------

export interface FluxoCaso {
  workflow: (entrada: EntradaFluxoCaso) => Promise<FimFluxo>;
  abrir(entrada: EntradaFluxoCaso): Promise<ResultadoAbrir>;
  acordar(fluxoId: string): Promise<void>;
  // Sinal de plano (aprovado, recusado ou ajustado): o fluxo rele o ledger.
  aprovar(fluxoId: string, planoId: string, versao: number): Promise<void>;
  // Acorda os fluxos ativos do pedido (declaracao aprovada na revisao, RF18).
  acordarPedido(workspace: string, pedidoId: string): Promise<number>;
}

// 'fluxo_existente': o mesmo id ja rodou (terminou ou esta rodando); o caso
// nao ganha segunda escada.
export type ResultadoAbrir =
  | { aberto: true; fluxoId: string; handle: WorkflowHandle<FimFluxo> }
  | { aberto: false; motivo: 'fluxo_ativo' | 'fluxo_existente'; fluxoId: string };

const STATUS_ATIVOS = ['PENDING', 'ENQUEUED', 'DELAYED', 'SUSPENDED'] as const;

// Registra o fluxo no DBOS (antes de DBOS.launch) com as portas dadas.
export function registrarFluxoCaso(portas: PortasFluxo): FluxoCaso {
  const registrar = (nome: string, entrada: EntradaFluxoCaso, eventos: EventoNovo[]): Promise<Evento[]> =>
    portas.ledger.registrar(nome, entrada.workspace, entrada.pedidoId, eventos);

  // Canais com contato utilizavel, sem telefone na saida (vai para checkpoint).
  async function lerCanais(entrada: EntradaFluxoCaso): Promise<{
    canaisDisponiveis: CanalEscada[];
    motivosPulo: Partial<Record<CanalEscada, MotivoPulo>>;
  }> {
    const destinos = await portas.destinosPermitidos();
    const permitidos = new Set(destinos.map(normalizarTelefoneE164));
    const canaisDisponiveis: CanalEscada[] = [];
    const motivosPulo: Partial<Record<CanalEscada, MotivoPulo>> = {};
    for (const canal of CANAIS_ESCADA) {
      const c = portas.canais[canal] ? await portas.contato(entrada.workspace, entrada.parte, canal) : null;
      let motivo: MotivoPulo | null = null;
      if (!c) motivo = 'sem_contato';
      else if (c.fonte === 'seed') motivo = 'contato_seed';
      else if (c.fonte === 'documento') motivo = 'contato_documento';
      else if (c.naoContatarIa) motivo = 'nao_contatar_ia';
      else if ((CANAIS_COM_APROVACAO as readonly string[]).includes(canal)) {
        const e164 = normalizarTelefoneE164(c.destino);
        if (!e164 || !permitidos.has(e164)) motivo = 'destino_nao_permitido';
      }
      if (motivo) motivosPulo[canal] = motivo;
      else canaisDisponiveis.push(canal);
    }
    return { canaisDisponiveis, motivosPulo };
  }

  // Passo do efeito, sem retry. Ordem: intencao ja gravada (passo rodando de
  // novo) leva a consulta; senao politica com kill switch lido agora, depois
  // a intencao e so entao o fornecedor.
  async function efeito(
    entrada: EntradaFluxoCaso,
    fluxoId: string,
    canal: CanalEscada,
    tentativa: number,
    plano: { planoId: string; versao: number; hashRoteiro: string } | null,
  ): Promise<ResultadoEfeito> {
    const chave = chaveEfeito(fluxoId, canal, tentativa);
    const adaptador = portas.canais[canal];
    if (!adaptador) return { tipo: 'bloqueado', motivos: ['canal_sem_adaptador'] };

    const consultar = async (motivo: string): Promise<ResultadoEfeito> => {
      try {
        const r = await adaptador.consultar(chave);
        if (r.status === 'aceito') {
          return { tipo: 'aceito', chave, idExterno: r.idExterno, instanteMs: portas.agora(), consultado: true };
        }
      } catch {
        // Consulta sem resposta tambem devolve ao analista.
      }
      return { tipo: 'incerto', chave, motivo };
    };

    if (await portas.ledger.intencaoExiste(entrada.workspace, entrada.pedidoId, chave)) {
      return consultar('intencao_sem_aceite');
    }

    const killSwitch = await portas.killSwitch();
    const contato = await portas.contato(entrada.workspace, entrada.parte, canal);
    if (!contato) return { tipo: 'bloqueado', motivos: ['sem_contato'] };
    const destinos = await portas.destinosPermitidos();
    const motivos: string[] = [];
    if (hashDestinos(destinos) !== entrada.politica.destinosHash) motivos.push('destinos_mudaram');
    const agoraMs = portas.agora();
    const destinoE164 = canal === 'email' ? null : normalizarTelefoneE164(contato.destino);
    const contadores = await portas.contadores({ workspace: entrada.workspace, casoId: entrada.casoId, destinoE164, agoraMs });
    const p = entrada.politica;
    const decisao = avaliarPolitica({
      config: {
        workspacesHabilitados: p.workspaceHabilitado ? [entrada.workspace] : [],
        destinosPermitidos: motivos.length ? [] : destinos,
        janela: p.janela,
        tentativasPorDestinoDia: p.tentativasPorDestinoDia,
        tetoCasoBrl: p.tetoCasoBrl,
        tetoDiaBrl: p.tetoDiaBrl,
      },
      acao: { canal, workspace: entrada.workspace, contato, custoEstimadoBrl: adaptador.custoEstimadoBrl },
      contadores,
      agoraMs,
      killSwitch,
    });
    motivos.push(...decisao.motivos);
    if (motivos.length) return { tipo: 'bloqueado', motivos };

    // WhatsApp e ligacao: a aprovacao e revalidada sob a trava do pedido, na
    // mesma transacao que grava a intencao (T751).
    const revalidar = plano
      ? (eventos: Evento[]) =>
          motivoAprovacaoInvalida(eventos, {
            casoId: entrada.casoId,
            planoId: plano.planoId,
            versao: plano.versao,
            hashRoteiro: plano.hashRoteiro,
            agoraMs,
            validadeMin: p.aprovacaoValidadeMin,
          })
      : undefined;
    const gravou = await portas.ledger.registrarIntencao(
      entrada.workspace,
      entrada.pedidoId,
      {
        fluxoId,
        casoId: entrada.casoId,
        chave,
        canal,
        fornecedor: adaptador.fornecedor,
        contatoId: contato.id,
        tentativa,
        custoEstimadoBrl: adaptador.custoEstimadoBrl,
        ...(plano ? { planoId: plano.planoId, versao: plano.versao, hashRoteiro: plano.hashRoteiro } : {}),
      },
      revalidar,
    );
    if (gravou === 'ja_existia') return consultar('intencao_sem_aceite');
    if (typeof gravou === 'object') return { tipo: 'bloqueado', motivos: [gravou.bloqueado] };

    let resposta: RespostaEnvio;
    try {
      resposta = await adaptador.enviar({
        chave,
        canal,
        workspace: entrada.workspace,
        pedidoId: entrada.pedidoId,
        casoId: entrada.casoId,
        contatoId: contato.id,
        destino: contato.destino,
        ...(plano ? { hashRoteiro: plano.hashRoteiro } : {}),
      });
    } catch {
      return consultar('falha_ambigua');
    }
    if (resposta.status === 'recusado') return { tipo: 'falhou', chave, motivo: resposta.motivo };
    return { tipo: 'aceito', chave, idExterno: resposta.idExterno, instanteMs: portas.agora(), consultado: false };
  }

  async function fluxoCaso(entrada: EntradaFluxoCaso): Promise<FimFluxo> {
    const fluxoId = DBOS.workflowID ?? idFluxo(entrada);
    const config = configEscada({ emailH: entrada.politica.prazoEmailH, whatsappH: entrada.politica.prazoWhatsappH });
    const canais = await DBOS.runStep(() => lerCanais(entrada), { name: 'lerCanais' });
    const inicial = degrauInicial(canais);
    await registrar('assumir', entrada, [
      {
        tipo: 'operador_assumiu',
        payload: {
          fluxoId,
          casoId: entrada.casoId,
          gatilho: entrada.gatilho,
          parte: entrada.parte,
          politica: { ...entrada.politica },
          degrau: inicial.degrau,
          pulos: inicial.pulos,
        },
      },
    ]);

    const encerrar = async (degrau: DegrauEscada, motivo: string, extra: Record<string, unknown> = {}): Promise<FimFluxo> => {
      await registrar('encerrar', entrada, [
        { tipo: 'operador_encerrou', payload: { fluxoId, casoId: entrada.casoId, degrau, motivo, ...extra } },
      ]);
      return { motivo, degrau };
    };
    const escalar = async (de: DegrauEscada, para: DegrauEscada, motivo: string, pulos: PuloDegrau[]): Promise<void> => {
      await registrar('escalar', entrada, [
        { tipo: 'operador_escalou', payload: { fluxoId, casoId: entrada.casoId, de, para, motivo, pulos } },
      ]);
    };

    // Plano proposto (roteiro em evidencia, so o hash no ledger) e espera do
    // OK. Cada vez que acorda, o fluxo rele o plano e o caso no ledger; o
    // sinal da rota so acelera. Caso fechado ou opt-out cancela o plano que
    // nao saiu; prazo vencido sem decisao grava contato_expirado.
    type PlanoAprovado = { planoId: string; versao: number; hashRoteiro: string };
    const esperarAprovacao = async (
      canal: 'whatsapp' | 'ligacao',
      planoId: string,
      motivo: string,
    ): Promise<{ plano: PlanoAprovado } | { fim: FimFluxo }> => {
      const prep = await DBOS.runStep(
        async () => {
          const contato = await portas.contato(entrada.workspace, entrada.parte, canal);
          if (!contato) return null;
          const empresa = portas.nomeEmpresa ? await portas.nomeEmpresa(entrada.workspace, entrada.pedidoId) : null;
          const roteiro = montarRoteiro({
            canal,
            chaveNota: entrada.pedidoId,
            motivo,
            contato: { nome: contato.nome, destino: contato.destino },
            empresa,
          });
          const conteudo = serializarRoteiro(roteiro);
          const hash = hashRoteiro(conteudo);
          await portas.guardarEvidencia(entrada.workspace, hash, 'roteiro', conteudo);
          // So id e hash saem do passo: o telefone nao vai para o checkpoint.
          return { contatoId: contato.id, hashRoteiro: hash, prazoMs: portas.agora() + entrada.politica.aprovacaoValidadeMin * 60_000 };
        },
        { name: 'prepararPlano' },
      );
      if (!prep) return { fim: await encerrar(canal, 'politica', { motivos: ['sem_contato'] }) };
      await registrar('planejar', entrada, [
        {
          tipo: 'contato_planejado',
          payload: {
            fluxoId,
            casoId: entrada.casoId,
            planoId,
            versao: 1,
            canal,
            contatoId: prep.contatoId,
            hashRoteiro: prep.hashRoteiro,
            prazo: new Date(prep.prazoMs).toISOString(),
            custoEstimadoBrl: portas.canais[canal]?.custoEstimadoBrl ?? null,
            motivo,
          },
        },
      ]);
      const fechar = (tipo: 'contato_expirado', versao: number): Promise<Evento[]> =>
        registrar('expirar', entrada, [{ tipo, payload: { fluxoId, casoId: entrada.casoId, planoId, versao } }]);
      for (;;) {
        const agora = await DBOS.runStep(async () => portas.agora(), { name: 'agora' });
        const atual = await DBOS.runStep(() => portas.planoContato(entrada.workspace, entrada.pedidoId, planoId), { name: 'lerPlano' });
        const caso = await DBOS.runStep(() => portas.estadoCaso(entrada.workspace, entrada.pedidoId, entrada.casoId), {
          name: 'estadoCaso',
        });
        if (caso.casoFechado || caso.optout) {
          if (atual && (atual.estado === 'proposto' || atual.estado === 'aprovado')) await fechar('contato_expirado', atual.versao);
          return { fim: await encerrar(caso.casoFechado ? canal : 'analista', caso.casoFechado ? 'caso_fechado' : 'optout') };
        }
        if (!atual) return { fim: await encerrar(canal, 'plano_ausente') };
        if (atual.estado === 'aprovado') return { plano: { planoId, versao: atual.versao, hashRoteiro: atual.hashRoteiro } };
        if (atual.estado !== 'proposto') {
          return { fim: await encerrar(canal, atual.estado === 'recusado' ? 'plano_recusado' : `plano_${atual.estado}`) };
        }
        const restanteMs = Date.parse(atual.prazo) - agora;
        if (!(restanteMs > 0)) {
          await fechar('contato_expirado', atual.versao);
          return { fim: await encerrar(canal, 'sem_aprovacao') };
        }
        await DBOS.recv<unknown>(TOPICO_APROVACAO, { timeoutSeconds: Math.max(1, Math.ceil(restanteMs / 1000)) });
      }
    };

    let degrau: DegrauEscada = inicial.degrau;
    let motivoDegrau = entrada.gatilho === 'acionar_operador' ? 'divergencia' : 'pendencia';
    const tentativas: Partial<Record<CanalEscada, number>> = {};
    for (;;) {
      if (degrau === 'analista') return encerrar('analista', 'escada_esgotada');
      const canal: CanalEscada = degrau;
      const tentativa = (tentativas[canal] ?? 0) + 1;
      tentativas[canal] = tentativa;

      // WhatsApp e ligacao: plano proposto e espera do OK (RF7, RF11, T751).
      let plano: { planoId: string; versao: number; hashRoteiro: string } | null = null;
      if ((CANAIS_COM_APROVACAO as readonly string[]).includes(canal)) {
        const planoId = sha256(`plano:${fluxoId}:${canal}:${tentativa}`);
        const r = await esperarAprovacao(canal as 'whatsapp' | 'ligacao', planoId, motivoDegrau);
        if ('fim' in r) return r.fim;
        plano = r.plano;
      }

      const r = await DBOS.runStep(() => efeito(entrada, fluxoId, canal, tentativa, plano), {
        name: `efeito:${canal}`,
        retriesAllowed: false,
      });
      if (r.tipo === 'bloqueado') {
        // Plano aprovado que nao saiu fecha como falhou, sem chave (a
        // projecao entende), e o caso volta ao analista.
        if (plano) {
          await registrar('barrado', entrada, [
            {
              tipo: 'contato_falhou',
              payload: { fluxoId, casoId: entrada.casoId, planoId: plano.planoId, versao: plano.versao, canal, motivo: r.motivos[0] ?? 'politica' },
            },
          ]);
        }
        return encerrar(canal, 'politica', { motivos: r.motivos });
      }
      if (r.tipo === 'incerto') {
        await registrar('incerto', entrada, [
          { tipo: 'contato_incerto', payload: { fluxoId, casoId: entrada.casoId, chave: r.chave, canal, motivo: r.motivo } },
        ]);
        return encerrar(canal, 'contato_incerto');
      }
      if (r.tipo === 'falhou') {
        await registrar('falhou', entrada, [
          { tipo: 'contato_falhou', payload: { fluxoId, casoId: entrada.casoId, chave: r.chave, canal, motivo: r.motivo } },
        ]);
        // Sem retry no mesmo degrau: falha definitiva conta como prazo vencido.
        const passo = proximoPasso(
          { ...canais, degrau: canal, decorridoMs: Number.POSITIVE_INFINITY, declaracao: 'nenhuma', optout: false, casoFechado: false },
          config,
        );
        if (passo.acao !== 'subir') return encerrar('analista', 'contato_falhou');
        await escalar(canal, passo.para, 'contato_falhou', passo.pulos);
        degrau = passo.para;
        motivoDegrau = 'contato_falhou';
        continue;
      }
      await registrar('aceito', entrada, [
        {
          tipo: 'contato_aceito',
          payload: { fluxoId, casoId: entrada.casoId, chave: r.chave, canal, idExterno: r.idExterno, consultado: r.consultado },
        },
      ]);

      // Espera no degrau: o sinal so acelera, o fluxo rele o caso ao acordar.
      let inicioPrazo = r.instanteMs;
      let esperaS = 0;
      for (;;) {
        if (esperaS > 0) await DBOS.recv<unknown>(TOPICO_ACORDAR, { timeoutSeconds: esperaS });
        const estado = await DBOS.runStep(() => portas.estadoCaso(entrada.workspace, entrada.pedidoId, entrada.casoId), {
          name: 'estadoCaso',
        });
        const agora = await DBOS.runStep(async () => portas.agora(), { name: 'agora' });
        const fim = estado.fimContatoMs === undefined ? inicioPrazo : estado.fimContatoMs;
        const decorridoMs = fim === null ? null : Math.max(0, agora - Math.max(fim, inicioPrazo));
        const passo = proximoPasso(
          { ...canais, degrau: canal, decorridoMs, declaracao: estado.declaracao, optout: estado.optout, casoFechado: estado.casoFechado },
          config,
        );
        if (passo.acao === 'encerrar') return encerrar(passo.para, passo.motivo);
        if (passo.acao === 'subir') {
          await escalar(canal, passo.para, passo.motivo, passo.pulos);
          degrau = passo.para;
          motivoDegrau = passo.motivo;
          break;
        }
        if (passo.acao === 'reiniciar') inicioPrazo = agora;
        esperaS =
          passo.acao === 'manter' && passo.restanteMs !== undefined
            ? Math.max(1, Math.ceil(passo.restanteMs / 1000))
            : passo.acao === 'reiniciar'
              ? Math.max(1, Math.ceil(config.prazoMs[canal] / 1000))
              : ESPERA_LONGA_S;
      }
    }
  }

  const workflow = DBOS.registerWorkflow(fluxoCaso, { name: NOME_FLUXO_CASO });

  // Fila local: so ha um executor (lock de lider), entao serializar aqui
  // fecha a corrida entre conferir e abrir.
  let fila: Promise<unknown> = Promise.resolve();
  const emFila = <T>(fn: () => Promise<T>): Promise<T> => {
    const p = fila.then(fn, fn);
    fila = p.catch(() => undefined);
    return p;
  };

  return {
    workflow,
    abrir: (entrada) =>
      emFila(async () => {
        const fluxoId = idFluxo(entrada);
        const ativos = await DBOS.listWorkflows({
          workflowName: NOME_FLUXO_CASO,
          workflow_id_prefix: `${entrada.workspace}:${entrada.pedidoId}:`,
          status: [...STATUS_ATIVOS],
          loadInput: true,
        });
        const outro = ativos.find((w) => {
          const e = w.input?.[0] as Partial<EntradaFluxoCaso> | undefined;
          return w.workflowID === fluxoId || (e?.workspace === entrada.workspace && e?.pedidoId === entrada.pedidoId && e?.parte === entrada.parte);
        });
        if (outro) return { aberto: false as const, motivo: 'fluxo_ativo' as const, fluxoId: outro.workflowID };
        if (await DBOS.getWorkflowStatus(fluxoId)) return { aberto: false as const, motivo: 'fluxo_existente' as const, fluxoId };
        const handle = await DBOS.startWorkflow(workflow, { workflowID: fluxoId })(entrada);
        return { aberto: true as const, fluxoId, handle };
      }),
    acordar: (fluxoId) => DBOS.send(fluxoId, 1, TOPICO_ACORDAR),
    aprovar: (fluxoId, planoId, versao) => DBOS.send(fluxoId, { planoId, versao }, TOPICO_APROVACAO),
    async acordarPedido(workspace, pedidoId) {
      const ativos = await DBOS.listWorkflows({
        workflowName: NOME_FLUXO_CASO,
        workflow_id_prefix: `${workspace}:${pedidoId}:`,
        status: [...STATUS_ATIVOS],
      });
      for (const w of ativos) await DBOS.send(w.workflowID, 1, TOPICO_ACORDAR);
      return ativos.length;
    },
  };
}
