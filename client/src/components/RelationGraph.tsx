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
  foldGroups,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  TYPE_COLORS,
  TYPE_LABELS,
  TYPE_ROUTES,
  TYPE_SHAPES,
  canvasSizeFor,
  simulateGraph,
  type EdgeKind,
  type GraphData,
  type GraphEdge,
  type GraphNode,
  type IsolationView,
  type NodePositions,
} from "../graphTypes";
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
const MAX_ZOOM = 6;

// Типы, скрытые по умолчанию — операционные сущности, засоряющие граф.
const DEFAULT_HIDDEN_TYPES = new Set(["scene", "adventure", "campaign"]);

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

function clampPan(
  zoom: number, panX: number, panY: number,
  canvasW: number, canvasH: number,
  worldW: number, worldH: number, fs: number,
) {
  const minX = canvasW - worldW * zoom * fs;
  const minY = canvasH - worldH * zoom * fs;
  return {
    x: Math.max(minX, Math.min(0, panX)),
    y: Math.max(minY, Math.min(0, panY)),
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
}

interface ManualLayout {
  [nodeKey: string]: { x: number; y: number };
}

const LAYOUT_STORE_PREFIX = "rpgManagerGraphLayout:";

function loadLayout(key: string | undefined): ManualLayout {
  if (!key) return {};
  try {
    return JSON.parse(localStorage.getItem(LAYOUT_STORE_PREFIX + key) || "{}") as ManualLayout;
  } catch {
    return {};
  }
}

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
  onNodeDrag: (key: string, x: number, y: number) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const viewRef = useRef<View>({ zoom: 1, panX: 0, panY: 0 });
  const dragState = useRef<{ key: string; moved: boolean } | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
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
      positions,
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
    };
    drawGraph(input);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleEdges, visibleNodes, positions, nodesByKey, groupedFolded, pairCounts, focusedKey, neighborKeys, nodeScales, manual, showPins, worldWidth, worldHeight]);

  // Redraw when props change
  useEffect(() => { draw(); }, [draw]);

  // ResizeObserver
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => draw());
    ro.observe(el);
    return () => ro.disconnect();
  }, [draw]);

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
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      if (newZoom === v.zoom) return;
      const c = canvasRef.current;
      if (!c) return;
      const r = c.getBoundingClientRect();
      const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
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
  }, [draw]);

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
  }, [draw, worldWidth, worldHeight]);

  // ── Pointer: world coordinates from event ─────────────────────
  function worldCoords(e: { clientX: number; clientY: number }) {
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
  }

  // ── Pointer events ────────────────────────────────────────────
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
    if (hit) {
      e.preventDefault();
      const start = positions.get(hit.key)!;
      dragState.current = { key: hit.key, moved: false };
      dragOrigin.current = { x: start.x, y: start.y, clientX: e.clientX, clientY: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
    }
  }, [visibleNodes, positions, nodeScales, worldWidth, worldHeight]);

  const handlePointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    const c = canvasRef.current;
    if (!c) return;
    const r = c.getBoundingClientRect();
    if (r.width === 0) return;

    // Node drag
    if (dragState.current && dragOrigin.current) {
      const origin = dragOrigin.current;
      const v = viewRef.current;
      const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
      const scale = v.zoom * fs;
      const dx = (e.clientX - origin.clientX) / scale;
      const dy = (e.clientY - origin.clientY) / scale;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.current.moved = true;
      if (!dragState.current.moved) return;
      const key = dragState.current.key;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        const nx = Math.max(CANVAS_EDGE_PADDING, Math.min(width - CANVAS_EDGE_PADDING, origin.x + dx));
        const ny = Math.max(CANVAS_EDGE_PADDING, Math.min(height - CANVAS_EDGE_PADDING, origin.y + dy));
        onNodeDrag(key, nx, ny);
        // Keep custom event for backward compat
        const evt = new CustomEvent("graph-node-drag", {
          detail: { key, x: nx, y: ny },
          bubbles: true,
        });
        wrapRef.current?.dispatchEvent(evt);
      });
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
  }, [draw, width, height, worldWidth, worldHeight, onNodeDrag]);

  const handlePointerUp = useCallback(() => {
    if (dragState.current) {
      if (dragState.current.moved) justPannedRef.current = true;
      dragState.current = null;
      dragOrigin.current = null;
      return;
    }
    if (panState.current?.moved) justPannedRef.current = true;
    panState.current = null;
  }, []);

  const handleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    if (justPannedRef.current) { justPannedRef.current = false; return; }
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit) {
      e.stopPropagation();
      onNodeClick(hit, (groupedFolded.get(hit.key) ?? 0) > 0);
    } else {
      onBackgroundClick();
    }
  }, [visibleNodes, positions, nodeScales, groupedFolded, onNodeClick, onBackgroundClick]);

  const handleDoubleClick = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit) { e.stopPropagation(); onNodeDoubleClick(hit.key); }
  }, [visibleNodes, positions, nodeScales, onNodeDoubleClick]);

  const handleContextMenu = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const w = worldCoords(e);
    const hit = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hit) onNodeContextMenu(e, hit);
  }, [visibleNodes, positions, nodeScales, onNodeContextMenu]);

  const handleMouseMove = useCallback((e: ReactMouseEvent<HTMLDivElement>) => {
    const w = worldCoords(e);
    const hitN = hitTestNode(w.x, w.y, visibleNodes, positions, nodeScales);
    if (hitN) {
      showTooltip(nodeTooltip(hitN, groupedFolded.get(hitN.key) ?? 0), e.clientX, e.clientY);
      return;
    }
    const hitE = hitTestEdge(w.x, w.y, visibleEdges, positions);
    if (hitE) { showTooltip(edgeTooltip(hitE, nodesByKey), e.clientX, e.clientY); return; }
    hideTooltip();
  }, [visibleNodes, visibleEdges, positions, nodeScales, groupedFolded, nodesByKey]);

  // Expose zoom/reset via custom events (parent toolbar buttons)
  useEffect(() => {
    const el = wrapRef.current?.parentElement;
    if (!el) return;
    function onCommand(e: Event) {
      const d = (e as CustomEvent).detail;
      if (d.type === "zoomBy") {
        const v = viewRef.current;
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * d.factor));
        if (newZoom === v.zoom) return;
        const c = canvasRef.current;
        if (!c) return;
        const r = c.getBoundingClientRect();
        const fs = Math.min(r.width / worldWidth, r.height / worldHeight);
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
        viewRef.current = { zoom: 1, panX: 0, panY: 0 };
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
        backgroundImage: "radial-gradient(var(--line) 0.6px, transparent 0.6px)",
        backgroundSize: "8px 8px",
        backgroundPosition: "0 0",
      }}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={(e) => { handlePointerMove(e); handleMouseMove(e); }}
      onPointerUp={handlePointerUp}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onContextMenu={handleContextMenu}
      onAuxClick={(e) => e.preventDefault()}
      onMouseLeave={hideTooltip}
    >
      <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />
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

export function RelationGraph({ data, height = GRAPH_HEIGHT, emptyMessage, layoutKey, scopeBar }: Props) {
  const navigate = useNavigate();
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [manual, setManual] = useState<ManualLayout>(() => loadLayout(layoutKey));
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  const [isolation, setIsolation] = useState<{ key: string; depth: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);
  const [nodeScales, setNodeScales] = useState<Map<string, number>>(() => new Map());
  const [resizeTarget, setResizeTarget] = useState<GraphNode | null>(null);
  const [activeKinds, setActiveKinds] = useState<Set<EdgeKind>>(() => new Set(DEFAULT_EDGE_KINDS));
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set(DEFAULT_HIDDEN_TYPES));
  const [highlightIdx, setHighlightIdx] = useState(-1);
  const [isolatedOpen, setIsolatedOpen] = useState(false);
  const [edgeKindsOpen, setEdgeKindsOpen] = useState(false);
  const [entityTypesOpen, setEntityTypesOpen] = useState(false);

  const graphWrapRef = useRef<HTMLDivElement>(null);

  // Reset on layoutKey change
  useEffect(() => {
    setManual(loadLayout(layoutKey));
    setFocusedKey(null);
    setIsolation(null);
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
    if (!layoutKey) return;
    try {
      if (Object.keys(manual).length === 0) localStorage.removeItem(LAYOUT_STORE_PREFIX + layoutKey);
      else localStorage.setItem(LAYOUT_STORE_PREFIX + layoutKey, JSON.stringify(manual));
    } catch (e) { console.warn("Graph layout not saved:", e); }
  }, [manual, layoutKey]);

  // Data change resets
  useEffect(() => {
    setFocusedKey(null);
    setPathFrom(null);
    setPathTo(null);
    setIsolation(null);
  }, [data]);

  // ── Layout computation ────────────────────────────────────────
  const baseCanvas = data ? canvasSizeFor(data.nodes.length) : { width: GRAPH_WIDTH, height: GRAPH_HEIGHT };
  const lastPositions = useRef<NodePositions | null>(null);
  const [simulated, setSimulated] = useState<NodePositions>(() => new Map());

  useEffect(() => {
    if (!data) { setSimulated(new Map()); return; }
    const nodes = data.nodes;
    const edges = data.edges;
    const wb = baseCanvas.width;
    const hb = baseCanvas.height;
    const useWorker = nodes.length > 50 && typeof Worker !== "undefined";
    if (!useWorker) {
      const seed: NodePositions = new Map(lastPositions.current ?? []);
      for (const [key, p] of Object.entries(manual)) seed.set(key, { ...p, vx: 0, vy: 0 });
      const next = simulateGraph(nodes, edges, wb, hb, seed.size > 0 ? seed : undefined, new Set(Object.keys(manual)));
      lastPositions.current = next;
      setSimulated(next);
      return;
    }
    const seedArr: [string, { x: number; y: number; vx: number; vy: number }][] = (() => {
      const m: [string, { x: number; y: number; vx: number; vy: number }][] = [];
      if (lastPositions.current) for (const [k, v] of lastPositions.current) m.push([k, { x: v.x, y: v.y, vx: v.vx, vy: v.vy }]);
      for (const [k, p] of Object.entries(manual)) {
        const idx = m.findIndex(([kk]) => kk === k);
        if (idx >= 0) m[idx] = [k, { x: p.x, y: p.y, vx: 0, vy: 0 }];
        else m.push([k, { x: p.x, y: p.y, vx: 0, vy: 0 }]);
      }
      return m;
    })();
    const pinned = Object.keys(manual);
    const worker = new Worker(new URL("../graphWorker.ts", import.meta.url), { type: "module" });
    let cancelled = false;
    worker.onmessage = (e: MessageEvent<{ positions: [string, { x: number; y: number; vx: number; vy: number }][] }>) => {
      if (cancelled) return;
      const next: NodePositions = new Map(e.data.positions.map(([k, v]) => [k, { x: v.x, y: v.y, vx: v.vx, vy: v.vy }]));
      lastPositions.current = next;
      setSimulated(next);
      worker.terminate();
    };
    worker.onerror = () => { worker.terminate(); };
    worker.postMessage({ nodes, edges, width: wb, height: hb, seed: seedArr.length > 0 ? seedArr : undefined, pinned: pinned.length > 0 ? pinned : undefined });
    return () => { cancelled = true; worker.terminate(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, baseCanvas.width, baseCanvas.height]);

  // Merge simulated + manual
  const positions = useMemo(() => {
    const merged: NodePositions = new Map(simulated);
    for (const [key, p] of Object.entries(manual)) {
      if (merged.has(key)) merged.set(key, { ...p, vx: 0, vy: 0 });
    }
    return merged;
  }, [simulated, manual]);

  // ── Pipeline: filter → group → isolate ────────────────────────
  const pipeline = useMemo(() => {
    if (!data) return null;
    const kindEdges = data.edges.filter((e) => activeKinds.has(e.kind));
    const visibleNodes = data.nodes.filter(
      (n) => !hiddenTypes.has(n.type),
    );
    const visibleKeys = new Set(visibleNodes.map((n) => n.key));
    const typeEdges = kindEdges.filter((e) => visibleKeys.has(e.from) && visibleKeys.has(e.to));
    const grouped = foldGroups(visibleNodes, typeEdges, "none", expandedGroups);
    const isolationView = isolation
      ? buildIsolation(grouped.nodes, grouped.edges, isolation.key, isolation.depth)
      : null;
    return { grouped, isolationView };
  }, [data, activeKinds, hiddenTypes, expandedGroups, isolation]);

  const isolationView = pipeline?.isolationView ?? null;
  const grouped = pipeline?.grouped;
  const visibleNodesList = isolationView ? isolationView.nodes : grouped?.nodes ?? [];
  const visibleEdgesList = isolationView ? isolationView.edges : grouped?.edges ?? [];
  const groupedFoldedCount = grouped?.folded.size ?? 0;
  const showPins = Object.keys(manual).length < visibleNodesList.length;

  // Precomputed lookups
  const nodesByKey = useMemo(() => data ? new Map(data.nodes.map((n) => [n.key, n])) : new Map<string, GraphNode>(), [data]);
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
  function focusNode(key: string) { setFocusedKey(key); setQuery(""); }
  function isolate(key: string) {
    setIsolation({ key, depth: 1 });
    setFocusedKey(key);
    setPathFrom(null);
    setPathTo(null);
    setMenu(null);
    setNodeScales((prev) => { if (prev.has(key)) return prev; const next = new Map(prev); next.set(key, 2); return next; });
  }
  function leaveIsolation() { setIsolation(null); }
  function pickPathTo(key: string) { setPathTo(key); setQuery(""); }
  function saveLayout() {
    const next: ManualLayout = { ...manual };
    for (const [key, p] of positions) next[key] = { x: p.x, y: p.y };
    setManual(next);
  }
  function resetLayout() {
    if (!layoutKey) return;
    try { localStorage.removeItem(LAYOUT_STORE_PREFIX + layoutKey); } catch {}
    setManual({});
    lastPositions.current = null;
  }
  function handleNodeClick(n: GraphNode, isFoldedGroup: boolean) {
    setMenu(null);
    if (isFoldedGroup) { setExpandedGroups((prev) => new Set(prev).add(n.key)); setFocusedKey(n.key); return; }
    if (expandedGroups.has(n.key)) { setExpandedGroups((prev) => { const next = new Set(prev); next.delete(n.key); return next; }); return; }
    if (focusedKey === n.key) setFocusedKey(null); else focusNode(n.key);
  }
  function handleBackgroundClick() { setFocusedKey(null); setMenu(null); }
  function handleNodeContextMenu(e: ReactMouseEvent, node: GraphNode) { setMenu({ x: e.clientX, y: e.clientY, node }); }

  // Node drag handler via custom events
  useEffect(() => {
    const el = graphWrapRef.current;
    if (!el) return;
    const handler = (e: Event) => {
      const d = (e as CustomEvent).detail;
      setManual((prev) => ({ ...prev, [d.key]: { x: d.x, y: d.y } }));
    };
    el.addEventListener("graph-node-drag", handler as EventListener);
    return () => el.removeEventListener("graph-node-drag", handler as EventListener);
  }, []);

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
              else if (e.key === "Enter" && highlightIdx >= 0) { e.preventDefault(); const pick = shownMatches[highlightIdx]; if (pick) { if (pathFrom && !pathTo) pickPathTo(pick.key); else focusNode(pick.key); } }
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
                    onClick={() => (pathFrom && !pathTo ? pickPathTo(n.key) : focusNode(n.key))}
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
      <span className="graph-toolbar-sep" />
      <div className="graph-toolbar-row">
        <button type="button" className="graph-tb-btn" onClick={() => dispatchCommand("zoomBy", { factor: 1 / 1.3 })} title="Отдалить"><NavIcon name="minus" /></button>
        <button type="button" className="graph-tb-btn" onClick={() => dispatchCommand("zoomBy", { factor: 1.3 })} title="Приблизить"><NavIcon name="plus" /></button>
        <button type="button" className="graph-tb-btn" onClick={saveLayout} title="Закрепить всё, что сейчас на экране">Сохранить раскладку</button>
        <button type="button" className="graph-tb-btn" onClick={resetLayout} title="Сбросить ручную раскладку">Сбросить раскладку</button>
        {groupedFoldedCount > 0 && (
          <button type="button" className="graph-tb-btn" onClick={() => setExpandedGroups(new Set())} title="Развернуть все свёрнутые группы">
            Развернуть всё ({groupedFoldedCount})
          </button>
        )}
      </div>
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
    <EmptyState icon="anarchyStar" title="СХЕМЫ ПОКА НЕТ"
      hint={emptyMessage ?? "Добавьте связи между существами, фракциями и местами — граф проявится сам."}
      action={<Link to="/settings" className="primary" style={{ display: "inline-block", padding: "6px 12px", textDecoration: "none" }}>К сеттингам</Link>}
    />
  ) : (
    <div ref={graphWrapRef} style={{ flex: 1, minHeight: fullscreen ? 0 : height, display: "flex", position: "relative" }}>
      <GraphCanvas
        width={baseCanvas.width}
        height={baseCanvas.height}
        worldWidth={baseCanvas.width}
        worldHeight={baseCanvas.height}
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
        onNodeDrag={(key, x, y) => setManual((prev) => ({ ...prev, [key]: { x, y } }))}
      />
      {/* Stats — top right, below fullscreen button */}
      <span style={{ position: "absolute", top: 36, right: 8, zIndex: 5, fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--muted)", pointerEvents: "none" }}>
        {_graphStats}
      </span>
      {/* Canvas overlay controls */}
      <div style={{ position: "absolute", top: 8, left: 8, display: "flex", gap: 8, zIndex: 5 }}>
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
                  onClick={() => setActiveKinds(new Set(EDGE_KINDS.map((k) => k.key)))}>Все</button>
                <button type="button" className="graph-tb-btn" style={{ fontSize: "9px", padding: "2px 6px" }}
                  onClick={() => setActiveKinds(new Set())}>Нет</button>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
                {EDGE_KINDS.map((k) => {
                  const on = activeKinds.has(k.key);
                  const count = edgeKindCounts.get(k.key) ?? 0;
                  const dash = k.dash;
                  return (
                    <button key={k.key} type="button"
                      className={`graph-tb-btn${on ? " active" : ""}`}
                      style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "10px", padding: "3px 6px", opacity: on ? 1 : 0.45, textAlign: "left" }}
                      onClick={() => setActiveKinds((prev) => { const next = new Set(prev); if (next.has(k.key)) next.delete(k.key); else next.add(k.key); return next; })}>
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
              if (!hiddenTypes.has(n.type)) typesInData.set(n.type, (typesInData.get(n.type) ?? 0) + 1);
            }
            const ORDER = ["character", "being", "artifact", "location", "community", "compendium_entry", "mastering", "scene", "adventure", "campaign", "setting"];
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
            { label: "Изменить размер", onClick: () => { setResizeTarget(menu.node); setMenu(null); } },
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
                value={Math.round((nodeScales.get(resizeTarget.key) ?? 1) * 100)}
                onChange={(e) => { const val = Number(e.target.value) / 100; setNodeScales((prev) => { const next = new Map(prev); if (val === 1) next.delete(resizeTarget.key); else next.set(resizeTarget.key, val); return next; }); }}
                style={{ flex: 1, accentColor: "var(--accent, #c2683f)" }} />
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px", color: "var(--muted)", minWidth: 36 }}>200%</span>
            </div>
            <div style={{ textAlign: "center", fontFamily: "var(--font-mono)", fontSize: "13px" }}>{Math.round((nodeScales.get(resizeTarget.key) ?? 1) * 100)}%</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}>
              {(nodeScales.get(resizeTarget.key) ?? 1) !== 1 && (
                <button type="button" className="graph-tb-btn" onClick={() => setNodeScales((prev) => { const next = new Map(prev); next.delete(resizeTarget.key); return next; })}>Сбросить</button>
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
