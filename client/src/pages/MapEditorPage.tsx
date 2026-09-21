import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { readOnce } from "../data/imperative";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { coordLabel, parseKey, worldBounds } from "../maps/grid";
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
  translateMapError,
  type MapFull,
  type MapScale,
} from "../maps/mapTypes";
import { useMapCamera } from "../maps/editor/hooks/useMapCamera";
import { useMapHistory } from "../maps/editor/hooks/useMapHistory";
import { useMapHotkeys } from "../maps/editor/hooks/useMapHotkeys";
import { useMapAutosave } from "../maps/editor/hooks/useMapAutosave";
import { useMapInput } from "../maps/editor/hooks/useMapInput";
import { useMapSelection, type ObjSel, selectedKeyOf } from "../maps/editor/hooks/useMapSelection";
import { useMapTools } from "../maps/editor/hooks/useMapTools";
import { MapViewport } from "../maps/editor/components/MapViewport";
import type { BrushSize, PaintTool } from "../maps/editor/editorTypes";
// Фаза 2C: shadow audit V5 при загрузке — derived snapshot, только диагностика.
// Не editor state, не влияет на load/render/autosave/history.
import { auditLoadedMapShadow } from "../maps/core/shadowAudit";

const UNDO_DEPTH = 50;

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
// Чистые операции инструментов живут в tools/* рядом с группами.

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
  const afterWrite = useAfterWrite();
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
  const [hover, setHover] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(() => loadFlag("maps.showGrid", true));
  const [showCoords, setShowCoords] = useState(() => loadFlag("maps.showCoords", false));

  // Инструменты (тикет 04). Пипетка и заливка — одноразовые действия,
  // кисть/дорога/ластик — мазки от нажатия до отпускания.
  const [tool, setTool] = useState<PaintTool>("brush");
  const [terrain, setTerrain] = useState<string>("forest");
  const [brushSize, setBrushSize] = useState<BrushSize>(1);
  // История (Этап 2): snapshot-стек, UNDO_DEPTH=50, stroke=один шаг — в хуке.
  // Эфемерная (не переживает перезагрузку): прошлое/будущее — снимки клеток.
  const history = useMapHistory<MapCells>({
    value: cells,
    onChange: setCells,
    clone: cloneCells,
    depth: UNDO_DEPTH,
  });
  const { canUndo, canRedo } = history;
  const [dialog, confirm] = useConfirm();

  // Генератор (тикет 05): параметры живут отдельно, уходят в то же
  // автосохранение, что и клетки. Сид/ползунки без «Сгенерировать» карту
  // не меняют — только запоминаются для следующего прогона.
  const [genOpen, setGenOpen] = useState(false);
  const [genParams, setGenParams] = useState<GeneratorParams>({ seed: 0, sea: 55, mountains: 12, forest: 30 });

  const cellsRef = useRef(cells);
  cellsRef.current = cells;

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Камера (Этап 1): state, fit/zoom, wheel, persist — в хуке, математика та же.
  const { cam, setCam, camRef, fitCamera, zoomBy, toWorld, touchToWorld } = useMapCamera({
    map,
    wrapRef,
    canvasRef,
  });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    autosave.beginLoad();
    // Клетки редактируются здесь, поэтому карта читается мимо кэша слоя:
    // перечитывание по чужой правке легло бы поверх несохранённых мазков.
    readOnce<MapFull>(`/maps/${id}`)
      .then((data) => {
        if (!alive) return;
        setMap(data);
        const parsed = parseCellsBlob(data.cells);
        setCells(parsed);
        // Эталон — в нормализованной форме (порядок ключей/пробелы сырого
        // blob'а иначе давали бы ложное «изменено» и сохранение при открытии).
        const params = { seed: data.seed, sea: data.sea, mountains: data.mountains, forest: data.forest };
        const paramsStr = JSON.stringify(params);
        setGenParams(params);
        history.clear();
        autosave.markLoaded(serializeCells(parsed), paramsStr, cellsBlobStatus(data.cells) === "corrupt");
        setShared(false);
        // Shadow-ветка 2C: аудит derived V5-снапшота. Side branch после всех
        // state-эффектов: не читает и не меняет cells/map/history/autosave.
        auditLoadedMapShadow({
          mapId: data.id,
          grid: data.grid,
          width: data.width,
          height: data.height,
          cells: parsed,
          corrupt: cellsBlobStatus(data.cells) === "corrupt",
        });
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

  // Автосохранение (Этап Autosave): debounce/seq/thumb/dirty/retry/unload/corrupt — в хуке.
  // Битый blob (P1-7): показываем пустую карту, автосейв поверх — только после
  // явного разрешения (иначе первая правка молча хоронила бы исходные данные).
  const autosave = useMapAutosave({
    map,
    cells,
    params: genParams,
    serializeCells,
    save: (mapId, body) => write.put(`/maps/${mapId}`, body),
    buildThumbnail: (m, live) => renderThumbnail(m.grid, m.width, m.height, live, readChrome()),
    onSaved: (savedId) => afterWrite([{ kind: "map", id: savedId, card: true }]),
  });

  // Д-14: индикатор несохранённого в title вкладки — тулбар не виден с другой
  // вкладки, а beforeunload без контекста («у вас правки на карте XYZ»).
  const baseTitleRef = useRef(document.title);
  useEffect(() => {
    if (!map) return;
    const base = `Карта «${map.name}» — SoyMan`;
    document.title =
      autosave.status.kind === "saved" ? base : `● ${base} (не сохранено)`;
    return () => {
      document.title = baseTitleRef.current;
    };
  }, [map?.name, autosave.status.kind]);

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
    history.push(before);
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
    history.push(before);
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
    history.push(before);
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
  const [bindType, setBindType] = useState<MapBinding["target_type"]>("setting");
  const [bindSetting, setBindSetting] = useState<number>(0);
  const [bindTarget, setBindTarget] = useState<number>(0);
  const [bindError, setBindError] = useState<string | null>(null);
  const bindingsPath = map ? `/maps/${map.id}/bindings` : null;
  const bindingsState = useResource<MapBinding[]>(bindingsPath);
  const bindings = bindingsState.data ?? [];
  // Селекты привязок — лениво, только при раскрытой панели.
  const bindSettings = useResource<{ id: number; name: string }[]>(bindOpen ? "/settings" : null).data ?? [];
  const bindOptionsPath = !bindOpen
    ? null
    : bindType === "location"
      ? bindSetting
        ? `/setting-locations?setting_id=${bindSetting}`
        : null
      : bindType === "setting"
        ? "/settings"
        : "/campaigns";
  const bindOptionsState = useResource<{ id: number; name: string }[]>(bindOptionsPath);
  const bindOptions = bindOptionsState.data ?? [];
  const bindLoadError = bindingsState.error ?? bindOptionsState.error;

  async function addBinding() {
    if (!map || !bindTarget) {
      setBindError("Выберите сущность для привязки.");
      return;
    }
    setBindError(null);
    try {
      await write.post(`/maps/${map.id}/bindings`, { target_type: bindType, target_id: bindTarget });
      afterWrite([{ path: `/maps/${map.id}/bindings` }]);
      setBindTarget(0);
    } catch (e) {
      setBindError(translateMapError(e));
    }
  }

  async function removeBinding(bindingId: number) {
    if (!map) return;
    setBindError(null);
    try {
      await write.del(`/maps/${map.id}/bindings/${bindingId}`);
      afterWrite([{ path: `/maps/${map.id}/bindings` }]);
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
        await write.put(`/maps/${map.id}`, { player_visible: 1 });
        afterWrite([{ kind: "map", id: map.id, card: true }]);
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

  // Новый тип или сеттинг — прежний выбор цели к ним не относится.
  useEffect(() => {
    setBindTarget(0);
  }, [bindType, bindSetting]);

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

  useEffect(() => {
    if (tool !== "ruler") setRuler(null);
  }, [tool]);

  // Стены линией (Этап E): вершины полилинии в мировых координатах + живой конец
  // за курсором. Снеп — квант вершины к центру клетки при клике.
  const [wallLineMode, setWallLineMode] = useState(false);
  const [wallSnap, setWallSnap] = useState(true);
  const [wallDraft, setWallDraft] = useState<{ x: number; y: number }[] | null>(null);
  const [wallLive, setWallLive] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (tool !== "wall") {
      setWallDraft(null);
      setWallLive(null);
    }
  }, [tool]);

  // Шейпы (Этап E): прямоугольник + содержимое. Мышь — drag, тач — два тапа по углам.
  const [shapeContent, setShapeContent] = useState<"room" | "terrain" | "road" | "river" | "wall" | "eraser">("room");
  const [shapeAnchor, setShapeAnchor] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    if (tool !== "shape") {
      setShapeAnchor(null);
      input.shapeDragRef.current = null;
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
    history.push(before);
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
    history.push(before);
    setLabelDraft(null);
  }

  // Слой объектов: выбор (пакет A). Индекс — в массивы cells; любая замена
  // клеток выбор сбрасывает (панели и drag живут на рефах, им не мешает).
  const selection = useMapSelection({
    cells,
    cellsRef,
    setCells,
    commitChange: mutateObjects,
    clone: cloneCells,
  });
  const { selected } = selection;

  // Хит-тест и перемещение/удаление — в useMapSelection (та же геометрия
  // и приоритеты: door → trap → marker → start/finish → room).

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
  // Drag объекта и создание комнаты прямоугольником (выбор) — живут в useMapInput.
  const [rectPreview, setRectPreview] = useState<{ x: number; y: number; w: number; h: number } | null>(null);

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
    history.push(before);
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
    selection.clearSelection();
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
    selection.clearSelection();
  }

  function saveTrapDraft() {
    const t = trapDraft;
    if (!t) return;
    const before = cloneCells(cellsRef.current);
    if (!before.traps[t.index]) return;
    const traps = before.traps.map((x, i) => (i === t.index ? { ...x, kind: t.kind } : x));
    mutateObjects({ ...before, traps }, before);
    setTrapDraft(null);
    selection.clearSelection();
  }

  function deleteTrap() {
    const t = trapDraft;
    if (!t) return;
    const before = cloneCells(cellsRef.current);
    mutateObjects({ ...before, traps: before.traps.filter((_, i) => i !== t.index) }, before);
    setTrapDraft(null);
    selection.clearSelection();
  }

  function saveMarkerDraft() {
    const m = markerDraft;
    if (!m) return;
    const before = cloneCells(cellsRef.current);
    if (!before.markers[m.index]) return;
    const markers = before.markers.map((x, i) => (i === m.index ? { ...x, kind: m.kind } : x));
    mutateObjects({ ...before, markers }, before);
    setMarkerDraft(null);
    selection.clearSelection();
  }

  function deleteMarker() {
    const m = markerDraft;
    if (!m) return;
    const before = cloneCells(cellsRef.current);
    mutateObjects({ ...before, markers: before.markers.filter((_, i) => i !== m.index) }, before);
    setMarkerDraft(null);
    selection.clearSelection();
  }

  function saveRoomDraft() {
    const r = roomDraft;
    if (!r || !map) return;
    const before = cloneCells(cellsRef.current);
    if (r.index === -1) {
      const rect = input.roomRectRef.current;
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
    input.roomRectRef.current = null;
    setRectPreview(null);
    selection.clearSelection();
  }

  function deleteRoom() {
    const r = roomDraft;
    if (!r || r.index === -1) return;
    const before = cloneCells(cellsRef.current);
    mutateObjects({ ...before, rooms: before.rooms.filter((_, i) => i !== r.index) }, before);
    setRoomDraft(null);
    selection.clearSelection();
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
    selection.clearSelection();
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
    selection.clearSelection();
  }

  // Удаление и перемещение — в useMapSelection (та же геометрия и pair-правила).

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
    selection.clearSelection();
    input.rectRef.current = null;
    input.roomRectRef.current = null;
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
      history.push(before);
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
      const updated = await write.put<MapFull>(`/maps/${map.id}`, {
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
        history.push(before);
      }
      afterWrite([{ kind: "map", id: map.id, card: true }]);
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
      const created = await write.post<{ id: number }>("/maps", {
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
      afterWrite([{ kind: "map", card: true }]);
      navigate(`/maps/${created.id}`);
    } catch (e) {
      setActionError(translateMapError(e));
    }
  }

  async function deleteMap() {
    if (!map) return;
    const ok = await confirm({
      title: "Убрать карту в архив?",
      message: `«${map.name}» уйдёт в раздел «Архив» вместе со всеми клетками. Вернуть можно оттуда же.`,
      confirmLabel: "В архив",
      cancelLabel: "Оставить",
      danger: true,
    });
    if (!ok) return;
    try {
      await write.del(`/maps/${map.id}`);
      afterWrite([{ kind: "map", id: map.id, card: true }]);
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

  // Шейп-прямоугольник и мазки — в tools/* (применение — там же).

  // Красящие инструменты и установка объектов — в tools/*.

  // Последний вид ловушки для инструмента (в панели вид меняется; Этап F).
  const [lastTrapKind, setLastTrapKind] = useState<MapTrapKind>("pit");
  // Вид маркера для инструмента «Маркер» (города/POI; сундук/алтарь — свои кнопки).
  const [markerKind, setMarkerKind] = useState<Exclude<MapMarkerKind, "chest" | "altar">>("city");

  // Живая ссылка на инструмент для selectTool/double-click —
  // иначе читали бы то, что было выбрано при монтировании.
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Кадр — в MapViewport (DPR/canvas/renderMap/оверлеи там же, deps те же).

  // Пробел — временная панорама левой кнопкой — в useMapInput (spaceDown оттуда же).

  // Хоткеи (Этап Hotkeys): keyboard router — в хуке, mapping и гарды те же.
  // Space-пан — отдельным эффектом выше (input/camera), не часть роутера.
  useMapHotkeys({
    canEdit,
    onSelectTool: selectTool,
    onUndo: history.undo,
    onRedo: history.redo,
    onZoomIn: () => zoomBy(1.25),
    onZoomOut: () => zoomBy(1 / 1.25),
    onFit: () => fitCamera(true),
    hasSelection: selected !== null,
    onDeleteSelected: selection.deleteSelected,
    onCancel: () => {
      setRuler(null);
      setWallDraft(null);
      setWallLive(null);
      setShapeAnchor(null);
    },
    canFinishWall: (wallDraft?.length ?? 0) > 0,
    onFinishWall: () => tools.wall.finishWallLine(true),
    isGenOpen: genOpen,
    onGenerate: generate,
    onToggleGen: toggleGen,
    onTogglePng: togglePng,
  });


  // Создание по пустой клетке (мышь и тач делят логику): на гексах дверей
  // на рёбрах нет — сразу предлагаем ловушку (дверь в модалке скрыта).
  function openCreateForCell(cell: { x: number; y: number }, wx: number, wy: number) {
    if (!map) return;
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

  // Инструменты (Этап Tool Controller): доменная логика — в tools/*,
  // композиция — в useMapTools. Страница хранит editor/UI state и связывает
  // колбэки; как именно кисть меняет MapCells, она больше не знает.
  const tools = useMapTools({
    map,
    tool,
    terrain,
    brushSize,
    wallSnap,
    wallDraft,
    wallLive,
    shapeContent,
    shapeAnchor,
    ruler,
    lastTrapKind,
    markerKind,
    cellsRef,
    setCells,
    clone: cloneCells,
    push: history.push,
    commitChange: mutateObjects,
    selectTool,
    setTerrain,
    setRuler,
    setWallDraft,
    setWallLive,
    setShapeAnchor,
    setRectPreview,
    setActionError,
    onRequestRoomCreate: (rect) => {
      input.roomRectRef.current = rect;
      setRoomDraft({ index: -1, type: "empty", name: "" });
      setObjError(null);
    },
    onRequestLabelEdit: (x, y) => {
      openLabelEditor(x, y);
    },
    openObjectPanel: (sel) => {
      openObjPanel(sel);
    },
    openCreate: (cell, wx, wy) => {
      openCreateForCell(cell, wx, wy);
    },
    openRoomDraft: () => {
      setRoomDraft({ index: -1, type: "empty", name: "" });
      setObjError(null);
    },
    cancelObjectDrag: (before) => {
      cellsRef.current = before;
      setCells(before);
    },
  });

  // Ввод (Этап Input): pointer/touch state machine — в хуке; tools приходят
  // фасадом выше, маршрутизация Input не менялась.
  const input = useMapInput({
    canvasRef,
    cellsRef,
    camera: { setCam, camRef, toWorld, touchToWorld },
    history,
    selection,
    map,
    tool,
    canEdit,
    clone: cloneCells,
    wallMode: wallLineMode,
    wallDraft,
    ruler,
    setHover,
    setRectPreview,
    tools,
  });

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
    history.push(before);
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
    if (autosave.blocked) return "Сохранение остановлено — данные повреждены";
    if (autosave.status.kind === "saving") return "Сохранение…";
    if (autosave.status.kind === "error") return "Не сохранилось — нажмите «Повторить»";
    if (autosave.status.kind === "dirty") return "Есть несохранённое…";
    return autosave.status.at ? `Сохранено ${autosave.status.at}` : "Сохранено";
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
              <button type="button" title="Убрать карту в архив" onClick={deleteMap}>
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
                    const mapId = map.id;
                    write
                      .put(`/maps/${mapId}`, { player_visible })
                      .then(() => afterWrite([{ kind: "map", id: mapId, card: true }]))
                      .catch((err: unknown) => {
                        // Откат при ошибке: тумблер не должен врать
                        setMap((m) => (m ? { ...m, player_visible: player_visible === 1 ? 0 : 1 } : m));
                        setActionError(translateMapError(err));
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
                <button type="button" disabled={!canUndo} title="Отменить (Ctrl+Z)" onClick={history.undo}>
                  ←
                </button>
                <button
                  type="button"
                  disabled={!canRedo}
                  title="Вернуть (Ctrl+Shift+Z / Ctrl+Y)"
                  onClick={history.redo}
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
                {autosave.status.kind === "error" && (
                  <button type="button" title="Повторить сохранение сейчас" onClick={autosave.retry}>
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
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
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
                  {(bindError || bindLoadError) && <p className="muted">{bindError ?? translateMapError(new Error(bindLoadError ?? ""))}</p>}
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
                <Modal onClose={() => { setRoomDraft(null); input.roomRectRef.current = null; setRectPreview(null); }}>
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
                      <button onClick={() => { setRoomDraft(null); input.roomRectRef.current = null; setRectPreview(null); }}>
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
          {autosave.blocked && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>
                Данные клеток повреждены — показана пустая карта. Автосохранение остановлено, чтобы первая правка
                их не затёрла.
              </span>
              <button type="button" onClick={autosave.allowOverwrite}>
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
            <MapViewport
              wrapRef={wrapRef}
              canvasRef={canvasRef}
              map={map}
              cells={cells}
              cam={cam}
              view={{
                showGrid,
                showCoords,
                previewAsPlayer,
                canEdit,
              }}
              tool={{
                tool,
                brushSize,
                wallLineMode,
              }}
              overlays={{
                hover,
                selectedKey: selectedKeyOf(selected),
                ruler,
                wallDraft,
                wallLive,
                rectPreview,
              }}
              input={{
                onPointerDown: input.onPointerDown,
                onPointerMove: input.onPointerMove,
                onPointerUp: input.onPointerUp,
                onPointerCancel: input.onPointerCancel,
                onTouchStart: input.onTouchStart,
                onTouchMove: input.onTouchMove,
                onTouchEnd: input.onTouchEnd,
                onDoubleClick: () => {
                  // Дабл-клик — финиш полилинии стен по готовым вершинам (Этап E).
                  if (tool === "wall" && wallLineMode && canEdit) tools.wall.finishWallLine(false);
                },
                spaceDown: input.spaceDown,
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
