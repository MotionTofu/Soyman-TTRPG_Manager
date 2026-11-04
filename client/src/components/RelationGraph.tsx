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
import { Link } from "react-router-dom";
import type { ContextMenuItem } from "./ContextMenu";
import { EntityMenuButton } from "./PageContextMenu";
import { entityMark, openEntityMenu } from "../pageMenu";
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
import { pickTextOn, THEME_CHANGE_EVENT } from "../themes";
import { plural } from "../sceneKinds";
import { ENTITY_TYPE_SINGULAR } from "../entityTypes";
import { concentricLayout, type ConcentricLayout } from "../concentricGraph";
import {
  drawGraph,
  clearColorCache,
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
  /** Последние строки колонки «Типы сущностей» — фильтры страницы («Точки»). */
  typesExtra?: React.ReactNode;
  /** Граф забирает остаток окна (страница «Связи»), а не высоту `height`. */
  fill?: boolean;
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
  onNodeContextMenu: (e: { clientX: number; clientY: number }, node: GraphNode) => void;
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
  const touchPoints = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number; worldX: number; worldY: number } | null>(null);

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
  useEffect(() => {
    const onThemeChange = () => { clearColorCache(); draw(); };
    onThemeChange();
    window.addEventListener(THEME_CHANGE_EVENT, onThemeChange);
    return () => window.removeEventListener(THEME_CHANGE_EVENT, onThemeChange);
  }, [draw]);
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
    if (e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey)) {
      const node = nodesByKey.get(focusedKey ?? [...selectedKeys][0]);
      if (!node) return;
      e.preventDefault(); e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      const p = positions.get(node.key);
      const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
      onNodeContextMenu({ clientX: r.left + (p ? p.x * viewRef.current.zoom * fs + viewRef.current.panX : r.width / 2), clientY: r.top + (p ? p.y * viewRef.current.zoom * fs + viewRef.current.panY : r.height / 2) }, node);
      return;
    }
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
  }, [draw, worldWidth, worldHeight, onSelect, focusedKey, selectedKeys, nodesByKey, positions, onNodeContextMenu]);

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
    if (e.pointerType === "touch") {
      e.preventDefault(); hideTooltip();
      touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      e.currentTarget.setPointerCapture(e.pointerId);
      if (touchPoints.current.size >= 2) {
        dragState.current = null; dragOrigin.current = null; dragPositionsRef.current = null;
        panState.current = null;
        const [a, b] = [...touchPoints.current.values()];
        const r = e.currentTarget.getBoundingClientRect();
        const v = viewRef.current, fs = Math.min(r.width / worldWidth, r.height / worldHeight);
        pinch.current = { distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)), zoom: v.zoom,
          worldX: ((a.x + b.x) / 2 - r.left - v.panX) / (v.zoom * fs),
          worldY: ((a.y + b.y) / 2 - r.top - v.panY) / (v.zoom * fs) };
        justPannedRef.current = true;
        draw();
        return;
      }
    }
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
    } else if (e.pointerType === "touch") {
      panState.current = { startX: e.clientX, startY: e.clientY, originX: viewRef.current.panX, originY: viewRef.current.panY, moved: false };
    } else {
      marquee.current = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey, moved: false };
    }
  }, [visibleNodes, positions, nodeScales, worldCoords, selectedKeys, worldWidth, worldHeight, draw]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width === 0) return;

    if (e.pointerType === "touch" && touchPoints.current.has(e.pointerId)) {
      touchPoints.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pinch.current && touchPoints.current.size >= 2) {
        const [a, b] = [...touchPoints.current.values()];
        const base = pinch.current, fs = Math.min(r.width / worldWidth, r.height / worldHeight);
        const zoom = Math.min(maxGraphZoom(fs, clipTitles), Math.max(MIN_ZOOM, base.zoom * Math.hypot(b.x - a.x, b.y - a.y) / base.distance));
        const pan = clampPan(zoom, (a.x + b.x) / 2 - r.left - base.worldX * zoom * fs,
          (a.y + b.y) / 2 - r.top - base.worldY * zoom * fs, r.width, r.height, worldWidth, worldHeight, fs);
        viewRef.current = { zoom, panX: pan.x, panY: pan.y };
        cancelAnimationFrame(rafRef.current);
        rafRef.current = requestAnimationFrame(draw);
        return;
      }
    }
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
  }, [draw, worldWidth, worldHeight, updateDragPreview, clipTitles]);

  const handlePointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") {
      touchPoints.current.delete(e.pointerId);
      if (pinch.current) {
        pinch.current = null;
        const remaining = [...touchPoints.current.values()][0];
        panState.current = remaining ? { startX: remaining.x, startY: remaining.y, originX: viewRef.current.panX, originY: viewRef.current.panY, moved: true } : null;
        return;
      }
    }
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

  const handlePointerCancel = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    // Lost capture после штатного pointerup не прерывает оставшийся палец.
    if (e.type === "lostpointercapture" && e.pointerType === "touch" && !touchPoints.current.has(e.pointerId)) return;
    touchPoints.current.clear(); pinch.current = null;
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
    if (e.shiftKey) return;
    e.preventDefault();
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit) onNodeContextMenu(e, hit);
  }, [visibleNodes, positions, nodeScales, onNodeContextMenu, worldCoords]);

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.type.startsWith("pointer") && (e as unknown as ReactPointerEvent).pointerType === "touch") return;
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
      role="group"
      aria-label="Поле графа"
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

export function RelationGraph({ data, height = GRAPH_HEIGHT, emptyMessage, layoutKey, scopeBar, edgeKinds, activeKinds: activeKindsProp, onActiveKindsChange, defaultHiddenTypes = GRAPH_VIEW_HIDDEN_TYPES.world, view = "world", layered: layeredMode = false, focusKey = null, typesExtra, fill = false }: Props) {
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
  // Сначала видимый срез, затем лимит: скрытые совпадения не занимают места.
  const shownMatches = visibleNodesList.filter((n) =>
    debouncedQuery.trim() && n.title.toLowerCase().includes(debouncedQuery.trim().toLowerCase())
  ).slice(0, 8);
  const matchKeys = shownMatches.map((n) => n.key).join("|");
  useEffect(() => setHighlightIdx(-1), [query, matchKeys]);

  const visibleLinkCounts = new Map<string, number>();
  for (const edge of visibleEdgesList) {
    visibleLinkCounts.set(edge.from, (visibleLinkCounts.get(edge.from) ?? 0) + 1);
    if (edge.to !== edge.from) visibleLinkCounts.set(edge.to, (visibleLinkCounts.get(edge.to) ?? 0) + 1);
  }

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
    if (isFoldedGroup) { setExpandedGroups((prev) => new Set(prev).add(n.key)); setFocusedKey(n.key); return; }
    if (expandedGroups.has(n.key)) { setExpandedGroups((prev) => { const next = new Set(prev); next.delete(n.key); return next; }); return; }
    if (focusedKey === n.key) setFocusedKey(null); else focusNode(n.key);
  }
  function handleBackgroundClick() { setFocusedKey(null); setSelected(new Set()); }
  function nodeMenuItems(node: GraphNode): ContextMenuItem[] {
    return [
      { label: "Изолировать узел и связи", onClick: () => isolate(node.key) },
      { label: "Изменить размер", onClick: () => setResizeTarget({ title: node.title, keys: [node.key] }) },
      { label: "Карточка сущности", onClick: () => setPreview({ type: node.type, id: node.id }) },
      ...(expandedGroups.has(node.key) ? [{ label: "Свернуть группу", onClick: () => setExpandedGroups((prev) => { const next = new Set(prev); next.delete(node.key); return next; }) }] : []),
    ];
  }
  function handleNodeContextMenu(e: { clientX: number; clientY: number }, node: GraphNode) {
    openEntityMenu({ type: node.type, id: node.id, name: node.title }, e.clientX, e.clientY, nodeMenuItems(node));
  }

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

  const graphStats = `${visibleNodesList.length} ${plural(visibleNodesList.length, "узел", "узла", "узлов")} · ${visibleEdgesList.length} ${plural(visibleEdgesList.length, "связь", "связи", "связей")}`;

  const typeOrder = ["character", "being", "artifact", "location", "community", "compendium_entry", "mastering", "scene", "adventure", "session", "campaign", "setting"];
  const typesInData = new Map<string, number>();
  for (const n of data.nodes) typesInData.set(n.type, (typesInData.get(n.type) ?? 0) + 1);
  const orderedTypes = typeOrder.filter((t) => typesInData.has(t));
  for (const t of typesInData.keys()) if (!orderedTypes.includes(t)) orderedTypes.push(t);

  // Строка над графом — что показываем (Q5, Q13 рестайла 2026-10-29): охват,
  // поиск, счётчик и раскладка. Типы — в колонке справа.
  const toolbar = (
    <div className="stack rg-head">
      <div className="d-bar rg-bar">
        {scopeBar}
        <div className="d-field rg-search">
          <NavIcon name="search" />
          <input
            placeholder={pathFrom && !pathTo ? "…и до кого прокладывать путь" : "Найти сущность…"}
            aria-label="Найти сущность"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setQuery(""); setDebouncedQuery(""); return; }
              if (shownMatches.length === 0) return;
              if (e.key === "ArrowDown") { e.preventDefault(); setHighlightIdx((v) => Math.min(shownMatches.length - 1, v + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setHighlightIdx((v) => Math.max(0, v - 1)); }
              else if (e.key === "Enter" && highlightIdx >= 0) { e.preventDefault(); const pick = shownMatches[highlightIdx]; if (pick) { if (pathFrom && !pathTo) pickPathTo(pick.key); else focusNode(pick.key, true); } }
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
        <span className="d-end rg-bar__end">
          <span className="d-mono">{graphStats}</span>
          {isolated.length > 0 && (
            <button type="button" className="d-btn d-btn--sm" onClick={() => setIsolatedOpen(true)} title="Сущности без связей в текущем срезе">
              Без связей ({isolated.length})
            </button>
          )}
          {view === "world" && !layeredMode && (
            <span className="d-seg" role="group" aria-label="Раскладка графа миров">
              <button type="button" className={worldLayoutMode === "free" ? "active" : ""} aria-pressed={worldLayoutMode === "free"} onClick={() => changeWorldLayoutMode("free")}>Свободная</button>
              <button type="button" className={worldLayoutMode === "concentric" ? "active" : ""} aria-pressed={worldLayoutMode === "concentric"} onClick={() => changeWorldLayoutMode("concentric")}>Кольца по видам</button>
            </span>
          )}
        </span>
      </div>
      {(selected.size > 0 || hiddenKeys.size > 0) && (
        <div className="row relation-graph-focus-panel">
          {selected.size > 0 && (
            <>
              <strong>Выделено: {selected.size}</strong>
              <button type="button" className="d-btn d-btn--sm" onClick={() => setResizeTarget({ title: `Выделено: ${selected.size}`, keys: [...selected] })}>Изменить размер</button>
              <button type="button" className="d-btn d-btn--sm" onClick={hideSelected} title="Убрать с холста — сами сущности не меняются">Скрыть с холста</button>
              <button type="button" className="d-btn d-btn--sm" onClick={() => setSelected(new Set())}>Снять выделение</button>
            </>
          )}
          {hiddenKeys.size > 0 && (
            <button type="button" className="d-btn d-btn--sm" onClick={() => setHiddenKeys(new Set())}>Вернуть скрытые ({hiddenKeys.size})</button>
          )}
        </div>
      )}
      {/* Путь — про два узла, поэтому строкой над графом, а не в карточке (Q6). */}
      {pathFrom && (
        <div className="row relation-graph-focus-panel">
          <strong>Путь:</strong>
          <span>{nodesByKey.get(pathFrom)?.title ?? "?"}</span>
          {!pathTo && <span className="muted">выберите вторую сущность в поиске выше</span>}
          {pathTo && !path && <span className="muted">связи между ними в этом срезе нет</span>}
          {path && (
            <span className="relation-graph-path-chain">
              {path.keys.slice(1).map((key, i) => (
                <span key={key}>{" ⟶ "}{path.edges[i]?.section && <span className="muted">[{path.edges[i].section}] </span>}{nodesByKey.get(key)?.title ?? "?"}</span>
              ))}
            </span>
          )}
          <button type="button" className="d-btn d-btn--sm" onClick={() => { setPathFrom(null); setPathTo(null); }}>Сбросить путь</button>
        </div>
      )}
    </div>
  );

  // Колонка фильтров (Q5): галочки на виду вместо двух выпадашек.
  const legend = (
    <aside className="rg-legend" aria-label="Фильтры графа">
      <div className="d-plate-row">
        <h2 className="d-plate">Типы связей</h2>
        <span className="d-end">
          <button type="button" className="rg-legend__all" onClick={() => setActiveKinds(new Set(visibleEdgeKinds.map((k) => k.key)))}>Все</button>
          <button type="button" className="rg-legend__all" onClick={() => setActiveKinds(new Set())}>Нет</button>
        </span>
      </div>
      {visibleEdgeKinds.map((k) => {
        const on = effectiveActiveKinds.has(k.key);
        return (
          <button key={k.key} type="button" className="rg-legend__row" aria-pressed={on}
            onClick={() => {
              const next = new Set(effectiveActiveKinds);
              if (next.has(k.key)) next.delete(k.key); else next.add(k.key);
              setActiveKinds(next);
            }}>
            <span className="rg-check" aria-hidden="true" />
            <svg width="34" height="8" aria-hidden="true">
              <line x1="0" y1="4" x2="34" y2="4" stroke="currentColor" strokeWidth={Math.max(1.5, k.width)} strokeDasharray={k.dash || "none"} />
            </svg>
            <span>{k.label}</span>
            <span className="rg-legend__n">{edgeKindCounts.get(k.key) ?? 0}</span>
          </button>
        );
      })}
      <div className="d-plate-row">
        <h2 className="d-plate">Типы сущностей</h2>
        <span className="d-end">
          <button type="button" className="rg-legend__all" onClick={() => setHiddenTypes(new Set())}>Все</button>
          <button type="button" className="rg-legend__all" onClick={() => setHiddenTypes(new Set(typesInData.keys()))}>Нет</button>
        </span>
      </div>
      {orderedTypes.map((type) => {
        const on = !hiddenTypes.has(type);
        const t = typeTint(type);
        return (
          <button key={type} type="button" className="rg-legend__row rg-legend__row--type" aria-pressed={on}
            onClick={() => setHiddenTypes((prev) => { const next = new Set(prev); if (next.has(type)) next.delete(type); else next.add(type); return next; })}>
            <span className="rg-check" aria-hidden="true" />
            <span className="rg-legend__glyph" style={{ color: t.kind === "color" ? t.color : "var(--ink)" }}>
              {glyphName(type) ? <TypeGlyph type={type} /> : <span className="rg-legend__dot" style={{ background: TYPE_COLORS[type] ?? "var(--muted)" }} />}
            </span>
            <span>{TYPE_LABELS[type] ?? type}</span>
            <span className="rg-legend__n">{typesInData.get(type) ?? 0}</span>
          </button>
        );
      })}
      {typesExtra}
    </aside>
  );

  // Карточка выбранного узла (Q6). В изоляции она держится за центр изоляции,
  // даже когда выбор сняли, — иначе из «только соседей» не выйти.
  const cardKey = focusedKey ?? isolation?.key ?? null;
  const cardNode = cardKey ? nodesByKey.get(cardKey) : undefined;
  const cardIsolated = !!isolation && isolation.key === cardKey;
  const cardLinks = cardKey ? visibleLinkCounts.get(cardKey) ?? 0 : 0;
  const cardTint = cardNode ? typeTint(cardNode.type) : null;
  const cardRoute = cardNode ? TYPE_ROUTES[cardNode.type] : undefined;
  const card = cardNode && cardKey && (
    <section className="rg-card" aria-label={`Выбрано: ${cardNode.title}`}
      {...entityMark(cardNode.type, cardNode.id, cardNode.title)}
      onContextMenu={(e) => { if (e.shiftKey) return; e.preventDefault(); handleNodeContextMenu(e, cardNode); }}>
      <div
        className="rg-card__band"
        style={cardTint?.kind === "color" ? { background: cardTint.color, color: pickTextOn(cardTint.color) } : undefined}
      >
        <TypeGlyph type={cardNode.type} />
        <span>{ENTITY_TYPE_SINGULAR[cardNode.type] ?? TYPE_LABELS[cardNode.type] ?? cardNode.type} · {cardLinks} {plural(cardLinks, "связь", "связи", "связей")}</span>
        <EntityMenuButton entity={{ type: cardNode.type, id: cardNode.id, name: cardNode.title }} local={nodeMenuItems(cardNode)} />
        <button type="button" className="rg-card__close" aria-label="Снять выбор"
          onClick={() => { if (cardIsolated) leaveIsolation(); setFocusedKey(null); }}>×</button>
      </div>
      <div className="rg-card__body">
        <b>{cardNode.title}</b>
        {cardNode.blurb && <p className="rg-card__blurb">{cardNode.blurb}</p>}
        {cardNode.scopeLabel && <span className="rg-card__scope d-mono">{cardNode.scopeLabel}</span>}
        {cardIsolated && isolationView && (
          <span className="d-mono">шагов {isolation!.depth} · вокруг {isolationView.nodes.length - 1}</span>
        )}
        <div className="rg-card__acts">
          {cardRoute && <Link className="d-btn d-btn--sm" to={`${cardRoute}/${cardNode.id}`}>Профиль</Link>}
          {cardIsolated ? (
            <>
              <button type="button" className="d-btn d-btn--sm" disabled={isolation!.depth <= 1}
                onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth - 1 })}>Шаг −</button>
              <button type="button" className="d-btn d-btn--sm" disabled={isolationView?.nextStepCount === 0}
                title={isolationView?.nextStepCount === 0 ? "Дальше связей нет" : "Показать связи следующего порядка"}
                onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth + 1 })}>
                Шаг +{isolationView && isolationView.nextStepCount > 0 ? ` (${isolationView.nextStepCount})` : ""}
              </button>
              <button type="button" className="d-btn d-btn--sm" onClick={leaveIsolation}>Весь граф</button>
            </>
          ) : (
            <>
              <button type="button" className="d-btn d-btn--sm" onClick={() => setIsolation({ key: cardKey, depth: 1 })} title="Показать только узел и его соседей">Только соседи</button>
              {isolation && <button type="button" className="d-btn d-btn--sm" onClick={leaveIsolation}>Весь граф</button>}
            </>
          )}
          <button type="button" className="d-btn d-btn--sm" onClick={() => { setPathFrom(cardKey); setPathTo(null); setQuery(""); }} title="Проложить цепочку">Путь отсюда…</button>
        </div>
      </div>
    </section>
  );

  const graphFrame = data.nodes.length === 0 ? (
    <EmptyState title="Схема ещё не проявилась"
      hint={emptyMessage ?? "Добавьте связи между существами, фракциями и местами — граф проявится сам."}
      action={<Link to="/settings" className="d-btn">К сеттингам</Link>}
    />
  ) : (
    <div ref={graphWrapRef} className="rg-frame" style={{ minHeight: fullscreen || fill ? undefined : height }}>
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
      {/* В рамке — как показываем (решение 2026-09-30, Q5 рестайла). */}
      <div className="rg-tools">
        <button type="button" className="d-btn d-btn--sm" onClick={toggleSizeMode}
          title="Размер узлов: по типу (сюжет крупнее мира) или по числу связей">
          Размер: {sizeMode === "type" ? "тип" : "связи"}
        </button>
        {groupedFoldedCount > 0 && (
          <button type="button" className="d-btn d-btn--sm" onClick={() => setExpandedGroups((prev) => new Set([...prev, ...(grouped?.folded.keys() ?? [])]))} title="Развернуть все свёрнутые группы">
            Развернуть всё ({groupedFoldedCount})
          </button>
        )}
        <button type="button" className="d-btn d-btn--sm" onClick={saveLayout} title="Сохранить раскладку: закрепить всё, что сейчас на экране">Закрепить</button>
        <button type="button" className="d-btn d-btn--sm" onClick={resetLayout} title="Сбросить ручную раскладку">Сбросить</button>
      </div>
      {card}
      {concentric && concentric.rings.length > 0 && (
        <span className="rg-rings d-mono">
          От центра: {[...new Set(concentric.rings.map(r => r.type))].map(type => TYPE_LABELS[type] ?? type).join(" → ")}
        </span>
      )}
      {/* Масштаб — в углу холста, как на картах; рядом «Весь экран» (Q13). */}
      <div className="rg-zoom">
        {view === "world" && <button type="button" className="d-btn d-btn--sm" onClick={() => dispatchCommand("resetView")} title="Показать весь граф">Обзор</button>}
        <button type="button" className="d-btn d-btn--sm" onClick={() => dispatchCommand("zoomBy", { factor: 1 / 1.3 })} title="Отдалить"><NavIcon name="minus" /></button>
        <button type="button" className="d-btn d-btn--sm" onClick={() => dispatchCommand("zoomBy", { factor: 1.3 })} title="Приблизить"><NavIcon name="plus" /></button>
        <button type="button" className="d-btn d-btn--sm" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Закрыть (Esc)" : "На весь экран"}>
          {fullscreen ? "Свернуть" : <><NavIcon name="fullscreen" /> Весь экран</>}
        </button>
      </div>
    </div>
  );

  const graphBody = (
    <div className={`rg-body${fill || fullscreen ? " rg-body--fill" : ""}`}>
      {graphFrame}
      {legend}
      <ul className="sr-only rg-node-list" aria-label="Видимые узлы графа">
        {visibleNodesList.map((node) => {
          const count = visibleLinkCounts.get(node.key) ?? 0;
          return <li key={node.key}><button type="button" {...entityMark(node.type, node.id, node.title)}
            aria-pressed={focusedKey === node.key}
            onClick={() => focusNode(node.key, true)}
            onContextMenu={(e) => { if (e.shiftKey) return; e.preventDefault(); handleNodeContextMenu(e, node); }}>
            {ENTITY_TYPE_SINGULAR[node.type] ?? TYPE_LABELS[node.type] ?? node.type}: {node.title} · {count} {plural(count, "связь", "связи", "связей")}
          </button></li>;
        })}
      </ul>
    </div>
  );

  const overlays = (
    <>
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
      {resizeTarget && (
        <Modal ariaLabel="Размер узла" onClose={() => setResizeTarget(null)}>
          <div className="rg-dialog stack">
            <h2 className="d-plate">Размер узла</h2>
            <strong>{resizeTarget.title}</strong>
            <div className="rg-size-range">
              <span className="d-mono">50%</span>
              <input aria-label="Размер узла в процентах" type="range" min={50} max={200} step={5}
                value={Math.round((manualScales.get(resizeTarget.keys[0]) ?? 1) * 100)}
                onChange={(e) => { const val = Number(e.target.value) / 100; setManualScales((prev) => { const next = new Map(prev); for (const k of resizeTarget.keys) { if (val === 1) next.delete(k); else next.set(k, val); } return next; }); }}
              />
              <span className="d-mono">200%</span>
            </div>
            <div className="rg-size-value d-mono">{Math.round((manualScales.get(resizeTarget.keys[0]) ?? 1) * 100)}%</div>
            <div className="row rg-dialog__actions">
              {resizeTarget.keys.some((k) => (manualScales.get(k) ?? 1) !== 1) && (
                <button type="button" className="d-btn d-btn--sm" onClick={() => setManualScales((prev) => { const next = new Map(prev); for (const k of resizeTarget.keys) next.delete(k); return next; })}>Сбросить</button>
              )}
              <button type="button" className="d-btn d-btn--sm" onClick={() => setResizeTarget(null)}>Готово</button>
            </div>
          </div>
        </Modal>
      )}
      {isolatedOpen && isolated.length > 0 && (
        <Modal ariaLabel="Без связей" onClose={() => setIsolatedOpen(false)}>
          <div className="rg-dialog rg-dialog--isolated stack">
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
              <button type="button" className="d-btn d-btn--sm" onClick={() => setIsolatedOpen(false)}>Закрыть</button>
            </div>
          </div>
        </Modal>
      )}

    </>
  );

  if (fullscreen) {
    return createPortal(
      <div className="relation-graph-fullscreen">
        <div className="relation-graph-fullscreen-bar">
          <div className="d-plate-row">
            <span className="d-plate">Граф связей — весь экран</span>
            <span className="d-end"><button type="button" className="d-btn d-btn--sm" onClick={() => setFullscreen(false)}>× Закрыть (Esc)</button></span>
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
    <div className={`stack rg${fill ? " rg--fill" : ""}`}>
      {toolbar}
      {graphBody}
      {overlays}
    </div>
  );
}
