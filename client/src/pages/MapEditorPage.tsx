import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { subscribeMapImageAssets } from "../maps/assets/registry";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { readOnce } from "../data/imperative";
import { downloadStoredMapOriginal, downloadMapJson } from "../maps/workspace/mapApi";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { Breadcrumbs } from "../components/Breadcrumbs";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { coordLabel, pixelToCell, cellCenter, worldBounds } from "../maps/grid";
import { buildAndDownloadPng, collectLegendContent } from "../maps/mapExport";
import { sanitizeDownloadName, validateMapImport } from "../maps/mapExchange";
import { generateCells, type GeneratorParams } from "../maps/generate";
import { generateDungeon } from "../maps/dungeon";
import {
  MAP_BIOME_TERRAINS,
  MAP_FLOOR_TERRAINS,
  MAP_TERRAIN_FILL,
  MAP_TERRAIN_LABELS,
  MAP_TERRAIN_ORDER,
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
import {
  MAP_SYMBOL_ASSETS, loadMapImageAsset, prepareMapImageAssets,
  registerMapImageResources, resourceImageAssetId, resolveMapSymbol,
  type MapImageResource,
} from "../maps/assets/registry";
import type { MapDocumentV5, SplineNode } from "../maps/core/types";
import { loadStoredEditorDocument, type LoadedEditorDocument } from "../maps/editor/loadDocument";
import { compareLegacySemantics } from "../maps/core/semanticEquivalence";
import { parseCellsBlob } from "../maps/render";
import { parseSoyMapV2, buildSoyMapV2, checkSoyMapV2ImportTarget } from "../maps/core/exchangeV2";
import { projectMapDocumentForPlayer } from "../maps/core/playerProjection";
import { assessCurrentEditorCompatibility } from "../maps/core/compatibility";
import { migrateLegacyMap, legacyDoorWorldPosition, legacyEdgeOrientation } from "../maps/core/migrateLegacy";
import { validateMapDocument } from "../maps/core/validate";
import { createUuidIdFactory } from "../maps/editor/idFactory";
import { fixConnectivityV5 } from "../maps/editor/fixConnectivityV5";
import { createTerrainLayer, createTerrainMaskLayer, findEntityLayer, moveLayer } from "../maps/core/mutations/layers";
import { transformMapObject } from "../maps/core/mutations/mapObjects";
import {
  NO_COMPATIBLE_LAYER_ERROR,
  ensurePathTargetLayer,
  resolveToolTargetLayer,
  toolLayerKind,
} from "../maps/editor/tools/layerTargets";
import {
  createGameplayEntity,
  deleteGameplayEntity,
  setFinish,
  setStart,
  updateGameplayEntity,
} from "../maps/core/mutations/gameplay";
import { applyTerrainCellEdits } from "../maps/core/mutations/terrain";
import { createSplinePath, deletePath as deleteMapPath, updateSplinePath } from "../maps/core/mutations/paths";
import { branchSplineNodes, extendSplineNodes, freePathHandleIndices,
  insertSplineNodeAt, setSplineNodeLinear, type FreePathJoin } from "../maps/editor/freePathEditing";
import { splineFromAnchors } from "../maps/core/spline";
import { createLabel, deleteLabel, moveLabel, updateLabelText } from "../maps/core/mutations/labels";
import { clearEditableContent, resizeGridDocument } from "../maps/core/mutations/document";
import { paintExplorationCell, setAllExplorationCells, setExplorationEnabled } from "../maps/core/mutations/exploration";
import type { GameplayEntity, LayerId } from "../maps/core/types";
import { useMapCamera } from "../maps/editor/hooks/useMapCamera";
import { useMapHistory } from "../maps/editor/hooks/useMapHistory";
import { useMapHotkeys } from "../maps/editor/hooks/useMapHotkeys";
import { useMapAutosave } from "../maps/editor/hooks/useMapAutosave";
import { useMapInput } from "../maps/editor/hooks/useMapInput";
import { useMapSelection, type MapGeometry, type V5Selection } from "../maps/editor/hooks/useMapSelection";
import { useMapTools } from "../maps/editor/hooks/useMapTools";
import { MapViewport } from "../maps/editor/components/MapViewport";
import { LayerPanel } from "../maps/editor/components/LayerPanel";
import type { BrushSize, PaintTool } from "../maps/editor/editorTypes";
import {
  COMMON_TOOLS,
  DEFAULT_MODE_TOOL,
  MODE_TOOLS,
  TOOL_DESCRIPTIONS,
  extraToolsForMode,
  toolUnavailableReason,
  type EditorMode,
} from "../maps/editor/toolModes";
import "./map-editor-layout.css";
import { MapWorkspaceTools } from "../maps/workspace/MapWorkspace";
import { useMapWorkspace } from "../maps/workspace/workspaceContext";
import { NavIcon } from "../components/NavIcons";
import { MapToolIcon } from "../maps/workspace/MapToolIcon";

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

// Подпись, чья containing-cell совпадает — строго внутри target label-слоя
// (3A §42: та же позиция в другом слое — другая entity).
function findLabelAtCell(
  doc: MapDocumentV5,
  geom: MapGeometry,
  layerId: string,
  x: number,
  y: number,
) {
  const layer = doc.layers.find((l) => l.id === layerId);
  if (!layer || layer.kind !== "label") return undefined;
  for (const l of layer.items) {
    const c = pixelToCell(geom.grid, l.position.x, l.position.y, geom.width, geom.height);
    if (c && c.x === x && c.y === y) return l;
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

// Owning layer сущности редактируем для модалки прямо сейчас (§91)?
// Stale modal (слой удалён/скрыт/заблокирован после открытия) сохранять нельзя.
function editableOwningLayer(
  doc: MapDocumentV5,
  entityId: string,
): { layerId: string } | { error: string } {
  const own = findEntityLayer(doc, entityId);
  if (!own) return { error: "Объект уже удалён." };
  const layer = doc.layers[own.layerIndex];
  if (!layer || layer.id !== own.layerId) return { error: "Объект уже удалён." };
  if (!layer.visible) return { error: "Слой скрыт — сначала покажите его." };
  if (layer.locked) return { error: "Слой заблокирован — сначала разблокируйте его." };
  return { layerId: layer.id };
}

// Текст баннера unsupported-карты (§8 ТЗ 2G): без потери данных.
function describeUnsupported(loaded: LoadedEditorDocument): string {
  return loaded.status === "unsupported"
    ? "Карту пока нельзя прочитать в этом редакторе. Исходные данные сохранены; вы можете скачать их без изменений."
    : "Карта использует возможности, которые редактор пока не поддерживает. Редактирование отключено, чтобы сохранить все данные.";
}

export function MapEditorPage() {
  const workspace = useMapWorkspace();
  const inWorkspace = workspace !== null;
  const [toolSettingsOpen, setToolSettingsOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  useEffect(() => {
    if (!inWorkspace || (!toolSettingsOpen && !inspectorOpen)) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const panel = globalThis.document.querySelector<HTMLElement>(".map-editor-workspace-drawer:not([hidden])");
      if (panel?.contains(globalThis.document.activeElement)) {
        globalThis.document.querySelector<HTMLButtonElement>(inspectorOpen ? "[data-map-inspector-toggle]" : "[data-map-settings-toggle]")?.focus();
      }
      setToolSettingsOpen(false);
      setInspectorOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [inWorkspace, toolSettingsOpen, inspectorOpen]);
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const afterWrite = useAfterWrite();
  const { user } = useCurrentUser();
  const canEdit = user?.role !== "player";

  const [map, setMap] = useState<MapFull | null>(null);
  // Фаза 2G: единственный mutable editor state — MapDocumentV5 (иммутабельный;
  // мутации только через Mutation Core, целые замены — load/undo/import/generator).
  const [document, setDocument] = useState<MapDocumentV5 | null>(null);
  const [imageResources, setImageResources] = useState<MapImageResource[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const [imageRevision, setImageRevision] = useState(0);
  useEffect(() => subscribeMapImageAssets(() => setImageRevision((revision) => revision + 1)), []);
  // Фаза 3A: activeLayerId — editor-only state (§27), НЕ входит в документ.
  // Разделён с selected entityId (§29): слой — куда пишут инструменты,
  // entity — что выбрано hit-test'ом.
  const [activeLayerId, setActiveLayerId] = useState<LayerId | null>(null);
  const activeLayerRef = useRef<LayerId | null>(null);
  activeLayerRef.current = activeLayerId;
  const preferredTerrainLayerRef = useRef<LayerId | null>(null);
  const activeMapRef = useRef<string | undefined>(undefined);
  const previousLayerToolRef = useRef<PaintTool | null>(null);
  const previousLayerShapeRef = useRef<string | null>(null);
  // Совместимость загруженного документа с текущим редактором (§4–8 ТЗ 2G).
  const [unsupported, setUnsupported] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(() => loadFlag("maps.showGrid", true));
  const [showCoords, setShowCoords] = useState(() => loadFlag("maps.showCoords", false));
  const [previewAsPlayer, setPreviewAsPlayer] = useState(false);
  const canEditInView = canEdit && !previewAsPlayer && unsupported === null;
  const [fogAction, setFogAction] = useState<"reveal" | "hide">("reveal");
  const [topMenu, setTopMenu] = useState<"map" | "mode" | "view" | "tools" | null>(null);
  const menuBarRef = useRef<HTMLDivElement>(null);
  const [sidePanelsHidden, setSidePanelsHidden] = useState(() =>
    globalThis.document.body.classList.contains("live-hide-dock") &&
    globalThis.document.body.classList.contains("live-hide-search"),
  );

  useEffect(() => {
    const sync = () => setSidePanelsHidden(
      globalThis.document.body.classList.contains("live-hide-dock") &&
      globalThis.document.body.classList.contains("live-hide-search"),
    );
    const observer = new MutationObserver(sync);
    observer.observe(globalThis.document.body, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!topMenu) return;
    const closeOutside = (event: PointerEvent) => {
      if (!menuBarRef.current?.contains(event.target as Node)) setTopMenu(null);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        setTopMenu(null);
      }
    };
    globalThis.document.addEventListener("pointerdown", closeOutside);
    globalThis.document.addEventListener("keydown", closeOnEscape);
    return () => {
      globalThis.document.removeEventListener("pointerdown", closeOutside);
      globalThis.document.removeEventListener("keydown", closeOnEscape);
    };
  }, [topMenu]);

  function toggleSidePanels(hidden: boolean) {
    globalThis.document.body.classList.toggle("live-hide-dock", hidden);
    globalThis.document.body.classList.toggle("live-hide-search", hidden);
    setSidePanelsHidden(hidden);
  }

  // Инструменты (тикет 04). Пипетка и заливка — одноразовые действия,
  // кисть/дорога/ластик — мазки от нажатия до отпускания.
  const [editorMode, setEditorMode] = useState<EditorMode>(() => {
    try {
      const mode = localStorage.getItem("maps.editorMode");
      if (mode === "region" || mode === "local" || mode === "dungeon") return mode;
      const legacyPanel = localStorage.getItem("maps.panel");
      return legacyPanel === "surface" ? "local" : legacyPanel === "objects" ? "dungeon" : "region";
    } catch {
      return "region";
    }
  });
  const [activePanel, setActivePanelState] = useState<"biomes" | "surface">(() => {
    try {
      const v = localStorage.getItem("maps.panel");
      return v === "surface" || v === "biomes" ? v : editorMode === "region" ? "biomes" : "surface";
    } catch {
      return editorMode === "region" ? "biomes" : "surface";
    }
  });
  const [tool, setTool] = useState<PaintTool>(() => DEFAULT_MODE_TOOL[editorMode]);
  const modeToolRef = useRef<Record<EditorMode, PaintTool>>({ ...DEFAULT_MODE_TOOL });
  const [extraToolsOpen, setExtraToolsOpen] = useState(false);
  const paletteTerrainRef = useRef({ biomes: "forest", surface: "stone" });
  const [terrain, setTerrain] = useState<string>(() => paletteTerrainRef.current[activePanel]);
  const [brushSize, setBrushSize] = useState<BrushSize>(1);
  const [freePathMode, setFreePathMode] = useState(false);
  const [freePathEditMode, setFreePathEditMode] = useState(false);
  const [selectedFreePathId, setSelectedFreePathId] = useState<string | null>(null);
  const [selectedSplineNodeIndex, setSelectedSplineNodeIndex] = useState<number>(0);
  const [freePathJoinCandidate, setFreePathJoinCandidate] = useState<(FreePathJoin & { pathId: string }) | null>(null);
  const [freePathWidthDraft, setFreePathWidthDraft] = useState<number | null>(null);
  const freePathWidthDraftRef = useRef<number | null>(null);
  const [freePathShapeDraft, setFreePathShapeDraft] = useState<{ pathId: string; nodes: SplineNode[] } | null>(null);
  const [freePathPreview, setFreePathPreview] = useState<{ kind: "road" | "river";
    anchors: { x: number; y: number }[]; hover: { x: number; y: number } | null } | null>(null);
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
  const [shapeContent, setShapeContent] = useState<"room" | "terrain" | "road" | "river" | "wall" | "eraser">("room");

  const documentRef = useRef<MapDocumentV5 | null>(null);
  documentRef.current = document;
  // Актуальное shapeContent для shapeKind() выше (state объявлен ниже).
  const shapeContentRef = useRef<"room" | "terrain" | "road" | "river" | "wall" | "eraser">("room");

  // Editor geometry — производная от document.grid/world (§19–20 ТЗ 2G),
  // не отдельный mutable state. Server columns — persistence mirror.
  const geom: MapGeometry | null = useMemo(() => {
    if (!document?.grid) return null;
    return { grid: document.grid.type, width: document.grid.columns, height: document.grid.rows };
  }, [document]);

  const selectedFreePath = document?.layers.flatMap((layer) => layer.kind === "path" && layer.visible && !layer.locked
    ? layer.paths : []).find((path) => path.id === selectedFreePathId && path.kind === tool &&
      path.geometry.type === "spline") ?? null;
  const selectedSplineNode = selectedFreePath?.geometry.type === "spline"
    ? selectedFreePath.geometry.nodes[selectedSplineNodeIndex] ?? null : null;

  const previewDocument = useMemo(() => {
    if (!document || (!freePathShapeDraft && freePathWidthDraft === null)) return document;
    let preview = document;
    if (freePathShapeDraft) {
      const changed = updateSplinePath(preview, freePathShapeDraft.pathId,
        { nodes: freePathShapeDraft.nodes });
      if (changed.ok) preview = changed.document;
    }
    if (freePathWidthDraft !== null && selectedFreePathId) {
      const path = preview.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
        .find((item) => item.id === selectedFreePathId);
      if (path?.geometry.type === "spline") {
        const nodes = path.geometry.nodes.map((node, index) => index === selectedSplineNodeIndex
          ? { ...node, width: freePathWidthDraft } : node);
        const changed = updateSplinePath(preview, selectedFreePathId, { nodes });
        if (changed.ok) preview = changed.document;
      }
    }
    return preview;
  }, [document, freePathShapeDraft, freePathWidthDraft, selectedFreePathId, selectedSplineNodeIndex]);

  // Render model из документа (§47 ТЗ 2G). Неожиданные diagnostics в DEV —
  // ошибка разработки: Tool создал feature вне renderer-подмножества (§48).
  const model = useMemo(() => {
    if (!previewDocument) return null;
    const r = createV5RenderModel(previewDocument);
    if (import.meta.env.DEV && r.diagnostics.length > 0) {
      console.error("[Map V5] unexpected render diagnostics", r.diagnostics);
    }
    return r.model;
  }, [previewDocument]);

  // Превью мастера использует ту же проекцию документа, что сервер отдаёт игроку.
  const displayModel = useMemo(() => {
    if (!document || !canEdit || !previewAsPlayer) return model;
    return createV5RenderModel(projectMapDocumentForPlayer(document)).model;
  }, [document, model, canEdit, previewAsPlayer]);

  // Экранная легенда — из видимых слоёв модели (3A §109), как PNG-легенда.
  const legend = useMemo(() => (displayModel ? collectLegendContent(displayModel) : null), [displayModel]);

  const newId = useMemo(() => createUuidIdFactory(), []);

  function selectFreePath(pathId: string | null, nodeIndex?: number | null, join?: FreePathJoin) {
    if (join) setSelectedSplineNodeIndex(-1);
    else if (pathId !== selectedFreePathId || pathId === null || selectedSplineNodeIndex < 0)
      setSelectedSplineNodeIndex(nodeIndex ?? 0);
    else if (nodeIndex !== undefined && nodeIndex !== null) setSelectedSplineNodeIndex(nodeIndex);
    setSelectedFreePathId(pathId);
    setFreePathJoinCandidate(pathId && join ? { pathId, ...join } : null);
    setFreePathShapeDraft(null);
    freePathWidthDraftRef.current = null;
    setFreePathWidthDraft(null);
  }

  function commitFreePathWidth() {
    const width = freePathWidthDraftRef.current;
    freePathWidthDraftRef.current = null;
    setFreePathWidthDraft(null);
    const doc = documentRef.current;
    if (width === null || !doc || !selectedFreePathId || !canEditInView || unsupported !== null) return;
    const path = doc.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .find((item) => item.id === selectedFreePathId);
    if (path?.geometry.type !== "spline" || !path.geometry.nodes[selectedSplineNodeIndex]) return;
    const nodes = path.geometry.nodes.map((node, index) => index === selectedSplineNodeIndex
      ? { ...node, width } : node);
    const result = updateSplinePath(doc, selectedFreePathId, { nodes });
    if (result.ok && result.changed) commitDocument(result.document, doc);
  }

  function changeSelectedSplineNodeLinear(linear: boolean) {
    const doc = documentRef.current;
    if (!doc || !selectedFreePathId || !canEditInView || unsupported !== null) return;
    const path = doc.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .find((item) => item.id === selectedFreePathId);
    if (path?.geometry.type !== "spline" || !path.geometry.nodes[selectedSplineNodeIndex]) return;
    const nodes = setSplineNodeLinear(path.geometry.nodes, selectedSplineNodeIndex, linear);
    const result = updateSplinePath(doc, selectedFreePathId, { nodes });
    if (result.ok && result.changed) commitDocument(result.document, doc);
  }

  function setActiveLayer(id: LayerId) {
    activeLayerRef.current = id;
    setActiveLayerId(id);
  }

  function selectLayerInPanel(id: LayerId) {
    if (documentRef.current?.layers.some((layer) => layer.id === id && layer.kind === "terrain")) {
      preferredTerrainLayerRef.current = id;
    }
    setActiveLayer(id);
  }

  // Shape-инструмент — контейнер: target kind задаёт содержимое (§33).
  function shapeKind(): "terrain" | "path" | "gameplay" | null {
    // shapeContent объявлен ниже, но к моменту выполнения эффекта инициализирован.
    const sc = shapeContentRef.current;
    if (sc === "room") return "gameplay";
    if (sc === "road" || sc === "river") return "path";
    if (sc === "terrain" || sc === "wall" || sc === "eraser") return "terrain";
    return null;
  }

  // Active layer lifecycle (3A §28): при load — заново; manual выбор живёт,
  // пока слой существует; смена tool / непригодность слоя → topmost
  // compatible visible unlocked; fallback — верхний visible unlocked; иначе null.
  // History хранит только document (§113): после undo active чинится здесь же.
  useEffect(() => {
    const doc = documentRef.current;
    if (!doc) {
      if (activeLayerRef.current !== null) setActiveLayerId(null);
      return;
    }
    const newMap = activeMapRef.current !== id;
    if (newMap) {
      activeMapRef.current = id;
      preferredTerrainLayerRef.current = null;
    }
    const cur = newMap ? null : activeLayerRef.current;
    if (cur) {
      const existing = doc.layers.find((l) => l.id === cur);
      if (existing && !newMap) {
        const changedTool = previousLayerToolRef.current !== tool || previousLayerShapeRef.current !== shapeContent;
        previousLayerToolRef.current = tool;
        previousLayerShapeRef.current = shapeContent;
        if (!changedTool) return;
        const want = tool === "shape" ? shapeKind() : toolLayerKind(tool);
        if (!want) return;
        if (existing.kind === want && existing.visible && !existing.locked) return;
        // Слой есть, но для текущего tool непригоден — перерезолв ниже (§92).
      }
    }
    const want = tool === "shape" ? shapeKind() : toolLayerKind(tool);
    previousLayerToolRef.current = tool;
    previousLayerShapeRef.current = shapeContent;
    let next: LayerId | null = null;
    if (want) {
      const r = resolveToolTargetLayer(doc, null, want);
      if (r.ok) next = r.layerId;
    }
    if (!next) {
      for (let i = doc.layers.length - 1; i >= 0; i--) {
        const l = doc.layers[i];
        if (l.visible && !l.locked) {
          next = l.id;
          break;
        }
      }
    }
    if (next !== activeLayerRef.current) setActiveLayerId(next);
  }, [document, tool, shapeContent, id]);

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
    if (!user) return;
    let alive = true;
    setLoading(true);
    setLoadError(null);
    autosave.beginLoad();
    // Карта читается мимо кэша слоя: перечитывание по чужой правке легло бы
    // поверх несохранённых правок.
    Promise.all([
      readOnce<MapFull>(`/maps/${id}`),
      canEdit ? readOnce<MapImageResource[]>("/maps/asset-catalog") : readOnce<MapImageResource[]>(`/maps/${id}/assets`),
    ])
      .then(([data, resources]) => {
        if (!alive) return;
        registerMapImageResources(resources);
        setImageResources(resources);
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
        void prepareMapImageAssets(loaded.document).catch((error) => {
          if (alive) setUnsupported(`Изображение карты не загрузилось: ${error instanceof Error ? error.message : String(error)}`);
        });
        setUnsupported(loaded.compatibility.compatible ? null : describeUnsupported(loaded));
        // Эталон — canonical serialization migrated-документа (§14 ТЗ 2G):
        // иначе in-memory V5 сразу казался бы dirty. Write-on-load нет (§13).
        const params = { seed: data.seed, sea: data.sea, mountains: data.mountains, forest: data.forest };
        const paramsStr = JSON.stringify(params);
        setGenParams(params);
        history.clear();
        autosave.markLoaded(loaded.status === "unsupported" ? loaded.raw : serializeMapDocument(loaded.document), paramsStr, loaded.corrupt, data.revision);
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
  }, [id, user?.role]);

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
    // 3A §102: чиним в target/active TerrainLayer; неоднозначность без
    // подходящего слоя — structured error, не случайный выбор.
    const tgt = resolveToolTargetLayer(doc, activeLayerRef.current, "terrain");
    if (!tgt.ok) {
      const hasRooms = doc.layers.some(
        (l) =>
          l.kind === "gameplay" &&
          l.items.some((e) => e.kind === "room" && e.geometry.type === "rect"),
      );
      setActionError(
        hasRooms ? "Выберите слой рельефа: некуда вписать коридоры." : "Починить нечего: на карте нет комнат.",
      );
      return;
    }
    if (!tgt.keptActive) setActiveLayer(tgt.layerId);
    const res = fixConnectivityV5(doc, tgt.layerId);
    if (!res) {
      setActionError("Починить нечего: на карте нет комнат.");
      return;
    }
    if (res.cleared.length === 0) {
      setActionError("Всё связно — чинить нечего.");
      return;
    }
    const layer = doc.layers.find((l) => l.id === tgt.layerId);
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
  }, [document, map, imageRevision]);

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

  // Показ игрокам (P2-5): галочка управляет доступом, при включении даём ссылку.
  const [shared, setShared] = useState(false);
  const [visibilityBusy, setVisibilityBusy] = useState(false);
  const visibilityBusyRef = useRef(false);

  async function setPlayerVisibility(visible: boolean) {
    if (!map || visibilityBusyRef.current) return;
    const before = map.player_visible;
    const player_visible = visible ? 1 : 0;
    if (before === player_visible) return;
    visibilityBusyRef.current = true;
    setVisibilityBusy(true);
    setActionError(null);
    setMap((current) => current ? { ...current, player_visible } : current);
    try {
      const updated = await autosave.saveRecord((expectedRevision) => write.put<MapFull>(`/maps/${map.id}`, { player_visible, expectedRevision }));
      setMap((current) => current && current.id === map.id ? { ...current, player_visible, revision: updated?.revision ?? current.revision } : current);
      afterWrite([{ kind: "map", id: map.id, card: true }]);
      if (visible) {
        try {
          await navigator.clipboard.writeText(`${window.location.origin}/maps/${map.id}`);
        } catch {
          // буфер недоступен — ссылка остаётся в сообщении ниже
        }
      }
      setShared(visible);
    } catch (e) {
      setMap((current) => current ? { ...current, player_visible: before } : current);
      setActionError(translateMapError(e));
    } finally {
      visibilityBusyRef.current = false;
      setVisibilityBusy(false);
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
  shapeContentRef.current = shapeContent;
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
  const [labelDraft, setLabelDraft] = useState<{
    x: number;
    y: number;
    text: string;
    existed: boolean;
    layerId: string;
  } | null>(null);
  const [labelError, setLabelError] = useState<string | null>(null);

  function openLabelEditor(x: number, y: number) {
    const doc = documentRef.current;
    if (!doc || !geom) return;
    // Target label layer резолвится при открытии (§42); save перепроверяет (§91).
    const tgt = resolveToolTargetLayer(doc, activeLayerRef.current, "label");
    if (!tgt.ok) {
      setLabelError(NO_COMPATIBLE_LAYER_ERROR);
      return;
    }
    if (!tgt.keptActive) setActiveLayer(tgt.layerId);
    const found = findLabelAtCell(doc, geom, tgt.layerId, x, y);
    setLabelDraft({ x, y, text: found?.text ?? "", existed: !!found, layerId: tgt.layerId });
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
    const layer = doc.layers.find((l) => l.id === d.layerId);
    if (!layer || layer.kind !== "label") {
      setLabelError("Слой подписей недоступен.");
      return;
    }
    if (!layer.visible || layer.locked) {
      setLabelError("Слой подписей скрыт или заблокирован.");
      return;
    }
    const labelCount = doc.layers.flatMap((l) => (l.kind === "label" ? l.items : [])).length;
    if (labelCount >= 200 && !findLabelAtCell(doc, geom, d.layerId, d.x, d.y)) {
      setLabelError("Подписей слишком много (максимум 200).");
      return;
    }
    // Центр клетки — та же позиция, что давала миграция legacy-подписей.
    const c = cellCenter(geom.grid, d.x, d.y);
    const existing = findLabelAtCell(doc, geom, d.layerId, d.x, d.y);
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
      const r = createLabel(next, d.layerId, { id: newId(), position: { x: c.cx, y: c.cy }, text });
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
    const layer = doc.layers.find((l) => l.id === d.layerId);
    if (!layer || layer.kind !== "label" || !layer.visible || layer.locked) {
      setLabelDraft(null);
      return;
    }
    const existing = findLabelAtCell(doc, geom, d.layerId, d.x, d.y);
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
    onActiveLayer: setActiveLayer,
  });
  const { selected } = selection;
  const selectedMapObject = selected?.kind === "object"
    ? document?.layers.flatMap((layer) => layer.kind === "object" ? layer.items : []).find((item) => item.id === selected.entityId)
    : undefined;

  function changeSelectedMapObject(rotation: number, size: number) {
    const doc = documentRef.current;
    if (!doc || !selectedMapObject || !canEdit || unsupported !== null) return;
    const owner = findEntityLayer(doc, selectedMapObject.id);
    if (!owner) return;
    const layer = doc.layers[owner.layerIndex];
    if (!layer.visible || layer.locked) return;
    const r = transformMapObject(doc, selectedMapObject.id, rotation, size);
    if (!r.ok) { setActionError(r.issues[0]?.message ?? "Не удалось изменить символ."); return; }
    if (r.changed) commitDocument(r.document, doc);
  }

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
    if (workspace) { setInspectorOpen(true); setToolSettingsOpen(false); }
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
    // §91: слой могли заблокировать/скрыть/удалить, пока модалка открыта.
    const own = editableOwningLayer(doc, d.id);
    if ("error" in own) {
      actionFailed(own.error);
      setDoorDraft(null);
      selection.clearSelection();
      return;
    }
    if (target.pairedDoorId) {
      const pairOwn = editableOwningLayer(doc, target.pairedDoorId);
      if ("error" in pairOwn) {
        actionFailed("Парная дверь в недоступном слое — сначала разблокируйте его.");
        return;
      }
    }
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
    const own = editableOwningLayer(doc, d.id);
    if ("error" in own) {
      actionFailed(own.error);
      setDoorDraft(null);
      selection.clearSelection();
      return;
    }
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
    const own = editableOwningLayer(doc, t.id);
    if ("error" in own) {
      actionFailed(own.error);
      setTrapDraft(null);
      selection.clearSelection();
      return;
    }
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
    const own = editableOwningLayer(doc, t.id);
    if ("error" in own) {
      actionFailed(own.error);
      setTrapDraft(null);
      selection.clearSelection();
      return;
    }
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
    const own = editableOwningLayer(doc, m.id);
    if ("error" in own) {
      actionFailed(own.error);
      setMarkerDraft(null);
      selection.clearSelection();
      return;
    }
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
    const own = editableOwningLayer(doc, m.id);
    if ("error" in own) {
      actionFailed(own.error);
      setMarkerDraft(null);
      selection.clearSelection();
      return;
    }
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
    // Создание — в target GameplayLayer (§41); правка — с guard owning layer (§91).
    const tgt = resolveToolTargetLayer(doc, activeLayerRef.current, "gameplay");
    if (!tgt.ok) {
      setObjError(NO_COMPATIBLE_LAYER_ERROR);
      return;
    }
    if (!tgt.keptActive) setActiveLayer(tgt.layerId);
    const layerId = tgt.layerId;
    const roomCount = doc.layers.flatMap((l) =>
      l.kind === "gameplay" ? l.items.filter((e) => e.kind === "room") : [],
    ).length;
    if (r.id === null) {
      const rect = input.roomRectRef.current;
      if (!rect) return;
      if (roomCount >= 100) {
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
      const own = editableOwningLayer(doc, r.id);
      if ("error" in own) {
        setObjError(own.error);
        setRoomDraft(null);
        selection.clearSelection();
        return;
      }
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
    const own = editableOwningLayer(doc, r.id);
    if ("error" in own) {
      setObjError(own.error);
      setRoomDraft(null);
      selection.clearSelection();
      return;
    }
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
    const tgt = resolveToolTargetLayer(doc, activeLayerRef.current, "gameplay");
    if (!tgt.ok) {
      setObjError(NO_COMPATIBLE_LAYER_ERROR);
      return;
    }
    if (!tgt.keptActive) setActiveLayer(tgt.layerId);
    const layerId = tgt.layerId;
    const targetItems = doc.layers.flatMap((l) => (l.kind === "gameplay" && l.id === layerId ? l.items : []));
    const allItems = doc.layers.flatMap((l) => (l.kind === "gameplay" ? l.items : []));
    const center = cellCenter(geom.grid, c.x, c.y);
    if (c.choice === "door") {
      if (allItems.filter((e) => e.kind === "door").length >= 400) {
        setObjError("Дверей слишком много (максимум 400).");
        return;
      }
      const pos = legacyDoorWorldPosition(geom.grid, c.x, c.y, c.edge);
      if (
        targetItems.some(
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
      if (allItems.filter((e) => e.kind === "trap").length >= 300) {
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
    const own = editableOwningLayer(doc, target.id);
    if ("error" in own) {
      setObjError(own.error);
      setSfDraft(null);
      selection.clearSelection();
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

  function selectTool(t: PaintTool, mode: EditorMode = editorMode) {
    if (toolUnavailableReason(t, map?.grid)) return;
    if (toolRef.current === "select" && t !== "select") closeObjPanels();
    if (t === "brush" || t === "fill" || t === "eraser" || t === "picker") {
      const preferred = documentRef.current?.layers.find((layer) => layer.id === preferredTerrainLayerRef.current);
      if (preferred?.kind === "terrain" && preferred.visible && !preferred.locked) setActiveLayer(preferred.id);
    }
    setTool(t);
    if (workspace && !["brush", "fill", "eraser", "picker", "ruler", "label", "select"].includes(t)) {
      setInspectorOpen(true);
      setToolSettingsOpen(false);
    }
    if (MODE_TOOLS[mode].includes(t)) modeToolRef.current[mode] = t;
    setExtraToolsOpen(!COMMON_TOOLS.includes(t) && !MODE_TOOLS[mode].includes(t));
  }

  useEffect(() => {
    if (toolUnavailableReason(tool, map?.grid)) {
      modeToolRef.current[editorMode] = DEFAULT_MODE_TOOL[editorMode];
      setTool(DEFAULT_MODE_TOOL[editorMode]);
      setExtraToolsOpen(false);
    }
  }, [tool, map?.grid, editorMode]);

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
      genParams,
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
      const format = parsed && typeof parsed === "object" ? (parsed as { format?: unknown }).format : undefined;
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
        const mismatch = checkSoyMapV2ImportTarget(res.value.document, geom);
        if (mismatch) {
          setXferMsg(mismatch);
          return;
        }
        documentRef.current = res.value.document;
        setDocument(res.value.document);
        if (res.value.generator) setGenParams(res.value.generator);
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
    if ((unsupported !== null || autosave.blocked) && resizing) {
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
      const updated = await autosave.saveRecord((expectedRevision) => write.put<MapFull>(`/maps/${map.id}`, {
        expectedRevision,
        name,
        scale: sScale,
        cell_lore: sLore,
        ...(resizing ? {} : { width: w, height: h }),
        // После switch контент всегда едет документом (§54 ТЗ 2G).
        ...(resizing ? { document: JSON.parse(serializeMapDocument(next)) } : {}),
      }));
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
      await prepareMapImageAssets(doc);
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
    setTimeout(async () => {
      try {
        await prepareMapImageAssets(snapshot.document);
        buildAndDownloadPng(snapshot, density);
      } catch (error) {
        setActionError(error instanceof Error ? error.message : "Изображение для PNG не загрузилось.");
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
  const [assetId, setAssetId] = useState(MAP_SYMBOL_ASSETS[0].id);

  async function selectAsset(id: string) {
    setAssetId(id);
    if (!id.startsWith("soyman-resource-images:")) return;
    try {
      await loadMapImageAsset(id);
      setActionError(null);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Изображение не загрузилось.");
    }
  }

  async function uploadMapImage(file: File | null) {
    if (!file || imageUploading) return;
    setImageUploading(true);
    try {
      const form = new FormData();
      form.append("name", file.name);
      form.append("type", "link");
      form.append("scope", "global");
      form.append("category", "image");
      form.append("file", file);
      const saved = await write.post<MapImageResource>("/resources", form);
      if (!saved.uid || !saved.file_url) throw new Error("Не удалось получить ссылку на изображение.");
      registerMapImageResources([saved]);
      setImageResources((before) => [...before, saved]);
      await selectAsset(resourceImageAssetId(saved.uid));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Не удалось добавить изображение.");
    } finally {
      setImageUploading(false);
    }
  }

  // Живая ссылка на инструмент для selectTool/double-click —
  // иначе читали бы то, что было выбрано при монтировании.
  const toolRef = useRef(tool);
  toolRef.current = tool;

  // Кадр — в MapViewport (DPR/canvas/renderMap/оверлеи там же, deps те же).

  // Пробел — временная панорама левой кнопкой — в useMapInput (spaceDown оттуда же).

  // Хоткеи (Этап Hotkeys): keyboard router — в хуке, mapping и гарды те же.
  // Space-пан — отдельным эффектом выше (input/camera), не часть роутера.
  useMapHotkeys({
    canEdit: canEditInView && unsupported === null,
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
    assetId,
    activeLayerId,
    onActiveLayer: setActiveLayer,
    documentRef,
    setDocument,
    push: history.push,
    commitDocument,
    newId,
    selectTool,
    setTerrain: chooseTerrain,
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
    freePathMode,
    freePathEditMode,
    selectedFreePathId,
    canEdit: canEditInView && unsupported === null,
    onFreePathPreview: (draft) => setFreePathPreview(draft && (tool === "road" || tool === "river")
      ? { kind: tool, ...draft } : null),
    onFreePathBegin: (kind) => {
      const doc = documentRef.current;
      if (!doc || unsupported !== null) return false;
      const target = ensurePathTargetLayer(doc, activeLayerRef.current, kind, newId);
      if (!target.ok) { setActionError(target.error); return false; }
      if (target.layerId !== activeLayerRef.current) setActiveLayer(target.layerId);
      if (target.created) commitDocument(target.document, doc);
      return true;
    },
    onFreePathCommit: (points, kind, origin) => {
      const doc = documentRef.current;
      if (!doc || unsupported !== null) return;
      if (origin) {
        const owner = doc.layers.find((layer) => layer.kind === "path" && layer.paths.some((path) => path.id === origin.pathId));
        const parent = owner?.kind === "path" ? owner.paths.find((path) => path.id === origin.pathId) : null;
        if (!owner || owner.kind !== "path" || !owner.visible || owner.locked ||
            !parent || parent.kind !== kind || parent.geometry.type !== "spline") {
          setActionError("Исходная линия больше недоступна для редактирования.");
          return;
        }
        const parentNodes = parent.geometry.nodes;
        if (origin.action === "branch-segment") {
          const split = insertSplineNodeAt(parentNodes, origin.segmentIndex, origin.t, parent.width);
          if (!split || Math.hypot(split.point.x - points[0].x,
            split.point.y - points[0].y) > 1e-6) {
            setActionError("Участок исходной линии изменился. Начните ответвление заново.");
            return;
          }
          const inserted = updateSplinePath(doc, parent.id, { nodes: split.nodes,
            insertedAt: { index: split.nodeIndex, count: 1 } });
          if (!inserted.ok) { setActionError(inserted.issues[0]?.message ?? "Не удалось добавить точку соединения."); return; }
          const nodes = branchSplineNodes(split.nodes[split.nodeIndex], points, parent.width);
          const branchId = newId();
          const created = createSplinePath(inserted.document, owner.id, {
            id: branchId, kind, styleRef: parent.styleRef, width: parent.width, nodes,
            branchFrom: { pathId: parent.id, nodeIndex: split.nodeIndex },
          });
          if (!created.ok) { setActionError(created.issues[0]?.message ?? "Не удалось создать ответвление."); return; }
          commitDocument(created.document, doc);
          if (owner.id !== activeLayerRef.current) setActiveLayer(owner.id);
          setFreePathEditMode(true);
          selectFreePath(branchId, nodes.length - 1);
          return;
        }
        const anchor = parentNodes[origin.nodeIndex];
        if (!anchor || Math.hypot(anchor.position.x - points[0].x,
          anchor.position.y - points[0].y) > 1e-6) {
          setActionError("Точка исходной линии изменилась. Начните ответвление заново.");
          return;
        }
        if (origin.action === "extend") {
          const end = origin.nodeIndex === 0 ? "start"
            : origin.nodeIndex === parentNodes.length - 1 ? "end" : null;
          if (!end) { setActionError("Продолжить линию можно только от крайней точки."); return; }
          const nodes = extendSplineNodes(parentNodes, points, end, parent.width);
          const result = updateSplinePath(doc, parent.id, { nodes,
            prependCount: end === "start" ? nodes.length - parentNodes.length : 0 });
          if (!result.ok) { setActionError(result.issues[0]?.message ?? "Не удалось продолжить линию."); return; }
          if (result.changed) commitDocument(result.document, doc);
          if (owner.id !== activeLayerRef.current) setActiveLayer(owner.id);
          setFreePathEditMode(true);
          selectFreePath(parent.id, end === "end" ? nodes.length - 1 : 0);
          return;
        }
        const nodes = branchSplineNodes(anchor, points, parent.width);
        const branchId = newId();
        const result = createSplinePath(doc, owner.id, {
          id: branchId, kind, styleRef: parent.styleRef, width: parent.width, nodes,
          branchFrom: { pathId: parent.id, nodeIndex: origin.nodeIndex },
        });
        if (!result.ok) { setActionError(result.issues[0]?.message ?? "Не удалось создать ответвление."); return; }
        commitDocument(result.document, doc);
        if (owner.id !== activeLayerRef.current) setActiveLayer(owner.id);
        setFreePathEditMode(true);
        selectFreePath(branchId, nodes.length - 1);
        return;
      }
      const target = ensurePathTargetLayer(doc, activeLayerRef.current, kind, newId);
      if (!target.ok) { setActionError(target.error); return; }
      const result = createSplinePath(target.document, target.layerId, {
        id: newId(), kind, styleRef: { type: "builtin", key: kind }, width: 0.22,
        nodes: splineFromAnchors(points).map((node) => ({ ...node, width: 0.22 })),
      });
      if (!result.ok) { setActionError(result.issues[0]?.message ?? "Не удалось нарисовать линию."); return; }
      if (target.layerId !== activeLayerRef.current) setActiveLayer(target.layerId);
      commitDocument(result.document, doc);
    },
    onFreePathSelect: selectFreePath,
    onFreePathEditPreview: setFreePathShapeDraft,
    onFreePathEditCommit: (pathId, nodes) => {
      const doc = documentRef.current;
      if (!doc || !canEditInView || unsupported !== null) return;
      const result = updateSplinePath(doc, pathId, { nodes });
      if (!result.ok) { setActionError(result.issues[0]?.message ?? "Не удалось изменить линию."); return; }
      if (result.changed) commitDocument(result.document, doc);
    },
    wallMode: wallLineMode,
    wallDraft,
    ruler,
    setHover,
    setRectPreview,
    onFogCell: (x, y, reverse) => {
      const doc = documentRef.current;
      if (!doc || !canEditInView || unsupported !== null) return false;
      const reveal = reverse ? fogAction === "hide" : fogAction === "reveal";
      const result = paintExplorationCell(doc, x, y, reveal);
      if (!result.ok || !result.changed) return false;
      documentRef.current = result.document;
      setDocument(result.document);
      return true;
    },
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
      message: "Все клетки станут равниной, дороги, реки, подписи, маркеры и объекты исчезнут. Маска раскрытия игроков тоже сбросится. Шаг попадёт в историю — его можно отменить.",
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

  // Материалы доступны независимо от набора инструментов режима.
  const inspectorRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (genOpen || pngOpen || xferOpen || legendOpen || bindOpen || tool === "asset" || tool === "marker" || tool === "shape") {
      if (inspectorRef.current) inspectorRef.current.scrollTop = 0;
    }
  }, [genOpen, pngOpen, xferOpen, legendOpen, bindOpen, tool]);
  function setActivePanel(p: "biomes" | "surface") {
    setActivePanelState(p);
    setTerrain(paletteTerrainRef.current[p]);
    try {
      localStorage.setItem("maps.panel", p);
    } catch {
      // приватный режим — просто не запоминаем
    }
  }
  function chooseTerrain(code: string) {
    const panel = MAP_FLOOR_TERRAINS.some((terrain) => terrain === code)
      ? "surface"
      : MAP_BIOME_TERRAINS.some((terrain) => terrain === code) ? "biomes" : activePanel;
    paletteTerrainRef.current[panel] = code;
    if (panel !== activePanel) setActivePanel(panel);
    setTerrain(code);
  }
  function changeEditorMode(mode: EditorMode) {
    if (mode === editorMode) return;
    setEditorMode(mode);
    try {
      localStorage.setItem("maps.editorMode", mode);
    } catch {
      // приватный режим — просто не запоминаем
    }
    setActivePanel(mode === "region" ? "biomes" : "surface");
    const rememberedTool = modeToolRef.current[mode];
    selectTool(toolUnavailableReason(rememberedTool, map?.grid) ? DEFAULT_MODE_TOOL[mode] : rememberedTool, mode);
  }

  const preferredTerrainLayer = document?.layers.find((layer) => layer.id === preferredTerrainLayerRef.current);
  const activeTerrainLayer = document?.layers.find((layer) => layer.id === activeLayerId);
  const terrainSurface = activeTerrainLayer?.kind === "terrain" ? activeTerrainLayer.representation
    : preferredTerrainLayer?.kind === "terrain" ? preferredTerrainLayer.representation : "cells";

  function chooseTerrainSurface(surface: "cells" | "mask") {
    const doc = documentRef.current;
    if (!doc || unsupported !== null || (surface === "mask" && doc.grid?.type !== "square")) return;
    const existing = [...doc.layers].reverse().find((layer) =>
      layer.kind === "terrain" && layer.representation === surface && layer.visible && !layer.locked);
    if (existing) {
      preferredTerrainLayerRef.current = existing.id;
      setActiveLayer(existing.id);
    } else {
      const layerId = newId();
      const name = surface === "mask" ? "Детальный рельеф" : "Рельеф";
      const result = surface === "mask"
        ? createTerrainMaskLayer(doc, { id: layerId, name })
        : createTerrainLayer(doc, { id: layerId, name });
      if (!result.ok) {
        setActionError(result.issues[0]?.message ?? "Не удалось создать слой рельефа.");
        return;
      }
      const aboveTerrain = doc.layers.reduce((index, layer, i) => layer.kind === "terrain" ? i + 1 : index, 0);
      const placed = moveLayer(result.document, layerId, surface === "cells" ? 0 : aboveTerrain);
      if (!placed.ok) {
        setActionError(placed.issues[0]?.message ?? "Не удалось разместить слой рельефа.");
        return;
      }
      commitDocument(placed.document, doc);
      preferredTerrainLayerRef.current = layerId;
      setActiveLayer(layerId);
    }
    selectTool("brush");
  }

  function toggleExploration() {
    const doc = documentRef.current;
    if (!doc || unsupported !== null) return;
    const result = setExplorationEnabled(doc, !doc.exploration?.enabled);
    if (!result.ok || !result.changed) return;
    const compatibility = assessCurrentEditorCompatibility(result.document);
    if (!compatibility.compatible) {
      setActionError("Нельзя включить раскрытие: " + (compatibility.reasons[0]?.message ?? "карта содержит неподдерживаемые данные."));
      return;
    }
    commitDocument(result.document, doc);
  }
  function changeAllExploration(reveal: boolean) {
    const doc = documentRef.current;
    if (!doc || unsupported !== null) return;
    const result = setAllExplorationCells(doc, reveal);
    if (result.ok && result.changed) commitDocument(result.document, doc);
  }

  function toolButton(id: PaintTool) {
    const unavailable = toolUnavailableReason(id, map?.grid);
    const description = TOOL_DESCRIPTIONS[id];
    return (
      <button
        key={id}
        type="button"
        className="map-tool"
        aria-label={description.label}
        aria-pressed={tool === id}
        disabled={unavailable !== null}
        title={unavailable ?? description.title}
        onClick={() => selectTool(id)}
      >
        {workspace ? <><MapToolIcon tool={id} /><span>{description.label}</span></> : description.label}
      </button>
    );
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
          chooseTerrain(code);
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
    if (autosave.status.kind === "conflict") return "Карта изменена в другом окне · сохраните копию своих правок";
    if (autosave.status.kind === "error") return "Не сохранилось — нажмите «Повторить»";
    if (autosave.status.kind === "dirty") return "Есть несохранённое…";
    return autosave.status.at ? `Сохранено ${autosave.status.at}` : "Сохранено";
  }

  return (
    <div className={`stack map-editor${canEditInView ? "" : " map-editor--readonly"}`} style={{ position: "relative" }}>
      <SectionBackground />
      <div className="map-editor-breadcrumbs" title={map?.name}>
        <Breadcrumbs items={[
          { label: "Главная", to: "/" },
          { label: "Карты", to: "/maps" },
          { label: map?.name ?? "Карта" },
        ]} />
      </div>

      {canEdit && map && !loadError && <div className="row">
        <span className="muted">Классический редактор</span>
        <Link to={`/maps/${map.id}/workspace`}>Открыть основной редактор с токенами</Link>
      </div>}

      {loading && <p className="muted">Загрузка карты…</p>}

      {loadError && (
        <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось открыть карту: {loadError}</span>
          {canEdit && <button type="button" onClick={() => { void downloadStoredMapOriginal(Number(id)).catch((e) => setLoadError(String(e instanceof Error ? e.message : e))); }}>Скачать исходный документ</button>}
          <Link to="/maps" className="primary" style={{ padding: "6px 12px", textDecoration: "none" }}>
            К списку
          </Link>
        </div>
      )}

      {!loading && !loadError && map && (
        <>
          <div className="map-editor-menubar" ref={menuBarRef} aria-label="Меню редактора карты">
            {canEditInView && (
              <div className="map-editor-menu">
                <button type="button" className="map-editor-menu-trigger" aria-expanded={topMenu === "map"} aria-controls="map-editor-menu-map" onClick={() => setTopMenu(topMenu === "map" ? null : "map")}>Карта</button>
                {topMenu === "map" && (
                  <div className="map-editor-menu-popup" id="map-editor-menu-map" aria-label="Пункты меню Карта">
                    <button type="button" onClick={() => { setTopMenu(null); openSettings(); }}>Настройки карты</button>
                    <button type="button" onClick={() => { setTopMenu(null); setBindOpen(true); }}>Привязки карты</button>
                    <span className="map-editor-menu-separator" />
                    <button type="button" onClick={() => { setTopMenu(null); void duplicateMap(); }}>Дублировать</button>
                    <button type="button" onClick={() => { setTopMenu(null); navigate("/maps?create=1"); }}>Создать новую</button>
                    <button type="button" className="map-editor-menu-danger" onClick={() => { setTopMenu(null); void deleteMap(); }}>Удалить</button>
                    <span className="map-editor-menu-separator" />
                    <button type="button" onClick={() => { setTopMenu(null); togglePng(); }}>Экспорт PNG</button>
                    <button type="button" title="Открыть экспорт и импорт JSON" onClick={() => { setTopMenu(null); toggleXfer(); }}>Экспорт JSON</button>
                  </div>
                )}
              </div>
            )}
            {canEditInView && (
              <div className="map-editor-menu">
                <button type="button" className="map-editor-menu-trigger" aria-label="Режим инструментов" aria-expanded={topMenu === "mode"} aria-controls="map-editor-menu-mode" onClick={() => setTopMenu(topMenu === "mode" ? null : "mode")}>{workspace ? "Режим" : "Режим инструментов"}</button>
                {topMenu === "mode" && (
                  <div className="map-editor-menu-popup" id="map-editor-menu-mode" role="tablist" aria-label="Режим инструментов">
                    {([ ["region", "Регион"], ["local", "Местность"], ["dungeon", "Подземелье"] ] as const).map(([mode, label]) => (
                      <button key={mode} type="button" role="tab" aria-selected={editorMode === mode} onClick={() => { changeEditorMode(mode); setTopMenu(null); }}>{label}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <div className="map-editor-menu">
              <button type="button" className="map-editor-menu-trigger" aria-expanded={topMenu === "view"} aria-controls="map-editor-menu-view" onClick={() => setTopMenu(topMenu === "view" ? null : "view")}>Вид</button>
              {topMenu === "view" && (
                <div className="map-editor-menu-popup" id="map-editor-menu-view" aria-label="Пункты меню Вид">
                  {!workspace && <label><input type="checkbox" checked={sidePanelsHidden} onChange={(event) => toggleSidePanels(event.target.checked)} />Скрыть боковые панели</label>}
                  {canEdit && <label title="Открывает карту в разделе игрока и копирует ссылку"><input type="checkbox" checked={map.player_visible === 1} disabled={!canEditInView || visibilityBusy} onChange={(event) => void setPlayerVisibility(event.target.checked)} />Показать игрокам</label>}
                  <span className="map-editor-menu-separator" />
                  <label><input type="checkbox" checked={showGrid} onChange={toggleGrid} />Сетка</label>
                  <label><input type="checkbox" checked={showCoords} onChange={toggleCoords} />Координаты</label>
                </div>
              )}
            </div>
            {canEditInView && (
              <div className="map-editor-menu">
                <button type="button" className="map-editor-menu-trigger" aria-expanded={topMenu === "tools"} aria-controls="map-editor-menu-tools" onClick={() => setTopMenu(topMenu === "tools" ? null : "tools")}>Инструменты</button>
                {topMenu === "tools" && (
                  <div className="map-editor-menu-popup" id="map-editor-menu-tools" aria-label="Пункты меню Инструменты">
                    <button type="button" onClick={() => { setTopMenu(null); toggleGen(); }}>Генератор</button>
                  </div>
                )}
              </div>
            )}
            <span className="map-editor-menubar-spacer" />
            {canEditInView && <span className="map-editor-mode-indicator">{editorMode === "region" ? "Регион" : editorMode === "local" ? "Местность" : "Подземелье"}</span>}
          </div>
          <div className="res-toolbar map-editor-summary" style={{ marginTop: 4 }}>
            <span className="badge tag">{MAP_GRID_LABELS[map.grid]}</span>
            <span className="badge tag">{MAP_SCALE_LABELS[map.scale]}</span>
            <span
              className="muted"
              style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}
              title="Размер поля и масштаб клетки"
            >
              {map.width}×{map.height} · клетка {map.cell_lore}
            </span>
          </div>

          {!canEdit && <p className="muted">Просмотр: правит карты только мастер.</p>}

          {canEditInView && (
            <>
              <div className="res-toolbar map-editor-commandbar" role="toolbar" aria-label="Команды карты">
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
              {workspace && <MapWorkspaceTools>
                <div className="map-workspace-tool-list">
                <div role="toolbar" aria-label="Основные инструменты" className="map-workspace-primary-tools">{COMMON_TOOLS.map(toolButton)}</div>
                <div role="toolbar" aria-label="Инструменты режима" className="map-workspace-mode-tools">{MODE_TOOLS[editorMode].map(toolButton)}</div>
                </div>
                <div className="map-workspace-tool-panels">
                <button type="button" data-map-settings-toggle aria-label="Материалы и параметры" title="Материалы и параметры"
                  aria-expanded={toolSettingsOpen} aria-controls="map-workspace-tool-settings"
                  onClick={() => { setToolSettingsOpen(!toolSettingsOpen); setInspectorOpen(false); }}><NavIcon name="palette" /><span>Палитра</span></button>
                <button type="button" data-map-inspector-toggle aria-label="Слои и свойства" title="Слои и свойства"
                  aria-expanded={inspectorOpen} aria-controls="map-workspace-inspector"
                  onClick={() => { setInspectorOpen(!inspectorOpen); setToolSettingsOpen(false); }}><NavIcon name="sliders" /><span>Слои</span></button>
                </div>
              </MapWorkspaceTools>}
              <aside id="map-workspace-tool-settings" hidden={!!workspace && !toolSettingsOpen}
                className={`map-editor-tool-column${workspace ? " map-editor-workspace-drawer" : ""}`} aria-label="Инструменты карты">
                {workspace && <button type="button" className="map-workspace-drawer-close" aria-label="Закрыть материалы и параметры" onClick={() => setToolSettingsOpen(false)}><NavIcon name="close" /></button>}
                <div className="map-editor-panel-heading">Инструменты <span>{editorMode === "region" ? "Регион" : editorMode === "local" ? "Местность" : "Подземелье"}</span></div>
                {!workspace && <>
                <span className="map-editor-group-label">Общие</span>
                <div className="map-editor-common-tools" role="toolbar" aria-label="Основные инструменты">
                  {COMMON_TOOLS.map(toolButton)}
                </div>
                <span className="map-editor-group-label">{editorMode === "region" ? "Регион" : editorMode === "local" ? "Местность" : "Подземелье"}</span>
                <div className="map-editor-mode-tools" role="toolbar" aria-label="Инструменты режима">
                  {MODE_TOOLS[editorMode].map(toolButton)}
                </div>
                </>}
                {editorMode === "dungeon" && map?.grid === "hex" && (
                  <span className="muted map-editor-tool-note">Двери доступны только на квадратной сетке.</span>
                )}
                <div className="map-editor-terrain-surface" role="group" aria-label="Способ рисования рельефа">
                  <span className="map-editor-group-label">Рисование рельефа</span>
                  <div className="map-editor-terrain-surface-options">
                    <button type="button" className="map-tool" aria-pressed={terrainSurface === "cells"}
                      onClick={() => chooseTerrainSurface("cells")}>По клеткам</button>
                    <button type="button" className="map-tool" aria-pressed={terrainSurface === "mask"}
                      disabled={map.grid !== "square"} title={map.grid !== "square" ? "Детальное рисование пока доступно на квадратных картах" : undefined}
                      onClick={() => chooseTerrainSurface("mask")}>Свободная кисть</button>
                  </div>
                  <span className="muted map-editor-tool-note">Выбирает слой для кисти: оба слоя остаются видимыми. Детальный слой создаётся при первом выборе и рисует с шагом ¼ клетки.</span>
                </div>
                <div className="map-editor-brush-size" role="group" aria-label="Размер кисти">
                  <span className="muted">Размер кисти</span>
                  {([1, 2, 3] as BrushSize[]).map((n) => (
                    <button
                      key={n}
                      type="button"
                      className="map-tool"
                      aria-pressed={brushSize === n}
                      title={`Кисть ${n}`}
                      disabled={!(tool === "brush" || tool === "road" || tool === "river" || (tool === "wall" && !wallLineMode))}
                      onClick={() => setBrushSize(n)}
                    >
                      {n}
                    </button>
                  ))}
                </div>
              <span className="map-editor-group-label">Материалы кисти</span>
              <div className="res-toolbar" role="tablist" aria-label="Материалы кисти">
                {(["biomes", "surface"] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={activePanel === p}
                    className="map-tool"
                    aria-pressed={activePanel === p}
                    onClick={() => setActivePanel(p)}
                  >
                    {p === "biomes" ? "Биомы" : "Поверхность"}
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
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    {MAP_TERRAIN_LABELS[terrain] ?? terrain}
                  </span>
                </div>
              )}
              <button
                type="button"
                className="map-editor-extra-toggle"
                aria-expanded={extraToolsOpen}
                onClick={() => setExtraToolsOpen((open) => !open)}
              >
                {extraToolsOpen ? "Скрыть остальные инструменты" : "Остальные инструменты"}
              </button>
              {extraToolsOpen && (
                <div id="map-editor-extra-tools" className="map-editor-mode-tools" role="toolbar" aria-label="Остальные инструменты">
                  {extraToolsForMode(editorMode).map(toolButton)}
                </div>
              )}
              </aside>
              <aside ref={inspectorRef} id="map-workspace-inspector" hidden={!!workspace && !inspectorOpen}
                className={`map-editor-inspector-column${workspace ? " map-editor-workspace-drawer" : ""}`} aria-label="Слои и свойства карты">
                {workspace && <button type="button" className="map-workspace-drawer-close" aria-label="Закрыть слои и свойства" onClick={() => setInspectorOpen(false)}><NavIcon name="close" /></button>}
                <div className="map-editor-panel-heading">Слои и свойства <span>{TOOL_DESCRIPTIONS[tool].label}</span></div>
              {tool === "fog" && document?.grid && (
                <div className="card map-editor-fog-controls" aria-label="Раскрытие карты">
                  <strong>Открытие карты игрокам</strong>
                  <span className="muted">Мастер видит всю карту. Закрытые клетки скрыты от игроков и на втором экране.</span>
                  <button type="button" className="map-tool"
                    aria-pressed={document.exploration?.enabled ?? false}
                    onClick={toggleExploration}>
                    {document.exploration?.enabled
                      ? "Выключить туман"
                      : document.exploration?.revealedCells.length
                        ? "Включить туман · вернуть открытые клетки"
                        : "Включить туман · скрыть всё"}
                  </button>
                  {document.exploration?.enabled && (
                    <>
                      <span className="muted">Открыто {document.exploration.revealedCells.length} из {document.grid.columns * document.grid.rows} клеток</span>
                      <div className="map-editor-fog-actions" role="group" aria-label="Действие с клетками">
                        <button type="button" className="map-tool" aria-pressed={fogAction === "reveal"} onClick={() => setFogAction("reveal")}>Показать</button>
                        <button type="button" className="map-tool" aria-pressed={fogAction === "hide"} onClick={() => setFogAction("hide")}>Скрыть</button>
                      </div>
                      <span className="muted">Клик или мазок по клеткам. Правая кнопка делает обратное. Ctrl+Z отменяет мазок.</span>
                      <div className="map-editor-fog-actions">
                        <button type="button" onClick={() => changeAllExploration(true)}>Показать всё</button>
                        <button type="button" onClick={() => changeAllExploration(false)}>Скрыть всё</button>
                      </div>
                    </>
                  )}
                </div>
              )}
              {(tool === "road" || tool === "river") && (
                <div className="card map-editor-fog-controls" aria-label="Рисование путей">
                  <strong>{tool === "road" ? "Дорога" : "Река"}</strong>
                  <div className="map-editor-fog-actions" role="group" aria-label="Способ рисования пути">
                    <button type="button" className="map-tool" aria-pressed={!freePathMode} onClick={() => { setFreePathMode(false); selectFreePath(null); }}>По клеткам</button>
                    <button type="button" className="map-tool" aria-pressed={freePathMode} onClick={() => setFreePathMode(true)}>Сплайн</button>
                  </div>
                  {freePathMode && (
                    <>
                      <div className="map-editor-fog-actions" role="group" aria-label="Действие со свободной линией">
                        <button type="button" className="map-tool" aria-pressed={!freePathEditMode} onClick={() => { setFreePathEditMode(false); selectFreePath(null); }}>Рисовать</button>
                        <button type="button" className="map-tool" aria-pressed={freePathEditMode} onClick={() => setFreePathEditMode(true)}>Править</button>
                      </div>
                      <span className="muted">{freePathEditMode
                        ? "Выберите линию, затем точку. Круглая точка меняет форму, квадратные усики — изгиб."
                        : "Ставьте опорные точки кликами или касаниями. Двойной клик или Enter завершает линию, Backspace убирает точку, Esc отменяет."}</span>
                      {!freePathEditMode && freePathPreview && (
                        <div className="map-editor-spline-actions">
                          <span className="muted">Опорных точек: {freePathPreview.anchors.length}</span>
                          <button type="button" disabled={freePathPreview.anchors.length < 2}
                            onClick={() => input.finishFreePath()}>Завершить</button>
                          <button type="button" onClick={() => input.removeFreePathAnchor()}>Убрать точку</button>
                          <button type="button" onClick={() => input.cancelFreePath()}>Отменить</button>
                        </div>
                      )}
                      {freePathEditMode && selectedFreePath && freePathJoinCandidate?.pathId === selectedFreePath.id && (
                        <div className="map-editor-spline-actions">
                          <span className="muted">Выбран участок линии. При ответвлении здесь появится новая опорная точка.</span>
                          <button type="button" onClick={() => {
                            if (tool !== "road" && tool !== "river") return;
                            if (input.startFreePathFrom(freePathJoinCandidate.point, tool, {
                              action: "branch-segment", pathId: selectedFreePath.id,
                              segmentIndex: freePathJoinCandidate.segmentIndex, t: freePathJoinCandidate.t,
                            })) setFreePathEditMode(false);
                          }}>Ответвить здесь</button>
                        </div>
                      )}
                      {freePathEditMode && selectedFreePath && selectedSplineNode && (
                        <div className="map-editor-path-width">
                          <strong>Точка {selectedSplineNodeIndex + 1} из {selectedFreePath.geometry.type === "spline" ? selectedFreePath.geometry.nodes.length : 0}</strong>
                          {selectedFreePath.branchFrom && selectedSplineNodeIndex === 0 &&
                            <span className="muted">Начало ответвления привязано к исходной линии.</span>}
                          <div className="map-editor-fog-actions" role="group" aria-label="Тип точки сплайна">
                            <button type="button" className="map-tool" aria-pressed={!!(selectedSplineNode.in || selectedSplineNode.out)}
                              onClick={() => changeSelectedSplineNodeLinear(false)}>Плавная</button>
                            <button type="button" className="map-tool" aria-pressed={!selectedSplineNode.in && !selectedSplineNode.out}
                              onClick={() => changeSelectedSplineNodeLinear(true)}>Линейная</button>
                          </div>
                          <div className="map-editor-fog-actions" role="group" aria-label="Продолжение и ответвление">
                            <button type="button" className="map-tool"
                              title={selectedFreePath.branchFrom && selectedSplineNodeIndex === 0
                                ? "Продолжайте ответвление от свободного конца" : undefined}
                              disabled={selectedFreePath.geometry.type !== "spline" ||
                                (selectedSplineNodeIndex !== 0 && selectedSplineNodeIndex !== selectedFreePath.geometry.nodes.length - 1) ||
                                (selectedSplineNodeIndex === 0 && !!selectedFreePath.branchFrom)}
                              onClick={() => {
                                if (tool !== "road" && tool !== "river") return;
                                if (input.startFreePathFrom(selectedSplineNode.position, tool,
                                  { action: "extend", pathId: selectedFreePath.id, nodeIndex: selectedSplineNodeIndex }))
                                  setFreePathEditMode(false);
                              }}>Продолжить от точки</button>
                            <button type="button" className="map-tool" onClick={() => {
                              if (tool !== "road" && tool !== "river") return;
                              if (input.startFreePathFrom(selectedSplineNode.position, tool,
                                { action: "branch", pathId: selectedFreePath.id, nodeIndex: selectedSplineNodeIndex }))
                                setFreePathEditMode(false);
                            }}>Ответвить от точки</button>
                          </div>
                          <label>Толщина точки · {(freePathWidthDraft ?? selectedSplineNode.width ?? selectedFreePath.width).toFixed(2)} кл
                          <input type="range" min="0.06" max={Math.max(2, selectedSplineNode.width ?? selectedFreePath.width)} step="0.02"
                            aria-label="Толщина выбранной точки"
                            value={freePathWidthDraft ?? selectedSplineNode.width ?? selectedFreePath.width}
                            onChange={(event) => {
                              const width = Number(event.target.value);
                              freePathWidthDraftRef.current = width;
                              setFreePathWidthDraft(width);
                            }}
                            onPointerUp={commitFreePathWidth}
                            onTouchEnd={commitFreePathWidth}
                            onKeyUp={commitFreePathWidth}
                            onBlur={commitFreePathWidth}
                          />
                          </label>
                          <span className="muted">{freePathHandleIndices(selectedFreePath.geometry.type === "spline" ? selectedFreePath.geometry.nodes : []).length} точек формы</span>
                        </div>
                      )}
                      {document?.layers.flatMap((layer) => layer.kind === "path"
                        ? layer.paths.filter((path) => path.kind === tool && path.geometry.type === "spline")
                          .map((path) => ({ path, editable: layer.visible && !layer.locked })) : []).map(({ path, editable }, index) => (
                      <div className="row" key={path.id} style={{ justifyContent: "space-between", gap: 8 }}>
                        <button type="button" className="map-editor-path-choice" aria-pressed={selectedFreePathId === path.id && freePathEditMode}
                          disabled={!editable || !canEditInView || unsupported !== null}
                          onClick={() => { setFreePathEditMode(true); selectFreePath(path.id); }}>
                          {path.branchFrom ? "Ответвление" : "Линия"} {index + 1}{editable ? "" : " · слой недоступен"}
                        </button>
                        <button type="button" aria-label={`Удалить линию ${index + 1}`} disabled={!editable || !canEditInView || unsupported !== null} onClick={() => {
                        const doc = documentRef.current;
                        if (!doc || !canEditInView || unsupported !== null) return;
                        const result = deleteMapPath(doc, path.id);
                        if (result.ok && result.changed) { commitDocument(result.document, doc); if (selectedFreePathId === path.id) selectFreePath(null); }
                      }}>Удалить</button>
                    </div>
                      ))}
                    </>
                  )}
                </div>
              )}
              {tool === "wall" && (
                <div className="res-toolbar" role="toolbar" aria-label="Параметры стены">
                  <button
                    type="button"
                    className="map-tool"
                    aria-pressed={wallLineMode}
                    title="Линия: клики — вершины, двойной клик или Enter — завершить, Esc — отменить"
                    onClick={() => {
                      setWallLineMode((v) => !v);
                      setWallDraft(null);
                      setWallLive(null);
                    }}
                  >
                    Линия
                  </button>
                  {wallLineMode && (
                    <label className="row" style={{ gap: 6 }} title="Привязывать вершины к центрам клеток">
                      <input type="checkbox" checked={wallSnap} onChange={(e) => setWallSnap(e.target.checked)} />
                      Снеп к сетке
                    </label>
                  )}
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
              {tool === "asset" && (
                <div className="res-toolbar" role="toolbar" aria-label="Символ карты">
                  <select value={assetId} onChange={(e) => { void selectAsset(e.target.value); }} aria-label="Символ карты">
                    {MAP_SYMBOL_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
                    {imageResources.length > 0 && <optgroup label="Мои изображения">
                      {imageResources.map((resource) => <option key={resource.uid} value={resourceImageAssetId(resource.uid)}>{resource.name}</option>)}
                    </optgroup>}
                  </select>
                  <label className="character-avatar-upload" style={{ cursor: "pointer" }}>
                    {imageUploading ? "Добавляю…" : "+ Изображение"}
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" disabled={imageUploading}
                      style={{ position: "absolute", width: 1, height: 1, overflow: "hidden" }}
                      onChange={(e) => { void uploadMapImage(e.target.files?.[0] ?? null); e.target.value = ""; }} />
                  </label>
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    Клик — разместить свободно. Выбор (V) — переместить или удалить.
                  </span>
                </div>
              )}
              {selectedMapObject && tool === "select" && (
                <div className="res-toolbar" role="toolbar" aria-label="Выбранный символ">
                  <span>{resolveMapSymbol(selectedMapObject.visual)?.name ?? "Символ"}</span>
                  <button type="button" onClick={() => changeSelectedMapObject(selectedMapObject.transform.rotation - 45, selectedMapObject.transform.scale.x)}>↶ 45°</button>
                  <button type="button" onClick={() => changeSelectedMapObject(selectedMapObject.transform.rotation + 45, selectedMapObject.transform.scale.x)}>↷ 45°</button>
                  <button type="button" onClick={() => changeSelectedMapObject(selectedMapObject.transform.rotation, Math.max(0.25, selectedMapObject.transform.scale.x / 2))}>− Размер</button>
                  <button type="button" onClick={() => changeSelectedMapObject(selectedMapObject.transform.rotation, Math.min(8, selectedMapObject.transform.scale.x * 2))}>+ Размер</button>
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>Del — удалить</span>
                </div>
              )}
              {tool === "shape" && (
                <div className="res-toolbar" role="toolbar" aria-label="Параметры прямоугольника">
                  <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
                    Прямоугольник
                  </span>
                  <select
                    value={shapeContent}
                    onChange={(e) => setShapeContent(e.target.value as typeof shapeContent)}
                    aria-label="Содержимое прямоугольника"
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
              {document && (
                <LayerPanel
                  document={document}
                  activeLayerId={activeLayerId}
                  onActiveLayer={selectLayerInPanel}
                  setDocument={(d) => {
                    documentRef.current = d;
                    setDocument(d);
                  }}
                  commitDocument={commitDocument}
                  newLayerId={newId}
                  confirmDelete={(title, message) =>
                    confirm({ title, message, confirmLabel: "Удалить", cancelLabel: "Отмена", danger: true })
                  }
                  setActionError={setActionError}
                />
              )}
              {legendOpen && (
                <div className="card" style={{ padding: "10px 12px" }} aria-label="Легенда террейна">
                  <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
                    {MAP_TERRAIN_ORDER.filter((code) => legend?.terrainCodes.has(code) ?? false).map((code) => (
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
                    {legend && legend.doors.length > 0 &&
                      MAP_DOOR_KINDS.filter((k) =>
                        legend.doors.some((d) => !doorForView(d, !canEdit || previewAsPlayer).hidden && doorForView(d, !canEdit || previewAsPlayer).kind === k)
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
                      legend?.traps.some((t) => t.kind === k) ?? false
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
                    {MAP_ROOM_TYPES.filter((t) => legend?.rooms.some((r) => r.type === t) ?? false).map((t) => (
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
                    {legend?.hasStart && (
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
                    {(legend?.hasRivers ?? false) && (
                      <span className="row" style={{ gap: 6 }} title="Река — поверх террейна, под дорогами">
                        <span
                          aria-hidden="true"
                          style={{ display: "inline-block", width: 18, height: 5, background: MAP_RIVER_FILL }}
                        />
                        <span style={{ fontSize: "var(--fs-micro)" }}>{MAP_RIVER_LABEL}</span>
                      </span>
                    )}
                    {MAP_MARKER_KINDS.filter((k) => legend?.markers.some((m) => m.kind === k) ?? false).map((k) => (
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
                    {legend?.hasFinish && (
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
                    <label className="row" style={{ gap: 6 }} title="Скрывает ловушки, секретные двери и типы комнат; названия комнат и подписи остаются видны">
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
              </aside>
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
              {canEdit && map && <button type="button" onClick={() => downloadMapJson(map.cells, `map-${map.id}-original.json`)}>Скачать исходный документ</button>}
            </div>
          )}
          {autosave.status.kind === "conflict" && map && document && (
            <div className="card" role="alert">
              <span>Карта изменена в другом окне. Автосохранение остановлено; ваши правки остаются здесь. Сохраните их копию перед повторным открытием карты.</span>
              <button type="button" onClick={() => downloadMapJson(JSON.stringify(buildSoyMapV2({ name: map.name, scale: map.scale, cellLore: map.cell_lore }, document, genParams)), `map-${map.id}-my-changes.json`)}>Скачать мои правки</button>
            </div>
          )}
          <section className="map-editor-stage" aria-label="Поле карты">
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
                title={previewAsPlayer ? "Вернуться к редактированию" : "Глазами игрока: скрытые клетки и секреты не видны; открытые клетки показаны как на втором экране"}
                onClick={() => setPreviewAsPlayer((v) => !v)}
              >
                Глазами игрока
              </button>
            )}
            {previewAsPlayer && <span className="muted" role="status">Просмотр игрока · редактирование отключено</span>}
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
            className="card map-editor-viewport"
            style={{ height: "clamp(420px, 68vh, 780px)", padding: 0, overflow: "hidden", touchAction: "none", position: "relative" }}
          >
            <MapViewport
              wrapRef={wrapRef}
              canvasRef={canvasRef}
              map={map}
              model={displayModel}
              cam={cam}
              view={{
                showGrid,
                showCoords,
                previewAsPlayer,
                canEdit: canEditInView,
              }}
              tool={{
                tool,
                brushSize,
                wallLineMode,
                freePathMode,
              }}
              overlays={{
                hover: previewAsPlayer ? null : hover,
                selectedId: previewAsPlayer ? null : selected?.entityId ?? null,
                ruler: previewAsPlayer ? null : ruler,
                wallDraft: previewAsPlayer ? null : wallDraft,
                wallLive: previewAsPlayer ? null : wallLive,
                rectPreview: previewAsPlayer ? null : rectPreview,
                freePathPreview: previewAsPlayer ? null : freePathPreview,
                selectedFreePath: freePathMode && freePathEditMode && canEditInView && !previewAsPlayer &&
                  selectedFreePath?.geometry.type === "spline"
                  ? { nodes: freePathShapeDraft?.pathId === selectedFreePath.id
                    ? freePathShapeDraft.nodes : selectedFreePath.geometry.nodes,
                    selectedNodeIndex: selectedSplineNodeIndex,
                    joinCandidate: freePathJoinCandidate?.pathId === selectedFreePath.id
                      ? freePathJoinCandidate.point : null }
                  : null,
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
                  if (tool === "wall" && wallLineMode && canEditInView) tools.wall.finishWallLine(false);
                  if (freePathMode && !freePathEditMode && (tool === "road" || tool === "river") && canEditInView)
                    input.finishFreePath();
                },
                spaceDown: input.spaceDown,
              }}
            />
            {map && miniThumb && !previewAsPlayer && (
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
            {canEditInView
              ? "Выбор (V): клик — панель, тяни объект — двигать, Del — удалить, пустое — создать. Левая — рисовать, правая — стереть, Alt+клик — пипетка, N — река, W — стены, U — шейп, D — дверь, M — линейка, T — подпись, колесо или +/− — масштаб, 0 — вписать, средняя кнопка или пробел — сдвиг. Alt+G — генератор, Alt+P — PNG."
              : "Колесо или +/− — масштаб, 0 — вписать, средняя кнопка или пробел — сдвиг."}
          </p>
          {canEditInView && (
            <details className="muted" style={{ fontSize: "var(--fs-micro)" }}>
              <summary style={{ cursor: "pointer" }}>Горячие клавиши</summary>
              <p style={{ margin: "4px 0" }}>
                V выбор · B кисть · G заливка · E ластик · I пипетка · R дорога · N река · W стены · U шейп · D дверь · L ловушка · C сундук · A алтарь · K маркер · S старт · F финиш · M линейка · T подпись ·
                Ctrl+Z отменить · Ctrl+Shift+Z / Ctrl+Y вернуть · Del удалить объект · +/− масштаб · 0 вписать ·
                Alt+G генератор · Alt+P экспорт PNG · Ctrl+Enter сгенерировать (панель открыта) · Esc сбросить замер.
              </p>
            </details>
          )}
          </section>
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
              ? `Инструмент: ${TOOL_DESCRIPTIONS[tool].label}${
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
