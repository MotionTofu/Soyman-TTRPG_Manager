export interface GraphNode {
  key: string;
  type: string;
  id: number;
  title: string;
}
export interface GraphEdge {
  from: string;
  to: string;
  section: string | null;
  tone: string | null;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const TYPE_LABELS: Record<string, string> = {
  campaign: "Кампании",
  setting: "Сеттинги",
  player: "Игроки",
  character: "Персонажи",
  location: "Локации",
  being: "Существа",
  community: "Сообщества",
  artifact: "Артефакты",
  resource: "Ресурсы",
  mastering: "Мастерение",
  scene: "Сцены",
  adventure: "Приключения",
  compendium_entry: "Компендиум",
};

export const TYPE_COLORS: Record<string, string> = {
  campaign: "#5b7fa6",
  setting: "#b0973d",
  player: "#7c9885",
  character: "#6fa87c",
  location: "#a65b5b",
  being: "#b08968",
  community: "#7a2438",
  artifact: "#8968b0",
  resource: "#4a90a4",
  mastering: "#9d97ad",
  scene: "#c2683f",
  adventure: "#8a5a3c",
  compendium_entry: "#6b7f9e",
};

export const TYPE_ROUTES: Record<string, string> = {
  campaign: "/campaigns",
  setting: "/settings",
  player: "/players",
  character: "/characters",
  location: "/locations",
  being: "/beings",
  community: "/communities",
  artifact: "/artifacts",
  scene: "/scenes",
  adventure: "/adventures",
  compendium_entry: "/compendium",
};

export const GRAPH_WIDTH = 900;
export const GRAPH_HEIGHT = 640;
const BASE_NODE_COUNT = 25; // node count the base 900x640 canvas is comfortable for

// A canvas sized only for ~25 nodes gets cramped once a setting accumulates
// a few dozen beings/factions/locations — nodes pile up along the clamped
// edges instead of spreading out. Grow the canvas area in proportion to how
// far over that baseline the graph is (aspect ratio held fixed), so small
// graphs keep the original compact size and large ones get real room.
export function canvasSizeFor(nodeCount: number): { width: number; height: number } {
  const scale = Math.sqrt(Math.max(1, nodeCount / BASE_NODE_COUNT));
  return { width: Math.round(GRAPH_WIDTH * scale), height: Math.round(GRAPH_HEIGHT * scale) };
}

export interface NodePosition {
  x: number;
  y: number;
  vx: number;
  vy: number;
}
export type NodePositions = Map<string, NodePosition>;

// Отталкивание слабеет как 1/d²: на этой дистанции оно уже меньше 0.06 —
// меньше, чем узел сдвинется за всю раскладку. Считать его для всех пар
// смысла нет, поэтому пары ищутся по сетке ячеек размером с отсечку: у
// каждого узла проверяются только соседи из его и восьми смежных ячеек.
const REPULSION_CUTOFF = 260;
const REPULSION_STRENGTH = 4000;
const FULL_ITERATIONS = 220;
// Раскладка от готовых позиций — это доводка, а не построение с нуля: столько
// шагов хватает, чтобы новые узлы нашли место, а мир не перетасовался.
const RESEED_ITERATIONS = 70;
const ALPHA_MIN = 0.02;
const RESEED_ALPHA = 0.25;

// Simple force-directed layout: circular seed positions, then repulsion +
// spring edges + a gentle centering pull, run for a fixed number of
// iterations. Deterministic-ish and fast enough for the graph sizes this app
// deals with (dozens to a couple hundred nodes) — no need for a library.
// `seed` — позиции с прошлого прогона: узлы, которые в графе остались,
// стартуют оттуда, где пользователь их видел, поэтому смена фильтра больше не
// перекладывает всю карту заново.
export function simulateGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number = GRAPH_WIDTH,
  height: number = GRAPH_HEIGHT,
  seed?: NodePositions
): NodePositions {
  const pos: NodePositions = new Map();
  const cx = width / 2;
  const cy = height / 2;
  let seeded = 0;
  nodes.forEach((n, i) => {
    const known = seed?.get(n.key);
    if (known) {
      seeded++;
      pos.set(n.key, {
        x: Math.max(30, Math.min(width - 30, known.x)),
        y: Math.max(30, Math.min(height - 30, known.y)),
        vx: 0,
        vy: 0,
      });
      return;
    }
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = Math.min(width, height) / 2.5;
    pos.set(n.key, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 });
  });

  const points = nodes.map((n) => pos.get(n.key)!);
  const reseed = seeded > nodes.length * 0.6;
  const iterations = reseed ? RESEED_ITERATIONS : FULL_ITERATIONS;
  // Шаг затухает от alpha к ALPHA_MIN: без этого раскладка на сотнях узлов не
  // сходится вообще — силы у стенок и в плотных скоплениях не гасятся
  // трением, и каждый следующий прогон уносил узлы в среднем на 900px, то
  // есть карта перетасовывалась целиком на каждое движение фильтра. Прогон от
  // готовых позиций начинается с малого шага: это доводка соседей нового
  // узла, а не право переложить весь мир.
  let alpha = reseed ? RESEED_ALPHA : 1;
  const decay = Math.pow(ALPHA_MIN / alpha, 1 / iterations);
  const cells = new Map<number, number[]>();
  const columns = Math.max(1, Math.ceil(width / REPULSION_CUTOFF)) + 2;

  const idealLength = 130;
  for (let iter = 0; iter < iterations; iter++) {
    // Сетка перестраивается каждый шаг — узлы за шаг успевают переехать.
    cells.clear();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const key = Math.floor(p.y / REPULSION_CUTOFF) * columns + Math.floor(p.x / REPULSION_CUTOFF);
      const bucket = cells.get(key);
      if (bucket) bucket.push(i);
      else cells.set(key, [i]);
    }
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const col = Math.floor(a.x / REPULSION_CUTOFF);
      const row = Math.floor(a.y / REPULSION_CUTOFF);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const bucket = cells.get((row + dr) * columns + (col + dc));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue; // пара считается один раз, силы симметричны
            const b = points[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            const distSq = dx * dx + dy * dy || 0.01;
            if (distSq > REPULSION_CUTOFF * REPULSION_CUTOFF) continue;
            const force = REPULSION_STRENGTH / distSq;
            const dist = Math.sqrt(distSq);
            dx = (dx / dist) * force;
            dy = (dy / dist) * force;
            a.vx += dx;
            a.vy += dy;
            b.vx -= dx;
            b.vy -= dy;
          }
        }
      }
    }
    for (const e of edges) {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) continue;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist - idealLength) * 0.02;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const n of nodes) {
      const p = pos.get(n.key)!;
      p.vx += (cx - p.x) * 0.002;
      p.vy += (cy - p.y) * 0.002;
      p.vx *= 0.85;
      p.vy *= 0.85;
      p.x += p.vx * alpha;
      p.y += p.vy * alpha;
      p.x = Math.max(30, Math.min(width - 30, p.x));
      p.y = Math.max(30, Math.min(height - 30, p.y));
    }
    alpha *= decay;
  }
  return pos;
}
