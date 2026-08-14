import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { NavIcon } from "./NavIcons";
import {
  DEFAULT_EDGE_KINDS,
  EDGE_KINDS,
  EDGE_KIND_STYLE,
  GRAPH_HEIGHT,
  GRAPH_WIDTH,
  TYPE_COLORS,
  TYPE_LABELS,
  TYPE_ROUTES,
  canvasSizeFor,
  simulateGraph,
  type EdgeKind,
  type GraphData,
  type GraphNode,
  type NodePositions,
} from "../graphTypes";
import { RELATION_TONES, RELATION_TONE_COLORS, RELATION_TONE_LABELS } from "../relations";
import type { RelationTone } from "../types";

const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const FOCUS_ZOOM = 2.2;

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

function clampPan(
  zoom: number,
  panX: number,
  panY: number,
  canvasW: number,
  canvasH: number
): { x: number; y: number } {
  const clampAxis = (scaled: number, size: number, pan: number) =>
    scaled <= size ? (size - scaled) / 2 : Math.min(0, Math.max(size - scaled, pan));
  return {
    x: clampAxis(canvasW * zoom, canvasW, panX),
    y: clampAxis(canvasH * zoom, canvasH, panY),
  };
}

function centeredPan(zoom: number, contentX: number, contentY: number, canvasW: number, canvasH: number) {
  return clampPan(zoom, canvasW / 2 - contentX * zoom, canvasH / 2 - contentY * zoom, canvasW, canvasH);
}

// Unordered key for a node pair — used to detect when both A→B and B→A
// exist, so the two directions can be drawn as separate offset lines
// instead of overlapping into what looks like one plain edge.
function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

const RELATION_ARROW_OFFSET = 5; // world units apart, for a bidirectional pair
const ARROW_POSITIONS = [0.3, 0.5, 0.7]; // a few chevrons along the line, not just at the tip
const EDGE_LABEL_FONT_SIZE = 9;

// Edge labels grow with zoom, but slower than the map itself — a 100% zoom
// increase (zoom 1 -> 2) should only make the label ~50% bigger, not 100%,
// or text on a close-up graph gets comically huge. The <g> that holds
// everything is already scaled by `zoom`, so to land on `labelScale(zoom)`
// on screen the label itself needs an inverse counter-scale of
// labelScale(zoom) / zoom.
function labelScale(zoom: number) {
  return 1 + 0.5 * (zoom - 1);
}

interface Props {
  data: GraphData | null;
  height?: number;
  emptyMessage?: string;
}

// Reusable pan/zoom force-directed graph — the "corkboard with pins and
// threads": drag to pan, scroll/buttons to zoom, click a node to pin focus
// (dims everyone else and centers/zooms on it), search box to jump straight
// to a node without hunting for it visually. Used both by the global
// "Граф связей" page and a setting-scoped graph tab.
export function RelationGraph({ data, height = GRAPH_HEIGHT, emptyMessage }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  // Какие виды связей показывать. Раньше здесь был один чекбокс «упоминания»,
  // а всё остальное — членство, обитание, вложенность, сцены — рисовалось
  // одинаковой серой линией и не отключалось.
  const [activeKinds, setActiveKinds] = useState<Set<EdgeKind>>(() => new Set(DEFAULT_EDGE_KINDS));
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(
    null
  );
  const justPannedRef = useRef(false);

  // World-space canvas size — grows with the node count so a large setting's
  // graph has room to spread out instead of everything piling up along the
  // clamped edges of a fixed-size canvas.
  const canvasSize = data ? canvasSizeFor(data.nodes.length) : { width: GRAPH_WIDTH, height: GRAPH_HEIGHT };

  // Позиции прошлой раскладки: смена фильтра — это то же поле с убранными
  // булавками, а не новая карта, поэтому уцелевшие узлы стартуют оттуда, где
  // их только что видели, и доводятся коротким прогоном.
  const lastPositions = useRef<NodePositions | null>(null);
  const positions = useMemo(() => {
    if (!data) return new Map() as NodePositions;
    const next = simulateGraph(
      data.nodes,
      data.edges,
      canvasSize.width,
      canvasSize.height,
      lastPositions.current ?? undefined
    );
    lastPositions.current = next;
    return next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // New graph data (e.g. a filter changed) invalidates any pinned focus and
  // resets the view — the previously-focused node may no longer exist here.
  useEffect(() => {
    setFocusedKey(null);
    setView({ zoom: 1, panX: 0, panY: 0 });
  }, [data]);

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  // Deps include `data`: the wrap <div> (and wrapRef.current) only exists
  // once data has loaded — with `data` left out of the deps list, this
  // effect ran once while still showing "Загрузка…" (no element to attach
  // to yet) and never got a second chance to attach once the graph
  // actually rendered, which is why wheel-zoom silently did nothing.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
      setView((v) => {
        const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
        if (newZoom === v.zoom) return v;
        const centerX = (canvasSize.width / 2 - v.panX) / v.zoom;
        const centerY = (canvasSize.height / 2 - v.panY) / v.zoom;
        const clamped = centeredPan(newZoom, centerX, centerY, canvasSize.width, canvasSize.height);
        return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
    // Also re-runs on `fullscreen`: the wrap is a *different* DOM node
    // inline vs. inside the fullscreen portal, so the ref target changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, fullscreen]);

  function zoomBy(factor: number) {
    setView((v) => {
      const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v.zoom * factor));
      if (newZoom === v.zoom) return v;
      const centerX = (canvasSize.width / 2 - v.panX) / v.zoom;
      const centerY = (canvasSize.height / 2 - v.panY) / v.zoom;
      const clamped = centeredPan(newZoom, centerX, centerY, canvasSize.width, canvasSize.height);
      return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
    });
  }

  function resetView() {
    setView({ zoom: 1, panX: 0, panY: 0 });
    setFocusedKey(null);
  }

  function focusNode(key: string) {
    const p = positions.get(key);
    if (!p) return;
    const zoom = Math.max(view.zoom, FOCUS_ZOOM);
    const clamped = centeredPan(zoom, p.x, p.y, canvasSize.width, canvasSize.height);
    setView({ zoom, panX: clamped.x, panY: clamped.y });
    setFocusedKey(key);
    setQuery("");
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".relation-graph-node")) return;
    // Without this, dragging across the SVG's node-label <text> elements
    // triggers the browser's native text-selection (a blue-highlight drag
    // select), which fires even though the wrap has user-select: none —
    // that CSS suppresses the *result* but not the drag-select gesture
    // itself starting on mousedown.
    e.preventDefault();
    panState.current = { startX: e.clientX, startY: e.clientY, originX: view.panX, originY: view.panY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (!panState.current || !wrapRef.current) return;
    const rect = wrapRef.current.getBoundingClientRect();
    const scale = rect.width / canvasSize.width;
    const dx = (e.clientX - panState.current.startX) / scale;
    const dy = (e.clientY - panState.current.startY) / scale;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) panState.current.moved = true;
    const clamped = clampPan(
      view.zoom,
      panState.current.originX + dx,
      panState.current.originY + dy,
      canvasSize.width,
      canvasSize.height
    );
    setView((v) => ({ ...v, panX: clamped.x, panY: clamped.y }));
  }

  function handlePointerUp() {
    if (panState.current?.moved) justPannedRef.current = true;
    panState.current = null;
  }

  function handleBackgroundClick() {
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    }
    setFocusedKey(null);
  }

  function handleNodeClick(n: GraphNode) {
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    }
    if (focusedKey === n.key) setFocusedKey(null);
    else focusNode(n.key);
  }

  const searchMatches = useMemo(() => {
    if (!data || !query.trim()) return [];
    const q = query.trim().toLowerCase();
    return data.nodes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [data, query]);

  if (!data) return <p className="muted">Загрузка…</p>;

  const visibleEdges = data.edges.filter((e) => activeKinds.has(e.kind));

  // Dimming only ever reacts to a pinned focus, never to hover — hover-driven
  // dimming made the graph flicker as the cursor passed over nodes.
  const neighborKeys = focusedKey
    ? new Set(
        visibleEdges
          .filter((e) => e.from === focusedKey || e.to === focusedKey)
          .flatMap((e) => [e.from, e.to])
      )
    : null;

  const focusedNode = focusedKey ? data.nodes.find((n) => n.key === focusedKey) : null;
  const nodesByKey = new Map(data.nodes.map((n) => [n.key, n]));
  const pairCounts = new Map<string, number>();
  for (const e of visibleEdges) {
    const k = pairKey(e.from, e.to);
    pairCounts.set(k, (pairCounts.get(k) ?? 0) + 1);
  }

  const counterScale = labelScale(view.zoom) / view.zoom;

  const toolbar = (
    <div className="row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="row" style={{ position: "relative" }}>
        <input
          placeholder="Найти сущность…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {searchMatches.length > 0 && (
          <div className="entity-search-results">
            {searchMatches.map((n) => (
              <div key={n.key} className="entity-search-item" onClick={() => focusNode(n.key)}>
                <span className={`entity-type-chip ${n.type}`}>{TYPE_LABELS[n.type] ?? n.type}</span>
                {n.title}
              </div>
            ))}
          </div>
        )}
      </div>
      <button type="button" onClick={() => zoomBy(1.3)} title="Приблизить">
        <NavIcon name="plus" />
      </button>
      <button type="button" onClick={() => zoomBy(1 / 1.3)} title="Отдалить">
        <NavIcon name="minus" />
      </button>
      <button type="button" onClick={resetView}>
        Сбросить вид ({Math.round(view.zoom * 100)}%)
      </button>
      <button
        type="button"
        onClick={() => setFullscreen((v) => !v)}
        title={fullscreen ? "Закрыть (Esc)" : "На весь экран"}
      >
        {fullscreen ? (
          "Свернуть"
        ) : (
          <>
            <NavIcon name="fullscreen" /> На весь экран
          </>
        )}
      </button>
      {focusedNode && (
        <div className="row relation-graph-focus-panel">
          <span className={`entity-type-chip ${focusedNode.type}`}>
            {TYPE_LABELS[focusedNode.type] ?? focusedNode.type}
          </span>
          <strong>{focusedNode.title}</strong>
          {TYPE_ROUTES[focusedNode.type] && (
            <Link to={`${TYPE_ROUTES[focusedNode.type]}/${focusedNode.id}`}>Открыть страницу →</Link>
          )}
          <button type="button" onClick={() => setFocusedKey(null)}>
            Снять фокус
          </button>
        </div>
      )}
    </div>
  );

  // Сколько рёбер каждого вида есть в этих данных — галочка без числа не
  // говорит, стоит ли её вообще трогать.
  const kindCounts = new Map<EdgeKind, number>();
  for (const e of data.edges) kindCounts.set(e.kind, (kindCounts.get(e.kind) ?? 0) + 1);

  const legend = (
    <div className="relation-graph-legend">
      {RELATION_TONES.map((t) => (
        <span key={t.key} className="row" style={{ gap: 4 }}>
          <span
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: t.color,
            }}
          />
          {t.label}
        </span>
      ))}
      <span className="relation-graph-legend-sep" />
      {EDGE_KINDS.map((k) => {
        const count = kindCounts.get(k.key) ?? 0;
        return (
          <label key={k.key} className="row" style={{ gap: 4, opacity: count ? 1 : 0.45 }}>
            <input
              type="checkbox"
              checked={activeKinds.has(k.key)}
              disabled={count === 0}
              onChange={() =>
                setActiveKinds((prev) => {
                  const next = new Set(prev);
                  if (next.has(k.key)) next.delete(k.key);
                  else next.add(k.key);
                  return next;
                })
              }
            />
            <svg width="18" height="8" aria-hidden>
              <line
                x1="1"
                y1="4"
                x2="17"
                y2="4"
                stroke="var(--ink)"
                strokeWidth={k.width}
                strokeDasharray={k.dash}
              />
            </svg>
            {k.label} <span className="muted">{count}</span>
          </label>
        );
      })}
    </div>
  );

  const isolated = data.isolated ?? [];
  const isolatedPanel = isolated.length > 0 && (
    <details className="card relation-graph-isolated">
      <summary>
        Ни одной связи в этом срезе: {isolated.length}
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <span className="muted">
          Эти сущности есть в выбранной области, но ни с чем не соединены — их не видно на холсте.
        </span>
        <div className="relation-graph-isolated-list">
          {isolated.map((n) => {
            const route = TYPE_ROUTES[n.type];
            return (
              <span key={n.key} className="row" style={{ gap: 4 }}>
                <span className={`entity-type-chip ${n.type}`}>{TYPE_LABELS[n.type] ?? n.type}</span>
                {route ? <Link to={`${route}/${n.id}`}>{n.title}</Link> : n.title}
              </span>
            );
          })}
        </div>
      </div>
    </details>
  );

  const graphBody =
    data.nodes.length === 0 ? (
      <p className="muted">{emptyMessage ?? "Связей пока нет — перетаскивайте сущности друг на друга из поиска."}</p>
    ) : (
      <div
        ref={wrapRef}
        className="relation-graph-wrap"
        style={{ height: fullscreen ? undefined : height, flex: fullscreen ? 1 : undefined }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleBackgroundClick}
      >
        <svg viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`} width="100%" height="100%">
          <g transform={`translate(${view.panX},${view.panY}) scale(${view.zoom})`}>
            {visibleEdges.map((e, i) => {
              const a = positions.get(e.from);
              const b = positions.get(e.to);
              if (!a || !b) return null;
              const dim = neighborKeys && !neighborKeys.has(e.from) && !neighborKeys.has(e.to);
              const tone = e.tone as RelationTone | null;
              const color = tone ? RELATION_TONE_COLORS[tone] : "var(--line)";
              const kindStyle = EDGE_KIND_STYLE[e.kind];
              const fromTitle = nodesByKey.get(e.from)?.title ?? "?";
              const toTitle = nodesByKey.get(e.to)?.title ?? "?";
              const relationLabel = e.section || (tone ? RELATION_TONE_LABELS[tone] : null);
              const tooltip = `${fromTitle} → ${toTitle}${relationLabel ? `: ${relationLabel}` : ""}`;

              // A directional relation shares its pair with a reverse
              // (A→B and B→A) — offset each to its own side so the two
              // don't paint as a single indistinguishable line. The
              // perpendicular is computed from a canonical lo→hi direction
              // (not e.from→e.to, which flips between the two directions
              // of the same pair and would cancel the offset back out) —
              // only the sign flips, based on which side this edge is on.
              const bidirectional = tone && (pairCounts.get(pairKey(e.from, e.to)) ?? 0) > 1;
              let ax = a.x, ay = a.y, bx = b.x, by = b.y;
              if (bidirectional) {
                const loKey = e.from < e.to ? e.from : e.to;
                const loPos = positions.get(loKey)!;
                const hiPos = loKey === e.from ? b : a;
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
              // Flip a near-vertical/upside-down label 180° so it never
              // renders upside down — readability matters more than the
              // label always pointing the same way as the arrows.
              const labelAngle = angle > 90 || angle < -90 ? angle + 180 : angle;
              const showLabel = focusedKey && (e.from === focusedKey || e.to === focusedKey) && relationLabel;
              const midX = (ax + bx) / 2;
              const midY = (ay + by) / 2;

              return (
                <g key={i}>
                  <line
                    x1={ax}
                    y1={ay}
                    x2={bx}
                    y2={by}
                    stroke={color}
                    strokeOpacity={dim ? 0.12 : tone ? 0.75 : 0.6}
                    strokeWidth={kindStyle?.width ?? 1}
                    strokeDasharray={kindStyle?.dash}
                  >
                    <title>{tooltip}</title>
                  </line>
                  {tone &&
                    !dim &&
                    ARROW_POSITIONS.map((t, ai) => (
                      <polygon
                        key={ai}
                        points="-5,-3 4,0 -5,3"
                        transform={`translate(${ax + (bx - ax) * t},${ay + (by - ay) * t}) rotate(${angle})`}
                        fill={color}
                        opacity={dim ? 0.12 : 0.85}
                      />
                    ))}
                  {showLabel && (
                    <g transform={`translate(${midX},${midY}) rotate(${labelAngle}) scale(${counterScale})`}>
                      <text
                        y={-4}
                        fontSize={EDGE_LABEL_FONT_SIZE}
                        textAnchor="middle"
                        fill="var(--ink)"
                        stroke="var(--paper)"
                        strokeWidth={3}
                        paintOrder="stroke"
                      >
                        {relationLabel}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            {data.nodes.map((n) => {
              const p = positions.get(n.key);
              if (!p) return null;
              const dim = neighborKeys && !neighborKeys.has(n.key) && focusedKey !== n.key;
              return (
                <g
                  key={n.key}
                  className="relation-graph-node"
                  transform={`translate(${p.x},${p.y})`}
                  style={{ cursor: "pointer" }}
                  opacity={dim ? 0.25 : 1}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodeClick(n);
                  }}
                >
                  <circle
                    r={focusedKey === n.key ? 12 : 9}
                    fill={TYPE_COLORS[n.type] ?? "#888"}
                    stroke={focusedKey === n.key ? "var(--ink)" : "none"}
                    strokeWidth={2}
                  />
                  <text x={14} y={4} fontSize={11} fill="var(--ink)">
                    {n.title}
                  </text>
                  <title>{`${TYPE_LABELS[n.type] ?? n.type}: ${n.title}`}</title>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    );

  if (fullscreen) {
    return createPortal(
      <div className="relation-graph-fullscreen">
        <div className="relation-graph-fullscreen-bar">
          {toolbar}
          {legend}
        </div>
        {graphBody}
      </div>,
      document.body
    );
  }

  return (
    <div className="stack">
      {toolbar}
      {legend}
      {graphBody}
      {isolatedPanel}
    </div>
  );
}
