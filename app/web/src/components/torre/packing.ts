// Lógica pura do motor do grid da Torre: packing masonry (skyline com
// backfill) com span elástico na borda direita, ordenação visual para o DOM,
// vizinho direcional para as setas do teclado e destino do arraste com
// histerese. Sem DOM: só dados entram e saem — coberta por packing.test.ts.

export interface Posicao {
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

// Os spans de CARD_META foram afinados para o grid em 3 colunas; em outras
// larguras o valor pedido é escalonado proporcionalmente (span guarda a
// intenção "fração do grid", não o número absoluto).
export const COLUNAS_REF = 3;
export function spanEscalonado(base: number, cols: number): number {
  return Math.max(1, Math.min(cols, Math.round((base * cols) / COLUNAS_REF)));
}

// Packing masonry: cada card cai na faixa de `span` colunas mais baixa.
// Cards que pousam mais alto que o topo de uma coluna deixam um Buraco,
// preenchido por quem couber depois. Ao final da faixa, colunas livres à
// direita são absorvidas pelo próprio card (span elástico): um card de span 3
// em 4 colunas alarga para fechar a linha em vez de deixar coluna morta.
export function empacotar<T extends string>(args: {
  ordem: readonly T[];
  spanDe: (id: T) => number;
  alturaDe: (id: T) => number;
  cols: number;
  cardW: number;
  gap: number;
  elastico?: boolean;
  // Ids com span explicito (escolha da pessoa) nunca esticam: a intenção é
  // respeitada literalmente. O preenchimento de coluna morta é polimento do
  // layout automático, não traição de quem escolheu a largura na mão.
  explicitos?: ReadonlySet<T>;
}): Map<T, Posicao> {
  const { ordem, spanDe, alturaDe, cols, cardW, gap } = args;
  const elastico = args.elastico !== false;
  const explicitos = args.explicitos;
  const mapa = new Map<T, Posicao>();
  if (cols < 1 || cardW <= 0) return mapa;
  const colH = new Array<number>(cols).fill(0);
  const buracos: Buraco[] = [];

  const sobrepoeY = (a0: number, a1: number, b0: number, b1: number): boolean =>
    a0 < b1 && a1 > b0;

  // A coluna está livre na faixa [y, y+h) se nenhum card já posicionado a
  // ocupa ali (cobre tanto a skyline quanto backfills anteriores).
  const colunaLivreNaFaixa = (c: number, y: number, h: number): boolean => {
    for (const q of mapa.values()) {
      if (c >= q.coluna && c < q.coluna + q.span && sobrepoeY(y, y + h, q.y, q.y + q.h)) {
        return false;
      }
    }
    return true;
  };

  for (const id of ordem) {
    const span0 = Math.max(1, Math.min(spanDe(id), cols));
    const h = alturaDe(id);
    let bx = 0;
    let bh = Infinity;
    for (let i = 0; i + span0 <= cols; i += 1) {
      const topo = Math.max(...colH.slice(i, i + span0));
      if (topo < bh) {
        bh = topo;
        bx = i;
      }
    }
    // Backfill: uma faixa de colunas adjacentes cujos buracos têm sobreposição
    // comum >= h hospeda o card mais alto que a skyline permitiria.
    let usados: Buraco[] | null = null;
    for (let i = 0; i + span0 <= cols; i += 1) {
      let topo = -Infinity;
      let fundo = Infinity;
      const cand: Buraco[] = [];
      let ok = true;
      for (let c = i; c < i + span0; c += 1) {
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
      x: bx * (cardW + gap),
      y: bh,
      w: span0 * cardW + (span0 - 1) * gap,
      h,
      coluna: bx,
      span: span0,
    });

    if (usados) {
      // O trecho acima de bh (buracos de alturas diferentes) continua livre;
      // o de baixo vira um buraco menor ou some.
      for (const b of usados) {
        const fim = b.baixo;
        if (b.cima < bh - 1) {
          b.baixo = bh;
          if (bh + h + gap < fim - 1) {
            buracos.push({ col: b.col, cima: bh + h + gap, baixo: fim });
          }
        } else {
          b.cima = bh + h + gap;
          if (b.baixo - b.cima < 1) buracos.splice(buracos.indexOf(b), 1);
        }
      }
    } else {
      for (let i = bx; i < bx + span0; i += 1) {
        const col = colH[i];
        if (col !== undefined && col < bh - 1) {
          buracos.push({ col: i, cima: col, baixo: bh });
        }
        colH[i] = bh + h + gap;
      }
    }
  }

  // Pós-passo elástico: com a ocupação final conhecida, um card que fecha sua
  // faixa alarga para cobrir colunas mortas à direita — só void de verdade,
  // nunca colunas que um card posterior ocupou. Extensões em ordem de packing:
  // a parte esticada de um card bloqueia a do próximo na mesma faixa.
  if (elastico) {
    for (const [id, p] of mapa) {
      if (explicitos?.has(id)) continue;
      let span = p.span;
      for (let c = p.coluna + span; c < cols && colunaLivreNaFaixa(c, p.y, p.h); c += 1) {
        span += 1;
      }
      if (span > p.span) {
        p.span = span;
        p.w = span * cardW + (span - 1) * gap;
      }
    }
  }
  return mapa;
}

// Ordem de tabulação/leitura = ordem visual: linhas agrupadas por y
// arredondado, cartões da mesma faixa ordenados por x (WCAG 2.4.3 / 1.3.2).
const ARREDONDA_LINHA = 20;
export function ordenarVisual<T extends string>(
  ordem: readonly T[],
  posMap: ReadonlyMap<T, Posicao>,
): T[] {
  return [...ordem].sort((a, b) => {
    const pa = posMap.get(a);
    const pb = posMap.get(b);
    if (!pa || !pb) return 0;
    const la = Math.round(pa.y / ARREDONDA_LINHA);
    const lb = Math.round(pb.y / ARREDONDA_LINHA);
    return la !== lb ? la - lb : pa.x - pb.x;
  });
}

export type Direcao = 'up' | 'down' | 'left' | 'right';

// Seta do teclado: vizinho mais próximo do centro do card naquela direção,
// com penalidade no eixo perpendicular (favorece o alinhado à trajetória).
// `destino` é o índice de inserção na lista sem o card — depois do vizinho
// para baixo/direita, antes para cima/esquerda.
export function vizinhoDirecional<T extends string>(
  posMap: ReadonlyMap<T, Posicao>,
  ordem: readonly T[],
  id: T,
  dir: Direcao,
): { vizinho: T; destino: number } | null {
  const p = posMap.get(id);
  if (!p) return null;
  const cx = p.x + p.w / 2;
  const cy = p.y + p.h / 2;
  let melhor: T | null = null;
  let melhorScore = Infinity;
  for (const [oid, q] of posMap) {
    if (oid === id) continue;
    const dx = q.x + q.w / 2 - cx;
    const dy = q.y + q.h / 2 - cy;
    const sobX = p.x < q.x + q.w && p.x + p.w > q.x;
    const sobY = p.y < q.y + q.h && p.y + p.h > q.y;
    let prim = -1;
    let perp = 0;
    let alinhado = false;
    if (dir === 'right' && dx > 1) {
      prim = dx;
      perp = Math.abs(dy);
      alinhado = sobY;
    } else if (dir === 'left' && dx < -1) {
      prim = -dx;
      perp = Math.abs(dy);
      alinhado = sobY;
    } else if (dir === 'down' && dy > 1) {
      prim = dy;
      perp = Math.abs(dx);
      alinhado = sobX;
    } else if (dir === 'up' && dy < -1) {
      prim = -dy;
      perp = Math.abs(dx);
      alinhado = sobX;
    }
    // Candidato precisa estar na trajetória: ou divide a faixa perpendicular
    // (mesma linha para esq/dir) ou domina de longe no eixo principal.
    if (prim < 0 || (!alinhado && prim <= perp * 2.5)) continue;
    const score = prim + perp * 1.7;
    if (score < melhorScore) {
      melhorScore = score;
      melhor = oid;
    }
  }
  if (melhor === null) return null;
  const sem = ordem.filter((c) => c !== id);
  const idx = sem.indexOf(melhor);
  if (idx === -1) return null;
  const depois = dir === 'down' || dir === 'right';
  return { vizinho: melhor, destino: idx + (depois ? 1 : 0) };
}

// Deslocamento mínimo do pointer desde o último commit para um novo commit:
// com o pointer parado a ordem nunca muda — é a histerese principal do gesto.
export const HIST_ARRASTE_PX = 26;
const MARGEM_CAIXA = 0.12;
const RAZAO_PROXIMIDADE = 0.62;

// Destino do arraste: índice de inserção na lista `ordem` sem o arrastado, ou
// null quando o gesto não deve commitar. Dois freios: (1) o pointer precisa
// ter andado `histeresePx` em coords de cliente desde o último commit/âncora
// (ordem parada com pointer parado); (2) o alvo só vale se o pointer está
// dentro da caixa dele (com margem) ou claramente mais perto dele que do
// próprio slot. O commit ainda exige que a ordem resultante difira da atual.
export function destinoArraste<T extends string>(args: {
  px: number;
  py: number;
  clientX: number;
  clientY: number;
  ancoraX: number;
  ancoraY: number;
  ordem: readonly T[];
  posMap: ReadonlyMap<T, Posicao>;
  arrastado: T;
  histeresePx?: number;
}): number | null {
  const hist = args.histeresePx ?? HIST_ARRASTE_PX;
  if (Math.hypot(args.clientX - args.ancoraX, args.clientY - args.ancoraY) < hist) {
    return null;
  }
  const { px, py, ordem, posMap, arrastado } = args;
  const p = posMap.get(arrastado);
  if (!p) return null;
  const alvos = ordem.filter((c) => c !== arrastado);
  if (alvos.length === 0) return null;
  const slotCX = p.x + p.w / 2;
  const slotCY = p.y + p.h / 2;
  const distSlot = Math.hypot(px - slotCX, py - slotCY);
  let melhorDist = Infinity;
  let destino = -1;
  let dentro = false;
  for (let i = 0; i < alvos.length; i += 1) {
    const alvoId = alvos[i];
    if (alvoId === undefined) continue;
    const outro = posMap.get(alvoId);
    if (!outro) continue;
    const cx = outro.x + outro.w / 2;
    const cy = outro.y + outro.h / 2;
    const dist = Math.hypot(px - cx, py - cy);
    if (dist < melhorDist) {
      melhorDist = dist;
      dentro =
        px >= outro.x - outro.w * MARGEM_CAIXA &&
        px <= outro.x + outro.w * (1 + MARGEM_CAIXA) &&
        py >= outro.y - outro.h * MARGEM_CAIXA &&
        py <= outro.y + outro.h * (1 + MARGEM_CAIXA);
      const depois =
        py > cy + outro.h * 0.3 || (Math.abs(py - cy) <= outro.h * 0.3 && px > cx);
      destino = depois ? i + 1 : i;
    }
  }
  const decisivo = dentro || melhorDist < distSlot * RAZAO_PROXIMIDADE;
  if (!decisivo || destino < 0) return null;
  const nova = inserirEmLista(alvos, arrastado, destino);
  return mesmaOrdem(nova, ordem) ? null : destino;
}

export function inserirEmLista<T>(lista: readonly T[], id: T, idx: number): T[] {
  const limite = Math.max(0, Math.min(lista.length, idx));
  return [...lista.slice(0, limite), id, ...lista.slice(limite)];
}

// ---------- duração do retile (motion-fisica, spec 0015) ----------
// A transição de transform/width/height é proporcional ao deslocamento real:
// a base cobre o arranque, cada px soma tempo e o teto evita travessias
// longas demais — velocidade percebida aproximadamente constante, como num
// corpo com massa. O resize (span, recolhido) entra com peso menor na
// distância efetiva e tem piso próprio: um stretch de largura sem
// deslocamento continua legível.
export const RETILE_BASE_MS = 340;
export const RETILE_TETO_MS = 680;
export const RETILE_PX_MS = 0.35;
export const RETILE_RESIZE_PESO = 0.45;
export const RETILE_RESIZE_MIN_MS = 420;

// `antes` é o alvo do retile anterior (o mapa é atualizado junto com o
// commit, então a posição interpolada não está disponível — alvo a alvo é
// determinístico e suficiente). Cards novos recebem a base.
export function duracaoRetile(antes: Posicao | undefined, depois: Posicao): number {
  if (!antes) return RETILE_BASE_MS;
  const desloc = Math.hypot(depois.x - antes.x, depois.y - antes.y);
  const resize = Math.hypot(depois.w - antes.w, depois.h - antes.h);
  let ms = RETILE_BASE_MS + RETILE_PX_MS * (desloc + resize * RETILE_RESIZE_PESO);
  if (resize >= 1) ms = Math.max(ms, RETILE_RESIZE_MIN_MS);
  return Math.round(Math.min(RETILE_TETO_MS, ms));
}

function mesmaOrdem<T>(a: readonly T[], b: readonly T[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
