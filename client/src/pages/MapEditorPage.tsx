import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { readOnce } from "../data/imperative";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { SectionHeading } from "../components/SectionHeading";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { coordLabel, pixelToCell, cellCenter, worldBounds } from "../maps/grid";
import { buildAndDownloadPng } from "../maps/mapExport";
import { sanitizeDownloadName, validateMapImport } from "../maps/mapExchange";
import { generateCells, type GeneratorParams } from "../maps/generate";
import { generateDungeon } from "../maps/dungeon";
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
  doorForView,
  readChrome,
  renderThumbnail,
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
// Фаза 2G: canonical editor state — MapDocumentV5 (иммутабельный).
import { serializeMapDocument } from "../maps/core/serialize";
import { createV5RenderModel } from "../maps/renderModel";
import type { MapDocumentV5 } from "../maps/core/types";
import { loadStoredEditorDocument, type LoadedEditorDocument } from "../maps/editor/loadDocument";
import { compareLegacySemantics } from "../maps/core/semanticEquivalence";
import { parseCellsBlob } from "../maps/render";
import { parseSoyMapV2, buildSoyMapV2 } from "../maps/core/exchangeV2";
import { assessCurrentEditorCompatibility } from "../maps/core/compatibility";
import { migrateLegacyMap, legacyDoorWorldPosition, legacyEdgeOrientation } from "../maps/core/migrateLegacy";
import { validateMapDocument } from "../maps/core/validate";
import { createUuidIdFactory } from "../maps/editor/idFactory";
import { fixConnectivityV5 } from "../maps/editor/fixConnectivityV5";
import {
  createGameplayEntity,
  deleteGameplayEntity,
  setFinish,
  setStart,
  updateGameplayEntity,
} from "../maps/core/mutations/gameplay";
import { applyTerrainCellEdits } from "../maps/core/mutations/terrain";
import { createLabel, deleteLabel, moveLabel, updateLabelText } from "../maps/core/mutations/labels";
import { clearEditableContent, resizeGridDocument } from "../maps/core/mutations/document";
import type { GameplayEntity } from "../maps/core/types";
import { useMapCamera } from "../maps/editor/hooks/useMapCamera";
import { useMapHistory } from "../maps/editor/hooks/useMapHistory";
import { useMapHotkeys } from "../maps/editor/hooks/useMapHotkeys";
import { useMapAutosave } from "../maps/editor/hooks/useMapAutosave";
import { useMapInput } from "../maps/editor/hooks/useMapInput";
import { useMapSelection, type MapGeometry, type V5Selection } from "../maps/editor/hooks/useMapSelection";
import { useMapTools } from "../maps/editor/hooks/useMapTools";
import { MapViewport } from "../maps/editor/components/MapViewport";
import type { BrushSize, PaintTool } from "../maps/editor/editorTypes";

const UNDO_DEPTH = 50;

// Чистые операции инструментов живут в tools/* рядом с группами.

function loadFlag(key: string, dflt: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? dflt : v === "1";
  } catch {
    return dflt;
  }
}

// Подпись, чья containing-cell совпадает (legacy lookup 1:1 на migrated).
function findLabelAtCell(doc: MapDocumentV5, geom: MapGeometry, x: number, y: number) {
  for (const layer of doc.layers) {
    if (layer.kind !== "label") continue;
    for (const l of layer.items) {
      const c = pixelToCell(geom.grid, l.position.x, l.position.y, geom.width, geom.height);
      if (c && c.x === x && c.y === y) return l;
    }
  }
  return undefined;
}

// Gameplay-сущность по stable ID (панели/черновики).
function findGameplayEntity(doc: MapDocumentV5, id: string): GameplayEntity | undefined {
  for (const layer of doc.layers) {
    if (layer.kind !== "gameplay") continue;
    const e = layer.items.find((x) => x.id === id);
    if (e) return e;
  }
  return undefined;
}

// Gameplay-слой документа (инструменты/создание) — первый подходящий.
function gameplayLayerId(doc: MapDocumentV5): string | null {
  const l = doc.layers.find((x) => x.kind === "gameplay");
  return l ? l.id : null;
}

// Текст баннера unsupported-карты (§8 ТЗ 2G): без потери данных.
function describeUnsupported(loaded: LoadedEditorDocument): string {
  const first = loaded.compatibility.reasons[0];
  return (
    "Карта использует функции, которые эта версия редактора не поддерживает. " +
    "Редактирование отключено, чтобы не потерять данные." +
    (first ? ` (${first.code}: ${first.message})` : "")
  );
}

export function MapEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const afterWrite = useAfterWrite();
  const { user } = useCurrentUser();
  const canEdit = user?.role !== "player";

  const [map, setMap] = useState<MapFull | null>(null);
  // Фаза 2G: единственный mutable editor state — MapDocumentV5 (иммутабельный;
  // мутации только через Mutation Core, целые замены — load/undo/import/generator).
  const [document, setDocument] = useState<MapDocumentV5 | null>(null);
  // Совместимость загруженного документа с текущим редактором (§4–8 ТЗ 2G).
  const [unsupported, setUnsupported] = useState<string | null>(null);
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
  // История (V5 snapshots; Mutation Core иммутабелен — храним references,
  // identity clone безопасен и зафиксирован тестом, §22 ТЗ 2G).
  // Эфемерная (не переживает перезагрузку).
  const history = useMapHistory<MapDocumentV5 | null>({
    value: document,
    onChange: setDocument,
    clone: (d) => d,
    depth: UNDO_DEPTH,
  });
  const { canUndo, canRedo } = history;
  const [dialog, confirm] = useConfirm();

  // Генератор (тикет 05): параметры живут отдельно, уходят в то же
  // автосохранение, что и клетки. Сид/ползунки без «Сгенерировать» карту
  // не меняют — только запоминаются для следующего прогона.
  const [genOpen, setGenOpen] = useState(false);
  const [genParams, setGenParams] = useState<GeneratorParams>({ seed: 0, sea: 55, mountains: 12, forest: 30 });

  const documentRef = useRef<MapDocumentV5 | null>(null);
  documentRef.current = document;

  // Editor geometry — производная от document.grid/world (§19–20 ТЗ 2G),
  // не отдельный mutable state. Server columns — persistence mirror.
  const geom: MapGeometry | null = useMemo(() => {
    if (!document?.grid) return null;
    return { grid: document.grid.type, width: document.grid.columns, height: document.grid.rows };
  }, [document]);

  // Render model из документа (§47 ТЗ 2G). Неожиданные diagnostics в DEV —
  // ошибка разработки: Tool создал feature вне renderer-подмножества (§48).
  const model = useMemo(() => {
    if (!document) return null;
    const r = createV5RenderModel(document);
    if (import.meta.env.DEV && r.diagnostics.length > 0) {
      console.error("[Map V5] unexpected render diagnostics", r.diagnostics);
    }
    return r.model;
  }, [document]);

  const newId = useMemo(() => createUuidIdFactory(), []);

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Камера (Этап 1): state, fit/zoom, wheel, persist — в хуке, математика та же.
  // Геометрия — из документа, не из server meta (§19, §21 ТЗ 2G).
  const { cam, setCam, camRef, fitCamera, zoomBy, toWorld, touchToWorld } = useMapCamera({
    mapId: map?.id ?? null,
    geom,
    wrapRef,
    canvasRef,
  });

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setLoadError(null);
    autosave.beginLoad();
    // Карта читается мимо кэша слоя: перечитывание по чужой правке легло бы
    // поверх несохранённых правок.
    readOnce<MapFull>(`/maps/${id}`)
      .then((data) => {
        if (!alive) return;
        setMap(data);
        // Load normalization (§10–12 ТЗ 2G): legacy → migrate, V5 → напрямую.
        const loaded = loadStoredEditorDocument({
          cells: data.cells,
          grid: data.grid,
          width: data.width,
          height: data.height,
        });
        documentRef.current = loaded.document;
        setDocument(loaded.document);
        setUnsupported(loaded.compatibility.compatible ? null : describeUnsupported(loaded));
        // Эталон — canonical serialization migrated-документа (§14 ТЗ 2G):
        // иначе in-memory V5 сразу казался бы dirty. Write-on-load нет (§13).
        const params = { seed: data.seed, sea: data.sea, mountains: data.mountains, forest: data.forest };
        const paramsStr = JSON.stringify(params);
        setGenParams(params);
        history.clear();
        autosave.markLoaded(serializeMapDocument(loaded.document), paramsStr, loaded.corrupt);
        setShared(false);
        if (import.meta.env.DEV) {
          for (const w of loaded.migrationWarnings) {
            console.warn("[Map V5] migration warning", w);
          }
          // §74 ТЗ 2G: equivalence без повторной миграции (cells transient).
          if (loaded.sourceFormat === "legacy" && !loaded.corrupt) {
            const legacy = parseCellsBlob(data.cells);
            const issues = compareLegacySemantics(
              { grid: data.grid, width: data.width, height: data.height, cells: legacy },
              loaded.document,
            );
            if (issues.length > 0) {
              console.error("[Map V5] DEV equivalence mismatch", issues);
            }
          }
          if (!loaded.compatibility.compatible) {
            console.error("[Map V5] unsupported document", loaded.compatibility.reasons);
          }
        }
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

  // Автосохранение (V5): debounce/seq/thumb/dirty/retry/unload/corrupt — в хуке.
  // Битый blob / unsupported V5 (P1-7, §56–57 ТЗ 2G): показываем fallback,
  // автосейв поверх — только после явного разрешения (corrupt) или никогда
  // (unsupported — иначе первая правка молча хоронила бы исходные данные).
  const autosave = useMapAutosave({
    map,
    value: document,
    params: genParams,
    serialize: serializeMapDocument,
    save: (mapId, body) => write.put(`/maps/${mapId}`, body),
    buildThumbnail: (m, live) => (geom ? renderThumbnail(geom.grid, geom.width, geom.height, live, readChrome()) : null),
    onSaved: (savedId) => afterWrite([{ kind: "map", id: savedId, card: true }]),
    disabled: unsupported !== null,
  });

  // Д-14: индикатор несохранённого в title вкладки — тулбар не виден с другой
  // вкладки, а beforeunload без контекста («у вас правки на карте XYZ»).
  const baseTitleRef = useRef(globalThis.document.title);
  useEffect(() => {
    if (!map) return;
    const base = `Карта «${map.name}» — SoyMan`;
    globalThis.document.title =
      autosave.status.kind === "saved" ? base : `● ${base} (не сохранено)`;
    return () => {
      globalThis.document.title = baseTitleRef.current;
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
    const doc = documentRef.current;
    if (!doc) return false;
    return doc.layers.some((l) => {
      if (l.kind === "terrain") return l.representation === "cells" && l.cells.length > 0;
      if (l.kind === "path") return l.paths.length > 0;
      if (l.kind === "object") return l.items.length > 0;
      if (l.kind === "scatter") return l.areas.length > 0;
      if (l.kind === "label" || l.kind === "gameplay") return l.items.length > 0;
      return false;
    });
  }

  // Генерация затирает клетки целиком (P0-5): по непустой карте — только
  // через подтверждение. Отмена генерации шагом истории живёт лишь до
  // перезагрузки, диалог — единственная защита часов ручной росписи.
  async function generate() {
    if (!map || !geom) return;
    if (unsupported !== null) {
      setActionError("На этой карте генератор недоступен: редактор не поддерживает её функции.");
      return;
    }
    if (genTab === "dungeon") {
      await generateDungeonRun();
      return;
    }
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
    const before = documentRef.current;
    if (!before) return;
    // Legacy-алгоритм в transient MapCells → migrate → validate → setDocument.
    // MapCells не становится state/ref (§58 ТЗ 2G).
    const legacyCells = generateCells(geom.grid, geom.width, geom.height, genParams);
    const migrated = migrateLegacyMap({ grid: geom.grid, width: geom.width, height: geom.height, cells: legacyCells });
    if (validateMapDocument(migrated.document).length > 0) {
      setActionError("Генератор дал невалидный документ — карта не изменена.");
      return;
    }
    documentRef.current = migrated.document;
    setDocument(migrated.document);
    history.push(before);
  }

  async function generateDungeonRun(override?: {
    rooms: number;
    corr: 1 | 2 | "mixed";
    loops: number;
    secrets: boolean;
    traps: "none" | "some" | "many";
  }) {
    if (!map || !geom) return;
    if (geom.grid !== "square") {
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
    const before = documentRef.current;
    if (!before) return;
    const legacyCells = generateDungeon(geom.width, geom.height, {
      seed: genParams.seed,
      rooms,
      corrWidth: override?.corr ?? dunCorr,
      loops: override?.loops ?? dunLoops,
      secrets: override?.secrets ?? dunSecrets,
      traps: override?.traps ?? dunTraps,
    });
    const migrated = migrateLegacyMap({ grid: geom.grid, width: geom.width, height: geom.height, cells: legacyCells });
    if (validateMapDocument(migrated.document).length > 0) {
      setActionError("Генератор дал невалидный документ — карта не изменена.");
      return;
    }
    documentRef.current = migrated.document;
    setDocument(migrated.document);
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
    const doc = documentRef.current;
    if (!map || !doc) return;
    if (unsupported !== null) {
      setActionError("На этой карте починка недоступна: редактор не поддерживает её функции.");
      return;
    }
    const res = fixConnectivityV5(doc);
    if (!res) {
      setActionError("Починить нечего: на карте нет комнат.");
      return;
    }
    if (res.cleared.length === 0) {
      setActionError("Всё связно — чинить нечего.");
      return;
    }
    const layer = doc.layers.find((l) => l.kind === "terrain");
    if (!layer || layer.kind !== "terrain" || layer.representation !== "cells") {
      setActionError("Починка нужна клеточному террейну.");
      return;
    }
    const r = applyTerrainCellEdits(
      doc,
      layer.id,
      res.cleared.map((c) => ({ x: c.x, y: c.y, material: layer.defaultMaterial })),
    );
    if (!r.ok || !r.changed) {
      setActionError("Починить не удалось.");
      return;
    }
    documentRef.current = r.document;
    setDocument(r.document);
    history.push(doc);
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
    if (!map || !geom) return;
    const timer = setTimeout(() => {
      const doc = documentRef.current;
      if (!doc) return;
      setMiniThumb(renderThumbnail(geom.grid, geom.width, geom.height, doc, readChrome()));
    }, 800);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [document, map]);

  function jumpToMini(e: React.MouseEvent) {
    const wrap = wrapRef.current;
    if (!wrap || !geom) return;
    const box = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const wrect = wrap.getBoundingClientRect();
    const b = worldBounds(geom.grid, geom.width, geom.height);
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
  // Identity — stable EntityId; привязка к клетке — через containing-cell
  // (для migrated-карт 1:1 с legacy lookup).
  const [labelDraft, setLabelDraft] = useState<{ x: number; y: number; text: string; existed: boolean } | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  function openLabelEditor(x: number, y: number) {
    const doc = documentRef.current;
    const found = doc && geom ? findLabelAtCell(doc, geom, x, y) : undefined;
    setLabelDraft({ x, y, text: found?.text ?? "", existed: !!found });
    setLabelError(null);
  }

  function saveLabelDraft() {
    const d = labelDraft;
    const doc = documentRef.current;
    if (!d || !doc || !geom) return;
    const text = d.text.trim();
    if (!text) {
      setLabelError("Текст подписи обязателен — или удалите её.");
      return;
    }
    if (text.length > 64) {
      setLabelError("Подпись — до 64 символов.");
      return;
    }
    const layer = doc.layers.find((l) => l.kind === "label");
    if (!layer || layer.kind !== "label") {
      setLabelError("В документе нет label-слоя.");
      return;
    }
    if (layer.items.length >= 200 && !findLabelAtCell(doc, geom, d.x, d.y)) {
      setLabelError("Подписей слишком много (максимум 200).");
      return;
    }
    // Центр клетки — та же позиция, что давала миграция legacy-подписей.
    const c = cellCenter(geom.grid, d.x, d.y);
    const existing = findLabelAtCell(doc, geom, d.x, d.y);
    let next = doc;
    if (existing) {
      const r1 = updateLabelText(next, existing.id, text);
      if (!r1.ok) {
        setLabelError(r1.issues[0]?.message ?? "Не удалось сохранить подпись.");
        return;
      }
      next = r1.document;
      if (existing.position.x !== c.cx || existing.position.y !== c.cy) {
        const r2 = moveLabel(next, existing.id, { x: c.cx - existing.position.x, y: c.cy - existing.position.y });
        if (!r2.ok) {
          setLabelError(r2.issues[0]?.message ?? "Не удалось сохранить подпись.");
          return;
        }
        next = r2.document;
      }
    } else {
      const r = createLabel(next, layer.id, { id: newId(), position: { x: c.cx, y: c.cy }, text });
      if (!r.ok) {
        setLabelError(r.issues[0]?.message ?? "Не удалось сохранить подпись.");
        return;
      }
      next = r.document;
    }
    if (next !== doc) {
      documentRef.current = next;
      setDocument(next);
      history.push(doc);
    }
    setLabelDraft(null);
  }

  function deleteLabelDraft() {
    const d = labelDraft;
    const doc = documentRef.current;
    if (!d || !doc || !geom) return;
    const existing = findLabelAtCell(doc, geom, d.x, d.y);
    if (!existing) {
      setLabelDraft(null);
      return;
    }
    const r = deleteLabel(doc, existing.id);
    if (!r.ok || !r.changed) {
      setLabelDraft(null);
      return;
    }
    documentRef.current = r.document;
    setDocument(r.document);
    history.push(doc);
    setLabelDraft(null);
  }

  // Слой объектов: выбор (V5 stable EntityId). Индекс нигде не хранится;
  // любая замена документа выбор сбрасывает (панели и drag живут на рефах).
  const selection = useMapSelection({
    document,
    documentRef,
    setDocument,
    commitDocument,
  });
  const { selected } = selection;

  // Хит-тест и перемещение/удаление — в useMapSelection (та же геометрия
  // и приоритеты: door → trap → marker → start/finish → room).

  // Панели объектов (клик-панель, не ПКМ). Identity — EntityId (§39 ТЗ 2G);
  // roomDraft.id null = создание (rect из roomRectRef), иначе правка.
  const [doorDraft, setDoorDraft] = useState<{ id: string; kind: MapDoorKind; secret: boolean } | null>(null);
  const [trapDraft, setTrapDraft] = useState<{ id: string; kind: MapTrapKind } | null>(null);
  const [markerDraft, setMarkerDraft] = useState<{ id: string; kind: MapMarkerKind } | null>(null);
  const [roomDraft, setRoomDraft] = useState<{ id: string | null; type: MapRoomType; name: string } | null>(null);
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

  function openObjPanel(sel: NonNullable<V5Selection>) {
    const doc = documentRef.current;
    setObjError(null);
    if (!doc) return;
    const e = findGameplayEntity(doc, sel.entityId);
    if (!e || e.kind !== sel.kind) return;
    if (e.kind === "door") {
      setDoorDraft({ id: e.id, kind: e.doorKind, secret: e.secret });
    } else if (e.kind === "trap") {
      setTrapDraft({ id: e.id, kind: e.trapKind });
    } else if (e.kind === "marker") {
      setMarkerDraft({ id: e.id, kind: e.markerKind });
    } else if (e.kind === "room") {
      setRoomDraft({ id: e.id, type: e.roomType, name: e.name });
    } else if (e.kind === "start" || e.kind === "finish") {
      setSfDraft({ kind: e.kind });
    }
  }

  function commitDocument(next: MapDocumentV5, before: MapDocumentV5) {
    documentRef.current = next;
    setDocument(next);
    history.push(before);
  }

  function actionFailed(message: string): void {
    setObjError(message);
  }

  function saveDoorDraft() {
    const d = doorDraft;
    const doc = documentRef.current;
    if (!d || !doc) return;
    const target = findGameplayEntity(doc, d.id);
    if (!target || target.kind !== "door") return;
    // Вид правится у двери и её пары (legacy правил вид всей pair-группе;
    // V5-пары бинарны — exotic-группы уже warnings миграции).
    const ids = [d.id];
    if (target.pairedDoorId) ids.push(target.pairedDoorId);
    let next = doc;
    for (const id of ids) {
      const r = updateGameplayEntity(next, id, (e) => {
        if (e.kind !== "door") return e;
        return { ...e, doorKind: d.kind, secret: d.secret };
      });
      if (!r.ok) {
        actionFailed(r.issues[0]?.message ?? "Не удалось сохранить дверь.");
        return;
      }
      next = r.document;
    }
    if (next !== doc) commitDocument(next, doc);
    setDoorDraft(null);
    selection.clearSelection();
  }

  function deleteDoor() {
    const d = doorDraft;
    const doc = documentRef.current;
    if (!d || !doc) return;
    // Удаление двери чистит пару внутри Mutation Core (§45 ТЗ 2G).
    const r = deleteGameplayEntity(doc, d.id);
    if (!r.ok) {
      actionFailed(r.issues[0]?.message ?? "Не удалось удалить дверь.");
      return;
    }
    if (r.changed) commitDocument(r.document, doc);
    setDoorDraft(null);
    selection.clearSelection();
  }

  function saveTrapDraft() {
    const t = trapDraft;
    const doc = documentRef.current;
    if (!t || !doc) return;
    const r = updateGameplayEntity(doc, t.id, (e) => {
      if (e.kind !== "trap") return e;
      return { ...e, trapKind: t.kind };
    });
    if (!r.ok) {
      actionFailed(r.issues[0]?.message ?? "Не удалось сохранить ловушку.");
      return;
    }
    if (r.changed) commitDocument(r.document, doc);
    setTrapDraft(null);
    selection.clearSelection();
  }

  function deleteTrap() {
    const t = trapDraft;
    const doc = documentRef.current;
    if (!t || !doc) return;
    const r = deleteGameplayEntity(doc, t.id);
    if (!r.ok) {
      actionFailed(r.issues[0]?.message ?? "Не удалось удалить ловушку.");
      return;
    }
    if (r.changed) commitDocument(r.document, doc);
    setTrapDraft(null);
    selection.clearSelection();
  }

  function saveMarkerDraft() {
    const m = markerDraft;
    const doc = documentRef.current;
    if (!m || !doc) return;
    const r = updateGameplayEntity(doc, m.id, (e) => {
      if (e.kind !== "marker") return e;
      return { ...e, markerKind: m.kind };
    });
    if (!r.ok) {
      actionFailed(r.issues[0]?.message ?? "Не удалось сохранить маркер.");
      return;
    }
    if (r.changed) commitDocument(r.document, doc);
    setMarkerDraft(null);
    selection.clearSelection();
  }

  function deleteMarker() {
    const m = markerDraft;
    const doc = documentRef.current;
    if (!m || !doc) return;
    const r = deleteGameplayEntity(doc, m.id);
    if (!r.ok) {
      actionFailed(r.issues[0]?.message ?? "Не удалось удалить маркер.");
      return;
    }
    if (r.changed) commitDocument(r.document, doc);
    setMarkerDraft(null);
    selection.clearSelection();
  }

  function saveRoomDraft() {
    const r = roomDraft;
    const doc = documentRef.current;
    if (!r || !doc) return;
    const layerId = gameplayLayerId(doc);
    if (!layerId) {
      setObjError("В документе нет gameplay-слоя.");
      return;
    }
    const gameplay = doc.layers.find((l) => l.id === layerId);
    const rooms = gameplay && gameplay.kind === "gameplay" ? gameplay.items.filter((e) => e.kind === "room") : [];
    if (r.id === null) {
      const rect = input.roomRectRef.current;
      if (!rect) return;
      if (rooms.length >= 100) {
        setObjError("Комнат слишком много (максимум 100).");
        return;
      }
      const res = createGameplayEntity(doc, layerId, {
        id: newId(),
        kind: "room",
        geometry: { type: "rect", x: rect.x, y: rect.y, w: rect.w, h: rect.h },
        roomType: r.type,
        name: r.name.trim().slice(0, 64),
      });
      if (!res.ok) {
        setObjError(res.issues[0]?.message ?? "Не удалось создать комнату.");
        return;
      }
      commitDocument(res.document, doc);
    } else {
      const res = updateGameplayEntity(doc, r.id, (e) => {
        if (e.kind !== "room") return e;
        return { ...e, roomType: r.type, name: r.name.trim().slice(0, 64) };
      });
      if (!res.ok) {
        setObjError(res.issues[0]?.message ?? "Не удалось сохранить комнату.");
        return;
      }
      if (res.changed) commitDocument(res.document, doc);
    }
    setRoomDraft(null);
    input.roomRectRef.current = null;
    setRectPreview(null);
    selection.clearSelection();
  }

  function deleteRoom() {
    const r = roomDraft;
    const doc = documentRef.current;
    if (!r || r.id === null || !doc) return;
    const res = deleteGameplayEntity(doc, r.id);
    if (!res.ok) {
      setObjError(res.issues[0]?.message ?? "Не удалось удалить комнату.");
      return;
    }
    if (res.changed) commitDocument(res.document, doc);
    setRoomDraft(null);
    selection.clearSelection();
  }

  function saveCreateDraft() {
    const c = createDraft;
    const doc = documentRef.current;
    if (!c || !doc || !geom) return;
    if (c.choice === "door" && geom.grid !== "square") {
      setObjError("Двери — только на квадратах: на гексах рёберной модели нет.");
      return;
    }
    const layerId = gameplayLayerId(doc);
    if (!layerId) {
      setObjError("В документе нет gameplay-слоя.");
      return;
    }
    const gameplay = doc.layers.find((l) => l.id === layerId);
    const items = gameplay && gameplay.kind === "gameplay" ? gameplay.items : [];
    const center = cellCenter(geom.grid, c.x, c.y);
    if (c.choice === "door") {
      if (items.filter((e) => e.kind === "door").length >= 400) {
        setObjError("Дверей слишком много (максимум 400).");
        return;
      }
      const pos = legacyDoorWorldPosition(geom.grid, c.x, c.y, c.edge);
      if (
        items.some(
          (e) => e.kind === "door" && e.position.x === pos.x && e.position.y === pos.y,
        )
      ) {
        setObjError("Здесь уже есть дверь.");
        return;
      }
      const res = createGameplayEntity(doc, layerId, {
        id: newId(),
        kind: "door",
        position: pos,
        orientation: legacyEdgeOrientation(c.edge),
        doorKind: "door",
        secret: false,
        pairedDoorId: null,
      });
      if (!res.ok) {
        setObjError(res.issues[0]?.message ?? "Не удалось поставить дверь.");
        return;
      }
      commitDocument(res.document, doc);
    } else if (c.choice === "trap") {
      if (items.filter((e) => e.kind === "trap").length >= 300) {
        setObjError("Ловушек слишком много (максимум 300).");
        return;
      }
      const res = createGameplayEntity(doc, layerId, {
        id: newId(),
        kind: "trap",
        position: { x: center.cx, y: center.cy },
        trapKind: "pit",
      });
      if (!res.ok) {
        setObjError(res.issues[0]?.message ?? "Не удалось поставить ловушку.");
        return;
      }
      commitDocument(res.document, doc);
    } else if (c.choice === "start") {
      const res = setStart(doc, layerId, { id: newId(), position: { x: center.cx, y: center.cy } });
      if (!res.ok) {
        setObjError(res.issues[0]?.message ?? "Не удалось поставить старт.");
        return;
      }
      if (res.changed) commitDocument(res.document, doc);
    } else {
      const res = setFinish(doc, layerId, { id: newId(), position: { x: center.cx, y: center.cy } });
      if (!res.ok) {
        setObjError(res.issues[0]?.message ?? "Не удалось поставить финиш.");
        return;
      }
      if (res.changed) commitDocument(res.document, doc);
    }
    setCreateDraft(null);
    selection.clearSelection();
  }

  function deleteSf() {
    const s = sfDraft;
    const doc = documentRef.current;
    if (!s || !doc) return;
    const target = doc.layers.flatMap((l) =>
      l.kind === "gameplay" ? l.items.filter((e) => e.kind === s.kind) : [],
    )[0];
    if (!target) {
      setSfDraft(null);
      return;
    }
    const r = deleteGameplayEntity(doc, target.id);
    if (!r.ok) {
      setObjError(r.issues[0]?.message ?? "Не удалось удалить.");
      return;
    }
    if (r.changed) commitDocument(r.document, doc);
    setSfDraft(null);
    selection.clearSelection();
  }

  // Удаление и перемещение — в useMapSelection (та же геометрия и pair-правила).

  // Уход с выбора закрывает панели объектов (черновики привязаны к EntityId,
  // после чужих правок сущность может исчезнуть — openObjPanel это проверяет).
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

  // Обмен JSON: выгрузка — soyman-map/2 (§69 ТЗ 2G), загрузка — V1 (миграция)
  // или V2 (parse + compatibility). FileReader, состояние и шаг истории здесь.
  function exportJson() {
    if (!map || !geom) return;
    const doc = documentRef.current;
    if (!doc) return;
    const data = buildSoyMapV2(
      { name: map.name, scale: map.scale, cellLore: map.cell_lore },
      doc,
    );
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = globalThis.document.createElement("a");
    a.href = url;
    a.download = `map-${sanitizeDownloadName(map.name)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  }

  function importJson(file: File) {
    if (!map || !geom) return;
    const before = documentRef.current;
    if (!before) return;
    setXferMsg(null);
    const reader = new FileReader();
    reader.onload = () => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(String(reader.result));
      } catch {
        setXferMsg("Не похоже на выгрузку карты (ждём soyman-map/1 или soyman-map/2).");
        return;
      }
      const format = (parsed as { format?: unknown }).format;
      if (format === "soyman-map/2") {
        const res = parseSoyMapV2(parsed);
        if (!res.ok) {
          setXferMsg(`V2 не принят: ${res.errors[0]?.message ?? "invalid document"}`);
          return;
        }
        const compat = assessCurrentEditorCompatibility(res.value.document);
        if (!compat.compatible) {
          setXferMsg(`V2 использует функции вне текущего редактора (${compat.reasons[0]?.code ?? "unknown"}) — импорт отклонён без изменений.`);
          return;
        }
        documentRef.current = res.value.document;
        setDocument(res.value.document);
        setGenParams((p) => ({ ...p }));
        history.push(before);
        setXferMsg("Загружено из soyman-map/2. Шаг — в историю.");
        return;
      }
      // V1: существующая проверка размера/сетки + миграция в V5.
      const target = { grid: geom.grid, width: geom.width, height: geom.height };
      const fallbackGen = genParams;
      const res = validateMapImport(parsed, target, fallbackGen);
      if (!res.ok) {
        setXferMsg(res.error);
        return;
      }
      const migrated = migrateLegacyMap({ grid: geom.grid, width: geom.width, height: geom.height, cells: res.cells });
      if (validateMapDocument(migrated.document).length > 0) {
        setXferMsg("Импорт дал невалидный документ — карта не изменена.");
        return;
      }
      documentRef.current = migrated.document;
      setDocument(migrated.document);
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
    setSWidth(geom?.width ?? map.width);
    setSHeight(geom?.height ?? map.height);
    setSettingsError(null);
    setActionError(null);
    setSettingsOpen(true);
  }

  async function saveSettings() {
    if (!map) return;
    const doc = documentRef.current;
    if (!doc) return;
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
    // Ужимка поля режет всё снаружи pure resizeGridDocument (те же правила,
    // что legacy-кроп P0-C: комната торчит — целиком). Шаг в историю.
    // Unsupported: ресайз запрещён (нельзя перезаписать такой документ),
    // мета-настройки — можно.
    const grid = doc.grid;
    const resizing = grid && (w !== grid.columns || h !== grid.rows);
    if (unsupported !== null && resizing) {
      setSettingsError("Размер этой карты менять нельзя: редактор не поддерживает её функции.");
      return;
    }
    let next = doc;
    if (resizing) {
      const r = resizeGridDocument(doc, w, h);
      if (!r.ok) {
        setSettingsError(r.issues[0]?.message ?? "Не удалось изменить размер.");
        return;
      }
      next = r.document;
    }
    setSettingsError(null);
    try {
      const updated = await write.put<MapFull>(`/maps/${map.id}`, {
        name,
        scale: sScale,
        cell_lore: sLore,
        width: w,
        height: h,
        // После switch контент всегда едет документом (§54 ТЗ 2G).
        ...(resizing ? { document: JSON.parse(serializeMapDocument(next)) } : {}),
      });
      if (resizing && next !== doc) {
        documentRef.current = next;
        setDocument(next);
        history.push(doc);
      }
      afterWrite([{ kind: "map", id: map.id, card: true }]);
      setMap(updated);
      setSettingsOpen(false);
      setActionError(null);
      if (geom && (w !== geom.width || h !== geom.height)) fitCamera(true);
    } catch (e) {
      setSettingsError(translateMapError(e));
    }
  }

  async function duplicateMap() {
    if (!map) return;
    const doc = documentRef.current;
    if (!doc) return;
    setActionError(null);
    try {
      const thumb = geom ? renderThumbnail(geom.grid, geom.width, geom.height, doc, readChrome()) : null;
      // V5 create: размеры/сетка выводятся из документа (§18 ТЗ 2F).
      const created = await write.post<{ id: number }>("/maps", {
        name: `${map.name} (копия)`.slice(0, 200),
        scale: map.scale,
        cell_lore: map.cell_lore,
        seed: map.seed,
        sea: map.sea,
        mountains: map.mountains,
        forest: map.forest,
        document: JSON.parse(serializeMapDocument(doc)),
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
    if (!map || pngBusy || !geom) return;
    const doc = documentRef.current;
    if (!doc) return;
    setPngBusy(true);
    const snapshot = {
      grid: geom.grid,
      width: geom.width,
      height: geom.height,
      name: map.name,
      scale: map.scale,
      cell_lore: map.cell_lore,
      document: doc,
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
    canEdit: canEdit && unsupported === null,
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
    if (!map || !geom) return;
    if (geom.grid !== "square") {
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

  // Инструменты (V5 Mutation Core через Tool Controller): доменная логика —
  // в tools/*, композиция — в useMapTools.
  const tools = useMapTools({
    geom,
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
    documentRef,
    setDocument,
    push: history.push,
    commitDocument,
    newId,
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
      setRoomDraft({ id: null, type: "empty", name: "" });
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
      setRoomDraft({ id: null, type: "empty", name: "" });
      setObjError(null);
    },
    cancelObjectDrag: (before) => {
      documentRef.current = before;
      setDocument(before);
    },
  });

  // Ввод (pointer/touch state machine — в хуке; tools приходят фасадом выше.
  const input = useMapInput({
    canvasRef,
    documentRef,
    camera: { setCam, camRef, toWorld, touchToWorld },
    history,
    selection,
    geom,
    tool,
    canEdit: canEdit && unsupported === null,
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
    const doc = documentRef.current;
    if (!doc) return;
    if (unsupported !== null) {
      setActionError("На этой карте очистка недоступна: редактор не поддерживает её функции.");
      return;
    }
    const ok = await confirm({
      title: "Очистить карту?",
      message: "Все клетки станут равниной, дороги, реки, подписи, маркеры и объекты исчезнут. Шаг попадёт в историю — его можно отменить.",
      confirmLabel: "Очистить",
      cancelLabel: "Отмена",
      danger: true,
    });
    if (!ok) return;
    const r = clearEditableContent(doc);
    if (!r.ok) {
      setActionError(r.issues[0]?.message ?? "Не удалось очистить карту.");
      return;
    }
    if (!r.changed) return;
    documentRef.current = r.document;
    setDocument(r.document);
    history.push(doc);
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
                {autosave.status.kind === "error" && unsupported === null && (
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
                    {model && model.doors.length > 0 &&
                      MAP_DOOR_KINDS.filter((k) =>
                        model.doors.some((d) => !doorForView(d, !canEdit || previewAsPlayer).hidden && doorForView(d, !canEdit || previewAsPlayer).kind === k)
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
                      model?.traps.some((t) => t.kind === k) ?? false
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
                    {MAP_ROOM_TYPES.filter((t) => model?.rooms.some((r) => r.type === t) ?? false).map((t) => (
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
                    {model?.start && (
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
                    {(model?.rivers.size ?? 0) > 0 && (
                      <span className="row" style={{ gap: 6 }} title="Река — поверх террейна, под дорогами">
                        <span
                          aria-hidden="true"
                          style={{ display: "inline-block", width: 18, height: 5, background: MAP_RIVER_FILL }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_RIVER_LABEL}</span>
                      </span>
                    )}
                    {MAP_MARKER_KINDS.filter((k) => model?.markers.some((m) => m.kind === k) ?? false).map((k) => (
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
                    {model?.finish && (
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
                  {map && geom && (() => {
                    // D5: честный размер файла и бумаги до скачивания (А4 — 21×29,7 см).
                    const bb = worldBounds(geom.grid, geom.width, geom.height);
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
                      {geom && (sWidth < geom.width || sHeight < geom.height)
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
                        <button type="button" onClick={deleteLabelDraft}>
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
                  <h2>{roomDraft.id === null ? "Новая комната" : "Комната"}</h2>
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
                      {roomDraft.id !== null && (
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
                Данные карты повреждены — показана пустая карта. Автосохранение остановлено, чтобы первая правка
                их не затёрла.
              </span>
              <button type="button" onClick={autosave.allowOverwrite}>
                Понял, разрешаю перезапись
              </button>
            </div>
          )}
          {unsupported !== null && (
            <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span>{unsupported}</span>
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
              model={model}
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
                selectedId: selected?.entityId ?? null,
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
                  if (!geom) return null;
                  const b = worldBounds(geom.grid, geom.width, geom.height);
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
