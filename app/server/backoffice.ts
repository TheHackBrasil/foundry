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

export interface EstadoBackoffice {
  destinos: string[];
  origemDestinos: 'banco' | 'env';
  aprovacaoAberta: boolean;
}

export class ConfigBackoffice {
  private destinosBanco: string[] | null = null;
  private aprovacaoBanco: boolean | null = null;
  private readonly ouvintes = new Set<(e: EstadoBackoffice) => void>();

  constructor(
    private readonly destinosEnv: readonly string[],
    private readonly aprovacaoAbertaEnv: boolean,
  ) {}

  async carregar(store: LedgerStore): Promise<void> {
    const d = await store.lerConfigOperador(CHAVE_DESTINOS);
    this.destinosBanco = Array.isArray(d) ? normalizarLista(d.filter((x): x is string => typeof x === 'string')).validos : null;
    const a = await store.lerConfigOperador(CHAVE_APROVACAO_ABERTA);
    this.aprovacaoBanco = typeof a === 'boolean' ? a : null;
    this.avisar();
  }

  destinos(): string[] {
    return this.destinosBanco ?? normalizarLista(this.destinosEnv).validos;
  }

  aprovacaoAberta(): boolean {
    return this.aprovacaoBanco ?? this.aprovacaoAbertaEnv;
  }

  estado(): EstadoBackoffice {
    return {
      destinos: this.destinos(),
      origemDestinos: this.destinosBanco ? 'banco' : 'env',
      aprovacaoAberta: this.aprovacaoAberta(),
    };
  }

  async definir(store: LedgerStore, mudanca: { destinos?: string[]; aprovacaoAberta?: boolean }): Promise<EstadoBackoffice> {
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

  app.put<{ Body: { destinos?: unknown; aprovacaoAberta?: unknown } }>(
    '/api/admin/config',
    { config: o.limiteEscrita ?? {} },
    async (req, reply) => {
      if (!exigir(req, reply)) return reply;
      const b = req.body ?? {};
      const mudanca: { destinos?: string[]; aprovacaoAberta?: boolean } = {};
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
