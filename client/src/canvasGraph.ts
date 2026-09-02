import {
  EDGE_KIND_STYLE,
  TYPE_COLORS,
  TYPE_SHAPES,
  type GraphEdge,
  type GraphNode,
  type NodePosition,
  type NodePositions,
} from "./graphTypes";
import { RELATION_TONE_COLORS, RELATION_TONE_LABELS } from "./relations";
import type { RelationTone } from "./types";

const EDGE_LABEL_FONT_SIZE = 1.9;
const RELATION_ARROW_OFFSET = 5;
const ARROW_POSITIONS = [0.3, 0.5, 0.7];

export type ShapeType = "rect" | "diamond" | "triangle" | "triangleInverted" | "triangleRight" | "star";

function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function labelScale(_zoom: number) {
  // Фиксируем размер в экранных px — иначе на zoom=6 старый 0.5 давал 3.5× рост.
  // Даже 0.12 слишком много при 686 рёбрах. Лейбл должен оставаться ~2px всегда.
  return 1;
}

// ── Shape drawing ────────────────────────────────────────────────

export function drawShape(
  ctx: CanvasRenderingContext2D,
  shape: ShapeType,
  x: number,
  y: number,
  size: number,
  fill: string,
) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  if (shape === "diamond") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y);
    ctx.lineTo(x, y + size);
    ctx.lineTo(x - size, y);
  } else if (shape === "triangle") {
    ctx.moveTo(x, y - size);
    ctx.lineTo(x + size, y + size);
    ctx.lineTo(x - size, y + size);
  } else if (shape === "triangleInverted") {
    ctx.moveTo(x, y + size);
    ctx.lineTo(x + size, y - size);
    ctx.lineTo(x - size, y - size);
  } else if (shape === "triangleRight") {
    ctx.moveTo(x - size, y - size);
    ctx.lineTo(x - size, y + size);
    ctx.lineTo(x + size, y);
  } else if (shape === "star") {
    for (let i = 0; i < 10; i++) {
      const r = i % 2 === 0 ? size : size * 0.5;
      const a = (Math.PI * 2 * i) / 10 - Math.PI / 2;
      const px = x + Math.cos(a) * r;
      const py = y + Math.sin(a) * r;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
  } else {
    ctx.rect(x - size, y - size, size * 2, size * 2);
  }
  ctx.closePath();
  ctx.fill();
}

// ── Edge rendering ───────────────────────────────────────────────

export function drawEdge(
  ctx: CanvasRenderingContext2D,
  e: GraphEdge,
  from: NodePosition,
  to: NodePosition,
  nodesByKey: Map<string, GraphNode>,
  pairCounts: Map<string, number>,
  options: {
    onPath: boolean;
    offPath: boolean;
    dim: boolean;
    focused: boolean;
    showLabel: boolean;
    zoom: number;
    fitScale: number;
    vpMinX: number;
    vpMaxX: number;
    vpMinY: number;
    vpMaxY: number;
  },
) {
  const tone = e.tone as RelationTone | null;
  const color = tone ? RELATION_TONE_COLORS[tone] : "var(--line)";
  const kindStyle = EDGE_KIND_STYLE[e.kind];

  let ax = from.x;
  let ay = from.y;
  let bx = to.x;
  let by = to.y;

  // Bidirectional offset
  const bidirectional = tone && (pairCounts.get(pairKey(e.from, e.to)) ?? 0) > 1;
  if (bidirectional) {
    const loKey = e.from < e.to ? e.from : e.to;
    const loPos = e.from < e.to ? from : to;
    const hiPos = e.from < e.to ? to : from;
    const dx = hiPos.x - loPos.x;
    const dy = hiPos.y - loPos.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const perpX = -dy / len;
    const perpY = dx / len;
    const sign = e.from === loKey ? 1 : -1;
    ax += perpX * sign * RELATION_ARROW_OFFSET;
    ay += perpY * sign * RELATION_ARROW_OFFSET;
    bx += perpX * sign * RELATION_ARROW_OFFSET;
    by += perpY * sign * RELATION_ARROW_OFFSET;
  }

  const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;

  // Resolve CSS variables for Canvas
  const strokeColor = options.onPath
    ? resolveColor("--accent", "#c2683f")
    : options.focused
      ? resolveColor("--accent", "#c2683f")
      : resolveColorVar(color);

  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(bx, by);
  ctx.strokeStyle = strokeColor;
  ctx.globalAlpha = options.offPath ? 0.06 : options.dim ? 0.10 : options.onPath ? 1 : options.focused ? 0.95 : tone ? 0.6 : 0.5;
  ctx.lineWidth = 1;
  if (!options.onPath && kindStyle?.dash) {
    const parts = kindStyle.dash.split(" ").map(Number);
    ctx.setLineDash(parts);
  } else {
    ctx.setLineDash([]);
  }
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.globalAlpha = 1;

  // Arrows
  if (tone && !options.dim) {
    ctx.fillStyle = strokeColor;
    ctx.globalAlpha = options.focused ? 1 : 0.85;
    for (const t of ARROW_POSITIONS) {
      const mx = ax + (bx - ax) * t;
      const my = ay + (by - ay) * t;
      ctx.save();
      ctx.translate(mx, my);
      ctx.rotate((angle * Math.PI) / 180);
      ctx.beginPath();
      ctx.moveTo(-5, -3);
      ctx.lineTo(4, 0);
      ctx.lineTo(-5, 3);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  // Label — только на фокусе/пути, на сером чипе чуть выше линии
  if (options.showLabel) {
    if (!options.focused && !options.onPath) return;
    const relationLabel = e.section || (tone ? RELATION_TONE_LABELS[tone] : null);
    if (relationLabel) {
      const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
      const counterScale = 1 / (options.zoom * options.fitScale);
      const labelText = relationLabel.toUpperCase();
      const lx = (ax + bx) / 2;
      const ly = (ay + by) / 2;
      if (lx < options.vpMinX || lx > options.vpMaxX || ly < options.vpMinY || ly > options.vpMaxY) return;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((labelAngle * Math.PI) / 180);
      ctx.scale(counterScale, counterScale);
      ctx.font = `500 ${EDGE_LABEL_FONT_SIZE}px var(--font-ui, sans-serif)`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const padX = 3;
      const padY = 1.8;
      const textW = ctx.measureText(labelText).width;
      const chipW = textW + padX * 2;
      const chipH = EDGE_LABEL_FONT_SIZE + padY * 2;
      const GAP = 3; // зазор от линии до чипа в экранных px
      const chipY = -GAP - chipH; // верх чипа над линией
      const textY = chipY + chipH / 2;
      // серый чип — как просил: чуть выше линии, не на ней
      ctx.globalAlpha = options.onPath ? 0.96 : 0.92;
      ctx.fillStyle = resolveColor("--paper", "#ececec");
      // лёгкая тень/граница чтобы чип отделялся от фона
      ctx.fillRect(-chipW / 2, chipY, chipW, chipH);
      ctx.strokeStyle = resolveColor("--line", "#d9d9d9");
      ctx.lineWidth = 0.7;
      ctx.strokeRect(-chipW / 2, chipY, chipW, chipH);
      ctx.globalAlpha = options.onPath ? 0.95 : 0.88;
      ctx.fillStyle = resolveColor("--ink", "#1a1a1a");
      ctx.fillText(labelText, 0, textY);
      ctx.restore();
    }
  }
}

// ── Node rendering ───────────────────────────────────────────────

export function drawNode(
  ctx: CanvasRenderingContext2D,
  n: GraphNode,
  pos: NodePosition,
  options: {
    foldedCount: number;
    onPath: boolean;
    offPath: boolean;
    dim: boolean;
    pinned: boolean;
    scale: number;
    focused: boolean;
    fitScale: number;
  },
) {
  const shape = TYPE_SHAPES[n.type] ?? "rect";
  const fill = TYPE_COLORS[n.type] ?? "#888";
  const s = options.scale;

  const shapeIconSize = 5 * s;
  const estTitleW = Math.min(n.title.length * 6.6, 180);
  const chipW = Math.max(48, (estTitleW + shapeIconSize * 2 + 16) * s);
  const chipH = 22 * s;
  const fontSize = 10 * s;
  const padX = 6 * s;

  ctx.globalAlpha = options.offPath ? 0.08 : options.dim ? 0.10 : 1;

  // Chip background
  ctx.fillStyle = resolveColor("--bg-elevated", resolveColor("--paper", "#fff"));
  ctx.fillRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);

  // Border
  ctx.strokeStyle = options.onPath
    ? resolveColor("--accent", "#c2683f")
    : options.focused
      ? resolveColor("--ink", "#1a1a1a")
      : resolveColor("--line", "#ccc");
  ctx.lineWidth = 1;
  ctx.strokeRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);

  // Focused node — accent border
  if (options.focused) {
    ctx.strokeStyle = resolveColor("--accent", "#c2683f");
    ctx.lineWidth = 1;
    ctx.strokeRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);
  }

  // Shape icon
  drawShape(ctx, shape, pos.x - chipW / 2 + padX + shapeIconSize, pos.y, shapeIconSize, fill);

  // Title text — Display voice (Anton, names)
  ctx.font = `400 ${fontSize}px var(--font-display, sans-serif)`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = resolveColor("--ink", "#1a1a1a");
  const textX = pos.x - chipW / 2 + padX + shapeIconSize * 2 + 4 * s;
  ctx.fillText(n.title, textX, pos.y + 1);
  if (options.foldedCount > 0) {
    ctx.font = `600 ${8 * s}px var(--font-mono, monospace)`;
    ctx.fillStyle = resolveColor("--muted", "#999");
    ctx.fillText(` +${options.foldedCount}`, textX + ctx.measureText(n.title).width, pos.y + 1);
  }

  // Pin indicator
  if (options.pinned) {
    const pinSize = 4 * s;
    const pinOffset = 7 * s;
    ctx.fillStyle = resolveColor("--paper", "#fff");
    ctx.fillRect(pos.x + chipW / 2 - pinOffset, pos.y - chipH / 2 + 3 * s, pinSize, pinSize);
    ctx.strokeStyle = resolveColor("--muted", "#999");
    ctx.lineWidth = 0.5;
    ctx.strokeRect(pos.x + chipW / 2 - pinOffset, pos.y - chipH / 2 + 3 * s, pinSize, pinSize);
  }

  ctx.globalAlpha = 1;
}

// ── Grid drawing ─────────────────────────────────────────────────

export function drawGrid(
  ctx: CanvasRenderingContext2D,
  cssWidth: number,
  cssHeight: number,
  panX: number,
  panY: number,
  zoom: number,
  fitScale: number,
) {
  // Background covers the full CSS area
  ctx.fillStyle = resolveColor("--paper-2", resolveColor("--paper", "#f8f8f8"));
  ctx.fillRect(0, 0, cssWidth, cssHeight);

  // Dot pattern — world coordinates, transformed by pan/zoom/fitScale
  const dotColor = resolveColor("--line", "#ddd");
  ctx.fillStyle = dotColor;
  const step = 8;
  // Visible world range: screen px → world coords
  const worldMinX = -panX / (zoom * fitScale);
  const worldMaxX = (cssWidth - panX) / (zoom * fitScale);
  const worldMinY = -panY / (zoom * fitScale);
  const worldMaxY = (cssHeight - panY) / (zoom * fitScale);
  const startX = Math.floor(worldMinX / step) * step - step;
  const startY = Math.floor(worldMinY / step) * step - step;
  const endX = Math.ceil(worldMaxX / step) * step + step;
  const endY = Math.ceil(worldMaxY / step) * step + step;

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom * fitScale, zoom * fitScale);
  for (let x = startX; x <= endX; x += step) {
    for (let y = startY; y <= endY; y += step) {
      ctx.fillRect(x - 0.3, y - 0.3, 0.6, 0.6);
    }
  }
  ctx.restore();
}

// ── Main draw ────────────────────────────────────────────────────

export interface DrawInput {
  ctx: CanvasRenderingContext2D;
  width: number;
  height: number;
  panX: number;
  panY: number;
  zoom: number;
  fitScale: number;
  visibleEdges: GraphEdge[];
  visibleNodes: GraphNode[];
  positions: NodePositions;
  nodesByKey: Map<string, GraphNode>;
  groupedFolded: Map<string, number>;
  pairCounts: Map<string, number>;
  focusedKey: string | null;
  neighborKeys: Set<string> | null;
  pathKeys: Set<string> | null;
  pathEdges: Set<GraphEdge> | null;
  nodeScales: Map<string, number>;
  manual: Record<string, { x: number; y: number }>;
  showPins: boolean;
}

export function drawGraph(input: DrawInput) {
  const {
    ctx,
    width,
    height,
    panX,
    panY,
    zoom,
    fitScale,
    visibleEdges,
    visibleNodes,
    positions,
    nodesByKey,
    groupedFolded,
    pairCounts,
    focusedKey,
    neighborKeys,
    pathKeys,
    pathEdges,
    nodeScales,
    manual,
    showPins,
  } = input;

  ctx.clearRect(0, 0, width, height);
  drawGrid(ctx, width, height, panX, panY, zoom, fitScale);

  ctx.save();
  ctx.translate(panX, panY);
  ctx.scale(zoom * fitScale, zoom * fitScale);

  // Viewport culling — skip drawing elements outside the visible area.
  // Add 20% padding to prevent popping at edges during smooth panning.
  const scale = zoom * fitScale;
  const pad = 0.2;
  const vpMinX = (-panX / scale) * (1 - pad);
  const vpMaxX = ((width - panX) / scale) * (1 + pad);
  const vpMinY = (-panY / scale) * (1 - pad);
  const vpMaxY = ((height - panY) / scale) * (1 + pad);
  const inViewport = (x: number, y: number) =>
    x >= vpMinX && x <= vpMaxX && y >= vpMinY && y <= vpMaxY;

  // Edges — skip if BOTH endpoints are outside viewport (unless on path/focused)
  for (const e of visibleEdges) {
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) continue;
    const onPath = pathEdges?.has(e) ?? false;
    const focusedEdge = focusedKey != null && (e.from === focusedKey || e.to === focusedKey);
    if (!onPath && !focusedEdge && !inViewport(a.x, a.y) && !inViewport(b.x, b.y)) continue;

    const dim = neighborKeys != null && !neighborKeys.has(e.from) && !neighborKeys.has(e.to);
    const offPath = pathKeys != null && !onPath;
    // Только фокус/путь — иначе 686 лейблов убивают FPS (репорт: «грузят систему»).
    // Раньше: hasLabel && !dim → рисовали все 686 даже на обзоре.
    const showLabel = onPath || focusedEdge;

    drawEdge(ctx, e, a, b, nodesByKey, pairCounts, {
      onPath,
      offPath,
      dim,
      focused: focusedEdge,
      showLabel: !!showLabel,
      zoom,
      fitScale,
      vpMinX,
      vpMaxX,
      vpMinY,
      vpMaxY,
    });
  }

  // Nodes — skip if outside viewport (unless focused/in-path)
  for (const n of visibleNodes) {
    const p = positions.get(n.key);
    if (!p) continue;
    const onPath = pathKeys?.has(n.key) ?? false;
    const isFocused = focusedKey === n.key;
    if (!onPath && !isFocused && !inViewport(p.x, p.y)) continue;

    const foldedCount = groupedFolded.get(n.key) ?? 0;
    const offPath = pathKeys != null && !onPath;
    const dim = neighborKeys != null && !neighborKeys.has(n.key) && !isFocused;
    const pinned = showPins && manual[n.key] != null;
    const scale = nodeScales.get(n.key) ?? 1;

    drawNode(ctx, n, p, {
      foldedCount,
      onPath,
      offPath,
      dim,
      pinned,
      scale,
      focused: isFocused,
      fitScale,
    });
  }

  ctx.restore();
}

// ── Color resolution ─────────────────────────────────────────────
// Canvas can't use CSS variables, so we resolve them from the DOM.

const colorCache = new Map<string, string>();

function resolveColor(varName: string, fallback: string): string {
  const cached = colorCache.get(varName);
  if (cached) return cached;
  try {
    const val = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (val) {
      colorCache.set(varName, val);
      return val;
    }
  } catch {}
  colorCache.set(varName, fallback);
  return fallback;
}

function resolveColorVar(color: string): string {
  if (color.startsWith("var(")) {
    const match = color.match(/var\(([^,)]+)(?:,\s*([^)]+))?\)/);
    if (match) {
      return resolveColor(match[1], match[2] ?? "#888");
    }
  }
  return color;
}

// Clear the color cache when theme might have changed (e.g. dark mode toggle)
export function clearColorCache() {
  colorCache.clear();
}

// ── Hit testing ──────────────────────────────────────────────────

export function hitTestNode(
  worldX: number,
  worldY: number,
  visibleNodes: GraphNode[],
  positions: NodePositions,
  nodeScales: Map<string, number>,
): GraphNode | null {
  // Check in reverse order (topmost first)
  for (let i = visibleNodes.length - 1; i >= 0; i--) {
    const n = visibleNodes[i];
    const p = positions.get(n.key);
    if (!p) continue;
    const s = nodeScales.get(n.key) ?? 1;
    const shapeIconSize = 5 * s;
    const estTitleW = Math.min(n.title.length * 6.6, 180);
    const chipW = Math.max(48, (estTitleW + shapeIconSize * 2 + 16) * s);
    const chipH = 22 * s;
    if (
      worldX >= p.x - chipW / 2 &&
      worldX <= p.x + chipW / 2 &&
      worldY >= p.y - chipH / 2 &&
      worldY <= p.y + chipH / 2
    ) {
      return n;
    }
  }
  return null;
}

export function hitTestEdge(
  worldX: number,
  worldY: number,
  visibleEdges: GraphEdge[],
  positions: NodePositions,
  threshold: number = 6,
): GraphEdge | null {
  for (let i = visibleEdges.length - 1; i >= 0; i--) {
    const e = visibleEdges[i];
    const a = positions.get(e.from);
    const b = positions.get(e.to);
    if (!a || !b) continue;
    // Point-to-segment distance
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lenSq = dx * dx + dy * dy;
    if (lenSq === 0) continue;
    let t = ((worldX - a.x) * dx + (worldY - a.y) * dy) / lenSq;
    t = Math.max(0, Math.min(1, t));
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const distSq = (worldX - px) * (worldX - px) + (worldY - py) * (worldY - py);
    if (distSq <= threshold * threshold) return e;
  }
  return null;
}

// ── Tooltip text ─────────────────────────────────────────────────

export function edgeTooltip(e: GraphEdge, nodesByKey: Map<string, GraphNode>): string {
  const fromTitle = nodesByKey.get(e.from)?.title ?? "?";
  const toTitle = nodesByKey.get(e.to)?.title ?? "?";
  const tone = e.tone as RelationTone | null;
  const relationLabel = e.section || (tone ? RELATION_TONE_LABELS[tone] : null);
  return `${fromTitle} → ${toTitle}${relationLabel ? `: ${relationLabel}` : ""}`;
}

export function nodeTooltip(n: GraphNode, foldedCount: number): string {
  return (
    `${TYPE_LABELS_FULL[n.type] ?? n.type}: ${n.title}` +
    (foldedCount > 0 ? ` — свёрнуто внутрь: ${foldedCount}, нажмите, чтобы раскрыть` : "") +
    " — клик фокус, двойной клик — окрестность"
  );
}

const TYPE_LABELS_FULL: Record<string, string> = {
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
