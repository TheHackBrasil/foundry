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
}

export const CARD_META: Record<CardId, CardMeta> = {
  matriz: { titulo: 'Fontes e campos', span: 7 },
  tarefas: { titulo: 'Tarefas abertas', span: 5 },
  domino: { titulo: 'Mapa de impacto causal', span: 12 },
  sinais: { titulo: 'Sinais e avisos', span: 6 },
  cadeia: { titulo: 'Status da cadeia', span: 6 },
  simulador: { titulo: 'Simulador de impacto', span: 12 },
  versoes: { titulo: 'Histórico de versões', span: 12 },
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
  el: HTMLElement;
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
  const posicoesRef = useRef(new Map<CardId, { left: number; top: number }>());
  const montadoRef = useRef(false);
  const dragRef = useRef<DragAtivo | null>(null);
  const ordemVisivelRef = useRef<CardId[]>([]);

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
    montadoRef.current = false;
  }, [pedidoId]);

  useEffect(() => {
    guardarLayoutPedido(pedidoId, layout);
  }, [pedidoId, layout]);

  useEffect(() => {
    guardarTemplatesCustom(templatesCustom);
  }, [templatesCustom]);

  const commitOrdemVisivel = useCallback((novaVisivel: CardId[]) => {
    setLayout((prev) => {
      const ocultosOrd = prev.ordem.filter((c) => ocultosSetRef.current.has(c));
      const foraDaLista = prev.ordem.filter(
        (c) => !novaVisivel.includes(c) && !ocultosSetRef.current.has(c),
      );
      return { ...prev, ordem: [...novaVisivel, ...foraDaLista, ...ocultosOrd] };
    });
  }, []);

  // FLIP puro (transform/opacity, WAAPI): depois de cada commit, compara a posição
  // nova de cada card com a anterior e desliza só os que mudaram. O card
  // arrastado não entra no FLIP: a transform dele segue o ponteiro.
  useLayoutEffect(() => {
    const atuais = new Map<CardId, { left: number; top: number }>();
    for (const id of ordemVisivel) {
      const el = elsRef.current.get(id);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      const d = dragRef.current;
      if (d && d.id === id) {
        atuais.set(id, { left: r.left - d.tx, top: r.top - d.ty });
      } else {
        atuais.set(id, { left: r.left, top: r.top });
      }
    }

    const prev = posicoesRef.current;
    posicoesRef.current = atuais;
    if (!montadoRef.current) {
      montadoRef.current = true;
      return;
    }

    const d = dragRef.current;
    if (d) {
      const c = atuais.get(d.id);
      if (c) {
        d.tx = d.lastX - d.grabDX - c.left;
        d.ty = d.lastY - d.grabDY - c.top;
        d.el.style.transform = `translate3d(${d.tx}px, ${d.ty}px, 0)`;
      }
    }

    if (movimentoReduzido()) return;
    for (const id of ordemVisivel) {
      if (d && d.id === id) continue;
      const p = prev.get(id);
      const c = atuais.get(id);
      if (!p || !c) continue;
      const dx = p.left - c.left;
      const dy = p.top - c.top;
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      const el = elsRef.current.get(id);
      el?.animate(
        [
          { transform: `translate3d(${dx}px, ${dy}px, 0)` },
          { transform: 'translate3d(0, 0, 0)' },
        ],
        { duration: 220, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
      );
    }
  });

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
      d.el.style.transform = '';
      if (reverter) {
        setLayout((prev) => ({ ...prev, ordem: d.ordemAntes }));
        return;
      }
      if (d.moved) {
        if (!movimentoReduzido()) {
          d.el.animate(
            [
              { transform: `translate3d(${d.tx}px, ${d.ty}px, 0)` },
              { transform: 'translate3d(0, 0, 0)' },
            ],
            { duration: 180, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' },
          );
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
      const el = elsRef.current.get(id);
      if (!el) return;
      const r = el.getBoundingClientRect();
      dragRef.current = {
        id,
        pointerId: e.pointerId,
        el,
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

      const r = d.el.getBoundingClientRect();
      const lx = r.left - d.tx;
      const ly = r.top - d.ty;
      d.tx = e.clientX - d.grabDX - lx;
      d.ty = e.clientY - d.grabDY - ly;
      d.el.style.transform = `translate3d(${d.tx}px, ${d.ty}px, 0)`;

      // Índice de destino: vizinho com centro mais próximo do ponteiro;
      // depois ou antes conforme a metade do vizinho em que o ponteiro cai.
      const alvos = ordemVisivelRef.current.filter((id) => id !== d.id);
      const slotAtual = ordemVisivelRef.current.indexOf(d.id);
      let destino = alvos.length;
      let melhorDist = Infinity;
      for (let i = 0; i < alvos.length; i += 1) {
        const alvoId = alvos[i];
        if (!alvoId) continue;
        const outro = elsRef.current.get(alvoId);
        if (!outro) continue;
        const rr = outro.getBoundingClientRect();
        const cx = rr.left + rr.width / 2;
        const cy = rr.top + rr.height / 2;
        const dist = (e.clientX - cx) ** 2 + (e.clientY - cy) ** 2;
        if (dist < melhorDist) {
          melhorDist = dist;
          const depois =
            e.clientY > cy + rr.height * 0.3 ||
            (Math.abs(e.clientY - cy) <= rr.height * 0.3 && e.clientX > cx);
          destino = depois ? i + 1 : i;
        }
      }
      if (alvos.length === 0) destino = 0;
      if (destino !== slotAtual) {
        commitOrdemVisivel(inserirEm(alvos, d.id, destino));
      }
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

  const handleProps: TorreCardHandleProps = {
    onPointerDown: aoPointerDown,
    onPointerMove: aoPointerMove,
    onPointerUp: aoPointerUp,
    onPointerCancel: aoPointerCancel,
    onKeyDown: aoKeyDown,
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
        custom: true,
      };
      setTemplatesCustom((prev) => [...prev, novo]);
      aoAnunciar(`Vista ${nome} salva.`);
    },
    [aoAnunciar],
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
    () => templateCorrespondente(layout.ordem, layout.ocultos, templatesTodos),
    [layout.ordem, layout.ocultos, templatesTodos],
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

      <div className="torre-grid">
        {ordemVisivel.map((id) => (
          <TorreCard
            key={id}
            ref={(el) => {
              if (el) elsRef.current.set(id, el);
              else elsRef.current.delete(id);
            }}
            id={id}
            titulo={tituloDe(id)}
            tituloId={`torre-titulo-${id}`}
            recolhido={recolhidosSet.has(id)}
            arrastando={dragId === id}
            handleProps={handleProps}
            aoAlternarRecolhido={alternarRecolhido}
            span={CARD_META[id].span}
          >
            {cards[id]}
          </TorreCard>
        ))}
      </div>
    </>
  );
}
