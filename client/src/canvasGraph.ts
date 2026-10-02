import {
  EDGE_KIND_STYLE,
  TYPE_COLORS,
  TYPE_SHAPES,
  type GraphEdge,
  type GraphNode,
  type NodePosition,
  type NodePositions,
  type LayerBand,
} from "./graphTypes";
import { RELATION_TONE_COLORS, RELATION_TONE_LABELS } from "./relations";
import type { RelationTone } from "./types";
import { tintedGlyph, typeTint } from "./typeGlyphs";
import type { ConcentricLayout } from "./concentricGraph";

const EDGE_LABEL_FONT_SIZE = 16;
const EDGE_LABEL_MAX_FONT_SIZE = 24;
const RELATION_ARROW_OFFSET = 5;
const ARROW_POSITIONS = [0.3, 0.5, 0.7];
let fontFamilies = new WeakMap<CanvasRenderingContext2D, Map<string, string>>();

function canvasFont(ctx: CanvasRenderingContext2D, weight: number, size: number, variable: string, fallback: string) {
  let families = fontFamilies.get(ctx);
  if (!families) { families = new Map(); fontFamilies.set(ctx, families); }
  let family = families.get(variable);
  if (!family) {
    // Canvas font принимает готовую строку. var(...) здесь отвергается,
    // сохраняя прежний размер шрифта (обычно стандартные 10 px).
    try {
      family = (ctx.canvas ? getComputedStyle(ctx.canvas).getPropertyValue(variable).trim() : "")
        || getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
    } catch {}
    family ||= fallback;
    families.set(variable, family);
  }
  return `${weight} ${size}px ${family}`;
}

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

/** Полное название остаётся в подсказке; на карточке оно помещается в её ширину. */
export function fitGraphTitle(ctx: CanvasRenderingContext2D, title: string, maxWidth: number): string {
  if (ctx.measureText(title).width <= maxWidth) return title;
  const chars = Array.from(title);
  let low = 0, high = chars.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (ctx.measureText(chars.slice(0, middle).join("") + "…").width <= maxWidth) low = middle;
    else high = middle - 1;
  }
  return chars.slice(0, low).join("") + "…";
}

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

function edgeTint(e: GraphEdge, nodesByKey: Map<string, GraphNode>): string | null {
  if (e.kind !== "scene" && e.kind !== "link" && e.kind !== "mention") return null;
  for (const key of [e.to, e.from]) {
    const n = nodesByKey.get(key);
    const t = n ? typeTint(n.type) : null;
    if (t?.kind === "color") return t.color;
  }
  return null;
}

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
  // Связь сюжета с сущностью мира — в цвет сущности (знаки типов, 2026-09-30):
  // видно, откуда «растёт» существо или место, не читая подписей.
  const worldTint = !tone ? edgeTint(e, nodesByKey) : null;
  const color = tone ? RELATION_TONE_COLORS[tone] : worldTint ?? "var(--line)";
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
  // «Сыграно» — сплошная: состоявшееся, в отличие от набранного (Q7).
  if (!options.onPath && kindStyle?.dash && e.section !== "сыграно") {
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

  // Label — только на фокусе/пути, вдоль линии на отдельном чипе
  if (options.showLabel) {
    if (!options.focused && !options.onPath) return;
    const relationLabel = e.section || (tone ? RELATION_TONE_LABELS[tone] : null);
    if (relationLabel) {
      const labelFlipped = angle > 90 || angle < -90;
      const labelAngle = angle > 90 ? angle - 180 : angle < -90 ? angle + 180 : angle;
      const counterScale = 1 / (options.zoom * options.fitScale);
      const fontSize = Math.min(EDGE_LABEL_MAX_FONT_SIZE, Math.max(EDGE_LABEL_FONT_SIZE, EDGE_LABEL_FONT_SIZE * Math.sqrt(options.zoom * options.fitScale)));
      const labelText = relationLabel.toUpperCase();
      const lx = (ax + bx) / 2;
      const ly = (ay + by) / 2;
      if (lx < options.vpMinX || lx > options.vpMaxX || ly < options.vpMinY || ly > options.vpMaxY) return;
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate((labelAngle * Math.PI) / 180);
      ctx.scale(counterScale, counterScale);
      ctx.font = canvasFont(ctx, 600, fontSize, "--font-ui", "sans-serif");
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const padX = 8;
      const padY = 5;
      const textW = ctx.measureText(labelText).width;
      const chipW = textW + padX * 2;
      const chipH = fontSize + padY * 2;
      const GAP = 6; // зазор от линии до чипа в экранных px
      // У встречных связей чипы снаружи пары линий. После разворота
      // текста его локальная сторона меняется, поэтому учитываем переворот.
      const chipY = bidirectional && !labelFlipped ? GAP : -GAP - chipH;
      const textY = chipY + chipH / 2;
      // Чип отстоит от своей линии и не закрывает её стрелки.
      ctx.globalAlpha = 1;
      ctx.fillStyle = resolveColor("--paper", "#ececec");
      // лёгкая тень/граница чтобы чип отделялся от фона
      ctx.fillRect(-chipW / 2, chipY, chipW, chipH);
      ctx.strokeStyle = resolveColor("--line", "#d9d9d9");
      ctx.lineWidth = 1;
      ctx.strokeRect(-chipW / 2, chipY, chipW, chipH);
      ctx.globalAlpha = 1;
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
    selected?: boolean;
    fitScale: number;
    clipTitle?: boolean;
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

  // Окраска типа: мир — лёгкая подложка и знак в цвет, событие — инверсия,
  // остальное — бумага и тушь (знаки типов, 2026-09-30).
  const tint = typeTint(n.type);
  const paper = resolveColor("--bg-elevated", resolveColor("--paper", "#fff"));
  const ink = resolveColor("--ink", "#1a1a1a");
  const inverse = tint.kind === "inverse";

  // Chip background
  ctx.fillStyle = inverse ? ink : paper;
  ctx.fillRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);
  if (tint.kind === "color") {
    const a = ctx.globalAlpha;
    ctx.globalAlpha = a * 0.2;
    ctx.fillStyle = tint.color;
    ctx.fillRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);
    ctx.globalAlpha = a;
  }

  // Border
  ctx.strokeStyle = options.onPath
    ? resolveColor("--accent", "#c2683f")
    : options.focused
      ? resolveColor("--ink", "#1a1a1a")
      : resolveColor("--line", "#ccc");
  ctx.lineWidth = 1;
  ctx.strokeRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);

  // Выделенный рамкой или Shift — внешняя акцентная рамка.
  if (options.selected) {
    ctx.strokeStyle = resolveColor("--accent", "#c2683f");
    ctx.lineWidth = 2.5;
    ctx.strokeRect(pos.x - chipW / 2 - 3, pos.y - chipH / 2 - 3, chipW + 6, chipH + 6);
  }

  // Focused node — accent border
  if (options.focused) {
    ctx.strokeStyle = resolveColor("--accent", "#c2683f");
    ctx.lineWidth = 1;
    ctx.strokeRect(pos.x - chipW / 2, pos.y - chipH / 2, chipW, chipH);
  }

  // Знак типа; пока картинка не догрузилась (или знака у типа нет) — фигура.
  const glyphColor = tint.kind === "color" ? tint.color : inverse ? paper : ink;
  const glyph = tintedGlyph(n.type, glyphColor);
  const iconX = pos.x - chipW / 2 + padX + shapeIconSize;
  if (glyph) {
    const g = shapeIconSize * 2.4;
    ctx.drawImage(glyph, iconX - g / 2, pos.y - g / 2, g, g);
  } else {
    drawShape(ctx, shape, iconX, pos.y, shapeIconSize, fill);
  }

  // Title text — Display voice (Anton, names)
  ctx.font = canvasFont(ctx, 400, fontSize, "--font-display", "sans-serif");
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillStyle = inverse ? paper : ink;
  const textX = pos.x - chipW / 2 + padX + shapeIconSize * 2 + 4 * s;
  const countText = options.foldedCount > 0 ? ` +${options.foldedCount}` : "";
  const maxTitleWidth = Math.max(8 * s, pos.x + chipW / 2 - 4 * s - textX - countText.length * 6.6 * s);
  const title = options.clipTitle ? fitGraphTitle(ctx, n.title ?? "", maxTitleWidth) : n.title ?? "";
  ctx.fillText(title, textX, pos.y + 1);
  if (options.foldedCount > 0) {
    const titleWidth = ctx.measureText(title).width;
    ctx.font = canvasFont(ctx, 600, 8 * s, "--font-mono", "monospace");
    ctx.fillStyle = resolveColor("--muted", "#999");
    ctx.fillText(countText, textX + titleWidth, pos.y + 1);
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

const GRID_WORLD_STEP = 8;
const GRID_MIN_SCREEN_STEP = 8;
const GRID_TILE_SIZE = 16;
const gridPatterns = new WeakMap<CanvasRenderingContext2D, {
  color: string;
  dpr: number;
  pattern: CanvasPattern;
}>();

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

  const scale = zoom * fitScale;
  if (!Number.isFinite(scale) || scale <= 0) return;

  // При отдалении оставляем каждую 2-ю, 4-ю и т. д. точку: решётка
  // привязана к миру, но её экранный шаг никогда не мельче 8 px.
  const stride = 2 ** Math.max(0, Math.ceil(Math.log2(GRID_MIN_SCREEN_STEP / (GRID_WORLD_STEP * scale))));
  const screenStep = GRID_WORLD_STEP * stride * scale;
  const dotColor = resolveColor("--line", "#ddd");
  const dpr = window.devicePixelRatio || 1;
  let cached = gridPatterns.get(ctx);
  if (!cached || cached.color !== dotColor || cached.dpr !== dpr) {
    const tile = document.createElement("canvas");
    tile.width = tile.height = Math.ceil(GRID_TILE_SIZE * dpr);
    const tileCtx = tile.getContext("2d");
    if (!tileCtx) return;
    tileCtx.fillStyle = dotColor;
    const side = tile.width * 1.2 / GRID_TILE_SIZE;
    tileCtx.fillRect((tile.width - side) / 2, (tile.height - side) / 2, side, side);
    const pattern = ctx.createPattern(tile, "repeat");
    if (!pattern) return;
    cached = { color: dotColor, dpr, pattern };
    gridPatterns.set(ctx, cached);
  }

  // Одна заливка вместо сотен тысяч fillRect. Матрица меняется вместе
  // с камерой; сама плитка остаётся в кэше при переносе и масштабировании.
  const tileScale = screenStep / Math.ceil(GRID_TILE_SIZE * dpr);
  cached.pattern.setTransform(new DOMMatrix([
    tileScale, 0, 0, tileScale,
    panX % screenStep - screenStep / 2,
    panY % screenStep - screenStep / 2,
  ]));
  ctx.save();
  ctx.fillStyle = cached.pattern;
  ctx.fillRect(0, 0, cssWidth, cssHeight);
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
  /** Полосы ярусов графа приключений. */
  bands?: LayerBand[] | null;
  concentric?: ConcentricLayout | null;
  clipTitles?: boolean;
  selectedKeys?: Set<string>;
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

  // Ярусы: пунктир на границах и подпись у левого края экрана.
  if (input.bands) {
    const left = -panX / scale;
    const right = (width - panX) / scale;
    ctx.save();
    ctx.strokeStyle = resolveColor("--line", "#ccc");
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([6 / scale, 6 / scale]);
    ctx.font = canvasFont(ctx, 600, 10 / scale, "--font-mono", "monospace");
    ctx.fillStyle = resolveColor("--muted", "#999");
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    input.bands.forEach((b, i) => {
      if (i > 0) {
        ctx.beginPath();
        ctx.moveTo(left, b.top);
        ctx.lineTo(right, b.top);
        ctx.stroke();
      }
      ctx.fillText(b.label.toUpperCase(), left + 8 / scale, b.top + 6 / scale);
    });
    ctx.restore();
  }

  if (input.concentric) {
    const { centerX, centerY, rings } = input.concentric;
    ctx.save();
    ctx.lineWidth = 1 / scale;
    ctx.setLineDash([4 / scale, 6 / scale]);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = "600 14px monospace";
    for (const ring of rings) {
      const tint = typeTint(ring.type);
      const color = tint.kind === "color" ? tint.color : resolveColor("--muted", "#999");
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.28;
      ctx.beginPath();
      ctx.arc(centerX, centerY, ring.radius, 0, Math.PI * 2);
      ctx.stroke();
      if (scale >= 0.35) {
        ctx.globalAlpha = 1;
        ctx.fillStyle = color;
        ctx.fillText(ring.label, centerX, centerY - ring.radius);
      }
    }
    ctx.restore();
  }

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
      selected: input.selectedKeys?.has(n.key) ?? false,
      fitScale,
      clipTitle: input.clipTitles,
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
  fontFamilies = new WeakMap();
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
  const estTitleW = Math.min((n.title ?? "").length * 6.6, 180);
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
    `${TYPE_LABELS_FULL[n.type] ?? n.type}: ${n.title ?? "?"}` +
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
  mastering: "Библиотека",
  scene: "Сцены",
  adventure: "Приключения",
  compendium_entry: "Компендиум",
};
