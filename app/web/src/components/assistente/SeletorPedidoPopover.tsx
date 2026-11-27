import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import type { PedidoResumo } from '../../api.ts';
import { usePresencaAnimada } from '../../usePresencaAnimada.ts';
import { IconeConfere, IconeLupa } from '../icones.tsx';
import { normalizarConsulta } from '../menuwiki/dados.ts';
import { codigoCurtoPedido } from './conversaUtils.ts';
import { ChevronSeletor } from './TrilhaMatrizAgente.tsx';

// Texto pesquisável de cada pedido: emitente, o código curto que a opção
// mostra e o status textual renderizado ("2 conflitos" / "Consistente") —
// mais id e status cru do resumo, que aceitam consultas coladas.
export function textoBuscaPedido(p: PedidoResumo): string {
  const qtdDiv = p.divergencias ?? 0;
  const statusTexto =
    qtdDiv > 0 ? `${qtdDiv} ${qtdDiv === 1 ? 'conflito' : 'conflitos'}` : 'consistente';
  return `${p.emitente ?? ''} ${codigoCurtoPedido(p.pedidoId)} ${p.pedidoId} ${statusTexto} ${p.status ?? ''}`;
}

// Filtro local do seletor: sem acento e sem caixa (mesma normalização da
// busca do menu wiki). Consulta vazia devolve a lista toda.
export function filtrarPedidos(
  pedidos: readonly PedidoResumo[],
  consulta: string,
): PedidoResumo[] {
  const q = normalizarConsulta(consulta);
  if (!q) return [...pedidos];
  return pedidos.filter((p) => normalizarConsulta(textoBuscaPedido(p)).includes(q));
}

export interface SeletorPedidoPopoverProps {
  pedidos: readonly PedidoResumo[];
  pedidoId: string | null;
  divergenteAtual: boolean;
  aoSelecionar: (id: string) => void;
}

export function SeletorPedidoPopover({
  pedidos,
  pedidoId,
  divergenteAtual,
  aoSelecionar,
}: SeletorPedidoPopoverProps) {
  const listboxId = useId();
  const raizRef = useRef<HTMLDivElement>(null);
  const gatilhoRef = useRef<HTMLButtonElement>(null);
  const listaRef = useRef<HTMLDivElement>(null);
  const buscaRef = useRef<HTMLInputElement>(null);

  const [aberto, setAberto] = useState(false);
  const [indiceAtivo, setIndiceAtivo] = useState(0);
  const [consulta, setConsulta] = useState('');
  const presenca = usePresencaAnimada(aberto, 170);

  const indiceSelecionado = useMemo(
    () => Math.max(0, pedidos.findIndex((p) => p.pedidoId === pedidoId)),
    [pedidos, pedidoId],
  );
  const pedidoAtual = pedidoId ? (pedidos.find((p) => p.pedidoId === pedidoId) ?? null) : null;

  // indiceAtivo e todas as navegações indexam a lista FILTRADA.
  const pedidosFiltrados = useMemo(() => filtrarPedidos(pedidos, consulta), [pedidos, consulta]);

  const abrir = useCallback(
    (indiceInicial?: number) => {
      if (pedidos.length === 0) return;
      setIndiceAtivo(indiceInicial ?? indiceSelecionado);
      setAberto(true);
    },
    [pedidos.length, indiceSelecionado],
  );

  const fechar = useCallback((restaurarFoco = false) => {
    setAberto(false);
    setConsulta('');
    if (restaurarFoco) {
      window.requestAnimationFrame(() => {
        gatilhoRef.current?.focus();
      });
    }
  }, []);

  const selecionarPorIndice = useCallback(
    (idx: number) => {
      const alvo = pedidosFiltrados[idx];
      if (!alvo) return;
      if (alvo.pedidoId !== pedidoId) {
        aoSelecionar(alvo.pedidoId);
      }
      fechar(true);
    },
    [pedidosFiltrados, pedidoId, aoSelecionar, fechar],
  );

  // O foco vai para a busca quando o painel monta de fato: presenca.montado
  // vira um commit depois de aberto — focar no flip de aberto pegava um
  // input ainda desmontado e a página ficava com o foco no gatilho.
  useEffect(() => {
    if (!aberto || !presenca.montado) return;
    window.requestAnimationFrame(() => {
      buscaRef.current?.focus();
    });
  }, [aberto, presenca.montado]);

  // A lista encolhe com a consulta: o índice ativo trava no último válido.
  useEffect(() => {
    setIndiceAtivo((i) => Math.min(i, Math.max(0, pedidosFiltrados.length - 1)));
  }, [pedidosFiltrados.length]);

  // Setas continuam navegando com o foco no input: o destaque precisa
  // acompanhar a rolagem para não sumir da área visível da lista.
  useEffect(() => {
    if (!aberto) return;
    listaRef.current
      ?.querySelector('.ia-pedido-opcao[data-ativo="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [aberto, indiceAtivo]);

  useEffect(() => {
    if (!aberto) return;
    const aoClicarFora = (e: PointerEvent) => {
      if (raizRef.current && e.target instanceof Node && !raizRef.current.contains(e.target)) {
        fechar(false);
      }
    };
    document.addEventListener('pointerdown', aoClicarFora);
    return () => document.removeEventListener('pointerdown', aoClicarFora);
  }, [aberto, fechar]);

  function aoTeclarGatilho(e: ReactKeyboardEvent<HTMLButtonElement>) {
    if (pedidos.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      abrir((indiceSelecionado + 1) % pedidos.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      abrir((indiceSelecionado - 1 + pedidos.length) % pedidos.length);
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (aberto) fechar(false);
      else abrir(indiceSelecionado);
    }
  }

  // Navegação única do menu: serve ao listbox com foco e ao input de busca
  // (setas/Home/End movem o destaque, Enter confirma, Escape devolve o foco
  // ao gatilho). Espaço só confirma no listbox — no input é texto do filtro.
  function aoTeclarMenu(e: ReactKeyboardEvent<HTMLElement>) {
    const total = pedidosFiltrados.length;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (total > 0) setIndiceAtivo((atual) => (atual + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (total > 0) setIndiceAtivo((atual) => (atual - 1 + total) % total);
    } else if (e.key === 'Home') {
      e.preventDefault();
      if (total > 0) setIndiceAtivo(0);
    } else if (e.key === 'End') {
      e.preventDefault();
      if (total > 0) setIndiceAtivo(total - 1);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      selecionarPorIndice(indiceAtivo);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      fechar(true);
    } else if (e.key === 'Tab') {
      fechar(false);
    }
  }

  function aoTeclarLista(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (e.key === ' ') {
      e.preventDefault();
      selecionarPorIndice(indiceAtivo);
      return;
    }
    aoTeclarMenu(e);
  }

  const nomeAtual = pedidoAtual?.emitente?.trim() || 'Pedido';
  const codigoAtual = pedidoAtual ? codigoCurtoPedido(pedidoAtual.pedidoId) : null;

  return (
    <div ref={raizRef} className="ia-pedido-seletor">
      <button
        ref={gatilhoRef}
        type="button"
        className="ia-pedido-gatilho"
        aria-haspopup="listbox"
        aria-expanded={aberto}
        aria-controls={listboxId}
        aria-label="Pedido ativo para consulta"
        disabled={pedidos.length === 0}
        onClick={() => (aberto ? fechar(false) : abrir(indiceSelecionado))}
        onKeyDown={aoTeclarGatilho}
      >
        {pedidoAtual ? (
          <>
            <span
              className="ia-pedido-ponto"
              data-status={divergenteAtual ? 'divergente' : 'ok'}
              aria-hidden="true"
            />
            <span className="ia-pedido-texto">
              <span className="ia-pedido-nome">{nomeAtual}</span>
              <span className="ia-pedido-sep" aria-hidden="true">
                ·
              </span>
              <span className="ia-pedido-cod mono num">{codigoAtual}</span>
            </span>
          </>
        ) : (
          <span className="ia-pedido-vazio">Nenhum pedido disponível</span>
        )}
        <ChevronSeletor />
      </button>

      {presenca.montado && (
        <div className="ia-pedido-menu" data-fase={presenca.fase}>
          <div className="ia-pedido-busca-campo">
            <IconeLupa />
            <input
              ref={buscaRef}
              type="search"
              className="ia-pedido-busca"
              value={consulta}
              placeholder="Emitente, código ou status"
              aria-label="Filtrar pedidos"
              aria-controls={listboxId}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setConsulta(e.target.value);
                setIndiceAtivo(0);
              }}
              onKeyDown={aoTeclarMenu}
            />
          </div>
          <div
            ref={listaRef}
            id={listboxId}
            role="listbox"
            tabIndex={-1}
            aria-label="Pedidos disponíveis"
            aria-activedescendant={
              pedidosFiltrados.length > 0 ? `${listboxId}-opt-${indiceAtivo}` : undefined
            }
            className="ia-pedido-lista"
            onKeyDown={aoTeclarLista}
          >
            {pedidosFiltrados.length === 0 && (
              <div
                className="ia-pedido-semresultado"
                role="option"
                aria-selected={false}
                aria-disabled="true"
              >
                Nenhum pedido corresponde
              </div>
            )}
            {pedidosFiltrados.map((p, idx) => {
              const selecionado = p.pedidoId === pedidoId;
              const ativo = idx === indiceAtivo;
              const qtdDiv = p.divergencias ?? 0;
              const divergente = qtdDiv > 0;
              const codigo = codigoCurtoPedido(p.pedidoId);
              const emitente = p.emitente?.trim() || `Pedido ${codigo}`;

              return (
                <div
                  key={p.pedidoId}
                  id={`${listboxId}-opt-${idx}`}
                  role="option"
                  aria-selected={selecionado}
                  className="ia-pedido-opcao"
                  data-ativo={ativo ? 'true' : undefined}
                  onMouseEnter={() => setIndiceAtivo(idx)}
                  onClick={() => selecionarPorIndice(idx)}
                >
                  <span
                    className="ia-pedido-ponto"
                    data-status={divergente ? 'divergente' : 'ok'}
                    aria-hidden="true"
                  />
                  <span className="ia-pedido-opcao-corpo">
                    <span className="ia-pedido-opcao-topo">
                      <span className="ia-pedido-opcao-nome">{emitente}</span>
                      <span className="ia-pedido-opcao-cod mono num">{codigo}</span>
                    </span>
                    <span className="ia-pedido-opcao-sub">
                      <span
                        className="ia-pedido-opcao-status"
                        data-status={divergente ? 'divergente' : 'ok'}
                      >
                        {divergente
                          ? `${qtdDiv} ${qtdDiv === 1 ? 'conflito' : 'conflitos'}`
                          : 'Consistente'}
                      </span>
                      {p.daSessao && <span className="ia-pedido-opcao-sessao">Sua sessão</span>}
                    </span>
                  </span>
                  {selecionado && (
                    <span className="ia-pedido-opcao-check" aria-hidden="true">
                      <IconeConfere />
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
