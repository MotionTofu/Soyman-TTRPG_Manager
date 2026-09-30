export interface GraphNode {
  key: string;
  type: string;
  id: number;
  title: string;
  // Ярусная раскладка графа приключений — заполняет сервер.
  date?: string;
  campaign_id?: number;
  planned?: boolean;
  position?: number;
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
  { key: "relation", label: "Отношения", defaultOn: true, width: 1 },
  { key: "membership", label: "Членство", defaultOn: true, width: 1 },
  { key: "habitat", label: "Расположение", defaultOn: true, width: 1 },
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

// Два графа вместо одного (решения 2026-09-12, п. 1): набор видов рёбер у
// каждого свой. В фильтрах показываются только виды данного графа.
export type GraphView = "world" | "adventures";
export const GRAPH_VIEW_EDGE_KINDS: Record<GraphView, EdgeKind[]> = {
  world: ["relation", "membership", "habitat", "nesting", "mention"],
  adventures: ["scene", "link", "mention"],
};

// Типы, скрытые по умолчанию в каждом графе (решения 2026-09-30, Q1): в графе
// мира сюжет засоряет «кто с кем», в графе приключений сюжет и есть основа —
// скрыта только кампания, она одна на весь выбранный охват.
export const GRAPH_VIEW_HIDDEN_TYPES: Record<GraphView, string[]> = {
  world: ["scene", "adventure", "campaign", "session"],
  adventures: ["campaign"],
};

// Размер узла (решения 2026-09-30, Q2): «по типу» — сюжет крупнее мира,
// «по связям» — узел растёт с числом видимых рёбер. Ручной «Изменить размер»
// множится поверх.
export type NodeSizeMode = "type" | "links";
export const GRAPH_VIEW_SIZE_MODE: Record<GraphView, NodeSizeMode> = { world: "links", adventures: "type" };
const TYPE_SIZE: Record<string, number> = { campaign: 1.9, adventure: 1.6, session: 1.3, scene: 1.2 };

export function autoNodeScales(nodes: GraphNode[], edges: GraphEdge[], mode: NodeSizeMode): Map<string, number> {
  const scales = new Map<string, number>();
  if (mode === "type") {
    for (const n of nodes) scales.set(n.key, TYPE_SIZE[n.type] ?? 1);
    return scales;
  }
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
    degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
  }
  // Корень, а не прямая: узел на 40 связях не должен быть в 40 раз больше.
  for (const n of nodes) scales.set(n.key, Math.min(2, 0.9 + Math.sqrt(degree.get(n.key) ?? 0) * 0.15));
  return scales;
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
  mastering: "Библиотека",
  scene: "Сцены",
  adventure: "Приключения",
  session: "Сессии",
  compendium_entry: "Компендиум",
};

// 1a-fix: палитра различима для дейтера/протана (Okabe-Ito + Tol), s 45-58% l 58-72%
// вместо s<10 l82. Бюджет акцента держится формой (§1.7) + одна пастель на тип,
// а не «радуга насыщенных». Проверено: при дейтеранопии 8 из 13 остаются различны,
// включая campaign vs setting vs adventure vs location (проверяй симулятором).
// Источник: ColorBrewer/Okabe-Ito colorblind-safe set, осветлено на 10-15% от оригинала.
export const TYPE_COLORS: Record<string, string> = {
  campaign: "#56B4E9",      // sky blue — мета
  setting: "#F0E442",       // yellow — мета (светлая, но distinct)
  player: "#009E73",        // bluish green — люди
  character: "#0072B2",     // blue — люди (персонажи)
  location: "#E69F00",      // orange — места
  being: "#D55E00",         // vermillion — существа (тёплый, отличен от orange при дейт.)
  community: "#CC79A7",     // reddish purple — сообщества (отличен от vermillion)
  artifact: "#999933",      // olive — предметы
  resource: "#88CCEE",      // cyan — предметы (светлее, отличен от sky)
  mastering: "#B3B3B3",     // gray — мастерение
  scene: "#AA4499",         // purple — сюжет
  adventure: "#332288",     // dark blue-purple — приключения (тёмный, отличен от purple)
  session: "#6A3D9A",       // dark purple — сессии (среднее между purple и dark blue-purple)
  compendium_entry: "#44AA99", // teal — компендиум
};

// Форма кодирует тип первично (§1.7) — цвет только помогает.
// Прямые углы, без радиусов (§1.1).
// triangle=сообщества upright, triangleInverted=существа, triangleRight=персонажи (запрос «смотрит вправо»), diamond=места, star=артефакты, rect=остальное.
export type GraphNodeShape = "rect" | "diamond" | "triangle" | "triangleInverted" | "triangleRight" | "star";
export const TYPE_SHAPES: Record<string, GraphNodeShape> = {
  campaign: "rect",
  setting: "rect",
  player: "triangleRight",
  character: "triangleRight",
  location: "diamond",
  being: "triangleInverted",
  community: "triangle",
  artifact: "star",
  resource: "rect",
  mastering: "rect",
  scene: "rect",
  adventure: "rect",
  session: "rect",
  compendium_entry: "rect",
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
  resource: "/resources",
  mastering: "/mastering",
  scene: "/scenes",
  adventure: "/adventures",
  session: "/sessions",
  compendium_entry: "/compendium",
};

// «Показать в графе» с карточки ведёт в тот граф, где живёт тип (п. 5 задания).
// Существо, персонаж, сообщество, локация, артефакт → мир. Сцена, приключение,
// сессия, кампания → приключения.
export const TYPE_GRAPH_VIEW: Record<string, GraphView> = {
  being: "world",
  location: "world",
  community: "world",
  artifact: "world",
  character: "world",
  scene: "adventures",
  adventure: "adventures",
  session: "adventures",
  campaign: "adventures",
};

/**
 * Кратчайшая цепочка между двумя узлами по видимым связям — ответ на вопрос
 * «а как этот вообще связан с той фракцией», на который ни поиск, ни вкладки
 * связей не отвечают. Обход в ширину: рёбра ненаправленные, потому что для
 * «как связаны» сторона связи значения не имеет.
 *
 * @returns Массив узлов и рёбер на пути, или null если:
 *   - from === to (один и тот же узел)
 *   - from или to не существуют в графе
 *   - пути между узлами не существует
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

export interface IsolationView {
  nodes: GraphNode[];
  edges: GraphEdge[];
  positions: NodePositions;
  width: number;
  height: number;
  depthOf: Map<string, number>;
  /** Сколько узлов добавит следующий шаг — чтобы не жать кнопку вслепую. */
  nextStepCount: number;
}

const RING_GAP = 240; // расстояние между кольцами
const RING_NODE_SPACING = 84; // сколько места нужно узлу с подписью на кольце

// 5c: общий BFS-хелпер — зеркало серверного BFS в links.ts:285 (focus depth).
// Сервер — источник истины для ?focus&depth=, клиент — для изоляции; логика одна.
export function buildAdjacency(edges: GraphEdge[]): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  const touch = (a: string, b: string) => {
    const s = adj.get(a);
    if (s) s.add(b);
    else adj.set(a, new Set([b]));
  };
  for (const e of edges) { touch(e.from, e.to); touch(e.to, e.from); }
  return adj;
}

/**
 * Изоляция узла: он в центре, связанные с ним — первым кольцом, связанные с
 * теми — вторым. Силовая раскладка для окрестности хуже: она разбрасывает
 * соседей вперемешку, а здесь номер кольца прямо и означает «сколько шагов
 * отсюда», что и есть вопрос, ради которого узел изолируют.
 */
export function buildIsolation(
  nodes: GraphNode[],
  edges: GraphEdge[],
  centerKey: string,
  depth: number
): IsolationView | null {
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  if (!byKey.has(centerKey)) return null;

  const adjacency = buildAdjacency(edges);

  // Обход в ширину: кольцо = расстояние в шагах. Лишний шаг считается тоже —
  // им подписывается кнопка «добавить шаг».
  const depthOf = new Map<string, number>([[centerKey, 0]]);
  const rings: string[][] = [[centerKey]];
  for (let d = 1; d <= depth + 1; d++) {
    const ring: string[] = [];
    for (const key of rings[d - 1]) {
      for (const other of adjacency.get(key) ?? []) {
        if (depthOf.has(other) || !byKey.has(other)) continue;
        depthOf.set(other, d);
        ring.push(other);
      }
    }
    rings.push(ring);
  }
  const nextStepCount = rings[depth + 1]?.length ?? 0;
  for (const key of rings[depth + 1] ?? []) depthOf.delete(key); // этот шаг ещё не показываем
  rings.length = depth + 1;

  const angles = new Map<string, number>([[centerKey, 0]]);
  const radii = new Map<number, number>([[0, 0]]);
  for (let d = 1; d < rings.length; d++) {
    const ring = rings[d];
    if (ring.length === 0) continue;
    // Кольцо раздвигается, если на нём тесно: узлам нужно место под подписи.
    const radius = Math.max(RING_GAP * d, (ring.length * RING_NODE_SPACING) / (2 * Math.PI));
    radii.set(d, radius);
    // Соседи одного родителя должны лежать рядом: порядок на кольце — по углу
    // родителя, иначе связи превращаются в клубок хорд через весь круг.
    const parentAngle = (key: string) => {
      let sum = 0;
      let count = 0;
      for (const other of adjacency.get(key) ?? []) {
        if (depthOf.get(other) === d - 1 && angles.has(other)) {
          sum += angles.get(other)!;
          count++;
        }
      }
      return count > 0 ? sum / count : 0;
    };
    const ordered = ring
      .map((key) => ({ key, hint: parentAngle(key) }))
      .sort((a, b) => a.hint - b.hint || a.key.localeCompare(b.key));
    ordered.forEach((item, i) => {
      angles.set(item.key, (i / ordered.length) * Math.PI * 2);
    });
  }

  const maxRadius = Math.max(...radii.values());
  const width = Math.round((maxRadius + ISOLATION_MARGIN_H) * 2);
  const height = Math.round((maxRadius + ISOLATION_MARGIN_V) * 2);
  const positions: NodePositions = new Map();
  for (const [key, d] of depthOf) {
    const radius = radii.get(d) ?? 0;
    const angle = angles.get(key) ?? 0;
    positions.set(key, {
      x: width / 2 + Math.cos(angle) * radius,
      y: height / 2 + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
    });
  }

  const keptNodes = nodes.filter((n) => depthOf.has(n.key));
  const keptEdges = edges.filter((e) => depthOf.has(e.from) && depthOf.has(e.to));
  return { nodes: keptNodes, edges: keptEdges, positions, width, height, depthOf, nextStepCount };
}

export interface FoldedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Сколько узлов свёрнуто внутрь группы — подпись «+N» на её узле. */
  folded: Map<string, number>;
}

// Сцены сворачиваются в своё приключение, главы — в родительское (решения
// 2026-09-30, Q3): узел остаётся видимым, только если его владелец раскрыт.
// Рёбра свёрнутых переходят на того, в кого они свёрнуты. Набрано и сыграно
// на одной паре — одно «сыграно» (Q7).
const OWNER_SECTIONS = new Set(["сцена приключения", "глава приключения"]);

/** Приключения, в которые свёрнут узел: владелец, его родитель и выше. */
export function adventureOwners(edges: GraphEdge[], key: string): string[] {
  const owner = new Map<string, string>();
  for (const e of edges) if (e.section && OWNER_SECTIONS.has(e.section)) owner.set(e.from, e.to);
  const chain: string[] = [];
  for (let k = owner.get(key); k && chain.length < 20 && !chain.includes(k); k = owner.get(k)) chain.push(k);
  return chain;
}

export function foldAdventures(nodes: GraphNode[], edges: GraphEdge[], expanded: Set<string>): FoldedGraph {
  const nodeKeys = new Set(nodes.map((n) => n.key));
  const owner = new Map<string, string>(); // сцена/глава -> приключение
  for (const e of edges) {
    if (e.section && OWNER_SECTIONS.has(e.section) && nodeKeys.has(e.from) && nodeKeys.has(e.to)) owner.set(e.from, e.to);
  }
  if (owner.size === 0) return { nodes, edges, folded: new Map() };

  const cache = new Map<string, string>();
  const resolve = (key: string, depth = 0): string => {
    const hit = cache.get(key);
    if (hit) return hit;
    const o = owner.get(key);
    // depth — страховка от цикла в parent_id.
    const r = o && !expanded.has(o) && depth < 20 ? resolve(o, depth + 1) : key;
    cache.set(key, r);
    return r;
  };

  const folded = new Map<string, number>();
  const keptNodes: GraphNode[] = [];
  for (const n of nodes) {
    const r = resolve(n.key);
    if (r === n.key) keptNodes.push(n);
    else folded.set(r, (folded.get(r) ?? 0) + 1);
  }

  const seen = new Set<string>();
  const kept: GraphEdge[] = [];
  for (const e of edges) {
    const from = resolve(e.from);
    const to = resolve(e.to);
    if (from === to) continue;
    const dedupe = `${from}|${to}|${e.kind}|${e.section ?? ""}|${e.tone ?? ""}`;
    if (seen.has(dedupe)) continue;
    seen.add(dedupe);
    kept.push({ ...e, from, to });
  }
  const played = new Set(kept.filter((e) => e.section === "сыграно").map((e) => `${e.from}|${e.to}`));
  const keptEdges = kept.filter((e) => !(e.section === "набрано" && played.has(`${e.from}|${e.to}`)));
  return { nodes: keptNodes, edges: keptEdges, folded };
}

// Ярусная раскладка графа приключений (решения 2026-09-30, Q4–Q5): сверху
// лента сессий по дате (полоса на кампанию), посередине приключения — по
// первой сыгравшей их сессии, несыгранные в конце по position; внизу мир,
// каждая сущность под средним x тех, с кем связана, в несколько рядов.
const STORY_TIER = new Set(["campaign", "adventure", "scene"]);
const LAYER_PAD = 60;
const LAYER_GAP = 16;
const BAND_INSET = 18; // узел не наезжает на линию полосы
const ROW_H = 36;
const SPARE_ROWS = 2; // запас полосы под ручное перетаскивание

function chipWidth(n: GraphNode, scale: number): number {
  return Math.max(48, (Math.min(n.title.length * 6.6, 180) + 26) * scale);
}

export interface LayeredLayout {
  positions: NodePositions;
  width: number;
  height: number;
  /** x последней проведённой сессии — отсюда граф открывается. */
  anchorX: number;
  /** Полосы ярусов: сессии, сюжет, мир — в их пределах узел ходит по y. */
  bands: LayerBand[];
}

export interface LayerBand { label: string; top: number; bottom: number }

/** Ярус узла: 0 — сессии, 1 — сюжет, 2 — мир. */
export function layerOf(type: string): number {
  return type === "session" ? 0 : STORY_TIER.has(type) ? 1 : 2;
}

/** y узла в ярусной раскладке: сессии держат ленту, остальные — в своей полосе. */
export function clampToBand(bands: LayerBand[], type: string, layoutY: number, y: number): number {
  const layer = layerOf(type);
  if (layer === 0) return layoutY;
  const b = bands[layer];
  return Math.min(b.bottom - BAND_INSET, Math.max(b.top + BAND_INSET, y));
}

export function layeredLayout(nodes: GraphNode[], edges: GraphEdge[], scales: Map<string, number>): LayeredLayout {
  const positions: NodePositions = new Map();
  const put = (key: string, x: number, y: number) => positions.set(key, { x, y, vx: 0, vy: 0 });
  const scale = (n: GraphNode) => scales.get(n.key) ?? 1;
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    (neighbours.get(e.from) ?? neighbours.set(e.from, []).get(e.from)!).push(e.to);
    (neighbours.get(e.to) ?? neighbours.set(e.to, []).get(e.to)!).push(e.from);
  }

  // Сессии: одна временная ось на все полосы — кампании выровнены по датам.
  const sessions = nodes.filter((n) => n.type === "session")
    .sort((a, b) => (a.date ?? "").localeCompare(b.date ?? "") || a.id - b.id);
  const lanes = [...new Set(sessions.map((n) => n.campaign_id ?? 0))];
  const laneH = 22 * Math.max(1, ...sessions.map(scale)) + 18;
  const sessionIndex = new Map<string, number>();
  let cursor = LAYER_PAD;
  sessions.forEach((n, i) => {
    const w = chipWidth(n, scale(n));
    put(n.key, cursor + w / 2, LAYER_PAD + lanes.indexOf(n.campaign_id ?? 0) * laneH);
    sessionIndex.set(n.key, i);
    cursor += w + LAYER_GAP;
  });
  let right = cursor;

  // Сюжет: по первой сыгравшей сессии, несыгранные — по position.
  const firstPlayed = new Map<string, number>();
  for (const e of edges) {
    if (e.section !== "сыграно") continue;
    const [s, other] = sessionIndex.has(e.from) ? [e.from, e.to] : [e.to, e.from];
    const i = sessionIndex.get(s);
    if (i === undefined) continue;
    firstPlayed.set(other, Math.min(firstPlayed.get(other) ?? Infinity, i));
  }
  const story = nodes.filter((n) => STORY_TIER.has(n.type)).sort((a, b) =>
    (firstPlayed.get(a.key) ?? Infinity) - (firstPlayed.get(b.key) ?? Infinity)
    || (a.type === "campaign" ? -1 : b.type === "campaign" ? 1 : 0)
    || (a.position ?? Infinity) - (b.position ?? Infinity)
    || a.title.localeCompare(b.title));
  const storyH = 22 * Math.max(1, ...story.map(scale));
  const storyTop = LAYER_PAD + (lanes.length - 1) * laneH + laneH / 2 + 35;
  const storyY = storyTop + 35 + storyH / 2;
  const storyBottom = storyY + storyH / 2 + SPARE_ROWS * ROW_H + 20;
  cursor = LAYER_PAD;
  for (const n of story) {
    const w = chipWidth(n, scale(n));
    const first = firstPlayed.get(n.key);
    const under = first === undefined ? -Infinity : positions.get(sessions[first].key)!.x - w / 2;
    const left = Math.max(cursor, under);
    put(n.key, left + w / 2, storyY);
    cursor = left + w + LAYER_GAP;
  }
  right = Math.max(right, cursor, 1200);

  // Мир: под средним x уже расставленных соседей, жадно по рядам.
  const world = nodes.filter((n) => !positions.has(n.key)).map((n) => {
    const xs = (neighbours.get(n.key) ?? []).map((k) => positions.get(k)?.x).filter((x): x is number => x !== undefined);
    // Без сюжетных соседей — NaN: такие встают в конец самого короткого ряда.
    return { n, w: chipWidth(n, scale(n)), target: xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN };
  }).sort((a, b) => (Number.isNaN(a.target) ? 1 : 0) - (Number.isNaN(b.target) ? 1 : 0) || (a.target - b.target || 0));
  const totalW = world.reduce((sum, c) => sum + c.w + LAYER_GAP, 0);
  const rowCount = Math.max(3, Math.ceil((totalW / right) * 1.5));
  const rowEnds = new Array<number>(rowCount).fill(LAYER_PAD);
  const rowH = ROW_H;
  const worldY = storyBottom + 45;
  let usedRows = 0;
  for (const c of world) {
    const shortest = rowEnds.indexOf(Math.min(...rowEnds));
    const want = Number.isNaN(c.target) ? rowEnds[shortest] : c.target - c.w / 2;
    let row = Number.isNaN(c.target) ? shortest : rowEnds.findIndex((end) => Math.max(end, want) - want <= 120);
    if (row < 0) row = shortest;
    const left = Math.max(rowEnds[row], want, LAYER_PAD);
    put(c.n.key, left + c.w / 2, worldY + row * rowH);
    rowEnds[row] = left + c.w + LAYER_GAP;
    usedRows = Math.max(usedRows, row + 1);
    right = Math.max(right, rowEnds[row]);
  }

  const lastHeld = [...sessions].reverse().find((n) => !n.planned);
  const anchorX = lastHeld ? positions.get(lastHeld.key)!.x : 0;
  // Снизу запас больше: нижние ряды — те, что хочется приблизить, а не упирать в край.
  const worldBottom = worldY + (Math.max(1, usedRows) - 0.5 + SPARE_ROWS) * rowH;
  const bands: LayerBand[] = [
    { label: "Сессии", top: 0, bottom: storyTop },
    { label: "Приключения", top: storyTop, bottom: storyBottom },
    { label: "Мир", top: storyBottom, bottom: worldBottom },
  ];
  return { positions, width: right + LAYER_PAD, height: worldBottom + LAYER_PAD * 2, anchorX, bands };
}

export const GRAPH_WIDTH = 900;
export const GRAPH_HEIGHT = 640;
const BASE_NODE_COUNT = 25; // node count the base 900x640 canvas is comfortable for

// Canvas edge padding — nodes clamp to this distance from the canvas boundary.
export const CANVAS_EDGE_PADDING = 30;
// Layout padding — used when fitting seed positions into a smaller canvas.
export const CANVAS_LAYOUT_PADDING = 60;
// Isolation view margins — extra space around the radial layout for labels.
export const ISOLATION_MARGIN_H = 220;
export const ISOLATION_MARGIN_V = 160;
// Packing density coefficient — how tightly nodes can be packed (0..1).
export const PACKING_DENSITY = 0.87;
// Friction — velocity damping factor per iteration (0..1).
export const FRICTION = 0.85;
// Spring force multiplier — how strongly edges pull nodes together.
export const SPRING_FORCE = 0.02;

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
// Силы подобраны так, чтобы равновесие само было разреженным. Со старыми
// (4000, пружина 130, стягивание 0.002) узлы сходились плотнее минимального
// промежутка, расталкивание раздвигало их обратно, а следующий пересчёт снова
// стягивал — карта каждый раз перетасовывалась. Дешевле сразу целиться в
// расстояние, которое всё равно придётся выдержать.
const REPULSION_STRENGTH = 9000;
const IDEAL_EDGE_LENGTH = 175;
const CENTERING_PULL = 0.0012;
// Ближе этого узлы не ставятся. Отталкивание само по себе такого не
// гарантирует: пружины связей и стягивание к центру продавливают его в плотных
// местах, и подписи наезжают друг на друга. Держится отдельным проходом
// расталкивания — жёстким ограничением, а не ещё одной силой.
export const MIN_NODE_DISTANCE = 100;
const SEPARATION_PASSES = 300;
// Разводить пару ровно на нехватку — сходиться будет вечно: соседи тут же
// наезжают обратно. Небольшой перелёт (как в методе верхней релаксации)
// сокращает число проходов в разы.
const SEPARATION_OVERSHOOT = 1.35;
// Проходы прекращаются, когда худшее сближение уложилось в этот допуск: гнаться
// за последними процентами не стоит, глазу разница между 96 и 100 не видна, а
// проходов на неё уходит больше, чем на всё остальное.
const SEPARATION_TOLERANCE = 5;
const FULL_ITERATIONS = 220;
// Раскладка от готовых позиций — это доводка, а не построение с нуля: столько
// шагов хватает, чтобы новые узлы нашли место, а мир не перетасовался.
const RESEED_ITERATIONS = 70;
const ALPHA_MIN = 0.02;
// Доводка от готовых позиций идёт очень малым шагом: карта уже разложена и
// разведена по минимальному расстоянию, силовой фазе остаётся только пристроить
// появившиеся узлы. С прежним 0.25 она успевала стянуть всю картинку к центру,
// расталкивание разводило её обратно — и узлы уезжали в среднем на три сотни
// пикселей на каждой смене фильтра.
const RESEED_ALPHA = 0.06;

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

  // Холст меняет размер вместе с числом узлов, и позиции с прошлого прогона
  // могут в новый не поместиться. Обрезать их по краю нельзя: узлы сбиваются в
  // полосу вдоль границы, и расталкивание потом разбирает эту кучу вместо
  // того, чтобы просто выдержать промежуток. Карта переносится целиком —
  // сжимается под новый лист, сохраняя взаимное расположение.
  const fit = (() => {
    if (!seed || seed.size === 0) return null;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const n of nodes) {
      const p = seed.get(n.key);
      if (!p) continue;
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    if (minX > maxX) return null;
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    const scale = Math.min(1, (width - CANVAS_LAYOUT_PADDING) / boxW, (height - CANVAS_LAYOUT_PADDING) / boxH);
    if (scale > 0.999) return null;
    return { scale, midX: (minX + maxX) / 2, midY: (minY + maxY) / 2 };
  })();

  let seeded = 0;
  nodes.forEach((n, i) => {
    const known = seed?.get(n.key);
    if (known) {
      seeded++;
      const x = fit ? cx + (known.x - fit.midX) * fit.scale : known.x;
      const y = fit ? cy + (known.y - fit.midY) * fit.scale : known.y;
      pos.set(n.key, {
        x: Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, x)),
        y: Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, y)),
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
  // На доводке силы двигают только новые узлы: у остальных место уже найдено и
  // разведено по минимальному расстоянию, и любое их шевеление — это
  // перетасовка карты на ровном месте. Расталкивание ниже работает со всеми:
  // новичок, вставший вплотную к старожилу, должен подвинуть и его.
  const forcePinned =
    reseed && seed
      ? new Set([...(pinned ?? []), ...nodes.filter((n) => seed.has(n.key)).map((n) => n.key)])
      : pinned;
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

  const idealLength = IDEAL_EDGE_LENGTH;
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
      const force = (dist - idealLength) * SPRING_FORCE;
      const fx = (dx / dist) * force;
      const fy = (dy / dist) * force;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const n of nodes) {
      const p = pos.get(n.key)!;
      if (forcePinned?.has(n.key)) {
        p.vx = 0;
        p.vy = 0;
        continue;
      }
      p.vx += (cx - p.x) * CENTERING_PULL;
      p.vy += (cy - p.y) * CENTERING_PULL;
      p.vx *= FRICTION;
      p.vy *= FRICTION;
      p.x += p.vx * alpha;
      p.y += p.vy * alpha;
      p.x = Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, p.x));
      p.y = Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, p.y));
    }
    alpha *= decay;
    if (alpha < ALPHA_MIN) break;
  }

  const isPinned = nodes.map((n) => pinned?.has(n.key) ?? false);
  // Разводятся узлы с запасом на допуск, с которым проходы останавливаются, —
  // иначе объявленная сотня превращалась бы в «сотня минус допуск».
  const separationTarget = MIN_NODE_DISTANCE + SEPARATION_TOLERANCE;

  // Прежде чем расталкивать — разредить. Силовая раскладка сбивает узлы в
  // центр холста: на 657 узлах они занимали 2400x1850 из 4600x3280, то есть
  // впятеро меньше площади, чем нужно на промежуток в 100. Локальное
  // расталкивание в такой тесноте не сходится — оно умеет двигать соседа на
  // шаг, а не переносить узлы через полкарты. Поэтому картинка сначала
  // растягивается целиком относительно своего центра: форма сохраняется,
  // место появляется. Если узлы расставлены руками, растяжка пропускается —
  // это чужая карта, её нельзя двигать.
  if (!pinned?.size && points.length > 1) {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const p of points) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
    const boxW = Math.max(1, maxX - minX);
    const boxH = Math.max(1, maxY - minY);
    // Площадь на узел при плотной укладке кружков с шагом MIN_NODE_DISTANCE.
    const needed = points.length * MIN_NODE_DISTANCE * MIN_NODE_DISTANCE * PACKING_DENSITY;
    const fits = Math.min((width - CANVAS_LAYOUT_PADDING) / boxW, (height - CANVAS_LAYOUT_PADDING) / boxH);
    const scale = Math.min(Math.sqrt(needed / (boxW * boxH)), fits);
    if (scale > 1.01) {
      const midX = (minX + maxX) / 2;
      const midY = (minY + maxY) / 2;
      for (const p of points) {
        p.x = Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, cx + (p.x - midX) * scale));
        p.y = Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, cy + (p.y - midY) * scale));
      }
    }
  }

  // Расталкивание: силы дают приятную форму, но не гарантируют промежутка —
  // в плотных местах пружины и стягивание к центру сводят узлы вплотную. Тут
  // пары, оказавшиеся ближе минимума, просто разводятся на нужное расстояние.
  // Несколько проходов: разведя одну пару, можно наехать на соседнюю.
  const sepColumns = Math.max(1, Math.ceil(width / MIN_NODE_DISTANCE)) + 2;
  for (let pass = 0; pass < SEPARATION_PASSES; pass++) {
    cells.clear();
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      const key =
        Math.floor(p.y / MIN_NODE_DISTANCE) * sepColumns + Math.floor(p.x / MIN_NODE_DISTANCE);
      const bucket = cells.get(key);
      if (bucket) bucket.push(i);
      else cells.set(key, [i]);
    }
    let worstOverlap = 0;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const col = Math.floor(a.x / MIN_NODE_DISTANCE);
      const row = Math.floor(a.y / MIN_NODE_DISTANCE);
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          const bucket = cells.get((row + dr) * sepColumns + (col + dc));
          if (!bucket) continue;
          for (const j of bucket) {
            if (j <= i) continue;
            if (isPinned[i] && isPinned[j]) continue; // оба стоят там, где их поставили
            const b = points[j];
            let dx = a.x - b.x;
            let dy = a.y - b.y;
            let dist = Math.sqrt(dx * dx + dy * dy);
            if (dist >= separationTarget) continue;
            if (dist < 0.01) {
              // Совпали точь-в-точь: направление берётся от индексов, чтобы
              // раскладка осталась воспроизводимой, а не случайной.
              dx = (i % 2 === 0 ? 1 : -1) * 0.5;
              dy = (j % 2 === 0 ? 1 : -1) * 0.5;
              dist = Math.sqrt(dx * dx + dy * dy);
            }
            const push = separationTarget - dist;
            worstOverlap = Math.max(worstOverlap, push);
            const ux = (dx / dist) * push * SEPARATION_OVERSHOOT;
            const uy = (dy / dist) * push * SEPARATION_OVERSHOOT;
            // Закреплённый узел не двигается — весь промежуток отыгрывает
            // второй.
            const aShare = isPinned[i] ? 0 : isPinned[j] ? 1 : 0.5;
            const bShare = 1 - aShare;
            a.x = Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, a.x + ux * aShare));
            a.y = Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, a.y + uy * aShare));
            b.x = Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, b.x - ux * bShare));
            b.y = Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, b.y - uy * bShare));
          }
        }
      }
    }
    if (worstOverlap <= SEPARATION_TOLERANCE) break;
  }
  return pos;
}
