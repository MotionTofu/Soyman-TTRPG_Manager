export interface GraphNode {
  key: string;
  type: string;
  id: number;
  title: string;
}
export type EdgeKind =
  | "relation"
  | "membership"
  | "habitat"
  | "nesting"
  | "scene"
  | "mention"
  | "link";

export interface GraphEdge {
  from: string;
  to: string;
  section: string | null;
  tone: string | null;
  kind: EdgeKind;
}
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
  // Сущности области без единой связи в текущем срезе — на холст не
  // выкладываются, показываются списком (см. RelationGraph).
  isolated?: GraphNode[];
}

// Вид связи решает, как она выглядит и видна ли по умолчанию. Упоминания
// выключены: их больше всех (каждый текст, назвавший кого-то по имени, даёт
// ребро), и они хоронят под собой отношения и структуру.
export const EDGE_KINDS: {
  key: EdgeKind;
  label: string;
  defaultOn: boolean;
  width: number;
  dash?: string;
}[] = [
  { key: "relation", label: "Отношения", defaultOn: true, width: 2 },
  { key: "membership", label: "Членство", defaultOn: true, width: 1.5 },
  { key: "habitat", label: "Расположение", defaultOn: true, width: 1.5 },
  { key: "nesting", label: "Вложенность мест", defaultOn: true, width: 1, dash: "6 3" },
  { key: "scene", label: "Участие в сценах", defaultOn: true, width: 1, dash: "2 3" },
  { key: "link", label: "Ручные связи", defaultOn: true, width: 1 },
  { key: "mention", label: "Упоминания в тексте", defaultOn: false, width: 1, dash: "1 4" },
];

export const EDGE_KIND_STYLE = Object.fromEntries(
  EDGE_KINDS.map((k) => [k.key, k])
) as Record<EdgeKind, (typeof EDGE_KINDS)[number]>;

export const DEFAULT_EDGE_KINDS = new Set<EdgeKind>(
  EDGE_KINDS.filter((k) => k.defaultOn).map((k) => k.key)
);

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

/**
 * Кратчайшая цепочка между двумя узлами по видимым связям — ответ на вопрос
 * «а как этот вообще связан с той фракцией», на который ни поиск, ни вкладки
 * связей не отвечают. Обход в ширину: рёбра ненаправленные, потому что для
 * «как связаны» сторона связи значения не имеет.
 */
export function findPath(
  edges: GraphEdge[],
  from: string,
  to: string
): { keys: string[]; edges: GraphEdge[] } | null {
  if (from === to) return { keys: [from], edges: [] };
  const adjacency = new Map<string, { next: string; edge: GraphEdge }[]>();
  const add = (a: string, b: string, edge: GraphEdge) => {
    const list = adjacency.get(a);
    if (list) list.push({ next: b, edge });
    else adjacency.set(a, [{ next: b, edge }]);
  };
  for (const e of edges) {
    add(e.from, e.to, e);
    add(e.to, e.from, e);
  }
  const cameFrom = new Map<string, { prev: string; edge: GraphEdge }>();
  const seen = new Set([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: string[] = [];
    for (const key of frontier) {
      for (const step of adjacency.get(key) ?? []) {
        if (seen.has(step.next)) continue;
        seen.add(step.next);
        cameFrom.set(step.next, { prev: key, edge: step.edge });
        if (step.next === to) {
          const keys = [to];
          const path: GraphEdge[] = [];
          let cursor = to;
          while (cursor !== from) {
            const back = cameFrom.get(cursor)!;
            path.unshift(back.edge);
            cursor = back.prev;
            keys.unshift(cursor);
          }
          return { keys, edges: path };
        }
        next.push(step.next);
      }
    }
    frontier = next;
  }
  return null;
}

export type GroupMode = "none" | "community" | "location";

export const GROUP_MODES: { key: GroupMode; label: string }[] = [
  { key: "none", label: "Не группировать" },
  { key: "community", label: "По фракциям" },
  { key: "location", label: "По местам" },
];

export interface FoldedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Сколько узлов свёрнуто внутрь группы — подпись «+N» на её узле. */
  folded: Map<string, number>;
}

/**
 * Свернуть жителей в их группу. Сотни узлов читаются только пачками: существо,
 * у которого ровно одна фракция (или ровно одно место), прячется внутрь её
 * узла, а все его связи переезжают на группу. У кого фракций несколько или ни
 * одной — остаётся сам собой: сваливать его в произвольную из них значило бы
 * соврать. Развёрнутые группы (expanded) не сворачиваются — так можно раскрыть
 * одну и смотреть её состав, не разворачивая карту целиком.
 */
export function foldGroups(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: GroupMode,
  expanded: Set<string>
): FoldedGraph {
  if (mode === "none") return { nodes, edges, folded: new Map() };

  const groupType = mode === "community" ? "community" : "location";
  const groupKind: EdgeKind = mode === "community" ? "membership" : "habitat";
  const nodeKeys = new Set(nodes.map((n) => n.key));

  // Кандидат на сворачивание — узел, у которого ровно одна группа этого вида.
  const groupsOf = new Map<string, Set<string>>();
  for (const e of edges) {
    if (e.kind !== groupKind) continue;
    const [group, member] = e.from.startsWith(`${groupType}:`) ? [e.from, e.to] : [e.to, e.from];
    if (!group.startsWith(`${groupType}:`) || member.startsWith(`${groupType}:`)) continue;
    if (!nodeKeys.has(group) || !nodeKeys.has(member)) continue;
    const set = groupsOf.get(member) ?? new Set<string>();
    set.add(group);
    groupsOf.set(member, set);
  }

  const foldedInto = new Map<string, string>(); // узел -> группа, в которую он спрятан
  for (const [member, groups] of groupsOf) {
    if (groups.size !== 1) continue;
    const group = [...groups][0];
    if (expanded.has(group)) continue;
    foldedInto.set(member, group);
  }
  if (foldedInto.size === 0) return { nodes, edges, folded: new Map() };

  const folded = new Map<string, number>();
  for (const group of foldedInto.values()) folded.set(group, (folded.get(group) ?? 0) + 1);

  const resolve = (key: string) => foldedInto.get(key) ?? key;
  const keptNodes = nodes.filter((n) => !foldedInto.has(n.key));
  const seen = new Set<string>();
  const keptEdges: GraphEdge[] = [];
  for (const e of edges) {
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (from === to) continue; // связь внутри группы — она теперь один узел
    // Десять «обитает» от жителей одной фракции к одному городу — это одна
    // линия, а не десять поверх друг друга.
    const dedupe = `${from}|${to}|${e.kind}|${e.section ?? ""}|${e.tone ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    keptEdges.push({ ...e, from, to });
  }
  return { nodes: keptNodes, edges: keptEdges, folded };
}

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
  seed?: NodePositions,
  // Узлы, которые пользователь расставил руками: силы на них действуют, но с
  // места они не сходят — иначе своя раскладка расползлась бы на первом же
  // пересчёте.
  pinned?: Set<string>
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
      if (pinned?.has(n.key)) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
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
