import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ContextMenu } from "./ContextMenu";
import { EmptyState } from "./EmptyState";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import {
  CANVAS_EDGE_PADDING,
  DEFAULT_EDGE_KINDS,
  EDGE_KINDS,
  buildIsolation,
  findPath,
  foldAdventures,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  TYPE_COLORS,
  TYPE_LABELS,
  TYPE_ROUTES,
  TYPE_SHAPES,
  canvasSizeFor,
  simulateGraph,
  GRAPH_VIEW_HIDDEN_TYPES,
  GRAPH_VIEW_SIZE_MODE,
  autoNodeScales,
  layeredLayout,
  adventureOwners,
  clampToBand,
  type LayerBand,
  type GraphView,
  type NodeSizeMode,
  type EdgeKind,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type IsolationView,
  type NodePositions,
} from "../graphTypes";
import { glyphName, onGlyphLoad, typeTint } from "../typeGlyphs";
import { TypeGlyph } from "./TypeGlyph";
import { concentricLayout, type ConcentricLayout } from "../concentricGraph";
import {
  drawGraph,
  hitTestEdge,
  hitTestNode,
  edgeTooltip,
  nodeTooltip,
  type DrawInput,
} from "../canvasGraph";

const ARROW_PAN_STEP = 90;
const MIN_ZOOM = 1;
const MAX_ZOOM = 18;
const WORLD_READING_SCALE = 1.2;
function maxGraphZoom(fitScale: number, readableCards: boolean) {
  return readableCards ? Math.max(MAX_ZOOM, 4 / fitScale) : MAX_ZOOM;
}


interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const PAN_OVERSCROLL = 150;

function clampPan(
  zoom: number, panX: number, panY: number,
  canvasW: number, canvasH: number,
  worldW: number, worldH: number, fs: number,
) {
  // Запас — полэкрана во все стороны: любой узел, даже крайний, можно
  // вывести в середину и приблизить, а не упираться в обрез холста.
  const overX = Math.max(PAN_OVERSCROLL, canvasW / 2);
  const overY = Math.max(PAN_OVERSCROLL, canvasH / 2);
  const minX = canvasW - worldW * zoom * fs - overX;
  const minY = canvasH - worldH * zoom * fs - overY;
  const maxX = overX;
  const maxY = overY;
  return {
    x: Math.max(minX, Math.min(maxX, panX)),
    y: Math.max(minY, Math.min(maxY, panY)),
  };
}

function centeredPan(
  zoom: number, wx: number, wy: number,
  canvasW: number, canvasH: number,
  worldW: number, worldH: number, fs: number,
) {
  const panX = canvasW / 2 - wx * zoom * fs;
  const panY = canvasH / 2 - wy * zoom * fs;
  return clampPan(zoom, panX, panY, canvasW, canvasH, worldW, worldH, fs);
}

interface Props {
  data: GraphData | null;
  height?: number;
  emptyMessage?: string;
  layoutKey?: string;
  scopeBar?: React.ReactNode;
  /** Ключи видов рёбер, доступных в этом графе. По умолчанию — все из EDGE_KINDS. */
  edgeKinds?: EdgeKind[];
  /** Текущий набор включённых видов рёбер (управление извне). */
  activeKinds?: Set<EdgeKind>;
  /** Колбэк смены набора видов рёбер (управление извне). */
  onActiveKindsChange?: (next: Set<EdgeKind>) => void;
  /** Типы, скрытые при открытии. По умолчанию — как в графе мира. */
  defaultHiddenTypes?: string[];
  /** Какой это граф: от него зависит размер узлов по умолчанию и где он запоминается. */
  view?: GraphView;
  /** Ярусы вместо силовой раскладки: сессии / сюжет / мир. Тащить узел можно только вдоль яруса. */
  layered?: boolean;
  /** Узел из «Показать в графе»: раскрыть его приключение и выделить. */
  focusKey?: string | null;
}

const SIZE_MODE_STORE_PREFIX = "rpgManagerGraphSizeMode:";
const WORLD_LAYOUT_MODE_KEY = "rpgManagerGraphLayoutMode:world";
type WorldLayoutMode = "free" | "concentric";
function loadWorldLayoutMode(): WorldLayoutMode {
  try { if (localStorage.getItem(WORLD_LAYOUT_MODE_KEY) === "concentric") return "concentric"; } catch {}
  return "free";
}

function loadSizeMode(view: GraphView): NodeSizeMode {
  try {
    const v = localStorage.getItem(SIZE_MODE_STORE_PREFIX + view);
    if (v === "type" || v === "links") return v;
  } catch {}
  return GRAPH_VIEW_SIZE_MODE[view];
}

interface ManualLayout {
  [nodeKey: string]: { x: number; y: number };
}

const LAYOUT_STORE_PREFIX = "rpgManagerGraphLayout:";
const EMPTY_MANUAL: ManualLayout = {};

function loadLayout(key: string | undefined): ManualLayout {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_STORE_PREFIX + key) || "{}") as ManualLayout;
  } catch {
    return {};
  }
}

/** Рамка заменяет выделение, рамка с Shift — добавляет, Shift+клик — переключает. */
type SelectMode = "replace" | "add" | "toggle";

// ─── Canvas component — refs-based, no React re-renders for pan/zoom ───

function GraphCanvas({
  width,
  height,
  worldWidth,
  worldHeight,
  positions,
  visibleEdges,
  visibleNodes,
  groupedFolded,
  pairCounts,
  nodesByKey,
  focusedKey,
  pathFrom,
  pathTo,
  nodeScales,
  manual,
  showPins,
  isolationView,
  onNodeClick,
  onNodeDoubleClick,
  onBackgroundClick,
  onNodeContextMenu,
  onNodeDrag,
  fitAnchorX = null,
  bands = null,
  concentric = null,
  clipTitles = false,
  focusRequest,
  selectedKeys,
  onSelect,
}: {
  width: number;
  height: number;
  worldWidth: number;
  worldHeight: number;
  positions: NodePositions;
  visibleEdges: GraphEdge[];
  visibleNodes: GraphNode[];
  groupedFolded: Map<string, number>;
  pairCounts: Map<string, number>;
  nodesByKey: Map<string, GraphNode>;
  focusedKey: string | null;
  pathFrom: string | null;
  pathTo: string | null;
  nodeScales: Map<string, number>;
  manual: ManualLayout;
  showPins: boolean;
  isolationView: IsolationView | null;
  onNodeClick: (n: GraphNode, isFoldedGroup: boolean) => void;
  onNodeDoubleClick: (key: string) => void;
  onBackgroundClick: () => void;
  onNodeContextMenu: (e: ReactMouseEvent, node: GraphNode) => void;
  /** Зафиксировать завершённый перенос одного узла или всего выделенного. */
  onNodeDrag: (moves: [string, number, number][]) => void;
  /** Ярусы: вписать по высоте и встать так, чтобы эта точка мира была на 2/3 экрана. */
  fitAnchorX?: number | null;
  bands?: LayerBand[] | null;
  concentric?: ConcentricLayout | null;
  clipTitles?: boolean;
  focusRequest: { key: string } | null;
  selectedKeys: Set<string>;
  onSelect: (keys: string[], mode: SelectMode) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const dragState = useRef<{ keys: string[]; moved: boolean } | null>(null);
  const dragOrigin = useRef<{ starts: Map<string, { x: number; y: number }>; clientX: number; clientY: number } | null>(null);
  const dragPositionsRef = useRef<NodePositions | null>(null);
  // Рамка выделения: протяжка левой кнопкой по пустому месту.
  const marquee = useRef<{ x0: number; y0: number; x1: number; y1: number; add: boolean; moved: boolean } | null>(null);
  const marqueeRef = useRef<HTMLDivElement>(null);
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const justPannedRef = useRef(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Keep path computation as refs (cheap, no re-render needed)
  const path = pathFrom && pathTo ? findPath(visibleEdges, pathFrom, pathTo) : null;
  const pathKeysRef = useRef<Set<string> | null>(null);
  const pathEdgesRef = useRef<Set<GraphEdge> | null>(null);
  pathKeysRef.current = path ? new Set(path.keys) : null;
  pathEdgesRef.current = path ? new Set(path.edges) : null;

  // Neighbor keys for focus dimming — computed once per focusedKey/visibleEdges change,
  // not on every draw call.
  const neighborKeys = useMemo(() => {
    if (!focusedKey) return null;
    const keys = new Set<string>();
    for (const e of visibleEdges) {
      if (e.from === focusedKey || e.to === focusedKey) {
        keys.add(e.from);
        keys.add(e.to);
      }
    }
    return keys;
  }, [visibleEdges, focusedKey]);

  // ── Tooltip ───────────────────────────────────────────────────
  function showTooltip(text: string, cx: number, cy: number) {
    const el = tooltipRef.current;
    if (!el) return;
    el.textContent = text;
    el.style.display = "block";
    el.style.left = `${cx + 12}px`;
    el.style.top = `${cy - 8}px`;
  }
  function hideTooltip() {
    if (tooltipRef.current) tooltipRef.current.style.display = "none";
  }

  // ── Draw ──────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const v = viewRef.current;
    const fitScale = Math.min(w / worldWidth, h / worldHeight);
    const input: DrawInput = {
      ctx,
      width: w,
      height: h,
      panX: v.panX,
      panY: v.panY,
      zoom: v.zoom,
      fitScale,
      visibleEdges,
      visibleNodes,
      positions: dragPositionsRef.current ?? positions,
      nodesByKey,
      groupedFolded,
      pairCounts,
      focusedKey,
      neighborKeys,
      pathKeys: pathKeysRef.current,
      pathEdges: pathEdgesRef.current,
      nodeScales,
      manual,
      showPins,
      bands,
      concentric,
      clipTitles,
      selectedKeys,
    };
    drawGraph(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEdges, visibleNodes, positions, nodesByKey, groupedFolded, pairCounts, focusedKey, neighborKeys, nodeScales, manual, showPins, worldWidth, worldHeight, bands, concentric, clipTitles, selectedKeys]);

  // Redraw when props change
  useEffect(() => {
    // После фиксации родитель передаёт сохранённые позиции. До этого
    // финальный кадр переноса остаётся на экране, без скачка назад.
    if (!dragState.current) dragPositionsRef.current = null;
    draw();
  }, [draw]);
  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);
  // Знаки типов грузятся картинками — догрузился знак, перерисовать.
  useEffect(() => onGlyphLoad(() => draw()), [draw]);

  // После поиска найденную карточку показываем в читаемом масштабе.
  // Сам клик на холсте не двигает камеру; перенос также не возвращает её назад.
  const shownFocusRequest = useRef<typeof focusRequest>(null);
  useEffect(() => {
    if (!focusRequest || shownFocusRequest.current === focusRequest) return;
    const pos = positions.get(focusRequest.key), el = wrapRef.current;
    if (!pos || !el) return;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
    const zoom = Math.min(maxGraphZoom(fs, clipTitles), Math.max(viewRef.current.zoom, (clipTitles ? WORLD_READING_SCALE : 0.9) / fs));
    const pan = centeredPan(zoom, pos.x, pos.y, r.width, r.height, worldWidth, worldHeight, fs);
    viewRef.current = { zoom, panX: pan.x, panY: pan.y };
    shownFocusRequest.current = focusRequest;
    draw();
  }, [focusRequest, positions, worldWidth, worldHeight, draw, clipTitles]);

  // Открываем карточки в читаемом экранном размере, а не сжимаем весь
  // растущий холст. Обзор всего графа доступен отдельной кнопкой.
  useEffect(() => {
    if (!concentric) return;
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
      if (!fs) return;
      const zoom = Math.max(MIN_ZOOM, WORLD_READING_SCALE / fs);
      const firstKey = concentric.rings[0]?.keys[0];
      const anchor = firstKey ? positions.get(firstKey) : null;
      const pan = centeredPan(zoom, anchor?.x ?? concentric.centerX, anchor?.y ?? concentric.centerY, r.width, r.height, worldWidth, worldHeight, fs);
      viewRef.current = { zoom, panX: pan.x, panY: pan.y };
      draw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- перенос и фокус не меняют раскладку колец
  }, [concentric]);

  // ResizeObserver
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

  // Ярусы открываются по высоте на последней проведённой сессии: лента
  // длиннее экрана, а за столом нужна она, а не начало кампании. Смена
  // размера (весь экран) вписывает заново.
  useEffect(() => {
    if (fitAnchorX == null || isolationView) return;
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
      const top = 40; // под панелью «Типы связей / Типы сущностей» — иначе лента сессий под ней
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, (r.height - top) / (worldHeight * fs)));
      const panX = Math.min(0, Math.max(r.width - worldWidth * zoom * fs, r.width * 2 / 3 - fitAnchorX * zoom * fs));
      viewRef.current = { zoom, panX, panY: top };
      draw();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- только при смене мира, не на каждую перерисовку
  }, [fitAnchorX, isolationView, worldWidth, worldHeight]);

  // Sync isolation view centering
  useEffect(() => {
    if (!isolationView) return;
    const el = wrapRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
    const centered = centeredPan(1, worldWidth / 2, worldHeight / 2, r.width, r.height, worldWidth, worldHeight, fs);
    viewRef.current = { zoom: 1, panX: centered.x, panY: centered.y };
    draw();
  }, [isolationView, width, height, draw, worldWidth, worldHeight]);

  // ── Wheel zoom ────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      const v = viewRef.current;
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
      const newZoom = Math.min(maxGraphZoom(fs, clipTitles), Math.max(MIN_ZOOM, v.zoom * factor));
      if (newZoom === v.zoom) return;
      const cursorScreenX = e.clientX - r.left;
      const cursorScreenY = e.clientY - r.top;
      const worldX = (cursorScreenX - v.panX) / (v.zoom * fs);
      const worldY = (cursorScreenY - v.panY) / (v.zoom * fs);
      const newPanX = cursorScreenX - worldX * newZoom * fs;
      const newPanY = cursorScreenY - worldY * newZoom * fs;
      const clamped = clampPan(newZoom, newPanX, newPanY, r.width, r.height, worldWidth, worldHeight, fs);
      viewRef.current = { zoom: newZoom, panX: clamped.x, panY: clamped.y };
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [draw, worldWidth, worldHeight, clipTitles]);

  // ── Keyboard pan ──────────────────────────────────────────────
  const handleKeyDown = useCallback((e: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = ARROW_PAN_STEP;
    const v = viewRef.current;
    let dx = 0;
    let dy = 0;
    if (e.key === "ArrowLeft") dx = step;
    else if (e.key === "ArrowRight") dx = -step;
    else if (e.key === "ArrowUp") dy = step;
    else if (e.key === "ArrowDown") dy = -step;
    else if (e.key === "Escape") { onSelect([], "replace"); return; }
    else return;
    e.preventDefault();
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
    const clamped = clampPan(v.zoom, v.panX + dx, v.panY + dy, r.width, r.height, worldWidth, worldHeight, fs);
    viewRef.current = { ...v, panX: clamped.x, panY: clamped.y };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, worldWidth, worldHeight, onSelect]);

  // ── Pointer: world coordinates from event ─────────────────────
  const worldCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return { x: 0, y: 0 };
    const v = viewRef.current;
    const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
    return {
      x: (e.clientX - r.left - v.panX) / (v.zoom * fs),
      y: (e.clientY - r.top - v.panY) / (v.zoom * fs),
    };
  }, [worldWidth, worldHeight]);

  // ── Pointer events ────────────────────────────────────────────
  const updateDragPreview = useCallback((clientX: number, clientY: number) => {
    const drag = dragState.current;
    const origin = dragOrigin.current;
    const c = canvasRef.current;
    if (!drag || !origin || !c) return;
    const r = c.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) return;
    const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
    const scale = viewRef.current.zoom * fs;
    const dx = (clientX - origin.clientX) / scale;
    const dy = (clientY - origin.clientY) / scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) drag.moved = true;
    if (!drag.moved) return;
    // Копируем карту один раз за жест. В последующих кадрах меняются
    // только переносимые узлы, без React и записи в localStorage.
    const preview = dragPositionsRef.current ?? new Map(positions);
    for (const key of drag.keys) {
      const start = origin.starts.get(key)!;
      const x = Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, start.x + dx));
      const y = Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, start.y + dy));
      const type = nodesByKey.get(key)?.type;
      preview.set(key, { x, y: bands && type ? clampToBand(bands, type, start.y, y) : y, vx: 0, vy: 0 });
    }
    dragPositionsRef.current = preview;
  }, [positions, width, height, worldWidth, worldHeight, nodesByKey, bands]);

  const handlePointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    wrapRef.current?.focus({ preventScroll: true });
    if (e.button === 1) {
      e.preventDefault();
      panState.current = { startX: e.clientX, startY: e.clientY, originX: viewRef.current.panX, originY: viewRef.current.panY, moved: false };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    if (e.button !== 0) return;
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    if (hit) {
      hideTooltip();
      dragPositionsRef.current = null;
      // Схватили выделенный — едет всё выделенное.
      const keys = selectedKeys.has(hit.key) ? [...selectedKeys].filter((k) => positions.has(k)) : [hit.key];
      const starts = new Map(keys.map((k) => [k, { x: positions.get(k)!.x, y: positions.get(k)!.y }]));
      dragState.current = { keys, moved: false };
      dragOrigin.current = { starts, clientX: e.clientX, clientY: e.clientY };
    } else {
      marquee.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false };
    }
  }, [visibleNodes, positions, nodeScales, worldCoords, selectedKeys]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width === 0) return;

    // Node drag
    if (dragState.current && dragOrigin.current) {
      updateDragPreview(e.clientX, e.clientY);
      if (!dragState.current.moved) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(draw);
      return;
    }

    // Рамка выделения — div поверх холста, в экранных координатах.
    const m = marquee.current;
    if (m) {
      m.x1 = e.clientX;
      m.y1 = e.clientY;
      if (Math.abs(m.x1 - m.x0) > 3 || Math.abs(m.y1 - m.y0) > 3) m.moved = true;
      const el = marqueeRef.current;
      if (el && m.moved) {
        el.style.display = "block";
        el.style.left = `${Math.min(m.x0, m.x1) - r.left}px`;
        el.style.top = `${Math.min(m.y0, m.y1) - r.top}px`;
        el.style.width = `${Math.abs(m.x1 - m.x0)}px`;
        el.style.height = `${Math.abs(m.y1 - m.y0)}px`;
      }
      return;
    }

    // Pan
    if (!panState.current) return;
    const v = viewRef.current;
    const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panState.current.moved = true;
    const clamped = clampPan(v.zoom, panState.current.originX + dx, panState.current.originY + dy, r.width, r.height, worldWidth, worldHeight, fs);
    viewRef.current = { ...v, panX: clamped.x, panY: clamped.y };
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(draw);
  }, [draw, worldWidth, worldHeight, updateDragPreview]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const m = marquee.current;
    if (m) {
      marquee.current = null;
      if (marqueeRef.current) marqueeRef.current.style.display = "none";
      if (!m.moved) return; // просто клик в пустоту — его разберёт onClick
      justPannedRef.current = true;
      const a = worldCoords({ clientX: Math.min(m.x0, m.x1), clientY: Math.min(m.y0, m.y1) });
      const b = worldCoords({ clientX: Math.max(m.x0, m.x1), clientY: Math.max(m.y0, m.y1) });
      const keys = visibleNodes.filter((n) => {
        const p = positions.get(n.key);
        return p && p.x >= a.x && p.x <= b.x && p.y >= a.y && p.y <= b.y;
      }).map((n) => n.key);
      onSelect(keys, m.add ? "add" : "replace");
      return;
    }
    if (dragState.current) {
      // Учитываем отпускание до ближайшего animationFrame и его координаты:
      // последний участок быстрого переноса не должен теряться.
      updateDragPreview(e.clientX, e.clientY);
      const drag = dragState.current;
      const preview = dragPositionsRef.current;
      cancelAnimationFrame(rafRef.current);
      dragState.current = null;
      dragOrigin.current = null;
      if (drag.moved && preview) {
        justPannedRef.current = true;
        draw();
        onNodeDrag(drag.keys.map((key) => {
          const p = preview.get(key)!;
          return [key, p.x, p.y];
        }));
      }
      return;
    }
    if (panState.current?.moved) justPannedRef.current = true;
    panState.current = null;
  }, [visibleNodes, positions, onSelect, worldCoords, updateDragPreview, draw, onNodeDrag]);

  const handlePointerCancel = useCallback(() => {
    if (!dragState.current && !panState.current && !marquee.current) return;
    cancelAnimationFrame(rafRef.current);
    justPannedRef.current = true;
    dragState.current = null;
    dragOrigin.current = null;
    dragPositionsRef.current = null;
    panState.current = null;
    marquee.current = null;
    if (marqueeRef.current) marqueeRef.current.style.display = "none";
    hideTooltip();
    draw();
  }, [draw]);

  const handleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (justPannedRef.current) { justPannedRef.current = false; return; }
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit && e.shiftKey) {
      e.stopPropagation();
      onSelect([hit.key], "toggle");
    } else if (hit) {
      e.stopPropagation();
      onNodeClick(hit, (groupedFolded.get(hit.key) ?? 0) > 0);
    } else {
      onBackgroundClick();
    }
  }, [visibleNodes, positions, nodeScales, groupedFolded, onNodeClick, onBackgroundClick, onSelect, worldCoords]);

  const handleDoubleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit) { e.stopPropagation(); onNodeDoubleClick(hit.key); }
  }, [visibleNodes, positions, nodeScales, onNodeDoubleClick, worldCoords]);

  const handleContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit) onNodeContextMenu(e, hit);
  }, [visibleNodes, positions, nodeScales, onNodeContextMenu, worldCoords]);

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (dragState.current || panState.current || marquee.current) return;
    const w = worldCoords(e);
    const hitN = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hitN) {
      showTooltip(nodeTooltip(hitN, groupedFolded.get(hitN.key) ?? 0), e.clientX, e.clientY);
      return;
    }
    const hitE = hitTestEdge(w.x, w.y, visibleEdges, positions);
    if (hitE) { showTooltip(edgeTooltip(hitE, nodesByKey), e.clientX, e.clientY); return; }
    hideTooltip();
  }, [visibleNodes, visibleEdges, positions, nodeScales, groupedFolded, nodesByKey, worldCoords]);

  // Expose zoom/reset via custom events (parent toolbar buttons)
  useEffect(() => {
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    function onCommand(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d.type === "zoomBy") {
        const v = viewRef.current;
        const c = canvasRef.current;
        if (!c) return;
        const r = c.getBoundingClientRect();
        const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
        const newZoom = Math.min(maxGraphZoom(fs, clipTitles), Math.max(MIN_ZOOM, v.zoom * d.factor));
        if (newZoom === v.zoom) return;
        const centerX = r.width / 2;
        const centerY = r.height / 2;
        const worldX = (centerX - v.panX) / (v.zoom * fs);
        const worldY = (centerY - v.panY) / (v.zoom * fs);
        const newPanX = centerX - worldX * newZoom * fs;
        const newPanY = centerY - worldY * newZoom * fs;
        const clamped = clampPan(newZoom, newPanX, newPanY, r.width, r.height, worldWidth, worldHeight, fs);
        viewRef.current = { zoom: newZoom, panX: clamped.x, panY: clamped.y };
        draw();
      } else if (d.type === "resetView") {
        const r = canvasRef.current?.getBoundingClientRect();
        if (!r?.width || !r.height) return;
        const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
        const pan = centeredPan(1, worldWidth / 2, worldHeight / 2, r.width, r.height, worldWidth, worldHeight, fs);
        viewRef.current = { zoom: 1, panX: pan.x, panY: pan.y };
        draw();
      }
    }
    el.addEventListener("graph-command", onCommand as EventListener);
    return () => el.removeEventListener("graph-command", onCommand as EventListener);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draw, worldWidth, worldHeight]);

  return (
    <div
      ref={wrapRef}
      className="relation-graph-wrap"
      style={{
        height: "100%",
        position: "relative",
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => { handlePointerMove(e); handleMouseMove(e); }}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onLostPointerCapture={handlePointerCancel}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onAuxClick={(e) => e.preventDefault()}
      onMouseLeave={hideTooltip}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
      <div ref={marqueeRef} className="graph-marquee" />
      <div
        ref={tooltipRef}
        style={{
          display: "none",
          position: "fixed",
          zIndex: 100,
          background: "var(--paper)",
          border: "1px solid var(--line)",
          padding: "4px 8px",
          fontSize: "12px",
          fontFamily: "var(--font-body)",
          maxWidth: "300px",
          pointerEvents: "none",
        }}
      />
    </div>
  );
}

// ─── Outer component — React state for toolbar/legend ────────────

export function RelationGraph({ data, height = GRAPH_HEIGHT, emptyMessage, layoutKey, scopeBar, edgeKinds, activeKinds: activeKindsProp, onActiveKindsChange, defaultHiddenTypes = GRAPH_VIEW_HIDDEN_TYPES.world, view = "world", layered: layeredMode = false, focusKey = null }: Props) {
  const navigate = useNavigate();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [worldLayoutMode, setWorldLayoutMode] = useState<WorldLayoutMode>(() => loadWorldLayoutMode());
  const ringsMode = view === "world" && !layeredMode && worldLayoutMode === "concentric";
  const storageKey = ringsMode && layoutKey ? `${layoutKey}:concentric` : layoutKey;
  const [manualKey, setManualKey] = useState(storageKey);
  const [storedManual, setManual] = useState<ManualLayout>(() => loadLayout(storageKey));
  const manual = manualKey === storageKey ? storedManual : EMPTY_MANUAL;
  const [focusRequest, setFocusRequest] = useState<{ key: string } | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  const [isolation, setIsolation] = useState<{ key: string; depth: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);
  const [manualScales, setManualScales] = useState<Map<string, number>>(() => new Map());
  const [sizeMode, setSizeMode] = useState<NodeSizeMode>(() => loadSizeMode(view));
  function toggleSizeMode() {
    const next: NodeSizeMode = sizeMode === "type" ? "links" : "type";
    setSizeMode(next);
    try { localStorage.setItem(SIZE_MODE_STORE_PREFIX + view, next); } catch {}
  }
  const [resizeTarget, setResizeTarget] = useState<{ title: string; keys: string[] } | null>(null);
  // Выделение (рамка, Shift+клик) и «Скрыть с холста» — только вид, не данные.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(() => new Set());
  const [activeKinds, setActiveKindsInternal] = useState<Set<EdgeKind>>(() => activeKindsProp ?? new Set(DEFAULT_EDGE_KINDS));
  // Виды рёбер управляются извне (GraphPage), если переданы.
  const setActiveKinds = onActiveKindsChange ?? setActiveKindsInternal;
  const effectiveActiveKinds = activeKindsProp ?? activeKinds;
  // Полные объекты видов рёбер для отрисовки фильтров.
  const visibleEdgeKinds = useMemo(
    () => edgeKinds ? EDGE_KINDS.filter((k) => edgeKinds.includes(k.key)) : EDGE_KINDS,
    [edgeKinds]
  );
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set(defaultHiddenTypes));
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [isolatedOpen, setIsolatedOpen] = useState(false);
  const [edgeKindsOpen, setEdgeKindsOpen] = useState(false);
  const [entityTypesOpen, setEntityTypesOpen] = useState(false);

  const graphWrapRef = useRef<HTMLDivElement>(null);

  // Координаты свободной раскладки и колец хранятся отдельно.
  useEffect(() => {
    setManual(loadLayout(storageKey));
    setManualKey(storageKey);
  }, [storageKey]);

  // Reset on layoutKey change
  useEffect(() => {
    setFocusedKey(null);
    setIsolation(null);
    setFocusRequest(null);
  }, [layoutKey]);

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  // Fullscreen escape
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setFullscreen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Save layout
  useEffect(() => {
    if (!storageKey || manualKey !== storageKey) return;
    try {
      if (Object.keys(manual).length === 0) localStorage.removeItem(LAYOUT_STORE_PREFIX + storageKey);
      else localStorage.setItem(LAYOUT_STORE_PREFIX + storageKey, JSON.stringify(manual));
    } catch (e) { console.warn("Graph layout not saved:", e); }
  }, [manual, storageKey, manualKey]);

  // Data change resets
  useEffect(() => {
    setFocusedKey(null);
    setPathFrom(null);
    setPathTo(null);
    setIsolation(null);
  }, [data]);

  // «Показать в графе»: после сброса выше — раскрыть приключение узла и выделить его.
  useEffect(() => {
    if (!focusKey || !data?.nodes.some((n) => n.key === focusKey)) return;
    const chain = adventureOwners(data.edges, focusKey);
    if (chain.length) setExpandedGroups((prev) => new Set([...prev, ...chain]));
    setFocusedKey(focusKey);
  }, [data, focusKey]);

  // ── Pipeline: filter → group → isolate ────────────────────────
  const pipeline = useMemo(() => {
    if (!data) return null;
    const kindEdges = data.edges.filter((e) => effectiveActiveKinds.has(e.kind));
    const visibleNodes = data.nodes.filter(
      (n) => !hiddenTypes.has(n.type),
    );
    const visibleKeys = new Set(visibleNodes.map((n) => n.key));
    const typeEdges = kindEdges.filter((e) => visibleKeys.has(e.from) && visibleKeys.has(e.to));
    const folded = foldAdventures(visibleNodes, typeEdges, expandedGroups);
    const grouped = hiddenKeys.size === 0 ? folded : {
      ...folded,
      nodes: folded.nodes.filter((n) => !hiddenKeys.has(n.key)),
      edges: folded.edges.filter((e) => !hiddenKeys.has(e.from) && !hiddenKeys.has(e.to)),
    };
    const isolationView = isolation
      ? buildIsolation(grouped.nodes, grouped.edges, isolation.key, isolation.depth)
      : null;
    return { grouped, isolationView };
  }, [data, effectiveActiveKinds, hiddenTypes, expandedGroups, isolation, hiddenKeys]);

  const isolationView = pipeline?.isolationView ?? null;
  const grouped = pipeline?.grouped;
  const visibleNodesList = isolationView ? isolationView.nodes : grouped?.nodes ?? [];
  const visibleEdgesList = isolationView ? isolationView.edges : grouped?.edges ?? [];

  // ── Layout computation ────────────────────────────────────────
  const baseCanvas = data ? canvasSizeFor(grouped?.nodes.length ?? 0) : { width: GRAPH_WIDTH, height: GRAPH_HEIGHT };
  const [layoutRevision, setLayoutRevision] = useState(0);
  const [simulated, setSimulated] = useState<NodePositions>(() => new Map());

  useEffect(() => {
    if (!data || layeredMode || ringsMode) { setSimulated(new Map()); return; }
    const nodes = grouped?.nodes ?? [];
    const edges = grouped?.edges ?? [];
    const wb = baseCanvas.width;
    const hb = baseCanvas.height;
    const useWorker = nodes.length > 50 && typeof Worker !== "undefined";
    if (!useWorker) {
      const seed: NodePositions = new Map();
      for (const [key, p] of Object.entries(manual)) seed.set(key, { ...p, vx: 0, vy: 0 });
      const next = simulateGraph(nodes, edges, wb, hb, seed.size > 0 ? seed : undefined, new Set(Object.keys(manual)));
      setSimulated(next);
      return;
    }
    // Только ручные позиции закреплены. Автоматические пересчитываются
    // по текущему видимому срезу, иначе выключенные связи удерживают узлы.
    const seedArr: [string, { x: number; y: number; vx: number; vy: number }][] =
      Object.entries(manual).map(([key, p]) => [key, { ...p, vx: 0, vy: 0 }]);
    const pinned = Object.keys(manual);
    const worker = new Worker(new URL("../graphWorker.ts", import.meta.url), { type: "module" });
    let cancelled = false;
    worker.onmessage = (e: MessageEvent<{ positions: [string, { x: number; y: number; vx: number; vy: number }][] }>) => {
      if (cancelled) return;
      const next: NodePositions = new Map(e.data.positions.map(([k, v]) => [k, { x: v.x, y: v.y, vx: v.vx, vy: v.vy }]));
      setSimulated(next);
      worker.terminate();
    };
    worker.onerror = () => { worker.terminate(); };
    worker.postMessage({ nodes, edges, width: wb, height: hb, seed: seedArr.length > 0 ? seedArr : undefined, pinned: pinned.length > 0 ? pinned : undefined });
    return () => { cancelled = true; worker.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grouped, baseCanvas.width, baseCanvas.height, layeredMode, ringsMode, manualKey, layoutRevision]);

  // Merge simulated + manual
  const forcePositions = useMemo(() => {
    const merged: NodePositions = new Map(simulated);
    for (const [key, p] of Object.entries(manual)) {
      if (merged.has(key)) merged.set(key, { ...p, vx: 0, vy: 0 });
    }
    return merged;
  }, [simulated, manual]);

  const groupedFoldedCount = grouped?.folded.size ?? 0;
  const showPins = Object.keys(manual).length < visibleNodesList.length;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- списки стабильны в пределах одного прохода pipeline
  const nodeScales = useMemo(() => {
    const scales = autoNodeScales(visibleNodesList, visibleEdgesList, sizeMode);
    for (const [key, m] of manualScales) scales.set(key, Math.min(3, (scales.get(key) ?? 1) * m));
    if (view === "world") for (const [key, scale] of scales) scales.set(key, scale * 2);
    return scales;
  }, [pipeline, sizeMode, manualScales, view]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- списки стабильны в пределах одного прохода pipeline
  const layered = useMemo(
    () => (layeredMode && !isolationView ? layeredLayout(visibleNodesList, visibleEdgesList, nodeScales) : null),
    [layeredMode, pipeline, nodeScales],
  );
  const concentric = useMemo(
    () => ringsMode ? concentricLayout(visibleNodesList, nodeScales, grouped?.folded) : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- списки стабильны в пределах pipeline
    [ringsMode, pipeline, nodeScales],
  );
  const nodesByKey = useMemo(() => data ? new Map(data.nodes.map((n) => [n.key, n])) : new Map<string, GraphNode>(), [data]);
  // В ярусах узел ходит только внутри своей полосы: ярус — это смысл, а не
  // место. Лента сессий — время, по y не двигается.
  const positions = useMemo(() => {
    if (concentric) {
      const merged = new Map(concentric.positions);
      for (const [key, p] of Object.entries(manual)) {
        if (merged.has(key)) merged.set(key, { ...p, vx: 0, vy: 0 });
      }
      return merged;
    }
    if (!layered) return forcePositions;
    const merged: NodePositions = new Map(layered.positions);
    for (const [key, p] of Object.entries(manual)) {
      const at = merged.get(key);
      const type = nodesByKey.get(key)?.type;
      if (at && type) merged.set(key, { ...at, x: p.x, y: clampToBand(layered.bands, type, at.y, p.y) });
    }
    return merged;
  }, [concentric, layered, forcePositions, manual, nodesByKey]);
  const canvasSize = concentric ?? layered ?? baseCanvas;

  // Precomputed lookups
  // eslint-disable-next-line react-hooks/exhaustive-deps -- visibleEdgesList is stable within a pipeline computation
  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of visibleEdgesList) {
      const k = e.from < e.to ? `${e.from}|${e.to}` : `${e.to}|${e.from}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [visibleEdgesList]);
  const edgeKindCounts = useMemo(() => {
    if (!data) return new Map<EdgeKind, number>();
    const counts = new Map<EdgeKind, number>();
    for (const e of data.edges) counts.set(e.kind, (counts.get(e.kind) ?? 0) + 1);
    return counts;
  }, [data]);

  // ── Search ────────────────────────────────────────────────────
  const searchMatches = useMemo(() => {
    if (!data || !debouncedQuery.trim()) return [];
    const q = debouncedQuery.trim().toLowerCase();
    return data.nodes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [data, debouncedQuery]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const visibleKeys = useMemo(() => new Set(visibleNodesList.map((n) => n.key)), [visibleNodesList]);
  const shownMatches = searchMatches.filter((n) => visibleKeys.has(n.key));

  // Path
  const path = pathFrom && pathTo ? findPath(visibleEdgesList, pathFrom, pathTo) : null;

  // ── Handlers ──────────────────────────────────────────────────
  function focusNode(key: string, reveal = false) {
    setFocusedKey(key); setQuery("");
    if (reveal) setFocusRequest({ key });
  }
  function changeWorldLayoutMode(next: WorldLayoutMode) {
    setWorldLayoutMode(next);
    setFocusRequest(null);
    setSelected(new Set());
    try { localStorage.setItem(WORLD_LAYOUT_MODE_KEY, next); } catch {}
  }
  function isolate(key: string) {
    setIsolation({ key, depth: 1 });
    setFocusedKey(key);
    setPathFrom(null);
    setPathTo(null);
    setMenu(null);
    setManualScales((prev) => { if (prev.has(key)) return prev; const next = new Map(prev); next.set(key, 2); return next; });
  }
  function leaveIsolation() { setIsolation(null); }
  function pickPathTo(key: string) { setPathTo(key); setQuery(""); }
  function saveLayout() {
    const next: ManualLayout = { ...manual };
    for (const [key, p] of positions) next[key] = { x: p.x, y: p.y };
    setManual(next);
  }
  function resetLayout() {
    if (storageKey) {
      try { localStorage.removeItem(LAYOUT_STORE_PREFIX + storageKey); } catch {}
    }
    setManual({});
    setHiddenKeys(new Set());
    setLayoutRevision((revision) => revision + 1);
  }
  function handleNodeClick(n: GraphNode, isFoldedGroup: boolean) {
    setMenu(null);
    if (isFoldedGroup) { setExpandedGroups((prev) => new Set(prev).add(n.key)); setFocusedKey(n.key); return; }
    if (expandedGroups.has(n.key)) { setExpandedGroups((prev) => { const next = new Set(prev); next.delete(n.key); return next; }); return; }
    if (focusedKey === n.key) setFocusedKey(null); else focusNode(n.key);
  }
  function handleBackgroundClick() { setFocusedKey(null); setMenu(null); setSelected(new Set()); }
  function handleNodeContextMenu(e: ReactMouseEvent, node: GraphNode) { setMenu({ x: e.clientX, y: e.clientY, node }); }

  const handleSelect = useCallback((keys: string[], mode: SelectMode) => {
    setSelected((prev) => {
      if (mode === "replace") return new Set(keys);
      const next = new Set(prev);
      for (const k of keys) {
        if (mode === "toggle" && next.has(k)) next.delete(k);
        else next.add(k);
      }
      return next;
    });
  }, []);
  const handleNodeDrag = useCallback((moves: [string, number, number][]) => {
    setManual((prev) => {
      const next = { ...prev };
      for (const [key, x, y] of moves) next[key] = { x, y };
      return next;
    });
  }, []);
  function hideSelected() {
    setHiddenKeys((prev) => new Set([...prev, ...selected]));
    setSelected(new Set());
  }

  function dispatchCommand(type: string, detail?: Record<string, unknown>) {
    const el = graphWrapRef.current;
    if (!el) return;
    el.dispatchEvent(new CustomEvent("graph-command", { detail: { type, ...detail }, bubbles: true }));
  }

  const isolated = data?.isolated ?? [];

  if (!data) return <p className="muted">Загрузка…</p>;
  if (!pipeline) return <p className="muted">Загрузка…</p>;

  const _graphStats = `${visibleNodesList.length} узлов · ${visibleEdgesList.length} связей${isolated.length > 0 ? ` · ${isolated.length} без связей` : ""}`;

  const toolbar = (
    <div className="graph-toolbar">
      <div className="graph-toolbar-row">
        <div className="row" style={{ position: "relative" }}>
          <input
            placeholder={pathFrom && !pathTo ? "…и до кого прокладывать путь" : "Найти сущность…"}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (shownMatches.length === 0) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((v) => Math.min(shownMatches.length - 1, v + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((v) => Math.max(0, v - 1)); }
              else if (e.key === "Enter" && highlightIdx >= 0) { e.preventDefault(); const pick = shownMatches[highlightIdx]; if (pick) { if (pathFrom && !pathTo) pickPathTo(pick.key); else focusNode(pick.key, true); } }
              else if (e.key === "Escape") setQuery("");
            }}
          />
          {debouncedQuery.trim() && shownMatches.length === 0 && (
            <div className="entity-search-results"><div className="entity-search-item muted">Нет результатов</div></div>
          )}
          {shownMatches.length > 0 && (
            <div className="entity-search-results">
              {shownMatches.map((n, idx) => {
                const q = debouncedQuery.trim();
                const title = n.title;
                const pos = q ? title.toLowerCase().indexOf(q.toLowerCase()) : -1;
                const before = pos >= 0 ? title.slice(0, pos) : title;
                const match = pos >= 0 ? title.slice(pos, pos + q.length) : "";
                const after = pos >= 0 ? title.slice(pos + q.length) : "";
                return (
                  <div key={n.key} className={`entity-search-item${idx === highlightIdx ? " highlighted" : ""}`}
                    onClick={() => (pathFrom && !pathTo ? pickPathTo(n.key) : focusNode(n.key, true))}
                    onMouseEnter={() => setHighlightIdx(idx)}>
                    <span className={`entity-type-chip ${n.type}`}>{TYPE_LABELS[n.type] ?? n.type}</span>
                    <span>{before}{match && <mark style={{ background: "var(--accent-soft)", padding: 0 }}>{match}</mark>}{after}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {scopeBar && (<><span className="graph-toolbar-sep" /><div className="graph-toolbar-row">{scopeBar}</div></>)}
      {isolated.length > 0 && (
        <>
          <span className="graph-toolbar-sep" />
          <div className="graph-toolbar-row">
            <button type="button" className="graph-tb-btn"
              onClick={() => setIsolatedOpen(true)}
              title="Сущности без связей в текущем срезе">
              Без связей ({isolated.length})
            </button>
          </div>
        </>
      )}
      {(selected.size > 0 || hiddenKeys.size > 0) && (
        <div className="row relation-graph-focus-panel">
          {selected.size > 0 && (
            <>
              <strong>Выделено: {selected.size}</strong>
              <button type="button" onClick={() => setResizeTarget({ title: `Выделено: ${selected.size}`, keys: [...selected] })}>Изменить размер</button>
              <button type="button" onClick={hideSelected} title="Убрать с холста — сами сущности не меняются">Скрыть с холста</button>
              <button type="button" onClick={() => setSelected(new Set())}>Снять выделение</button>
            </>
          )}
          {hiddenKeys.size > 0 && (
            <button type="button" onClick={() => setHiddenKeys(new Set())}>Вернуть скрытые ({hiddenKeys.size})</button>
          )}
        </div>
      )}
      {focusedKey && (
        <div className="row relation-graph-focus-panel">
          <span className={`entity-type-chip ${nodesByKey.get(focusedKey)?.type ?? ""}`}>
            {TYPE_LABELS[nodesByKey.get(focusedKey)?.type ?? ""] ?? ""}
          </span>
          <strong>{nodesByKey.get(focusedKey)?.title ?? "?"}</strong>
          {TYPE_ROUTES[nodesByKey.get(focusedKey)?.type ?? ""] && (
            <Link to={`${TYPE_ROUTES[nodesByKey.get(focusedKey)?.type ?? ""]}/${nodesByKey.get(focusedKey)?.id}`}>Открыть страницу →</Link>
          )}
          {(!isolation || isolation.key !== focusedKey) ? (
            <button type="button" onClick={() => setIsolation({ key: focusedKey, depth: 1 })} title="Изолировать узел и связи">+ шаг</button>
          ) : (
            <>
              {isolation.depth > 1 && (
                <button type="button" onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth - 1 })}>− шаг</button>
              )}
              <button type="button" disabled={(pipeline?.grouped ? buildIsolation(pipeline.grouped.nodes, pipeline.grouped.edges, focusedKey, isolation.depth) : null)?.nextStepCount === 0}
                onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth + 1 })}
                title="Показать связи следующего порядка">+ шаг</button>
            </>
          )}
          <button type="button" onClick={() => { setPathFrom(focusedKey); setPathTo(null); setQuery(""); }} title="Проложить цепочку">Путь отсюда…</button>
          <button type="button" onClick={() => setFocusedKey(null)}>Снять фокус</button>
        </div>
      )}
      {isolationView && (
        <div className="row relation-graph-focus-panel">
          <button type="button" onClick={leaveIsolation}>← Вернуться ко всему графу</button>
          <strong>{nodesByKey.get(isolation!.key)?.title ?? "?"}</strong>
          <span className="muted">шагов: {isolation!.depth}, узлов вокруг: {isolationView.nodes.length - 1}</span>
          <button type="button" disabled={isolationView.nextStepCount === 0}
            onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth + 1 })}
            title={isolationView.nextStepCount === 0 ? "Дальше связей нет" : "Показать связи следующего порядка"}>
            Добавить шаг {isolationView.nextStepCount > 0 && `(+${isolationView.nextStepCount})`}
          </button>
          {isolation!.depth > 1 && (
            <button type="button" onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth - 1 })}>Убрать шаг</button>
          )}
        </div>
      )}
      {pathFrom && (
        <div className="row relation-graph-focus-panel">
          <strong>Путь:</strong>
          <span>{nodesByKey.get(pathFrom)?.title ?? "?"}</span>
          {!pathTo && <span className="muted">выберите вторую сущность в поиске слева</span>}
          {pathTo && !path && <span className="muted">связи между ними в этом срезе нет</span>}
          {path && (
            <span className="relation-graph-path-chain">
              {path.keys.slice(1).map((key, i) => (
                <span key={key}>{" ⟶ "}{path.edges[i]?.section && <span className="muted">[{path.edges[i].section}] </span>}{nodesByKey.get(key)?.title ?? "?"}</span>
              ))}
            </span>
          )}
          <button type="button" onClick={() => { setPathFrom(null); setPathTo(null); }}>Сбросить путь</button>
        </div>
      )}
    </div>
  );

  const graphBody = data.nodes.length === 0 ? (
    <EmptyState title="Схема ещё не проявилась"
      hint={emptyMessage ?? "Добавьте связи между существами, фракциями и местами — граф проявится сам."}
      action={<Link to="/settings" className="primary" style={{ display: "inline-block", padding: "6px 12px", textDecoration: "none" }}>К сеттингам</Link>}
    />
  ) : (
    <div ref={graphWrapRef} style={{ flex: 1, minHeight: fullscreen ? 0 : height, display: "flex", position: "relative" }}>
      <GraphCanvas
        key={ringsMode ? "concentric" : "standard"}
        width={canvasSize.width}
        height={canvasSize.height}
        worldWidth={canvasSize.width}
        worldHeight={canvasSize.height}
        positions={positions}
        visibleEdges={visibleEdgesList}
        visibleNodes={visibleNodesList}
        groupedFolded={grouped?.folded ?? new Map()}
        pairCounts={pairCounts}
        nodesByKey={nodesByKey}
        focusedKey={focusedKey}
        pathFrom={pathFrom}
        pathTo={pathTo}
        nodeScales={nodeScales}
        manual={manual}
        showPins={showPins}
        isolationView={isolationView}
        onNodeClick={handleNodeClick}
        onNodeDoubleClick={isolate}
        onBackgroundClick={handleBackgroundClick}
        onNodeContextMenu={handleNodeContextMenu}
        onNodeDrag={handleNodeDrag}
        selectedKeys={selected}
        onSelect={handleSelect}
        fitAnchorX={layered?.anchorX ?? null}
        bands={layered?.bands ?? null}
        concentric={concentric}
        clipTitles={view === "world"}
        focusRequest={focusRequest}
      />
      {/* Stats — top right, below fullscreen button */}
      <span style={{ position: "absolute", top: 36, right: 8, zIndex: 5, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)", pointerEvents: "none" }}>
        {_graphStats}
      </span>
      {/* Canvas overlay controls */}
      <div style={{ position: "absolute", top: 8, left: 8, right: 130, display: "flex", flexWrap: "wrap", gap: 8, zIndex: 5 }}>
        {view === "world" && !layeredMode && (
          <select className="graph-tb-btn" aria-label="Раскладка графа миров"
            value={worldLayoutMode} onChange={e => changeWorldLayoutMode(e.target.value as WorldLayoutMode)}>
            <option value="free">Свободная раскладка</option>
            <option value="concentric">Кольца по видам</option>
          </select>
        )}
        <div style={{ position: "relative" }}>
          <button type="button" className={`graph-tb-btn${edgeKindsOpen ? " active" : ""}`}
            onClick={() => { setEdgeKindsOpen((v) => !v); setEntityTypesOpen(false); }}>
            Типы связей
          </button>
          {edgeKindsOpen && (
            <div className="graph-float-panel" style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 20, background: "var(--paper)", border: "1px solid var(--line)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, minWidth: 220, maxWidth: 260 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <span style={{ fontFamily: "var(--font-ui)", fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Типы связей</span>
                <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "1px 5px" }}
                  onClick={() => setEdgeKindsOpen(false)}>×</button>
              </div>
              <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "2px 6px" }}
                  onClick={() => {
                    const next = new Set(visibleEdgeKinds.map((k) => k.key));
                    setActiveKinds(next);
                  }}>Все</button>
                <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "2px 6px" }}
                  onClick={() => setActiveKinds(new Set())}>Нет</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {visibleEdgeKinds.map((k) => {
                  const on = effectiveActiveKinds.has(k.key);
                  const count = edgeKindCounts.get(k.key) ?? 0;
                  const dash = k.dash;
                  return (
                    <button key={k.key} type="button"
                      className={`graph-tb-btn${on ? " active" : ""}`}
                      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", padding: "3px 6px", opacity: on ? 1 : 0.45, textAlign: "left" }}
                      onClick={() => {
                        const next = new Set(effectiveActiveKinds);
                        if (next.has(k.key)) next.delete(k.key); else next.add(k.key);
                        setActiveKinds(next);
                      }}>
                      <svg width="20" height="2" style={{ flexShrink: 0 }}>
                        <line x1="0" y1="1" x2="20" y2="1" stroke="var(--ink)" strokeWidth={k.width}
                          strokeDasharray={dash || "none"} />
                      </svg>
                      <span style={{ flex: 1 }}>{k.label}</span>
                      <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.6 }}>{count}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
        <div style={{ position: "relative" }}>
          <button type="button" className={`graph-tb-btn${entityTypesOpen ? " active" : ""}`}
            onClick={() => { setEntityTypesOpen((v) => !v); setEdgeKindsOpen(false); }}>
            Типы сущностей
          </button>
          {entityTypesOpen && (() => {
            const typesInData = new Map<string, number>();
            for (const n of data?.nodes ?? []) {
              typesInData.set(n.type, (typesInData.get(n.type) ?? 0) + 1);
            }
            const ORDER = ["character", "being", "artifact", "location", "community", "compendium_entry", "mastering", "scene", "adventure", "session", "campaign", "setting"];
            const ordered = ORDER.filter((t) => typesInData.has(t));
            for (const t of typesInData.keys()) if (!ordered.includes(t)) ordered.push(t);
            return (
            <div className="graph-float-panel" style={{ position: "absolute", top: "100%", left: 0, marginTop: 6, zIndex: 20, background: "var(--paper)", border: "1px solid var(--line)", padding: "8px 10px", display: "flex", flexDirection: "column", gap: 6, minWidth: 220, maxWidth: 260 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <span style={{ fontFamily: "var(--font-ui)", fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Типы сущностей</span>
                  <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "1px 5px" }}
                    onClick={() => setEntityTypesOpen(false)}>×</button>
                </div>
                <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                  <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "2px 6px" }}
                    onClick={() => setHiddenTypes(new Set())}>Все</button>
                  <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "2px 6px" }}
                    onClick={() => setHiddenTypes(new Set(typesInData.keys()))}>Нет</button>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                  {ordered.map((type) => {
                    const hidden = hiddenTypes.has(type);
                    const count = typesInData.get(type) ?? 0;
                    const shape = TYPE_SHAPES[type] ?? "rect";
                    const fill = TYPE_COLORS[type] ?? "#888";
                    return (
                      <button key={type} type="button"
                        className={`graph-tb-btn`}
                        style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", padding: "3px 6px", opacity: hidden ? 0.4 : 1, textAlign: "left" }}
                        onClick={() => setHiddenTypes((prev) => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; })}>
                        {(() => {
                          if (glyphName(type)) {
                            const t = typeTint(type);
                            return <span style={{ display: "inline-flex", color: t.kind === "color" ? t.color : "var(--ink)" }}><TypeGlyph type={type} /></span>;
                          }
                          if (shape === "diamond") return <span style={{ display: "inline-block", width: 7, height: 7, background: fill, flexShrink: 0, border: "1px solid var(--line)", transform: "rotate(45deg)" }} />;
                          if (shape === "triangle") return <span style={{ display: "inline-block", width: 0, height: 0, flexShrink: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderBottom: `7px solid ${fill}` }} />;
                          if (shape === "triangleInverted") return <span style={{ display: "inline-block", width: 0, height: 0, flexShrink: 0, borderLeft: "4px solid transparent", borderRight: "4px solid transparent", borderTop: `7px solid ${fill}` }} />;
                          if (shape === "triangleRight") return <span style={{ display: "inline-block", width: 0, height: 0, flexShrink: 0, borderTop: "4px solid transparent", borderBottom: "4px solid transparent", borderLeft: `7px solid ${fill}` }} />;
                          if (shape === "star") return <span style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 10, height: 10, flexShrink: 0, color: fill, fontSize: "10px", lineHeight: 1 }}>★</span>;
                          return <span style={{ display: "inline-block", width: 7, height: 7, background: fill, flexShrink: 0, border: "1px solid var(--line)" }} />;
                        })()}
                        <span style={{ flex: 1 }}>{TYPE_LABELS[type] ?? type}</span>
                        <span style={{ fontFamily: "var(--font-mono)", fontSize: "9px", opacity: 0.6 }}>{count}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })()}
        </div>
        <button type="button" className="graph-tb-btn" onClick={toggleSizeMode}
          title="Размер узлов: по типу (сюжет крупнее мира) или по числу связей">
          Размер: {sizeMode === "type" ? "тип" : "связи"}
        </button>
        {groupedFoldedCount > 0 && (
          <button type="button" className="graph-tb-btn" onClick={() => setExpandedGroups((prev) => new Set([...prev, ...(grouped?.folded.keys() ?? [])]))} title="Развернуть все свёрнутые группы">
            Развернуть всё ({groupedFoldedCount})
          </button>
        )}
        <button type="button" className="graph-tb-btn" onClick={saveLayout} title="Сохранить раскладку: закрепить всё, что сейчас на экране">Закрепить</button>
        <button type="button" className="graph-tb-btn" onClick={resetLayout} title="Сбросить ручную раскладку">Сбросить</button>
      </div>
      {concentric && concentric.rings.length > 0 && (
        <div style={{ position: "absolute", bottom: 8, left: 8, right: 90, zIndex: 5, pointerEvents: "none", fontSize: "11px", color: "var(--muted)" }}>
          <span style={{ background: "var(--paper)", padding: "3px 6px" }}>
            От центра: {[...new Set(concentric.rings.map(r => r.type))].map(type => TYPE_LABELS[type] ?? type).join(" → ")}
          </span>
        </div>
      )}
      {/* Масштаб — в углу холста, как на картах. */}
      <div style={{ position: "absolute", bottom: 8, right: 8, display: "flex", gap: 4, zIndex: 5 }}>
        {view === "world" && <button type="button" className="graph-tb-btn" onClick={() => dispatchCommand("resetView")} title="Показать весь граф">Обзор</button>}
        <button type="button" className="graph-tb-btn" onClick={() => dispatchCommand("zoomBy", { factor: 1 / 1.3 })} title="Отдалить"><NavIcon name="minus" /></button>
        <button type="button" className="graph-tb-btn" onClick={() => dispatchCommand("zoomBy", { factor: 1.3 })} title="Приблизить"><NavIcon name="plus" /></button>
      </div>
      <button type="button" className="graph-tb-btn"
        style={{ position: "absolute", top: 8, right: 8, zIndex: 5 }}
        onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Закрыть (Esc)" : "На весь экран"}>
        {fullscreen ? "Свернуть" : <><NavIcon name="fullscreen" /> Весь экран</>}
      </button>
    </div>
  );

  const overlays = (
    <>
      {menu && (
        <ContextMenu x={menu.x} y={menu.y}
          items={[
            { label: "Изолировать узел и связи", onClick: () => isolate(menu.node.key) },
            { label: "Изменить размер", onClick: () => { setResizeTarget({ title: menu.node.title, keys: [menu.node.key] }); setMenu(null); } },
            { label: "Карточка сущности", onClick: () => { setPreview({ type: menu.node.type, id: menu.node.id }); setMenu(null); } },
            ...(TYPE_ROUTES[menu.node.type] ? [{ label: "Перейти к сущности", onClick: () => { navigate(`${TYPE_ROUTES[menu.node.type]}/${menu.node.id}`); setMenu(null); } }] : []),
            ...(expandedGroups.has(menu.node.key) ? [{ label: "Свернуть группу", onClick: () => { setExpandedGroups((prev) => { const next = new Set(prev); next.delete(menu.node.key); return next; }); setMenu(null); } }] : []),
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
      {resizeTarget && (
        <Modal onClose={() => setResizeTarget(null)}>
          <div style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, minWidth: 280 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>Размер узла</div>
            <div style={{ fontFamily: "var(--font-body)", fontSize: "14px", fontWeight: 600 }}>{resizeTarget.title}</div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted)", minWidth: 36, textAlign: "right" }}>50%</span>
              <input type="range" min={50} max={200} step={5}
                value={Math.round((manualScales.get(resizeTarget.keys[0]) ?? 1) * 100)}
                onChange={(e) => { const val = Number(e.target.value) / 100; setManualScales((prev) => { const next = new Map(prev); for (const k of resizeTarget.keys) { if (val === 1) next.delete(k); else next.set(k, val); } return next; }); }}
                style={{ flex: 1, accentColor: "var(--accent, #c2683f)" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted)", minWidth: 36 }}>200%</span>
            </div>
            <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "13px" }}>{Math.round((manualScales.get(resizeTarget.keys[0]) ?? 1) * 100)}%</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              {resizeTarget.keys.some((k) => (manualScales.get(k) ?? 1) !== 1) && (
                <button type="button" className="graph-tb-btn" onClick={() => setManualScales((prev) => { const next = new Map(prev); for (const k of resizeTarget.keys) next.delete(k); return next; })}>Сбросить</button>
              )}
              <button type="button" className="graph-tb-btn" onClick={() => setResizeTarget(null)} style={{ background: "var(--paper)", color: "var(--ink)" }}>Готово</button>
            </div>
          </div>
        </Modal>
      )}
      {isolatedOpen && isolated.length > 0 && (
        <Modal onClose={() => setIsolatedOpen(false)}>
          <div style={{ padding: 16, minWidth: 320, maxWidth: 480, maxHeight: "60vh", display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ fontFamily: "var(--font-ui)", fontSize: "13px", letterSpacing: "0.06em", textTransform: "uppercase", color: "var(--muted)" }}>
              Без связей в этом срезе: {isolated.length}
            </div>
            <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: "12px" }}>
              Эти сущности есть в выбранной области, но ни с чем не соединены — их не видно на холсте.
            </span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, overflowY: "auto", flex: 1 }}>
              {isolated.map((n) => {
                const route = TYPE_ROUTES[n.type];
                return (
                  <span key={n.key} className="row" style={{ gap: 4 }}>
                    <span className={`entity-type-chip ${n.type}`}>{TYPE_LABELS[n.type] ?? n.type}</span>
                    {route ? <Link to={`${route}/${n.id}`} onClick={() => setIsolatedOpen(false)}>{n.title}</Link> : n.title}
                  </span>
                );
              })}
            </div>
            <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 4 }}>
              <button type="button" className="graph-tb-btn" onClick={() => setIsolatedOpen(false)} style={{ background: "var(--paper)", color: "var(--ink)" }}>Закрыть</button>
            </div>
          </div>
        </Modal>
      )}

    </>
  );

  if (fullscreen) {
    return createPortal(
      <div className="relation-graph-fullscreen">
        <div className="relation-graph-fullscreen-bar" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "8px 12px", background: "var(--surface)", color: "var(--on-surface)", borderBottom: "1px solid var(--line)" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Граф связей — весь экран</span>
            <button type="button" className="graph-tb-btn" onClick={() => setFullscreen(false)} style={{ background: "var(--paper)", color: "var(--ink)" }}>× Закрыть (Esc)</button>
          </div>
          {toolbar}
        </div>
        {graphBody}
        {overlays}
      </div>,
      document.body,
    );
  }

  return (
    <div className="stack" style={{ position: "relative" }}>
      {toolbar}
      {graphBody}
      {overlays}
    </div>
  );
}
