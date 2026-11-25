import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  CARD_IDS,
  COLUNAS_MAX,
  LAYOUT_PADRAO,
  TEMPLATES_VISTA,
  aplicarTemplate,
  guardarLayoutPedido,
  guardarTemplatesCustom,
  inserirEm,
  lerLayoutPedido,
  lerTemplatesCustom,
  templateCorrespondente,
  type CardId,
  type LayoutTorre,
  type VistaTemplate,
} from './layout.ts';
import { TorreCard, type TorreCardHandleProps } from './TorreCard.tsx';
import { TorreVistas } from './TorreVistas.tsx';

export interface CardMeta {
  titulo: string;
  // Largura padrão em colunas do masonry (clamp ao nº de colunas que couber).
  span: number;
}

// Defaults pensados para o grid em 3 colunas: linhas fecham sem vãos
// (matriz 2 + tarefas 1, domino full, sinais 1 + cadeia 2, simulador/versoes full).
export const CARD_META: Record<CardId, CardMeta> = {
  matriz: { titulo: 'Fontes e campos', span: 2 },
  tarefas: { titulo: 'Tarefas abertas', span: 1 },
  domino: { titulo: 'Mapa de impacto causal', span: 3 },
  sinais: { titulo: 'Sinais e avisos', span: 1 },
  cadeia: { titulo: 'Status da cadeia', span: 2 },
  simulador: { titulo: 'Simulador de impacto', span: 3 },
  versoes: { titulo: 'Histórico de versões', span: 3 },
};

// Densidade global: largura-alvo de cada coluna — quanto maior, menos colunas
// cabem na largura disponível (mesmo esquema do widget de referência).
const ALVO_COLUNA = [240, 320, 470] as const;
const GAP = 20;
// Altura assumida antes da primeira medição via ResizeObserver.
const ALTURA_ESTIMADA = 170;

interface TorreGridProps {
  pedidoId: string;
  cards: Partial<Record<CardId, ReactNode>>;
  titulosCard?: Partial<Record<CardId, string>>;
  aoAnunciar: (texto: string) => void;
}

interface DragAtivo {
  id: CardId;
  pointerId: number;
  sec: HTMLElement;
  peca: HTMLElement;
  grabDX: number;
  grabDY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  ordemAntes: CardId[];
  moved: boolean;
}

interface Posicao {
  x: number;
  y: number;
  w: number;
  h: number;
  coluna: number;
  span: number;
}

// Espaço livre que um card largo deixa para trás ao pousar acima de uma coluna
// mais baixa — preenchido por cards pequenos que vêm depois (backfill).
interface Buraco {
  col: number;
  cima: number;
  baixo: number;
}

// Orquestrador do tiling (THE-18): packing masonry — cada card cai na faixa de
// `span` colunas mais baixa, posições/tamanhos saem do cálculo (não do CSS
// grid) e transições de transform/width/height animam qualquer retile. Alturas
// são medidas por ResizeObserver na .torre-card-medida de cada card.
export function TorreGrid({ pedidoId, cards, titulosCard, aoAnunciar }: TorreGridProps) {
  const [layout, setLayout] = useState<LayoutTorre>(
    () => lerLayoutPedido(pedidoId) ?? { ...LAYOUT_PADRAO },
  );
  const [templatesCustom, setTemplatesCustom] = useState<VistaTemplate[]>(() =>
    lerTemplatesCustom(),
  );
  const [dragId, setDragId] = useState<CardId | null>(null);
  const [gridW, setGridW] = useState(0);
  const [heights, setHeights] = useState<Partial<Record<CardId, number>>>({});

  const elsRef = useRef(new Map<CardId, HTMLElement>());
  const pecasRef = useRef(new Map<CardId, HTMLElement>());
  const medidasRef = useRef(new Map<CardId, HTMLElement>());
  const dragRef = useRef<DragAtivo | null>(null);
  const gridElRef = useRef<HTMLDivElement | null>(null);
  const ordemVisivelRef = useRef<CardId[]>([]);
  const posMapRef = useRef(new Map<CardId, Posicao>());
  const frameRef = useRef(0);

  const ocultosSet = useMemo(() => new Set(layout.ocultos), [layout.ocultos]);
  const recolhidosSet = useMemo(() => new Set(layout.recolhidos), [layout.recolhidos]);
  const ordemVisivel = useMemo(
    () => layout.ordem.filter((id) => cards[id] !== undefined && !ocultosSet.has(id)),
    [layout.ordem, ocultosSet, cards],
  );
  ordemVisivelRef.current = ordemVisivel;

  const ocultosSetRef = useRef(ocultosSet);
  ocultosSetRef.current = ocultosSet;

  const densidade = layout.densidade ?? 1;
  const cols = Math.max(1, Math.min(COLUNAS_MAX, Math.floor(gridW / ALVO_COLUNA[densidade]) || 1));
  const cardW = gridW > 0 ? (gridW - (cols - 1) * GAP) / cols : 0;

  // Outro pedido foi aberto no mesmo mount (sem key no PainelPedido):
  // recarrega o layout persistido daquele pedido.
  useEffect(() => {
    setLayout(lerLayoutPedido(pedidoId) ?? { ...LAYOUT_PADRAO });
  }, [pedidoId]);

  useEffect(() => {
    guardarLayoutPedido(pedidoId, layout);
  }, [pedidoId, layout]);

  useEffect(() => {
    guardarTemplatesCustom(templatesCustom);
  }, [templatesCustom]);

  // Um ResizeObserver para a largura do grid → número de colunas.
  useEffect(() => {
    const el = gridElRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? el.clientWidth;
      setGridW((prev) => (Math.abs(prev - w) >= 1 ? w : prev));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Um ResizeObserver para as alturas naturais: cada .torre-card-medida reporta
  // sua altura de conteúdo — é a métrica do packing (o visual anima por CSS).
  const roMedidasRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      setHeights((prev) => {
        let mudou = false;
        const prox = { ...prev };
        for (const e of entries) {
          const el = e.target as HTMLElement;
          const id = el.dataset.cardMedida as CardId | undefined;
          if (!id) continue;
          const h = el.offsetHeight;
          if (Math.abs((prox[id] ?? 0) - h) >= 1) {
            prox[id] = h;
            mudou = true;
          }
        }
        return mudou ? prox : prev;
      });
    });
    roMedidasRef.current = ro;
    return () => ro.disconnect();
  }, []);

  const medidaRef = useCallback(
    (id: CardId) => (el: HTMLElement | null) => {
      if (el) {
        medidasRef.current.set(id, el);
        roMedidasRef.current?.observe(el);
      } else {
        const antigo = medidasRef.current.get(id);
        if (antigo) roMedidasRef.current?.unobserve(antigo);
        medidasRef.current.delete(id);
      }
    },
    [],
  );

  useEffect(() => () => {
    if (frameRef.current) cancelAnimationFrame(frameRef.current);
  }, []);

  const spanDe = useCallback(
    (id: CardId) => {
      const s = layout.spans?.[id];
      const base = typeof s === 'number' && Number.isFinite(s) ? s : CARD_META[id].span;
      return Math.max(1, Math.min(cols, base));
    },
    [layout.spans, cols],
  );
  // Packing masonry: para cada card, a faixa de `span` colunas mais baixa —
  // expandir só empurra quem está abaixo; o dense é estrutural, não opcional.
  // Cards que pousam mais alto que o topo de uma coluna deixam um Buraco:
  // cards posteriores que couberem ali sobem (skyline com backfill).
  const posMap = useMemo(() => {
    const mapa = new Map<CardId, Posicao>();
    if (cols < 1 || cardW <= 0) return mapa;
    const colH = new Array<number>(cols).fill(0);
    const buracos: Buraco[] = [];
    for (const id of ordemVisivel) {
      const span = Math.min(spanDe(id), cols);
      const h = heights[id] ?? ALTURA_ESTIMADA;
      let bx = 0;
      let bh = Infinity;
      for (let i = 0; i + span <= cols; i += 1) {
        const topo = Math.max(...colH.slice(i, i + span));
        if (topo < bh) {
          bh = topo;
          bx = i;
        }
      }
      // Backfill: uma faixa de colunas adjacentes cujos buracos têm sobreposição
      // comum >= h hospeda o card mais alto que a skyline permitiria.
      let usados: Buraco[] | null = null;
      for (let i = 0; i + span <= cols; i += 1) {
        let topo = -Infinity;
        let fundo = Infinity;
        const cand: Buraco[] = [];
        let ok = true;
        for (let c = i; c < i + span; c += 1) {
          const b = buracos.find((x) => x.col === c && x.baixo - x.cima >= h);
          if (!b) {
            ok = false;
            break;
          }
          cand.push(b);
          topo = Math.max(topo, b.cima);
          fundo = Math.min(fundo, b.baixo);
        }
        if (ok && fundo - topo >= h && topo < bh) {
          bx = i;
          bh = topo;
          usados = cand;
          break;
        }
      }
      mapa.set(id, {
        x: bx * (cardW + GAP),
        y: bh,
        w: span * cardW + (span - 1) * GAP,
        h,
        coluna: bx,
        span,
      });
      if (usados) {
        // O trecho acima de bh (buracos de alturas diferentes) continua livre;
        // o de baixo vira um buraco menor ou some.
        for (const b of usados) {
          const fim = b.baixo;
          if (b.cima < bh - 1) {
            b.baixo = bh;
            if (bh + h + GAP < fim - 1) {
              buracos.push({ col: b.col, cima: bh + h + GAP, baixo: fim });
            }
          } else {
            b.cima = bh + h + GAP;
            if (b.baixo - b.cima < 1) buracos.splice(buracos.indexOf(b), 1);
          }
        }
      } else {
        for (let i = bx; i < bx + span; i += 1) {
          const col = colH[i];
          if (col !== undefined && col < bh - 1) {
            buracos.push({ col: i, cima: col, baixo: bh });
          }
          colH[i] = bh + h + GAP;
        }
      }
    }
    posMapRef.current = mapa;
    return mapa;
  }, [ordemVisivel, spanDe, heights, cols, cardW]);

  const gridH = useMemo(() => {
    let fundo = 0;
    for (const p of posMap.values()) fundo = Math.max(fundo, p.y + p.h);
    return fundo;
  }, [posMap]);

  const commitOrdemVisivel = useCallback((novaVisivel: CardId[]) => {
    setLayout((prev) => {
      const ocultosOrd = prev.ordem.filter((c) => ocultosSetRef.current.has(c));
      const foraDaLista = prev.ordem.filter(
        (c) => !novaVisivel.includes(c) && !ocultosSetRef.current.has(c),
      );
      return { ...prev, ordem: [...novaVisivel, ...foraDaLista, ...ocultosOrd] };
    });
  }, []);

  const tituloDe = useCallback(
    (id: CardId) => titulosCard?.[id] ?? CARD_META[id].titulo,
    [titulosCard],
  );

  const encerrarDrag = useCallback(
    (reverter: boolean) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      setDragId(null);
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      d.peca.style.transform = '';
      if (reverter) {
        setLayout((prev) => ({ ...prev, ordem: d.ordemAntes }));
        return;
      }
      if (d.moved) {
        const idx = ordemVisivelRef.current.indexOf(d.id);
        aoAnunciar(
          `Card ${tituloDe(d.id)} movido para a posição ${idx + 1} de ${ordemVisivelRef.current.length}.`,
        );
      }
    },
    [aoAnunciar, tituloDe],
  );

  const aoPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>, id: CardId) => {
      // Só o botão principal arrasta; toque e caneta usam o mesmo caminho.
      if (e.button !== 0) return;
      const sec = elsRef.current.get(id);
      const peca = pecasRef.current.get(id);
      if (!sec || !peca) return;
      const r = sec.getBoundingClientRect();
      dragRef.current = {
        id,
        pointerId: e.pointerId,
        sec,
        peca,
        grabDX: e.clientX - r.left,
        grabDY: e.clientY - r.top,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        ordemAntes: layout.ordem,
        moved: false,
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Ambientes sem Pointer Capture completo seguem com os handlers do botão.
      }
    },
    [layout.ordem],
  );

  const aoPointerMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.lastX = e.clientX;
      d.lastY = e.clientY;

      if (!d.moved) {
        if (Math.hypot(e.clientX - d.startX, e.clientY - d.startY) <= 5) return;
        d.moved = true;
        setDragId(d.id);
      }

      // Trabalho por frame: eventos de pointer podem chegar a 120 Hz; um write
      // de transform + decisão de destino por frame cobre o que o olho vê.
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const ativo = dragRef.current;
        const grid = gridElRef.current;
        if (!ativo || !ativo.moved || !grid) return;

        const g = grid.getBoundingClientRect();
        const px = ativo.lastX - g.left;
        const py = ativo.lastY - g.top;

        // A peça segue o pointer a partir do slot comprometido.
        const p = posMapRef.current.get(ativo.id);
        if (p) {
          ativo.peca.style.transform = `translate3d(${ativo.lastX - ativo.grabDX - (g.left + p.x)}px, ${ativo.lastY - ativo.grabDY - (g.top + p.y)}px, 0)`;
        }

        // Destino por posição do pointer sobre os rects do packing (nenhuma
        // leitura de DOM por card): entrou na caixa de um vizinho ou ficou
        // claramente mais perto dele do que do próprio slot → troca.
        const alvos = ordemVisivelRef.current.filter((id) => id !== ativo.id);
        if (alvos.length === 0 || !p) return;
        const slotAtual = ordemVisivelRef.current.indexOf(ativo.id);
        const slotCX = p.x + p.w / 2;
        const slotCY = p.y + p.h / 2;
        const distSlot = Math.hypot(px - slotCX, py - slotCY);

        let melhorDist = Infinity;
        let destino = -1;
        let dentro = false;
        for (let i = 0; i < alvos.length; i += 1) {
          const alvoId = alvos[i];
          if (!alvoId) continue;
          const outro = posMapRef.current.get(alvoId);
          if (!outro) continue;
          const cx = outro.x + outro.w / 2;
          const cy = outro.y + outro.h / 2;
          const dist = Math.hypot(px - cx, py - cy);
          if (dist < melhorDist) {
            melhorDist = dist;
            dentro =
              px >= outro.x - outro.w * 0.12 &&
              px <= outro.x + outro.w * 1.12 &&
              py >= outro.y - outro.h * 0.12 &&
              py <= outro.y + outro.h * 1.12;
            const depois =
              py > cy + outro.h * 0.3 ||
              (Math.abs(py - cy) <= outro.h * 0.3 && px > cx);
            destino = depois ? i + 1 : i;
          }
        }
        const decisivo = dentro || melhorDist < distSlot * 0.62;
        if (decisivo && destino !== slotAtual) {
          commitOrdemVisivel(inserirEm(alvos, ativo.id, destino));
        }
      });
    },
    [commitOrdemVisivel],
  );

  const aoPointerUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const d = dragRef.current;
      if (!d || e.pointerId !== d.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Capture já liberada pelo navegador.
      }
      encerrarDrag(false);
    },
    [encerrarDrag],
  );

  const aoPointerCancel = useCallback(() => {
    encerrarDrag(true);
  }, [encerrarDrag]);

  const aoKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: CardId) => {
      if (dragRef.current) {
        if (e.key === 'Escape') {
          e.preventDefault();
          encerrarDrag(true);
        }
        return;
      }
      const vis = ordemVisivelRef.current;
      const idx = vis.indexOf(id);
      if (idx === -1) return;
      let alvo: number;
      if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') alvo = idx - 1;
      else if (e.key === 'ArrowDown' || e.key === 'ArrowRight') alvo = idx + 1;
      else if (e.key === 'Home') alvo = 0;
      else if (e.key === 'End') alvo = vis.length - 1;
      else return;
      e.preventDefault();
      const clamp = Math.max(0, Math.min(vis.length - 1, alvo));
      if (clamp === idx) return;
      commitOrdemVisivel(inserirEm(vis, id, clamp));
      aoAnunciar(`Card ${tituloDe(id)} movido para a posição ${clamp + 1} de ${vis.length}.`);
    },
    [aoAnunciar, commitOrdemVisivel, encerrarDrag, tituloDe],
  );

  // Largura em colunas: clique cicla (max volta para 1), setas ajustam ±1.
  const aoCiclarSpan = useCallback(
    (id: CardId, delta: number) => {
      const atual = spanDe(id);
      const prox = delta > 0 && atual >= cols ? 1 : Math.max(1, Math.min(cols, atual + delta));
      if (prox === atual) return;
      setLayout((prev) => ({ ...prev, spans: { ...prev.spans, [id]: prox } }));
      aoAnunciar(`Card ${tituloDe(id)} com largura ${prox} de ${cols} colunas.`);
    },
    [aoAnunciar, cols, spanDe, tituloDe],
  );

  const aoAlternarDensidade = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      densidade: (((prev.densidade ?? 1) + 1) % 3) as 0 | 1 | 2,
    }));
    aoAnunciar(`Densidade da torre: ${['compacta', 'normal', 'grande'][((layout.densidade ?? 1) + 1) % 3]}.`);
  }, [aoAnunciar, layout.densidade]);

  const alternarRecolhido = useCallback((id: CardId) => {
    setLayout((prev) => ({
      ...prev,
      recolhidos: prev.recolhidos.includes(id)
        ? prev.recolhidos.filter((c) => c !== id)
        : [...prev.recolhidos, id],
    }));
  }, []);

  const alternarOculto = useCallback((id: CardId) => {
    setLayout((prev) => {
      const ocultos = prev.ocultos.includes(id)
        ? prev.ocultos.filter((c) => c !== id)
        : [...prev.ocultos, id];
      const ocultosSetNovo = new Set(ocultos);
      const ordem = [
        ...prev.ordem.filter((c) => !ocultosSetNovo.has(c)),
        ...prev.ordem.filter((c) => ocultosSetNovo.has(c)),
      ];
      return { ...prev, ocultos, ordem };
    });
  }, []);

  const mostrarTodos = useCallback(() => {
    setLayout((prev) => ({ ...prev, ocultos: [] }));
  }, []);

  const aplicarVista = useCallback(
    (template: VistaTemplate) => {
      setLayout((prev) => ({ ...prev, ...aplicarTemplate(template) }));
      aoAnunciar(`Vista ${template.nome} aplicada.`);
    },
    [aoAnunciar],
  );

  const salvarVista = useCallback(
    (nome: string) => {
      const novo: VistaTemplate = {
        id: `v${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
        nome,
        ordem: ordemVisivelRef.current,
        spans: layout.spans,
        custom: true,
      };
      setTemplatesCustom((prev) => [...prev, novo]);
      aoAnunciar(`Vista ${nome} salva.`);
    },
    [aoAnunciar, layout.spans],
  );

  const excluirVista = useCallback(
    (id: string) => {
      setTemplatesCustom((prev) => prev.filter((t) => t.id !== id));
      aoAnunciar('Vista excluída.');
    },
    [aoAnunciar],
  );

  const templatesTodos = useMemo(
    () => [...TEMPLATES_VISTA, ...templatesCustom],
    [templatesCustom],
  );
  const ativoId = useMemo(
    () => templateCorrespondente(layout.ordem, layout.ocultos, templatesTodos, layout.spans),
    [layout.ordem, layout.ocultos, layout.spans, templatesTodos],
  );

  const cardsVisibilidade = useMemo(
    () =>
      CARD_IDS.filter((id) => cards[id] !== undefined).map((id) => ({
        id,
        titulo: tituloDe(id),
        oculto: ocultosSet.has(id),
      })),
    [cards, ocultosSet, tituloDe],
  );

  const handleProps: TorreCardHandleProps = {
    onPointerDown: aoPointerDown,
    onPointerMove: aoPointerMove,
    onPointerUp: aoPointerUp,
    onPointerCancel: aoPointerCancel,
    onKeyDown: aoKeyDown,
  };

  const semPosicao = gridW <= 0;

  return (
    <>
      <TorreVistas
        presets={TEMPLATES_VISTA}
        customizados={templatesCustom}
        ativoId={ativoId}
        cards={cardsVisibilidade}
        densidade={densidade}
        aoAplicar={aplicarVista}
        aoSalvarCustom={salvarVista}
        aoExcluirCustom={excluirVista}
        aoAlternarCard={alternarOculto}
        aoMostrarTodos={mostrarTodos}
        aoAlternarDensidade={aoAlternarDensidade}
      />

      <div
        className="torre-grid"
        ref={gridElRef}
        data-sem-posicao={semPosicao ? 'true' : undefined}
        style={semPosicao ? undefined : { height: gridH }}
      >
        {ordemVisivel.map((id, i) => {
          const p = posMap.get(id);
          return (
            <TorreCard
              key={id}
              ref={(el) => {
                if (el) elsRef.current.set(id, el);
                else elsRef.current.delete(id);
              }}
              pecaRef={(el) => {
                if (el) pecasRef.current.set(id, el);
                else pecasRef.current.delete(id);
              }}
              medidaRef={medidaRef(id)}
              id={id}
              titulo={tituloDe(id)}
              tituloId={`torre-titulo-${id}`}
              ordemI={i}
              recolhido={recolhidosSet.has(id)}
              arrastando={dragId === id}
              handleProps={handleProps}
              aoCiclarSpan={aoCiclarSpan}
              aoAlternarRecolhido={alternarRecolhido}
              span={p?.span ?? spanDe(id)}
              spanMax={cols}
              estilo={
                p
                  ? {
                      transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                      width: p.w,
                      height: p.h,
                    }
                  : undefined
              }
            >
              {cards[id]}
            </TorreCard>
          );
        })}
      </div>
    </>
  );
}
