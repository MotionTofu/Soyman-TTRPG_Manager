/** Кромка поверхности (гриллинг 2026-10-08, К1–К8): край — свойство поверхности.
 * Верхняя поверхность лежит на нижней: под её рваным краем нижняя продолжается, а не гаснет в ровный цвет. */
export interface SurfaceEdge {
  /** Ширина перехода, клеток: 0 — чёткий край по линии кисти. */ width: number;
  /** Рваность 0–1: насколько узор разъедает край. */ rough: number;
  /** Ярус: 0 — низ, 1 — середина, 2 — верх. При равном ярусе сверху та, что позже появилась в палитре карты. */ tier: number;
  /** Своя маска кромки: id картинки и шаг её повтора в клетках (шаг самой поверхности). */ mask?: string; cells?: number;
}
/** Край «как было»: переход в один отсчёт маски, без рваности. */
export const PLAIN_EDGE: SurfaceEdge = { width: 0.25, rough: 0, tier: 1 };
/** На сколько отсчётов маски нижняя поверхность заходит под верхнюю: полклетки кромки с каждой стороны и запас. */
export const EDGE_REACH = 5;
/** Ширина перехода в отсчётах маски, как её задал Мастер, и окно размытия — не уже одного отсчёта. */
export const edgeRamp = (edge: SurfaceEdge, sampleSize: number) => Math.max(0, edge.width) / sampleSize;
export const edgeWindow = (edge: SurfaceEdge, sampleSize: number) => Math.max(1, edgeRamp(edge, sampleSize));
/** Сколько отсчётов вокруг плитки влияет на её край. */
export const edgeMargin = (window: number) => EDGE_REACH + Math.ceil((window - 1) / 2);
/** Край считается по точкам, а не растяжением маски, когда он рваный или уже одного отсчёта. */
export const edgeNeedsPixels = (edge: SurfaceEdge, sampleSize: number) => edge.rough > 0 || edgeRamp(edge, sampleSize) < 1;

/** Поле покрытия поверхности на квадрате `side`×`side` отсчётов от (`x0`, `y0`): 1 — поверхность есть, 0 — нет, между — переход.
 * `rankAt` — порядок наложения материала в отсчёте (−∞ — пусто). Под материалами выше себя поверхность продолжается
 * на `EDGE_REACH` отсчётов; затем поле размывается окном `window`. */
export function edgeField(side: number, x0: number, y0: number, rankAt: (sx: number, sy: number) => number, rank: number, window: number): Float32Array {
  const blur = Math.ceil((window - 1) / 2), margin = EDGE_REACH + blur, grid = side + margin * 2;
  // Под верхние поверхность заходит шаг за шагом от своих отсчётов и только пока она ближе, чем то, что ниже её самой
  // (в том числе пустота): под узкой полосой верхней она не доходит до чужого края и через третью поверхность не перепрыгивает.
  const state = new Uint8Array(grid * grid), solid = new Float32Array(grid * grid), OWN = 1, ABOVE = 2, TAKEN = 3;
  let mine: number[] = [], other: number[] = [];
  for (let y = 0; y < grid; y++) for (let x = 0; x < grid; x++) {
    const value = rankAt(x0 - margin + x, y0 - margin + y), i = y * grid + x;
    if (value === rank) { state[i] = OWN; solid[i] = 1; mine.push(i); } else if (value > rank) state[i] = ABOVE; else other.push(i);
  }
  const grow = (front: number[], claim: (i: number) => void) => {
    const next: number[] = [];
    for (const i of front) {
      const x = i % grid, y = (i - x) / grid;
      for (let ny = Math.max(0, y - 1); ny <= Math.min(grid - 1, y + 1); ny++) for (let nx = Math.max(0, x - 1); nx <= Math.min(grid - 1, x + 1); nx++) {
        const j = ny * grid + nx;
        if (state[j] === ABOVE) { state[j] = TAKEN; claim(j); next.push(j); }
      }
    }
    return next;
  };
  for (let step = 0; step < EDGE_REACH && mine.length; step++) { mine = grow(mine, i => { solid[i] = 1; }); other = grow(other, () => {}); }
  const weight = (d: number) => Math.max(0, Math.min(1, window / 2 + 0.5 - Math.abs(d)));
  const across = new Float32Array(grid * side), field = new Float32Array(side * side);
  for (let y = 0; y < grid; y++) for (let x = 0; x < side; x++) {
    let sum = 0;
    for (let d = -blur; d <= blur; d++) sum += solid[y * grid + x + margin + d] * weight(d);
    across[y * side + x] = sum;
  }
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    let sum = 0;
    for (let d = -blur; d <= blur; d++) sum += across[(y + margin + d) * side + x] * weight(d);
    const value = sum / (window * window);
    field[y * side + x] = value > 0.999 ? 1 : value < 0.001 ? 0 : value;
  }
  return field;
}

/** Серый бесшовный узор, которым разъедается край: `side`×`side` точек на `cells` клеток. */
export interface EdgeNoise { data: Uint8Array | Uint8ClampedArray; side: number; cells: number }
let engine: EdgeNoise | null = null;
/** Шум движка — для поверхностей без своей маски: клочья от восьмой части клетки до половины. */
export function engineNoise(): EdgeNoise {
  if (engine) return engine;
  const side = 128, raw = new Float32Array(side * side);
  let seed = 0x2f6e2b1;
  const random = () => (seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296;
  for (const [lattice, share] of [[8, 0.4], [16, 0.35], [32, 0.25]]) {
    const knots = Float32Array.from({ length: lattice * lattice }, random), step = side / lattice;
    const ease = (t: number) => t * t * (3 - 2 * t);
    for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
      const gx = Math.floor(x / step), gy = Math.floor(y / step), tx = ease(x / step - gx), ty = ease(y / step - gy);
      const at = (ix: number, iy: number) => knots[(iy % lattice) * lattice + ix % lattice];
      raw[y * side + x] += share * ((at(gx, gy) * (1 - tx) + at(gx + 1, gy) * tx) * (1 - ty) + (at(gx, gy + 1) * (1 - tx) + at(gx + 1, gy + 1) * tx) * ty);
    }
  }
  let min = Infinity, max = -Infinity;
  for (const value of raw) { min = Math.min(min, value); max = Math.max(max, value); }
  return engine = { data: Uint8Array.from(raw, value => Math.round((value - min) / (max - min) * 255)), side, cells: 4 };
}

/** Прозрачность края по точкам: `field` (`n`×`n` отсчётов) растягивается на `side`×`side` точек, порог перехода сдвигает узор.
 * `x`, `y` — левый верхний угол в клетках карты, `perUnit` — точек на клетку: узор привязан к карте. Пишет альфу в RGBA `out`. */
export function edgeAlpha(field: Float32Array, n: number, out: Uint8ClampedArray, side: number,
  o: { ramp: number; rough: number; noise: EdgeNoise; x: number; y: number; perUnit: number }) {
  const perSample = side / n, { noise } = o;
  // Край уже отсчёта: переход в поле шириной в отсчёт сжимается, но не резче одной точки экрана.
  const gain = o.ramp < 1 ? 1 / Math.max(o.ramp, 1 / perSample) : 1;
  // Рваный край резче ровного: при полной рваности остаётся только сглаживание в пару точек.
  const soft = Math.max((1 - o.rough) ** 4 / gain, 1.5 / (Math.max(o.ramp, 1) * perSample));
  const lo = new Int32Array(side), part = new Float32Array(side);
  for (let p = 0; p < side; p++) { const f = Math.max(0, Math.min(n - 1, (p + 0.5) / perSample - 0.5)); lo[p] = Math.min(n - 2, Math.floor(f)); part[p] = f - lo[p]; }
  const grain = noise.side / noise.cells, wrap = (value: number) => ((value % noise.side) + noise.side) % noise.side;
  for (let py = 0; py < side; py++) {
    const row = lo[py] * n, ty = part[py], ny = wrap((o.y + (py + 0.5) / o.perUnit) * grain - 0.5), ny0 = Math.floor(ny), ny1 = (ny0 + 1) % noise.side, nty = ny - ny0;
    for (let px = 0; px < side; px++) {
      const at = row + lo[px], tx = part[px];
      const f = (field[at] * (1 - tx) + field[at + 1] * tx) * (1 - ty) + (field[at + n] * (1 - tx) + field[at + n + 1] * tx) * ty;
      let alpha = f;
      if (f > 0 && f < 1) {
        let threshold = 0.5;
        if (o.rough > 0) {
          const nx = wrap((o.x + (px + 0.5) / o.perUnit) * grain - 0.5), nx0 = Math.floor(nx), nx1 = (nx0 + 1) % noise.side, ntx = nx - nx0;
          const value = ((noise.data[ny0 * noise.side + nx0] * (1 - ntx) + noise.data[ny0 * noise.side + nx1] * ntx) * (1 - nty)
            + (noise.data[ny1 * noise.side + nx0] * (1 - ntx) + noise.data[ny1 * noise.side + nx1] * ntx) * nty) / 255;
          threshold += (value - 0.5) * o.rough * 0.9;
        }
        alpha = (f - threshold) / soft + 0.5;
      }
      const i = (py * side + px) * 4;
      out[i] = out[i + 1] = out[i + 2] = 255; out[i + 3] = alpha * 255;
    }
  }
}
