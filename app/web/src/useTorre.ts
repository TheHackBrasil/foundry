import { useCallback, useEffect, useRef, useState } from 'react';
import type { Evento, ProjecaoPedido, RespostaAuditoria } from '../../shared/model.ts';
import { auditarPedido, listarPedidos, obterPedido, type PedidoResumo } from './api.ts';
import { chaveCurta } from './format.ts';
import { chaveTarefa } from './matriz.ts';
import { useStream } from './useStream.ts';

export type Carga<T> =
  | { estado: 'carregando' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'ok'; dados: T };

const NOVA_POR_MS = 8000;
// Eventos que chegam juntos (um upload gera dezenas) viram uma busca e um aviso.
const AGRUPA_EVENTOS_MS = 300;

function lerHash(): string | null {
  const m = /^#\/pedido\/([^/]+)$/.exec(window.location.hash);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
}

const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : 'Erro inesperado.');
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

// Busca dados e mantém o estado da tela. A apresentação fica nos componentes.
export function useTorre() {
  const [pedidos, setPedidos] = useState<Carga<PedidoResumo[]>>({ estado: 'carregando' });
  const [selecionado, setSelecionado] = useState<string | null>(lerHash);
  const [projecao, setProjecao] = useState<Carga<ProjecaoPedido>>({ estado: 'carregando' });
  const [auditoria, setAuditoria] = useState<Carga<RespostaAuditoria>>({ estado: 'carregando' });
  const [anuncio, setAnuncio] = useState('');
  const [novas, setNovas] = useState<ReadonlySet<string>>(new Set());
  // Pausa das atualizações ao vivo (WCAG 2.2.2): enquanto pausado, eventos viram contagem
  // e a tela só se atualiza quando a pessoa retoma.
  const [pausado, setPausado] = useState(false);
  const [pendentes, setPendentes] = useState(0);
  const pausadoRef = useRef(false);
  const fila = useRef(0);

  const atual = useRef<string | null>(selecionado);
  const conhecidas = useRef<ReadonlySet<string> | null>(null);
  const pedidoSeq = useRef(0);
  const limpaNovas = useRef<number | undefined>(undefined);
  const repoeAnuncio = useRef<number | undefined>(undefined);
  const rajada = useRef<{ n: number; pedidos: Set<string>; timer?: number }>({ n: 0, pedidos: new Set() });

  useEffect(() => {
    atual.current = selecionado;
  }, [selecionado]);

  useEffect(
    () => () => {
      window.clearTimeout(limpaNovas.current);
      window.clearTimeout(repoeAnuncio.current);
      window.clearTimeout(rajada.current.timer);
    },
    [],
  );

  // Limpar e repor o texto faz o leitor de tela anunciar de novo mesmo quando
  // a frase é igual à anterior (a região viva só reage a mutação do DOM).
  const anunciar = useCallback((texto: string) => {
    setAnuncio('');
    window.clearTimeout(repoeAnuncio.current);
    repoeAnuncio.current = window.setTimeout(() => setAnuncio(texto), 60);
  }, []);

  const recarregarLista = useCallback(async () => {
    try {
      setPedidos({ estado: 'ok', dados: await listarPedidos() });
    } catch (e) {
      setPedidos({ estado: 'erro', mensagem: mensagemDe(e) });
    }
  }, []);

  const verificarCadeia = useCallback(
    async (id: string, anunciarResultado = false) => {
      try {
        const dados = await auditarPedido(id);
        if (atual.current !== id) return;
        setAuditoria({ estado: 'ok', dados });
        if (anunciarResultado) {
          anunciar(
            dados.valida
              ? `Cadeia íntegra: ${plural(dados.total, 'evento conferido', 'eventos conferidos')}.`
              : `Cadeia adulterada no evento nº ${(dados.indiceFalha ?? 0) + 1}.`,
          );
        }
      } catch (e) {
        if (atual.current !== id) return;
        setAuditoria({ estado: 'erro', mensagem: mensagemDe(e) });
        if (anunciarResultado) anunciar(`Não foi possível verificar a cadeia: ${mensagemDe(e)}`);
      }
    },
    [anunciar],
  );

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
          const novasTarefas = surgiram.length > 0 ? ` ${plural(surgiram.length, 'tarefa nova', 'tarefas novas')}.` : '';
          anunciar(`${aviso}${novasTarefas} ${plural(dados.totalEventos, 'evento', 'eventos')} no registro.`);
        }
      } catch (e) {
        if (seq === pedidoSeq.current) setProjecao({ estado: 'erro', mensagem: mensagemDe(e) });
      }
      void verificarCadeia(id);
    },
    [verificarCadeia, anunciar],
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
      if (pausadoRef.current) {
        fila.current += 1;
        setPendentes(fila.current);
        return;
      }
      const r = rajada.current;
      r.n += 1;
      r.pedidos.add(evento.pedidoId);
      window.clearTimeout(r.timer);
      r.timer = window.setTimeout(() => {
        const { n, pedidos: afetados } = r;
        r.n = 0;
        r.pedidos = new Set();
        void recarregarLista();
        const aberto = atual.current;
        const quantos = plural(n, 'evento novo', 'eventos novos');
        if (aberto && afetados.has(aberto)) {
          void carregarPedido(aberto, `Pedido ${chaveCurta(aberto)}: ${quantos}.`);
        } else {
          anunciar(`${quantos} em ${plural(afetados.size, 'outro pedido', 'outros pedidos')}.`);
        }
      }, AGRUPA_EVENTOS_MS);
    },
    [recarregarLista, carregarPedido, anunciar],
  );

  const aoConectar = useCallback(() => {
    if (pausadoRef.current) return;
    void recarregarLista();
    if (atual.current) void carregarPedido(atual.current);
  }, [recarregarLista, carregarPedido]);

  const estadoStream = useStream(aoEvento, aoConectar);

  const streamAnterior = useRef(estadoStream);
  useEffect(() => {
    const antes = streamAnterior.current;
    streamAnterior.current = estadoStream;
    if (antes === 'ao_vivo' && estadoStream === 'reconectando') {
      anunciar('Conexão ao vivo perdida. Tentando reconectar.');
    } else if (antes === 'reconectando' && estadoStream === 'ao_vivo') {
      anunciar('Conexão ao vivo restabelecida.');
    }
  }, [estadoStream, anunciar]);

  const selecionar = useCallback((id: string) => {
    window.location.hash = `#/pedido/${encodeURIComponent(id)}`;
  }, []);

  const verificarDeNovo = useCallback(async () => {
    const id = atual.current;
    if (!id) return;
    setAuditoria({ estado: 'carregando' });
    await verificarCadeia(id, true);
  }, [verificarCadeia]);

  const alternarPausa = useCallback(() => {
    if (!pausadoRef.current) {
      pausadoRef.current = true;
      setPausado(true);
      anunciar('Atualizações pausadas. Os eventos novos ficam na fila até você retomar.');
      return;
    }
    pausadoRef.current = false;
    setPausado(false);
    const n = fila.current;
    fila.current = 0;
    setPendentes(0);
    void recarregarLista();
    const aberto = atual.current;
    const aviso = n > 0 ? `Atualizações retomadas: ${plural(n, 'evento aplicado', 'eventos aplicados')}.` : 'Atualizações retomadas.';
    if (aberto) void carregarPedido(aberto, aviso);
    else anunciar(aviso);
  }, [anunciar, recarregarLista, carregarPedido]);

  return {
    pausado,
    pendentes,
    alternarPausa,
    pedidos,
    selecionado,
    projecao,
    auditoria,
    anuncio,
    novas,
    estadoStream,
    selecionar,
    recarregarLista,
    verificarDeNovo,
    anunciar,
  };
}
