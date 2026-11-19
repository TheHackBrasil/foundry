// Animated ASCII map of Brazil, ported from the reference build-in-public
// site. Draws transparent; the page provides the background.

const COLUMNS = 61;
const ROWS = 51;
const FRAME_MS = 105;
const FONT = '"JetBrains Mono", ui-monospace, monospace';

const OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [.23, .14], [.35, .13], [.40, .06], [.48, .04], [.53, .11], [.62, .10],
  [.68, .18], [.76, .19], [.84, .26], [.94, .27], [.99, .33], [.94, .39],
  [.87, .43], [.85, .50], [.79, .55], [.77, .63], [.69, .72], [.65, .80],
  [.57, .88], [.53, .97], [.48, .91], [.44, .82], [.38, .75], [.35, .69],
  [.27, .68], [.23, .62], [.15, .61], [.12, .55], [.07, .54], [.02, .47],
  [.05, .36], [.12, .31], [.12, .25], [.18, .25], [.19, .19],
];

const CHARS = ['+', '+', '=', '#', '0', '/', ':', '·', 'x', '@'];

const MARKER = { x: .63, y: .75, label: 'SP · FIAP PAULISTA' };

interface Cell {
  col: number;
  row: number;
  hash: number;
  active: boolean;
}

// Even-odd ray casting against the outline polygon.
const inside = (x: number, y: number): boolean => {
  let result = false;
  for (let i = 0, j = OUTLINE.length - 1; i < OUTLINE.length; j = i++) {
    const [ax, ay] = OUTLINE[i]!;
    const [bx, by] = OUTLINE[j]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) result = !result;
  }
  return result;
};

const CELLS: Cell[] = [];
for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLUMNS; col++) {
    const hash = (col * 103 + row * 157 + col * row * 31) % 997;
    CELLS.push({ col, row, hash, active: inside((col + 0.5) / COLUMNS, (row + 0.5) / ROWS) });
  }
}

export function startAsciiMap(canvas: HTMLCanvasElement, opts: { reduced: boolean }): () => void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return () => {};

  let width = 0;
  let height = 0;
  let visible = true;
  let lastTime = -Infinity;
  let raf = 0;
  let stopped = false;

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.max(1, Math.round(width * dpr));
    canvas.height = Math.max(1, Math.round(height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  const draw = (time: number) => {
    if (width === 0 || height === 0) return;
    const cw = width / COLUMNS;
    const rh = height / ROWS;
    // Monospace advance is ~0.6em, so cap the size by both cell axes.
    const size = Math.max(6, Math.min(rh * 0.9, cw * 1.6));
    const phase = Math.floor(time / 140);

    ctx.clearRect(0, 0, width, height);
    ctx.font = `${size}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    for (const cell of CELLS) {
      const px = (cell.col + 0.5) * cw;
      const py = (cell.row + 0.5) * rh;
      if (cell.active) {
        const flicker = (cell.hash + phase * 19) % 113;
        const tick = (cell.hash + Math.floor(phase / 2)) % CHARS.length;
        const glowing = flicker < 12;
        ctx.fillStyle = glowing
          ? '#ffd27a'
          : cell.hash % 19 === 0
            ? '#ff8a3d'
            : cell.hash % 11 === 0
              ? '#b8460a'
              : cell.hash % 4 === 0
                ? '#7a3410'
                : '#ea5808';
        ctx.globalAlpha = cell.hash % 7 === 0 && !glowing ? 0.48 : 0.93;
        ctx.fillText(CHARS[tick]!, px, py);
      } else if (cell.hash % 17 === 0) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#343b43';
        ctx.fillText('·', px, py);
      }
    }

    // Single labelled marker; the square sits exactly on the point.
    ctx.globalAlpha = 1;
    ctx.font = `bold 11px ${FONT}`;
    ctx.textAlign = 'left';
    const mx = MARKER.x * width;
    const my = MARKER.y * height;
    const textW = ctx.measureText(MARKER.label).width;
    const boxW = textW + 12;
    // Keep the box inside the canvas when the point is near the right edge.
    const bx = Math.min(mx + 8, width - boxW);
    ctx.fillStyle = '#0a0c0e';
    ctx.fillRect(bx, my - 10, boxW, 20);
    ctx.fillStyle = '#ff8a3d';
    ctx.fillText(MARKER.label, bx + 6, my);
    ctx.fillRect(mx - 2.5, my - 2.5, 5, 5);
  };

  const frame = (time: number) => {
    raf = 0;
    if (stopped || !visible) return;
    if (time - lastTime > FRAME_MS) {
      lastTime = time;
      draw(time);
    }
    raf = requestAnimationFrame(frame);
  };

  const start = () => {
    if (!raf && !stopped) raf = requestAnimationFrame(frame);
  };

  const ro = new ResizeObserver(() => {
    resize();
    if (opts.reduced) draw(0);
    else draw(performance.now());
  });
  resize();

  let io: IntersectionObserver | null = null;
  if (opts.reduced) {
    draw(0);
  } else {
    io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        visible = entry.isIntersecting;
        if (visible) start();
      },
      { threshold: 0 },
    );
    io.observe(canvas);
    start();
  }
  ro.observe(canvas);

  return () => {
    stopped = true;
    if (raf) cancelAnimationFrame(raf);
    ro.disconnect();
    io?.disconnect();
  };
}
