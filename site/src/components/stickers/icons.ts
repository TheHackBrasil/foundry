// The four parties of one order, drawn as fun-isometric slabs for the FORMA chapter.
import { VIEWS, ellipse, line, poly, rect, spark, star } from './fun'
import { bounce, glint, hop, impact, jolt, latch, slide, sparkle, twinkle } from './motions'
import type { Icon, Layer, Motion, Palette, Shape, Vec } from './fun'

const LINE = 5
const { tilt: FACE, extrude: EXT } = VIEWS.right

// Ink matches the page, so on black the outline reads as a die-cut edge.
export const FORGE: Palette = {
  main: '#ea5808',
  gold: '#ffb347',
  tint: '#e9c9a0',
  ok: '#ff8a3d',
  hot: '#ea5808',
  deep: '#565d67',
  white: '#f3efe8',
  grey: '#9aa0a8',
  paper: '#f7f7f7',
  ink: '#0a0c0e',
}

const glow = (parent: string, p: Vec, r: number, m: Motion | ReadonlyArray<Motion>, extra: { ip?: number; op?: number } = {}): Layer => ({
  parent,
  a: p,
  p,
  m,
  ...extra,
  shapes: [{ d: spark(p[0], p[1], r), fill: 'white' }],
})

export const crate: Icon = {
  name: 'crate',
  frames: 180,
  line: LINE,
  extrude: EXT,
  still: 150,
  layers: [
    { id: 'box', p: [250, 300], m: impact([3, 12]), shapes: [] },
    {
      id: 'body',
      parent: 'box',
      tilt: FACE,
      shapes: [
        { d: rect(-118, -40, 236, 140, 10), fill: 'tint', depth: 1 },
        { d: rect(-20, -40, 40, 140), fill: 'main', depth: 1 },
        { d: rect(-96, 22, 58, 52, 6), fill: 'white' },
        { d: line([-86, 38], [-50, 38]) },
        { d: line([-86, 56], [-62, 56]) },
      ],
    },
    {
      parent: 'body',
      p: [0, -44],
      m: latch([0, 44]),
      shapes: [
        { d: rect(-132, -84, 264, 52, 10), fill: 'tint', depth: 0.8 },
        { d: rect(-22, -84, 44, 52), fill: 'main', depth: 0.8 },
      ],
    },
    glow('box', [-136, -130], 24, { ...glint(0, 110), at: 140 }),
    glow('box', [128, -150], 30, { ...glint(0, 120), at: 146 }),
  ],
}

const WHEELS: ReadonlyArray<Vec> = [[-104, 62], [-46, 62], [100, 62]]

export const truck: Icon = {
  name: 'truck',
  frames: 180,
  line: LINE,
  extrude: EXT,
  still: 150,
  layers: [
    { id: 'rig', p: [256, 262], m: jolt([16, -6]), shapes: [] },
    {
      parent: 'rig',
      tilt: FACE,
      m: { ...jolt([16, -6]), at: 5, k: 0.45 },
      shapes: [
        { d: rect(-160, -96, 196, 136, 10), fill: 'white', depth: 1 },
        { d: rect(-160, -14, 196, 22), fill: 'main', depth: 1 },
      ],
    },
    {
      parent: 'rig',
      tilt: FACE,
      shapes: [
        { d: rect(-156, 40, 306, 16, 4), fill: 'deep', depth: 0.8 },
        ...WHEELS.flatMap(([x, y]): Shape[] => [
          { d: ellipse(x, y, 27), fill: 'deep', depth: 0.6 },
          { d: ellipse(x, y, 10), fill: 'grey' },
        ]),
      ],
    },
    {
      parent: 'rig',
      tilt: FACE,
      shapes: [
        { d: poly([[44, -54], [104, -54], [150, -4], [150, 40], [44, 40]], [10, 12, 6, 8, 4]), fill: 'main', depth: 1 },
        { d: poly([[60, -40], [98, -40], [128, -6], [60, -6]], [4, 6, 3, 3]), fill: 'tint' },
        { d: rect(128, 14, 18, 12, 3), fill: 'gold' },
      ],
    },
    glow('rig', [-176, -96], 22, twinkle(20, true), { op: 50 }),
    glow('rig', [-176, -96], 22, twinkle(100), { ip: 100 }),
  ],
}

export const warehouse: Icon = {
  name: 'warehouse',
  frames: 180,
  line: LINE,
  extrude: EXT,
  still: 160,
  layers: [
    { id: 'cd', p: [250, 280], shapes: [] },
    {
      id: 'wall',
      parent: 'cd',
      tilt: FACE,
      shapes: [
        { d: rect(-142, -44, 284, 158, 8), fill: 'white', depth: 1 },
        { d: poly([[-164, -30], [-164, -50], [0, -128], [164, -50], [164, -30]], [4, 4, 8, 4, 4]), fill: 'main', depth: 1 },
        { d: rect(-126, -4, 40, 30, 5), fill: 'tint' },
        { d: rect(86, -4, 40, 30, 5), fill: 'tint' },
      ],
    },
    { id: 'gap', parent: 'wall', shapes: [{ d: rect(-62, 8, 124, 106, 4), fill: 'deep' }] },
    { parent: 'wall', clip: 'gap', a: [0, 114], p: [0, 114], m: { ...hop, at: 54, k: 0.8 }, shapes: [{ d: rect(-34, 62, 68, 52, 6), fill: 'tint', depth: 0.6 }, { d: rect(-8, 62, 16, 52), fill: 'main' }] },
    {
      parent: 'wall',
      clip: 'gap',
      m: slide([0, -98], 18, 64, 34),
      shapes: [
        { d: rect(-62, 8, 124, 106), fill: 'grey' },
        ...[30, 52, 74, 96].map((y) => ({ d: line([-62, y], [62, y]) })),
      ],
    },
    glow('cd', [150, -150], 26, sparkle(60)),
  ],
}

const COIN = (cx: number, cy: number) => ellipse(cx, cy, 112, 80)

export const coins: Icon = {
  name: 'coins',
  frames: 180,
  line: LINE,
  extrude: [-2, 18],
  layers: [
    { p: [252, 352], r: -10, shapes: [{ d: COIN(0, 0), fill: 'gold', depth: 1 }] },
    { p: [246, 318], r: -10, shapes: [{ d: COIN(0, 0), fill: 'gold', depth: 1 }] },
    {
      id: 'coin',
      p: [240, 278],
      r: -10,
      m: bounce,
      shapes: [{ d: COIN(0, 0), fill: 'gold', depth: 1 }, { d: ellipse(0, 0, 86, 58) }, { d: star(0, 2, 40, 0.46, 5, 4), fill: 'ink', line: false }],
    },
    glow('coin', [96, -66], 26, glint(2, 98)),
    glow('coin', [-104, -48], 26, glint(6, 122)),
    glow('coin', [92, -70], 28, glint(65, 125)),
  ],
}

export const PARTIES = [crate, truck, warehouse, coins] as const
