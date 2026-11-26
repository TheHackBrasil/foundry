import { describe, expect, it } from 'vitest';
import {
  HIST_ARRASTE_PX,
  destinoArraste,
  empacotar,
  ordenarVisual,
  spanEscalonado,
  vizinhoDirecional,
  type Posicao,
} from './packing.ts';

const GAP = 20;
const larguraDe = (cols: number, cardW: number) => cols * cardW + (cols - 1) * GAP;

// Cenário-base: 4 colunas de 300px com gap 20 → largura 1260.
const COLS = 4;
const CW = 300;

function alturaMapa(reg: Record<string, number>) {
  return (id: string) => reg[id] ?? 100;
}

describe('spanEscalonado', () => {
  it('é identidade em 3 colunas (referência dos defaults)', () => {
    expect(spanEscalonado(1, 3)).toBe(1);
    expect(spanEscalonado(2, 3)).toBe(2);
    expect(spanEscalonado(3, 3)).toBe(3);
  });
  it('escala proporcionalmente em 4 colunas', () => {
    expect(spanEscalonado(3, 4)).toBe(4);
    expect(spanEscalonado(2, 4)).toBe(3);
    expect(spanEscalonado(1, 4)).toBe(1);
  });
  it('clampa nos limites', () => {
    expect(spanEscalonado(4, 1)).toBe(1);
    expect(spanEscalonado(3, 2)).toBe(2);
  });
});

describe('empacotar', () => {
  it('posiciona skyline em faixas mais baixas e soma gap', () => {
    const mapa = empacotar({
      ordem: ['a', 'b'],
      spanDe: () => 2,
      alturaDe: alturaMapa({ a: 100, b: 100 }),
      cols: COLS,
      cardW: CW,
      gap: GAP,
      elastico: false,
    });
    const a = mapa.get('a')!;
    const b = mapa.get('b')!;
    // a cobre cols 0-1; b vai para cols 2-3 (mesmo topo)
    expect(a).toMatchObject({ x: 0, y: 0, w: 2 * CW + GAP });
    expect(b).toMatchObject({ x: 2 * (CW + GAP), y: 0 });
  });

  it('preenche buraco com card menor que vem depois (backfill)', () => {
    const mapa = empacotar({
      ordem: ['t1', 'alto', 'largo', 'miudo'],
      spanDe: (id) => (id === 'largo' ? 2 : 1),
      alturaDe: alturaMapa({ t1: 50, alto: 300, largo: 40, miudo: 60 }),
      cols: 2,
      cardW: CW,
      gap: GAP,
      elastico: false,
    });
    // t1 em col0 (h50), alto em col1 (h300): 'largo' só cabe na banda cheia
    // (topo 320) e deixa um buraco em col0 entre y=70 e y=320. 'miudo' sobe
    // nesse buraco em vez de cair no fundo da skyline.
    const miudo = mapa.get('miudo')!;
    expect(miudo.coluna).toBe(0);
    expect(miudo.y).toBe(70);
    expect(miudo.y + miudo.h).toBeLessThanOrEqual(mapa.get('largo')!.y);
  });

  it('span elástico fecha a linha à direita em vez de deixar coluna morta', () => {
    const mapa = empacotar({
      ordem: ['a', 'b'],
      spanDe: () => 3,
      alturaDe: alturaMapa({ a: 100, b: 100 }),
      cols: COLS,
      cardW: CW,
      gap: GAP,
    });
    const a = mapa.get('a')!;
    expect(a.span).toBe(4);
    expect(a.x + a.w).toBe(larguraDe(COLS, CW));
  });

  it('elástico para no primeiro bloqueio à direita', () => {
    const mapa = empacotar({
      ordem: ['a', 'b', 'c', 'd', 'x'],
      spanDe: () => 1,
      alturaDe: alturaMapa({ a: 100, b: 100, c: 500, d: 500, x: 100 }),
      cols: COLS,
      cardW: CW,
      gap: GAP,
    });
    // a,b,c,d formam a primeira linha (c,d altos); x cai na faixa mais baixa
    // (col0, y=120): col1 livre na faixa de x, col2 ocupada por c até y=500
    // → x estica só até col1.
    const x = mapa.get('x')!;
    expect(x.coluna).toBe(0);
    expect(x.span).toBe(2);
    expect(x.x + x.w).toBe(2 * (CW + GAP) - GAP);
  });

  it('elástico respeita ocupação posterior (void real, não slot futuro)', () => {
    const mapa = empacotar({
      ordem: ['topo', 'later', 'fim'],
      spanDe: (id) => (id === 'topo' ? 2 : 1),
      alturaDe: alturaMapa({ topo: 100, later: 150, fim: 50 }),
      cols: 3,
      cardW: CW,
      gap: GAP,
    });
    // topo fica nas cols0-1 e 'later' ocupa col2 em faixa sobreposta → topo
    // não estica. 'fim' cai em col0 abaixo de topo: col1 livre na sua faixa,
    // col2 bloqueada por later → estica só até col1.
    expect(mapa.get('topo')!.span).toBe(2);
    expect(mapa.get('later')!.coluna).toBe(2);
    expect(mapa.get('fim')!.span).toBe(2);
    // invariante geral: nenhum par se sobrepõe
    const ps = [...mapa.values()];
    for (let i = 0; i < ps.length; i += 1) {
      for (let j = i + 1; j < ps.length; j += 1) {
        const A = ps[i]!, B = ps[j]!;
        const sobX = A.x < B.x + B.w && A.x + A.w > B.x;
        const sobY = A.y < B.y + B.h && A.y + A.h > B.y;
        expect(sobX && sobY).toBe(false);
      }
    }
  });

  it('não estica card no meio da linha (só void à direita)', () => {
    const mapa = empacotar({
      ordem: ['a', 'b'],
      spanDe: () => 1,
      alturaDe: alturaMapa({ a: 100, b: 400 }),
      cols: COLS,
      cardW: CW,
      gap: GAP,
      elastico: false,
    });
    expect(mapa.get('a')!.coluna).toBe(0);
    expect(mapa.get('b')!.coluna).toBe(1);
  });
});

describe('ordenarVisual', () => {
  it('ordena por linha (y arredondado) depois por x', () => {
    const posMap = new Map<string, Posicao>([
      ['a', { x: 640, y: 0, w: 620, h: 100, coluna: 2, span: 2 }],
      ['b', { x: 0, y: 0, w: 620, h: 100, coluna: 0, span: 2 }],
      ['c', { x: 0, y: 500, w: 1260, h: 100, coluna: 0, span: 4 }],
    ]);
    expect(ordenarVisual(['a', 'b', 'c'], posMap)).toEqual(['b', 'a', 'c']);
  });
  it('tolera y levemente desalinhado dentro da mesma faixa', () => {
    const posMap = new Map<string, Posicao>([
      ['a', { x: 0, y: 105, w: 300, h: 100, coluna: 0, span: 1 }],
      ['b', { x: 320, y: 110, w: 300, h: 100, coluna: 1, span: 1 }],
    ]);
    // yR: 100 vs 110 → 'a' primeiro mesmo sem empatar a linha — e segue x.
    expect(ordenarVisual(['b', 'a'], posMap)).toEqual(['a', 'b']);
  });
});

describe('vizinhoDirecional', () => {
  const posMap = new Map<string, Posicao>([
    ['a', { x: 0, y: 0, w: 620, h: 100, coluna: 0, span: 2 }],
    ['b', { x: 640, y: 0, w: 620, h: 100, coluna: 2, span: 2 }],
    ['c', { x: 0, y: 120, w: 1260, h: 200, coluna: 0, span: 4 }],
  ]);
  const ordem = ['a', 'b', 'c'];
  it('ArrowRight acha o vizinho à direita e insere depois dele', () => {
    const r = vizinhoDirecional(posMap, ordem, 'a', 'right');
    expect(r).toEqual({ vizinho: 'b', destino: 1 });
  });
  it('ArrowDown acha o vizinho abaixo e insere depois dele', () => {
    const r = vizinhoDirecional(posMap, ordem, 'a', 'down');
    // 'c' está na posição 1 da lista sem 'a' → destino 2 (depois dele)
    expect(r).toEqual({ vizinho: 'c', destino: 2 });
  });
  it('ArrowUp num card do topo não acha ninguém', () => {
    expect(vizinhoDirecional(posMap, ordem, 'a', 'up')).toBeNull();
  });
  it('ArrowLeft no primeiro da linha não acha ninguém', () => {
    expect(vizinhoDirecional(posMap, ordem, 'a', 'left')).toBeNull();
  });
});

describe('destinoArraste', () => {
  const posMap = new Map<string, Posicao>([
    ['x', { x: 0, y: 0, w: 620, h: 100, coluna: 0, span: 2 }],
    ['a', { x: 640, y: 0, w: 620, h: 100, coluna: 2, span: 2 }],
    ['b', { x: 0, y: 120, w: 1260, h: 200, coluna: 0, span: 4 }],
  ]);
  const ordem = ['x', 'a', 'b'];
  const base = {
    ordem,
    posMap,
    arrastado: 'x',
    histeresePx: HIST_ARRASTE_PX,
  };

  it('pointer parado (sem deslocamento desde a âncora) nunca commita', () => {
    const r = destinoArraste({
      ...base,
      px: 900, py: 50, // dentro da caixa de 'a'
      clientX: 500, clientY: 300,
      ancoraX: 500, ancoraY: 300, // pointer não andou desde o commit
    });
    expect(r).toBeNull();
  });

  it('dentro da caixa de um vizinho e com pointer movido → destino', () => {
    const r = destinoArraste({
      ...base,
      // dentro da caixa de 'b' (x0-1260, y120-320), antes do centro
      px: 600, py: 200, clientX: 600, clientY: 200,
      ancoraX: 100, ancoraY: 40,
    });
    expect(r).toBe(1);
  });

  it('depois do centro do vizinho → insere depois', () => {
    const r = destinoArraste({
      ...base,
      px: 1240, py: 60, clientX: 1240, clientY: 60,
      ancoraX: 100, ancoraY: 60,
    });
    expect(r).toBe(1);
  });

  it('longe de qualquer slot e mais perto do próprio slot → null', () => {
    const r = destinoArraste({
      ...base,
      px: 300, py: 30, clientX: 300, clientY: 30,
      ancoraX: 0, ancoraY: 0,
    });
    expect(r).toBeNull();
  });

  it('destino que reproduz a ordem atual vira null (sem commit inerte)', () => {
    // 'x' já é o primeiro: pointer antes do centro de 'a' gera a mesma ordem
    // ['x','a','b'] → null.
    const r = destinoArraste({
      ...base,
      px: 800, py: 50, clientX: 800, clientY: 50,
      ancoraX: 0, ancoraY: 0,
    });
    expect(r).toBeNull();
  });
});
