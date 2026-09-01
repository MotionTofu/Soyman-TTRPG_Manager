import {
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
import { NavIcon } from "./NavIcons";
import {
  CANVAS_EDGE_PADDING,
  DEFAULT_EDGE_KINDS,
  EDGE_KINDS,
  EDGE_KIND_STYLE,
  buildIsolation,
  findPath,
  foldGroups,
  type GroupMode,
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
  type GraphNode,
  type NodePositions,
} from "../graphTypes";
import { RELATION_TONE_COLORS, RELATION_TONE_LABELS } from "../relations";
import type { RelationTone } from "../types";

const ARROW_PAN_STEP = 90; // на сколько единиц холста двигают стрелки
const MIN_ZOOM = 1;
const MAX_ZOOM = 6;
const FOCUS_ZOOM = 2.2;

// Типы, которые никогда не попадают на граф связей.
const EXCLUDED_GRAPH_TYPES = new Set(["player", "resource"]);

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
  // Под каким ключом хранить расставленные руками узлы. Разные графы —
  // разные карты: у сеттинга своя, у общей страницы своя.
  layoutKey?: string;
  // Скоуп (сеттинг/кампания) — в Row 0, после поиска.
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

// Reusable pan/zoom force-directed graph — the "corkboard with pins and
// threads": drag to pan, scroll/buttons to zoom, click a node to pin focus
// (dims everyone else and centers/zooms on it), search box to jump straight
// to a node without hunting for it visually. Used both by the global
// "Граф связей" page and a setting-scoped graph tab.
export function RelationGraph({ data, height = GRAPH_HEIGHT, emptyMessage, layoutKey, scopeBar }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  // Расставленное руками переживает перезагрузку: карта мира, которую мастер
  // разложил под себя, — это его работа, а не временное состояние экрана.
  const [manual, setManual] = useState<ManualLayout>(() => loadLayout(layoutKey));

  // 0a: смена мира (layoutKey) — другая карта. Состояние manual должно
  // перечитаться из localStorage, иначе раскладка Эстарии налезет на Нестиум.
  useEffect(() => {
    setManual(loadLayout(layoutKey));
    setFocusedKey(null);
    setIsolation(null);
    setView({ zoom: 1, panX: 0, panY: 0 });
  }, [layoutKey]);
  const [groupMode, setGroupMode] = useState<GroupMode>("none");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set());
  // Концы прокладываемого пути: «как этот связан с той фракцией».
  const [pathFrom, setPathFrom] = useState<string | null>(null);
  const [pathTo, setPathTo] = useState<string | null>(null);
  // Изоляция: узел в центре и всё, что с ним связано, на заданное число шагов.
  const [isolation, setIsolation] = useState<{ key: string; depth: number } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; node: GraphNode } | null>(null);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);
  const dragState = useRef<{ key: string; moved: boolean } | null>(null);
  const dragOrigin = useRef<{ x: number; y: number; clientX: number; clientY: number } | null>(null);
  // Какие виды связей показывать. Раньше здесь был один чекбокс «упоминания»,
  // а всё остальное — членство, обитание, вложенность, сцены — рисовалось
  // одинаковой серой линией и не отключалось.
  const [activeKinds, setActiveKinds] = useState<Set<EdgeKind>>(() => new Set(DEFAULT_EDGE_KINDS));
  // Типы сущностей, скрытые из графа через легенду (клик по точке).
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(() => new Set());
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(
    null
  );
  const justPannedRef = useRef(false);
  const rafRef = useRef(0);

  // World-space canvas size — grows with the node count so a large setting's
  // graph has room to spread out instead of everything piling up along the
  // clamped edges of a fixed-size canvas.
  const baseCanvas = data ? canvasSizeFor(data.nodes.length) : { width: GRAPH_WIDTH, height: GRAPH_HEIGHT };

  // Отбор по видам -> отбор по типам -> свёртка в группы -> изоляция.
  // Считается здесь, до раннего выхода: размеры холста и позиции зависят от
  // результата, а ими пользуются обработчики колеса и панорамирования.
  const pipeline = useMemo(() => {
    if (!data) return null;
    const kindEdges = data.edges.filter((e) => activeKinds.has(e.kind));
    // Исключаем типы, которые не участвуют в графе, плюс скрытые через легенду.
    const visibleNodes = data.nodes.filter(
      (n) => !EXCLUDED_GRAPH_TYPES.has(n.type) && !hiddenTypes.has(n.type)
    );
    const visibleKeys = new Set(visibleNodes.map((n) => n.key));
    const typeEdges = kindEdges.filter((e) => visibleKeys.has(e.from) && visibleKeys.has(e.to));
    const grouped = foldGroups(visibleNodes, typeEdges, groupMode, expandedGroups);
    const isolationView = isolation
      ? buildIsolation(grouped.nodes, grouped.edges, isolation.key, isolation.depth)
      : null;
    return { grouped, isolationView };
  }, [data, activeKinds, hiddenTypes, groupMode, expandedGroups, isolation]);

  const isolationView = pipeline?.isolationView ?? null;
  const canvasSize = isolationView
    ? { width: isolationView.width, height: isolationView.height }
    : baseCanvas;

  // Позиции прошлой раскладки: смена фильтра — это то же поле с убранными
  // булавками, а не новая карта, поэтому уцелевшие узлы стартуют оттуда, где
  // их только что видели, и доводятся коротким прогоном.
  // 0e: мутация lastPositions вынесена из useMemo в useEffect — рендер чистый.
  // 3a: на 50+ узлах — в Worker, иначе синхронно.
  const lastPositions = useRef<NodePositions | null>(null);
  const [simulated, setSimulated] = useState<NodePositions>(() => new Map());
  const [simWorking, setSimWorking] = useState(false);

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
    setSimWorking(true);
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
      setSimWorking(false);
      worker.terminate();
    };
    worker.onerror = () => { setSimWorking(false); worker.terminate(); };
    worker.postMessage({ nodes, edges, width: wb, height: hb, seed: seedArr.length > 0 ? seedArr : undefined, pinned: pinned.length > 0 ? pinned : undefined });
    return () => { cancelled = true; setSimWorking(false); worker.terminate(); };
  }, [data, baseCanvas.width, baseCanvas.height]);

  // Позиции для отрисовки: расставленное руками поверх посчитанного. Держится
  // отдельно от simulated, чтобы перетаскивание не гоняло раскладку заново.
  // В изоляции своя радиальная раскладка — ручная карта туда не переносится
  // (кольца по шагам и есть смысл этого вида) и остаётся нетронутой для
  // возврата.
  const positions = useMemo(() => {
    if (isolationView) return isolationView.positions;
    const merged: NodePositions = new Map(simulated);
    for (const [key, p] of Object.entries(manual)) {
      if (merged.has(key)) merged.set(key, { ...p, vx: 0, vy: 0 });
    }
    return merged;
  }, [simulated, manual, isolationView]);

  // New graph data (e.g. a filter changed) invalidates any pinned focus and
  // resets the view — the previously-focused node may no longer exist here.
  useEffect(() => {
    setFocusedKey(null);
    setPathFrom(null);
    setPathTo(null);
    // Новые данные — другая область или другой запрос: изолированного узла в
    // них может не быть вовсе, и вид повис бы без панели выхода.
    if (isolation) console.debug("[RelationGraph] data changed, clearing isolation");
    setIsolation(null);
    setView({ zoom: 1, panX: 0, panY: 0 });
  }, [data]);

  useEffect(() => {
    if (!layoutKey) return;
    try {
      if (Object.keys(manual).length === 0) localStorage.removeItem(LAYOUT_STORE_PREFIX + layoutKey);
      else localStorage.setItem(LAYOUT_STORE_PREFIX + layoutKey, JSON.stringify(manual));
    } catch (e) {
      console.warn("Graph layout not saved:", e);
    }
  }, [manual, layoutKey]);

  useEffect(() => {
    if (!fullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

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

  // «Сделать текущее каноничным»: всё, что сейчас видно, закрепляется на своих
  // местах — дальше карта не переезжает ни при смене фильтров, ни при
  // появлении новых сущностей, двигаются только они.
  function saveLayout() {
    const next: ManualLayout = { ...manual };
    for (const [key, p] of positions) next[key] = { x: p.x, y: p.y };
    setManual(next);
  }

  function resetLayout() {
    if (!layoutKey) return;
    try {
      localStorage.removeItem(LAYOUT_STORE_PREFIX + layoutKey);
    } catch {}
    setManual({});
    lastPositions.current = null;
    setView({ zoom: 1, panX: 0, panY: 0 });
  }

  function isolate(key: string) {
    setIsolation({ key, depth: 1 });
    setFocusedKey(key);
    setPathFrom(null);
    setPathTo(null);
    setMenu(null);
    // Центрирование сделает useEffect по isolationView, когда просчёт готов.
  }

  function leaveIsolation() {
    setIsolation(null);
    setView({ zoom: 1, panX: 0, panY: 0 });
  }

  // 3c: изоляция центрируется (как focusNode), а не в левый верхний угол.
  useEffect(() => {
    if (!isolationView) return;
    const w = isolationView.width;
    const h = isolationView.height;
    const centered = centeredPan(1, w / 2, h / 2, w, h);
    setView({ zoom: 1, panX: centered.x, panY: centered.y });
  }, [isolationView]);

  function handleNodeContextMenu(e: ReactMouseEvent, node: GraphNode) {
    e.preventDefault();
    e.stopPropagation();
    setMenu({ x: e.clientX, y: e.clientY, node });
  }

  function pickPathTo(key: string) {
    setPathTo(key);
    setQuery("");
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

  function panBy(dx: number, dy: number) {
    setView((v) => {
      const clamped = clampPan(v.zoom, v.panX + dx, v.panY + dy, canvasSize.width, canvasSize.height);
      return { ...v, panX: clamped.x, panY: clamped.y };
    });
  }

  // Стрелки двигают холст, когда он в фокусе, — вместе со средней кнопкой это
  // способ ходить по карте, не задевая узлы левой кнопкой.
  function handleKeyDown(e: ReactKeyboardEvent<HTMLDivElement>) {
    const step = ARROW_PAN_STEP / view.zoom;
    if (e.key === "ArrowLeft") panBy(step, 0);
    else if (e.key === "ArrowRight") panBy(-step, 0);
    else if (e.key === "ArrowUp") panBy(0, step);
    else if (e.key === "ArrowDown") panBy(0, -step);
    else return;
    e.preventDefault();
  }

  function startPan(e: ReactPointerEvent<HTMLDivElement>) {
    e.preventDefault();
    panState.current = { startX: e.clientX, startY: e.clientY, originX: view.panX, originY: view.panY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    // Холст должен получить фокус, иначе стрелки уйдут в страницу и она
    // прокрутится вместо графа.
    wrapRef.current?.focus({ preventScroll: true });
    // Средняя кнопка панорамирует откуда угодно, в том числе с узла: это
    // основной способ ходить по карте, когда левая занята перетаскиванием.
    if (e.button === 1) {
      startPan(e);
      return;
    }
    if (e.button !== 0) return;
    const nodeEl = (e.target as HTMLElement).closest(".relation-graph-node");
    if (nodeEl) {
      // Тащат узел, а не фон: запоминаем, откуда он поехал, и ловим указатель
      // на обёртке — она же принимает pointermove и для панорамирования.
      const key = nodeEl.getAttribute("data-key");
      const start = key ? positions.get(key) : null;
      if (!key || !start) return;
      e.preventDefault();
      dragState.current = { key, moved: false };
      dragOrigin.current = { x: start.x, y: start.y, clientX: e.clientX, clientY: e.clientY };
      e.currentTarget.setPointerCapture(e.pointerId);
      return;
    }
    // Левый драг по фону тоже панорамирует — средняя кнопка есть не на всяком
    // тачпаде, и лишать карту единственного привычного способа ходить по ней
    // из-за этого не стоит.
    //
    // preventDefault: без него протаскивание по подписям узлов запускает
    // штатное выделение текста (синяя подсветка), которое срабатывает вопреки
    // user-select: none на обёртке — эта CSS гасит результат, но не сам жест.
    startPan(e);
  }

  function handlePointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragState.current && dragOrigin.current && wrapRef.current) {
      const origin = dragOrigin.current;
      const rect = wrapRef.current.getBoundingClientRect();
      // Экранные пиксели -> единицы холста (svg вписан по ширине) -> мировые
      // координаты (внутри <g> всё ещё умножено на зум).
      const scale = (rect.width / canvasSize.width) * view.zoom;
      const dx = (e.clientX - origin.clientX) / scale;
      const dy = (e.clientY - origin.clientY) / scale;
      // Дрожание руки на клике — не перестановка: пока порог не пройден, узел
      // не попадает в ручную раскладку и не закрепляется в ней.
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragState.current.moved = true;
      if (!dragState.current.moved) return;
      const key = dragState.current.key;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        setManual((prev) => ({
          ...prev,
          [key]: {
            x: Math.max(CANVAS_EDGE_PADDING, Math.min(canvasSize.width - CANVAS_EDGE_PADDING, origin.x + dx)),
            y: Math.max(CANVAS_EDGE_PADDING, Math.min(canvasSize.height - CANVAS_EDGE_PADDING, origin.y + dy)),
          },
        }));
      });
      return;
    }
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
    cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      setView((v) => ({ ...v, panX: clamped.x, panY: clamped.y }));
    });
  }

  function handlePointerUp() {
    if (dragState.current) {
      // Тот же флаг, что и для панорамирования: он гасит клик-фокус, который
      // иначе сработал бы в конце перетаскивания.
      if (dragState.current.moved) justPannedRef.current = true;
      dragState.current = null;
      dragOrigin.current = null;
      return;
    }
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

  function handleNodeClick(n: GraphNode, isFoldedGroup = false) {
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    }
    // Свёрнутая группа по клику раскрывается — это и есть способ посмотреть,
    // кто внутри, не разворачивая всю карту.
    if (isFoldedGroup) {
      setExpandedGroups((prev) => new Set(prev).add(n.key));
      setFocusedKey(n.key);
      return;
    }
    if (expandedGroups.has(n.key)) {
      setExpandedGroups((prev) => {
        const next = new Set(prev);
        next.delete(n.key);
        return next;
      });
      return;
    }
    if (focusedKey === n.key) setFocusedKey(null);
    else focusNode(n.key);
  }

  const searchMatches = useMemo(() => {
    if (!data || !debouncedQuery.trim()) return [];
    const q = debouncedQuery.trim().toLowerCase();
    return data.nodes.filter((n) => n.title.toLowerCase().includes(q)).slice(0, 8);
  }, [data, debouncedQuery]);

  const [highlightIdx, setHighlightIdx] = useState(-1);
  useEffect(() => { setHighlightIdx(-1); }, [debouncedQuery]);

  const nodesByKey = useMemo(() => {
    if (!data) return new Map<string, GraphNode>();
    return new Map(data.nodes.map((n) => [n.key, n]));
  }, [data]);

  const visibleNodes = isolationView ? isolationView.nodes : pipeline?.grouped.nodes ?? [];
  const visibleEdges = isolationView ? isolationView.edges : pipeline?.grouped.edges ?? [];
  const groupedFoldedCount = pipeline?.grouped.folded.size ?? 0;

  const visibleKeys = useMemo(() => new Set(visibleNodes.map((n) => n.key)), [visibleNodes]);

  const pairCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of visibleEdges) {
      const k = pairKey(e.from, e.to);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    return counts;
  }, [visibleEdges]);

  if (!data) return <p className="muted">Загрузка…</p>;
  // pipeline depends on data — if data is non-null, pipeline is too.
  if (!pipeline) return <p className="muted">Загрузка…</p>;

  // Конвейер посчитан выше (см. pipeline): отбор по видам -> свёртка в группы
  // -> изоляция. В изоляции рисуется только окрестность выбранного узла.
  const grouped = pipeline.grouped;

  // Путь между двумя выбранными узлами — по тем же видимым связям.
  const path =
    pathFrom && pathTo ? findPath(visibleEdges, pathFrom, pathTo) : null;
  const pathKeys = path ? new Set(path.keys) : null;
  const pathEdges = path ? new Set(path.edges) : null;

  // Dimming only ever reacts to a pinned focus, never to hover — hover-driven
  // dimming made the graph flicker as the cursor passed over nodes.
  const neighborKeys = focusedKey
    ? new Set(
        visibleEdges
          .filter((e) => e.from === focusedKey || e.to === focusedKey)
          .flatMap((e) => [e.from, e.to])
      )
    : null;

  const focusedNode = data.nodes.find((n) => n.key === focusedKey) ?? null;
  // Искать имеет смысл только среди нарисованного: свёрнутый внутрь группы
  // узел найдётся, но прыгать будет некуда.
  // Метка «поставлен руками» имеет смысл, пока такие узлы — исключение. После
  // «Сохранить раскладку» закреплены все, и метка на каждом узле перестаёт
  // что-либо различать, оставаясь просто рябью.
  const showPins = Object.keys(manual).length < visibleNodes.length;
  const shownMatches = searchMatches.filter((n) => visibleKeys.has(n.key));

  const counterScale = labelScale(view.zoom) / view.zoom;

  const toolbar = (
    <div className="graph-toolbar">
      {/* Row 0: search | filters | scope | group */}
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
              else if (e.key === "Enter" && highlightIdx >= 0) {
                e.preventDefault();
                const pick = shownMatches[highlightIdx];
                if (pick) (pathFrom && !pathTo ? pickPathTo(pick.key) : focusNode(pick.key));
              } else if (e.key === "Escape") setQuery("");
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
                  <div
                    key={n.key}
                    className={`entity-search-item${idx === highlightIdx ? " highlighted" : ""}`}
                    onClick={() => (pathFrom && !pathTo ? pickPathTo(n.key) : focusNode(n.key))}
                    onMouseEnter={() => setHighlightIdx(idx)}
                  >
                    <span className={`entity-type-chip ${n.type}`}>{TYPE_LABELS[n.type] ?? n.type}</span>
                    <span>{before}{match && <mark style={{ background: "var(--accent-soft)", padding: 0 }}>{match}</mark>}{after}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      {scopeBar && (
        <>
          <span className="graph-toolbar-sep" />
          <div className="graph-toolbar-row">{scopeBar}</div>
        </>
      )}
      <span className="graph-toolbar-sep" />
      <div className="graph-toolbar-row">
        <button
          type="button"
          className={`graph-tb-btn${groupMode === "community" ? " active" : ""}`}
          onClick={() => setGroupMode(groupMode === "community" ? "none" : "community")}
          title="Свернуть членов фракций внутрь: персонажи и существа спрячутся под узлом фракции"
        >
          Фракции
        </button>
        <button
          type="button"
          className={`graph-tb-btn${groupMode === "location" ? " active" : ""}`}
          onClick={() => setGroupMode(groupMode === "location" ? "none" : "location")}
          title="Свернуть обитателей внутрь локаций: существа спрячутся под узлом места"
        >
          Локации
        </button>
      </div>
      {/* Row: виды связей — чекбоксы с N, бары остаются, чипы остаются */}
      <span className="graph-toolbar-sep" />
      <div className="graph-toolbar-row" style={{ gap: 4, flexWrap: "wrap" }}>
        {EDGE_KINDS.map((k) => {
          const on = activeKinds.has(k.key);
          const count = data ? data.edges.filter((e) => e.kind === k.key).length : 0;
          return (
            <label
              key={k.key}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                fontFamily: "var(--font-ui)",
                fontSize: "10px",
                letterSpacing: "0.06em",
                textTransform: "uppercase",
                opacity: on ? 1 : 0.45,
                cursor: "pointer",
              }}
              title={`${k.label}: ${count}`}
            >
              <input
                type="checkbox"
                checked={on}
                onChange={() =>
                  setActiveKinds((prev) => {
                    const next = new Set(prev);
                    if (next.has(k.key)) next.delete(k.key);
                    else next.add(k.key);
                    return next;
                  })
                }
                style={{ accentColor: "var(--ink)" }}
              />
              {k.label}
              <span style={{ fontFamily: "var(--font-mono)", fontSize: "10px", opacity: 0.7 }}>({count})</span>
            </label>
          );
        })}
      </div>
      {/* Мини-ключ штрихов (solid/dashed) */}
      <span className="graph-toolbar-sep" />
      <div className="graph-toolbar-row muted" style={{ fontFamily: "var(--font-mono)", fontSize: "9px", gap: 8 }}>
        <span title="Отношения — сплошная 1px">— сплошная</span>
        <span title="Вложенность мест — штрих 6 3">- - 6 3</span>
        <span title="Участие в сценах — штрих 2 3">· · 2 3</span>
        <span title="Упоминания — штрих 1 4">· · 1 4</span>
      </div>
      {/* Row 1: fullscreen | zoom | save | reset */}
      <span className="graph-toolbar-sep" />
      <div className="graph-toolbar-row">
        <button
          type="button"
          className="graph-tb-btn"
          onClick={() => setFullscreen((v) => !v)}
          title={fullscreen ? "Закрыть (Esc)" : "На весь экран"}
        >
          {fullscreen ? "Свернуть" : <><NavIcon name="fullscreen" /> Весь экран</>}
        </button>
        <button type="button" className="graph-tb-btn" onClick={() => zoomBy(1 / 1.3)} title="Отдалить">
          <NavIcon name="minus" />
        </button>
        <button type="button" className="graph-tb-btn" onClick={() => zoomBy(1.3)} title="Приблизить">
          <NavIcon name="plus" />
        </button>
        <button
          type="button"
          className="graph-tb-btn"
          onClick={() => {
            const svg = wrapRef.current?.querySelector("svg");
            if (!svg) return;
            const clone = svg.cloneNode(true) as SVGElement;
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            // Фон paper для печати (иначе прозрачный)
            clone.style.background = "var(--paper, #fff)";
            const data = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([data], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `graph-${layoutKey || "global"}.svg`;
            a.click();
            URL.revokeObjectURL(url);
          }}
          title="Скачать SVG (вектор)"
        >
          SVG
        </button>
        <button
          type="button"
          className="graph-tb-btn"
          onClick={() => {
            const svg = wrapRef.current?.querySelector("svg");
            if (!svg) return;
            const clone = svg.cloneNode(true) as SVGElement;
            clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
            const data = new XMLSerializer().serializeToString(clone);
            const blob = new Blob([data], { type: "image/svg+xml" });
            const url = URL.createObjectURL(blob);
            const img = new Image();
            img.onload = () => {
              const canvas = document.createElement("canvas");
              const vb = svg.viewBox.baseVal;
              const w = Math.ceil(vb.width || canvasSize.width);
              const h = Math.ceil(vb.height || canvasSize.height);
              canvas.width = w * 2;
              canvas.height = h * 2;
              const ctx = canvas.getContext("2d");
              if (!ctx) return;
              ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--paper") || "#fff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
              canvas.toBlob((b) => {
                if (!b) return;
                const u2 = URL.createObjectURL(b);
                const a = document.createElement("a");
                a.href = u2;
                a.download = `graph-${layoutKey || "global"}.png`;
                a.click();
                URL.revokeObjectURL(u2);
              }, "image/png");
              URL.revokeObjectURL(url);
            };
            img.src = url;
          }}
          title="Скачать PNG (растр 2×)"
        >
          PNG
        </button>
        {!isolationView && (
          <>
            <button
              type="button"
              className="graph-tb-btn"
              onClick={saveLayout}
              title="Закрепить всё, что сейчас на экране"
            >
              Сохранить раскладку
            </button>
            <button
              type="button"
              className="graph-tb-btn"
              onClick={resetLayout}
              title="Сбросить ручную раскладку — удалить сохранённые позиции"
            >
              Сбросить раскладку
            </button>
            {groupedFoldedCount > 0 && (
              <button
                type="button"
                className="graph-tb-btn"
                onClick={() => setExpandedGroups(new Set())}
                title="Развернуть все свёрнутые группы"
              >
                Развернуть всё ({groupedFoldedCount})
              </button>
            )}
          </>
        )}
        <button type="button" className="graph-tb-btn" onClick={resetView}>
          Сбросить вид ({Math.round(view.zoom * 100)}%)
        </button>
      </div>
      {focusedNode && (
        <div className="row relation-graph-focus-panel">
          <span className={`entity-type-chip ${focusedNode.type}`}>
            {TYPE_LABELS[focusedNode.type] ?? focusedNode.type}
          </span>
          <strong>{focusedNode.title}</strong>
          {TYPE_ROUTES[focusedNode.type] && (
            <Link to={`${TYPE_ROUTES[focusedNode.type]}/${focusedNode.id}`}>Открыть страницу →</Link>
          )}
          <button
            type="button"
            onClick={() => {
              setPathFrom(focusedNode.key);
              setPathTo(null);
              setQuery("");
            }}
            title="Проложить цепочку от этой сущности до другой"
          >
            Путь отсюда…
          </button>
          <button type="button" onClick={() => setFocusedKey(null)}>
            Снять фокус
          </button>
        </div>
      )}
      {isolationView && (
        <div className="row relation-graph-focus-panel">
          <button type="button" onClick={leaveIsolation}>
            ← Вернуться ко всему графу
          </button>
          <strong>{nodesByKey.get(isolation!.key)?.title ?? "?"}</strong>
          <span className="muted">
            шагов: {isolation!.depth}, узлов вокруг: {isolationView.nodes.length - 1}
          </span>
          <button
            type="button"
            disabled={isolationView.nextStepCount === 0}
            onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth + 1 })}
            title={
              isolationView.nextStepCount === 0
                ? "Дальше связей нет — дальше этого круга сущность ни с чем не соединена"
                : "Показать связи следующего порядка"
            }
          >
            Добавить шаг {isolationView.nextStepCount > 0 && `(+${isolationView.nextStepCount})`}
          </button>
          {isolation!.depth > 1 && (
            <button
              type="button"
              onClick={() => setIsolation((prev) => prev && { ...prev, depth: prev.depth - 1 })}
            >
              Убрать шаг
            </button>
          )}
        </div>
      )}
      {pathFrom && (
        <div className="row relation-graph-focus-panel">
          <strong>Путь:</strong>
          <span>{nodesByKey.get(pathFrom)?.title ?? "?"}</span>
          {!pathTo && <span className="muted">выберите вторую сущность в поиске слева</span>}
          {pathTo && !path && (
            <span className="muted">
              связи между ними в этом срезе нет — попробуйте включить больше видов связей
            </span>
          )}
          {path && (
            <span className="relation-graph-path-chain">
              {path.keys.slice(1).map((key, i) => (
                <span key={key}>
                  {" ⟶ "}
                  {path.edges[i]?.section && (
                    <span className="muted">[{path.edges[i].section}] </span>
                  )}
                  {nodesByKey.get(key)?.title ?? "?"}
                </span>
              ))}
            </span>
          )}
          <button
            type="button"
            onClick={() => {
              setPathFrom(null);
              setPathTo(null);
            }}
          >
            Сбросить путь
          </button>
        </div>
      )}
    </div>
  );

  const legend = (() => {
    // Считаем типы по ВСЕМ узлам данных (не только видимым), чтобы легенда
    // показывала все доступные типы и давала включать/выключать.
    // Исключены типы, которые не участвуют в графе (player, resource).
    const typesInData = new Map<string, number>();
    for (const n of data?.nodes ?? []) {
      if (!EXCLUDED_GRAPH_TYPES.has(n.type)) typesInData.set(n.type, (typesInData.get(n.type) ?? 0) + 1);
    }
    const allTypeKeys = [...typesInData.keys()];
    const allVisible = hiddenTypes.size === 0;
    const ORDER: string[] = [
      "character",
      "being",
      "artifact",
      "location",
      "community",
      "compendium_entry",
      "mastering",
      "scene",
      "adventure",
      "campaign",
      "setting",
    ];
    const orderedLegendTypes = ORDER.filter((t) => typesInData.has(t));
    for (const t of typesInData.keys()) if (!orderedLegendTypes.includes(t)) orderedLegendTypes.push(t);
    return (
      <div className="relation-graph-legend">
        <button
          type="button"
          className="graph-tb-btn"
          onClick={() =>
            setHiddenTypes((prev) => {
              if (prev.size === 0) return new Set(allTypeKeys);
              return new Set();
            })
          }
        >
          {allVisible ? "СНЯТЬ ВСЁ" : "ВЫБРАТЬ ВСЁ"}
        </button>
        {orderedLegendTypes.map((type) => {
          const hidden = hiddenTypes.has(type);
          const needsSep = type === "scene";
          return (
            <>
              {needsSep && <span className="graph-toolbar-sep" style={{ height: 18 }} />}
              <button
                key={type}
                type="button"
                className="graph-tb-btn"
                style={{ opacity: hidden ? 0.4 : 1 }}
                onClick={() =>
                  setHiddenTypes((prev) => {
                    const next = new Set(prev);
                    if (next.has(type)) next.delete(type);
                    else next.add(type);
                    return next;
                  })
                }
                title={hidden ? `Показать ${TYPE_LABELS[type] ?? type}` : `Скрыть ${TYPE_LABELS[type] ?? type}`}
              >
              {(() => {
                const shape = TYPE_SHAPES[type] ?? "rect";
                const fill = TYPE_COLORS[type] ?? "#888";
                if (shape === "diamond") {
                  return (
                    <span
                      title="◇ ромб — локации"
                      style={{
                        display: "inline-block",
                        width: 8,
                        height: 8,
                        background: fill,
                        flexShrink: 0,
                        border: "1px solid var(--line)",
                        transform: "rotate(45deg)",
                      }}
                    />
                  );
                }
                if (shape === "triangle") {
                  return (
                    <span
                      title="▲ треугольник — персонажи/сообщества"
                      style={{
                        display: "inline-block",
                        width: 0,
                        height: 0,
                        flexShrink: 0,
                        borderLeft: "5px solid transparent",
                        borderRight: "5px solid transparent",
                        borderBottom: `9px solid ${fill}`,
                        filter: "drop-shadow(0 0 0 var(--line))",
                      }}
                    />
                  );
                }
                if (shape === "triangleInverted") {
                  return (
                    <span
                      title="▼ перевёрнутый треугольник — существа"
                      style={{
                        display: "inline-block",
                        width: 0,
                        height: 0,
                        flexShrink: 0,
                        borderLeft: "5px solid transparent",
                        borderRight: "5px solid transparent",
                        borderTop: `9px solid ${fill}`,
                      }}
                    />
                  );
                }
                if (shape === "triangleRight") {
                  return (
                    <span
                      title="▶ треугольник вправо — персонажи"
                      style={{
                        display: "inline-block",
                        width: 0,
                        height: 0,
                        flexShrink: 0,
                        borderTop: "5px solid transparent",
                        borderBottom: "5px solid transparent",
                        borderLeft: `9px solid ${fill}`,
                      }}
                    />
                  );
                }
                if (shape === "star") {
                  return (
                    <span
                      title="★ звёздочка — артефакты"
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 12,
                        height: 12,
                        flexShrink: 0,
                        color: fill,
                        fontSize: "12px",
                        lineHeight: 1,
                        textShadow: "0 0 0 var(--line)",
                      }}
                    >
                      ★
                    </span>
                  );
                }
                return (
                  <span
                    title="■ квадрат — кампании/сеттинги/сцены/предметы"
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      background: fill,
                      flexShrink: 0,
                      border: "1px solid var(--line)",
                    }}
                  />
                );
              })()}
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "11px", letterSpacing: "0.06em", textTransform: "uppercase" }}>
                {TYPE_LABELS[type] ?? type}
              </span>
            </button>
            </>
          );
          })}
      </div>
    );
  })();

  const isolated = (data.isolated ?? []).filter((n) => !EXCLUDED_GRAPH_TYPES.has(n.type));
  const isolatedPanel = isolated.length > 0 && (
    <details className="card relation-graph-isolated" open>
      <summary>
        Без связей в этом срезе: {isolated.length}
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        <span className="muted" style={{ fontFamily: "var(--font-body)", fontSize: "12px" }}>
          Эти сущности есть в выбранной области, но ни с чем не соединены — их не видно на холсте. Добавьте связь на странице сущности.
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

  const graphStats = data ? `${visibleNodes.length} узлов · ${visibleEdges.length} связей${isolated.length > 0 ? ` · ${isolated.length} без связей` : ""}` : "";
  const graphBody =
    data.nodes.length === 0 ? (
      <EmptyState
        icon="anarchyStar"
        title="СХЕМЫ ПОКА НЕТ"
        hint={emptyMessage ?? "Добавьте связи между существами, фракциями и местами — граф проявится сам."}
        action={
          <Link to="/settings" className="primary" style={{ display: "inline-block", padding: "6px 12px", textDecoration: "none" }}>
            К сеттингам
          </Link>
        }
      />
    ) : simWorking ? (
      <div className="card" style={{ padding: "24px", textAlign: "center" }}>
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>Считаю раскладку…</span>
      </div>
    ) : (
      <div
        ref={wrapRef}
        className="relation-graph-wrap"
        style={{
          height: fullscreen ? undefined : height,
          flex: fullscreen ? 1 : undefined,
          backgroundImage: "radial-gradient(var(--line) 0.6px, transparent 0.6px)",
          backgroundSize: "8px 8px",
          backgroundPosition: "0 0",
        }}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onClick={handleBackgroundClick}
        // Своё меню на узлах; на фоне штатное тоже ни к чему — оно перекрывает
        // карту и ничего полезного для графа не предлагает.
        onContextMenu={(e) => e.preventDefault()}
        onAuxClick={(e) => e.preventDefault()}
      >
        {/* Статистика в правом верхнем углу холста — как на скрине, без плашки «СХЕМА СВЯЗЕЙ» */}
        <div
          style={{
            position: "absolute",
            top: 6,
            right: 8,
            zIndex: 1,
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            letterSpacing: "0.04em",
            color: "var(--muted)",
            background: "color-mix(in srgb, var(--paper-2) 92%, transparent)",
            padding: "2px 6px",
            border: "1px solid var(--line)",
            pointerEvents: "none",
          }}
        >
          {graphStats}
        </div>
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
              const onPath = pathEdges?.has(e) ?? false;
              // В режиме пути всё, что не цепочка, уходит на задний план —
              // иначе саму цепочку в тысяче линий не разглядеть.
              const offPath = pathKeys != null && !onPath;
              // В изоляции подписи показываются у всех связей: туда и заходят
              // затем, чтобы прочитать, чем именно сущность связана с
              // окружением, а узлов там немного.
              const showLabel =
                (onPath ||
                  isolationView != null ||
                  (focusedKey && (e.from === focusedKey || e.to === focusedKey))) &&
                relationLabel;
              const midX = (ax + bx) / 2;
              const midY = (ay + by) / 2;

              return (
                <g key={i}>
                  <line
                    x1={ax}
                    y1={ay}
                    x2={bx}
                    y2={by}
                    stroke={onPath ? "var(--accent, #c2683f)" : color}
                    strokeOpacity={offPath ? 0.08 : dim ? 0.12 : onPath ? 1 : tone ? 0.6 : 0.5}
                    strokeWidth={onPath ? 1.5 : 1}
                    strokeDasharray={onPath ? undefined : kindStyle?.dash}
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
                        style={{ fontFamily: "var(--font-ui)", letterSpacing: "0.06em", textTransform: "uppercase" } as React.CSSProperties}
                      >
                        {relationLabel}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
            {visibleNodes.map((n) => {
              const p = positions.get(n.key);
              if (!p) return null;
              const foldedCount = grouped.folded.get(n.key) ?? 0;
              const onPath = pathKeys?.has(n.key) ?? false;
              const offPath = pathKeys != null && !onPath;
              const dim = neighborKeys && !neighborKeys.has(n.key) && focusedKey !== n.key;
              const pinned = showPins && manual[n.key] != null;
              // Свёрнутая группа крупнее ровно настолько, насколько она
              // «толще»: узел на десять жителей должен выглядеть весомее
              // одиночки, но не заслонять карту.
              const radius = (focusedKey === n.key ? 12 : 9) + Math.min(6, foldedCount * 0.4);
              return (
                <g
                  key={n.key}
                  className="relation-graph-node"
                  data-key={n.key}
                  transform={`translate(${p.x},${p.y})`}
                  style={{ cursor: "grab" }}
                  opacity={offPath ? 0.15 : dim ? 0.25 : 1}
                  role="button"
                  aria-label={`${TYPE_LABELS[n.type] ?? n.type}: ${n.title}`}
                  tabIndex={0}
                  onClick={(e) => {
                    e.stopPropagation();
                    handleNodeClick(n, foldedCount > 0);
                  }}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    isolate(n.key);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleNodeClick(n, foldedCount > 0);
                    }
                  }}
                  onContextMenu={(e) => handleNodeContextMenu(e, n)}
                >
                  {(() => {
                    const shape = TYPE_SHAPES[n.type] ?? "rect";
                    const fill = TYPE_COLORS[n.type] ?? "#888";
                    // Прямые углы, без радиусов (§1.1). Размер — по foldedCount.
                    if (shape === "diamond") {
                      return (
                        <polygon
                          points={`0,${-radius} ${radius},0 0,${radius} ${-radius},0`}
                          fill={fill}
                          stroke={onPath ? "var(--accent, #c2683f)" : focusedKey === n.key ? "var(--ink)" : "var(--line)"}
                          strokeWidth={onPath ? 1.5 : 1}
                        />
                      );
                    }
                    if (shape === "triangle") {
                      return (
                        <polygon
                          points={`0,${-radius} ${radius},${radius} ${-radius},${radius}`}
                          fill={fill}
                          stroke={onPath ? "var(--accent, #c2683f)" : focusedKey === n.key ? "var(--ink)" : "var(--line)"}
                          strokeWidth={onPath ? 1.5 : 1}
                        />
                      );
                    }
                    if (shape === "triangleInverted") {
                      return (
                        <polygon
                          points={`0,${radius} ${radius},${-radius} ${-radius},${-radius}`}
                          fill={fill}
                          stroke={onPath ? "var(--accent, #c2683f)" : focusedKey === n.key ? "var(--ink)" : "var(--line)"}
                          strokeWidth={onPath ? 1.5 : 1}
                        />
                      );
                    }
                    if (shape === "triangleRight") {
                      return (
                        <polygon
                          points={`${-radius},${-radius} ${-radius},${radius} ${radius},0`}
                          fill={fill}
                          stroke={onPath ? "var(--accent, #c2683f)" : focusedKey === n.key ? "var(--ink)" : "var(--line)"}
                          strokeWidth={onPath ? 1.5 : 1}
                        />
                      );
                    }
                    if (shape === "star") {
                      // Пышная 5-лучёвка — толстые лучи, хорошо читается на 9px радиусе.
                      // rInner 0.62 = более «надутая», чем тонкая 0.45 — не иголки, а пухляши.
                      const rOuter = radius;
                      const rInner = radius * 0.62;
                      const pts: string[] = [];
                      for (let i = 0; i < 10; i++) {
                        const r = i % 2 === 0 ? rOuter : rInner;
                        const angle = (Math.PI * 2 * i) / 10 - Math.PI / 2;
                        pts.push(`${(Math.cos(angle) * r).toFixed(1)},${(Math.sin(angle) * r).toFixed(1)}`);
                      }
                      return (
                        <polygon
                          points={pts.join(" ")}
                          fill={fill}
                          stroke={onPath ? "var(--accent, #c2683f)" : focusedKey === n.key ? "var(--ink)" : "var(--line)"}
                          strokeWidth={onPath ? 1.5 : 1}
                        />
                      );
                    }
                    return (
                      <rect
                        x={-radius}
                        y={-radius}
                        width={radius * 2}
                        height={radius * 2}
                        fill={fill}
                        stroke={onPath ? "var(--accent, #c2683f)" : focusedKey === n.key ? "var(--ink)" : "var(--line)"}
                        strokeWidth={onPath ? 1.5 : 1}
                      />
                    );
                  })()}
                  {pinned && (
                    // Квадрат внутри — метка «стоит там, где поставили руками» (не круг, §1.1).
                    <rect x={-2.5} y={-2.5} width={5} height={5} fill="var(--paper)" opacity={0.9} />
                  )}
                  {/* React escapes {n.title} automatically — safe from XSS */}
                  <text
                    x={radius + 5}
                    y={4}
                    fontSize={11}
                    fill="var(--ink)"
                    style={{ fontFamily: "var(--font-body)" }}
                  >
                    {n.title}
                    {foldedCount > 0 && (
                      <tspan style={{ fontFamily: "var(--font-mono)", fontSize: "10px" }} className="muted">
                        {" "}
                        +{foldedCount}
                      </tspan>
                    )}
                  </text>
                  <title>
                    {`${TYPE_LABELS[n.type] ?? n.type}: ${n.title}` +
                      (foldedCount > 0 ? ` — свёрнуто внутрь: ${foldedCount}, нажмите, чтобы раскрыть` : "") +
                      " — клик фокус, двойной клик — окрестность"}
                  </title>
                </g>
              );
            })}
          </g>
          </svg>
        </div>
    );

  // Меню и карточка живут вне обоих вариантов вёрстки (обычной и
  // полноэкранной) — иначе при переключении они бы пропадали.
  const overlays = (
    <>
      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={[
            { label: "Изолировать узел и связи", onClick: () => isolate(menu.node.key) },
            {
              label: "Карточка сущности",
              onClick: () => {
                setPreview({ type: menu.node.type, id: menu.node.id });
                setMenu(null);
              },
            },
            ...(TYPE_ROUTES[menu.node.type]
              ? [
                  {
                    label: "Перейти к сущности",
                    onClick: () => navigate(`${TYPE_ROUTES[menu.node.type]}/${menu.node.id}`),
                  },
                ]
              : []),
            ...(expandedGroups.has(menu.node.key)
              ? [
                  {
                    label: "Свернуть группу",
                    onClick: () => {
                      setExpandedGroups((prev) => {
                        const next = new Set(prev);
                        next.delete(menu.node.key);
                        return next;
                      });
                      setMenu(null);
                    },
                  },
                ]
              : []),
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {preview && (
        <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />
      )}
    </>
  );

  if (fullscreen) {
    return createPortal(
      <div className="relation-graph-fullscreen">
        <div
          className="relation-graph-fullscreen-bar"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 8,
            padding: "8px 12px",
            background: "var(--surface)",
            color: "var(--on-surface)",
            borderBottom: "1px solid var(--line)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase" }}>Граф связей — весь экран</span>
            <button type="button" className="graph-tb-btn" onClick={() => setFullscreen(false)} style={{ background: "var(--paper)", color: "var(--ink)" }}>
              × Закрыть (Esc)
            </button>
          </div>
          {toolbar}
          {legend}
        </div>
        {graphBody}
        {overlays}
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
      {overlays}
    </div>
  );
}
