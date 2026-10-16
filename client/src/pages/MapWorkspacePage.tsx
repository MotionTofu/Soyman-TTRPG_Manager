import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useLocation, useNavigate, useParams } from "react-router-dom";
import type { Setting, SettingGenre } from "../types";
import type { MapDocumentV6, MapDrawingStyle, MapLiquidRecipe, MapWaterLook, Vec2 } from "@shared/maps/core";
import { useCurrentUser } from "../api/currentUser";
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { useConfirm } from "../hooks/useConfirm";
import { useEvent } from "../hooks/useEvent";
import { Modal } from "../components/Modal";
import { EntityPreviewContent } from "../components/EntityPreviewModal";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { mapWorkspaceApi, downloadMapJson, downloadStoredMapOriginal } from "../maps/workspace/mapApi";
import { editGeometry } from "../maps/workspace/editDocument";
import { useMapNavigationGuard } from "../maps/workspace/useMapNavigationGuard";
import { WorkspaceCanvas } from "../maps/workspace/WorkspaceCanvas";
import { WorkspaceProperties } from "../maps/workspace/WorkspaceProperties";
import { ArtProperties } from "../maps/workspace/ArtProperties";
import { CatalogPanel } from "../maps/workspace/CatalogPanel";
import { LayersPanel } from "../maps/workspace/LayersPanel";
import { layerName, NEW_LAYERS, type NewLayerKind } from "../maps/workspace/layerNames";
import { ToolSettings, type BrushSettings } from "../maps/workspace/ToolSettings";
import { WorkspaceHeader, WorkspaceStatus, WorkspaceToolRail, type GridLook, type WaterTune } from "../maps/workspace/WorkspaceChrome";
import { createWorkspaceRenderModel } from "../maps/workspace/renderV6";
import { toolLayerKind, addLabel, quantize, removeSelection, type WorkspaceTool, type WorkspaceSelection } from "../maps/workspace/editorCommands";
import { downloadMapPicture } from "../maps/workspace/pictureExport";
import { CATALOG_TOOLS, toolLabel } from "../maps/workspace/toolSets";
import { updateGameplayEntity } from "../maps/core";
import { setMapObjectSign } from "../maps/core/mutations/mapObjects";
import { mapKind } from "../maps/mapTypes";
import { MAP_VERSION_HEADER } from "@shared/maps/core";
import { connectedPacks, usedPacks } from "../maps/assets/packs";
import { freshLiquids, packLiquidRecipe, packLiquids, registerOwnPacks, type OwnPack } from "../maps/assets/ownPacks";
import { useWorkspaceDocument } from "../maps/workspace/useWorkspaceDocument";
import { useWorkspaceGestures, type Gesture } from "../maps/workspace/useWorkspaceGestures";
import { removeSelections } from "../maps/workspace/multiSelection";
import { paintCellShapes, selectedRoomShapes } from "../maps/workspace/cellPainting";
import { useWindowKeys } from "../maps/workspace/useWindowKeys";
import { useMapCamera } from "../maps/editor/hooks/useMapCamera";
import { createTerrainMaskLayer, createPathLayer, createScatterLayer, createTerrainLayer, createGameplayLayer, createLabelLayer, createObjectLayer, moveLayer } from "../maps/core/mutations/layers";
import { SCATTER_PROFILES } from "../maps/scatter";
import { MAP_SYMBOL_ASSETS } from "../maps/assets/registry";
import { buildMasterSoyMapV3 } from "../maps/core/exchangeV3";
import { useMapWorkspace } from "../maps/workspace/workspaceContext";
import { useTokenPlacement } from "../maps/workspace/useTokenPlacement";
import { useTokenPresentations } from "../maps/workspace/useTokenPresentations";
import { parsePlacementPayload, tokenSourceKey, tokenTarget, type PlacementSource } from "../maps/workspace/tokenPlacement";
import { DungeonGenerator } from "../maps/workspace/DungeonGenerator";
import { defaultMapEffects, loadMapEffects, saveMapEffects, type EffectState, type MapEffect } from "../maps/gl/effects";
import { replaceWithDungeon, type DungeonSettings } from "../maps/workspace/dungeonGeneration";
import { LiquidSlots } from "../maps/workspace/LiquidSlots";
import { LIQUID_LAYER, isLiquidLayer, moveLiquidsToLayer, replaceLiquid, usedLiquids } from "../maps/workspace/liquids";
import "../maps/workspace/workspace-editor.css";

const NO_LIQUIDS: readonly MapLiquidRecipe[] = [];
// Привязки карты шестой версии сервер отдаёт только клиенту, который её понимает.
const BINDING_OPTIONS = { headers: { [MAP_VERSION_HEADER]: "6" } };
const NO_OWN_PACKS: readonly OwnPack[] = [];
const SAVE_STATE = { saved: "Сохранено", dirty: "Есть правки", saving: "Сохраняем…", error: "Ошибка сохранения", conflict: "Карта изменена в другом окне" } as const;
const LAYER_CREATORS = { mask: createTerrainMaskLayer, path: createPathLayer, scatter: createScatterLayer, terrain: createTerrainLayer,
  gameplay: createGameplayLayer, label: createLabelLayer, object: createObjectLayer };

export function MapWorkspacePage() {
  const { id } = useParams(), mapId = Number(id);
  const { user } = useCurrentUser();
  const navigate = useNavigate(), afterWrite = useAfterWrite();
  const [leaving, setLeaving] = useState(false), [copying, setCopying] = useState(false);
  // Каким способом «Поверхность» рисовала в последний раз: плавно или по клеткам.
  const surfaceTool = useRef<"surface" | "brush">("surface");
  const [liquidDraft, setLiquidDraft] = useState<MapLiquidRecipe[] | null>(null);
  const [tool, setTool] = useState<WorkspaceTool>("select");
  const [activeLayer, setActiveLayer] = useState("");
  const [selections, setSelections] = useState<WorkspaceSelection[]>([]);
  const selection = selections.length === 1 ? selections[0] : null;
  const setSelection = (entry: WorkspaceSelection | null) => setSelections(entry ? [entry] : []);
  const [gridLineWidth, setGridLineWidth] = useState(1), [gridLineStyle, setGridLineStyle] = useState<"solid" | "dashed">("solid");
  const [gridColor, setGridColor] = useState("#000000"), [gridOpacity, setGridOpacity] = useState(0.35);
  // Привязка к сетке: пока не трогали — по виду карты; на обзорной знаки и подписи ставятся свободно (М14).
  const [showGrid, setShowGrid] = useState(true), [snapChoice, setSnap] = useState<boolean | null>(null);
  // Новая отрисовка (плитки + WebGL) — по выбору, пока не проверена на всех картах.
  const [gl, setGl] = useState(() => { try { return localStorage.getItem("soyman.mapRenderer") === "gl"; } catch { return false; } });
  const onGl = useEvent((value: boolean) => { setGl(value); try { if (value) localStorage.setItem("soyman.mapRenderer", "gl"); else localStorage.removeItem("soyman.mapRenderer"); } catch { /* выбор живёт до перезагрузки */ } });
  const onGlFail = useEvent(() => setGl(false));
  const [effects, setEffects] = useState(loadMapEffects);
  const onEffect = useEvent((name: MapEffect, state: EffectState) => { const next = { ...effects, [name]: state }; setEffects(next); saveMapEffects(next); });
  const onEffectsReset = useEvent(() => { const next = defaultMapEffects(); setEffects(next); saveMapEffects(next); });
  const [settings, setSettings] = useState<BrushSettings>({ material: "stone", liquid: "village-water-2", symbol: MAP_SYMBOL_ASSETS[0].id, orientation: 0, radius: 2, lineWidth: 0.3,
    scatterProfile: SCATTER_PROFILES[2].key, density: 0.8, scatterSize: 1, scatterSeed: 1742 });
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const generationBusy = useRef(false);
  const [label, setLabel] = useState<{ position: Vec2; layerId: string; text: string } | null>(null);
  const [entityPreview, setEntityPreview] = useState<PlacementSource | null>(null);
  // Комната или квартал, которые ждут локацию: следующая локация из поиска или мешка не ставится фишкой, а привязывается.
  const [linking, setLinking] = useState<WorkspaceSelection | null>(null);
  const [dragGhost, setDragGhost] = useState<Vec2 | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null), wrapRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null), space = useRef(false), layerStroke = useRef(false);
  const workspace = useMapWorkspace();
  const [confirmDialog, confirm] = useConfirm();

  const doc = useWorkspaceDocument({ mapId, isGm: user?.role === "gm", leaving,
    isEditing: () => !!gesture.current && gesture.current.type !== "pan",
    onReset: () => { gesture.current = null; setSelection(null); setLabel(null); setEntityPreview(null); setDragGhost(null); setGeneratorOpen(false); },
    onLoaded: (record, loaded) => {
      const surface = loaded.layers.find((layer) => layer.kind === "terrain" && layer.representation === "cells" && layer.visible && !layer.locked)
        ?? loaded.layers.find((layer) => layer.kind === "terrain" && layer.visible && !layer.locked && !isLiquidLayer(layer));
      const preferred: WorkspaceTool = surface?.kind === "terrain" && surface.representation === "mask" ? "surface" : "brush";
      surfaceTool.current = preferred; setActiveLayer(surface?.id ?? ""); setTool(preferred);
    } });
  const { map, document, documentRef, setDocument, history, autosave, commit, showError, disabled } = doc;
  const snap = snapChoice ?? (map ? mapKind(map.scale) !== "overview" : true);
  const camera = useMapCamera({ mapId: map?.id ?? null, geom: map, wrapRef, canvasRef, frame: document?.appearance?.frame });
  const displays = useTokenPresentations(mapId, document);
  const renderWarning = useMemo(() => !!document && createWorkspaceRenderModel(document).diagnostics.length > 0, [document]);
  const canPlace = !!document && !disabled && !leaving && !label && !generatorOpen && !autosave.blocked && autosave.status.kind !== "conflict";
  const placement = useTokenPlacement({ mapId, enabled: canPlace, getDocument: () => documentRef.current, activeLayer, snap,
    center: () => { const rect = wrapRef.current?.getBoundingClientRect(); return { x: ((rect?.width ?? 0) / 2 - camera.camRef.current.ox) / camera.camRef.current.scale,
      y: ((rect?.height ?? 0) / 2 - camera.camRef.current.oy) / camera.camRef.current.scale }; },
    commit, onPlaced: (tokenId, layerId) => { setTool("select"); setActiveLayer(layerId); setSelection({ id: tokenId, layerId, kind: "token" }); }, onError: showError });
  // «Жидкость» — та же плавная кисть, что у поверхности, только в слой жидкостей и своим материалом.
  const liquidMaterial = settings.liquid ?? "village-water-2";
  const paintSettings = useMemo(() => tool === "liquid" ? { ...settings, material: liquidMaterial } : settings, [tool, settings, liquidMaterial]);
  const gestures = useWorkspaceGestures({ doc, gesture, space, camera, tool: tool === "liquid" ? "surface" : tool, activeLayer, setActiveLayer, snap, settings: paintSettings, selection, setSelection, selections, setSelections, placement,
    busy: leaving || !!label || generatorOpen, quarter: map && mapKind(map.scale) !== "tactical" ? toolLabel(mapKind(map.scale), "shape") : undefined, onLabel: (position, layerId) => setLabel({ position, layerId, text: "" }) });
  const { finishGesture } = gestures;
  const placementActions = useRef({ place: (_source: PlacementSource) => {}, preview: (_source: PlacementSource) => {} });
  async function linkLocation(target: WorkspaceSelection, source: PlacementSource) {
    setLinking(null);
    try {
      if (source.type !== "location") throw new Error("Привязать можно только локацию");
      const found = await mapWorkspaceApi.resolveSource(mapId, "location", source.id);
      // Название по умолчанию берётся из локации; своё название не затирается.
      if (target.kind === "object") commit((before) => {
        // Знак «Мира» (М13): без своего названия берёт название локации.
        const sign = before.layers.flatMap((layer) => layer.kind === "object" ? layer.items : []).find((item) => item.id === target.id);
        return editGeometry(before, (view) => setMapObjectSign(view, target.id, { location: found.sourceRef.uid, ...(sign?.properties?.name ? {} : { name: found.name.slice(0, 200) }) }));
      });
      else commit((before) => editGeometry(before, (view) => updateGameplayEntity(view, target.id, (entity) => entity.kind !== "room" ? entity
        : { ...entity, location: found.sourceRef.uid, name: !entity.name || /^Квартал \d+$/.test(entity.name) ? found.name.slice(0, 200) : entity.name })));
    } catch (error) { showError(error); }
  }
  placementActions.current = { place: (source) => { finishGesture(); setEntityPreview(null); if (linking) { void linkLocation(linking, source); return; } void placement.begin(source); canvasRef.current?.focus(); },
    preview: (source) => { finishGesture(); placement.cancel(); setEntityPreview(source); } };
  const registerPlacement = workspace?.setPlacement;
  useEffect(() => {
    if (!canPlace || !registerPlacement) return;
    registerPlacement({ place: (source) => placementActions.current.place(source), preview: (source) => placementActions.current.preview(source) });
    return () => registerPlacement(null);
  }, [canPlace, mapId, registerPlacement]);

  async function leave() {
    if (generationBusy.current) { doc.setActionError("Дождитесь создания подземелья"); return false; }
    placement.cancel(); finishGesture(); setLeaving(true); doc.setActionError(null);
    try {
      const saved = await autosave.flush();
      if (!saved) doc.setActionError("Не удалось сохранить карту. Ваши правки остаются здесь; повторите сохранение или скачайте копию.");
      return saved;
    } finally { setLeaving(false); }
  }
  useMapNavigationGuard(() => generationBusy.current || !!gesture.current || autosave.hasPendingChanges(), leave);

  function chooseTool(next: WorkspaceTool, fromRail = false) {
    // «Поверхность» на панели — оба способа рисования: открывается тот, каким рисовали в последний раз.
    if (next === "surface" && fromRail) next = surfaceTool.current;
    if (next === "surface" || next === "brush") surfaceTool.current = next;
    placement.cancel(); finishGesture(); setTool(next); doc.setActionError(null);
    if (next === "asset") setSelection(null);
    const current = documentRef.current;
    if (!current || next === "select") return;
    const kind = toolLayerKind(next), matches = (entry: MapDocumentV6["layers"][number]) => entry.kind === kind &&
      (next !== "wall" || entry.name === "Стены") &&
      (entry.kind !== "terrain" || next === "eraser" || (next === "liquid" ? isLiquidLayer(entry)
        : entry.representation === (next === "surface" ? "mask" : "cells") && !isLiquidLayer(entry)));
    if (next === "liquid") {
      if (current.grid?.type !== "square") { doc.setActionError("Жидкости пока доступны для квадратной сетки"); return; }
      // Слой жидкостей заводится сам, и в него переезжает вода, накрашенная раньше кистью поверхности.
      const layerId = current.layers.find(isLiquidLayer)?.id ?? crypto.randomUUID();
      commit((before) => editGeometry(before, (view) => {
        let base = view;
        if (!view.layers.some((entry) => entry.id === layerId)) {
          const created = createTerrainMaskLayer(view, { id: layerId, name: LIQUID_LAYER });
          const placed = created.ok ? moveLayer(created.document, layerId, view.layers.findLastIndex((entry) => entry.kind === "terrain") + 1) : created;
          if (!placed.ok) return placed;
          base = placed.document;
        }
        const moved = moveLiquidsToLayer(base, layerId, () => crypto.randomUUID());
        return moved.ok && !moved.changed && base !== view ? { ok: true, changed: true, document: base } : moved;
      }));
      setActiveLayer(layerId); return;
    }
    const layer = current.layers.find((entry) => entry.id === activeLayer);
    if (layer && matches(layer)) return;
    const matching = [...current.layers].reverse().filter(matches);
    const target = matching.find((entry) => entry.visible && !entry.locked) ?? matching[0];
    if (target) setActiveLayer(target.id);
    else if (next === "surface" || next === "road" || next === "river" || next === "scatter") {
      if (next === "surface" && current.grid?.type !== "square") { doc.setActionError("Плавные поверхности пока доступны для квадратной сетки"); return; }
      addLayer(next === "surface" ? "mask" : next === "scatter" ? "scatter" : "path");
    } else if (next === "wall") addLayer("path", "Стены");
    else if (next === "asset") addLayer("object");
    else if (next === "brush") addLayer("terrain");
    else setActiveLayer("");
  }
  function addLayer(kind: NewLayerKind, name = NEW_LAYERS[kind]) {
    finishGesture(); const layerId = crypto.randomUUID();
    commit((before) => editGeometry(before, (view) => {
      const result = LAYER_CREATORS[kind](view, { id: layerId, name });
      if (!result.ok || kind !== "mask") return result;
      // Новая поверхность ложится под слой жидкостей: земля поверх воды её бы закрыла.
      const lastTerrain = view.layers.findLastIndex((layer) => layer.kind === "terrain" && !isLiquidLayer(layer));
      return moveLayer(result.document, layerId, lastTerrain + 1);
    }));
    setActiveLayer(layerId);
  }
  /** Continuous layer edits (opacity drag) as one history step. */
  function liveEdit(operation: (before: MapDocumentV6) => MapDocumentV6) {
    const before = documentRef.current;
    if (!before || doc.writeBlocked || leaving) return;
    try {
      const next = operation(before);
      if (next === before) return;
      if (!layerStroke.current) { finishGesture(); history.beginStroke(); layerStroke.current = true; }
      setDocument(next); history.markStrokeChanged();
    } catch (error) { showError(error); }
  }
  function settleEdit() {
    if (!layerStroke.current) return;
    layerStroke.current = false; history.commitStroke(); autosave.schedule();
  }
  function remove(target: WorkspaceSelection) { finishGesture(); commit((before) => removeSelection(before, target)); setSelection(null); }
  function paintRooms(clear: boolean) {
    finishGesture(); commit(before => paintCellShapes(before, activeLayer, selectedRoomShapes(before, selections), clear ? null : settings.material));
  }

  useWindowKeys({
    down: (event) => {
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.code === "Space") { event.preventDefault(); space.current = true; }
      if (event.key === "Escape") { placement.cancel(); setDragGhost(null); finishGesture(true); setSelection(null); }
      if (disabled || leaving || autosave.status.kind === "conflict") return;
      if (event.key === "Enter" && gestures.wallDraft) { event.preventDefault(); gestures.finishWall(); return; }
      if (placement.pending && ["Enter", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        if (event.key === "Enter") placement.confirm();
        else placement.nudge(event.key === "ArrowLeft" ? -1 : event.key === "ArrowRight" ? 1 : 0, event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : 0);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") { event.preventDefault(); finishGesture(); void autosave.flush(); }
      if ((event.ctrlKey || event.metaKey) && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
        event.preventDefault(); placement.cancel(); finishGesture(); if (event.shiftKey || event.key.toLowerCase() === "y") history.redo(); else history.undo();
      }
      if ((event.key === "Delete" || event.key === "Backspace") && selections.length) {
        event.preventDefault(); finishGesture(); commit(before => removeSelections(before, selections)); setSelections([]);
      }
    },
    up: (event) => { if (event.code === "Space") space.current = false; },
    blur: () => { space.current = false; finishGesture(true); },
  });

  function backup() {
    if (!map || !documentRef.current) return;
    const envelope = buildMasterSoyMapV3({ name: map.name, scale: map.scale, cellLore: map.cell_lore }, documentRef.current, doc.params);
    downloadMapJson(JSON.stringify(envelope, null, 2), `map-${map.id}-my-changes.json`);
  }
  function dragOver(event: DragEvent<HTMLCanvasElement>) {
    if (!canPlace || gesture.current || !event.dataTransfer.types.includes(SEARCH_DRAG_MIME)) return;
    try { if (documentRef.current) tokenTarget(documentRef.current, activeLayer); else return; } catch { event.dataTransfer.dropEffect = "none"; return; }
    event.preventDefault(); event.dataTransfer.dropEffect = "link";
    const point = camera.toWorld(event);
    if (documentRef.current) setDragGhost(quantize(documentRef.current, { x: point.wx, y: point.wy }, snap));
  }
  function drop(event: DragEvent<HTMLCanvasElement>) {
    event.preventDefault(); setDragGhost(null);
    if (!canPlace || gesture.current) return;
    const source = parsePlacementPayload(event.dataTransfer.getData(SEARCH_DRAG_MIME));
    if (!source) { doc.setActionError("На карту можно перенести локацию, существо сеттинга или существо из бестиария"); return; }
    const point = camera.toWorld(event); void placement.begin(source, { x: point.wx, y: point.wy });
  }
  async function privateCopy() {
    if (!map || !document) return;
    setCopying(true);
    try { const created = await mapWorkspaceApi.createPrivateCopy(map, document); afterWrite([{ kind: "map", card: true }]); navigate(`/maps/${created.id}/workspace`); }
    catch (error) { showError(error); } finally { setCopying(false); }
  }
  async function applyDungeon(generated: MapDocumentV6, dungeon: DungeonSettings, target: "new" | "replace", name: string) {
    if ((target === "replace" && disabled) || leaving || autosave.blocked || autosave.status.kind === "conflict") throw new Error("Сначала устраните проблему сохранения карты");
    if (target === "replace") {
      const before = documentRef.current;
      if (!before) throw new Error("Карта уже закрыта");
      const next = replaceWithDungeon(before, generated);
      history.push(before); setDocument(next); setSelection(null); setActiveLayer(next.layers.find((layer) => layer.kind === "terrain")!.id);
      setTool("select"); doc.setActionError(null); return;
    }
    generationBusy.current = true;
    try {
      if (!await autosave.flush()) throw new Error("Текущая карта не сохранилась. Повторите сохранение перед созданием новой");
      const created = await mapWorkspaceApi.createDungeon(name, generated, dungeon.seed);
      afterWrite([{ kind: "map", id: created.id, card: true }]);
      generationBusy.current = false;
      navigate(`/maps/${created.id}/workspace`);
    } finally { generationBusy.current = false; }
  }

  // Стабильные ссылки для частей под memo: страница рендерится на каждое
  // движение мыши и камеры, и новый обработчик в пропсах отменял бы пропуск.
  const onChooseTool = useEvent((next: WorkspaceTool) => chooseTool(next, true)), onSurfaceTool = useEvent((next: "surface" | "brush") => chooseTool(next));
  const onUndo = useEvent(() => { finishGesture(); history.undo(); }), onRedo = useEvent(() => { finishGesture(); history.redo(); });
  const grid = useMemo<GridLook>(() => ({ opacity: gridOpacity, lineWidth: gridLineWidth, lineStyle: gridLineStyle, color: gridColor }), [gridOpacity, gridLineWidth, gridLineStyle, gridColor]);
  const onGrid = useEvent((patch: Partial<GridLook>) => {
    if (patch.opacity !== undefined) setGridOpacity(patch.opacity);
    if (patch.lineWidth !== undefined) setGridLineWidth(patch.lineWidth);
    if (patch.lineStyle !== undefined) setGridLineStyle(patch.lineStyle);
    if (patch.color !== undefined) setGridColor(patch.color);
  });
  const onStyle = useEvent((style: MapDrawingStyle) => commit((before) => ({ ...before, appearance: { ...before.appearance, style } })));
  const onWater = useEvent((water: MapWaterLook | undefined) => commit((before) => { const { water: _old, ...rest } = before.appearance ?? { style: "paper-ink" as const }; return { ...before, appearance: water === undefined ? rest : { ...rest, water } }; }));
  const storedPacks = document?.appearance?.packs, scale = map?.scale;
  // Свои наборы Мастера: их картинки заводятся в реестр до того, как каталог и карта спросят о них.
  const ownPacks = useResource<OwnPack[]>("/map-packs").data ?? NO_OWN_PACKS;
  const packs = useMemo(() => { registerOwnPacks(ownPacks); return connectedPacks(storedPacks, mapKind(scale ?? "locality")); }, [storedPacks, scale, ownPacks]);
  // Считается после `packs`: там свои наборы уже заведены, и картинка знает свой набор.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const used = useMemo(() => document ? usedPacks(document).join("|") : "", [document, packs, ownPacks]);
  const onPacks = useEvent((next: string[]) => commit((before) => ({ ...before, appearance: { ...(before.appearance ?? { style: "paper-ink" as const }), packs: next } })));
  // Жидкости из наборов — ссылки (В12): правка набора подтягивается в карту без шага истории, снимок уходит с сохранением.
  // Отмена может вернуть старый снимок — он тут же подтянется снова.
  const writable = !disabled && !leaving;
  useEffect(() => {
    const own = document?.appearance?.liquids;
    if (!document || !own || !writable) return;
    const fresh = freshLiquids(own);
    if (fresh === own) return;
    setDocument({ ...document, appearance: { ...document.appearance!, liquids: [...fresh] } }); autosave.schedule();
  }, [document, packs, writable, setDocument, autosave]);
  const offeredLiquids = useMemo(() => packLiquids(packs), [packs]);
  // Куда сохранить свою жидкость: свои наборы, подключённые к карте — первыми.
  const saveTargets = useMemo(() => ownPacks.filter((pack) => !pack.archived).sort((a, b) => Number(packs.includes(b.uid)) - Number(packs.includes(a.uid))), [ownPacks, packs]);
  const run = useAction();
  // «Сохранить в набор» (В15): рецепт уходит в набор, слот того же ключа становится ссылкой — накрашенное не меняется.
  // Набор подключается к карте, если у неё свой список.
  const onSaveLiquid = useEvent(async (key: string, pack: OwnPack, name: string) => {
    const recipe = documentRef.current?.appearance?.liquids?.find((item) => item.key === key);
    if (!recipe) return false;
    const { key: _key, name: _name, ref: _ref, ...fields } = recipe;
    const saved = await run(labelled("Жидкость не сохранена в набор", () => write.post<{ pack: OwnPack; uid: string }>(`/map-packs/${pack.id}/liquids`, { name, ...fields })), { affects: [{ path: "/map-packs" }] });
    const item = saved?.pack.items.find((entry) => entry.uid === saved.uid);
    if (!item) return false;
    commit((before) => {
      const appearance = before.appearance ?? { style: "paper-ink" as const }, stored = appearance.packs;
      return { ...before, appearance: { ...appearance, liquids: (appearance.liquids ?? []).map((entry) => entry.key === key ? packLiquidRecipe(item, key) : entry),
        ...(stored && !stored.includes(pack.uid) ? { packs: [...stored, pack.uid] } : {}) } };
    });
    return true;
  });
  // Наборы, отмеченные при создании карты, приходят с переходом и записываются один раз.
  const location = useLocation(), chosenPacks = (location.state as { packs?: string[] } | null)?.packs, loaded = !!document;
  useEffect(() => {
    if (!chosenPacks || !loaded) return;
    if (!documentRef.current?.appearance?.packs) onPacks(chosenPacks);
    navigate(location.pathname, { replace: true, state: null });
  }, [chosenPacks, loaded, documentRef, onPacks, navigate, location.pathname]);
  // Жанры сеттингов, к которым привязана карта: по ним библиотека каталога подбирает наборы.
  const bindings = useResource<{ target_type: string; target_id: number }[]>(Number.isFinite(mapId) ? `/maps/${mapId}/bindings` : null, BINDING_OPTIONS).data;
  const boundSettings = useMemo(() => (bindings ?? []).filter((entry) => entry.target_type === "setting").map((entry) => entry.target_id), [bindings]);
  const settingList = useResource<Setting[]>(boundSettings.length ? "/settings" : null).data;
  const genres = useMemo((): SettingGenre[] => (settingList ?? []).filter((entry) => boundSettings.includes(entry.id)).flatMap((entry) => entry.genres ?? []), [settingList, boundSettings]);
  const onLiveWater = useEvent(() => onWater(documentRef.current?.appearance?.style === "comic-punk" ? "comic" : "soft"));
  const onWaterTune = useEvent((patch: WaterTune) => commit((before) => ({ ...before, appearance: { ...(before.appearance ?? { style: "paper-ink" as const }), ...patch } })));
  const onFrame = useEvent((frame: number | undefined) => commit((before) => { const { frame: _old, ...rest } = before.appearance ?? { style: "paper-ink" as const }; return { ...before, appearance: frame === undefined ? rest : { ...rest, frame } }; }));
  const onGenerator = useEvent(() => { finishGesture(); placement.cancel(); setSelection(null); setGeneratorOpen(true); });
  const onSave = useEvent(() => { finishGesture(); void autosave.flush(); }), onBackup = useEvent(backup);
  const onPicture = useEvent(() => { finishGesture(); if (map && documentRef.current) void downloadMapPicture(map, documentRef.current, displays, { showGrid, gridColor, gridOpacity, gridLineWidth, gridLineStyle }).catch(showError); });
  const onSymbol = useEvent((symbol: string) => { setSettings((current) => ({ ...current, symbol })); canvasRef.current?.focus(); });
  const onLiquid = useEvent((liquid: string) => { finishGesture(); setSettings((current) => ({ ...current, liquid })); canvasRef.current?.focus(); });
  const onOwnLiquids = useEvent((liquids: MapLiquidRecipe[], live: boolean) => {
    const apply = (before: MapDocumentV6): MapDocumentV6 => ({ ...before, appearance: { ...(before.appearance ?? { style: "paper-ink" as const }), liquids } });
    // Правка на ходу идёт мимо карты: с живой водой меняется только таблица рецептов, без неё заливка обновится,
    // когда отпустят. Карта меняется один раз — иначе каждый шаг выбора цвета перерисовывает все плитки.
    if (live) { setLiquidDraft(liquids); return; }
    setLiquidDraft(null);
    if (live) liveEdit(apply); else commit(apply);
  });
  const onSettleLiquid = useEvent(() => {
    if (!liquidDraft) { settleEdit(); return; }
    const liquids = liquidDraft; setLiquidDraft(null);
    commit((before) => ({ ...before, appearance: { ...(before.appearance ?? { style: "paper-ink" as const }), liquids } }));
  });
  // Освободить слот: жидкость стирается с карты или заменяется другой, свой рецепт удаляется.
  const onReleaseLiquid = useEvent((key: string, to: string | null) => commit((before) => {
    const next = editGeometry(before, (view) => replaceLiquid(view, key, to)), own = before.appearance?.liquids;
    return own?.some((item) => item.key === key) ? { ...next, appearance: { ...before.appearance!, liquids: own.filter((item) => item.key !== key) } } : next;
  }));
  const liquidLayers = document?.layers, liquids = useMemo(() => liquidLayers ? usedLiquids(liquidLayers) : [], [liquidLayers]);
  // Карта с комнатами — подземелье: в каталоге первым идёт «Склеп».
  const hasRooms = useMemo(() => !!liquidLayers?.some((layer) => layer.kind === "gameplay" && layer.items.some((item) => item.kind === "room")), [liquidLayers]);
  const onMaterial = useEvent((material: string) => { finishGesture(); setSettings((current) => ({ ...current, material })); canvasRef.current?.focus(); });
  // Полоса дороги приходит со своей шириной: рисунок рассчитан на неё, ползунок потом меняет.
  const onLine = useEvent((style: string, width: number) => { finishGesture(); setSettings((current) => ({ ...current,
    ...(tool === "wall" ? { wallStyle: style, wallWidth: width } : tool === "river" ? { riverStyle: style, lineWidth: width } : { roadStyle: style, lineWidth: width }) })); canvasRef.current?.focus(); });
  const onDoor = useEvent((door: BrushSettings["door"]) => { finishGesture(); setSettings((current) => ({ ...current, door })); canvasRef.current?.focus(); });
  const onScatter = useEvent((scatterProfile: string, density?: number) => { finishGesture(); setSettings((current) => ({ ...current, scatterProfile, ...(density ? { density } : {}) })); canvasRef.current?.focus(); });
  const onToolChange = useEvent((patch: Partial<BrushSettings>) => { if (gesture.current?.type !== "wall-line" || patch.wallWidth === undefined && patch.lineWidth === undefined) finishGesture(); setSettings((current) => ({ ...current, ...patch })); });
  const onPaintRooms = useEvent(() => paintRooms(false)), onClearRooms = useEvent(() => paintRooms(true));
  const onActivateLayer = useEvent((layerId: string) => { finishGesture(); setActiveLayer(layerId); });
  const onCommit = useEvent(commit), onLiveEdit = useEvent(liveEdit), onSettleEdit = useEvent(settleEdit), onAddLayer = useEvent(addLayer), onConfirm = useEvent(confirm);
  const onSnap = useEvent((value: boolean) => { finishGesture(); setSnap(value); });

  if (user?.role === "player") return <p>Новый редактор доступен мастеру.</p>;
  if (doc.loadError) return <div className="workspace-editor-message"><p role="alert">{doc.loadError}</p>{doc.actionError && <p role="alert">{doc.actionError}</p>}<button onClick={() => void downloadStoredMapOriginal(mapId).catch(showError)}>Скачать исходный документ</button><Link to="/maps">Мои карты</Link></div>;
  if (!map || !document) return <p className="workspace-editor-message">Загрузка карты…</p>;

  const active = document.layers.find((layer) => layer.id === activeLayer);
  const maskEraser = tool === "eraser" && active?.kind === "terrain" && active.representation === "mask";
  const saveBlocked = disabled || leaving || autosave.status.kind === "conflict";
  const toolsLocked = disabled || leaving || generatorOpen;
  const selectedToken = (() => {
    if (!selection) return null;
    const layer = document.layers.find((entry) => entry.id === selection.layerId);
    const token = layer?.kind === "gameplay" ? layer.items.find((item) => item.id === selection.id) : null;
    if (token?.kind === "room" && token.location) return displays.get(tokenSourceKey({ kind: "location", uid: token.location }));
    const sign = layer?.kind === "object" ? layer.items.find((item) => item.id === selection.id)?.properties?.location : null;
    if (typeof sign === "string") return displays.get(tokenSourceKey({ kind: "location", uid: sign }));
    return token?.kind === "token" && token.sourceRef ? displays.get(tokenSourceKey(token.sourceRef)) : undefined;
  })();
  const notice = doc.actionError || doc.compatibilityError || (doc.publishedOldMap ? "Эта карта доступна игрокам. Пока готовится новый показ, редактируйте скрытую копию — текущий показ сохранится."
    : autosave.status.kind === "conflict" ? "Карта изменена в другом окне. Сохранение остановлено; скачайте свои правки перед повторным открытием."
      : autosave.status.kind === "error" ? "Не удалось сохранить карту. Правки остаются в редакторе." : null);

  return <div className="workspace-editor" aria-busy={leaving} data-catalog={CATALOG_TOOLS.includes(tool) || undefined}>
    <WorkspaceToolRail kind={mapKind(map.scale)} tool={tool} locked={toolsLocked} onChoose={onChooseTool} />

    <WorkspaceHeader mapName={map.name} status={`${leaving ? "Сохраняем перед выходом…" : SAVE_STATE[autosave.status.kind]}${document.grid ? ` · ${document.grid.columns} × ${document.grid.rows} клеток` : ""}`}
      canUndo={history.canUndo && !disabled && !leaving} canRedo={history.canRedo && !disabled && !leaving} onUndo={onUndo} onRedo={onRedo}
      grid={grid} onGrid={onGrid} style={document.appearance?.style ?? "paper-ink"} onStyle={onStyle} styleLocked={disabled || leaving} frame={document.appearance?.frame} onFrame={onFrame} water={document.appearance?.water} onWater={onWater} waterSpeed={document.appearance?.waterSpeed ?? 1} waterPixels={document.appearance?.waterPixels ?? 8} waterShoal={document.appearance?.waterShoal ?? 0} waves={document.appearance?.waves ?? "arcs"} waveDensity={document.appearance?.waveDensity ?? 0} onWaterTune={onWaterTune}
      generatorLocked={leaving || !!doc.compatibilityError || autosave.blocked || autosave.status.kind === "conflict"} saveLocked={saveBlocked}
      onGenerator={onGenerator} onSave={onSave} onBackup={onBackup} onPicture={onPicture} gl={gl} onGl={onGl} effects={effects} onEffect={onEffect} onEffectsReset={onEffectsReset} classicLink={map.document_version !== 6 ? `/maps/${map.id}` : null} />

    <div className="workspace-editor-body">
      {CATALOG_TOOLS.includes(tool) && <CatalogPanel tool={tool} local={!hasRooms} kind={mapKind(map.scale)} packs={packs} onPacks={onPacks} ownPacks={ownPacks} used={used} genres={genres} comicPunk={document.appearance?.style === "comic-punk"} symbol={settings.symbol} material={settings.material} scatterProfile={settings.scatterProfile} lineStyle={(tool === "wall" ? settings.wallStyle : tool === "river" ? settings.riverStyle : settings.roadStyle) ?? ""}
        onSymbol={onSymbol} onMaterial={onMaterial} onScatter={onScatter} onLine={onLine} doorStyle={settings.door?.style ?? ""} onDoor={onDoor} />}

      <div className="workspace-editor-stage" ref={wrapRef}>
        <WorkspaceCanvas gl={gl} liquidDraft={liquidDraft} onGlFail={onGlFail} effects={effects} map={map} document={document} camera={camera.cam} canvasRef={canvasRef} wrapRef={wrapRef} showGrid={showGrid} gridColor={gridColor} gridOpacity={gridOpacity} gridLineWidth={gridLineWidth} gridLineStyle={gridLineStyle} selectedId={selection?.id ?? null} selectedNodes={gestures.selectedNodes} preview={gestures.preview}
          cellBrush={gestures.cellBrush} wallDraft={gestures.wallDraft} onDoubleClick={() => gestures.finishWall()} selections={selections} marquee={gestures.marquee} assetPreview={gestures.assetPreview} draftLine={gestures.draftLine} brush={gestures.brushCursor && (tool === "surface" || tool === "liquid" || tool === "scatter" || maskEraser) ? { ...gestures.brushCursor, radius: settings.radius } : null}
          onPointerLeave={gestures.leave} displays={displays} ghost={placement.pending?.position ?? dragGhost} onDragOver={dragOver} onDragLeave={() => setDragGhost(null)} onDrop={drop}
          onPointerDown={gestures.down} onPointerMove={gestures.move} onPointerUp={gestures.up} onPointerCancel={gestures.cancel} />
        <div className="workspace-editor-hint" aria-hidden="true"><strong>{toolLabel(mapKind(map.scale), tool)}{active ? ` · ${layerName(active)}` : ""}</strong>{tool === "select" && <span>{selections.length > 1 ? `Выбрано: ${selections.length} · ` : ""}Рамка · Shift — добавить</span>}{(tool === "asset" || tool === "label") && <span>{snap ? "Shift — свободно" : "Shift — к клетке"}</span>}<span>Пробел — сдвиг</span><span>Esc — отмена</span></div>
        {tool === "liquid" && <LiquidSlots used={liquids} own={liquidDraft ?? document.appearance?.liquids ?? NO_LIQUIDS} material={liquidMaterial} live={!!document.appearance?.water} onLive={onLiveWater} onMaterial={onLiquid} onOwn={onOwnLiquids} onSettle={onSettleLiquid} onRelease={onReleaseLiquid}
          offered={offeredLiquids} packs={saveTargets} onSaveToPack={onSaveLiquid} />}
        <div className="workspace-editor-camera">
          <button type="button" aria-label="Уменьшить" onClick={() => camera.zoomBy(1 / 1.25)}>−</button>
          <button type="button" aria-label="Увеличить" onClick={() => camera.zoomBy(1.25)}>+</button>
          <button type="button" onClick={() => camera.fitCamera(true)}>Вписать</button>
        </div>
        {placement.pending && <div className="workspace-editor-placement" role="status">
          <span>{placement.pending.source ? `${placement.pending.source.name}: выберите точку · стрелки и Enter` : "Загрузка источника…"}</span>
          <button disabled={!placement.pending.source} onClick={() => placement.confirm()}>Поставить здесь</button><button onClick={placement.cancel}>Отмена</button>
        </div>}
        {linking && <div className="workspace-editor-placement" role="status">
          <span>Откройте «Поиск и мешок» и нажмите ＋ у нужной локации</span><button onClick={() => setLinking(null)}>Отмена</button>
        </div>}
        {gestures.wallDraft && <div className="workspace-editor-placement" role="status">
          <span>Клик — точка · Enter — закончить · Esc — отменить</span>
          {gestures.wallDraft.kind !== "quarter" && <button disabled={gestures.wallDraft.pointCount < 2} onClick={() => gestures.finishWall()}>{gestures.wallDraft.kind === "wall" ? "Завершить стену" : "Завершить линию"}</button>}
          <button disabled={!gestures.canCloseWall} onClick={() => gestures.finishWall(true)}>{gestures.wallDraft.kind === "quarter" ? `Замкнуть: ${toolLabel(mapKind(map.scale), "shape").toLocaleLowerCase("ru")}` : "Замкнуть"}</button>
          <button onClick={() => finishGesture(true)}>Отмена</button>
        </div>}
        {notice && <div className="workspace-editor-notice" role="alert">
          <p>{notice}</p>
          {doc.publishedOldMap && <button disabled={copying || !!doc.compatibilityError} onClick={() => void privateCopy()}>Создать скрытую копию</button>}
          {doc.compatibilityError && <button onClick={() => void downloadStoredMapOriginal(map.id).catch(showError)}>Скачать исходный документ</button>}
          {!disabled && autosave.status.kind !== "conflict" && autosave.status.kind === "error" && <button onClick={() => void autosave.flush()}>Повторить сохранение</button>}
          {(autosave.status.kind === "error" || autosave.status.kind === "conflict") && <button onClick={backup}>Скачать мои правки</button>}
          {doc.actionError && <button aria-label="Закрыть сообщение" onClick={() => doc.setActionError(null)}>×</button>}
        </div>}
      </div>

      <aside className="workspace-inspector" aria-label="Инспектор">
        {selection && tool === "select" && !disabled && (selection.kind === "path" || selection.kind === "scatter")
          ? <ArtProperties document={document} selection={selection} packs={packs} pickedAt={gestures.pickedAt} selectedNodes={gestures.selectedNodes} onSelectedNodes={gestures.setSelectedNodes} commit={commit} onClose={() => setSelection(null)} onDelete={() => remove(selection)} />
          : selection && tool === "select" && !disabled
            ? <WorkspaceProperties document={document} selection={selection} commit={commit} onClose={() => setSelection(null)} onDelete={() => remove(selection)} display={selectedToken ?? undefined}
              onLink={canPlace ? () => setLinking(selection) : undefined}
              onPreview={() => { if (selectedToken?.state === "active" && selectedToken.id) setEntityPreview({ type: selectedToken.sourceRef.kind, id: selectedToken.id }); }} />
            : <ToolSettings tool={tool} settings={settings} maskEraser={maskEraser} onTool={onSurfaceTool} label={toolLabel(mapKind(map.scale), tool === "brush" ? "surface" : tool)}
              selectedRoomCount={selectedRoomShapes(document, selections).length} roomActionsDisabled={disabled || leaving || active?.kind !== "terrain" || active.representation !== "cells" || active.locked || !active.visible || autosave.status.kind === "conflict"}
              onPaintRooms={onPaintRooms} onClearRooms={onClearRooms} onChange={onToolChange} />}
        <LayersPanel document={document} activeLayer={activeLayer} disabled={disabled || leaving} onActivate={onActivateLayer}
          commit={onCommit} live={onLiveEdit} settle={onSettleEdit} onAdd={onAddLayer} confirm={onConfirm} />
      </aside>
    </div>

    <WorkspaceStatus cellLore={document.grid ? map.cell_lore || null : null} layers={document.layers} activeLayer={activeLayer} onLayer={onActivateLayer} cursorCell={gestures.cursorCell}
      showGrid={showGrid} onShowGrid={setShowGrid} snap={snap} onSnap={onSnap} renderWarning={renderWarning} />

    <DungeonGenerator key={map.id} open={generatorOpen} current={disabled ? undefined : document} seed={map.seed} disabled={leaving || !!doc.compatibilityError || autosave.blocked || autosave.status.kind === "conflict"}
      onClose={() => setGeneratorOpen(false)} onApply={applyDungeon} />
    {label && <Modal className="workspace-editor-label-dialog workspace-label-form" ariaLabel="Подпись карты" onClose={() => setLabel(null)}><h2>Подпись карты</h2><form onSubmit={(event) => { event.preventDefault(); commit((before) => addLabel(before, label.layerId, crypto.randomUUID(), label.position, label.text.trim())); setLabel(null); }}><label>Текст<input autoFocus placeholder="Например: Старый мост" value={label.text} maxLength={200} onChange={(event) => setLabel({ ...label, text: event.target.value })} /></label><div className="modal-footer"><button type="button" onClick={() => setLabel(null)}>Отмена</button><button className="primary" disabled={!label.text.trim()}>Добавить</button></div></form></Modal>}
    {entityPreview && <Modal className="workspace-editor-label-dialog workspace-editor-entity-dialog" ariaLabel="Карточка источника на карте" returnFocusTo={canvasRef} onClose={() => setEntityPreview(null)}>
      <EntityPreviewContent type={entityPreview.type} id={entityPreview.id} hideProfileButton statblockInline onClose={() => setEntityPreview(null)} />
    </Modal>}
    {confirmDialog}
  </div>;
}
