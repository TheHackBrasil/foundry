import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
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
import {
  RETILE_BASE_MS,
  destinoArraste,
  duracaoRetile,
  empacotar,
  ordenarVisual,
  spanEscalonado,
  vizinhoDirecional,
  type Direcao,
  type Posicao,
} from './packing.ts';
import { TorreCard, type TorreCardHandleProps } from './TorreCard.tsx';
import { TorreVistas } from './TorreVistas.tsx';

export interface CardMeta {
  titulo: string;
  // Largura padrão em colunas do masonry, afinada para o grid em 3 colunas
  // (referência do spanEscalonado: em 4 colunas os defaults escalam para
  // cobrir a linha inteira sem coluna morta).
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
// cabem na largura disponível. Em ~1280px: compacta 4, normal 3, grande 2 —
// três layouts visivelmente diferentes (antes compacta e normal empatavam).
const ALVO_COLUNA = [300, 400, 470] as const;
// Teto do corpo de cada card por densidade: valor fixo, nunca vh — resize
// vertical da janela não pode disparar repack (medida não muda).
const TETO_CORPO = [560, 880, 1320] as const;
const DENSIDADES = ['compacta', 'normal', 'grande'] as const;
const GAP = 20;
// Altura assumida antes da primeira medição via ResizeObserver.
const ALTURA_ESTIMADA = 170;
// Janela de congelamento do ResizeObserver de medidas durante um retile
// (teto da transição geométrica ~680ms + folga): medidas intermediárias não
// repackam.
const RETILE_MS = 800;
// Auto-scroll do arraste: faixa de ativação nas bordas da viewport e velocidade
// máxima por frame (proporcional à proximidade).
const ZONA_SCROLL = 72;
const VEL_SCROLL_MAX = 18;

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
  // Offset do grab relativo à peça renderizada (não ao slot): regrab no meio
  // do settle continua de onde a peça está, sem salto.
  grabDX: number;
  grabDY: number;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  lastT: number;
  // Velocidade do pointer (EMA, px/ms) para o fling do settle.
  vx: number;
  vy: number;
  // Âncora de histerese: pointer (cliente) no último commit de ordem.
  ax: number;
  ay: number;
  // Âncora de histerese em espaço do grid (null = inicializa no próximo tick):
  // resiste ao auto-scroll, que move o conteúdo sob o pointer parado.
  agx: number | null;
  agy: number | null;
  ordemAntes: CardId[];
  ocultosAntes: readonly CardId[];
  moved: boolean;
  capturePerdida: boolean;
  scroller: HTMLElement | null;
  userSelect: string;
}

// Gesto de resize pela borda direita (spec 0017): sem repack durante o
// arraste — o ghost absoluto mostra a largura-alvo snapada no span inteiro
// mais próximo e o commit único no pointerup cai no mesmo caminho do
// separator (aoAjustarSpan), herdando a animação física do retile.
interface ResizeAtivo {
  id: CardId;
  pointerId: number;
  sec: HTMLElement;
  // Largura da coluna e teto congelados no pointerdown (sem repack no gesto).
  cardW: number;
  cols: number;
  spanAntes: number;
  spanAlvo: number;
  userSelect: string;
}

// Orquestrador do tiling (THE-18): packing masonry — cada card cai na faixa de
// `span` colunas mais baixa, posições/tamanhos saem do cálculo (não do CSS
// grid) e transições de transform/width/height animam qualquer retile. Alturas
// são medidas por ResizeObserver na .torre-card-medida de cada card.
//
// Arraste (spec 0015): a peça segue o pointer em posição absoluta (transform
// compensado contra a section renderizada a cada frame — retile, transição e
// scroll não a deslocam), o destino tem histerese por âncora de pointer, e o
// drop assenta via WAAPI do ponto de release — interrompível por regrab.
export function TorreGrid({ pedidoId, cards, titulosCard, aoAnunciar }: TorreGridProps) {
  const [layout, setLayout] = useState<LayoutTorre>(
    () => lerLayoutPedido(pedidoId) ?? { ...LAYOUT_PADRAO },
  );
  const [templatesCustom, setTemplatesCustom] = useState<VistaTemplate[]>(() =>
    lerTemplatesCustom(),
  );
  // Peças fora do slot (voando ou assentando): slot tracejado + peça erguida.
  const [voandoIds, setVoandoIds] = useState<ReadonlySet<CardId>>(() => new Set());
  const [gridW, setGridW] = useState(0);
  const [heights, setHeights] = useState<Partial<Record<CardId, number>>>({});

  const elsRef = useRef(new Map<CardId, HTMLElement>());
  const pecasRef = useRef(new Map<CardId, HTMLElement>());
  const medidasRef = useRef(new Map<CardId, HTMLElement>());
  const dragRef = useRef<DragAtivo | null>(null);
  const gridElRef = useRef<HTMLDivElement | null>(null);
  const ordemVisivelRef = useRef<CardId[]>([]);
  const ordemVisualRef = useRef<CardId[]>([]);
  const posMapRef = useRef(new Map<CardId, Posicao>());
  const frameRef = useRef(0);
  // Rede de segurança do arraste: remove os listeners do window ao encerrar.
  const limparDragRef = useRef<(() => void) | null>(null);
  const resizeRef = useRef<ResizeAtivo | null>(null);
  const ghostRef = useRef<HTMLDivElement | null>(null);
  const limparResizeRef = useRef<(() => void) | null>(null);
  // Medidas do RO em lote (um flush por frame) + congelamento durante retile.
  const pendenteRef = useRef(new Map<CardId, number>());
  const flushRef = useRef(0);
  const congelarRef = useRef(false);
  const congelarTimerRef = useRef(0);

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

  // Flush das medidas pendentes: só quando o retile não está congelado — o
  // commit da geometria acontece uma vez, no alvo da transição.
  const descarregarMedidas = useCallback(() => {
    if (congelarRef.current || pendenteRef.current.size === 0) return;
    const lote = [...pendenteRef.current];
    pendenteRef.current.clear();
    setHeights((prev) => {
      let mudou = false;
      const prox = { ...prev };
      for (const [id, h] of lote) {
        if (Math.abs((prox[id] ?? 0) - h) >= 1) {
          prox[id] = h;
          mudou = true;
        }
      }
      return mudou ? prox : prev;
    });
  }, []);

  // Um ResizeObserver para as alturas naturais: cada .torre-card-medida reporta
  // sua altura de conteúdo — é a métrica do packing (o visual anima por CSS).
  // Entradas entram num buffer e descem no máximo uma vez por frame (rAF).
  const roMedidasRef = useRef<ResizeObserver | null>(null);
  useEffect(() => {
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        const el = e.target as HTMLElement;
        const id = el.dataset.cardMedida as CardId | undefined;
        if (!id) continue;
        const h = el.offsetHeight;
        if (h > 0) pendenteRef.current.set(id, h);
      }
      if (congelarRef.current || flushRef.current) return;
      flushRef.current = requestAnimationFrame(() => {
        flushRef.current = 0;
        descarregarMedidas();
      });
    });
    roMedidasRef.current = ro;
    return () => ro.disconnect();
  }, [descarregarMedidas]);

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

  useEffect(
    () => () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (flushRef.current) cancelAnimationFrame(flushRef.current);
      window.clearTimeout(congelarTimerRef.current);
      limparDragRef.current?.();
      // Drag ativo no desmonte (navegar no meio do gesto): o user-select:none
      // não pode vazar para o resto do app.
      const d = dragRef.current;
      if (d) {
        document.documentElement.style.userSelect = d.userSelect;
        dragRef.current = null;
      }
      limparResizeRef.current?.();
      const r = resizeRef.current;
      if (r) {
        document.documentElement.style.userSelect = r.userSelect;
        resizeRef.current = null;
      }
      delete document.documentElement.dataset.torreResize;
    },
    [],
  );

  const spanDe = useCallback(
    (id: CardId) => {
      const s = layout.spans?.[id];
      // Span explícito é absoluto (escolha da pessoa naquela densidade); o
      // default escala da referência de 3 colunas para a largura atual.
      if (typeof s === 'number' && Number.isFinite(s)) {
        return Math.max(1, Math.min(cols, s));
      }
      return spanEscalonado(CARD_META[id].span, cols);
    },
    [layout.spans, cols],
  );

  // Packing masonry: skyline com backfill + span elástico à direita (packing.ts).
  const posMap = useMemo(() => {
    const explicitos = new Set<CardId>();
    for (const id of ordemVisivel) {
      if (typeof layout.spans?.[id] === 'number') explicitos.add(id);
    }
    const mapa = empacotar<CardId>({
      ordem: ordemVisivel,
      spanDe,
      alturaDe: (id) => heights[id] ?? ALTURA_ESTIMADA,
      cols,
      cardW,
      gap: GAP,
      explicitos,
    });
    posMapRef.current = mapa;
    return mapa;
  }, [ordemVisivel, spanDe, heights, cols, cardW, layout.spans]);

  // Último posMap commitado — o efeito de reduced-motion e o cálculo de
  // duração do retile medem o "de" do deslocamento aqui (atualizado só em
  // effect, abaixo).
  const prevPosRef = useRef<Map<CardId, Posicao> | null>(null);

  // Duração do retile por card: deslocamento medido contra o último mapa
  // COMMITADO (prevPosRef só avança em effect, depois do render — o double
  // invoke do useMemo sob StrictMode não zera a distância). Viaja ao card
  // como --retile-dur e a transição CSS usa essa duração no retarget.
  const durMap = useMemo(() => {
    const anterior = prevPosRef.current;
    const durs = new Map<CardId, number>();
    for (const [id, p] of posMap) {
      durs.set(id, duracaoRetile(anterior?.get(id), p));
    }
    return durs;
  }, [posMap]);

  const semPosicao = gridW <= 0;

  // Retile em curso: congela as medidas do RO e fixa a largura de cada medida
  // no alvo — o tier de container query fica estável durante a transição e o
  // flush final já mede na geometria definitiva. Dispara por entrada
  // geométrica (cols, ordem, spans, densidade); mudanças de altura fluem
  // livremente (são a medida da verdade, ex.: collapse do corpo).
  useEffect(() => {
    if (semPosicao || posMapRef.current.size === 0) return;
    congelarRef.current = true;
    for (const [id, p] of posMapRef.current) {
      const m = medidasRef.current.get(id);
      if (m) m.style.width = `${p.w}px`;
    }
    window.clearTimeout(congelarTimerRef.current);
    congelarTimerRef.current = window.setTimeout(() => {
      congelarRef.current = false;
      for (const m of medidasRef.current.values()) m.style.width = '';
      descarregarMedidas();
    }, RETILE_MS);
  }, [cols, layout.ordem, layout.spans, layout.densidade, semPosicao, descarregarMedidas]);

  const gridH = useMemo(() => {
    let fundo = 0;
    for (const p of posMap.values()) fundo = Math.max(fundo, p.y + p.h);
    return fundo;
  }, [posMap]);

  // Ordem visual alvo (linha por y arredondado, x dentro da linha): guia a
  // ordem de tab/leitura e os anúncios — WCAG 2.4.3 / 1.3.2.
  const ordemRender = useMemo(
    () => (posMap.size > 0 ? ordenarVisual(ordemVisivel, posMap) : ordemVisivel),
    [ordemVisivel, posMap],
  );
  ordemVisualRef.current = ordemRender;

  // Ordem DOM segue a ordem visual MAS atrasa a reordenação de nós vivos até
  // a torre assentar: um elemento movido entre irmãos tem as transições CSS
  // suprimidas pelo browser (re-insert conta como "elemento novo" para o
  // before-change style) e teleportaria — causa raiz do flicker em retiles
  // que trocam a ordem visual (drag, span). Remoções e entradas já aplicam
  // na hora (nó removido não tem transição a preservar; nó novo nasce sem).
  const [ordemDom, setOrdemDom] = useState<CardId[]>(ordemRender);
  useEffect(() => {
    setOrdemDom((dom) => {
      const vivos = new Set(ordemRender);
      const prox = dom.filter((id) => vivos.has(id));
      for (const id of ordemRender) if (!prox.includes(id)) prox.push(id);
      return prox;
    });
    let t = 0;
    const tentar = () => {
      // Espera extra enquanto houver transição geométrica em curso: mover o
      // nó no meio dela também a suprimiria (salto para o valor final).
      for (const el of elsRef.current.values()) {
        const animando = el.getAnimations().some((a) => {
          const p = (a as CSSTransition).transitionProperty;
          return p === 'transform' || p === 'width' || p === 'height';
        });
        if (animando) {
          t = window.setTimeout(tentar, 120);
          return;
        }
      }
      setOrdemDom(ordemRender);
    };
    t = window.setTimeout(tentar, RETILE_MS + 80);
    return () => window.clearTimeout(t);
  }, [ordemRender]);

  // Reduced motion: retile sem deslocamento, mas com fade curto — cada card
  // que mudou de posição/tamanho recebe um pulse de opacity (Tier 2), para
  // preservar causa e efeito em vez de teleportar sem orientação.
  useEffect(() => {
    const prev = prevPosRef.current;
    prevPosRef.current = posMap;
    if (!prev || semPosicao) return;
    if (typeof matchMedia !== 'function') return;
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    for (const [id, p] of posMap) {
      const antes = prev.get(id);
      if (
        !antes ||
        (Math.abs(antes.x - p.x) < 0.5 &&
          Math.abs(antes.y - p.y) < 0.5 &&
          Math.abs(antes.w - p.w) < 0.5 &&
          Math.abs(antes.h - p.h) < 0.5)
      ) {
        continue;
      }
      elsRef.current.get(id)?.animate([{ opacity: 0.55 }, { opacity: 1 }], {
        duration: 130,
        easing: 'ease',
      });
    }
  }, [posMap, semPosicao]);

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

  const levantar = useCallback((id: CardId) => {
    setVoandoIds((prev) => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  }, []);

  const pousar = useCallback((id: CardId) => {
    const peca = pecasRef.current.get(id);
    // Manual converge com o atributo renderizado pelo React (data-lifted).
    peca?.removeAttribute('data-lifted');
    setVoandoIds((prev) => {
      if (!prev.has(id)) return prev;
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }, []);

  const encerrarDrag = useCallback(
    (reverter: boolean) => {
      const d = dragRef.current;
      if (!d) return;
      dragRef.current = null;
      limparDragRef.current?.();
      limparDragRef.current = null;
      if (frameRef.current) {
        cancelAnimationFrame(frameRef.current);
        frameRef.current = 0;
      }
      document.documentElement.style.userSelect = d.userSelect;
      if (reverter && d.moved) {
        // Reverte o gesto inteiro: ordem e visibilidade de antes do pointerdown.
        // Restaurar só a ordem desalinhava com `ocultos` se um preset foi
        // aplicado no meio do arraste (segundo ponteiro em touch).
        setLayout((prev) => ({ ...prev, ordem: d.ordemAntes, ocultos: [...d.ocultosAntes] }));
      }
      const { peca, sec } = d;
      // Posição visual atual da peça em relação à section renderizada —
      // o ponto de partida real do settle (continuidade, nunca teleporte).
      const pecaR = peca.getBoundingClientRect();
      const secR = sec.getBoundingClientRect();
      const sc = parseFloat(getComputedStyle(peca).scale) || 1;
      const offX = pecaR.left - secR.left + (pecaR.width * (sc - 1)) / (2 * sc);
      const offY = pecaR.top - secR.top + (pecaR.height * (sc - 1)) / (2 * sc);
      peca.style.transform = ''; // repousa no slot; o voo até ele é WAAPI ou nada
      const dist = Math.hypot(offX, offY);
      const finalizar = () => pousar(d.id);
      if (dist >= 2) {
        if (
          typeof matchMedia === 'function' &&
          matchMedia('(prefers-reduced-motion: reduce)').matches
        ) {
          // Sem deslocamento: a peça já está no slot; fade curto sinaliza a troca.
          peca.animate([{ opacity: 0.45 }, { opacity: 1 }], { duration: 130, easing: 'ease' });
          finalizar();
        } else {
          // Assentar do ponto de release: duração escala com a distância e um
          // keyframe de fling usa a velocidade do release (cap ~22px).
          const dur = Math.min(280, Math.max(180, 165 + dist * 0.28));
          const kf: Keyframe[] = [{ transform: `translate3d(${offX}px, ${offY}px, 0)` }];
          // Segurar parado antes de soltar não pode carregar a velocidade de
          // antes do hold: sem mover há 160ms+ o fling zera.
          if (performance.now() - d.lastT > 160) {
            d.vx = 0;
            d.vy = 0;
          }
          const speed = Math.hypot(d.vx, d.vy);
          if (speed > 0.35) {
            const over = Math.min(22, speed * 30);
            kf.push({
              transform: `translate3d(${offX + (d.vx / speed) * over}px, ${offY + (d.vy / speed) * over}px, 0)`,
              offset: 0.22,
            });
          }
          kf.push({ transform: 'translate3d(0px, 0px, 0)' });
          const anim = peca.animate(kf, {
            duration: dur,
            easing: 'cubic-bezier(0.22, 1.08, 0.36, 1)',
          });
          // Cancelado pelo regrab: quem agarra assume o pousar depois.
          // Cancelamento sem regrab (unmount, card ocultado no meio do voo)
          // também finaliza — senão voandoIds/data-arraste-ativo ficam presos.
          anim.finished.then(finalizar).catch(() => {
            if (!dragRef.current || dragRef.current.id !== d.id) finalizar();
          });
        }
      } else {
        finalizar();
      }
      if (reverter) {
        if (d.moved) aoAnunciar('Movimento cancelado; card voltou à posição anterior.');
        return;
      }
      if (d.moved) {
        const idx = ordemVisualRef.current.indexOf(d.id);
        aoAnunciar(
          `Card ${tituloDe(d.id)} movido para a posição ${idx + 1} de ${ordemVisualRef.current.length}.`,
        );
      }
    },
    [aoAnunciar, pousar, tituloDe],
  );

  // Loop por frame enquanto a peça voa: transform absoluto ao pointer
  // (compensa retile, transição da section e scroll), auto-scroll por
  // proximidade da borda e destino com histerese.
  const tick = useCallback(() => {
    frameRef.current = 0;
    const d = dragRef.current;
    if (!d || !d.moved) return;
    const vh = window.innerHeight;
    let sy = 0;
    if (d.lastY < ZONA_SCROLL) {
      sy = -Math.ceil(((ZONA_SCROLL - d.lastY) / ZONA_SCROLL) * VEL_SCROLL_MAX);
    } else if (d.lastY > vh - ZONA_SCROLL) {
      sy = Math.ceil(((d.lastY - (vh - ZONA_SCROLL)) / ZONA_SCROLL) * VEL_SCROLL_MAX);
    }
    // Pointer fora da viewport jogava a razão acima de 1 sem cap — clampa.
    sy = Math.max(-VEL_SCROLL_MAX, Math.min(VEL_SCROLL_MAX, sy));
    if (sy !== 0) {
      if (d.scroller) d.scroller.scrollTop += sy;
      else window.scrollBy(0, sy);
    }
    // A peça fica presa ao grab point: mede a section renderizada (que pode
    // estar no meio da própria transição) e compensa — nunca desliza sozinha.
    const secR = d.sec.getBoundingClientRect();
    d.peca.style.transform = `translate3d(${d.lastX - d.grabDX - secR.left}px, ${d.lastY - d.grabDY - secR.top}px, 0)`;
    const grid = gridElRef.current;
    if (grid) {
      const g = grid.getBoundingClientRect();
      const pgx = d.lastX - g.left;
      const pgy = d.lastY - g.top;
      if (d.agx === null) {
        d.agx = pgx;
        d.agy = pgy;
      }
      const dest = destinoArraste({
        px: pgx,
        py: pgy,
        clientX: pgx,
        clientY: pgy,
        ancoraX: d.agx,
        ancoraY: d.agy ?? pgy,
        ordem: ordemVisivelRef.current,
        posMap: posMapRef.current,
        arrastado: d.id,
      });
      if (dest !== null) {
        const alvos = ordemVisivelRef.current.filter((c) => c !== d.id);
        commitOrdemVisivel(inserirEm(alvos, d.id, dest));
        d.ax = d.lastX;
        d.ay = d.lastY;
        d.agx = null;
        d.agy = null;
      }
    }
    frameRef.current = requestAnimationFrame(tick);
  }, [commitOrdemVisivel]);

  const registrarMove = useCallback(
    (clientX: number, clientY: number, buttons: number, pointerId: number) => {
      const d = dragRef.current;
      if (!d || pointerId !== d.pointerId) return;
      // Rede de segurança: pointerup perdido (solto fora da janela sem
      // capture) — o primeiro move com botão zerado encerra. Também antes do
      // gesto engatilhar: sem isso um hover sem botão ligava o arraste e
      // commitava reordenação involuntária (phantom drag).
      if ((buttons & 1) === 0) {
        encerrarDrag(!d.moved);
        return;
      }
      const now = performance.now();
      const dt = Math.max(4, now - d.lastT);
      d.vx = d.vx * 0.72 + ((clientX - d.lastX) / dt) * 0.28;
      d.vy = d.vy * 0.72 + ((clientY - d.lastY) / dt) * 0.28;
      d.lastX = clientX;
      d.lastY = clientY;
      d.lastT = now;
      if (!d.moved && Math.hypot(clientX - d.startX, clientY - d.startY) > 5) {
        d.moved = true;
        // Lift manual imediato: sem ele a transição de transform disputaria o
        // primeiro frame com o React aplicando data-lifted.
        d.peca.dataset.lifted = 'true';
        document.documentElement.style.userSelect = 'none';
        levantar(d.id);
        frameRef.current = requestAnimationFrame(tick);
      }
    },
    [encerrarDrag, levantar, tick],
  );

  const acharScroller = (el: HTMLElement): HTMLElement | null => {
    let p = el.parentElement;
    while (p) {
      const s = getComputedStyle(p);
      if (
        (s.overflowY === 'auto' || s.overflowY === 'scroll') &&
        p.scrollHeight > p.clientHeight
      ) {
        return p;
      }
      p = p.parentElement;
    }
    return null;
  };

  const aoPointerDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>, id: CardId) => {
      // Só o botão principal arrasta; toque e caneta usam o mesmo caminho.
      if (e.button !== 0) return;
      const sec = elsRef.current.get(id);
      const peca = pecasRef.current.get(id);
      if (!sec || !peca) return;
      if (dragRef.current) encerrarDrag(false);
      // Mede antes de cancelar: num regrab em pleno settle a peça ainda voa e
      // o grabOffset tem que ser sobre o que se vê, não sobre o slot.
      const pecaR = peca.getBoundingClientRect();
      const secR = sec.getBoundingClientRect();
      const anims = peca.getAnimations();
      const emVoo = anims.length > 0;
      anims.forEach((a) => a.cancel());
      const sc = parseFloat(getComputedStyle(peca).scale) || 1;
      const offX = pecaR.left - secR.left + (pecaR.width * (sc - 1)) / (2 * sc);
      const offY = pecaR.top - secR.top + (pecaR.height * (sc - 1)) / (2 * sc);
      if (emVoo && Math.hypot(offX, offY) > 1) {
        // Regrab no meio do settle: fixa a peça exatamente onde está.
        peca.dataset.lifted = 'true';
        peca.style.transform = `translate3d(${offX}px, ${offY}px, 0)`;
      }
      const d: DragAtivo = {
        id,
        pointerId: e.pointerId,
        sec,
        peca,
        grabDX: e.clientX - pecaR.left,
        grabDY: e.clientY - pecaR.top,
        startX: e.clientX,
        startY: e.clientY,
        lastX: e.clientX,
        lastY: e.clientY,
        lastT: performance.now(),
        vx: 0,
        vy: 0,
        ax: e.clientX,
        ay: e.clientY,
        agx: null,
        agy: null,
        ordemAntes: layout.ordem,
        ocultosAntes: layout.ocultos,
        moved: false,
        capturePerdida: false,
        scroller: acharScroller(sec),
        userSelect: document.documentElement.style.userSelect,
      };
      dragRef.current = d;
      // Safety net: fim do gesto não depende do grip de 30px nem do pointer
      // capture — up/cancel/lostcapture/blur/Escape vivem no window durante o
      // arraste e saem no encerrar.
      const onMove = (ev: globalThis.PointerEvent) =>
        registrarMove(ev.clientX, ev.clientY, ev.buttons, ev.pointerId);
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === d.pointerId) encerrarDrag(false);
      };
      const onCancel = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === d.pointerId) encerrarDrag(true);
      };
      const onLost = (ev: Event) => {
        const pe = ev as globalThis.PointerEvent;
        const ativo = dragRef.current;
        if (ativo && pe.pointerId === ativo.pointerId) ativo.capturePerdida = true;
      };
      const onKey = (ev: globalThis.KeyboardEvent) => {
        if (ev.key === 'Escape' && dragRef.current) {
          ev.preventDefault();
          encerrarDrag(true);
        }
      };
      const onBlur = () => {
        if (dragRef.current) encerrarDrag(false);
      };
      window.addEventListener('pointermove', onMove, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      window.addEventListener('pointercancel', onCancel, { capture: true });
      window.addEventListener('lostpointercapture', onLost, { capture: true });
      window.addEventListener('keydown', onKey, { capture: true });
      window.addEventListener('blur', onBlur);
      limparDragRef.current = () => {
        window.removeEventListener('pointermove', onMove, { capture: true });
        window.removeEventListener('pointerup', onUp, { capture: true });
        window.removeEventListener('pointercancel', onCancel, { capture: true });
        window.removeEventListener('lostpointercapture', onLost, { capture: true });
        window.removeEventListener('keydown', onKey, { capture: true });
        window.removeEventListener('blur', onBlur);
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Sem Pointer Capture o window segue cobrindo move/up/cancel.
      }
    },
    [encerrarDrag, layout.ordem, registrarMove],
  );

  const aoKeyDown = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: CardId) => {
      if (dragRef.current) return; // Escape global cobre o arraste ativo
      const vis = ordemVisivelRef.current;
      const idx = vis.indexOf(id);
      if (idx === -1) return;
      if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        const alvo = e.key === 'Home' ? 0 : vis.length - 1;
        if (alvo === idx) return;
        commitOrdemVisivel(inserirEm(vis, id, alvo));
        aoAnunciar(
          `Card ${tituloDe(id)} movido para ${e.key === 'Home' ? 'o início' : 'o fim'} da torre.`,
        );
        return;
      }
      const dir: Direcao | null =
        e.key === 'ArrowUp'
          ? 'up'
          : e.key === 'ArrowDown'
            ? 'down'
            : e.key === 'ArrowLeft'
              ? 'left'
              : e.key === 'ArrowRight'
                ? 'right'
                : null;
      if (!dir) return;
      e.preventDefault();
      const r = vizinhoDirecional(posMapRef.current, vis, id, dir);
      const rotulos: Record<Direcao, [string, string]> = {
        down: ['baixo', 'abaixo de'],
        up: ['cima', 'acima de'],
        left: ['a esquerda', 'à esquerda de'],
        right: ['a direita', 'à direita de'],
      };
      if (!r) {
        aoAnunciar(`Card ${tituloDe(id)}: não há card ${rotulos[dir][0]}.`);
        return;
      }
      commitOrdemVisivel(inserirEm(vis, id, r.destino));
      aoAnunciar(
        `Card ${tituloDe(id)} movido para ${rotulos[dir][0]}, ${rotulos[dir][1]} ${tituloDe(r.vizinho)}.`,
      );
    },
    [aoAnunciar, commitOrdemVisivel, tituloDe],
  );

  // Largura em colunas: clique cicla com wrap; setas ajustam com clamp (APG
  // window splitter) e anunciam o limite em vez de dar a volta.
  const aoAjustarSpan = useCallback(
    (id: CardId, alvo: number, ciclar: boolean) => {
      // Intenção do layout (spanDe), nunca o span elástico do posMap: o
      // pós-passo elástico infla posMap quando há coluna morta à direita, e
      // ler de lá tornava o ciclo não-determinístico (travava sem dar a volta).
      const atual = spanDe(id);
      let prox: number;
      if (ciclar) prox = atual >= cols ? 1 : atual + 1;
      else prox = Math.max(1, Math.min(cols, alvo));
      if (prox === atual) {
        if (!ciclar) {
          aoAnunciar(
            `Card ${tituloDe(id)} já está na largura ${alvo > atual ? 'máxima' : 'mínima'} (${atual} de ${cols} colunas).`,
          );
        }
        return;
      }
      setLayout((prev) => ({ ...prev, spans: { ...prev.spans, [id]: prox } }));
      aoAnunciar(`Card ${tituloDe(id)} com largura ${prox} de ${cols} colunas.`);
    },
    [aoAnunciar, cols, spanDe, tituloDe],
  );

  // ---------- resize por arraste de borda (spec 0017) ----------
  // Largura de n colunas inclui os gaps internos; o inverso arredonda para o
  // span inteiro mais próximo, clampado em 1..cols — nunca largura livre.
  const larguraSpan = (n: number, cw: number) => n * cw + (n - 1) * GAP;
  const spanParaLargura = (w: number, cw: number, max: number) =>
    Math.max(1, Math.min(max, Math.round((w + GAP) / (cw + GAP))));

  const encerrarResize = useCallback(
    (commit: boolean) => {
      const r = resizeRef.current;
      if (!r) return;
      resizeRef.current = null;
      limparResizeRef.current?.();
      limparResizeRef.current = null;
      const ghost = ghostRef.current;
      if (ghost) delete ghost.dataset.ativo;
      delete r.sec.dataset.resizing;
      document.documentElement.style.userSelect = r.userSelect;
      delete document.documentElement.dataset.torreResize;
      if (commit && r.spanAlvo !== r.spanAntes) {
        // Mesmo caminho do separator: um commit só, e o retile anima.
        aoAjustarSpan(r.id, r.spanAlvo, false);
      } else if (!commit && r.spanAlvo !== r.spanAntes) {
        aoAnunciar('Redimensionamento cancelado; card voltou à largura anterior.');
      }
    },
    [aoAjustarSpan, aoAnunciar],
  );

  const registrarResize = useCallback(
    (ev: globalThis.PointerEvent) => {
      const r = resizeRef.current;
      if (!r || ev.pointerId !== r.pointerId) return;
      // Pointerup perdido fora da janela: o primeiro move sem botão commita.
      if ((ev.buttons & 1) === 0) {
        encerrarResize(true);
        return;
      }
      const grid = gridElRef.current;
      // O slot vem do posMap vivo: outro retile (medida de altura) pode ter
      // mexido a âncora no meio do gesto — o ghost acompanha o alvo real.
      const p = posMapRef.current.get(r.id);
      const ghost = ghostRef.current;
      if (!grid || !p || !ghost) {
        encerrarResize(false);
        return;
      }
      const gx = ev.clientX - grid.getBoundingClientRect().left;
      const alvo = spanParaLargura(gx - p.x, r.cardW, r.cols);
      if (alvo !== r.spanAlvo) {
        r.spanAlvo = alvo;
        ghost.style.width = `${larguraSpan(alvo, r.cardW)}px`;
        const n = ghost.firstElementChild;
        if (n) n.textContent = `${alvo} de ${r.cols}`;
      }
      ghost.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      ghost.style.height = `${p.h}px`;
    },
    [encerrarResize],
  );

  const aoResizeDown = useCallback(
    (e: PointerEvent<HTMLDivElement>, id: CardId) => {
      if (e.button !== 0) return;
      const sec = elsRef.current.get(id);
      const p = posMapRef.current.get(id);
      const ghost = ghostRef.current;
      if (!sec || !p || !ghost || cardW <= 0) return;
      if (dragRef.current) encerrarDrag(false);
      if (resizeRef.current) encerrarResize(false);
      e.preventDefault();
      const spanAtual = spanDe(id);
      const r: ResizeAtivo = {
        id,
        pointerId: e.pointerId,
        sec,
        cardW,
        cols,
        spanAntes: spanAtual,
        spanAlvo: spanAtual,
        userSelect: document.documentElement.style.userSelect,
      };
      resizeRef.current = r;
      sec.dataset.resizing = 'true';
      document.documentElement.style.userSelect = 'none';
      // Cursor global: com capture o pointer sai da zona de 14px e o cursor
      // dos elementos sob ele venceria sem esta trava.
      document.documentElement.dataset.torreResize = 'true';
      ghost.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
      ghost.style.width = `${p.w}px`;
      ghost.style.height = `${p.h}px`;
      const n = ghost.firstElementChild;
      if (n) n.textContent = `${spanAtual} de ${cols}`;
      ghost.dataset.ativo = 'true';
      const onMove = (ev: globalThis.PointerEvent) => registrarResize(ev);
      const onUp = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === r.pointerId) encerrarResize(true);
      };
      const onCancel = (ev: globalThis.PointerEvent) => {
        if (ev.pointerId === r.pointerId) encerrarResize(false);
      };
      const onKey = (ev: globalThis.KeyboardEvent) => {
        if (ev.key === 'Escape' && resizeRef.current) {
          ev.preventDefault();
          encerrarResize(false);
        }
      };
      // Blur commita o alvo corrente — mesmo tratamento do drop no arraste.
      const onBlur = () => {
        if (resizeRef.current) encerrarResize(true);
      };
      window.addEventListener('pointermove', onMove, { capture: true });
      window.addEventListener('pointerup', onUp, { capture: true });
      window.addEventListener('pointercancel', onCancel, { capture: true });
      window.addEventListener('keydown', onKey, { capture: true });
      window.addEventListener('blur', onBlur);
      limparResizeRef.current = () => {
        window.removeEventListener('pointermove', onMove, { capture: true });
        window.removeEventListener('pointerup', onUp, { capture: true });
        window.removeEventListener('pointercancel', onCancel, { capture: true });
        window.removeEventListener('keydown', onKey, { capture: true });
        window.removeEventListener('blur', onBlur);
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Sem Pointer Capture o window segue cobrindo move/up/cancel.
      }
    },
    [cardW, cols, encerrarDrag, encerrarResize, registrarResize, spanDe],
  );

  const aoAlternarDensidade = useCallback(() => {
    setLayout((prev) => ({
      ...prev,
      densidade: (((prev.densidade ?? 1) + 1) % 3) as 0 | 1 | 2,
    }));
    aoAnunciar(`Densidade da torre: ${DENSIDADES[((layout.densidade ?? 1) + 1) % 3]}.`);
  }, [aoAnunciar, layout.densidade]);

  // M14: contrato com polish-vistas — define a densidade explicitamente (não
  // cicla). Prop opcional; o segmented control da outra frente consome.
  const aoDefinirDensidade = useCallback(
    (d: 0 | 1 | 2) => {
      setLayout((prev) =>
        (prev.densidade ?? 1) === d ? prev : { ...prev, densidade: d },
      );
      aoAnunciar(`Densidade da torre: ${DENSIDADES[d]}.`);
    },
    [aoAnunciar],
  );

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

  // A barra envia o layout persistido como segundo argumento (decisão 7 da
  // frente polish-vistas): capturar recolhidos/densidade aqui torna a vista
  // autocontida e o sidecar da barra vira apenas caminho de migração.
  const salvarVista = useCallback(
    (nome: string, layoutCompleto?: LayoutTorre) => {
      const recolhidosVista = layoutCompleto?.recolhidos ?? layout.recolhidos;
      const novo: VistaTemplate = {
        id: `v${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`,
        nome,
        ordem: ordemVisivelRef.current,
        spans: layout.spans,
        ...(recolhidosVista.length ? { recolhidos: [...recolhidosVista] } : {}),
        densidade: layoutCompleto?.densidade ?? layout.densidade ?? 1,
        custom: true,
      };
      setTemplatesCustom((prev) => [...prev, novo]);
      aoAnunciar(`Vista ${nome} salva.`);
    },
    [aoAnunciar, layout.spans, layout.recolhidos, layout.densidade],
  );

  const excluirVista = useCallback(
    (id: string) => {
      setTemplatesCustom((prev) => prev.filter((t) => t.id !== id));
      aoAnunciar('Vista excluída.');
    },
    [aoAnunciar],
  );

  // Reinsere a vista excluída (Desfazer do toast da barra). O template chega
  // completo: campos do sidecar já foram mesclados pela barra antes da captura.
  const restaurarVista = useCallback(
    (template: VistaTemplate) => {
      setTemplatesCustom((prev) =>
        prev.some((t) => t.id === template.id) ? prev : [...prev, template],
      );
      aoAnunciar(`Vista ${template.nome} restaurada.`);
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
    onKeyDown: aoKeyDown,
    onResizeDown: aoResizeDown,
  };

  // M14: prop nova do TorreVistas chega pela outra frente; o spread de objeto
  // já tipado mantém o typecheck verde antes e depois da declaração dela.
  const densidadeVistas: { aoDefinirDensidade?: (d: 0 | 1 | 2) => void } = {
    aoDefinirDensidade,
  };

  return (
    <>
      <TorreVistas
        pedidoId={pedidoId}
        presets={TEMPLATES_VISTA}
        customizados={templatesCustom}
        ativoId={ativoId}
        cards={cardsVisibilidade}
        densidade={densidade}
        aoAplicar={aplicarVista}
        aoSalvarCustom={salvarVista}
        aoExcluirCustom={excluirVista}
        aoRestaurarVista={restaurarVista}
        aoAnunciar={aoAnunciar}
        aoAlternarCard={alternarOculto}
        aoMostrarTodos={mostrarTodos}
        aoAlternarDensidade={aoAlternarDensidade}
        {...densidadeVistas}
      />

      <div
        className="torre-grid"
        ref={gridElRef}
        data-sem-posicao={semPosicao ? 'true' : undefined}
        data-arraste-ativo={voandoIds.size > 0 ? 'true' : undefined}
        style={
          semPosicao
            ? undefined
            : { height: gridH, '--teto-corpo': `${TETO_CORPO[densidade]}px` } as CSSPropertiesSemTeto
        }
      >
        {/* Ghost do resize de borda: manipulado por estilo inline a cada
            move (sem estado React) — zero repack/churn durante o gesto. */}
        <div ref={ghostRef} className="torre-resize-ghost" aria-hidden="true">
          <span className="torre-resize-ghost-n" />
        </div>
        {ordemDom.map((id, i) => {
          const p = posMap.get(id);
          // Card removido (oculto/preset) sai do posMap um commit antes de sair
          // do ordemDom: renderizar sem geometria pintava um frame fantasma em
          // (0,0) com tamanho natural. Pula — a animação de saída não existe
          // para remoção (entradas e saídas aplicam na hora, só reordenação
          // espera o settle).
          if (!p) return null;
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
              arrastando={voandoIds.has(id)}
              handleProps={handleProps}
              aoAjustarSpan={aoAjustarSpan}
              aoAlternarRecolhido={alternarRecolhido}
              span={spanDe(id)}
              spanMax={cols}
              estilo={
                p
                  ? ({
                      transform: `translate3d(${p.x}px, ${p.y}px, 0)`,
                      width: p.w,
                      height: p.h,
                      '--retile-dur': `${durMap.get(id) ?? RETILE_BASE_MS}ms`,
                    } as CSSPropertiesComRetile)
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

type CSSPropertiesSemTeto = CSSProperties & { '--teto-corpo'?: string };
type CSSPropertiesComRetile = CSSProperties & { '--retile-dur'?: string };
