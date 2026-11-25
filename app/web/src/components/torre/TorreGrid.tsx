import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react';
import {
  CARD_IDS,
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
  // Largura em colunas do grid de 12 (tiling). Mobile colapsa tudo para 12.
  span: number;
  // Mínimo que o conteúdo aguenta antes de quebrar.
  minSpan: number;
}

export const CARD_META: Record<CardId, CardMeta> = {
  matriz: { titulo: 'Fontes e campos', span: 7, minSpan: 5 },
  tarefas: { titulo: 'Tarefas abertas', span: 5, minSpan: 4 },
  domino: { titulo: 'Mapa de impacto causal', span: 12, minSpan: 7 },
  sinais: { titulo: 'Sinais e avisos', span: 6, minSpan: 4 },
  cadeia: { titulo: 'Status da cadeia', span: 6, minSpan: 4 },
  simulador: { titulo: 'Simulador de impacto', span: 12, minSpan: 7 },
  versoes: { titulo: 'Histórico de versões', span: 12, minSpan: 6 },
};

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
  tx: number;
  ty: number;
  ordemAntes: CardId[];
  moved: boolean;
}

interface ResizeAtivo {
  id: CardId;
  pointerId: number;
  gridLeft: number;
  passo: number;
  ultimoSpan: number;
}

function movimentoReduzido(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

// Orquestrador do tiling (THE-18): mantém ordem/visibilidade/expansão por
// pedido, arraste fluido por pointer com FLIP dos vizinhos (só transform) e
// reordenação por teclado na alça de cada card.
export function TorreGrid({ pedidoId, cards, titulosCard, aoAnunciar }: TorreGridProps) {
  const [layout, setLayout] = useState<LayoutTorre>(
    () => lerLayoutPedido(pedidoId) ?? { ...LAYOUT_PADRAO },
  );
  const [templatesCustom, setTemplatesCustom] = useState<VistaTemplate[]>(() =>
    lerTemplatesCustom(),
  );
  const [dragId, setDragId] = useState<CardId | null>(null);

  const elsRef = useRef(new Map<CardId, HTMLElement>());
  const pecasRef = useRef(new Map<CardId, HTMLElement>());
  const animsRef = useRef(new Map<string, Animation>());
  const dragRef = useRef<DragAtivo | null>(null);
  const resizeRef = useRef<ResizeAtivo | null>(null);
  const gridElRef = useRef<HTMLDivElement | null>(null);
  const ordemVisivelRef = useRef<CardId[]>([]);
  const frameRef = useRef(0);
  const frameResizeRef = useRef(0);
  const [resizingId, setResizingId] = useState<CardId | null>(null);

  const ocultosSet = useMemo(() => new Set(layout.ocultos), [layout.ocultos]);
  const recolhidosSet = useMemo(() => new Set(layout.recolhidos), [layout.recolhidos]);
  const ordemVisivel = useMemo(
    () => layout.ordem.filter((id) => cards[id] !== undefined && !ocultosSet.has(id)),
    [layout.ordem, ocultosSet, cards],
  );
  ordemVisivelRef.current = ordemVisivel;

  const ocultosSetRef = useRef(ocultosSet);
  ocultosSetRef.current = ocultosSet;

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

  // Nada fica pendurado: animações WAAPI e frames agendados morrem com o grid.
  useEffect(() => {
    const anims = animsRef.current;
    return () => {
      if (frameRef.current) cancelAnimationFrame(frameRef.current);
      if (frameResizeRef.current) cancelAnimationFrame(frameResizeRef.current);
      for (const a of anims.values()) a.cancel();
    };
  }, []);

  const spanDe = useCallback(
    (id: CardId) => {
      const meta = CARD_META[id];
      const s = layout.spans?.[id];
      const base = typeof s === 'number' && Number.isFinite(s) ? s : meta.span;
      return Math.max(meta.minSpan, Math.min(12, base));
    },
    [layout.spans],
  );

  const commitOrdemVisivel = useCallback((novaVisivel: CardId[]) => {
    setLayout((prev) => {
      const ocultosOrd = prev.ordem.filter((c) => ocultosSetRef.current.has(c));
      const foraDaLista = prev.ordem.filter(
        (c) => !novaVisivel.includes(c) && !ocultosSetRef.current.has(c),
      );
      return { ...prev, ordem: [...novaVisivel, ...foraDaLista, ...ocultosOrd] };
    });
  }, []);

  // FLIP com captura visual (transform/opacity, WAAPI): a section é sempre o
  // slot comprometido — o rect antes do cancel inclui a animação em voo, o
  // rect depois é o novo commit; a diferença segura o card exatamente onde o
  // olho o vê, mesmo quando um commit interrompe o deslize anterior.
  // Gate nas deps: sem mudança de layout o efeito nem mede — renders de SSE
  // não relêem rects nem reiniciam animações em voo.
  const ordemKey = ordemVisivel.join(',');
  useLayoutEffect(() => {
    const d = dragRef.current;
    for (const id of ordemVisivelRef.current) {
      const el = elsRef.current.get(id);
      if (!el) continue;
      if (d && d.id === id) {
        const r = el.getBoundingClientRect();
        d.tx = d.lastX - d.grabDX - r.left;
        d.ty = d.lastY - d.grabDY - r.top;
        d.peca.style.transform = `translate3d(${d.tx}px, ${d.ty}px, 0)`;
        continue;
      }
      const rVisual = el.getBoundingClientRect();
      animsRef.current.get(`card:${id}`)?.cancel();
      const rCommit = el.getBoundingClientRect();
      const dx = rVisual.left - rCommit.left;
      const dy = rVisual.top - rCommit.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      if (movimentoReduzido()) continue;
      const anim = el.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 300, easing: 'cubic-bezier(0.22, 1.12, 0.32, 1)' },
      );
      const chave = `card:${id}`;
      animsRef.current.set(chave, anim);
      anim.onfinish = () => {
        if (animsRef.current.get(chave) === anim) animsRef.current.delete(chave);
      };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mede só em mudança real de layout
  }, [ordemKey, layout]);

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
      if (reverter) {
        d.peca.style.transform = '';
        setLayout((prev) => ({ ...prev, ordem: d.ordemAntes }));
        return;
      }
      // Assentamento: a peça cai do ponto do pointer para o slot comprometido,
      // com uma curva que passa um pouco e volta — aterrissagem, não teleporte.
      const r = d.sec.getBoundingClientRect();
      const tx = d.lastX - d.grabDX - r.left;
      const ty = d.lastY - d.grabDY - r.top;
      d.peca.style.transform = '';
      if (d.moved) {
        if (!movimentoReduzido() && (Math.abs(tx) > 0.5 || Math.abs(ty) > 0.5)) {
          const anim = d.peca.animate(
            [
              { transform: `translate3d(${tx}px, ${ty}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 320, easing: 'cubic-bezier(0.2, 1.15, 0.3, 1)' },
          );
          const chave = `peca:${d.id}`;
          animsRef.current.set(chave, anim);
          anim.onfinish = () => {
            if (animsRef.current.get(chave) === anim) animsRef.current.delete(chave);
          };
        }
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
        tx: 0,
        ty: 0,
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
      // de transform + leitura de rects por frame cobre o que o olho vê.
      if (frameRef.current) return;
      frameRef.current = requestAnimationFrame(() => {
        frameRef.current = 0;
        const ativo = dragRef.current;
        if (!ativo || !ativo.moved) return;
        const px = ativo.lastX;
        const py = ativo.lastY;

        const r = ativo.sec.getBoundingClientRect();
        ativo.tx = px - ativo.grabDX - r.left;
        ativo.ty = py - ativo.grabDY - r.top;
        ativo.peca.style.transform = `translate3d(${ativo.tx}px, ${ativo.ty}px, 0)`;

        // Destino com histerese: o slot só troca quando o pointer entra na
        // caixa de um vizinho (inflada) ou chega claramente mais perto dele do
        // que do centro do próprio slot — sem isso o destino oscila na borda.
        const alvos = ordemVisivelRef.current.filter((id) => id !== ativo.id);
        if (alvos.length === 0) return;
        const slotAtual = ordemVisivelRef.current.indexOf(ativo.id);
        const slotCX = r.left + r.width / 2;
        const slotCY = r.top + r.height / 2;
        const distSlot = Math.hypot(px - slotCX, py - slotCY);

        let melhorDist = Infinity;
        let destino = -1;
        let dentro = false;
        for (let i = 0; i < alvos.length; i += 1) {
          const alvoId = alvos[i];
          if (!alvoId) continue;
          const outro = elsRef.current.get(alvoId);
          if (!outro) continue;
          const rr = outro.getBoundingClientRect();
          const cx = rr.left + rr.width / 2;
          const cy = rr.top + rr.height / 2;
          const dist = Math.hypot(px - cx, py - cy);
          if (dist < melhorDist) {
            melhorDist = dist;
            dentro =
              px >= rr.left - rr.width * 0.12 &&
              px <= rr.right + rr.width * 0.12 &&
              py >= rr.top - rr.height * 0.12 &&
              py <= rr.bottom + rr.height * 0.12;
            const depois =
              py > cy + rr.height * 0.3 ||
              (Math.abs(py - cy) <= rr.height * 0.3 && px > cx);
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

  const commitSpan = useCallback((id: CardId, span: number) => {
    const meta = CARD_META[id];
    const alvo = Math.max(meta.minSpan, Math.min(12, Math.round(span)));
    setLayout((prev) => {
      if ((prev.spans?.[id] ?? meta.span) === alvo) return prev;
      return { ...prev, spans: { ...prev.spans, [id]: alvo } };
    });
  }, []);

  // Resize pela alça do canto: o passo de coluna sai da geometria real do
  // grid e o commit segue o pointer; o FLIP dos vizinhos é o retile.
  const aoResizeDown = useCallback(
    (e: PointerEvent<HTMLButtonElement>, id: CardId) => {
      if (e.button !== 0) return;
      const grid = gridElRef.current;
      if (!grid) return;
      const g = grid.getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(grid).columnGap) || 0;
      resizeRef.current = {
        id,
        pointerId: e.pointerId,
        gridLeft: g.left,
        passo: (g.width + gap) / 12,
        ultimoSpan: spanDe(id),
      };
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Sem capture segue com os handlers do botão.
      }
    },
    [spanDe],
  );

  const aoResizeMove = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const rz = resizeRef.current;
      if (!rz || e.pointerId !== rz.pointerId) return;
      if (frameResizeRef.current) return;
      const px = e.clientX;
      frameResizeRef.current = requestAnimationFrame(() => {
        frameResizeRef.current = 0;
        const ativo = resizeRef.current;
        if (!ativo) return;
        const meta = CARD_META[ativo.id];
        const alvo = Math.round((px - ativo.gridLeft) / ativo.passo);
        const clamp = Math.max(meta.minSpan, Math.min(12, alvo));
        if (clamp !== ativo.ultimoSpan) {
          ativo.ultimoSpan = clamp;
          if (resizingId !== ativo.id) setResizingId(ativo.id);
          commitSpan(ativo.id, clamp);
        }
      });
    },
    [commitSpan, resizingId],
  );

  const encerrarResize = useCallback(
    (anunciar: boolean) => {
      const rz = resizeRef.current;
      if (!rz) return;
      resizeRef.current = null;
      setResizingId(null);
      if (frameResizeRef.current) {
        cancelAnimationFrame(frameResizeRef.current);
        frameResizeRef.current = 0;
      }
      if (anunciar) {
        aoAnunciar(`Card ${tituloDe(rz.id)} com largura ${spanDe(rz.id)} de 12 colunas.`);
      }
    },
    [aoAnunciar, spanDe, tituloDe],
  );

  const aoResizeUp = useCallback(
    (e: PointerEvent<HTMLButtonElement>) => {
      const rz = resizeRef.current;
      if (!rz || e.pointerId !== rz.pointerId) return;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // Capture já liberada.
      }
      encerrarResize(true);
    },
    [encerrarResize],
  );

  const aoResizeCancel = useCallback(() => {
    encerrarResize(false);
  }, [encerrarResize]);

  const aoResizeKey = useCallback(
    (e: KeyboardEvent<HTMLButtonElement>, id: CardId) => {
      const atual = spanDe(id);
      let alvo: number;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') alvo = atual - 1;
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') alvo = atual + 1;
      else if (e.key === 'Home') alvo = CARD_META[id].minSpan;
      else if (e.key === 'End') alvo = 12;
      else return;
      e.preventDefault();
      commitSpan(id, alvo);
      aoAnunciar(`Card ${tituloDe(id)} com largura ${Math.max(CARD_META[id].minSpan, Math.min(12, alvo))} de 12 colunas.`);
    },
    [aoAnunciar, commitSpan, spanDe, tituloDe],
  );

  const handleProps: TorreCardHandleProps = {
    onPointerDown: aoPointerDown,
    onPointerMove: aoPointerMove,
    onPointerUp: aoPointerUp,
    onPointerCancel: aoPointerCancel,
    onKeyDown: aoKeyDown,
  };

  const resizeProps = {
    onPointerDown: aoResizeDown,
    onPointerMove: aoResizeMove,
    onPointerUp: aoResizeUp,
    onPointerCancel: aoResizeCancel,
    onKeyDown: aoResizeKey,
  };

  const alternarRecolhido = useCallback((id: CardId) => {
    setLayout((prev) => ({
      ...prev,
      recolhidos: prev.recolhidos.includes(id)
        ? prev.recolhidos.filter((c) => c !== id)
        : [...prev.recolhidos, id],
    }));
  }, []);

  const alternarOculto = useCallback(
    (id: CardId) => {
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
    },
    [],
  );

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

  return (
    <>
      <TorreVistas
        presets={TEMPLATES_VISTA}
        customizados={templatesCustom}
        ativoId={ativoId}
        cards={cardsVisibilidade}
        aoAplicar={aplicarVista}
        aoSalvarCustom={salvarVista}
        aoExcluirCustom={excluirVista}
        aoAlternarCard={alternarOculto}
        aoMostrarTodos={mostrarTodos}
      />

      <div className="torre-grid" ref={gridElRef}>
        {ordemVisivel.map((id, i) => (
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
            id={id}
            titulo={tituloDe(id)}
            tituloId={`torre-titulo-${id}`}
            ordemI={i}
            recolhido={recolhidosSet.has(id)}
            arrastando={dragId === id}
            redimensionando={resizingId === id}
            handleProps={handleProps}
            resizeProps={resizeProps}
            aoAlternarRecolhido={alternarRecolhido}
            span={spanDe(id)}
            spanMin={CARD_META[id].minSpan}
          >
            {cards[id]}
          </TorreCard>
        ))}
      </div>
    </>
  );
}
