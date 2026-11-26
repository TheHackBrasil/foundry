// Kill switch do operador (spec 0017, RF10; T731). O analista liga e desliga
// a chave global ou a de um workspace com a credencial de aprovador
// (OPERADOR_APROVADOR_TOKEN, cabecalho Authorization: Bearer). O estado fica
// em operador_controle, fora do snapshot da politica, e o operador le antes
// de cada efeito externo (lerKillSwitchOperador em portas-operador.ts).

import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LedgerStore } from './store.js';

export const CAMINHO_CONTROLE = '/api/operador/controle';

// Token curto demais e configuracao invalida: a rota fica fechada.
export const TOKEN_APROVADOR_MIN_CHARS = 16;

const RE_WORKSPACE = /^[A-Za-z0-9_-]{1,64}$/;

const resumo = (v: string): Buffer => createHash('sha256').update(v, 'utf8').digest();

// Compara pelo sha256 dos dois lados: o tamanho fixo deixa o
// timingSafeEqual valer tambem quando o token recebido tem outro tamanho.
export function bearerConfere(cabecalho: string | string[] | undefined, esperado: string | null | undefined): boolean {
  if (!esperado || esperado.length < TOKEN_APROVADOR_MIN_CHARS) return false;
  const bruto = Array.isArray(cabecalho) ? cabecalho[0] : cabecalho;
  const m = typeof bruto === 'string' ? /^Bearer\s+(\S+)\s*$/i.exec(bruto) : null;
  if (!m) return false;
  return timingSafeEqual(resumo(m[1]!), resumo(esperado));
}

interface CorpoControle {
  escopo?: unknown;
  workspaceId?: unknown;
  acionado?: unknown;
}

export interface OpcoesRotaControle {
  store: LedgerStore; // raiz: a tabela e global
  token: string | null | undefined;
}

export function registrarRotaControle(app: FastifyInstance, opcoes: OpcoesRotaControle): void {
  const exigirAprovador = (req: FastifyRequest, reply: FastifyReply): boolean => {
    if (bearerConfere(req.headers.authorization, opcoes.token)) return true;
    void reply.code(401).header('www-authenticate', 'Bearer').send({ erro: 'Credencial de aprovador ausente ou inválida.' });
    return false;
  };

  app.get(CAMINHO_CONTROLE, async (req, reply) => {
    if (!exigirAprovador(req, reply)) return reply;
    return opcoes.store.lerKillSwitch();
  });

  app.put<{ Body: CorpoControle }>(CAMINHO_CONTROLE, async (req, reply) => {
    if (!exigirAprovador(req, reply)) return reply;
    const b = req.body ?? {};
    if (b.escopo !== 'global' && b.escopo !== 'workspace') {
      return reply.code(400).send({ erro: 'escopo deve ser global ou workspace' });
    }
    if (typeof b.acionado !== 'boolean') return reply.code(400).send({ erro: 'acionado deve ser booleano' });
    let workspaceId: string | null = null;
    if (b.escopo === 'workspace') {
      if (typeof b.workspaceId !== 'string' || !RE_WORKSPACE.test(b.workspaceId)) {
        return reply.code(400).send({ erro: 'workspaceId inválido' });
      }
      workspaceId = b.workspaceId;
    }
    await opcoes.store.definirKillSwitch(workspaceId, b.acionado, 'aprovador');
    return { ok: true, estado: await opcoes.store.lerKillSwitch() };
  });
}
