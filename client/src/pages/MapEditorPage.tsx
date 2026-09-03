import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { brushCells, cellCenter, cellDistance, cellKey, coordLabel, neighbors, parseKey, pixelToCell, worldBounds } from "../maps/grid";
import { buildAndDownloadPng } from "../maps/mapExport";
import { buildMapExport, sanitizeDownloadName, validateMapImport } from "../maps/mapExchange";
import { generateCells, type GeneratorParams } from "../maps/generate";
import { fixMapConnectivity, generateDungeon } from "../maps/dungeon";
import {
  MAP_BIOME_TERRAINS,
  MAP_FLOOR_TERRAINS,
  MAP_TERRAIN_FILL,
  MAP_TERRAIN_LABELS,
  MAP_TERRAIN_ORDER,
  MAP_TOOL_ORDER,
  MAP_DOOR_LABELS,
  MAP_DOOR_KINDS,
  MAP_DOOR_FILL,
  MAP_TRAP_LABELS,
  MAP_TRAP_GLYPHS,
  MAP_TRAP_KINDS,
  MAP_MARKER_LABELS,
  MAP_MARKER_GLYPHS,
  MAP_MARKER_KINDS,
  MAP_RIVER_FILL,
  MAP_RIVER_LABEL,
  MAP_ROOM_LABELS,
  MAP_ROOM_TINT,
  MAP_ROOM_TYPES,
  cellsBlobStatus,
  doorForView,
  parseCellsBlob,
  readChrome,
  renderMap,
  renderThumbnail,
  serializeCells,
  type MapCells,
  type MapDoorEdge,
  type MapDoorKind,
  type MapMarkerKind,
  type MapRoomType,
  type MapTrapKind,
} from "../maps/render";
import {
  MAP_GRID_LABELS,
  MAP_SCALE_LABELS,
  MAP_SCALE_ORDER,
  MAP_MIN_SIDE,
  MAP_MAX_SIDE,
  formatMeters,
  parseCellLore,
  translateMapError,
  type MapFull,
  type MapScale,
} from "../maps/mapTypes";

type PaintTool =
  | "brush"
  | "fill"
  | "eraser"
  | "picker"
  | "road"
  | "river"
  | "wall"
  | "shape"
  | "ruler"
  | "label"
  | "select"
  | "door"
  | "trap"
  | "chest"
  | "altar"
  | "marker"
  | "start"
  | "finish";
type BrushSize = 1 | 2 | 3;

const UNDO_DEPTH = 50;
const AUTOSAVE_MS = 800;

function cloneCells(c: MapCells): MapCells {
  return {
    terrain: new Map(c.terrain),
    roads: new Set(c.roads),
    rivers: new Set(c.rivers),
    labels: c.labels.map((l) => ({ ...l })),
    rooms: c.rooms.map((r) => ({ ...r })),
    doors: c.doors.map((d) => ({ ...d })),
    traps: c.traps.map((t) => ({ ...t })),
    markers: c.markers.map((m) => ({ ...m })),
    start: c.start ? { ...c.start } : null,
    finish: c.finish ? { ...c.finish } : null,
  };
}

// Мазок кистью/оверлеем/ластиком по клеткам вокруг центра. Возвращает,
// изменилось ли хоть что-то (неменявший мазок в историю не идёт).
function paintStroke(
  draft: MapCells,
  grid: MapFull["grid"],
  width: number,
  height: number,
  cx: number,
  cy: number,
  size: BrushSize,
  tool: PaintTool,
  terrain: string
): boolean {
  let changed = false;
  for (const cell of brushCells(grid, cx, cy, size, width, height)) {
    const key = cellKey(cell.x, cell.y);
    if (tool === "road" || tool === "river") {
      // Оверлеи ложатся поверх любого террейна (река — и поверх дороги: мост дорисуется сам).
      const set = tool === "road" ? draft.roads : draft.rivers;
      if (!set.has(key)) {
        set.add(key);
        changed = true;
      }
    } else if (tool === "eraser") {
      if ((draft.terrain.get(key) ?? "plain") !== "plain") {
        draft.terrain.delete(key);
        changed = true;
      }
      if (draft.roads.has(key)) {
        draft.roads.delete(key);
        changed = true;
      }
      if (draft.rivers.has(key)) {
        draft.rivers.delete(key);
        changed = true;
      }
    } else {
      if ((draft.terrain.get(key) ?? "plain") !== terrain) {
        if (terrain === "plain") draft.terrain.delete(key);
        else draft.terrain.set(key, terrain);
        changed = true;
      }
    }
  }
  return changed;
}

// Заливка связной области одного террейна (4-связность на квадратах,
// 6 — на гексах). Край поля — естественная граница.
function floodFill(
  draft: MapCells,
  grid: MapFull["grid"],
  width: number,
  height: number,
  sx: number,
  sy: number,
  terrain: string
): boolean {
  const start = cellKey(sx, sy);
  const from = draft.terrain.get(start) ?? "plain";
  if (from === terrain) return false;
  const seen = new Set<string>([start]);
  const stack = [{ x: sx, y: sy }];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    for (const n of neighbors(grid, cur.x, cur.y)) {
      if (n.x < 0 || n.y < 0 || n.x >= width || n.y >= height) continue;
      const key = cellKey(n.x, n.y);
      if (seen.has(key)) continue;
      if ((draft.terrain.get(key) ?? "plain") !== from) continue;
      seen.add(key);
      stack.push(n);
    }
  }
  for (const key of seen) {
    if (terrain === "plain") draft.terrain.delete(key);
    else draft.terrain.set(key, terrain);
  }
  return seen.size > 0;
}

// Замер линейки (P1-2): на квадратах — евклид по прямой (Чебышев врал по диагонали:
// 5 клеток по диагонали — не 5, а ~7.1), на гексах — шаги cellDistance.
function rulerMeasure(
  grid: MapFull["grid"],
  ax: number,
  ay: number,
  bx: number,
  by: number
): { cells: string; dist: number } {
  if (grid === "square") {
    const d = Math.hypot(bx - ax, by - ay);
    return { cells: (Math.round(d * 10) / 10).toString().replace(".", ","), dist: d };
  }
  const steps = cellDistance(grid, ax, ay, bx, by);
  return { cells: String(steps), dist: steps };
}

// Растеризация отрезка в клетки (стены линией, Этап E): суперкавер сэмплированием —
// шаг в пол-клетки не оставляет дыр ни на прямой, ни на диагонали.
export function traceLineCells(
  grid: MapFull["grid"],
  width: number,
  height: number,
  a: { x: number; y: number },
  b: { x: number; y: number }
): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y)) * 2));
  for (let i = 0; i <= steps; i++) {
    const wx = a.x + ((b.x - a.x) * i) / steps;
    const wy = a.y + ((b.y - a.y) * i) / steps;
    const cell = pixelToCell(grid, wx, wy, width, height);
    if (!cell) continue;
    const k = cellKey(cell.x, cell.y);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cell);
  }
  return out;
}

interface Camera {
  scale: number;
  ox: number;
  oy: number;
}

function loadFlag(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}

export function MapEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const canEdit = user?.role !== "player";

  const [map, setMap] = useState<MapFull | null>(null);
  const [cells, setCells] = useState<MapCells>(() => ({
    terrain: new Map(),
    roads: new Set(),
    rivers: new Set(),
    labels: [],
    rooms: [],
    doors: [],
    traps: [],
    markers: [],
    start: null,
    finish: null,
  }));
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Битый blob (P1-7): показываем пустую карту, автосейв поверх — только после
  // явного разрешения (иначе первая правка молча хоронила бы исходные данные).
  const [blobCorrupt, setBlobCorrupt] = useState(false);

  const [cam, setCam] = useState<Camera>({ scale: 24, ox: 0, oy: 0 });
  const [hover, setHover] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(() => loadFlag("maps.showGrid", true));
  const [showCoords, setShowCoords] = useState(() => loadFlag("maps.showCoords", false));
  const [spaceDown, setSpaceDown] = useState(false);

  // Инструменты (тикет 04). Пипетка и заливка — одноразовые действия,
  // кисть/дорога/ластик — мазки от нажатия до отпускания.
  const [tool, setTool] = useState<PaintTool>("brush");
  const [terrain, setTerrain] = useState<string>("forest");
  const [brushSize, setBrushSize] = useState<BrushSize>(1);
  const [saveState, setSaveState] = useState<{ kind: "saved" | "dirty" | "saving" | "error"; at: string }>({
    kind: "saved",
    at: "",
  });
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [dialog, confirm] = useConfirm();

  // Генератор (тикет 05): параметры живут отдельно, уходят в то же
  // автосохранение, что и клетки. Сид/ползунки без «Сгенерировать» карту
  // не меняют — только запоминаются для следующего прогона.
  const [genOpen, setGenOpen] = useState(false);
  const [genParams, setGenParams] = useState<GeneratorParams>({ seed: 0, sea: 55, mountains: 12, forest: 30 });

  // История эфемерная (не переживает перезагрузку): прошлое/будущее —
  // снимки клеток, мазок целиком — один шаг.
  const pastRef = useRef<MapCells[]>([]);
  const futureRef = useRef<MapCells[]>([]);
  const strokeRef = useRef<{ before: MapCells; changed: boolean } | null>(null);
  const paintingRef = useRef(false);
  // C3: pointermove шлёт события чаще кадров — копим последнюю точку и красим
  // один раз за кадр, иначе каждый move клонирует весь Map клеток.
  const paintRafRef = useRef(0);
  const pendingPaintRef = useRef<{ wx: number; wy: number } | null>(null);

  function flushPaint() {
    paintRafRef.current = 0;
    const p = pendingPaintRef.current;
    pendingPaintRef.current = null;
    if (!p) return;
    if (paintAt(p.wx, p.wy) && strokeRef.current) strokeRef.current.changed = true;
  }

  function cancelPendingPaint() {
    if (paintRafRef.current) cancelAnimationFrame(paintRafRef.current);
    paintRafRef.current = 0;
    flushPaint();
  }
  const lastSavedRef = useRef<string>("");
  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const camRef = useRef(cam);
  camRef.current = cam;
  const dragRef = useRef<{ button: number; sx: number; sy: number; ox: number; oy: number } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number; mx: number; my: number } | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    setBlobCorrupt(false);
    api
      .get<MapFull>(`/maps/${id}`)
      .then((data) => {
        if (!alive) return;
        setMap(data);
        const parsed = parseCellsBlob(data.cells);
        setCells(parsed);
        // Эталон — в нормализованной форме (порядок ключей/пробелы сырого
        // blob'а иначе давали бы ложное «изменено» и сохранение при открытии).
        const params = { seed: data.seed, sea: data.sea, mountains: data.mountains, forest: data.forest };
        lastSavedRef.current = serializeCells(parsed) + "|" + JSON.stringify(params);
        setGenParams(params);
        pastRef.current = [];
        futureRef.current = [];
        setCanUndo(false);
        setCanRedo(false);
        setSaveState({ kind: "saved", at: "" });
        setBindings([]);
        setShared(false);
        loadBindings(data.id);
        if (cellsBlobStatus(data.cells) === "corrupt") setBlobCorrupt(true);
      })
      .catch((e) => {
        if (!alive) return;
        setLoadError(String(e instanceof Error ? e.message : e));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [id]);

  // --- Undo/redo ---

  function pushHistory(before: MapCells) {
    pastRef.current.push(before);
    if (pastRef.current.length > UNDO_DEPTH) pastRef.current.shift();
    futureRef.current = [];
    setCanUndo(true);
    setCanRedo(false);
  }

  function undo() {
    const prev = pastRef.current.pop();
    if (!prev) return;
    futureRef.current.push(cloneCells(cellsRef.current));
    cellsRef.current = prev;
    setCells(prev);
    setCanUndo(pastRef.current.length > 0);
    setCanRedo(true);
  }

  function redo() {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneCells(cellsRef.current));
    cellsRef.current = next;
    setCells(next);
    setCanUndo(true);
    setCanRedo(futureRef.current.length > 0);
  }

  // --- Автосохранение (debounce; пропуск, если клетки равны последним
  // сохранённым — так загрузка и undo-в-ту-же-точку ничего не шлют) ---
  // Версии против гонки (P1-6): два overlapping PUT — побеждает поздний
  // мазок, а не поздний ответ; устаревший ответ игнорируется по seq.
  const saveSeqRef = useRef(0);
  const pendingSeqRef = useRef(0);
  // Кэш миниатюры (P1-5): печь canvas+toDataURL на каждый мазок дорого.
  // Клетки те же — шлём готовое; строчим быстрее 2.5с — шлём null (сервер
  // COALESCE оставляет старое превью); на паузе — печём свежее.
  const thumbCacheRef = useRef<{ cells: string; thumb: string | null; at: number }>({
    cells: "",
    thumb: null,
    at: 0,
  });

  function pickThumbnail(m: MapFull, cellsStr: string, live: MapCells): string | null {
    const cached = thumbCacheRef.current;
    if (cellsStr === cached.cells) return cached.thumb;
    if (Date.now() - cached.at < 2500) return null;
    const thumb = renderThumbnail(m.grid, m.width, m.height, live, readChrome());
    thumbCacheRef.current = { cells: cellsStr, thumb, at: Date.now() };
    return thumb;
  }

  function sendSave(payload: { cellsStr: string; paramsStr: string; thumb: string | null; params: GeneratorParams }) {
    if (!map) return;
    const seq = ++saveSeqRef.current;
    pendingSeqRef.current = seq;
    setSaveState((s) => ({ ...s, kind: "saving" }));
    api
      .put(`/maps/${map.id}`, { cells: payload.cellsStr, thumbnail: payload.thumb, ...payload.params })
      .then(() => {
        if (pendingSeqRef.current !== seq) return;
        lastSavedRef.current = payload.cellsStr + "|" + payload.paramsStr;
        setSaveState({ kind: "saved", at: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) });
      })
      .catch(() => {
        if (pendingSeqRef.current !== seq) return;
        setSaveState((s) => ({ ...s, kind: "error" }));
      });
  }

  useEffect(() => {
    if (!map) return;
    if (blobCorrupt) return; // P1-7: поверх битого — только с явного разрешения
    const cellsStr = serializeCells(cells);
    const paramsStr = JSON.stringify(genParams);
    if (cellsStr + "|" + paramsStr === lastSavedRef.current) return;
    setSaveState((s) => (s.kind === "saving" ? s : { kind: "dirty", at: s.at }));
    const snapshot = { live: cells, params: genParams };
    const timer = setTimeout(() => {
      if (!map) return;
      sendSave({ cellsStr, paramsStr, thumb: pickThumbnail(map, cellsStr, snapshot.live), params: snapshot.params });
    }, AUTOSAVE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, genParams, map, blobCorrupt]);

  // Повтор сохранения вручную (P0-1): при kind === "error" следующий мазок
  // и так повторит, но закрытие вкладки до него теряло данные — поэтому
  // рядом со статусом есть кнопка «Повторить», а уход с несохранённым
  // тормозит beforeunload.
  function retrySave() {
    if (!map) return;
    const live = cellsRef.current;
    const cellsStr = serializeCells(live);
    const paramsStr = JSON.stringify(genParams);
    if (cellsStr + "|" + paramsStr === lastSavedRef.current) {
      setSaveState({ kind: "saved", at: new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) });
      return;
    }
    sendSave({ cellsStr, paramsStr, thumb: pickThumbnail(map, cellsStr, live), params: genParams });
  }

  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      // P0-D: ошибка сохранения — тоже несохранённые данные (кнопка «Повторить»
      // есть, но уход до неё молча терял бы работу).
      if (saveState.kind === "dirty" || saveState.kind === "saving" || saveState.kind === "error") e.preventDefault();
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [saveState.kind]);

  // Д-14: индикатор несохранённого в title вкладки — тулбар не виден с другой
  // вкладки, а beforeunload без контекста («у вас правки на карте XYZ»).
  const baseTitleRef = useRef(document.title);
  useEffect(() => {
    if (!map) return;
    const base = `Карта «${map.name}» — SoyMan`;
    document.title =
      saveState.kind === "saved" ? base : `● ${base} (не сохранено)`;
    return () => {
      document.title = baseTitleRef.current;
    };
  }, [map?.name, saveState.kind]);

  // --- Генератор ---

  // Вкладки панели (пакет C): суша (noise) и подземелье (комнаты). Сид общий.
  // U6: вкладка запоминается — данженмастер не кликает «Подземелье» каждый раз.
  const [genTab, setGenTabState] = useState<"land" | "dungeon">(() => {
    try {
      return localStorage.getItem("maps.genTab") === "dungeon" ? "dungeon" : "land";
    } catch {
      return "land";
    }
  });
  function setGenTab(t: "land" | "dungeon") {
    setGenTabState(t);
    try {
      localStorage.setItem("maps.genTab", t);
    } catch {
      // приватный режим — просто не запоминаем
    }
  }
  const [dunRooms, setDunRooms] = useState(9);
  const [dunCorr, setDunCorr] = useState<1 | 2 | "mixed">("mixed");
  const [dunLoops, setDunLoops] = useState(25);
  const [dunSecrets, setDunSecrets] = useState(true);
  const [dunTraps, setDunTraps] = useState<"none" | "some" | "many">("some");

  function mapNonEmpty(): boolean {
    const cur = cellsRef.current;
    return (
      cur.terrain.size > 0 ||
      cur.roads.size > 0 ||
      cur.rivers.size > 0 ||
      cur.labels.length > 0 ||
      cur.rooms.length > 0 ||
      cur.doors.length > 0 ||
      cur.traps.length > 0 ||
      cur.markers.length > 0 ||
      cur.start !== null ||
      cur.finish !== null
    );
  }

  // Генерация затирает клетки целиком (P0-5): по непустой карте — только
  // через подтверждение. Отмена генерации шагом истории живёт лишь до
  // перезагрузки, диалог — единственная защита часов ручной росписи.
  async function generate() {
    if (!map) return;
    if (genTab === "dungeon") {
      await generateDungeonRun();
      return;
    }
    const cur = cellsRef.current;
    if (mapNonEmpty()) {
      const ok = await confirm({
        title: "Сгенерировать заново?",
        message: `Генерация затрет всю роспись, дороги, реки, подписи, маркеры и объекты (сид ${genParams.seed}, море ${genParams.sea}, горы ${genParams.mountains}, лес ${genParams.forest}). Шаг попадёт в историю, но история не переживает перезагрузку.`,
        confirmLabel: "Сгенерировать",
        cancelLabel: "Отмена",
        danger: true,
      });
      if (!ok) return;
    }
    const before = cloneCells(cellsRef.current);
    const next = generateCells(map.grid, map.width, map.height, genParams);
    cellsRef.current = next;
    setCells(next);
    pushHistory(before);
  }

  async function generateDungeonRun(override?: {
    rooms: number;
    corr: 1 | 2 | "mixed";
    loops: number;
    secrets: boolean;
    traps: "none" | "some" | "many";
  }) {
    if (!map) return;
    if (map.grid !== "square") {
      setActionError("Подземелье — только на квадратах: данж на гексах следующим шагом.");
      return;
    }
    const rooms = override?.rooms ?? dunRooms;
    if (mapNonEmpty()) {
      const ok = await confirm({
        title: "Сгенерировать подземелье?",
        message: `Генерация затрет всю карту — террейн, дороги, реки, подписи, маркеры и объекты — и начертит данж (сид ${genParams.seed}, комнат ${rooms}). Шаг попадёт в историю, но история не переживает перезагрузку.`,
        confirmLabel: "Сгенерировать",
        cancelLabel: "Отмена",
        danger: true,
      });
      if (!ok) return;
    }
    const before = cloneCells(cellsRef.current);
    const next = generateDungeon(map.width, map.height, {
      seed: genParams.seed,
      rooms,
      corrWidth: override?.corr ?? dunCorr,
      loops: override?.loops ?? dunLoops,
      secrets: override?.secrets ?? dunSecrets,
      traps: override?.traps ?? dunTraps,
    });
    cellsRef.current = next;
    setCells(next);
    pushHistory(before);
    setActionError(null);
  }

  // Д-4: быстрый данж в один клик — пресет поверх текущих ползунков
  // (ползунки тоже выставляем, чтобы повтор кнопкой «Сгенерировать» дал то же).
  async function quickDungeon() {
    const preset = { rooms: 5, corr: 1 as const, loops: 25, secrets: true, traps: "some" as const };
    setDunRooms(preset.rooms);
    setDunCorr(preset.corr);
    setDunLoops(preset.loops);
    setDunSecrets(preset.secrets);
    setDunTraps(preset.traps);
    await generateDungeonRun(preset);
  }

  // Ручная починка связности (пакет C): коридоры к изолированным комнатам,
  // двери не трогаем (в отличие от генерации, где топология финальная).
  function fixConnectivity() {
    if (!map) return;
    const res = fixMapConnectivity(cellsRef.current, map.width, map.height);
    if (!res) {
      setActionError("Починить нечего: на карте нет комнат.");
      return;
    }
    if (res.cleared.length === 0) {
      setActionError("Всё связно — чинить нечего.");
      return;
    }
    const before = cloneCells(cellsRef.current);
    const draft = cloneCells(before);
    for (const k of res.cleared) draft.terrain.delete(k);
    cellsRef.current = draft;
    setCells(draft);
    pushHistory(before);
    setActionError(null);
  }

  function rollSeed() {
    setGenParams((p) => ({ ...p, seed: Math.floor(Math.random() * 2147483647) }));
  }

  // --- Экспорт PNG (P0-7): тем же рендером + легенда и масштаб для печати ---

  const PNG_DENSITIES = [16, 24, 32, 48, 64] as const;
  const [pngOpen, setPngOpen] = useState(false);
  const [pngGrid, setPngGrid] = useState(true);
  // На бумаге без координат не сослаться («идёте в B12»), поэтому в экспорте
  // дефолт — вкл (на экране дефолт остаётся выкл).
  const [pngCoords, setPngCoords] = useState(true);
  const [pngLegend, setPngLegend] = useState(true);
  const [pngDensity, setPngDensity] = useState<number>(32);
  const [pngName, setPngName] = useState("map");
  // PNG глазами игрока (пакет A §6): без секретного слоя.
  const [pngPlayerView, setPngPlayerView] = useState(false);
  // Легенда террейна (P2-3): тот же фиксированный набор, что в PNG позже (P0-7).
  const [legendOpen, setLegendOpen] = useState(false);
  // Миникарта (пакет D): превью всего поля + рамка вьюпорта, клик — прыжок.
  const [miniThumb, setMiniThumb] = useState<string | null>(null);

  useEffect(() => {
    if (!map) return;
    const timer = setTimeout(() => {
      setMiniThumb(renderThumbnail(map.grid, map.width, map.height, cellsRef.current, readChrome()));
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, map]);

  function jumpToMini(e: React.MouseEvent) {
    const wrap = wrapRef.current;
    if (!wrap || !map) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wrect = wrap.getBoundingClientRect();
    const b = worldBounds(map.grid, map.width, map.height);
    const fx = (e.clientX - box.left) / box.width;
    const fy = (e.clientY - box.top) / box.height;
    const wx = b.minX + fx * (b.maxX - b.minX);
    const wy = b.minY + fy * (b.maxY - b.minY);
    setCam((c) => ({ ...c, ox: wrect.width / 2 - wx * c.scale, oy: wrect.height / 2 - wy * c.scale }));
  }

  // Настройки карты (P1-8): черновики полей модалки + ошибка действий
  // (дубль/удаление/сохранение настроек) одной строкой над полем.
  const [settingsOpen, setSettingsOpen] = useState(false);  const [sName, setSName] = useState("");
  const [sScale, setSScale] = useState<MapScale>("continent");
  const [sLore, setSLore] = useState("");
  const [sWidth, setSWidth] = useState(0);
  const [sHeight, setSHeight] = useState(0);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Привязки многие-ко-многим (P2-4): только мастер. Сущности для селектов
  // грузятся лениво при раскрытии карточки; локации — через выбор сеттинга.
  interface MapBinding {
    id: number;
    map_id: number;
    target_type: "setting" | "campaign" | "location";
    target_id: number;
    target_name?: string | null;
  }
  const BIND_TYPE_LABELS: Record<MapBinding["target_type"], string> = {
    setting: "Сеттинг",
    campaign: "Кампания",
    location: "Локация",
  };
  const [bindOpen, setBindOpen] = useState(false);
  const [bindings, setBindings] = useState<MapBinding[]>([]);
  const [bindSettings, setBindSettings] = useState<{ id: number; name: string }[]>([]);
  const [bindType, setBindType] = useState<MapBinding["target_type"]>("setting");
  const [bindOptions, setBindOptions] = useState<{ id: number; name: string }[]>([]);
  const [bindSetting, setBindSetting] = useState<number>(0);
  const [bindTarget, setBindTarget] = useState<number>(0);
  const [bindError, setBindError] = useState<string | null>(null);

  async function loadBindings(mapId: number) {
    try {
      const rows = await api.get<MapBinding[]>(`/maps/${mapId}/bindings`);
      setBindings(rows);
    } catch (e) {
      setBindError(translateMapError(e));
    }
  }

  async function loadBindOptions(type: MapBinding["target_type"], settingId: number) {
    setBindOptions([]);
    setBindTarget(0);
    try {
      if (type === "location") {
        if (!settingId) return;
        const rows = await api.get<{ id: number; name: string }[]>(
          `/setting-locations?setting_id=${settingId}`
        );
        setBindOptions(rows.map((r) => ({ id: r.id, name: r.name })));
      } else {
        const rows = await api.get<{ id: number; name: string }[]>(type === "setting" ? "/settings" : "/campaigns");
        setBindOptions(rows.map((r) => ({ id: r.id, name: r.name })));
      }
    } catch (e) {
      setBindError(translateMapError(e));
    }
  }

  async function addBinding() {
    if (!map || !bindTarget) {
      setBindError("Выберите сущность для привязки.");
      return;
    }
    setBindError(null);
    try {
      await api.post(`/maps/${map.id}/bindings`, { target_type: bindType, target_id: bindTarget });
      setBindTarget(0);
      await loadBindings(map.id);
    } catch (e) {
      setBindError(translateMapError(e));
    }
  }

  async function removeBinding(bindingId: number) {
    if (!map) return;
    setBindError(null);
    try {
      await api.del(`/maps/${map.id}/bindings/${bindingId}`);
      await loadBindings(map.id);
    } catch (e) {
      setBindError(translateMapError(e));
    }
  }

  // Показ игрокам (P2-5): выставить флаг + тост со ссылкой. Канала автопуша нет,
  // поэтому честно: открываем видимость и даём ссылку, игроки обновляют раздел сами.
  const [shared, setShared] = useState(false);

  async function shareWithPlayers() {
    if (!map) return;
    setActionError(null);
    try {
      if (map.player_visible !== 1) {
        await api.put(`/maps/${map.id}`, { player_visible: 1 });
        setMap((m) => (m ? { ...m, player_visible: 1 } : m));
      }
      try {
        await navigator.clipboard.writeText(`${window.location.origin}/maps/${map.id}`);
      } catch {
        // буфер недоступен (не-HTTPS/приват) — ссылка всё равно видна в тосте ниже
      }
      setShared(true);
    } catch (e) {
      setActionError(translateMapError(e));
    }
  }

  // Селекты привязок — лениво при раскрытии; список привязок — при загрузке
  // карты и при раскрытии (могли поменять в другом окне).
  useEffect(() => {
    if (!bindOpen || !map) return;
    setBindError(null);
    loadBindings(map.id);
    api
      .get<{ id: number; name: string }[]>("/settings")
      .then((rows) => setBindSettings(rows.map((r) => ({ id: r.id, name: r.name }))))
      .catch((e: unknown) => setBindError(translateMapError(e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindOpen, map?.id]);

  useEffect(() => {
    if (!bindOpen) return;
    if (bindType === "location") loadBindOptions("location", bindSetting);
    else loadBindOptions(bindType, 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindOpen, bindType, bindSetting]);

  function openPng() {
    setPngName(map ? `map-${map.name}` : "map");
    setPngOpen(true);
  }

  // Линейка (P2-1): замер — не мазок, в историю не идёт. Живёт, пока выбран
  // инструмент; уход с него или Esc — сброс. locked=false — конец следует за
  // курсором, второй клик фиксирует (locked=true), третий — новый замер.
  const [ruler, setRuler] = useState<{
    a: { x: number; y: number };
    b: { x: number; y: number } | null;
    locked: boolean;
  } | null>(null);
  // Взгляд игрока (пакет A §6): мастер смотрит карту без секретного.
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false);
  const rulerRef = useRef(ruler);
  rulerRef.current = ruler;

  useEffect(() => {
    if (tool !== "ruler") setRuler(null);
  }, [tool]);

  // Стены линией (Этап E): вершины полилинии в мировых координатах + живой конец
  // за курсором. Снеп — квант вершины к центру клетки при клике.
  const [wallLineMode, setWallLineMode] = useState(false);
  const [wallSnap, setWallSnap] = useState(true);
  const [wallDraft, setWallDraft] = useState<{ x: number; y: number }[] | null>(null);
  const [wallLive, setWallLive] = useState<{ x: number; y: number } | null>(null);
  const wallDraftRef = useRef(wallDraft);
  wallDraftRef.current = wallDraft;
  const wallLiveRef = useRef(wallLive);
  wallLiveRef.current = wallLive;
  const wallLineModeRef = useRef(wallLineMode);
  wallLineModeRef.current = wallLineMode;

  useEffect(() => {
    if (tool !== "wall") {
      setWallDraft(null);
      setWallLive(null);
    }
  }, [tool]);

  // Шейпы (Этап E): прямоугольник + содержимое. Мышь — drag, тач — два тапа по углам.
  const [shapeContent, setShapeContent] = useState<"room" | "terrain" | "road" | "river" | "wall" | "eraser">("room");
  const [shapeAnchor, setShapeAnchor] = useState<{ x: number; y: number } | null>(null);
  const shapeAnchorRef = useRef(shapeAnchor);
  shapeAnchorRef.current = shapeAnchor;
  const shapeDragRef = useRef<{ sx: number; sy: number } | null>(null);

  useEffect(() => {
    if (tool !== "shape") {
      setShapeAnchor(null);
      shapeDragRef.current = null;
      setRectPreview(null);
    }
  }, [tool]);

  // Подписи (P2-2): черновик модалки — клетка + текст (+ была ли подпись).
  const [labelDraft, setLabelDraft] = useState<{ x: number; y: number; text: string; existed: boolean } | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  function openLabelEditor(x: number, y: number) {
    const found = cellsRef.current.labels.find((l) => l.x === x && l.y === y);
    setLabelDraft({ x, y, text: found?.text ?? "", existed: !!found });
    setLabelError(null);
  }

  function saveLabelDraft() {
    const d = labelDraft;
    if (!d) return;
    const text = d.text.trim();
    if (!text) {
      setLabelError("Текст подписи обязателен — или удалите её.");
      return;
    }
    if (text.length > 64) {
      setLabelError("Подпись — до 64 символов.");
      return;
    }
    const before = cloneCells(cellsRef.current);
    const rest = before.labels.filter((l) => !(l.x === d.x && l.y === d.y));
    if (rest.length >= 200 && !before.labels.some((l) => l.x === d.x && l.y === d.y)) {
      setLabelError("Подписей слишком много (максимум 200).");
      return;
    }
    const next: MapCells = { ...before, labels: [...rest, { x: d.x, y: d.y, text }] };
    cellsRef.current = next;
    setCells(next);
    pushHistory(before);
    setLabelDraft(null);
  }

  function deleteLabel() {
    const d = labelDraft;
    if (!d) return;
    const before = cloneCells(cellsRef.current);
    const next: MapCells = {
      ...before,
      labels: before.labels.filter((l) => !(l.x === d.x && l.y === d.y)),
    };
    cellsRef.current = next;
    setCells(next);
    pushHistory(before);
    setLabelDraft(null);
  }

  // Слой объектов: выбор (пакет A). Индекс — в массивы cells; любая замена
  // клеток выбор сбрасывает (панели и drag живут на рефах, им не мешает).
  type ObjSel =
    | { kind: "door"; index: number }
    | { kind: "trap"; index: number }
    | { kind: "marker"; index: number }
    | { kind: "room"; index: number }
    | { kind: "start"; index: -1 }
    | { kind: "finish"; index: -1 };
  const [selected, setSelected] = useState<ObjSel | null>(null);
  useEffect(() => {
    setSelected(null);
  }, [cells]);

  function selectedKeyOf(s: ObjSel | null): string | null {
    if (!s) return null;
    return s.kind === "start" || s.kind === "finish" ? s.kind : `${s.kind}:${s.index}`;
  }

  // Хит-тест (P1-3): комнаты/ловушки/старт/финиш — на любой сетке (позиция
  // клеточная); двери на рёбрах n/s/e/w — только квадраты, на гексах рёбер
  // такой модели нет, и создание дверей там заблокировано.
  function hitObject(map: MapFull, wx: number, wy: number): { sel: ObjSel } | null {
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (!cell) return null;
    const cs = cellsRef.current;
    if (map.grid === "square") {
      const fx = wx - cell.x;
      const fy = wy - cell.y;
      const dl = fx;
      const dr = 1 - fx;
      const dt = fy;
      const db = 1 - fy;
      const m = Math.min(dl, dr, dt, db);
      const edge = m === dl ? "w" : m === dr ? "e" : m === dt ? "n" : "s";
      const di = cs.doors.findIndex((d) => d.x === cell.x && d.y === cell.y && d.edge === edge);
      if (di !== -1) return { sel: { kind: "door", index: di } };
    }
    const ti = cs.traps.findIndex((t) => t.x === cell.x && t.y === cell.y);
    if (ti !== -1) return { sel: { kind: "trap", index: ti } };
    const mi = cs.markers.findIndex((m) => m.x === cell.x && m.y === cell.y);
    if (mi !== -1) return { sel: { kind: "marker", index: mi } };
    if (cs.start && cs.start.x === cell.x && cs.start.y === cell.y)
      return { sel: { kind: "start", index: -1 } };
    if (cs.finish && cs.finish.x === cell.x && cs.finish.y === cell.y)
      return { sel: { kind: "finish", index: -1 } };
    for (let i = cs.rooms.length - 1; i >= 0; i--) {
      const r = cs.rooms[i];
      if (cell.x >= r.x && cell.x < r.x + r.w && cell.y >= r.y && cell.y < r.y + r.h)
        return { sel: { kind: "room", index: i } };
    }
    return null;
  }

  // Панели объектов (клик-панель, не ПКМ).
  const [doorDraft, setDoorDraft] = useState<{ index: number; kind: MapDoorKind; secret: boolean } | null>(null);
  const [trapDraft, setTrapDraft] = useState<{ index: number; kind: MapTrapKind } | null>(null);
  const [markerDraft, setMarkerDraft] = useState<{ index: number; kind: MapMarkerKind } | null>(null);
  const [roomDraft, setRoomDraft] = useState<{ index: number; type: MapRoomType; name: string } | null>(null);
  const [createDraft, setCreateDraft] = useState<{
    x: number;
    y: number;
    edge: MapDoorEdge;
    choice: "door" | "trap" | "start" | "finish";
  } | null>(null);
  const [sfDraft, setSfDraft] = useState<{ kind: "start" | "finish" } | null>(null);
  const [objError, setObjError] = useState<string | null>(null);
  // Drag объекта и создание комнаты прямоугольником (выбор).
  const objDragRef = useRef<{
    sel: NonNullable<ObjSel>;
    sx: number;
    sy: number;
    ox: number;
    oy: number;
    before: MapCells;
    moved: boolean;
  } | null>(null);
  const rectRef = useRef<{ sx: number; sy: number; wx: number; wy: number; isRect: boolean } | null>(null);
  const [rectPreview, setRectPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const roomRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null);

  function openObjPanel(sel: NonNullable<ObjSel>) {
    const cs = cellsRef.current;
    setObjError(null);
    if (sel.kind === "door" && cs.doors[sel.index]) {
      const d = cs.doors[sel.index];
      setDoorDraft({ index: sel.index, kind: d.kind, secret: d.secret });
    } else if (sel.kind === "trap" && cs.traps[sel.index]) {
      setTrapDraft({ index: sel.index, kind: cs.traps[sel.index].kind });
    } else if (sel.kind === "marker" && cs.markers[sel.index]) {
      setMarkerDraft({ index: sel.index, kind: cs.markers[sel.index].kind });
    } else if (sel.kind === "room" && cs.rooms[sel.index]) {
      const r = cs.rooms[sel.index];
      setRoomDraft({ index: sel.index, type: r.type, name: r.name });
    } else if (sel.kind === "start" || sel.kind === "finish") {
      setSfDraft({ kind: sel.kind });
    }
  }

  function mutateObjects(next: MapCells, before: MapCells) {
    cellsRef.current = next;
    setCells(next);
    pushHistory(before);
  }

  function saveDoorDraft() {
    const d = doorDraft;
    if (!d) return;
    const before = cloneCells(cellsRef.current);
    const doors = before.doors.map((x) => ({ ...x }));
    if (!doors[d.index]) return;
    doors[d.index] = { ...doors[d.index], kind: d.kind, secret: d.secret };
    // Пара меняет вид целиком (как в прототипе).
    const pair = doors[d.index].pair;
    if (pair) {
      for (let i = 0; i < doors.length; i++) if (doors[i].pair === pair) doors[i] = { ...doors[i], kind: d.kind, secret: d.secret };
    }
    mutateObjects({ ...before, doors }, before);
    setDoorDraft(null);
    setSelected(null);
  }

  function deleteDoor() {
    const d = doorDraft;
    if (!d) return;
    const before = cloneCells(cellsRef.current);
    const target = before.doors[d.index];
    if (!target) return;
    const doors =
      target.pair != null
        ? before.doors.filter((x) => x.pair !== target.pair)
        : before.doors.filter((_, i) => i !== d.index);
    mutateObjects({ ...before, doors }, before);
    setDoorDraft(null);
    setSelected(null);
  }

  function saveTrapDraft() {
    const t = trapDraft;
    if (!t) return;
    const before = cloneCells(cellsRef.current);
    if (!before.traps[t.index]) return;
    const traps = before.traps.map((x, i) => (i === t.index ? { ...x, kind: t.kind } : x));
    mutateObjects({ ...before, traps }, before);
    setTrapDraft(null);
    setSelected(null);
  }

  function deleteTrap() {
    const t = trapDraft;
    if (!t) return;
    const before = cloneCells(cellsRef.current);
    mutateObjects({ ...before, traps: before.traps.filter((_, i) => i !== t.index) }, before);
    setTrapDraft(null);
    setSelected(null);
  }

  function saveMarkerDraft() {
    const m = markerDraft;
    if (!m) return;
    const before = cloneCells(cellsRef.current);
    if (!before.markers[m.index]) return;
    const markers = before.markers.map((x, i) => (i === m.index ? { ...x, kind: m.kind } : x));
    mutateObjects({ ...before, markers }, before);
    setMarkerDraft(null);
    setSelected(null);
  }

  function deleteMarker() {
    const m = markerDraft;
    if (!m) return;
    const before = cloneCells(cellsRef.current);
    mutateObjects({ ...before, markers: before.markers.filter((_, i) => i !== m.index) }, before);
    setMarkerDraft(null);
    setSelected(null);
  }

  function saveRoomDraft() {
    const r = roomDraft;
    if (!r || !map) return;
    const before = cloneCells(cellsRef.current);
    if (r.index === -1) {
      const rect = roomRectRef.current;
      if (!rect) return;
      if (before.rooms.length >= 100) {
        setObjError("Комнат слишком много (максимум 100).");
        return;
      }
      const rooms = [...before.rooms, { x: rect.x, y: rect.y, w: rect.w, h: rect.h, type: r.type, name: r.name.trim().slice(0, 64) }];
      mutateObjects({ ...before, rooms }, before);
    } else {
      if (!before.rooms[r.index]) return;
      const rooms = before.rooms.map((x, i) =>
        i === r.index ? { ...x, type: r.type, name: r.name.trim().slice(0, 64) } : x
      );
      mutateObjects({ ...before, rooms }, before);
    }
    setRoomDraft(null);
    roomRectRef.current = null;
    setRectPreview(null);
    setSelected(null);
  }

  function deleteRoom() {
    const r = roomDraft;
    if (!r || r.index === -1) return;
    const before = cloneCells(cellsRef.current);
    mutateObjects({ ...before, rooms: before.rooms.filter((_, i) => i !== r.index) }, before);
    setRoomDraft(null);
    setSelected(null);
  }

  function saveCreateDraft() {
    const c = createDraft;
    if (!c || !map) return;
    if (c.choice === "door" && map.grid !== "square") {
      setObjError("Двери — только на квадратах: на гексах рёберной модели нет.");
      return;
    }
    const before = cloneCells(cellsRef.current);
    if (c.choice === "door") {
      if (before.doors.length >= 400) {
        setObjError("Дверей слишком много (максимум 400).");
        return;
      }
      if (before.doors.some((d) => d.x === c.x && d.y === c.y && d.edge === c.edge)) {
        setObjError("Здесь уже есть дверь.");
        return;
      }
      mutateObjects(
        { ...before, doors: [...before.doors, { x: c.x, y: c.y, edge: c.edge, kind: "door", secret: false, pair: null }] },
        before
      );
    } else if (c.choice === "trap") {
      if (before.traps.length >= 300) {
        setObjError("Ловушек слишком много (максимум 300).");
        return;
      }
      mutateObjects({ ...before, traps: [...before.traps, { x: c.x, y: c.y, kind: "pit" }] }, before);
    } else if (c.choice === "start") {
      mutateObjects({ ...before, start: { x: c.x, y: c.y } }, before);
    } else {
      mutateObjects({ ...before, finish: { x: c.x, y: c.y } }, before);
    }
    setCreateDraft(null);
    setSelected(null);
  }

  function deleteSf() {
    const s = sfDraft;
    if (!s) return;
    const before = cloneCells(cellsRef.current);
    const next: MapCells = { ...before, start: before.start, finish: before.finish };
    if (s.kind === "start") next.start = null;
    else next.finish = null;
    mutateObjects(next, before);
    setSfDraft(null);
    setSelected(null);
  }

  function deleteSelected() {
    const s = selectedRef.current;
    if (!s) return;
    const before = cloneCells(cellsRef.current);
    if (s.kind === "door" && before.doors[s.index]) {
      const target = before.doors[s.index];
      const doors =
        target.pair != null
          ? before.doors.filter((x) => x.pair !== target.pair)
          : before.doors.filter((_, i) => i !== s.index);
      mutateObjects({ ...before, doors }, before);
    } else if (s.kind === "trap" && before.traps[s.index]) {
      mutateObjects({ ...before, traps: before.traps.filter((_, i) => i !== s.index) }, before);
    } else if (s.kind === "marker" && before.markers[s.index]) {
      mutateObjects({ ...before, markers: before.markers.filter((_, i) => i !== s.index) }, before);
    } else if (s.kind === "room" && before.rooms[s.index]) {
      mutateObjects({ ...before, rooms: before.rooms.filter((_, i) => i !== s.index) }, before);
    } else if (s.kind === "start") {
      mutateObjects({ ...before, start: null }, before);
    } else if (s.kind === "finish") {
      mutateObjects({ ...before, finish: null }, before);
    } else {
      return;
    }
    setSelected(null);
  }

  // Жёсткое перемещение объекта из снапшота начала drag (без накопления):
  // пара дверей едет жёстко тем же дельта-сдвигом, dragged — на новое ребро.
  function moveObjTo(
    od: { sel: NonNullable<ObjSel>; ox: number; oy: number; before: MapCells },
    wx: number,
    wy: number
  ) {
    if (!map) return;
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (!cell) return;
    const src = od.before;
    const draft = cloneCells(src);
    const s = od.sel;
    if (s.kind === "door") {
      // Рёбра n/s/e/w — квадратная модель; на гексах дверей нет (создание заблокировано).
      if (map.grid !== "square") return;
      const d = src.doors[s.index];
      if (!d) return;
      const fx = wx - cell.x;
      const fy = wy - cell.y;
      const m = Math.min(fx, 1 - fx, fy, 1 - fy);
      const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
      const dx = cell.x - d.x;
      const dy = cell.y - d.y;
      const members =
        d.pair != null
          ? src.doors.map((_, i) => i).filter((i) => src.doors[i].pair === d.pair)
          : [s.index];
      for (const i of members) {
        const nx = src.doors[i].x + dx;
        const ny = src.doors[i].y + dy;
        if (nx < 0 || ny < 0 || nx >= map.width || ny >= map.height) return;
      }
      for (const i of members) {
        draft.doors[i] = {
          ...draft.doors[i],
          x: src.doors[i].x + dx,
          y: src.doors[i].y + dy,
          edge: i === s.index ? edge : draft.doors[i].edge,
        };
      }
    } else if (s.kind === "trap") {
      if (!src.traps[s.index]) return;
      draft.traps[s.index] = { ...draft.traps[s.index], x: cell.x, y: cell.y };
    } else if (s.kind === "marker") {
      if (!src.markers[s.index]) return;
      draft.markers[s.index] = { ...draft.markers[s.index], x: cell.x, y: cell.y };
    } else if (s.kind === "start") {
      draft.start = { x: cell.x, y: cell.y };
    } else if (s.kind === "finish") {
      draft.finish = { x: cell.x, y: cell.y };
    } else if (s.kind === "room") {
      const r = src.rooms[s.index];
      if (!r) return;
      draft.rooms[s.index] = {
        ...r,
        x: Math.max(0, Math.min(map.width - r.w, cell.x - od.ox)),
        y: Math.max(0, Math.min(map.height - r.h, cell.y - od.oy)),
      };
    }
    cellsRef.current = draft;
    setCells(draft);
  }

  // Уход с выбора закрывает панели объектов (черновики привязаны к индексам,
  // после чужих правок врали бы) и гасит прямоугольник.
  function closeObjPanels() {
    setDoorDraft(null);
    setTrapDraft(null);
    setMarkerDraft(null);
    setRoomDraft(null);
    setCreateDraft(null);
    setSfDraft(null);
    setObjError(null);
    setSelected(null);
    rectRef.current = null;
    roomRectRef.current = null;
    setRectPreview(null);
  }

  function selectTool(t: PaintTool) {
    if (toolRef.current === "select" && t !== "select") closeObjPanels();
    setTool(t);
  }

  // Панели — аккордеоном (P1-1): CTA-кнопки внутри них залиты акцентом, а
  // бюджет §1.8 — один горячий объект. Два открытых CTA разом нельзя.
  const [xferOpen, setXferOpen] = useState(false);
  const [xferMsg, setXferMsg] = useState<string | null>(null);
  function toggleGen() {
    if (!genOpen) {
      setPngOpen(false);
      setXferOpen(false);
    }
    setGenOpen(!genOpen);
  }

  function togglePng() {
    if (!pngOpen) {
      setGenOpen(false);
      setXferOpen(false);
      openPng();
    } else {
      setPngOpen(false);
    }
  }

  function toggleXfer() {
    if (!xferOpen) {
      setGenOpen(false);
      setPngOpen(false);
      setXferMsg(null);
    }
    setXferOpen(!xferOpen);
  }

  // Обмен JSON (пакет D): тонкая обвязка над maps/mapExchange — FileReader,
  // состояние и шаг истории здесь, вся проверка — в чистом модуле.
  function exportJson() {
    if (!map) return;
    const data = buildMapExport(
      { name: map.name, grid: map.grid, scale: map.scale, cell_lore: map.cell_lore, width: map.width, height: map.height },
      genParams,
      cellsRef.current
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `map-${sanitizeDownloadName(map.name)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function importJson(file: File) {
    if (!map) return;
    setXferMsg(null);
    const target = { grid: map.grid, width: map.width, height: map.height };
    const fallbackGen = genParams;
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setXferMsg("Не похоже на выгрузку карты (ждём soyman-map/1).");
        return;
      }
      const res = validateMapImport(parsed, target, fallbackGen);
      if (!res.ok) {
        setXferMsg(res.error);
        return;
      }
      const before = cloneCells(cellsRef.current);
      cellsRef.current = res.cells;
      setCells(res.cells);
      setGenParams(res.gen);
      pushHistory(before);
      setXferMsg("Загружено: клетки, объекты и параметры генератора заменены (имя и размер — прежние). Шаг — в историю.");
    };
    reader.readAsText(file);
  }

  // --- Карта: настройки, дубль, удаление (P1-8) ---

  function openSettings() {
    if (!map) return;
    setSName(map.name);
    setSScale(map.scale);
    setSLore(map.cell_lore);
    setSWidth(map.width);
    setSHeight(map.height);
    setSettingsError(null);
    setActionError(null);
    setSettingsOpen(true);
  }

  async function saveSettings() {
    if (!map) return;
    const name = sName.trim();
    if (!name) {
      setSettingsError("Название обязательно.");
      return;
    }
    if (name.length > 200) {
      setSettingsError("Название слишком длинное (максимум 200 символов).");
      return;
    }
    const w = Math.trunc(Number(sWidth));
    const h = Math.trunc(Number(sHeight));
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < MAP_MIN_SIDE || w > MAP_MAX_SIDE || h < MAP_MIN_SIDE || h > MAP_MAX_SIDE) {
      setSettingsError(`Ширина и высота — целые числа ${MAP_MIN_SIDE}–${MAP_MAX_SIDE}.`);
      return;
    }
    if (sLore.length > 64) {
      setSettingsError("Подпись клетки — до 64 символов.");
      return;
    }
    // Ужимка поля режет всё снаружи — кропаем blob здесь же, шаг в историю (P0-C:
    // раньше кроп затрагивал только краску и дороги, подписи и объекты молча терялись).
    const shrinking = w < map.width || h < map.height;
    const before = cloneCells(cellsRef.current);
    let cropped: MapCells | null = null;
    if (shrinking) {
      const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
      const draft: MapCells = {
        terrain: new Map(),
        roads: new Set(),
        rivers: new Set(),
        labels: [],
        rooms: [],
        doors: [],
        traps: [],
        markers: [],
        start: null,
        finish: null,
      };
      for (const [k, t] of before.terrain) {
        const p = parseKey(k);
        if (p && inB(p.x, p.y)) draft.terrain.set(k, t);
      }
      for (const k of before.roads) {
        const p = parseKey(k);
        if (p && inB(p.x, p.y)) draft.roads.add(k);
      }
      for (const k of before.rivers) {
        const p = parseKey(k);
        if (p && inB(p.x, p.y)) draft.rivers.add(k);
      }
      draft.labels = before.labels.filter((l) => inB(l.x, l.y));
      // Комната, торчащая за новый край хоть частично, уходит целиком — резать
      // регион по живому значит перекраивать данж; честно предупреждаем в модалке.
      draft.rooms = before.rooms.filter((r) => r.x >= 0 && r.y >= 0 && r.x + r.w <= w && r.y + r.h <= h);
      draft.doors = before.doors.filter((d) => inB(d.x, d.y));
      draft.traps = before.traps.filter((t) => inB(t.x, t.y));
      draft.markers = before.markers.filter((m) => inB(m.x, m.y));
      draft.start = before.start && inB(before.start.x, before.start.y) ? { ...before.start } : null;
      draft.finish = before.finish && inB(before.finish.x, before.finish.y) ? { ...before.finish } : null;
      cropped = draft;
    }
    setSettingsError(null);
    try {
      const updated = await api.put<MapFull>(`/maps/${map.id}`, {
        name,
        scale: sScale,
        cell_lore: sLore,
        width: w,
        height: h,
        ...(cropped ? { cells: serializeCells(cropped) } : {}),
      });
      if (cropped) {
        cellsRef.current = cropped;
        setCells(cropped);
        pushHistory(before);
      }
      setMap(updated);
      setSettingsOpen(false);
      setActionError(null);
      if (w !== map.width || h !== map.height) fitCamera(true);
    } catch (e) {
      setSettingsError(translateMapError(e));
    }
  }

  async function duplicateMap() {
    if (!map) return;
    setActionError(null);
    try {
      const thumb = renderThumbnail(map.grid, map.width, map.height, cellsRef.current, readChrome());
      const created = await api.post<{ id: number }>("/maps", {
        name: `${map.name} (копия)`.slice(0, 200),
        grid: map.grid,
        scale: map.scale,
        width: map.width,
        height: map.height,
        cell_lore: map.cell_lore,
        seed: map.seed,
        sea: map.sea,
        mountains: map.mountains,
        forest: map.forest,
        cells: serializeCells(cellsRef.current),
        thumbnail: thumb,
      });
      navigate(`/maps/${created.id}`);
    } catch (e) {
      setActionError(translateMapError(e));
    }
  }

  async function deleteMap() {
    if (!map) return;
    const ok = await confirm({
      title: "Удалить карту?",
      message: `«${map.name}» исчезнет навсегда вместе со всеми клетками. Это нельзя отменить.`,
      confirmLabel: "Удалить",
      cancelLabel: "Оставить",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/maps/${map.id}`);
      navigate("/maps");
    } catch (e) {
      setActionError(translateMapError(e));
    }
  }


  // Экспорт идёт синхронно и на 100×100@48-64 замораживает UI на секунды (Д-13):
  // кнопка дизейблится, тяжёлая сборка (maps/mapExport) уезжает из клика в таймер.
  const [pngBusy, setPngBusy] = useState(false);

  function exportPng() {
    if (!map || pngBusy) return;
    setPngBusy(true);
    const snapshot = {
      grid: map.grid,
      width: map.width,
      height: map.height,
      name: map.name,
      scale: map.scale,
      cell_lore: map.cell_lore,
      cells: cellsRef.current,
      pv: !canEdit || pngPlayerView,
      withLegend: pngLegend,
      withGrid: pngGrid,
      withCoords: pngCoords,
      fileName: pngName,
    };
    const density = pngDensity;
    // Таймер: дать кнопке перерисоваться в «Генерируется…» до блокировки потока.
    setTimeout(() => {
      try {
        buildAndDownloadPng(snapshot, density);
      } finally {
        setPngBusy(false);
      }
    }, 30);
  }

  // --- Мазки ---

  // Стены линией: вершина со снепом — центр клетки, без снепа — сырая точка.
  function quantizeVertex(wx: number, wy: number): { x: number; y: number } {
    if (!map || !wallSnap) return { x: wx, y: wy };
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (!cell) return { x: wx, y: wy };
    const c = cellCenter(map.grid, cell.x, cell.y);
    return { x: c.cx, y: c.cy };
  }

  // Финиш полилинии стен: растеризация всех звеньев в wall одним undo-шагом.
  function finishWallLine(includeLive: boolean) {
    if (!map) {
      setWallDraft(null);
      setWallLive(null);
      return;
    }
    const d = wallDraftRef.current ?? [];
    const verts = includeLive && wallLiveRef.current ? [...d, wallLiveRef.current] : d;
    setWallDraft(null);
    setWallLive(null);
    if (verts.length < 2) return;
    const before = cloneCells(cellsRef.current);
    const draft = cloneCells(before);
    let changed = false;
    const seen = new Set<string>();
    for (let i = 0; i + 1 < verts.length; i++) {
      for (const cell of traceLineCells(map.grid, map.width, map.height, verts[i], verts[i + 1])) {
        const k = cellKey(cell.x, cell.y);
        if (seen.has(k)) continue;
        seen.add(k);
        if ((draft.terrain.get(k) ?? "plain") !== "wall") {
          draft.terrain.set(k, "wall");
          changed = true;
        }
      }
    }
    if (!changed) return;
    cellsRef.current = draft;
    setCells(draft);
    pushHistory(before);
  }

  // Шейп-прямоугольник: комната — в модалку с ректом, остальное — применением на
  // клетки ректа одним шагом (террейн — текущий, оверлеи — поверх, ластик — чистка).
  function applyShapeRect(a: { x: number; y: number }, b: { x: number; y: number }) {
    if (!map) return;
    const x0 = Math.min(a.x, b.x);
    const y0 = Math.min(a.y, b.y);
    const x1 = Math.max(a.x, b.x);
    const y1 = Math.max(a.y, b.y);
    const content = shapeContent;
    if (content === "room") {
      roomRectRef.current = { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
      setRoomDraft({ index: -1, type: "empty", name: "" });
      setObjError(null);
      return;
    }
    const before = cloneCells(cellsRef.current);
    const draft = cloneCells(before);
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const k = cellKey(x, y);
        if (content === "road" || content === "river") {
          const set = content === "road" ? draft.roads : draft.rivers;
          if (!set.has(k)) {
            set.add(k);
            changed = true;
          }
        } else if (content === "eraser") {
          if ((draft.terrain.get(k) ?? "plain") !== "plain") {
            draft.terrain.delete(k);
            changed = true;
          }
          if (draft.roads.has(k)) {
            draft.roads.delete(k);
            changed = true;
          }
          if (draft.rivers.has(k)) {
            draft.rivers.delete(k);
            changed = true;
          }
        } else {
          const t = content === "wall" ? "wall" : terrainRef.current;
          if ((draft.terrain.get(k) ?? "plain") !== t) {
            if (t === "plain") draft.terrain.delete(k);
            else draft.terrain.set(k, t);
            changed = true;
          }
        }
      }
    }
    if (!changed) return;
    cellsRef.current = draft;
    setCells(draft);
    pushHistory(before);
  }

  // Синхронный подсчёт: changed считается ДО setCells (иначе апдейтер
  // выполняется позже рендера и одиночный клик возвращал false — мазок
  // терялся для истории, P0-1). Реф обновляется оптимистично сразу, чтобы
  // быстрые pointermove до перерендера не затирали друг друга.
  function paintAt(wx: number, wy: number): boolean {
    if (!map) return false;
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (!cell) return false;
    const draft = cloneCells(cellsRef.current);
    const effTool = eraseOverrideRef.current ? "eraser" : toolRef.current;
    // Стена дабом — та же кисть террейна, только краска зафиксирована (линия — отдельно).
    const effTerrain = effTool === "wall" ? "wall" : terrainRef.current;
    const changed = paintStroke(draft, map.grid, map.width, map.height, cell.x, cell.y, brushSizeRef.current, effTool, effTerrain);
    if (!changed) return false;
    cellsRef.current = draft;
    setCells(draft);
    return true;
  }

  function beginStroke() {
    strokeRef.current = { before: cloneCells(cellsRef.current), changed: false };
    paintingRef.current = true;
  }

  function endStroke() {
    const s = strokeRef.current;
    strokeRef.current = null;
    paintingRef.current = false;
    if (s && s.changed) pushHistory(s.before);
  }

  function singleAction(wx: number, wy: number) {
    if (!map) return;
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (!cell) return;
    if (toolRef.current === "picker") {
      const t = cellsRef.current.terrain.get(cellKey(cell.x, cell.y)) ?? "plain";
      setTerrain(t);
      selectTool("brush");
      return;
    }
    // fill
    const before = cloneCells(cellsRef.current);
    const draft = cloneCells(before);
    if (floodFill(draft, map.grid, map.width, map.height, cell.x, cell.y, terrainRef.current)) {
      cellsRef.current = draft;
      setCells(draft);
      pushHistory(before);
    }
  }

  // Последний вид ловушки для инструмента (в панели вид меняется; Этап F).
  const [lastTrapKind, setLastTrapKind] = useState<MapTrapKind>("pit");
  // Вид маркера для инструмента «Маркер» (города/POI; сундук/алтарь — свои кнопки).
  const [markerKind, setMarkerKind] = useState<Exclude<MapMarkerKind, "chest" | "altar">>("city");

  // Клик-установка объектов (Этап F): дверь — обычная (вид правится выбором),
  // ловушка — последнего вида, старт/финиш — заменой. Каждый клик — undo-шаг.
  function placeObject(kind: PaintTool, wx: number, wy: number) {
    if (!map) return;
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (!cell) return;
    const before = cloneCells(cellsRef.current);
    if (kind === "door") {
      if (map.grid !== "square") {
        setActionError("Двери — только на квадратах: на гексах рёберной модели нет.");
        return;
      }
      if (before.doors.length >= 400) {
        setActionError("Дверей слишком много (максимум 400).");
        return;
      }
      const fx = wx - cell.x;
      const fy = wy - cell.y;
      const m = Math.min(fx, 1 - fx, fy, 1 - fy);
      const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
      if (before.doors.some((d) => d.x === cell.x && d.y === cell.y && d.edge === edge)) {
        setActionError("Здесь уже есть дверь.");
        return;
      }
      mutateObjects(
        { ...before, doors: [...before.doors, { x: cell.x, y: cell.y, edge, kind: "door", secret: false, pair: null }] },
        before
      );
    } else if (kind === "trap") {
      if (before.traps.length >= 300) {
        setActionError("Ловушек слишком много (максимум 300).");
        return;
      }
      mutateObjects({ ...before, traps: [...before.traps, { x: cell.x, y: cell.y, kind: lastTrapKind }] }, before);
    } else if (kind === "chest" || kind === "altar") {
      if (before.markers.length >= 300) {
        setActionError("Маркеров слишком много (максимум 300).");
        return;
      }
      mutateObjects({ ...before, markers: [...before.markers, { x: cell.x, y: cell.y, kind }] }, before);
    } else if (kind === "marker") {
      if (before.markers.length >= 300) {
        setActionError("Маркеров слишком много (максимум 300).");
        return;
      }
      mutateObjects({ ...before, markers: [...before.markers, { x: cell.x, y: cell.y, kind: markerKind }] }, before);
    } else if (kind === "start") {
      mutateObjects({ ...before, start: { x: cell.x, y: cell.y } }, before);
    } else if (kind === "finish") {
      mutateObjects({ ...before, finish: { x: cell.x, y: cell.y } }, before);
    } else {
      return;
    }
    setActionError(null);
  }

  // Живые ссылки на инструмент/террейн/размер для обработчиков canvas —
  // иначе мазки рисовали бы тем, что было выбрано при монтировании.
  const toolRef = useRef(tool);
  toolRef.current = tool;
  // Правая кнопка — временный ластик (P1-10): инструмент не переключает.
  const eraseOverrideRef = useRef(false);
  const terrainRef = useRef(terrain);
  terrainRef.current = terrain;
  const brushSizeRef = useRef(brushSize);
  brushSizeRef.current = brushSize;

  // Автомасштаб под окно при открытии карты. Д-16: позиция камеры — по карте
  // (localStorage `maps.cam.<id>`): за столом зумнул на B12 — после перезахода
  // вернёшься туда же; «Вписать» (force) сбрасывает в общий вид и стирает память.
  const fitCamera = useCallback(
    (force = false) => {
      const wrap = wrapRef.current;
      if (!wrap || !map) return;
      if (!force) {
        try {
          const raw = localStorage.getItem(`maps.cam.${map.id}`);
          if (raw) {
            const c = JSON.parse(raw) as { scale?: unknown; ox?: unknown; oy?: unknown };
            if (
              typeof c.scale === "number" && Number.isFinite(c.scale) && c.scale >= 4 && c.scale <= 240 &&
              typeof c.ox === "number" && Number.isFinite(c.ox) &&
              typeof c.oy === "number" && Number.isFinite(c.oy)
            ) {
              setCam({ scale: c.scale, ox: c.ox, oy: c.oy });
              return;
            }
          }
        } catch {
          // нет памяти — вписываем как раньше
        }
      } else {
        try {
          localStorage.removeItem(`maps.cam.${map.id}`);
        } catch {
          // приватный режим — не страшно
        }
      }
      const rect = wrap.getBoundingClientRect();
    if (rect.width < 10 || rect.height < 10) return;
    const b = worldBounds(map.grid, map.width, map.height);
    const pad = 24;
    const scale = Math.max(
      4,
      Math.min((rect.width - pad * 2) / (b.maxX - b.minX), (rect.height - pad * 2) / (b.maxY - b.minY))
    );
    setCam({
      scale,
      ox: pad + (rect.width - pad * 2 - (b.maxX - b.minX) * scale) / 2 - b.minX * scale,
      oy: pad + (rect.height - pad * 2 - (b.maxY - b.minY) * scale) / 2 - b.minY * scale,
    });
  }, [map]);

  useEffect(() => {
    fitCamera();
  }, [fitCamera]);

  useEffect(() => {
    const onResize = () => fitCamera();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [fitCamera]);

  // Д-16: запоминаем камеру (debounce — не пишем на каждый пиксель панорамы).
  useEffect(() => {
    if (!map) return;
    const key = `maps.cam.${map.id}`;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(key, JSON.stringify(cam));
      } catch {
        // приватный режим — просто не запоминаем
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [cam, map?.id]);

  // Зум кнопками/хоткеями (P0-4): к центру видимого поля, те же пределы,
  // что у зума колесом (4..240). fitCamera уже есть выше — кнопки ниже.
  function zoomBy(factor: number) {
    const el = canvasRef.current ?? wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setCam((c) => {
      const scale = Math.min(240, Math.max(4, c.scale * factor));
      const k = scale / c.scale;
      return { scale, ox: cx - (cx - c.ox) * k, oy: cy - (cy - c.oy) * k };
    });
  }

  // Кадр.
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap || !map) return;
    const rect = wrap.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const chrome = readChrome();
    renderMap(ctx, rect.width, rect.height, {
      grid: map.grid,
      width: map.width,
      height: map.height,
      cells,
      scale: cam.scale,
      ox: cam.ox,
      oy: cam.oy,
      showGrid,
      showCoords,
      hover,
      // Этап G: футпринт кистей 2/3 (и реки/дороги/ластика/стены-даба) — целиком,
      // а не одна клетка; остальным инструментам — одиночка через hover.
      hoverCells: (() => {
        if (!hover) return null;
        const paints =
          tool === "brush" || tool === "road" || tool === "river" || tool === "eraser" || (tool === "wall" && !wallLineMode);
        if (!paints) return null;
        const [hx, hy] = hover.split(",").map(Number);
        if (!Number.isInteger(hx) || !Number.isInteger(hy)) return null;
        return brushCells(map.grid, hx, hy, brushSize, map.width, map.height).map((c) => cellKey(c.x, c.y));
      })(),
      chrome,
      // Игрок всегда видит карту глазами игрока; у мастера — тумблер превью (§6).
      playerView: !canEdit || previewAsPlayer,
      selectedKey: selectedKeyOf(selected),
    });
    // Линейка поверх поля (P2-1): экранные координаты, читаема при любом зуме.
    if (ruler) {
      const end = ruler.b ?? ruler.a;
      const pa = cellCenter(map.grid, ruler.a.x, ruler.a.y);
      const pb = cellCenter(map.grid, end.x, end.y);
      const ax = cam.ox + pa.cx * cam.scale;
      const ay = cam.oy + pa.cy * cam.scale;
      const bx = cam.ox + pb.cx * cam.scale;
      const by = cam.oy + pb.cy * cam.scale;
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.stroke();
      ctx.setLineDash([]);
      for (const [px, py] of [[ax, ay], [bx, by]] as const) {
        ctx.beginPath();
        ctx.arc(px, py, 4, 0, Math.PI * 2);
        ctx.fillStyle = chrome.paper;
        ctx.fill();
        ctx.strokeStyle = chrome.ink;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
      const m = rulerMeasure(map.grid, ruler.a.x, ruler.a.y, end.x, end.y);
      const per = parseCellLore(map.cell_lore);
      const label =
        `${coordLabel(ruler.a.x, ruler.a.y)}→${coordLabel(end.x, end.y)} · ${m.cells} кл` +
        (per !== null ? ` · ${formatMeters(m.dist * per)}` : "");
      ctx.font = "12px Oswald, sans-serif";
      const tw = ctx.measureText(label).width;
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2 - 12;
      ctx.fillStyle = chrome.paper;
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 1;
      ctx.fillRect(mx - tw / 2 - 6, my - 11, tw + 12, 20);
      ctx.strokeRect(mx - tw / 2 - 6, my - 11, tw + 12, 20);
      ctx.fillStyle = chrome.ink;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(label, mx, my);
      ctx.restore();
    }
    // Полилиния стен (Этап E): пунктир по вершинам + живой конец + точки вершин.
    if (wallDraft && wallDraft.length > 0) {
      const pts = wallLive ? [...wallDraft, wallLive] : wallDraft;
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(cam.ox + pts[0].x * cam.scale, cam.oy + pts[0].y * cam.scale);
      for (let i = 1; i < pts.length; i++) {
        ctx.lineTo(cam.ox + pts[i].x * cam.scale, cam.oy + pts[i].y * cam.scale);
      }
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = chrome.paper;
      for (const p of wallDraft) {
        ctx.beginPath();
        ctx.arc(cam.ox + p.x * cam.scale, cam.oy + p.y * cam.scale, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }
    // Прямоугольник создаваемой комнаты (выбор): пунктир чернилами.
    if (rectPreview) {
      ctx.save();
      ctx.strokeStyle = chrome.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.strokeRect(
        cam.ox + rectPreview.x * cam.scale,
        cam.oy + rectPreview.y * cam.scale,
        rectPreview.w * cam.scale,
        rectPreview.h * cam.scale
      );
      ctx.restore();
    }
  }, [map, cells, cam, showGrid, showCoords, hover, ruler, selected, rectPreview, previewAsPlayer, wallDraft, wallLive, tool, brushSize, wallLineMode]);

  // Пробел — временная панорама левой кнопкой.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !(e.target instanceof HTMLInputElement) && !(e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        setSpaceDown(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === "Space") setSpaceDown(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  function toWorld(e: React.MouseEvent | React.PointerEvent): { wx: number; wy: number; rx: number; ry: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const rx = (e as React.MouseEvent).clientX - rect.left;
    const ry = (e as React.MouseEvent).clientY - rect.top;
    const c = camRef.current;
    return { wx: (rx - c.ox) / c.scale, wy: (ry - c.oy) / c.scale, rx, ry };
  }

  // Нативный слушатель: React вешает wheel пассивным, и preventDefault там
  // только ругается в консоль — страница уезжала бы из-под зума.
  // Зависимость от map: canvas появляется только после загрузки карты,
  // вешать один раз при монтировании — мимо (баг «зум не работает»).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const onWheelNative = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const rx = e.clientX - rect.left;
      const ry = e.clientY - rect.top;
      setCam((c) => {
        const scale = Math.min(240, Math.max(4, c.scale * Math.pow(1.0015, -e.deltaY)));
        const k = scale / c.scale;
        return { scale, ox: rx - (rx - c.ox) * k, oy: ry - (ry - c.oy) * k };
      });
    };
    canvas.addEventListener("wheel", onWheelNative, { passive: false });
    return () => canvas.removeEventListener("wheel", onWheelNative);
  }, [map]);

  // Хоткеи: Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y — история, B/G/E/I/R/M/T/V — инструмент,
  // +/−/0 — зум/вписать, Esc — сбросить замер (P0-4, P2-1; камера и Esc общие).
  // Независимы от раскладки (code), в полях ввода молчат.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      const ae = document.activeElement as HTMLElement | null;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || ae?.isContentEditable) return;
      if (e.ctrlKey || e.metaKey || e.altKey) {
        if ((e.ctrlKey || e.metaKey) && !e.altKey) {
          // code, а не key: физическая клавиша,Z — та же и на русской раскладке.
          if (!canEdit) return;
          if (e.code === "KeyZ" && !e.shiftKey) {
            e.preventDefault();
            undoRef.current();
          } else if ((e.code === "KeyZ" && e.shiftKey) || e.code === "KeyY") {
            e.preventDefault();
            redoRef.current();
          } else if (e.code === "Enter" && genOpenRef.current) {
            // Ctrl+Enter — сгенерировать, когда панель генератора открыта (U7).
            e.preventDefault();
            generateRef.current();
          }
        } else if (e.altKey && !e.ctrlKey && !e.metaKey) {
          // U7: Alt+G/P — панели (одиночные G/E заняты инструментами,
          // а Ctrl+G — «найти далее» в браузере, его не трогаем).
          if (!canEdit) return;
          if (e.code === "KeyG") {
            e.preventDefault();
            toggleGenRef.current();
          } else if (e.code === "KeyP") {
            e.preventDefault();
            togglePngRef.current();
          }
        }
        return;
      }
      if (e.code === "Equal" || e.code === "NumpadAdd") {
        e.preventDefault();
        zoomByRef.current(1.25);
        return;
      }
      if (e.code === "Minus" || e.code === "NumpadSubtract") {
        e.preventDefault();
        zoomByRef.current(1 / 1.25);
        return;
      }
      if (e.code === "Digit0" || e.code === "Numpad0") {
        e.preventDefault();
        fitCameraRef.current(true);
        return;
      }
      if (e.code === "Escape") {
        setRuler(null);
        setWallDraft(null);
        setWallLive(null);
        setShapeAnchor(null);
        return;
      }
      // Enter без модификаторов — финиш полилинии стен с живым концом (Этап E).
      if (e.code === "Enter" && wallDraftRef.current && wallDraftRef.current.length > 0) {
        e.preventDefault();
        finishWallLineRef.current(true);
        return;
      }
      if (!canEdit) return;
      const map_code: Record<string, PaintTool> = {
        KeyV: "select",
        KeyB: "brush",
        KeyG: "fill",
        KeyE: "eraser",
        KeyI: "picker",
        KeyR: "road",
        KeyN: "river",
        KeyW: "wall",
        KeyU: "shape",
        KeyD: "door",
        KeyL: "trap",
        KeyC: "chest",
        KeyA: "altar",
        KeyK: "marker",
        KeyS: "start",
        KeyF: "finish",
        KeyM: "ruler",
        KeyT: "label",
      };
      const t = map_code[e.code];
      if (t) {
        // Уход с выбора закрывает панели объектов (черновики бы врали).
        selectTool(t);
        return;
      }
      // Delete — удалить выбранный объект (пару дверей — целиком).
      if (e.code === "Delete" && selectedRef.current) {
        e.preventDefault();
        deleteSelectedRef.current();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  const undoRef = useRef(undo);
  undoRef.current = undo;
  const redoRef = useRef(redo);
  redoRef.current = redo;
  const generateRef = useRef(generate);
  generateRef.current = generate;
  const finishWallLineRef = useRef(finishWallLine);
  finishWallLineRef.current = finishWallLine;
  const toggleGenRef = useRef(toggleGen);
  toggleGenRef.current = toggleGen;
  const togglePngRef = useRef(togglePng);
  togglePngRef.current = togglePng;
  const genOpenRef = useRef(genOpen);
  genOpenRef.current = genOpen;
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const deleteSelectedRef = useRef(deleteSelected);
  deleteSelectedRef.current = deleteSelected;
  const fitCameraRef = useRef(fitCamera);
  fitCameraRef.current = fitCamera;
  const zoomByRef = useRef(zoomBy);
  zoomByRef.current = zoomBy;

  function onPointerDown(e: React.PointerEvent) {
    if (e.pointerType === "touch") return; // тач — ниже, по указателям
    if (e.button === 1 || (e.button === 0 && spaceDown)) {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      dragRef.current = { button: e.button, sx: e.clientX, sy: e.clientY, ox: camRef.current.ox, oy: camRef.current.oy };
      return;
    }
    if (e.button !== 0 || spaceDown || !canEdit || !map) {
      // Правая кнопка — стереть, не переключая инструмент (P1-10). Средняя и
      // пробел — панорама (выше). Контекстное меню браузера прибито на canvas.
      if (e.button === 2 && !spaceDown && canEdit && map) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        beginStroke();
        eraseOverrideRef.current = true;
        const { wx, wy } = toWorld(e);
        if (paintAt(wx, wy) && strokeRef.current) strokeRef.current.changed = true;
      }
      return;
    }
    const { wx, wy } = toWorld(e);
    // Выбор (пакет A + P1-3): клик по объекту — потянуть или панель; по пустому —
    // тянуть прямоугольник комнаты или панель создания. Двери на рёбрах —
    // только квадраты (на гексах создание дверей заблокировано в модалке).
    if (toolRef.current === "select") {
      const hit = hitObject(map, wx, wy);
      if (hit) {
        const cs = cellsRef.current;
        let ox = 0;
        let oy = 0;
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (hit.sel.kind === "room" && cs.rooms[hit.sel.index] && cell) {
          ox = cell.x - cs.rooms[hit.sel.index].x;
          oy = cell.y - cs.rooms[hit.sel.index].y;
        }
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        objDragRef.current = {
          sel: hit.sel,
          sx: e.clientX,
          sy: e.clientY,
          ox,
          oy,
          before: cloneCells(cs),
          moved: false,
        };
        setSelected(hit.sel);
      } else {
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (cell) {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          rectRef.current = { sx: e.clientX, sy: e.clientY, wx, wy, isRect: false };
        }
      }
      return;
    }
    // Линейка (P2-1): первый клик — начало, второй — конец (замер остаётся,
    // пока выбран инструмент); клик по готовому — новый замер.
    if (toolRef.current === "ruler") {
      const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
      if (cell) {
        setRuler((r) =>
          !r || r.locked ? { a: cell, b: null, locked: false } : { a: r.a, b: r.b ?? r.a, locked: true }
        );
      }
      return;
    }
    // Подпись (P2-2): клик — модалка новой/правки. Мазков нет, undo — шагом.
    if (toolRef.current === "label") {
      const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
      if (cell) openLabelEditor(cell.x, cell.y);
      return;
    }
    // Стены линией (Этап E): клик — вершина; финиш — дабл-клик/Enter (см. ниже).
    if (toolRef.current === "wall" && wallLineModeRef.current) {
      if (!pixelToCell(map.grid, wx, wy, map.width, map.height)) return;
      const v = quantizeVertex(wx, wy);
      setWallDraft((d) => [...(d ?? []), v]);
      setWallLive(null);
      return;
    }
    // Шейп (Этап E): drag от угла к углу; тач — два тапа (см. onTouchStart).
    if (toolRef.current === "shape") {
      const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
      if (cell) {
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        shapeDragRef.current = { sx: cell.x, sy: cell.y };
        setRectPreview({ x: cell.x, y: cell.y, w: 1, h: 1 });
      }
      return;
    }
    // Инструменты-установщики (Этап F): клик — объект на карту, каждый — undo-шаг.
    const placeTool = toolRef.current;
    if (
      placeTool === "door" ||
      placeTool === "trap" ||
      placeTool === "chest" ||
      placeTool === "altar" ||
      placeTool === "marker" ||
      placeTool === "start" ||
      placeTool === "finish"
    ) {
      placeObject(placeTool, wx, wy);
      return;
    }
    if (e.altKey) {
      // Пипетка поверх любого инструмента (P1-9 + Этап C): берёт террейн, а клетка
      // с оверлеем включает его инструмент (дорога — верхняя, потом река).
      // С активным оверлеем Alt+клик наоборот точечно снимает его, террейн не трогая.
      const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
      if (cell) {
        const key = cellKey(cell.x, cell.y);
        const active = toolRef.current;
        if (active === "road" || active === "river") {
          const set = active === "road" ? cellsRef.current.roads : cellsRef.current.rivers;
          if (set.has(key)) {
            const before = cloneCells(cellsRef.current);
            const draft = cloneCells(before);
            (active === "road" ? draft.roads : draft.rivers).delete(key);
            cellsRef.current = draft;
            setCells(draft);
            pushHistory(before);
          }
        } else {
          setTerrain(cellsRef.current.terrain.get(key) ?? "plain");
          selectTool(
            cellsRef.current.roads.has(key) ? "road" : cellsRef.current.rivers.has(key) ? "river" : "brush"
          );
        }
      }
      return;
    }
    if (toolRef.current === "fill" || toolRef.current === "picker") {
      singleAction(wx, wy);
      return;
    }
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    beginStroke();
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    if (cell && paintAt(wx, wy) && strokeRef.current) strokeRef.current.changed = true;
  }

  function onPointerMove(e: React.PointerEvent) {
    if (e.pointerType === "touch") return;
    const d = dragRef.current;
    if (d) {
      setCam((c) => ({ ...c, ox: d.ox + (e.clientX - d.sx), oy: d.oy + (e.clientY - d.sy) }));
      return;
    }
    if (!map) return;
    const { wx, wy } = toWorld(e);
    if (paintingRef.current && (e.buttons & 3) !== 0) {
      pendingPaintRef.current = { wx, wy };
      if (!paintRafRef.current) paintRafRef.current = requestAnimationFrame(flushPaint);
    }
    // Drag объекта / прямоугольник комнаты (выбор): живьём из снапшота.
    // Комнаты/ловушки/старт — на любой сетке; двери таскаются только на квадратах.
    const od = objDragRef.current;
    if (od && toolRef.current === "select" && (od.sel.kind !== "door" || map.grid === "square")) {
      if (!od.moved && Math.hypot(e.clientX - od.sx, e.clientY - od.sy) > 6) od.moved = true;
      if (od.moved) moveObjTo(od, wx, wy);
      return;
    }
    const rc = rectRef.current;
    if (rc && toolRef.current === "select") {
      if (!rc.isRect && Math.hypot(e.clientX - rc.sx, e.clientY - rc.sy) > 6) rc.isRect = true;
      if (rc.isRect) {
        const a = pixelToCell(map.grid, rc.wx, rc.wy, map.width, map.height);
        const b = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (a && b) {
          setRectPreview({
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x) + 1,
            h: Math.abs(a.y - b.y) + 1,
          });
        }
      }
      return;
    }
    // Живой конец полилинии стен следует за курсором (только если уже есть вершины).
    if (toolRef.current === "wall" && wallLineModeRef.current && wallDraftRef.current && wallDraftRef.current.length > 0) {
      const { wx: wwx, wy: wwy } = toWorld(e);
      setWallLive(quantizeVertex(wwx, wwy));
    }
    // Шейп-drag: прямоугольник от стартового угла.
    const sd = shapeDragRef.current;
    if (sd && toolRef.current === "shape") {
      const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
      if (cell) {
        setRectPreview({
          x: Math.min(sd.sx, cell.x),
          y: Math.min(sd.sy, cell.y),
          w: Math.abs(cell.x - sd.sx) + 1,
          h: Math.abs(cell.y - sd.sy) + 1,
        });
      }
      return;
    }
    // Живой конец замера следует за курсором, пока второй клик не зафиксировал.
    if (toolRef.current === "ruler" && rulerRef.current && !rulerRef.current.locked && canEdit) {
      const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
      const cur = rulerRef.current;
      const nb = cell ?? null;
      if ((nb?.x ?? -1) !== (cur.b?.x ?? -1) || (nb?.y ?? -1) !== (cur.b?.y ?? -1)) {
        setRuler({ a: cur.a, b: nb, locked: false });
      }
    }
    const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
    setHover(cell ? cellKey(cell.x, cell.y) : null);
  }

  function onPointerUp(e: React.PointerEvent) {
    // Отпускание объекта (выбор): двинули — шаг в историю, клик — панель.
    const od = objDragRef.current;
    if (od) {
      objDragRef.current = null;
      eraseOverrideRef.current = false;
      if (od.moved) {
        pushHistory(od.before);
        setSelected(od.sel);
      } else {
        setSelected(od.sel);
        openObjPanel(od.sel);
      }
      return;
    }
    // Отпускание прямоугольника (выбор): тянули — комната, клик — создание.
    const rc = rectRef.current;
    if (rc) {
      rectRef.current = null;
      setRectPreview(null);
      if (rc.isRect && map && canEdit) {
        const a = pixelToCell(map.grid, rc.wx, rc.wy, map.width, map.height);
        const { wx, wy } = toWorld(e);
        const b = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (a && b) {
          roomRectRef.current = {
            x: Math.min(a.x, b.x),
            y: Math.min(a.y, b.y),
            w: Math.abs(a.x - b.x) + 1,
            h: Math.abs(a.y - b.y) + 1,
          };
          setRoomDraft({ index: -1, type: "empty", name: "" });
          setObjError(null);
        }
      } else if (!rc.isRect && map && canEdit) {
        const { wx, wy } = toWorld(e);
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (cell) {
          // На гексах дверей на рёбрах нет — сразу предлагаем ловушку
          // (дверь в модалке скрыта, см. ниже).
          if (map.grid !== "square") {
            setCreateDraft({ x: cell.x, y: cell.y, edge: "n", choice: "trap" });
          } else {
            const fx = wx - cell.x;
            const fy = wy - cell.y;
            const m = Math.min(fx, 1 - fx, fy, 1 - fy);
            const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
            setCreateDraft({ x: cell.x, y: cell.y, edge, choice: "door" });
          }
          setObjError(null);
        }
      }
      return;
    }
    // Отпускание шейпа: применить прямоугольник содержимым.
    const shd = shapeDragRef.current;
    if (shd) {
      shapeDragRef.current = null;
      setRectPreview(null);
      if (map && canEdit) {
        const { wx, wy } = toWorld(e);
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (cell) applyShapeRect({ x: shd.sx, y: shd.sy }, cell);
      }
      return;
    }
    if (dragRef.current && e.pointerId !== undefined) dragRef.current = null;
    eraseOverrideRef.current = false;
    // Докрасить последний накопленный move до закрытия мазка, иначе штрих
    // оборвётся на кадр раньше отпускания.
    cancelPendingPaint();
    if (paintingRef.current) endStroke();
  }

  function onPointerCancel() {
    // Отмена drag — откат к снапшоту, без истории.
    const od = objDragRef.current;
    if (od) {
      objDragRef.current = null;
      cellsRef.current = od.before;
      setCells(od.before);
    }
    rectRef.current = null;
    setRectPreview(null);
    dragRef.current = null;
    eraseOverrideRef.current = false;
    cancelPendingPaint();
    if (paintingRef.current) endStroke();
  }

  // Тач: один палец рисует (тем же мазком, что мышь), два — пан/зум.
  // Второй палец посреди мазка закрывает мазок и начинает пан/зум.
  const touches = useRef(new globalThis.Map<number, { x: number; y: number }>());
  const strokeTouchRef = useRef<number | null>(null);

  function touchToWorld(clientX: number, clientY: number): { wx: number; wy: number } {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const c = camRef.current;
    return { wx: (clientX - rect.left - c.ox) / c.scale, wy: (clientY - rect.top - c.oy) / c.scale };
  }

  function onTouchStart(e: React.TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    if (touches.current.size === 1 && canEdit && map && strokeTouchRef.current === null) {
      const t = e.changedTouches[0];
      if (toolRef.current === "fill" || toolRef.current === "picker") {
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        singleAction(wx, wy);
      } else if (toolRef.current === "ruler") {
        // Тач-замер тапами (без живого конца): тап — начало, тап — конец.
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (cell) {
          setRuler((r) =>
            !r || r.locked ? { a: cell, b: null, locked: false } : { a: r.a, b: r.b ?? r.a, locked: true }
          );
        }
      } else if (toolRef.current === "label") {
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (cell) openLabelEditor(cell.x, cell.y);
      } else if (toolRef.current === "select") {
        // Тач: только тап-панели (drag объектов — мышь; на таче нет ховера).
        // Двери — только квадраты, остальное — везде.
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        const hit = hitObject(map, wx, wy);
        if (hit) {
          setSelected(hit.sel);
          openObjPanel(hit.sel);
          } else {
            const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
            if (cell) {
              if (map.grid !== "square") {
                setCreateDraft({ x: cell.x, y: cell.y, edge: "n", choice: "trap" });
              } else {
                const fx = wx - cell.x;
                const fy = wy - cell.y;
                const m = Math.min(fx, 1 - fx, fy, 1 - fy);
                const edge: MapDoorEdge = m === fx ? "w" : m === 1 - fx ? "e" : m === fy ? "n" : "s";
                setCreateDraft({ x: cell.x, y: cell.y, edge, choice: "door" });
              }
              setObjError(null);
            }
          }
      } else if (toolRef.current === "shape") {
        // Тач-шейп: тап — первый угол, тап — второй (прямоугольник готов).
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        const cell = pixelToCell(map.grid, wx, wy, map.width, map.height);
        if (cell) {
          const anchor = shapeAnchorRef.current;
          if (!anchor) {
            setShapeAnchor(cell);
            setRectPreview({ x: cell.x, y: cell.y, w: 1, h: 1 });
          } else {
            setShapeAnchor(null);
            setRectPreview(null);
            applyShapeRect(anchor, cell);
          }
        }
      } else if (
        toolRef.current === "door" ||
        toolRef.current === "trap" ||
        toolRef.current === "chest" ||
        toolRef.current === "altar" ||
        toolRef.current === "marker" ||
        toolRef.current === "start" ||
        toolRef.current === "finish"
      ) {
        // Тач-установка: тап — объект (иначе тач красил бы террейном).
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        placeObject(toolRef.current, wx, wy);
      } else {
        strokeTouchRef.current = t.identifier;
        beginStroke();
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        if (paintAt(wx, wy) && strokeRef.current) strokeRef.current.changed = true;
      }
      return;
    }
    if (touches.current.size === 2) {
      // preventDefault не нужен: CSS touch-action:none уже гасит
      // нативные пан/зум, а в React-синтетике он только ругается.
      if (strokeTouchRef.current !== null) {
        strokeTouchRef.current = null;
        endStroke();
      }
      const [a, b] = [...touches.current.values()];
      const canvas = canvasRef.current!;
      const rect = canvas.getBoundingClientRect();
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: camRef.current.scale,
        mx: (a.x + b.x) / 2 - rect.left,
        my: (a.y + b.y) / 2 - rect.top,
      };
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (strokeTouchRef.current !== null) {
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i];
        if (t.identifier !== strokeTouchRef.current) continue;
        touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
        const { wx, wy } = touchToWorld(t.clientX, t.clientY);
        if (paintAt(wx, wy) && strokeRef.current) strokeRef.current.changed = true;
      }
      return;
    }
    if (touches.current.size !== 2 || !pinchRef.current) return;
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i];
      touches.current.set(t.identifier, { x: t.clientX, y: t.clientY });
    }
    const [a, b] = [...touches.current.values()];
    const p = pinchRef.current;
    const dist = Math.hypot(a.x - b.x, a.y - b.y);
    if (dist < 1) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const mx = (a.x + b.x) / 2 - rect.left;
    const my = (a.y + b.y) / 2 - rect.top;
    const scale = Math.min(240, Math.max(4, (p.scale * dist) / p.dist));
    const k = scale / camRef.current.scale;
    setCam((c) => ({
      scale,
      ox: mx - (p.mx - c.ox) * k - (mx - p.mx),
      oy: my - (p.my - c.oy) * k - (my - p.my),
    }));
  }

  function onTouchEnd(e: React.TouchEvent) {
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (e.changedTouches[i].identifier === strokeTouchRef.current) {
        strokeTouchRef.current = null;
        endStroke();
      }
      touches.current.delete(e.changedTouches[i].identifier);
    }
    if (touches.current.size < 2) pinchRef.current = null;
  }

  function toggleGrid() {
    setShowGrid((v) => {
      try {
        localStorage.setItem("maps.showGrid", v ? "0" : "1");
      } catch {
        // приватный режим — просто не запоминаем
      }
      return !v;
    });
  }

  function toggleCoords() {
    setShowCoords((v) => {
      try {
        localStorage.setItem("maps.showCoords", v ? "0" : "1");
      } catch {
        // приватный режим — просто не запоминаем
      }
      return !v;
    });
  }

  async function clearAll() {
    if (!map) return;
    const ok = await confirm({
      title: "Очистить карту?",
      message: "Все клетки станут равниной, дороги, реки, подписи, маркеры и объекты исчезнут. Шаг попадёт в историю — его можно отменить.",
      confirmLabel: "Очистить",
      cancelLabel: "Отмена",
      danger: true,
    });
    if (!ok) return;
    const before = cloneCells(cellsRef.current);
    const cleared: MapCells = { terrain: new Map(), roads: new Set(), rivers: new Set(), labels: [], rooms: [], doors: [], traps: [], markers: [], start: null, finish: null };
    cellsRef.current = cleared;
    setCells(cleared);
    pushHistory(before);
  }

  // Главный ряд (Этап F): модификаторы + размер + история + аккордеоны.
  // ЧТО красить — в панелях ниже (Биомы/Поверхность/Объекты).
  const MAIN_TOOLS: { id: PaintTool; label: string; hotkey: string; title: string }[] = [
    { id: "brush", label: "Кисть", hotkey: "B", title: "Кисть террейна (B)" },
    { id: "fill", label: "Заливка", hotkey: "G", title: "Заливка связной области (G)" },
    { id: "eraser", label: "Ластик", hotkey: "E", title: "Ластик: равнина + снять дорогу/реку (E)" },
    { id: "picker", label: "Пипетка", hotkey: "I", title: "Взять террейн с карты (I)" },
    { id: "ruler", label: "Линейка", hotkey: "M", title: "Замер по прямой: клик — начало, клик — конец, Esc — сбросить (M)" },
  ];

  const OBJECT_TOOLS: { id: PaintTool; label: string; hotkey: string; title: string }[] = [
    { id: "select", label: "Выбор", hotkey: "V", title: "Выбор (V): клик — панель, тяни объект — двигать, Del — удалить (двери — только квадраты)" },
    { id: "door", label: "Дверь", hotkey: "D", title: "Дверь (D): клик — поставить обычную (вид — выбором)" },
    { id: "trap", label: "Ловушка", hotkey: "L", title: "Ловушка (L): клик — поставить" },
    { id: "chest", label: "Сундук", hotkey: "C", title: "Сундук (C): клик — поставить" },
    { id: "altar", label: "Алтарь", hotkey: "A", title: "Алтарь (A): клик — поставить" },
    { id: "marker", label: "Маркер", hotkey: "K", title: "Маркер (K): выбери вид ниже, клик — поставить" },
    { id: "start", label: "Старт", hotkey: "S", title: "Старт (S): клик — поставить (заменит)" },
    { id: "finish", label: "Финиш", hotkey: "F", title: "Финиш (F): клик — поставить (заменит)" },
    { id: "label", label: "Подпись", hotkey: "T", title: "Подпись на карте (T): клик — новая, клик по готовой — править" },
    { id: "shape", label: "Шейп", hotkey: "U", title: "Шейп-прямоугольник (U): выбери содержимое ниже и тяни" },
  ];

  const ALL_TOOL_LABELS = [...MAIN_TOOLS, ...OBJECT_TOOLS];

  // Активная панель paint/object (Этап F) — запоминается, как вкладка генератора.
  const [activePanel, setActivePanelState] = useState<"biomes" | "surface" | "objects">(() => {
    try {
      const v = localStorage.getItem("maps.panel");
      return v === "surface" || v === "objects" ? v : "biomes";
    } catch {
      return "biomes";
    }
  });
  function setActivePanel(p: "biomes" | "surface" | "objects") {
    setActivePanelState(p);
    try {
      localStorage.setItem("maps.panel", p);
    } catch {
      // приватный режим — просто не запоминаем
    }
  }

  // Свотч краски: одна вёрстка на Биомы и Поверхность.
  function paintSwatch(code: string) {
    return (
      <button
        key={code}
        type="button"
        className="map-tool"
        aria-pressed={tool === "brush" && terrain === code}
        title={MAP_TERRAIN_LABELS[code]}
        aria-label={MAP_TERRAIN_LABELS[code]}
        onClick={() => {
          setTerrain(code);
          selectTool("brush");
        }}
        style={{
          width: 26,
          height: 26,
          padding: 0,
          background: MAP_TERRAIN_FILL[code],
          border: "1px solid var(--line)",
        }}
      />
    );
  }

  function saveLabel(): string {
    if (blobCorrupt) return "Сохранение остановлено — данные повреждены";
    if (saveState.kind === "saving") return "Сохранение…";
    if (saveState.kind === "error") return "Не сохранилось — нажмите «Повторить»";
    if (saveState.kind === "dirty") return "Есть несохранённое…";
    return saveState.at ? `Сохранено ${saveState.at}` : "Сохранено";
  }

  return (
    <div className="stack map-editor" style={{ position: "relative" }}>
      <SectionBackground />
      <div className="page-header-row row">
        <SectionHeading section="map" compact>
          {map ? map.name : "Карта"}
        </SectionHeading>
        <div className="row">
          {map && canEdit && (
            <>
              <button type="button" title="Название, масштаб, подпись клетки, размер поля" onClick={openSettings}>
                Настройки
              </button>
              <button
                type="button"
                title="К каким сеттингам, кампаниям и локациям относится карта"
                aria-expanded={bindOpen}
                onClick={() => setBindOpen((v) => !v)}
              >
                Привязки{bindings.length > 0 ? ` · ${bindings.length}` : ""}
              </button>
              <button type="button" title="Создать копию карты со всей росписью" onClick={duplicateMap}>
                Дублировать
              </button>
              <button type="button" title="Удалить карту навсегда" onClick={deleteMap}>
                Удалить
              </button>
            </>
          )}
          <Link to="/maps">← К картам</Link>
        </div>
      </div>

      {loading && <p className="muted">Загрузка карты…</p>}

      {loadError && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось открыть карту: {loadError}</span>
          <Link to="/maps" className="primary" style={{ padding: "6px 12px", textDecoration: "none" }}>
            К списку
          </Link>
        </div>
      )}

      {!loading && !loadError && map && (
        <>
          <div className="res-toolbar" style={{ marginTop: 4 }}>
            <span className="badge tag">{MAP_GRID_LABELS[map.grid]}</span>
            <span className="badge tag">{MAP_SCALE_LABELS[map.scale]}</span>
            <span
              className="muted"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}
              title="Размер поля и масштаб клетки"
            >
              {map.width}×{map.height} · клетка {map.cell_lore}
            </span>
            <span style={{ flex: 1 }} />
            {canEdit && (
              <label className="row" style={{ gap: 6 }} title="Игроки увидят карту в своём разделе (только просмотр)">
                <input
                  type="checkbox"
                  checked={map.player_visible === 1}
                  onChange={(e) => {
                    const player_visible = e.target.checked ? 1 : 0;
                    setMap((m) => (m ? { ...m, player_visible } : m));
                    api.put(`/maps/${map.id}`, { player_visible }).catch(() => {
                      // Откат при ошибке: тумблер не должен врать
                      setMap((m) => (m ? { ...m, player_visible: player_visible === 1 ? 0 : 1 } : m));
                    });
                  }}
                />
                Видят игроки
              </label>
            )}
            {canEdit && (
              <button
                type="button"
                title="Открыть карту игрокам и скопировать ссылку — скажите игрокам обновить раздел «Карты»"
                onClick={shareWithPlayers}
              >
                Показать игрокам
              </button>
            )}
            <label className="row" style={{ gap: 6 }} title="Показать сетку">
              <input type="checkbox" checked={showGrid} onChange={toggleGrid} />
              Сетка
            </label>
            <label className="row" style={{ gap: 6 }} title="Показать координаты клеток">
              <input type="checkbox" checked={showCoords} onChange={toggleCoords} />
              Координаты
            </label>
          </div>

          {!canEdit && <p className="muted">Просмотр: правит карты только мастер.</p>}

          {canEdit && (
            <>
              <div className="res-toolbar" role="toolbar" aria-label="Инструменты карты">
                {MAIN_TOOLS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className="map-tool"
                    aria-pressed={tool === t.id}
                    title={t.title}
                    onClick={() => selectTool(t.id)}
                  >
                    {t.label}
                  </button>
                ))}
                <span className="muted" title="Размер кисти" style={{ fontSize: "var(--fs-micro)" }}>
                  Размер
                </span>
                {([1, 2, 3] as BrushSize[]).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className="map-tool"
                    aria-pressed={brushSize === n}
                    title={`Кисть ${n}`}
                    disabled={!(tool === "brush" || tool === "road" || tool === "river" || (tool === "wall" && !wallLineMode))}
                    onClick={() => setBrushSize(n)}
                    style={{ minWidth: 30 }}
                  >
                    {n}
                  </button>
                ))}
                <button type="button" disabled={!canUndo} title="Отменить (Ctrl+Z)" onClick={undo}>
                  ←
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  title="Вернуть (Ctrl+Shift+Z / Ctrl+Y)"
                  onClick={redo}
                >
                  →
                </button>
                <button
                  type="button"
                  className="map-tool"
                  aria-pressed={genOpen}
                  aria-expanded={genOpen}
                  title="Генератор черновика суши по сиду (Alt+G; Ctrl+Enter — сгенерировать)"
                  onClick={toggleGen}
                >
                  Генератор
                </button>
                <button
                  type="button"
                  className="map-tool"
                  aria-pressed={pngOpen}
                  aria-expanded={pngOpen}
                  title="Экспорт карты в PNG для печати и показа игрокам (Alt+P)"
                  onClick={togglePng}
                >
                  PNG
                </button>
                <button
                  type="button"
                  className="map-tool"
                  aria-pressed={xferOpen}
                  aria-expanded={xferOpen}
                  title="Обмен: выгрузка и загрузка карты JSON"
                  onClick={toggleXfer}
                >
                  Обмен
                </button>
                <button
                  type="button"
                  title="Очистить всю карту (с подтверждением; подальше от Undo — чтобы не промахнуться)"
                  onClick={clearAll}
                >
                  Очистить
                </button>
                <span style={{ flex: 1 }} />
                <span
                  className="muted"
                  style={{ fontSize: "var(--fs-micro)" }}
                  title="Автосохранение при каждой правке"
                >
                  {saveLabel()}
                </span>
                {saveState.kind === "error" && (
                  <button type="button" title="Повторить сохранение сейчас" onClick={retrySave}>
                    Повторить
                  </button>
                )}
              </div>
              {/* Панели paint/object (Этап F): табы + контент. Главный ряд выше —
                  только модификаторы (кисть/заливка/ластик/пипетка), размер, история,
                  аккордеоны и статус; ЧТО красить — здесь. */}
              <div className="res-toolbar" role="tablist" aria-label="Панели инструментов">
                {(["biomes", "surface", "objects"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={activePanel === p}
                    className="map-tool"
                    aria-pressed={activePanel === p}
                    onClick={() => setActivePanel(p)}
                  >
                    {p === "biomes" ? "Биомы" : p === "surface" ? "Поверхность" : "Объекты"}
                  </button>
                ))}
                <span style={{ flex: 1 }} />
                <button
                  type="button"
                  className="map-tool"
                  aria-pressed={legendOpen}
                  aria-expanded={legendOpen}
                  title="Легенда: какой цвет что значит"
                  onClick={() => setLegendOpen((v) => !v)}
                >
                  Легенда
                </button>
              </div>
              {activePanel === "biomes" && (
                <div className="res-toolbar" role="toolbar" aria-label="Биомы">
                  {MAP_BIOME_TERRAINS.map((code) => paintSwatch(code))}
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    {MAP_TERRAIN_LABELS[terrain] ?? terrain}
                  </span>
                </div>
              )}
              {activePanel === "surface" && (
                <div className="res-toolbar" role="toolbar" aria-label="Поверхность">
                  {MAP_FLOOR_TERRAINS.map((code) => paintSwatch(code))}
                  <button
                    type="button"
                    className="map-tool"
                    aria-pressed={tool === "road"}
                    title="Дорога — поверх террейна (R)"
                    onClick={() => selectTool("road")}
                    style={{ width: 26, height: 26, padding: 0 }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ display: "block", height: 4, margin: "9px 3px", background: "var(--ink)" }}
                    />
                  </button>
                  <button
                    type="button"
                    className="map-tool"
                    aria-pressed={tool === "river"}
                    title="Река — поверх террейна, под дорогами (N)"
                    onClick={() => selectTool("river")}
                    style={{ width: 26, height: 26, padding: 0 }}
                  >
                    <span
                      aria-hidden="true"
                      style={{ display: "block", height: 4, margin: "9px 3px", background: MAP_RIVER_FILL }}
                    />
                  </button>
                  <button
                    type="button"
                    className="map-tool"
                    aria-pressed={tool === "wall"}
                    title="Стена (W): даб — мазок, линия — полилиния"
                    aria-label="Стена"
                    onClick={() => selectTool("wall")}
                    style={{
                      width: 26,
                      height: 26,
                      padding: 0,
                      background: MAP_TERRAIN_FILL.wall,
                      border: "1px solid var(--line)",
                    }}
                  />
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    {tool === "road" ? "Дорога" : tool === "river" ? MAP_RIVER_LABEL : tool === "wall" ? "Стена" : (MAP_TERRAIN_LABELS[terrain] ?? terrain)}
                  </span>
                  {tool === "wall" && (
                    <>
                      <button
                        type="button"
                        className="map-tool"
                        aria-pressed={wallLineMode}
                        title="Линия: клики — вершины, дабл-клик/Enter — готово, Esc — отмена"
                        onClick={() => {
                          setWallLineMode((v) => !v);
                          setWallDraft(null);
                          setWallLive(null);
                        }}
                      >
                        Линия
                      </button>
                      {wallLineMode && (
                        <label className="row" style={{ gap: 6 }} title="Вершины квантуются к центрам клеток; выкл — свободная полилиния">
                          <input type="checkbox" checked={wallSnap} onChange={(e) => setWallSnap(e.target.checked)} />
                          Снеп к сетке
                        </label>
                      )}
                    </>
                  )}
                </div>
              )}
              {activePanel === "objects" && (
                <div className="res-toolbar" role="toolbar" aria-label="Объекты">
                  {OBJECT_TOOLS.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="map-tool"
                      aria-pressed={tool === t.id}
                      title={t.title}
                      onClick={() => selectTool(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    {OBJECT_TOOLS.find((t) => t.id === tool)?.label ?? "—"}
                  </span>
                </div>
              )}
              {tool === "marker" && (
                <div className="res-toolbar" role="toolbar" aria-label="Вид маркера">
                  <select
                    value={markerKind}
                    onChange={(e) => setMarkerKind(e.target.value as typeof markerKind)}
                    aria-label="Вид маркера"
                    title="Что ставит инструмент «Маркер»"
                  >
                    {(["city", "village", "camp", "metro", "battle", "obelisk"] as const).map((k) => (
                      <option key={k} value={k}>
                        {MAP_MARKER_LABELS[k]}
                      </option>
                    ))}
                  </select>
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    Клик — поставить; сундук и алтарь — свои кнопки выше.
                  </span>
                </div>
              )}
              {tool === "shape" && (
                <div className="res-toolbar" role="toolbar" aria-label="Шейп">
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }} title="Пока только прямоугольник; эллипс — следующим шагом">
                    Прямоугольник
                  </span>
                  <select
                    value={shapeContent}
                    onChange={(e) => setShapeContent(e.target.value as typeof shapeContent)}
                    aria-label="Содержимое шейпа"
                    title="Чем заполнить прямоугольник"
                  >
                    <option value="room">Комната</option>
                    <option value="terrain">Террейн (текущий)</option>
                    <option value="road">Дорога</option>
                    <option value="river">Река</option>
                    <option value="wall">Стена</option>
                    <option value="eraser">Ластик</option>
                  </select>
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    Тяни прямоугольник; на таче — два тапа по углам.
                  </span>
                </div>
              )}
              {legendOpen && (
                <div className="card" style={{ padding: "10px 12px" }} aria-label="Легенда террейна">
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    {MAP_TERRAIN_ORDER.map((code) => (
                      <span key={code} className="row" style={{ gap: 6 }} title={MAP_TERRAIN_LABELS[code]}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 18,
                            height: 18,
                            background: MAP_TERRAIN_FILL[code],
                            border: "1px solid var(--line)",
                          }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_TERRAIN_LABELS[code]}</span>
                      </span>
                    ))}
                    <span className="row" style={{ gap: 6 }} title="Дорога — поверх террейна">
                      <span
                        aria-hidden="true"
                        style={{ display: "inline-block", width: 18, height: 4, background: "var(--ink)" }}
                      />
                      <span style={{ fontSize: "var(--fs-micro)" }}>Дорога</span>
                    </span>
                    {cells.doors.length > 0 &&
                      MAP_DOOR_KINDS.filter((k) =>
                        cells.doors.some((d) => !doorForView(d, !canEdit || previewAsPlayer).hidden && doorForView(d, !canEdit || previewAsPlayer).kind === k)
                      ).map((k) => (
                        <span key={k} className="row" style={{ gap: 6 }} title={MAP_DOOR_LABELS[k]}>
                          <span
                            aria-hidden="true"
                            style={{
                              display: "inline-block",
                              width: 18,
                              height: 18,
                              background: MAP_DOOR_FILL[k],
                              border: "1px solid var(--line)",
                            }}
                          />
                          <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_DOOR_LABELS[k]}</span>
                        </span>
                      ))}
                    {(canEdit && !previewAsPlayer ? MAP_TRAP_KINDS : []).filter((k) =>
                      cells.traps.some((t) => t.kind === k)
                    ).map((k) => (
                      <span key={k} className="row" style={{ gap: 6 }} title={`${MAP_TRAP_LABELS[k]} (скрыта от игроков)`}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 18,
                            height: 18,
                            background: "var(--paper)",
                            border: "1px solid var(--line)",
                            fontSize: "var(--fs-meta)",
                          }}
                        >
                          {MAP_TRAP_GLYPHS[k]}
                        </span>
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_TRAP_LABELS[k]}</span>
                      </span>
                    ))}
                    {MAP_ROOM_TYPES.filter((t) => cells.rooms.some((r) => r.type === t)).map((t) => (
                      <span key={t} className="row" style={{ gap: 6 }} title={MAP_ROOM_LABELS[t]}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 18,
                            height: 18,
                            background: MAP_ROOM_TINT[t] ?? "var(--paper)",
                            border: "1px solid var(--line)",
                          }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_ROOM_LABELS[t]}</span>
                      </span>
                    ))}
                    {cells.start && (
                      <span className="row" style={{ gap: 6 }} title="Старт">
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            margin: 3,
                            borderRadius: "50%",
                            background: "#0a4a2a",
                            border: "1px solid #3dd68c",
                          }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>Старт</span>
                      </span>
                    )}
                    {cells.rivers.size > 0 && (
                      <span className="row" style={{ gap: 6 }} title="Река — поверх террейна, под дорогами">
                        <span
                          aria-hidden="true"
                          style={{ display: "inline-block", width: 18, height: 5, background: MAP_RIVER_FILL }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_RIVER_LABEL}</span>
                      </span>
                    )}
                    {MAP_MARKER_KINDS.filter((k) => cells.markers.some((m) => m.kind === k)).map((k) => (
                      <span key={k} className="row" style={{ gap: 6 }} title={MAP_MARKER_LABELS[k]}>
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            width: 18,
                            height: 18,
                            fontSize: "var(--fs-meta)",
                          }}
                        >
                          {MAP_MARKER_GLYPHS[k]}
                        </span>
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_MARKER_LABELS[k]}</span>
                      </span>
                    ))}
                    {cells.finish && (
                      <span className="row" style={{ gap: 6 }} title="Финиш">
                        <span
                          aria-hidden="true"
                          style={{
                            display: "inline-block",
                            width: 12,
                            height: 12,
                            margin: 3,
                            background: "#FFFFFF",
                            border: "1px solid var(--ink)",
                          }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>Финиш</span>
                      </span>
                    )}
                  </div>
                </div>
              )}
              {genOpen && (
                <div className="card" style={{ padding: "10px 12px" }} aria-label="Генератор карты">
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", marginBottom: 8 }} role="tablist" aria-label="Режим генератора">
                    {(["land", "dungeon"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        role="tab"
                        aria-selected={genTab === t}
                        className="map-tool"
                        aria-pressed={genTab === t}
                        title={t === "land" ? "Черновик суши по сиду" : "Подземелье: комнаты, коридоры, двери"}
                        onClick={() => setGenTab(t)}
                      >
                        {t === "land" ? "Суша" : "Подземелье"}
                      </button>
                    ))}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                    <label>
                      Сид
                      <input
                        type="number"
                        value={genParams.seed}
                        onChange={(e) => setGenParams((p) => ({ ...p, seed: Math.trunc(Number(e.target.value)) || 0 }))}
                        style={{ width: 130 }}
                      />
                    </label>
                    <button type="button" title="Случайный сид" onClick={rollSeed}>
                      Кубик
                    </button>
                    {genTab === "land" ? (
                      <>
                        <label style={{ minWidth: 150 }}>
                          Море{" "}
                          <span className="badge tag" style={{ fontFamily: "var(--font-mono)" }}>
                            {genParams.sea}
                          </span>
                          <input
                            type="range"
                            min={20}
                            max={80}
                            value={genParams.sea}
                            onChange={(e) => setGenParams((p) => ({ ...p, sea: Number(e.target.value) }))}
                          />
                        </label>
                        <label style={{ minWidth: 150 }}>
                          Горы{" "}
                          <span className="badge tag" style={{ fontFamily: "var(--font-mono)" }}>
                            {genParams.mountains}
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={40}
                            value={genParams.mountains}
                            onChange={(e) => setGenParams((p) => ({ ...p, mountains: Number(e.target.value) }))}
                          />
                        </label>
                        <label style={{ minWidth: 150 }}>
                          Лес{" "}
                          <span className="badge tag" style={{ fontFamily: "var(--font-mono)" }}>
                            {genParams.forest}
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={60}
                            value={genParams.forest}
                            onChange={(e) => setGenParams((p) => ({ ...p, forest: Number(e.target.value) }))}
                          />
                        </label>
                      </>
                    ) : (
                      <>
                        <label style={{ minWidth: 130 }}>
                          Комнат{" "}
                          <span className="badge tag" style={{ fontFamily: "var(--font-mono)" }}>
                            {dunRooms}
                          </span>
                          <input
                            type="range"
                            min={3}
                            max={30}
                            value={dunRooms}
                            onChange={(e) => setDunRooms(Number(e.target.value))}
                          />
                        </label>
                        <label title="Ширина коридоров">
                          Проходы
                          <select value={dunCorr} onChange={(e) => setDunCorr(e.target.value as 1 | 2 | "mixed")}>
                            <option value={1}>Узкие 1</option>
                            <option value={2}>Широкие 2</option>
                            <option value="mixed">Смешанные</option>
                          </select>
                        </label>
                        <label style={{ minWidth: 130 }}>
                          Петли{" "}
                          <span className="badge tag" style={{ fontFamily: "var(--font-mono)" }}>
                            {dunLoops}%
                          </span>
                          <input
                            type="range"
                            min={0}
                            max={100}
                            value={dunLoops}
                            onChange={(e) => setDunLoops(Number(e.target.value))}
                          />
                        </label>
                        <label className="row" style={{ gap: 6 }} title="Потайные двери в весах">
                          <input type="checkbox" checked={dunSecrets} onChange={(e) => setDunSecrets(e.target.checked)} />
                          Секреты
                        </label>
                        <label title="Ловушки на полах">
                          Ловушки
                          <select value={dunTraps} onChange={(e) => setDunTraps(e.target.value as "none" | "some" | "many")}>
                            <option value="none">Нет</option>
                            <option value="some">Есть</option>
                            <option value="many">Много</option>
                          </select>
                        </label>
                      </>
                    )}
                    <button type="button" className="primary" onClick={generate}>
                      Сгенерировать
                    </button>
                    {genTab === "dungeon" && (
                      <button
                        type="button"
                        title="Пресет в один клик: 5 комнат, узкие проходы, секреты и немного ловушек"
                        onClick={quickDungeon}
                      >
                        Быстрый данж
                      </button>
                    )}
                    {genTab === "dungeon" && (
                      <button type="button" title="Проложить коридоры к изолированным комнатам (двери не трогаем)" onClick={fixConnectivity}>
                        Починить связность
                      </button>
                    )}
                  </div>
                  {genTab === "land" ? (
                    <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "6px 0 0" }}>
                      Черновик: вода, суша, горы, лес. Болото, лёд и дороги — руками. По непустой карте
                      сначала спросим — генерация затрёт клетки шагом в историю (история эфемерная). Тот же сид
                      даёт те же клетки.
                    </p>
                  ) : (
                    <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "6px 0 0" }}>
                      Комнаты, коридоры, двери (парные на широких), ловушки, старт/финиш. Всё поле станет
                      стенами и полами — роспись затрется. Только квадраты. Тот же сид даёт тот же данж.
                    </p>
                  )}
                </div>
              )}
              {pngOpen && (
                <div className="card" style={{ padding: "10px 12px" }} aria-label="Экспорт PNG">
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                    <label>
                      Имя файла
                      <input
                        value={pngName}
                        onChange={(e) => setPngName(e.target.value)}
                        style={{ width: 200 }}
                      />
                    </label>
                    <label className="row" style={{ gap: 6 }} title="Рисовать сетку поверх клеток">
                      <input type="checkbox" checked={pngGrid} onChange={(e) => setPngGrid(e.target.checked)} />
                      Сетка
                    </label>
                    <label className="row" style={{ gap: 6 }} title="Подписать координаты клеток — на бумаге без них не сослаться">
                      <input type="checkbox" checked={pngCoords} onChange={(e) => setPngCoords(e.target.checked)} />
                      Координаты
                    </label>
                    <label className="row" style={{ gap: 6 }} title="Колонка справа: название, все террейны, «1 клетка = …»">
                      <input type="checkbox" checked={pngLegend} onChange={(e) => setPngLegend(e.target.checked)} />
                      Легенда
                    </label>
                    <label className="row" style={{ gap: 6 }} title="PNG без секретных дверей и ловушек — как видят игроки">
                      <input type="checkbox" checked={pngPlayerView} onChange={(e) => setPngPlayerView(e.target.checked)} />
                      Вид игрока
                    </label>
                    <label title="Точек на клетку: больше — чётче печать, тяжелее файл">
                      Плотность
                      <select value={pngDensity} onChange={(e) => setPngDensity(Number(e.target.value))}>
                        {PNG_DENSITIES.map((d) => (
                          <option key={d} value={d}>
                            {d} тчк/кл
                          </option>
                        ))}
                      </select>
                    </label>
                    <button type="button" className="primary" onClick={exportPng} disabled={pngBusy}>
                      {pngBusy ? "Генерируется…" : "Скачать PNG"}
                    </button>
                  </div>
                  <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "6px 0 0" }}>
                    Легенда и масштаб вшиваются справа — карту можно читать с бумаги. Сетка и координаты
                    в файл — по чекбоксам здесь, экранные тумблеры не влияют.
                  </p>
                  {map && (() => {
                    // D5: честный размер файла и бумаги до скачивания (А4 — 21×29,7 см).
                    const bb = worldBounds(map.grid, map.width, map.height);
                    const wpx = Math.round((bb.maxX - bb.minX) * pngDensity);
                    const hpx = Math.round((bb.maxY - bb.minY) * pngDensity);
                    const cm = (px: number) => (Math.round(((px / 96) * 2.54) * 10) / 10).toString().replace(".", ",");
                    return (
                      <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "6px 0 0" }}>
                        Файл ≈ {wpx}×{hpx} px (~{cm(wpx)}×{cm(hpx)} см при 96 dpi; лист А4 — 21×29,7 см).
                      </p>
                    );
                  })()}
                </div>
              )}
              {xferOpen && (
                <div className="card" style={{ padding: "10px 12px" }} aria-label="Обмен JSON">
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                    <button type="button" className="primary" onClick={exportJson}>
                      Скачать JSON
                    </button>
                    <label className="row" style={{ gap: 6 }} title="Загрузить клетки, объекты и генератор из файла в эту карту">
                      Загрузить
                      <input
                        type="file"
                        accept=".json,application/json"
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          e.target.value = "";
                          if (f) importJson(f);
                        }}
                      />
                    </label>
                  </div>
                  <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "6px 0 0" }}>
                    Выгрузка — всё: клетки, объекты, генератор, привязки не едут (id чужие). Загрузка меняет только
                    содержимое — имя, масштаб и размер остаются, шаг — в историю. Сетка и размер файла обязаны совпасть.
                  </p>
                  {xferMsg && <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "6px 0 0" }}>{xferMsg}</p>}
                </div>
              )}
              {bindOpen && map && (
                <div className="card" style={{ padding: "10px 12px" }} aria-label="Привязки карты">
                  {bindings.length === 0 ? (
                    <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: "0 0 8px" }}>
                      Ни к чему не привязана — стоит одна. Привяжите к сеттингу, кампании или локации, чтобы находить отсюда и оттуда.
                    </p>
                  ) : (
                    <ul style={{ listStyle: "none", margin: "0 0 8px", padding: 0 }}>
                      {bindings.map((bnd) => (
                        <li key={bnd.id} className="row" style={{ gap: 8, alignItems: "center" }}>
                          <span className="badge tag">{BIND_TYPE_LABELS[bnd.target_type]}</span>
                          <span>{bnd.target_name ?? `#${bnd.target_id}`}</span>
                          <span style={{ flex: 1 }} />
                          <button
                            type="button"
                            title="Отвязать"
                            aria-label={`Отвязать ${bnd.target_name ?? `#${bnd.target_id}`}`}
                            onClick={() => removeBinding(bnd.id)}
                            style={{ padding: "2px 8px" }}
                          >
                            ×
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "end" }}>
                    <label>
                      Тип
                      <select
                        value={bindType}
                        onChange={(e) => {
                          setBindType(e.target.value as MapBinding["target_type"]);
                          setBindTarget(0);
                        }}
                      >
                        {(Object.keys(BIND_TYPE_LABELS) as MapBinding["target_type"][]).map((t) => (
                          <option key={t} value={t}>
                            {BIND_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {bindType === "location" && (
                      <label>
                        Сеттинг
                        <select value={bindSetting} onChange={(e) => setBindSetting(Number(e.target.value))}>
                          <option value={0}>— выберите —</option>
                          {bindSettings.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                    <label>
                      {BIND_TYPE_LABELS[bindType]}
                      <select value={bindTarget} onChange={(e) => setBindTarget(Number(e.target.value))}>
                        <option value={0}>— выберите —</option>
                        {bindOptions
                          .filter((o) => !bindings.some((b) => b.target_type === bindType && b.target_id === o.id))
                          .map((o) => (
                            <option key={o.id} value={o.id}>
                              {o.name}
                            </option>
                          ))}
                      </select>
                    </label>
                    <button type="button" className="primary" onClick={addBinding}>
                      Привязать
                    </button>
                  </div>
                  {bindError && <p className="muted">{bindError}</p>}
                </div>
              )}
              {settingsOpen && map && (
                <Modal onClose={() => setSettingsOpen(false)}>
                  <h2>Настройки карты</h2>
                  <div className="stack">
                    <label>
                      Название
                      <input value={sName} onChange={(e) => setSName(e.target.value)} placeholder="Например, Эстария" />
                    </label>
                    <label>
                      Масштаб
                      <select value={sScale} onChange={(e) => setSScale(e.target.value as MapScale)}>
                        {MAP_SCALE_ORDER.map((s) => (
                          <option key={s} value={s}>
                            {MAP_SCALE_LABELS[s]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label title="Подпись вида «1 клетка = …», вшивается в PNG позже">
                      Подпись клетки
                      <input
                        value={sLore}
                        onChange={(e) => setSLore(e.target.value)}
                        placeholder="Например, 2 км"
                      />
                    </label>
                    <div className="row" style={{ gap: 8 }}>
                      <label>
                        Ширина
                        <input
                          type="number"
                          min={MAP_MIN_SIDE}
                          max={MAP_MAX_SIDE}
                          value={sWidth}
                          onChange={(e) => setSWidth(Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Высота
                        <input
                          type="number"
                          min={MAP_MIN_SIDE}
                          max={MAP_MAX_SIDE}
                          value={sHeight}
                          onChange={(e) => setSHeight(Number(e.target.value))}
                        />
                      </label>
                    </div>
                    <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: 0 }}>
                      Сетка — навсегда и здесь не меняется.{" "}
                      {(sWidth < map.width || sHeight < map.height)
                        ? "Поле ужмётся: клетки, подписи и объекты снаружи пропадут (комната, торчащая за край, — целиком), шаг — в историю."
                        : "Размер растёт без потерь: новое — равнина."}
                    </p>
                    {settingsError && <p className="muted">{settingsError}</p>}
                    <div className="modal-footer row">
                      <button onClick={() => setSettingsOpen(false)}>Отмена</button>
                      <button className="primary" onClick={saveSettings}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {labelDraft && (
                <Modal onClose={() => setLabelDraft(null)}>
                  <h2>
                    Подпись {map ? coordLabel(labelDraft.x, labelDraft.y) : ""}
                  </h2>
                  <div className="stack">
                    <label>
                      Название места
                      <input
                        value={labelDraft.text}
                        onChange={(e) => setLabelDraft((d) => (d ? { ...d, text: e.target.value } : d))}
                        placeholder="Например, Вотердип"
                        maxLength={64}
                      />
                    </label>
                    {labelError && <p className="muted">{labelError}</p>}
                    <div className="modal-footer row">
                      {labelDraft.existed && (
                        <button type="button" onClick={deleteLabel}>
                          Удалить
                        </button>
                      )}
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setLabelDraft(null)}>Отмена</button>
                      <button className="primary" onClick={saveLabelDraft}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {doorDraft && (
                <Modal onClose={() => setDoorDraft(null)}>
                  <h2>Дверь</h2>
                  <div className="stack">
                    <label>
                      Вид
                      <select
                        value={doorDraft.kind}
                        onChange={(e) => setDoorDraft((d) => (d ? { ...d, kind: e.target.value as MapDoorKind } : d))}
                      >
                        {MAP_DOOR_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {MAP_DOOR_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="row" style={{ gap: 6 }} title="Секретную не видят игроки">
                      <input
                        type="checkbox"
                        checked={doorDraft.secret}
                        onChange={(e) => setDoorDraft((d) => (d ? { ...d, secret: e.target.checked } : d))}
                      />
                      Секретная (скрыта от игроков)
                    </label>
                    {objError && <p className="muted">{objError}</p>}
                    <div className="modal-footer row">
                      <button type="button" onClick={deleteDoor}>
                        Удалить
                      </button>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setDoorDraft(null)}>Отмена</button>
                      <button className="primary" onClick={saveDoorDraft}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {trapDraft && (
                <Modal onClose={() => setTrapDraft(null)}>
                  <h2>Ловушка (скрыта от игроков)</h2>
                  <div className="stack">
                    <label>
                      Вид
                      <select
                        value={trapDraft.kind}
                        onChange={(e) => {
                          const kind = e.target.value as MapTrapKind;
                          setTrapDraft((d) => (d ? { ...d, kind } : d));
                          setLastTrapKind(kind);
                        }}
                      >
                        {MAP_TRAP_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {MAP_TRAP_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {objError && <p className="muted">{objError}</p>}
                    <div className="modal-footer row">
                      <button type="button" onClick={deleteTrap}>
                        Удалить
                      </button>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setTrapDraft(null)}>Отмена</button>
                      <button className="primary" onClick={saveTrapDraft}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {markerDraft && (
                <Modal onClose={() => setMarkerDraft(null)}>
                  <h2>Маркер (видят игроки)</h2>
                  <div className="stack">
                    <label>
                      Вид
                      <select
                        value={markerDraft.kind}
                        onChange={(e) => setMarkerDraft((d) => (d ? { ...d, kind: e.target.value as MapMarkerKind } : d))}
                      >
                        {MAP_MARKER_KINDS.map((k) => (
                          <option key={k} value={k}>
                            {MAP_MARKER_LABELS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                    {objError && <p className="muted">{objError}</p>}
                    <div className="modal-footer row">
                      <button type="button" onClick={deleteMarker}>
                        Удалить
                      </button>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setMarkerDraft(null)}>Отмена</button>
                      <button className="primary" onClick={saveMarkerDraft}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {roomDraft && (
                <Modal onClose={() => { setRoomDraft(null); roomRectRef.current = null; setRectPreview(null); }}>
                  <h2>{roomDraft.index === -1 ? "Новая комната" : "Комната"}</h2>
                  <div className="stack">
                    <label>
                      Тип
                      <select
                        value={roomDraft.type}
                        onChange={(e) => setRoomDraft((d) => (d ? { ...d, type: e.target.value as MapRoomType } : d))}
                      >
                        {MAP_ROOM_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {MAP_ROOM_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label>
                      Название (необязательно)
                      <input
                        value={roomDraft.name}
                        onChange={(e) => setRoomDraft((d) => (d ? { ...d, name: e.target.value } : d))}
                        placeholder="Например, Зал эха"
                        maxLength={64}
                      />
                    </label>
                    {objError && <p className="muted">{objError}</p>}
                    <div className="modal-footer row">
                      {roomDraft.index !== -1 && (
                        <button type="button" onClick={deleteRoom}>
                          Удалить
                        </button>
                      )}
                      <span style={{ flex: 1 }} />
                      <button onClick={() => { setRoomDraft(null); roomRectRef.current = null; setRectPreview(null); }}>
                        Отмена
                      </button>
                      <button className="primary" onClick={saveRoomDraft}>
                        Сохранить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {createDraft && (
                <Modal onClose={() => setCreateDraft(null)}>
                  <h2>
                    Новое {map ? coordLabel(createDraft.x, createDraft.y) : ""}
                  </h2>
                  <div className="stack">
                    <label>
                      Что поставить
                      <select
                        value={createDraft.choice}
                        onChange={(e) =>
                          setCreateDraft((d) =>
                            d ? { ...d, choice: e.target.value as "door" | "trap" | "start" | "finish" } : d
                          )
                        }
                      >
                        {map?.grid === "square" && <option value="door">Дверь (вид — в панели после)</option>}
                        <option value="trap">Ловушка (скрыта от игроков)</option>
                        <option value="start">Старт (заменит)</option>
                        <option value="finish">Финиш (заменит)</option>
                      </select>
                      {map?.grid !== "square" && (
                        <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: 0 }}>
                          Двери на рёбрах — только на квадратах; на гексах доступны ловушки, старт и финиш.
                        </p>
                      )}
                    </label>
                    {objError && <p className="muted">{objError}</p>}
                    <div className="modal-footer row">
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setCreateDraft(null)}>Отмена</button>
                      <button className="primary" onClick={saveCreateDraft}>
                        Поставить
                      </button>
                    </div>
                  </div>
                </Modal>
              )}
              {sfDraft && (
                <Modal onClose={() => setSfDraft(null)}>
                  <h2>{sfDraft.kind === "start" ? "Старт" : "Финиш"}</h2>
                  <div className="stack">
                    <p className="muted" style={{ fontSize: "var(--fs-micro)", margin: 0 }}>
                      {sfDraft.kind === "start"
                        ? "Отсюда начинается путь. Тащится выбором, виден всем."
                        : "Цель пути. Тащится выбором, видна всем."}
                    </p>
                    {objError && <p className="muted">{objError}</p>}
                    <div className="modal-footer row">
                      <button type="button" onClick={deleteSf}>
                        Удалить
                      </button>
                      <span style={{ flex: 1 }} />
                      <button onClick={() => setSfDraft(null)}>Закрыть</button>
                    </div>
                  </div>
                </Modal>
              )}
            </>
          )}

          {actionError && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>{actionError}</span>
              <button type="button" onClick={() => setActionError(null)}>
                Понятно
              </button>
            </div>
          )}
          {shared && map && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>
                Игрокам открыто — карта видна в их разделе «Карты» (вид игрока, без секретного).
                Ссылка: <Link to={`/maps/${map.id}`}>{`${window.location.origin}/maps/${map.id}`}</Link> (скопирована, если буфер доступен).
              </span>
              <button type="button" onClick={() => setShared(false)}>
                Понятно
              </button>
            </div>
          )}
          {blobCorrupt && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>
                Данные клеток повреждены — показана пустая карта. Автосохранение остановлено, чтобы первая правка
                их не затёрла.
              </span>
              <button type="button" onClick={() => setBlobCorrupt(false)}>
                Понял, разрешаю перезапись
              </button>
            </div>
          )}
          <div className="res-toolbar" role="toolbar" aria-label="Камера">
            <button type="button" title="Приблизить (+)" aria-label="Приблизить" onClick={() => zoomBy(1.25)}>
              +
            </button>
            <button type="button" title="Отдалить (−)" aria-label="Отдалить" onClick={() => zoomBy(1 / 1.25)}>
              −
            </button>
            <button type="button" title="Вписать карту в окно (0) — сбрасывает запомненную позицию" onClick={() => fitCamera(true)}>
              Вписать
            </button>
            {canEdit && (
              <button
                type="button"
                className="map-tool"
                aria-pressed={previewAsPlayer}
                title="Показать карту глазами игрока: без секретных дверей и ловушек"
                onClick={() => setPreviewAsPlayer((v) => !v)}
              >
                Глазами игрока
              </button>
            )}
            <span
              className="muted"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}
              title="Координата под курсором · точек на клетку (подписи рисуются от 18)"
            >
              {hover
                ? (() => {
                    const [hx, hy] = hover.split(",").map(Number);
                    return Number.isInteger(hx) && Number.isInteger(hy) ? `${coordLabel(hx, hy)} · ` : "";
                  })()
                : ""}
              {Math.round(cam.scale)} пт/кл
            </span>
          </div>
          <div
            ref={wrapRef}
            className="card"
            style={{ height: "clamp(420px, 68vh, 780px)", padding: 0, overflow: "hidden", touchAction: "none", position: "relative" }}
          >
            <canvas
              ref={canvasRef}
              role="img"
              aria-label={
                map
                  ? `Карта «${map.name}», поле ${map.width} на ${map.height}, ${MAP_GRID_LABELS[map.grid].toLowerCase()}`
                  : "Карта"
              }
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerCancel}
              onDoubleClick={() => {
                // Дабл-клик — финиш полилинии стен по готовым вершинам (Этап E).
                if (toolRef.current === "wall" && wallLineModeRef.current && canEdit) finishWallLine(false);
              }}
              onTouchStart={onTouchStart}
              onTouchMove={onTouchMove}
              onTouchEnd={onTouchEnd}
              onContextMenu={(e) => e.preventDefault()}
              style={{
                display: "block",
                cursor: !canEdit
                  ? "default"
                  : spaceDown
                    ? "grab"
                    : tool === "picker"
                      ? "copy"
                      : tool === "select"
                        ? "default"
                        : "crosshair",
              }}
            />
            {map && miniThumb && (
              <div
                role="button"
                aria-label="Миникарта: клик — перейти"
                title={(() => {
                  // D6: сколько клеток влезает в текущий вид — иначе рамка ни о чём.
                  const wrect = wrapRef.current?.getBoundingClientRect();
                  const vw =
                    wrect && wrect.width >= 10
                      ? ` · видно ≈${Math.max(1, Math.round(wrect.width / cam.scale))}×${Math.max(1, Math.round(wrect.height / cam.scale))} кл`
                      : "";
                  return `Миникарта: клик — перейти${vw}`;
                })()}
                onClick={jumpToMini}
                style={{
                  position: "absolute",
                  right: 8,
                  bottom: 8,
                  width: 132,
                  border: "1px solid var(--line)",
                  background: "var(--paper)",
                  cursor: "pointer",
                }}
              >
                <img src={miniThumb} alt="" style={{ display: "block", width: "100%" }} draggable={false} />
                {(() => {
                  const b = worldBounds(map.grid, map.width, map.height);
                  const wrect = wrapRef.current?.getBoundingClientRect();
                  if (!wrect || wrect.width < 10) return null;
                  const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
                  const x0 = clamp01((-cam.ox / cam.scale - b.minX) / (b.maxX - b.minX));
                  const x1 = clamp01(((wrect.width - cam.ox) / cam.scale - b.minX) / (b.maxX - b.minX));
                  const y0 = clamp01((-cam.oy / cam.scale - b.minY) / (b.maxY - b.minY));
                  const y1 = clamp01(((wrect.height - cam.oy) / cam.scale - b.minY) / (b.maxY - b.minY));
                  return (
                    <div
                      aria-hidden="true"
                      style={{
                        position: "absolute",
                        left: `${x0 * 100}%`,
                        top: `${y0 * 100}%`,
                        width: `${Math.max(2, (x1 - x0) * 100)}%`,
                        height: `${Math.max(2, (y1 - y0) * 100)}%`,
                        border: "1px solid var(--ink)",
                        pointerEvents: "none",
                      }}
                    />
                  );
                })()}
              </div>
            )}
          </div>
          <p className="muted" style={{ fontSize: "var(--fs-micro)" }}>
            {canEdit
              ? "Выбор (V): клик — панель, тяни объект — двигать, Del — удалить, пустое — создать. Левая — рисовать, правая — стереть, Alt+клик — пипетка, N — река, W — стены, U — шейп, D — дверь, M — линейка, T — подпись, колесо или +/− — масштаб, 0 — вписать, средняя кнопка или пробел — сдвиг. Alt+G — генератор, Alt+P — PNG."
              : "Колесо или +/− — масштаб, 0 — вписать, средняя кнопка или пробел — сдвиг."}
          </p>
          {canEdit && (
            <details className="muted" style={{ fontSize: "var(--fs-micro)" }}>
              <summary style={{ cursor: "pointer" }}>Горячие клавиши</summary>
              <p style={{ margin: "4px 0" }}>
                V выбор · B кисть · G заливка · E ластик · I пипетка · R дорога · N река · W стены · U шейп · D дверь · L ловушка · C сундук · A алтарь · K маркер · S старт · F финиш · M линейка · T подпись ·
                Ctrl+Z отменить · Ctrl+Shift+Z / Ctrl+Y вернуть · Del удалить объект · +/− масштаб · 0 вписать ·
                Alt+G генератор · Alt+P экспорт PNG · Ctrl+Enter сгенерировать (панель открыта) · Esc сбросить замер.
              </p>
            </details>
          )}
          {/* Живой регион (P2-7): инструмент/террейн/статус для скринридера.
              Ховер сюда не идёт — иначе spell-check очереди на каждый пиксель. */}
          <p
            aria-live="polite"
            style={{
              position: "absolute",
              width: 1,
              height: 1,
              overflow: "hidden",
              clip: "rect(0 0 0 0)",
              whiteSpace: "nowrap",
            }}
          >
            {map
              ? `Инструмент: ${ALL_TOOL_LABELS.find((t) => t.id === tool)?.label ?? tool}${
                  tool === "brush" ? `, террейн: ${MAP_TERRAIN_LABELS[terrain] ?? terrain}` : ""
                }. ${saveLabel()}.`
              : "Карта загружается."}
          </p>
          {dialog}
        </>
      )}
    </div>
  );
}
