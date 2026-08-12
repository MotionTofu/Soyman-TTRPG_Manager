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

// Simple force-directed layout: circular seed positions, then repulsion +
// spring edges + a gentle centering pull, run for a fixed number of
// iterations. Deterministic-ish and fast enough for the graph sizes this app
// deals with (dozens to a couple hundred nodes) — no need for a library.
export function simulateGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  width: number = GRAPH_WIDTH,
  height: number = GRAPH_HEIGHT
) {
  const pos = new Map<string, { x: number; y: number; vx: number; vy: number }>();
  const cx = width / 2;
  const cy = height / 2;
  nodes.forEach((n, i) => {
    const angle = (i / Math.max(1, nodes.length)) * Math.PI * 2;
    const r = Math.min(width, height) / 2.5;
    pos.set(n.key, { x: cx + Math.cos(angle) * r, y: cy + Math.sin(angle) * r, vx: 0, vy: 0 });
  });

  const idealLength = 130;
  for (let iter = 0; iter < 220; iter++) {
    for (let i = 0; i < nodes.length; i++) {
      const a = pos.get(nodes[i].key)!;
      for (let j = i + 1; j < nodes.length; j++) {
        const b = pos.get(nodes[j].key)!;
        let dx = a.x - b.x;
        let dy = a.y - b.y;
        let distSq = dx * dx + dy * dy || 0.01;
        const force = 4000 / distSq;
        const dist = Math.sqrt(distSq);
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        a.vx += dx;
        a.vy += dy;
        b.vx -= dx;
        b.vy -= dy;
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
      p.x += p.vx;
      p.y += p.vy;
      p.x = Math.max(30, Math.min(width - 30, p.x));
      p.y = Math.max(30, Math.min(height - 30, p.y));
    }
  }
  return pos;
}
