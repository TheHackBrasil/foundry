// Modulo do operador (spec 0017, T724, NFR-operacao): roda no processo do app
// e so executa fluxos na instancia que segura o lock de lider no Postgres.
//
// - Desligado sem OPERADOR_ATIVO=1.
// - Sem OPERADOR_VERSAO nao sobe: a versao do app fica fixa por env para que
//   um deploy novo recupere os fluxos pendentes da versao anterior (o DBOS so
//   recupera fluxo da mesma versao; sem env ele calcula um hash do codigo).
// - Lock de sessao `pg_try_advisory_lock` no Postgres do app antes do
//   DBOS.launch. Quem nao pega o lock fica de reserva e tenta de novo a cada
//   `intervaloLiderMs`; no deploy sem sobreposicao, a instancia nova assume
//   quando a velha fecha a conexao.
// - Perdeu a conexao do lock: para o DBOS e volta para a reserva.
//
// Estado do DBOS no schema `dbos` do mesmo Postgres (DBOS_SYSTEM_DATABASE_URL,
// padrao DATABASE_URL; T702 no brief).

import pg from 'pg';
import type { FastifyInstance } from 'fastify';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { projetarCasos, projetarPlanosContato } from '../shared/casos.js';
import type { Caso, Parte } from '../shared/model.js';
import type { Db } from '../server/db.js';
import { LedgerStore } from '../server/store.js';
import { criarPortaLedger, FonteLedgerDbos, SCHEMA_DBOS_PADRAO } from './db-dbos.js';
import { registrarFluxoCaso, snapshotPolitica, type EntradaFluxoCaso, type FluxoCaso, type PortasFluxo } from './fluxo/caso.js';
import { POLITICA_PADRAO, type ConfigPolitica } from './politica.js';

export const NOME_APP_DBOS = 'foundry-operador';
const CHAVE_LOCK_PADRAO = 'foundry:operador:lider';

type Env = Readonly<Record<string, string | undefined>>;

export interface PrazosOperador {
  emailH: number;
  whatsappH: number;
  aprovacaoValidadeMin: number;
}

export interface ConfigOperador {
  ativo: boolean;
  versao: string | null; // OPERADOR_VERSAO
  databaseUrl: string | null; // DATABASE_URL: ledger e lock de lider
  systemDatabaseUrl: string | null; // DBOS_SYSTEM_DATABASE_URL, padrao DATABASE_URL
  schemaDbos: string; // OPERADOR_DBOS_SCHEMA, padrao 'dbos'
  nomeApp: string;
  politica: ConfigPolitica;
  prazos: PrazosOperador;
}

function lista(v: string | undefined): string[] {
  return (v ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

function numero(v: string | undefined, padrao: number): number {
  if (v === undefined || v.trim() === '') return padrao;
  const n = Number(v);
  return Number.isFinite(n) ? n : Number.NaN; // NaN: a politica recusa
}

function janela(v: string | undefined): ConfigPolitica['janela'] {
  if (!v?.trim()) return { ...POLITICA_PADRAO.janela };
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(v);
  return m ? { inicioHora: Number(m[1]), fimHora: Number(m[2]) } : { inicioHora: Number.NaN, fimHora: Number.NaN };
}

// Le o env uma vez no boot; o fluxo recebe o snapshot e nao le env depois.
export function configOperadorDoEnv(env: Env = process.env): ConfigOperador {
  const versao = env['OPERADOR_VERSAO']?.trim() || null;
  const databaseUrl = env['DATABASE_URL']?.trim() || null;
  return {
    ativo: env['OPERADOR_ATIVO']?.trim() === '1',
    versao,
    databaseUrl,
    systemDatabaseUrl: env['DBOS_SYSTEM_DATABASE_URL']?.trim() || databaseUrl,
    schemaDbos: env['OPERADOR_DBOS_SCHEMA']?.trim() || SCHEMA_DBOS_PADRAO,
    nomeApp: NOME_APP_DBOS,
    politica: {
      workspacesHabilitados: lista(env['OPERADOR_WORKSPACES']),
      destinosPermitidos: lista(env['OPERADOR_DESTINOS_PERMITIDOS']),
      janela: janela(env['OPERADOR_JANELA']),
      tentativasPorDestinoDia: numero(env['OPERADOR_TENTATIVAS_DIA'], POLITICA_PADRAO.tentativasPorDestinoDia),
      tetoCasoBrl: numero(env['OPERADOR_TETO_CASO_BRL'], POLITICA_PADRAO.tetoCasoBrl),
      tetoDiaBrl: numero(env['OPERADOR_TETO_DIA_BRL'], POLITICA_PADRAO.tetoDiaBrl),
    },
    prazos: {
      emailH: numero(env['OPERADOR_PRAZO_EMAIL_H'], 4),
      whatsappH: numero(env['OPERADOR_PRAZO_WHATSAPP_H'], 1),
      aprovacaoValidadeMin: numero(env['OPERADOR_APROVACAO_VALIDADE_MIN'], 30),
    },
  };
}

// O que o operador faz ao virar lider e ao deixar de ser. Injetavel para o
// teste de duas instancias no mesmo processo (o DBOS e um singleton).
export interface LancadorOperador {
  lancar(): Promise<void>;
  parar(): Promise<void>;
}

// Lancador real: configura e sobe o DBOS com a versao fixa. `preparar`
// registra fonte de dados e fluxos e roda antes de cada launch, porque o
// shutdown limpa o registro.
export function lancadorDbos(config: ConfigOperador, preparar: () => void): LancadorOperador {
  return {
    async lancar() {
      if (!config.versao || !config.systemDatabaseUrl) throw new Error('operador: versao ou banco ausente');
      preparar();
      DBOS.setConfig({
        name: config.nomeApp,
        systemDatabaseUrl: config.systemDatabaseUrl,
        systemDatabaseSchemaName: config.schemaDbos,
        applicationVersion: config.versao,
        logLevel: 'warn',
      });
      await DBOS.launch();
    },
    async parar() {
      if (DBOS.isInitialized()) await DBOS.shutdown({ deregister: true });
    },
  };
}

export type EstadoOperador = 'desligado' | 'sem_versao' | 'sem_banco' | 'reserva' | 'lider' | 'parado' | 'erro';

export interface OpcoesOperador {
  config: ConfigOperador;
  lancador: LancadorOperador;
  intervaloLiderMs?: number; // reserva tenta o lock de novo; 0 desliga
  chaveLock?: string;
  log?: (msg: string) => void;
}

export class Operador {
  private _estado: EstadoOperador;
  private _motivo: string | null = null;
  private lock: pg.Client | null = null;
  private timer: NodeJS.Timeout | null = null;
  private parado = false;
  private ocupado: Promise<void> = Promise.resolve();

  constructor(private readonly opcoes: OpcoesOperador) {
    const c = opcoes.config;
    this._estado = !c.ativo ? 'desligado' : !c.versao ? 'sem_versao' : !c.databaseUrl || !c.systemDatabaseUrl ? 'sem_banco' : 'reserva';
  }

  get estado(): EstadoOperador {
    return this._estado;
  }

  get motivo(): string | null {
    return this._motivo;
  }

  get lider(): boolean {
    return this._estado === 'lider';
  }

  private log(msg: string): void {
    (this.opcoes.log ?? ((m: string) => console.log(m)))(`operador: ${msg}`);
  }

  // Uma tentativa de pegar o lock e, com ele, subir o DBOS.
  tentarLideranca(): Promise<void> {
    const vez = this.ocupado.then(() => this.tentar());
    this.ocupado = vez.catch(() => undefined);
    return vez;
  }

  private async tentar(): Promise<void> {
    if (this.parado || this._estado !== 'reserva') return;
    const client = new pg.Client({
      connectionString: this.opcoes.config.databaseUrl!,
      connectionTimeoutMillis: 5_000,
      application_name: 'forseti-operador-lider',
    });
    client.on('error', (e) => void this.perdeuLock(client, e.message));
    try {
      await client.connect();
      const r = await client.query<{ ok: boolean }>('SELECT pg_try_advisory_lock(hashtext($1)) AS ok', [
        this.opcoes.chaveLock ?? CHAVE_LOCK_PADRAO,
      ]);
      if (!r.rows[0]?.ok) {
        await client.end().catch(() => undefined);
        this._motivo = 'outra instancia e lider';
        this.agendar();
        return;
      }
    } catch (e) {
      await client.end().catch(() => undefined);
      this._motivo = `lock indisponivel: ${(e as Error).message}`;
      this.agendar();
      return;
    }
    this.lock = client;
    client.on('end', () => void this.perdeuLock(client, 'conexao do lock fechou'));
    try {
      await this.opcoes.lancador.lancar();
      this._estado = 'lider';
      this._motivo = null;
      this.log(`lider, versao ${this.opcoes.config.versao}`);
    } catch (e) {
      this._estado = 'erro';
      this._motivo = `launch falhou: ${(e as Error).message}`;
      this.log(this._motivo);
      await this.soltarLock();
      await this.opcoes.lancador.parar().catch(() => undefined);
    }
  }

  private agendar(): void {
    const ms = this.opcoes.intervaloLiderMs ?? 15_000;
    if (this.parado || ms <= 0 || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tentarLideranca();
    }, ms);
    this.timer.unref();
  }

  private async perdeuLock(client: pg.Client, motivo: string): Promise<void> {
    if (this.lock !== client || this.parado) return;
    this.lock = null;
    this.log(`perdeu o lock (${motivo}); parando o DBOS`);
    await this.opcoes.lancador.parar().catch(() => undefined);
    this._estado = 'reserva';
    this._motivo = motivo;
    this.agendar();
  }

  private async soltarLock(): Promise<void> {
    const client = this.lock;
    this.lock = null;
    if (!client) return;
    await client.query('SELECT pg_advisory_unlock(hashtext($1))', [this.opcoes.chaveLock ?? CHAVE_LOCK_PADRAO]).catch(() => undefined);
    await client.end().catch(() => undefined);
  }

  // Para o DBOS e solta o lock (onClose do Fastify, deploy).
  async parar(): Promise<void> {
    this.parado = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.ocupado;
    if (this._estado === 'lider') await this.opcoes.lancador.parar().catch(() => undefined);
    await this.soltarLock();
    if (this._estado === 'lider' || this._estado === 'reserva') this._estado = 'parado';
  }
}

// Cria o operador e faz a primeira tentativa de lideranca. Desligado, sem
// versao ou sem banco, devolve o operador parado nesse estado, sem conectar.
export async function iniciarOperador(opcoes: OpcoesOperador): Promise<Operador> {
  const op = new Operador(opcoes);
  if (op.estado !== 'reserva') {
    if (opcoes.config.ativo) console.warn(`operador: nao sobe (${op.estado})`);
    return op;
  }
  await op.tentarLideranca();
  return op;
}

// Portas padrao enquanto as tasks seguintes nao trazem as reais. Falham para
// o lado seguro: kill switch acionado e nenhum adaptador de canal, entao
// nenhum efeito externo sai e a escada devolve o caso ao analista.
export function portasPadrao(config: ConfigOperador, db: Db, ledger: PortasFluxo['ledger']): PortasFluxo {
  return {
    ledger,
    canais: {},
    killSwitch: async () => ({ global: true, workspaces: [] }),
    contato: (workspace, parte, canal) => new LedgerStore(db, workspace).contatoDaParte(parte, canal),
    contadores: async () => ({ tentativasHojeDestino: Number.NaN, gastoCasoBrl: Number.NaN, gastoDiaBrl: Number.NaN }),
    destinosPermitidos: async () => config.politica.destinosPermitidos,
    async estadoCaso(workspace, pedidoId, casoId) {
      const eventos = await new LedgerStore(db, workspace).eventosDoPedido(pedidoId);
      const caso = projetarCasos(eventos).find((c) => c.id === casoId);
      return {
        casoFechado: !caso || caso.status === 'resolvido',
        optout: eventos.some((e) => e.tipo === 'contato_optout'),
        declaracao: 'nenhuma',
      };
    },
    async planoContato(workspace, pedidoId, planoId) {
      const eventos = await new LedgerStore(db, workspace).eventosDoPedido(pedidoId);
      return projetarPlanosContato(eventos).find((p) => p.planoId === planoId) ?? null;
    },
    guardarEvidencia: (workspace, hash, tipo, conteudo) => new LedgerStore(db, workspace).guardarEvidencia(hash, tipo, conteudo),
    agora: () => Date.now(),
  };
}

// O que o servidor usa do operador: o fluxo (so no lider), a habilitacao do
// workspace e a entrada do fluxo de um caso, com o snapshot da politica.
// Interface estreita para as rotas e o tick aceitarem um modulo falso.
export interface AlvoOperador {
  fluxo(): Pick<FluxoCaso, 'abrir' | 'acordar' | 'aprovar' | 'acordarPedido'> | null;
  habilitado(workspace: string): boolean;
  entradaDoCaso(workspace: string, caso: Caso, gatilho: EntradaFluxoCaso['gatilho'], parte: Parte): EntradaFluxoCaso;
}

export interface ModuloOperador extends AlvoOperador {
  operador: Operador;
  config: ConfigOperador;
  // So existe na instancia lider, depois do launch.
  fluxo(): FluxoCaso | null;
}

// Habilitacao e entrada a partir da config lida no boot. A seed nunca e
// trabalhada pelo operador, mesmo listada por engano (RF4, P-010).
export function alvoDaConfig(config: ConfigOperador, seedWs: string): Pick<AlvoOperador, 'habilitado' | 'entradaDoCaso'> {
  const habilitado = (workspace: string): boolean =>
    config.ativo && workspace !== seedWs && config.politica.workspacesHabilitados.includes(workspace);
  return {
    habilitado,
    entradaDoCaso: (workspace, caso, gatilho, parte) => ({
      workspace,
      pedidoId: caso.pedidoId,
      casoId: caso.id,
      seqOrigem: caso.origemSeq,
      ciclo: caso.ciclos + 1,
      parte,
      gatilho,
      politica: snapshotPolitica(workspace, config.politica, config.prazos),
    }),
  };
}

// Gatilho da pendencia (RF4, T740): cada caso de pendencia aberto num
// workspace habilitado, fora da seed, que ainda nao tem operador_assumiu,
// abre o fluxo. Roda no tick depois de abrir as pendencias, entao um caso
// que nasceu com o operador fora do ar e assumido no tick seguinte. O id do
// fluxo leva o caso, e abrir recusa id repetido: cada caso e assumido uma vez.
export async function assumirCasosPendentes(alvo: AlvoOperador, store: LedgerStore): Promise<number> {
  const fluxo = alvo.fluxo();
  if (!fluxo || !alvo.habilitado(store.workspace)) return 0;
  let abertos = 0;
  for (const p of await store.listarPedidos()) {
    if (p.workspaceId !== store.workspace) continue;
    const eventos = await store.eventosDoPedido(p.pedidoId);
    const assumidos = new Set(
      eventos.filter((e) => e.tipo === 'operador_assumiu').map((e) => (e.payload as { casoId?: unknown }).casoId),
    );
    for (const caso of projetarCasos(eventos)) {
      if (caso.origem !== 'pendencia' || caso.status === 'resolvido' || assumidos.has(caso.id)) continue;
      const r = await fluxo.abrir(alvo.entradaDoCaso(store.workspace, caso, 'pendencia_aberta', 'transportadora'));
      if (r.aberto) abertos += 1;
    }
  }
  return abertos;
}

// Liga o operador no Fastify: sobe (se for o caso), expoe o estado em
// GET /api/operador/estado e para no onClose. Nao registra rota de webhook
// nem MCP (webhooks.ts e mcp.ts tem o proprio registro).
export async function registrarOperador(
  app: FastifyInstance,
  deps: {
    db: Db;
    env?: Env;
    seedWs?: string;
    portas?: (base: PortasFluxo, config: ConfigOperador) => PortasFluxo;
    intervaloLiderMs?: number;
  },
): Promise<ModuloOperador> {
  const config = configOperadorDoEnv(deps.env ?? process.env);
  let fluxo: FluxoCaso | null = null;
  const preparar = (): void => {
    const fonte = new FonteLedgerDbos({ databaseUrl: config.databaseUrl!, schema: config.schemaDbos }).registrar();
    const base = portasPadrao(config, deps.db, criarPortaLedger(fonte, deps.db));
    fluxo = registrarFluxoCaso(deps.portas ? deps.portas(base, config) : base);
  };
  const operador = await iniciarOperador({
    config,
    lancador: lancadorDbos(config, preparar),
    ...(deps.intervaloLiderMs !== undefined ? { intervaloLiderMs: deps.intervaloLiderMs } : {}),
  });
  app.addHook('onClose', async () => {
    await operador.parar();
  });
  app.get('/api/operador/estado', async () => ({
    estado: operador.estado,
    lider: operador.lider,
    versao: config.ativo ? config.versao : null,
  }));
  return {
    operador,
    config,
    ...alvoDaConfig(config, deps.seedWs ?? 'seed'),
    fluxo: () => (operador.lider ? fluxo : null),
  };
}
