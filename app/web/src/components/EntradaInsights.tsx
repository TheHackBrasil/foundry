// Entrada de insights (spec 0016): sequencia curta estilo "stories", um
// insight por vez, computada dos GETs existentes — a porta de entrada que
// prova valor em segundos para quem nao conhece o produto. Cai no estado
// vazio da torre quando nao ha insight ou quando a sessao ja viu.

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { AlvoFocoGenUI, Metricas } from '../../../shared/model.ts';
import type { PedidoResumo } from '../api.ts';
import { comporInsights } from '../insights.ts';
import { chaveCurta } from '../format.ts';
import { listarCasos, listarMetricas } from '../operacao/api.ts';
import type { CasoLista } from '../operacao/dominio.ts';
import { useMovimentoReduzido } from '../shaders/index.ts';
import { IconeMais, IconePausa, IconeRetomar, IconeSeta } from './icones.tsx';
import '../insights.css';

export interface EntradaInsightsProps {
  pedidos: PedidoResumo[];
  // Mesmo criterio do bloco original: lista ok e vazia vira "Nada para mostrar".
  vazio: boolean;
  // true enquanto a primeira carga de pedidos nao chegou.
  aguardando: boolean;
  // Sobe a cada evento SSE: a sequencia re-agrega junto com o resto da torre.
  pulsoEventoSeq: number;
  aoAbrirPedido: (pedidoId: string, foco?: AlvoFocoGenUI) => void;
  aoEnviarDocumento: () => void;
  aoAnunciar: (texto: string) => void;
}

// Quem ja viu a sequencia nesta sessao cai direto na lista (sessionStorage:
// a cada visita nova a apresentacao volta). Chave versionada como o resto.
const CHAVE_VISTO = 'forseti:insights:v1';

function jaViu(): boolean {
  try {
    return window.sessionStorage.getItem(CHAVE_VISTO) === '1';
  } catch {
    return false;
  }
}

function marcarVisto(): void {
  try {
    window.sessionStorage.setItem(CHAVE_VISTO, '1');
  } catch {
    // sem armazenamento: a apresentacao volta na proxima navegacao interna
  }
}

const AVANCO_MS = 7000;

// Fallback preservado do bloco anterior de App.tsx: titulo, dica, lista de
// ate 8 pedidos com selo e o botao de envio.
function EstadoVazio({
  vazio,
  pedidos,
  aoEnviarDocumento,
}: {
  vazio: boolean;
  pedidos: PedidoResumo[];
  aoEnviarDocumento: () => void;
}) {
  return (
    <section aria-labelledby="vazio-titulo" className="vazio">
      <h1 id="vazio-titulo">{vazio ? 'Nada para mostrar ainda' : 'Escolha um pedido'}</h1>
      <p className="dica">
        Envie uma NF-e, CT-e, planilha ou e-mail. O Forseti compara o que cada fonte
        declara, aponta divergências e gera tarefas por setor.
      </p>
      {pedidos.length > 0 && (
        <nav aria-label="Pedidos disponíveis" style={{ width: '100%' }}>
          <ul className="vazio-pedidos">
            {pedidos.slice(0, 8).map((p) => {
              const emitente = p.emitente?.trim() || chaveCurta(p.pedidoId);
              const divs = p.divergencias ?? 0;
              const selo =
                p.status === 'cancelada'
                  ? 'Cancelada'
                  : (p.atrasoDias ?? 0) > 0
                    ? `+${p.atrasoDias}d de atraso`
                    : divs > 0
                      ? `${divs} ${divs === 1 ? 'desvio' : 'desvios'}`
                      : 'Consistente';
              return (
                <li key={p.pedidoId}>
                  <a href={`#/pedido/${encodeURIComponent(p.pedidoId)}`} className="vazio-pedido">
                    <span className="vazio-pedido-nome">{emitente}</span>
                    <span className="vazio-pedido-meta num">
                      {selo} · …{p.pedidoId.slice(-6)}
                    </span>
                  </a>
                </li>
              );
            })}
          </ul>
          {pedidos.length > 8 && (
            <p className="dica vazio-pedidos-extra">
              Mais {pedidos.length - 8} pedidos na lista lateral.
            </p>
          )}
        </nav>
      )}
      <button type="button" className="botao vazio-acao" onClick={aoEnviarDocumento}>
        <IconeMais />
        <span>Enviar documento</span>
      </button>
    </section>
  );
}

export function EntradaInsights({
  pedidos,
  vazio,
  aguardando,
  pulsoEventoSeq,
  aoAbrirPedido,
  aoEnviarDocumento,
  aoAnunciar,
}: EntradaInsightsProps) {
  const [visto, setVisto] = useState(jaViu);
  const [dados, setDados] = useState<{ casos: CasoLista[]; metricas: Metricas | null } | null>(null);
  const [idx, setIdx] = useState(0);
  const [pausado, setPausado] = useState(false);
  const reduzido = useMovimentoReduzido();
  const ctaRef = useRef<HTMLAnchorElement | null>(null);
  const fetchSeq = useRef(0);
  const anunciadoRef = useRef<string | null>(null);

  // Casos e metricas entram no compositor; falha de um GET derruba so os
  // insights que dependem dele (carga parcial, degradacao por fonte).
  useEffect(() => {
    if (visto) return;
    let vivo = true;
    const seq = ++fetchSeq.current;
    void Promise.allSettled([listarCasos(), listarMetricas()]).then(([rCasos, rMetricas]) => {
      if (!vivo || seq !== fetchSeq.current) return;
      setDados({
        casos: rCasos.status === 'fulfilled' ? rCasos.value.casos : [],
        metricas: rMetricas.status === 'fulfilled' ? rMetricas.value.metricas : null,
      });
    });
    return () => {
      vivo = false;
    };
  }, [pulsoEventoSeq, visto]);

  const insights = useMemo(
    () => (dados ? comporInsights(pedidos, dados.casos, dados.metricas) : null),
    [pedidos, dados],
  );
  const total = insights?.length ?? 0;
  const idxEfetivo = Math.min(idx, Math.max(0, total - 1));
  const atual = insights?.[idxEfetivo];
  const noUltimo = idxEfetivo === total - 1;

  const encerrar = useCallback(() => {
    marcarVisto();
    setVisto(true);
    aoAnunciar('Apresentação encerrada. A lista de pedidos está visível.');
  }, [aoAnunciar]);

  // Navegacao manual pausa o avanco automatico: a pessoa dita o ritmo.
  const irPara = useCallback(
    (n: number) => {
      setPausado(true);
      setIdx(Math.max(0, Math.min(n, total - 1)));
    },
    [total],
  );

  const abrirAtual = useCallback(() => {
    if (!atual) return;
    aoAbrirPedido(atual.pedidoId, atual.foco);
  }, [atual, aoAbrirPedido]);

  // Avanco automatico pausavel; com prefers-reduced-motion nao ha autoplay.
  useEffect(() => {
    if (visto || reduzido || pausado || total <= 1 || noUltimo) return;
    const t = window.setTimeout(() => setIdx((i) => Math.min(i + 1, total - 1)), AVANCO_MS);
    return () => window.clearTimeout(t);
  }, [visto, reduzido, pausado, idxEfetivo, total, noUltimo]);

  // Cada slide anunciado uma vez na regiao viva da torre; se a re-agregacao
  // troca o insight da posicao, a troca entra como slide novo.
  useEffect(() => {
    if (!atual) return;
    const chave = `${idxEfetivo}:${atual.id}`;
    if (anunciadoRef.current === chave) return;
    anunciadoRef.current = chave;
    aoAnunciar(`Insight ${idxEfetivo + 1} de ${total}: ${atual.titulo}.`);
  }, [atual, idxEfetivo, total, aoAnunciar]);

  // Teclado completo (AC4): setas trocam de slide, Enter segue o CTA,
  // Escape pula a sequencia. So age quando o foco nao esta num controle
  // interativo nem num modal aberto por cima (envio, gavetas).
  useEffect(() => {
    if (visto || total === 0) return;
    const aoTecla = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      if (alvo?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[aria-modal="true"], dialog[open]')) return;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowDown':
          e.preventDefault();
          irPara(idxEfetivo + 1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
          e.preventDefault();
          irPara(idxEfetivo - 1);
          break;
        case 'Home':
          e.preventDefault();
          irPara(0);
          break;
        case 'End':
          e.preventDefault();
          irPara(total - 1);
          break;
        case 'Escape':
          e.preventDefault();
          encerrar();
          break;
        case 'Enter':
          if (alvo?.closest('button, a, summary, [role="button"], [role="link"]')) break;
          e.preventDefault();
          abrirAtual();
          break;
      }
    };
    document.addEventListener('keydown', aoTecla);
    return () => document.removeEventListener('keydown', aoTecla);
  }, [visto, total, idxEfetivo, irPara, encerrar, abrirAtual]);

  if (visto) {
    return <EstadoVazio vazio={vazio} pedidos={pedidos} aoEnviarDocumento={aoEnviarDocumento} />;
  }
  if (aguardando || !insights) {
    return <p className="meta insights-carga">Carregando…</p>;
  }
  if (!atual) {
    return <EstadoVazio vazio={vazio} pedidos={pedidos} aoEnviarDocumento={aoEnviarDocumento} />;
  }

  return (
    <section
      className="insights"
      aria-labelledby="insights-titulo"
      aria-describedby="insights-teclas"
    >
      <div className="insights-topo">
        <ol className="insights-progresso" aria-label="Progresso da apresentação">
          {insights.map((it, i) => (
            <li key={it.id}>
              <button
                type="button"
                className="insights-seg"
                data-ativa={i === idxEfetivo ? 'true' : undefined}
                data-feita={i < idxEfetivo ? 'true' : undefined}
                data-pausada={i === idxEfetivo && (pausado || reduzido) ? 'true' : undefined}
                aria-label={`Insight ${i + 1} de ${total}: ${it.titulo}`}
                aria-current={i === idxEfetivo ? 'true' : undefined}
                onClick={() => irPara(i)}
              >
                <span className="insights-seg-trilho">
                  <span
                    className="insights-seg-barra"
                    style={{ '--avanco': `${AVANCO_MS}ms` } as CSSProperties}
                  />
                </span>
              </button>
            </li>
          ))}
        </ol>
        <button type="button" className="botao-sutil insights-pular" onClick={encerrar}>
          Pular apresentação
        </button>
      </div>

      <div className="insights-corpo" key={atual.id}>
        <p className="insights-kicker">O que o Forseti já viu</p>
        <h1 id="insights-titulo" className="insights-titulo">
          {atual.titulo}
        </h1>
        <p className="insights-texto">{atual.texto}</p>
        {atual.simulacao && <span className="pilula-sutil insights-sim">simulação</span>}
      </div>

      <div className="insights-acoes">
        <a
          ref={ctaRef}
          className="botao insights-cta"
          href={`#/pedido/${encodeURIComponent(atual.pedidoId)}`}
          onClick={(e) => {
            e.preventDefault();
            abrirAtual();
          }}
        >
          <span>Ver no pedido</span>
          <IconeSeta />
        </a>
        {noUltimo && (
          <button type="button" className="botao-sutil" onClick={encerrar}>
            Ver a lista de pedidos
          </button>
        )}
        <div className="insights-nav">
          {!reduzido && (
            <button
              type="button"
              className="botao-sutil insights-avanco"
              aria-label={pausado ? 'Retomar avanço automático' : 'Pausar avanço automático'}
              onClick={() => setPausado((p) => !p)}
            >
              {pausado ? <IconeRetomar /> : <IconePausa />}
            </button>
          )}
          <button
            type="button"
            className="botao-sutil insights-avanco"
            aria-label="Insight anterior"
            disabled={idxEfetivo === 0}
            onClick={() => irPara(idxEfetivo - 1)}
          >
            <span className="insights-flip">
              <IconeSeta />
            </span>
          </button>
          <button
            type="button"
            className="botao-sutil insights-avanco"
            aria-label="Próximo insight"
            disabled={noUltimo}
            onClick={() => irPara(idxEfetivo + 1)}
          >
            <IconeSeta />
          </button>
        </div>
      </div>
      <p id="insights-teclas" className="meta insights-teclas">
        Setas trocam de insight · Enter abre o pedido · Esc pula
      </p>
    </section>
  );
}
