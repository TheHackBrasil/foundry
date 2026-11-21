import { useCallback, useEffect, useRef, useState } from 'react';
import type { Evento, ProjecaoPedido, RespostaAuditoria } from '../../shared/model.ts';
import { auditarPedido, listarPedidos, obterPedido, type PedidoResumo } from './api.ts';
import { chaveCurta, rotuloTipo } from './format.ts';
import { chaveTarefa } from './matriz.ts';
import { useStream } from './useStream.ts';

export type Carga<T> =
  | { estado: 'carregando' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'ok'; dados: T };

const NOVA_POR_MS = 8000;

function lerHash(): string | null {
  const m = /^#\/pedido\/([^/]+)$/.exec(window.location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : 'Erro inesperado.');

// Busca dados e mantém o estado da tela. A apresentação fica nos componentes.
export function useTorre() {
  const [pedidos, setPedidos] = useState<Carga<PedidoResumo[]>>({ estado: 'carregando' });
  const [selecionado, setSelecionado] = useState<string | null>(lerHash);
  const [projecao, setProjecao] = useState<Carga<ProjecaoPedido>>({ estado: 'carregando' });
  const [auditoria, setAuditoria] = useState<Carga<RespostaAuditoria>>({ estado: 'carregando' });
  const [anuncio, setAnuncio] = useState('');
  const [novas, setNovas] = useState<ReadonlySet<string>>(new Set());

  const atual = useRef<string | null>(selecionado);
  const conhecidas = useRef<ReadonlySet<string> | null>(null);
  const pedidoSeq = useRef(0);
  const limpaNovas = useRef<number | undefined>(undefined);

  useEffect(() => {
    atual.current = selecionado;
  }, [selecionado]);

  const recarregarLista = useCallback(async () => {
    try {
      setPedidos({ estado: 'ok', dados: await listarPedidos() });
    } catch (e) {
      setPedidos({ estado: 'erro', mensagem: mensagemDe(e) });
    }
  }, []);

  const verificarCadeia = useCallback(async (id: string) => {
    try {
      const dados = await auditarPedido(id);
      if (atual.current === id) setAuditoria({ estado: 'ok', dados });
    } catch (e) {
      if (atual.current === id) setAuditoria({ estado: 'erro', mensagem: mensagemDe(e) });
    }
  }, []);

  const carregarPedido = useCallback(
    async (id: string, aviso?: string) => {
      const seq = ++pedidoSeq.current;
      try {
        const dados = await obterPedido(id);
        if (seq !== pedidoSeq.current) return;
        const chaves = new Set(dados.tarefas.map(chaveTarefa));
        const antes = conhecidas.current;
        const surgiram = antes ? [...chaves].filter((k) => !antes.has(k)) : [];
        conhecidas.current = chaves;
        setProjecao({ estado: 'ok', dados });
        if (surgiram.length > 0) {
          setNovas(new Set(surgiram));
          window.clearTimeout(limpaNovas.current);
          limpaNovas.current = window.setTimeout(() => setNovas(new Set()), NOVA_POR_MS);
        }
        if (aviso) {
          const extra =
            surgiram.length > 0
              ? ` ${surgiram.length} ${surgiram.length === 1 ? 'tarefa nova' : 'tarefas novas'}.`
              : '';
          setAnuncio(`${aviso}${extra}`);
        }
      } catch (e) {
        if (seq === pedidoSeq.current) setProjecao({ estado: 'erro', mensagem: mensagemDe(e) });
      }
      void verificarCadeia(id);
    },
    [verificarCadeia],
  );

  useEffect(() => {
    const aoMudarHash = () => setSelecionado(lerHash());
    window.addEventListener('hashchange', aoMudarHash);
    void recarregarLista();
    return () => window.removeEventListener('hashchange', aoMudarHash);
  }, [recarregarLista]);

  useEffect(() => {
    if (pedidos.estado === 'ok' && !selecionado && pedidos.dados[0]) {
      window.location.replace(`#/pedido/${encodeURIComponent(pedidos.dados[0].pedidoId)}`);
    }
  }, [pedidos, selecionado]);

  useEffect(() => {
    conhecidas.current = null;
    setNovas(new Set());
    if (!selecionado) return;
    setProjecao({ estado: 'carregando' });
    setAuditoria({ estado: 'carregando' });
    void carregarPedido(selecionado);
  }, [selecionado, carregarPedido]);

  const aoEvento = useCallback(
    (evento: Evento) => {
      void recarregarLista();
      if (evento.pedidoId === atual.current) {
        void carregarPedido(
          evento.pedidoId,
          `Pedido ${chaveCurta(evento.pedidoId)}: novo evento de ${rotuloTipo(evento.tipo)}.`,
        );
      } else {
        setAnuncio(`Novo evento de ${rotuloTipo(evento.tipo)} no pedido ${chaveCurta(evento.pedidoId)}.`);
      }
    },
    [recarregarLista, carregarPedido],
  );

  const aoConectar = useCallback(() => {
    void recarregarLista();
    if (atual.current) void carregarPedido(atual.current);
  }, [recarregarLista, carregarPedido]);

  const estadoStream = useStream(aoEvento, aoConectar);

  const selecionar = useCallback((id: string) => {
    window.location.hash = `#/pedido/${encodeURIComponent(id)}`;
  }, []);

  return {
    pedidos,
    selecionado,
    projecao,
    auditoria,
    anuncio,
    novas,
    estadoStream,
    selecionar,
    recarregarLista,
    verificarDeNovo: () => (selecionado ? verificarCadeia(selecionado) : Promise.resolve()),
  };
}
