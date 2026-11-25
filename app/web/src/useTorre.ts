import { useCallback, useEffect, useRef, useState } from 'react';
import type { Contato, Evento, ProjecaoPedido, RespostaAuditoria } from '../../shared/model.ts';
import { autoForkPedidoNaSessao, type PedidoResumo } from './api.ts';
import {
  assinaturaAuditoria,
  assinaturaContatos,
  assinaturaPedidos,
  assinaturaProjecao,
  buscarAuditoria,
  buscarContatos,
  buscarPedidos,
  buscarProjecao,
  buscarRevisao,
} from './components/menuwiki/rede.ts';
import { chaveCurta } from './format.ts';
import { chaveTarefa } from './matriz.ts';
import { useStream, type EventoAncoraStream } from './useStream.ts';

export type Carga<T> =
  | { estado: 'carregando' }
  | { estado: 'erro'; mensagem: string }
  | { estado: 'ok'; dados: T };

export type RotaTorre = 'torre' | 'ia';

interface HashRota {
  rota: RotaTorre;
  pedidoId: string | null;
}

const NOVA_POR_MS = 8000;
// Eventos que chegam juntos (um upload gera dezenas) viram uma busca e um aviso.
const AGRUPA_EVENTOS_MS = 300;

function decodificar(parte: string): string {
  try {
    return decodeURIComponent(parte);
  } catch {
    return parte;
  }
}

export function lerRotaHash(hash = window.location.hash): HashRota {
  const mIa = /^#\/ia(?:\/([^/?#]+))?/.exec(hash);
  if (mIa) {
    return { rota: 'ia', pedidoId: mIa[1] ? decodificar(mIa[1]) : null };
  }
  const mPed = /^#\/pedido\/([^/?#]+)/.exec(hash);
  if (mPed?.[1]) {
    return { rota: 'torre', pedidoId: decodificar(mPed[1]) };
  }
  return { rota: 'torre', pedidoId: null };
}

const mensagemDe = (e: unknown): string => (e instanceof Error ? e.message : 'Erro inesperado.');
const plural = (n: number, um: string, varios: string): string => `${n} ${n === 1 ? um : varios}`;

// Busca dados, mantém a rota (#/pedido/:id ou #/ia/:id?) e coordena SSE + auxiliares.
export function useTorre() {
  const inicial = lerRotaHash();
  const [rota, setRota] = useState<RotaTorre>(inicial.rota);
  const [pedidos, setPedidos] = useState<Carga<PedidoResumo[]>>({ estado: 'carregando' });
  const [selecionado, setSelecionado] = useState<string | null>(inicial.pedidoId);
  const [projecao, setProjecao] = useState<Carga<ProjecaoPedido>>({ estado: 'carregando' });
  const [auditoria, setAuditoria] = useState<Carga<RespostaAuditoria>>({ estado: 'carregando' });
  const [contatos, setContatos] = useState<Contato[]>([]);
  const [revisaoPendentes, setRevisaoPendentes] = useState(0);
  const [pulsoEventoSeq, setPulsoEventoSeq] = useState(0);
  const [anuncio, setAnuncio] = useState('');
  const [novas, setNovas] = useState<ReadonlySet<string>>(new Set());
  // Pausa das atualizações ao vivo (WCAG 2.2.2): enquanto pausado, eventos viram contagem
  // e a tela só se atualiza quando a pessoa retoma.
  const [primeiraRespostaDaApi, setPrimeiraRespostaDaApi] = useState(false);
  const [pausado, setPausado] = useState(false);
  const [pendentes, setPendentes] = useState(0);
  const pausadoRef = useRef(false);
  const fila = useRef(0);

  const atual = useRef<string | null>(selecionado);
  const rotaRef = useRef<RotaTorre>(rota);
  const conhecidas = useRef<ReadonlySet<string> | null>(null);
  // Assinaturas do ultimo estado aplicado: resposta repetida nao troca o
  // objeto de estado, entao efeitos a jusante (MenuWiki, painel) nem disparam.
  const assinaturaListaRef = useRef<string | null>(null);
  const assinaturaProjRef = useRef<string | null>(null);
  const assinaturaAuditoriaRef = useRef<string | null>(null);
  const assinaturaContatosRef = useRef<string | null>(null);
  const pedidoSeq = useRef(0);
  const limpaNovas = useRef<number | undefined>(undefined);
  const repoeAnuncio = useRef<number | undefined>(undefined);
  const rajada = useRef<{ n: number; pedidos: Set<string>; timer?: number }>({ n: 0, pedidos: new Set() });

  useEffect(() => {
    atual.current = selecionado;
  }, [selecionado]);

  useEffect(() => {
    rotaRef.current = rota;
  }, [rota]);

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

  const recarregarAuxiliares = useCallback(async () => {
    const [resRevisao, resContatos] = await Promise.allSettled([buscarRevisao(), buscarContatos()]);
    if (resRevisao.status === 'fulfilled') {
      setRevisaoPendentes(resRevisao.value.itens.filter((item) => item.status === 'pendente').length);
    }
    if (resContatos.status === 'fulfilled') {
      const sig = assinaturaContatos(resContatos.value);
      if (sig !== assinaturaContatosRef.current) {
        assinaturaContatosRef.current = sig;
        setContatos(resContatos.value);
      }
    }
  }, []);

  const recarregarLista = useCallback(async () => {
    try {
      const dados = await buscarPedidos();
      const sig = assinaturaPedidos(dados);
      if (sig !== assinaturaListaRef.current) {
        assinaturaListaRef.current = sig;
        setPedidos({ estado: 'ok', dados });
      }
    } catch (e) {
      // Falha zera a assinatura: a resposta seguinte sempre reaplica estado,
      // mesmo identica a da ultima carga bem-sucedida.
      assinaturaListaRef.current = null;
      setPedidos({ estado: 'erro', mensagem: mensagemDe(e) });
    } finally {
      setPrimeiraRespostaDaApi(true);
    }
    void recarregarAuxiliares();
  }, [recarregarAuxiliares]);

  const verificarCadeia = useCallback(
    async (id: string, anunciarResultado = false) => {
      try {
        const dados = await buscarAuditoria(id);
        if (atual.current !== id) return;
        const sig = assinaturaAuditoria(dados);
        if (sig !== assinaturaAuditoriaRef.current) {
          assinaturaAuditoriaRef.current = sig;
          setAuditoria({ estado: 'ok', dados });
        }
        if (anunciarResultado) {
          anunciar(
            dados.valida
              ? `Cadeia íntegra: ${plural(dados.total, 'evento conferido', 'eventos conferidos')}.`
              : `Cadeia adulterada no evento nº ${(dados.indiceFalha ?? 0) + 1}.`,
          );
        }
      } catch (e) {
        if (atual.current !== id) return;
        assinaturaAuditoriaRef.current = null;
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
        const dados = await buscarProjecao(id);
        if (seq !== pedidoSeq.current) return;
        const sig = assinaturaProjecao(dados);
        if (sig !== assinaturaProjRef.current) {
          assinaturaProjRef.current = sig;
          setProjecao({ estado: 'ok', dados });
        }
        const chaves = new Set(dados.tarefas.map(chaveTarefa));
        const antes = conhecidas.current;
        const surgiram = antes ? [...chaves].filter((k) => !antes.has(k)) : [];
        conhecidas.current = chaves;
        if (surgiram.length > 0) {
          setNovas(new Set(surgiram));
          setPulsoEventoSeq((s) => s + 1);
          window.clearTimeout(limpaNovas.current);
          limpaNovas.current = window.setTimeout(() => setNovas(new Set()), NOVA_POR_MS);
        }
        if (aviso) {
          const novasTarefas = surgiram.length > 0 ? ` ${plural(surgiram.length, 'tarefa nova', 'tarefas novas')}.` : '';
          anunciar(`${aviso}${novasTarefas} ${plural(dados.totalEventos, 'evento', 'eventos')} no registro.`);
        }
      } catch (e) {
        if (seq === pedidoSeq.current) {
          assinaturaProjRef.current = null;
          setProjecao({ estado: 'erro', mensagem: mensagemDe(e) });
        }
      }
      void verificarCadeia(id);
    },
    [verificarCadeia, anunciar],
  );

  useEffect(() => {
    const aoMudarHash = () => {
      const parsed = lerRotaHash();
      setRota(parsed.rota);
      if (parsed.pedidoId) {
        setSelecionado(parsed.pedidoId);
      } else if (parsed.rota === 'torre') {
        setSelecionado(null);
      }
    };
    window.addEventListener('hashchange', aoMudarHash);
    void recarregarLista();
    return () => window.removeEventListener('hashchange', aoMudarHash);
  }, [recarregarLista]);

  useEffect(() => {
    if (pedidos.estado === 'ok' && !selecionado && pedidos.dados[0]) {
      const primeiroId = pedidos.dados[0].pedidoId;
      if (rota === 'ia') {
        setSelecionado(primeiroId);
      } else {
        window.location.replace(`#/pedido/${encodeURIComponent(primeiroId)}`);
      }
    }
  }, [pedidos, selecionado, rota]);

  useEffect(() => {
    conhecidas.current = null;
    assinaturaProjRef.current = null;
    assinaturaAuditoriaRef.current = null;
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
      setPulsoEventoSeq((s) => s + 1);
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

  const aoAncora = useCallback(
    (info: EventoAncoraStream) => {
      if (pausadoRef.current) return;
      setPulsoEventoSeq((s) => s + 1);
      void recarregarLista();
      const alvo = info.pedidoId ?? atual.current;
      if (alvo && atual.current === alvo) {
        void verificarCadeia(alvo, true);
      }
    },
    [recarregarLista, verificarCadeia],
  );

  const aoConectar = useCallback(() => {
    if (pausadoRef.current) return;
    void recarregarLista();
    if (atual.current) void carregarPedido(atual.current);
  }, [recarregarLista, carregarPedido]);

  const estadoStream = useStream(aoEvento, aoConectar, primeiraRespostaDaApi, aoAncora);

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
    if (rotaRef.current === 'ia') {
      window.location.hash = `#/ia/${encodeURIComponent(id)}`;
    } else {
      window.location.hash = `#/pedido/${encodeURIComponent(id)}`;
    }
  }, []);

  const irParaTorre = useCallback((id?: string | null) => {
    const alvo = id ?? atual.current;
    window.location.hash = alvo ? `#/pedido/${encodeURIComponent(alvo)}` : '#/';
  }, []);

  const irParaAssistente = useCallback((id?: string | null) => {
    const alvo = id ?? atual.current;
    window.location.hash = alvo ? `#/ia/${encodeURIComponent(alvo)}` : '#/ia';
  }, []);

  const recarregarPedidoAtual = useCallback(async () => {
    const id = atual.current;
    await recarregarLista();
    if (id) await carregarPedido(id);
  }, [recarregarLista, carregarPedido]);

  const verificarDeNovo = useCallback(async () => {
    const id = atual.current;
    if (!id) return;
    // 'carregando' apaga a assinatura para a resposta nunca saltar o estado ok.
    assinaturaAuditoriaRef.current = null;
    setAuditoria({ estado: 'carregando' });
    await verificarCadeia(id, true);
  }, [verificarCadeia]);

  const garantirPedidoNaSessao = useCallback(
    async (pedidoId?: string | null): Promise<string | null> => {
      const alvo = pedidoId ?? atual.current;
      const lista = pedidos.estado === 'ok' ? pedidos.dados : [];
      const existente = alvo ? lista.find((p) => p.pedidoId === alvo) : undefined;
      if (existente?.daSessao) return existente.pedidoId;

      const r = await autoForkPedidoNaSessao(alvo);
      if (r.enviados === 0 || !r.pedidoId) return null;
      await recarregarLista();
      await carregarPedido(r.pedidoId);
      anunciar(`Pedido ${chaveCurta(r.pedidoId)} copiado para sua sessão isolada.`);
      return r.pedidoId;
    },
    [pedidos, recarregarLista, carregarPedido, anunciar],
  );

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
    rota,
    irParaTorre,
    irParaAssistente,
    pausado,
    pendentes,
    alternarPausa,
    pedidos,
    selecionado,
    projecao,
    auditoria,
    contatos,
    revisaoPendentes,
    pulsoEventoSeq,
    anuncio,
    novas,
    estadoStream,
    selecionar,
    recarregarLista,
    recarregarAuxiliares,
    recarregarPedidoAtual,
    verificarDeNovo,
    garantirPedidoNaSessao,
    anunciar,
  };
}
