// Backoffice do operador (spec 0017): configuracao global que o time ajusta
// pelo site em /#/admin, guardada no banco (operador_config) e valendo por
// cima do env. So entra com a senha de admin (OPERADOR_APROVADOR_TOKEN);
// sem a senha no env, o backoffice fica desligado (503).
//
// - destinos: numeros que a IA pode contatar (WhatsApp e ligacao), E.164.
//   Com a lista do banco, a do env deixa de valer. Mudar a lista no meio de
//   um caso barra o efeito seguinte dele ('destinos_mudaram'): o fluxo leva
//   o caso ao analista em vez de usar a lista nova sem revisar.
// - aprovacaoAberta: aprovar plano de WhatsApp e ligacao sem senha (demo).
//   O plano continua precisando do clique de uma pessoa; so a senha sai.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { normalizarTelefoneE164 } from '../operador/politica.js';
import { bearerConfere } from './controle.js';
import type { LedgerStore } from './store.js';

export const MAX_DESTINOS = 20;
const CHAVE_DESTINOS = 'destinos';
const CHAVE_APROVACAO_ABERTA = 'aprovacao_aberta';
const CHAVE_AJUSTES = 'ajustes';

// Prazos e limites do operador, editáveis no backoffice. Valem para casos
// acionados depois de salvar: cada caso guarda a foto da política no início.
export interface AjustesOperador {
  prazoEmailMin: number; // espera da resposta do e-mail antes de subir de degrau
  prazoWhatsappMin: number; // espera da resposta do WhatsApp antes da ligação
  validadeAprovacaoMin: number; // quanto tempo um plano aprovado pode sair
  tentativasDia: number; // WhatsApp e ligação por número por dia
  tetoCasoBrl: number; // custo estimado máximo por caso
  tetoDiaBrl: number; // custo estimado máximo por dia, somando todos os casos
  janelaInicio: number; // hora em que contatos por telefone podem começar
  janelaFim: number; // hora em que param
  janelaTodosDias: boolean; // também sábado e domingo
}

// [mínimo, máximo] de cada número; fora disso a rota recusa com o motivo.
export const LIMITES_AJUSTES: Record<Exclude<keyof AjustesOperador, 'janelaTodosDias'>, [number, number]> = {
  prazoEmailMin: [1, 4320],
  prazoWhatsappMin: [1, 2880],
  validadeAprovacaoMin: [1, 1440],
  tentativasDia: [1, 10],
  tetoCasoBrl: [0, 1000],
  tetoDiaBrl: [0, 10000],
  janelaInicio: [0, 23],
  janelaFim: [1, 24],
};

export function validarAjustes(atual: AjustesOperador, parcial: Record<string, unknown>): { ok: true; ajustes: AjustesOperador } | { ok: false; erro: string } {
  const novo: AjustesOperador = { ...atual };
  for (const [chave, valor] of Object.entries(parcial)) {
    if (chave === 'janelaTodosDias') {
      if (typeof valor !== 'boolean') return { ok: false, erro: 'janelaTodosDias deve ser verdadeiro ou falso.' };
      novo.janelaTodosDias = valor;
      continue;
    }
    const limite = LIMITES_AJUSTES[chave as keyof typeof LIMITES_AJUSTES];
    if (!limite) return { ok: false, erro: `Ajuste desconhecido: ${chave.slice(0, 40)}.` };
    if (typeof valor !== 'number' || !Number.isFinite(valor) || valor < limite[0] || valor > limite[1]) {
      return { ok: false, erro: `${chave} deve ser um número entre ${limite[0]} e ${limite[1]}.` };
    }
    (novo as unknown as Record<string, number>)[chave] = valor;
  }
  if (novo.janelaInicio >= novo.janelaFim) return { ok: false, erro: 'O horário de início precisa ser antes do fim.' };
  return { ok: true, ajustes: novo };
}

export interface EstadoBackoffice {
  destinos: string[];
  origemDestinos: 'banco' | 'env';
  aprovacaoAberta: boolean;
  ajustes: AjustesOperador;
}

export class ConfigBackoffice {
  private destinosBanco: string[] | null = null;
  private aprovacaoBanco: boolean | null = null;
  private ajustesBanco: AjustesOperador | null = null;
  private readonly ouvintes = new Set<(e: EstadoBackoffice) => void>();

  constructor(
    private readonly destinosEnv: readonly string[],
    private readonly aprovacaoAbertaEnv: boolean,
    private readonly ajustesEnv: AjustesOperador,
  ) {}

  async carregar(store: LedgerStore): Promise<void> {
    const d = await store.lerConfigOperador(CHAVE_DESTINOS);
    this.destinosBanco = Array.isArray(d) ? normalizarLista(d.filter((x): x is string => typeof x === 'string')).validos : null;
    const a = await store.lerConfigOperador(CHAVE_APROVACAO_ABERTA);
    this.aprovacaoBanco = typeof a === 'boolean' ? a : null;
    const aj = await store.lerConfigOperador(CHAVE_AJUSTES);
    if (aj && typeof aj === 'object') {
      const v = validarAjustes(this.ajustesEnv, aj as Record<string, unknown>);
      this.ajustesBanco = v.ok ? v.ajustes : null;
    }
    this.avisar();
  }

  destinos(): string[] {
    return this.destinosBanco ?? normalizarLista(this.destinosEnv).validos;
  }

  aprovacaoAberta(): boolean {
    return this.aprovacaoBanco ?? this.aprovacaoAbertaEnv;
  }

  ajustes(): AjustesOperador {
    return this.ajustesBanco ?? this.ajustesEnv;
  }

  estado(): EstadoBackoffice {
    return {
      destinos: this.destinos(),
      origemDestinos: this.destinosBanco ? 'banco' : 'env',
      aprovacaoAberta: this.aprovacaoAberta(),
      ajustes: this.ajustes(),
    };
  }

  async definir(
    store: LedgerStore,
    mudanca: { destinos?: string[]; aprovacaoAberta?: boolean; ajustes?: AjustesOperador },
  ): Promise<EstadoBackoffice> {
    if (mudanca.ajustes) {
      await store.gravarConfigOperador(CHAVE_AJUSTES, mudanca.ajustes);
      this.ajustesBanco = mudanca.ajustes;
    }
    if (mudanca.destinos) {
      await store.gravarConfigOperador(CHAVE_DESTINOS, mudanca.destinos);
      this.destinosBanco = mudanca.destinos;
    }
    if (mudanca.aprovacaoAberta !== undefined) {
      await store.gravarConfigOperador(CHAVE_APROVACAO_ABERTA, mudanca.aprovacaoAberta);
      this.aprovacaoBanco = mudanca.aprovacaoAberta;
    }
    this.avisar();
    return this.estado();
  }

  aoMudar(fn: (e: EstadoBackoffice) => void): void {
    this.ouvintes.add(fn);
    fn(this.estado());
  }

  private avisar(): void {
    const e = this.estado();
    for (const fn of this.ouvintes) fn(e);
  }
}

// Normaliza para E.164, sem repetir. Invalidos voltam a parte para o erro.
export function normalizarLista(lista: readonly string[]): { validos: string[]; invalidos: string[] } {
  const validos: string[] = [];
  const invalidos: string[] = [];
  for (const bruto of lista) {
    const n = normalizarTelefoneE164(String(bruto));
    if (!n) invalidos.push(String(bruto).slice(0, 40));
    else if (!validos.includes(n)) validos.push(n);
  }
  return { validos, invalidos };
}

export interface OpcoesBackoffice {
  store: LedgerStore;
  config: ConfigBackoffice;
  senha: string | null | undefined; // OPERADOR_APROVADOR_TOKEN
  limiteEscrita?: Record<string, unknown>;
}

export function registrarRotasBackoffice(app: FastifyInstance, o: OpcoesBackoffice): void {
  const senha = o.senha?.trim() || null;
  const exigir = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (!senha) {
      void reply.code(503).send({ erro: 'Backoffice desligado: defina OPERADOR_APROVADOR_TOKEN no servidor.' });
      return false;
    }
    if (!bearerConfere(req.headers.authorization, senha)) {
      void reply.code(401).send({ erro: 'Senha de admin ausente ou inválida.' });
      return false;
    }
    return true;
  };

  // Publico: a tela de aprovacao so precisa saber se pede senha.
  app.get('/api/operador/aprovacao', async () => ({ aberta: o.config.aprovacaoAberta() }));

  app.get('/api/admin/config', async (req, reply) => {
    if (!exigir(req, reply)) return reply;
    reply.header('cache-control', 'no-store');
    return o.config.estado();
  });

  app.put<{ Body: { destinos?: unknown; aprovacaoAberta?: unknown; ajustes?: unknown } }>(
    '/api/admin/config',
    { config: o.limiteEscrita ?? {} },
    async (req, reply) => {
      if (!exigir(req, reply)) return reply;
      const b = req.body ?? {};
      const mudanca: { destinos?: string[]; aprovacaoAberta?: boolean; ajustes?: AjustesOperador } = {};
      if (b.ajustes !== undefined) {
        if (!b.ajustes || typeof b.ajustes !== 'object' || Array.isArray(b.ajustes)) {
          return reply.code(400).send({ erro: 'ajustes deve ser um objeto.' });
        }
        const v = validarAjustes(o.config.ajustes(), b.ajustes as Record<string, unknown>);
        if (!v.ok) return reply.code(400).send({ erro: v.erro });
        mudanca.ajustes = v.ajustes;
      }
      if (b.destinos !== undefined) {
        if (!Array.isArray(b.destinos)) return reply.code(400).send({ erro: 'destinos deve ser uma lista de telefones.' });
        const { validos, invalidos } = normalizarLista(b.destinos.map(String));
        if (invalidos.length) return reply.code(400).send({ erro: `Telefone inválido: ${invalidos.join(', ')}. Use o formato +55 11 99999-9999.` });
        if (validos.length > MAX_DESTINOS) return reply.code(400).send({ erro: `No máximo ${MAX_DESTINOS} números.` });
        mudanca.destinos = validos;
      }
      if (b.aprovacaoAberta !== undefined) {
        if (typeof b.aprovacaoAberta !== 'boolean') return reply.code(400).send({ erro: 'aprovacaoAberta deve ser verdadeiro ou falso.' });
        mudanca.aprovacaoAberta = b.aprovacaoAberta;
      }
      reply.header('cache-control', 'no-store');
      return o.config.definir(o.store, mudanca);
    },
  );
}
