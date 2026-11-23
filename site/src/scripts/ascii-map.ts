// Animated ASCII map of Brazil, ported from the reference build-in-public
// site. Draws transparent; the page provides the background.

const COLUMNS = 61;
const ROWS = 51;
const FRAME_MS = 105;
const FONT = '"Geist Mono Variable", "Geist Mono", ui-monospace, monospace';

// Brazil from Natural Earth 1:110m (world.geo.json), equirectangular, fit to a square.
const OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [0.42, 0.891], [0.453, 0.857], [0.48, 0.834], [0.497, 0.824], [0.517, 0.81], [0.518, 0.791],
  [0.506, 0.776], [0.493, 0.781], [0.498, 0.767], [0.502, 0.752], [0.502, 0.739], [0.493, 0.735],
  [0.484, 0.739], [0.474, 0.737], [0.472, 0.728], [0.469, 0.706], [0.465, 0.698], [0.448, 0.692],
  [0.438, 0.696], [0.412, 0.692], [0.414, 0.658], [0.407, 0.645], [0.414, 0.64], [0.412, 0.626],
  [0.419, 0.615], [0.423, 0.596], [0.417, 0.581], [0.404, 0.574], [0.401, 0.564], [0.405, 0.55],
  [0.358, 0.549], [0.349, 0.52], [0.356, 0.52], [0.355, 0.509], [0.351, 0.502], [0.349, 0.488],
  [0.335, 0.481], [0.32, 0.481], [0.31, 0.474], [0.293, 0.469], [0.284, 0.46], [0.256, 0.456],
  [0.23, 0.434], [0.231, 0.418], [0.228, 0.408], [0.231, 0.39], [0.199, 0.394], [0.186, 0.403],
  [0.165, 0.413], [0.159, 0.42], [0.147, 0.421], [0.128, 0.419], [0.115, 0.423], [0.103, 0.42],
  [0.105, 0.383], [0.085, 0.398], [0.063, 0.397], [0.054, 0.384], [0.038, 0.382], [0.043, 0.372],
  [0.029, 0.357], [0.019, 0.335], [0.026, 0.33], [0.026, 0.32], [0.04, 0.313], [0.038, 0.3],
  [0.044, 0.291], [0.046, 0.28], [0.074, 0.263], [0.094, 0.258], [0.097, 0.255], [0.119, 0.256],
  [0.131, 0.189], [0.131, 0.178], [0.127, 0.164], [0.116, 0.155], [0.117, 0.137], [0.13, 0.133],
  [0.135, 0.136], [0.136, 0.127], [0.122, 0.124], [0.121, 0.109], [0.169, 0.109], [0.177, 0.101],
  [0.184, 0.109], [0.189, 0.123], [0.193, 0.12], [0.207, 0.133], [0.226, 0.131], [0.231, 0.124],
  [0.249, 0.118], [0.259, 0.114], [0.262, 0.104], [0.279, 0.097], [0.278, 0.092], [0.257, 0.09],
  [0.254, 0.074], [0.255, 0.058], [0.244, 0.051], [0.248, 0.049], [0.267, 0.052], [0.286, 0.058],
  [0.293, 0.053], [0.311, 0.049], [0.338, 0.04], [0.347, 0.03], [0.344, 0.023], [0.357, 0.022],
  [0.362, 0.028], [0.359, 0.039], [0.368, 0.042], [0.373, 0.054], [0.366, 0.062], [0.362, 0.083],
  [0.369, 0.096], [0.37, 0.107], [0.386, 0.118], [0.398, 0.12], [0.4, 0.115], [0.408, 0.114],
  [0.419, 0.109], [0.427, 0.103], [0.441, 0.105], [0.447, 0.104], [0.46, 0.106], [0.462, 0.101],
  [0.458, 0.096], [0.46, 0.089], [0.47, 0.091], [0.482, 0.089], [0.496, 0.094], [0.507, 0.099],
  [0.514, 0.092], [0.52, 0.093], [0.523, 0.1], [0.535, 0.099], [0.544, 0.089], [0.552, 0.071],
  [0.566, 0.049], [0.574, 0.048], [0.581, 0.061], [0.594, 0.104], [0.607, 0.108], [0.608, 0.125],
  [0.59, 0.145], [0.597, 0.153], [0.641, 0.156], [0.641, 0.181], [0.66, 0.165], [0.691, 0.174],
  [0.732, 0.189], [0.743, 0.203], [0.739, 0.217], [0.768, 0.209], [0.816, 0.222], [0.852, 0.221],
  [0.888, 0.241], [0.92, 0.269], [0.939, 0.276], [0.96, 0.277], [0.968, 0.285], [0.977, 0.316],
  [0.981, 0.331], [0.971, 0.371], [0.959, 0.387], [0.924, 0.421], [0.908, 0.449], [0.89, 0.47],
  [0.884, 0.471], [0.877, 0.489], [0.879, 0.534], [0.872, 0.572], [0.87, 0.588], [0.862, 0.598],
  [0.858, 0.631], [0.833, 0.663], [0.829, 0.688], [0.809, 0.699], [0.803, 0.713], [0.776, 0.713],
  [0.738, 0.723], [0.721, 0.734], [0.693, 0.741], [0.664, 0.76], [0.644, 0.784], [0.64, 0.803],
  [0.644, 0.816], [0.64, 0.841], [0.634, 0.853], [0.617, 0.866], [0.59, 0.91], [0.568, 0.929],
  [0.551, 0.94], [0.54, 0.964], [0.524, 0.978], [0.517, 0.964], [0.528, 0.952], [0.514, 0.936],
  [0.495, 0.922], [0.47, 0.906], [0.46, 0.907], [0.436, 0.888], [0.42, 0.891],
];

const CHARS = ['+', '+', '=', '#', '0', '/', ':', '·', 'x', '@'];

const MARKER = { x: 0.689, y: 0.727, label: 'SP · FIAP PAULISTA' };

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
          ? '#EDE5FE'
          : cell.hash % 19 === 0
            ? '#D7C5EA'
            : cell.hash % 11 === 0
              ? '#B9A0DC'
              : cell.hash % 4 === 0
                ? '#8B6FB8'
                : '#C9B3E2';
        ctx.globalAlpha = cell.hash % 7 === 0 && !glowing ? 0.48 : 0.93;
        ctx.fillText(CHARS[tick]!, px, py);
      } else if (cell.hash % 17 === 0) {
        ctx.globalAlpha = 0.25;
        ctx.fillStyle = '#3D4F4A';
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
    ctx.fillStyle = '#F5F2EB';
    ctx.fillRect(bx, my - 10, boxW, 20);
    ctx.fillStyle = '#654199';
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
