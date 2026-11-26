// Rotas do operador (spec 0017): acionar numa divergencia (RF4, T741),
// planos de contato e a decisao do analista (RF11, T750), linha do tempo e
// evidencia do caso (RF26, T770).
//
// Autorizacao (matriz do plano):
// - acionar, planos, linha do tempo e evidencia: sessao dona do pedido. A
//   seed e so leitura (403) e pedido de outro workspace nao existe (404).
// - aprovar, recusar e ajustar: credencial de aprovador (Bearer
//   OPERADOR_APROVADOR_TOKEN, comparada em tempo constante), nunca o cookie.
//   O plano e achado pelo planoId em qualquer workspace, menos a seed.
//
// Decisao sob a trava do pedido (a mesma do fluxo antes do efeito, T751):
// 409 quando o plano nao esta proposto, o prazo venceu, o caso fechou, a
// versao e antiga ou o roteiro mudou. O evento leva planoId, versao e hash do
// roteiro; o fluxo e sinalizado depois do commit e rele o ledger.

import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { linhaDoTempoCaso, projetarCasos, projetarPlanosContato } from '../shared/casos.js';
import type { Caso, Evento, FonteDocumento, Parte } from '../shared/model.js';
import { propagar } from '../shared/rules.js';
import type { AlvoOperador } from '../operador/index.js';
import { ajustarRoteiro, hashRoteiro, lerRoteiroGuardado, serializarRoteiro } from '../operador/roteiro.js';
import { bearerConfere } from './controle.js';
import { pedidoDoCaso } from './portas-operador.js';
import type { CanalSSE } from './sse.js';
import type { LedgerStore } from './store.js';

export interface OpcoesRotasOperador {
  store: LedgerStore; // raiz
  canal: CanalSSE;
  seedWs: string;
  token: string | null | undefined; // OPERADOR_APROVADOR_TOKEN
  operador: AlvoOperador;
  limiteEscrita?: Record<string, unknown>; // config de rate limit das escritas
  retencaoDias?: number;
  agora?: () => number;
}

// Declaracao vinda de canal do operador: caso nascido dela nao aciona
// escada nova (invariante 7).
const FONTES_DO_OPERADOR: ReadonlySet<FonteDocumento> = new Set<FonteDocumento>([
  'email_transportadora',
  'whatsapp_transportadora',
  'ligacao_transportadora',
]);

const HEX64 = /^[0-9a-f]{64}$/;
const CODIGO = /^[a-z][a-z0-9_]{0,47}$/;
const DIA_MS = 86_400_000;

class Recusa extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly motivo?: string,
  ) {
    super(message);
  }
}

const recusar = (reply: FastifyReply, r: Recusa): FastifyReply =>
  reply.code(r.status).send({ erro: r.message, ...(r.motivo ? { motivo: r.motivo } : {}) });

// Media type servido para cada tipo de evidencia. Conteudo de terceiro: o
// e-mail bruto sai como texto e nada e interpretado como HTML.
function tipoDeConteudo(tipo: string, conteudo: Buffer): string {
  if (tipo === 'roteiro') return 'application/json; charset=utf-8';
  if (tipo === 'audio') {
    const cab = conteudo.subarray(0, 4).toString('latin1');
    if (cab === 'RIFF') return 'audio/wav';
    if (cab === 'OggS') return 'audio/ogg';
    if (cab.startsWith('ID3') || (conteudo[0] === 0xff && ((conteudo[1] ?? 0) & 0xe0) === 0xe0)) return 'audio/mpeg';
    if (cab === 'fLaC') return 'audio/flac';
    return 'application/octet-stream';
  }
  if (tipo === 'transcricao' || tipo === 'whatsapp') {
    try {
      JSON.parse(conteudo.toString('utf8'));
      return 'application/json; charset=utf-8';
    } catch {
      return 'text/plain; charset=utf-8';
    }
  }
  return 'text/plain; charset=utf-8'; // eml e o resto
}

export function registrarRotasOperador(app: FastifyInstance, o: OpcoesRotasOperador): void {
  const agora = (): number => (o.agora ? o.agora() : Date.now());

  // Store do dono do caso entre os visiveis (sessao + seed); 404 fora disso.
  async function donoDoCaso(req: FastifyRequest, casoId: string): Promise<{ s: LedgerStore; pedidoId: string }> {
    const pedidoId = pedidoDoCaso(casoId);
    if (!pedidoId) throw new Recusa(404, 'caso não encontrado');
    const dono = await o.store.paraWorkspace(req.workspace).wsDoPedido(pedidoId);
    if (dono === null) throw new Recusa(404, 'caso não encontrado');
    return { s: o.store.paraWorkspace(dono), pedidoId };
  }

  // Sessao dona: a seed e visivel a todos, mas o caso dela nao e da sessao.
  async function casoDaSessao(req: FastifyRequest, casoId: string): Promise<{ s: LedgerStore; eventos: Evento[]; caso: Caso }> {
    const { s, pedidoId } = await donoDoCaso(req, casoId);
    if (s.workspace !== req.workspace) throw new Recusa(403, 'Só a sessão dona do caso vê o trabalho do operador.');
    const eventos = await s.eventosDoPedido(pedidoId);
    const caso = projetarCasos(eventos).find((c) => c.id === casoId);
    if (!caso) throw new Recusa(404, 'caso não encontrado');
    return { s, eventos, caso };
  }

  const tratar = <R extends FastifyRequest>(fn: (req: R, reply: FastifyReply) => Promise<unknown>) =>
    async (req: R, reply: FastifyReply): Promise<unknown> => {
      try {
        return await fn(req, reply);
      } catch (e) {
        if (e instanceof Recusa) return recusar(reply, e);
        throw e;
      }
    };

  // --- US3: acionar o operador numa divergencia (T741) ---

  app.post<{ Params: { id: string } }>(
    '/api/casos/:id/acionar',
    { config: o.limiteEscrita ?? {} },
    tratar(async (req) => {
      const { s, pedidoId } = await donoDoCaso(req, req.params.id);
      if (s.workspace === o.seedWs) throw new Recusa(403, 'Pedidos de exemplo são somente leitura: não dá para acionar o operador neles.');
      const eventos = await s.eventosDoPedido(pedidoId);
      const caso = projetarCasos(eventos).find((c) => c.id === req.params.id);
      if (!caso) throw new Recusa(404, 'caso não encontrado');
      if (caso.origem !== 'divergencia' || !caso.divergencia) {
        throw new Recusa(409, 'Só um caso de divergência aciona o operador.', 'caso_nao_divergencia');
      }
      const d = caso.divergencia;
      if (FONTES_DO_OPERADOR.has(d.fonteA) || FONTES_DO_OPERADOR.has(d.fonteB)) {
        throw new Recusa(409, 'Divergência nascida de resposta a um canal do operador não abre escada nova.', 'caso_de_canal_do_operador');
      }
      if (caso.status === 'resolvido') throw new Recusa(409, 'Caso resolvido: reabra antes de acionar o operador.', 'caso_fechado');
      if (!o.operador.habilitado(s.workspace)) {
        throw new Recusa(403, 'O operador não está habilitado para este workspace.', 'workspace_nao_habilitado');
      }
      const assumido = eventos.some(
        (e) => e.tipo === 'operador_assumiu' && (e.payload as { casoId?: unknown }).casoId === caso.id,
      );
      if (assumido) throw new Recusa(409, 'O operador já foi acionado nesta divergência.', 'ja_acionado');
      const fluxo = o.operador.fluxo();
      if (!fluxo) throw new Recusa(503, 'O operador não está no ar nesta instância. Tente de novo em instantes.', 'operador_indisponivel');
      const parte: Parte = propagar(d)[0]?.parte ?? 'transportadora';
      const r = await fluxo.abrir(o.operador.entradaDoCaso(s.workspace, caso, 'acionar_operador', parte));
      if (!r.aberto) throw new Recusa(409, 'O operador já foi acionado nesta divergência.', r.motivo);
      return { ok: true, fluxoId: r.fluxoId, parte };
    }),
  );

  // --- US2: planos de contato (T750) ---

  app.get<{ Params: { id: string } }>(
    '/api/casos/:id/planos',
    tratar(async (req) => {
      const { eventos, caso } = await casoDaSessao(req, req.params.id);
      return { planos: projetarPlanosContato(eventos).filter((p) => p.casoId === caso.id) };
    }),
  );

  const exigirAprovador = (req: FastifyRequest): void => {
    if (!bearerConfere(req.headers.authorization, o.token)) throw new Recusa(401, 'Credencial de aprovador ausente ou inválida.');
  };

  type Acao = 'aprovar' | 'recusar' | 'ajustar';
  type CorpoDecisao = { versao?: unknown; hashRoteiro?: unknown; motivo?: unknown; campos?: unknown };

  const decidir = (acao: Acao) =>
    tratar<FastifyRequest<{ Params: { planoId: string }; Body: CorpoDecisao }>>(async (req, reply) => {
      exigirAprovador(req);
      const { planoId } = req.params;
      if (!HEX64.test(planoId)) throw new Recusa(404, 'plano não encontrado');
      const b = req.body ?? {};
      if (typeof b.versao !== 'number' || !Number.isInteger(b.versao) || b.versao < 1) throw new Recusa(400, 'versao deve ser inteiro positivo');
      const versao = b.versao;
      if (acao === 'aprovar' && (typeof b.hashRoteiro !== 'string' || !HEX64.test(b.hashRoteiro))) {
        throw new Recusa(400, 'hashRoteiro deve ser o sha256 do roteiro aprovado');
      }
      if (acao === 'recusar' && (typeof b.motivo !== 'string' || !CODIGO.test(b.motivo))) {
        throw new Recusa(400, 'motivo deve ser um código curto (letras minúsculas, dígitos e _)');
      }
      if (acao === 'ajustar' && (!b.campos || typeof b.campos !== 'object' || Array.isArray(b.campos))) {
        throw new Recusa(400, 'campos deve ser um objeto');
      }

      const donos = await o.store.pedidosDoPlano(planoId);
      if (donos.length !== 1) throw new Recusa(404, 'plano não encontrado');
      const { workspaceId, pedidoId } = donos[0]!;
      if (workspaceId === o.seedWs) throw new Recusa(403, 'Pedidos de exemplo são somente leitura.');
      const s = o.store.paraWorkspace(workspaceId);

      const r = await s.transaction(async (tx) => {
        await tx.travarPedido(pedidoId);
        const eventos = await tx.eventosDoPedido(pedidoId);
        const plano = projetarPlanosContato(eventos).find((p) => p.planoId === planoId);
        if (!plano) throw new Recusa(404, 'plano não encontrado');
        const caso = projetarCasos(eventos).find((c) => c.id === plano.casoId);
        if (!caso || caso.status === 'resolvido') throw new Recusa(409, 'O caso já fechou: nada sai.', 'caso_fechado');
        if (plano.estado !== 'proposto') throw new Recusa(409, `O plano não está esperando decisão (${plano.estado}).`, `plano_${plano.estado}`);
        const prazo = Date.parse(plano.prazo);
        if (!Number.isFinite(prazo) || prazo <= agora()) throw new Recusa(409, 'O prazo de decisão do plano venceu.', 'prazo_vencido');
        if (versao !== plano.versao) throw new Recusa(409, `Versão antiga do plano: a atual é a ${plano.versao}.`, 'versao_antiga');
        const planejado = [...eventos]
          .reverse()
          .find((e) => e.tipo === 'contato_planejado' && (e.payload as { planoId?: unknown }).planoId === planoId);
        const pl = (planejado?.payload ?? {}) as Record<string, unknown>;
        const fluxoId = typeof pl['fluxoId'] === 'string' ? pl['fluxoId'] : null;
        const base = { ...(fluxoId ? { fluxoId } : {}), casoId: caso.id, planoId, aprovador: 'aprovador' };

        if (acao === 'aprovar') {
          if (b.hashRoteiro !== plano.hashRoteiro) throw new Recusa(409, 'O roteiro mudou desde que a tela carregou.', 'roteiro_mudou');
          const ev = await tx.append(pedidoId, 'contato_aprovado', { ...base, versao, hashRoteiro: plano.hashRoteiro });
          return { ev, fluxoId, versao };
        }
        if (acao === 'recusar') {
          const ev = await tx.append(pedidoId, 'contato_recusado', { ...base, versao, hashRoteiro: plano.hashRoteiro, motivo: b.motivo });
          return { ev, fluxoId, versao };
        }
        // Ajustar: versao nova com os campos mudados, roteiro novo em evidencia.
        const guardado = await tx.evidencia(plano.hashRoteiro);
        const roteiro = guardado ? lerRoteiroGuardado(guardado) : null;
        if (!roteiro) throw new Recusa(409, 'O roteiro deste plano não está mais disponível.', 'roteiro_indisponivel');
        const ajuste = ajustarRoteiro(roteiro, b.campos);
        if (!ajuste.ok) throw new Recusa(400, ajuste.erro);
        const conteudo = serializarRoteiro(ajuste.roteiro);
        const hash = hashRoteiro(conteudo);
        await tx.guardarEvidencia(hash, 'roteiro', conteudo, new Date(agora() + (o.retencaoDias ?? 90) * DIA_MS));
        const nova = plano.versao + 1;
        const ev = await tx.append(pedidoId, 'contato_planejado', {
          ...(fluxoId ? { fluxoId } : {}),
          casoId: caso.id,
          planoId,
          versao: nova,
          canal: plano.canal,
          contatoId: plano.contatoId,
          hashRoteiro: hash,
          prazo: plano.prazo,
          custoEstimadoBrl: plano.custoEstimadoBrl,
          ...(typeof pl['motivo'] === 'string' ? { motivo: pl['motivo'] } : {}),
          ajustadoPor: 'aprovador',
        });
        return { ev, fluxoId, versao: nova };
      });

      o.canal.evento(r.ev, workspaceId);
      // O sinal so acelera: sem ele, o fluxo rele o ledger no prazo.
      const fluxo = o.operador.fluxo();
      if (fluxo && r.fluxoId) await fluxo.aprovar(r.fluxoId, planoId, r.versao).catch(() => undefined);
      const plano = projetarPlanosContato(await s.eventosDoPedido(pedidoId)).find((p) => p.planoId === planoId);
      return reply.send({ ok: true, plano });
    });

  app.post('/api/planos/:planoId/aprovar', { config: o.limiteEscrita ?? {} }, decidir('aprovar'));
  app.post('/api/planos/:planoId/recusar', { config: o.limiteEscrita ?? {} }, decidir('recusar'));
  app.post('/api/planos/:planoId/ajustar', { config: o.limiteEscrita ?? {} }, decidir('ajustar'));

  // --- US5: linha do tempo e evidencia (T770) ---

  app.get<{ Params: { id: string } }>(
    '/api/casos/:id/linha-tempo',
    tratar(async (req) => {
      const { eventos, caso } = await casoDaSessao(req, req.params.id);
      return { itens: linhaDoTempoCaso(eventos, caso.id) };
    }),
  );

  // So hash citado na linha do tempo do caso, no workspace da sessao: nem
  // outro caso nem outro workspace servem de atalho para a tabela.
  app.get<{ Params: { id: string; hash: string } }>(
    '/api/casos/:id/evidencias/:hash',
    tratar(async (req, reply) => {
      const hash = req.params.hash.toLowerCase();
      if (!HEX64.test(hash)) throw new Recusa(404, 'evidência não encontrada');
      const { s, eventos, caso } = await casoDaSessao(req, req.params.id);
      const citados = new Set(linhaDoTempoCaso(eventos, caso.id).flatMap((i) => i.hashes ?? []));
      if (!citados.has(hash)) throw new Recusa(404, 'evidência não encontrada');
      const ev = await s.evidenciaComTipo(hash);
      if (!ev) throw new Recusa(404, 'evidência não encontrada');
      return reply
        .header('content-type', tipoDeConteudo(ev.tipo, ev.conteudo))
        .header('cache-control', 'private, no-store')
        .header('content-security-policy', "default-src 'none'; sandbox")
        .header('x-evidencia-tipo', ev.tipo)
        .send(ev.conteudo);
    }),
  );
}
