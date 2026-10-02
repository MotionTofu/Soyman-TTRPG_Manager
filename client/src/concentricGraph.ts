import { GRAPH_HEIGHT, GRAPH_WIDTH, TYPE_LABELS, type GraphNode, type NodePositions } from "./graphTypes";

// Постоянный порядок: включение фильтров не меняет порядок оставшихся видов.
const TYPE_ORDER = [
  "character", "being", "location", "community", "artifact", "compendium_entry",
  "resource", "mastering", "player", "setting", "scene", "adventure", "session", "campaign",
];
const collator = new Intl.Collator("ru", { numeric: true, sensitivity: "base" });
const GAP = 24;

export interface GraphRing {
  type: string;
  label: string;
  radius: number;
  keys: string[];
}

export interface ConcentricLayout {
  positions: NodePositions;
  rings: GraphRing[];
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

/** Диск с запасом под горизонтальную карточку и её рамку выделения. */
function nodeRadius(node: GraphNode, scale: number, foldedCount: number) {
  const titleWidth = node.title.length * 6.6;
  const chipWidth = Math.max(48, (Math.min(titleWidth, 180) + 10 * scale + 16) * scale);
  const overflow = (foldedCount ? ` +${foldedCount}`.length * 6.6 : 0) * scale;
  return Math.hypot(chipWidth / 2 + overflow + 6, 11 * scale + 6);
}

/** Без силовой симуляции. По часовой стрелке, начало после подписи сверху. */
export function concentricLayout(
  nodes: GraphNode[],
  scales: Map<string, number> = new Map(),
  folded: Map<string, number> = new Map(),
): ConcentricLayout {
  const groups = new Map<string, GraphNode[]>();
  for (const node of nodes) {
    const group = groups.get(node.type) ?? [];
    group.push(node);
    groups.set(node.type, group);
  }
  const types = [...groups.keys()].sort((a, b) => {
    const ai = TYPE_ORDER.indexOf(a), bi = TYPE_ORDER.indexOf(b);
    return (ai < 0 ? TYPE_ORDER.length : ai) - (bi < 0 ? TYPE_ORDER.length : bi) || collator.compare(a, b);
  });
  const positions: NodePositions = new Map();
  const rings: GraphRing[] = [];
  let radius = 0, previousBound = 0;
  for (const type of types) {
    const group = groups.get(type)!;
    group.sort((a, b) => collator.compare(a.title, b.title) || a.key.localeCompare(b.key));
    const bounds = group.map(n => Math.max(40, nodeRadius(n, scales.get(n.key) ?? 1, folded.get(n.key) ?? 0)));
    let offset = 0;
    while (offset < group.length) {
      const previousRadius = radius;
      let bound = 0, count = 0, totalHalfAngle = 0;
      while (offset + count < group.length) {
        const nextBound = Math.max(bound, bounds[offset + count]);
        const nextRadius = Math.max(200, previousRadius + previousBound + nextBound + GAP, 2 * nextBound + GAP);
        // Большая карточка занимает больше дуги. Она не заставляет все
        // остальные карточки этого вида оставлять такой же большой зазор.
        let nextTotal = totalHalfAngle + Math.asin((bounds[offset + count] + GAP / 2) / nextRadius);
        if (!count || nextRadius !== radius) {
          nextTotal = Math.asin(70 / nextRadius);
          for (let i = offset; i <= offset + count; i++) nextTotal += Math.asin((bounds[i] + GAP / 2) / nextRadius);
        }
        if (count && nextTotal > Math.PI) break;
        bound = nextBound; radius = nextRadius; totalHalfAngle = nextTotal; count++;
      }
      const members = group.slice(offset, offset + count);
      const halfAngles = bounds.slice(offset, offset + count).map(b => Math.asin((b + GAP / 2) / radius));
      const labelHalfAngle = Math.asin(70 / radius);
      const spare = (2 * Math.PI - 2 * labelHalfAngle - 2 * halfAngles.reduce((sum, a) => sum + a, 0)) / (count + 1);
      let angle = -Math.PI / 2 + labelHalfAngle + spare;
      members.forEach((node, i) => {
        angle += halfAngles[i];
        positions.set(node.key, { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius, vx: 0, vy: 0 });
        angle += halfAngles[i] + spare;
      });
      rings.push({ type, label: TYPE_LABELS[type] ?? type, radius, keys: members.map(n => n.key) });
      offset += count;
      previousBound = bound;
    }
  }
  const extent = radius + previousBound + 80;
  const width = Math.max(GRAPH_WIDTH, extent * 2), height = Math.max(GRAPH_HEIGHT, extent * 2);
  const centerX = width / 2, centerY = height / 2;
  for (const pos of positions.values()) { pos.x += centerX; pos.y += centerY; }
  return { positions, rings, width, height, centerX, centerY };
}
