import { isEntityKind } from "./data/entities";
import type { EntityRef } from "./pageMenu";

export function canvasEntity(key: string, name: string): EntityRef | null {
  const [kind, rawId] = key.split(":");
  const type = kind === "chapter" ? "adventure" : kind;
  const id = Number(rawId);
  return isEntityKind(type) && id > 0 ? { type, id, name } : null;
}

export interface CanvasRouteDrop {
  from_key: string;
  to_key: string;
  kind: string;
  role: string;
}

/** Нити и улики не поддерживают разрыв маршрутом; смысл исходного ребра сохраняется. */
export function canvasRouteForEdge(kind: string, source: string, target: string, role = ""): CanvasRouteDrop | null {
  const routeKind = kind === "story"
    ? source.startsWith("adventure:") && target.startsWith("adventure:") ? "arc-transition" : "transition"
    : kind;
  if (!["transition", "arc-transition", "cast", "member", "outcome"].includes(routeKind)) return null;
  return { from_key: source, to_key: target, kind: routeKind, role };
}

/** Близость ко всей связи, включая сгруппированные узлы, а не только к её середине. */
export function canvasRouteAt(
  point: { x: number; y: number },
  edges: readonly { source: string; target: string; data?: Record<string, unknown> }[],
  boxes: ReadonlyMap<string, { x: number; y: number; w: number; h: number }>,
  maxDistance: number,
): CanvasRouteDrop | null {
  let best: CanvasRouteDrop | null = null;
  let distance = maxDistance;
  for (const edge of edges) {
    const route = edge.data?.canvasRoute as CanvasRouteDrop | null | undefined;
    const from = boxes.get(edge.source), to = boxes.get(edge.target);
    if (!route || !from || !to) continue;
    const ax = from.x + from.w, ay = from.y + from.h / 2;
    const bx = to.x, by = to.y + to.h / 2;
    const dx = bx - ax, dy = by - ay;
    const t = Math.max(0, Math.min(1, ((point.x - ax) * dx + (point.y - ay) * dy) / (dx * dx + dy * dy || 1)));
    const next = Math.hypot(point.x - ax - t * dx, point.y - ay - t * dy);
    if (next < distance) { best = route; distance = next; }
  }
  return best;
}

/** Участки одного перехода после разрыва маршрутом считаются один раз. */
export function canvasMoveCount(edges: readonly { id: string; kind: string }[]): number {
  return new Set(edges.filter((edge) => edge.kind === "transition" || edge.kind === "outcome")
    .map((edge) => edge.id.split("::r")[0])).size;
}
