import { Fragment, useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import type { MapDocumentV6, MapDrawingStyle, Vec2 } from "@shared/maps/core";
import { useCurrentUser } from "../api/currentUser";
import { useAfterWrite } from "../data/hooks";
import { useConfirm } from "../hooks/useConfirm";
import { Modal } from "../components/Modal";
import { EntityPreviewContent } from "../components/EntityPreviewModal";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { MapWorkspaceTools } from "../maps/workspace/MapWorkspace";
import { MapToolIcon } from "../maps/workspace/MapToolIcon";
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
import { WorkspaceMenu } from "../maps/workspace/WorkspaceMenu";
import { createWorkspaceRenderModel } from "../maps/workspace/renderV6";
import { TOOL_LABELS, toolLayerKind, addLabel, quantize, removeSelection, type WorkspaceTool, type WorkspaceSelection } from "../maps/workspace/editorCommands";
import { CATALOG_TOOLS, TOOL_SETS, TOOL_SET_LABELS, initialToolSet, rememberToolSet, toolsOf, type ToolSet } from "../maps/workspace/toolSets";
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
import { replaceWithDungeon, type DungeonSettings } from "../maps/workspace/dungeonGeneration";
import "../maps/workspace/workspace-editor.css";

const SAVE_STATE = { saved: "Сохранено", dirty: "Есть правки", saving: "Сохраняем…", error: "Ошибка сохранения", conflict: "Карта изменена в другом окне" } as const;
const LAYER_CREATORS = { mask: createTerrainMaskLayer, path: createPathLayer, scatter: createScatterLayer, terrain: createTerrainLayer,
  gameplay: createGameplayLayer, label: createLabelLayer, object: createObjectLayer };

export function MapWorkspacePage() {
  const { id } = useParams(), mapId = Number(id);
  const { user } = useCurrentUser();
  const navigate = useNavigate(), afterWrite = useAfterWrite();
  const [leaving, setLeaving] = useState(false), [copying, setCopying] = useState(false);
  const [toolSet, setToolSet] = useState<ToolSet>("dungeon");
  const [tool, setTool] = useState<WorkspaceTool>("select");
  const [activeLayer, setActiveLayer] = useState("");
  const [selections, setSelections] = useState<WorkspaceSelection[]>([]);
  const selection = selections.length === 1 ? selections[0] : null;
  const setSelection = (entry: WorkspaceSelection | null) => setSelections(entry ? [entry] : []);
  const [gridLineWidth, setGridLineWidth] = useState(1), [gridLineStyle, setGridLineStyle] = useState<"solid" | "dashed">("solid");
  const [gridColor, setGridColor] = useState("#000000"), [gridOpacity, setGridOpacity] = useState(0.35);
  const [showGrid, setShowGrid] = useState(true), [snap, setSnap] = useState(true);
  const [settings, setSettings] = useState<BrushSettings>({ material: "stone", symbol: MAP_SYMBOL_ASSETS[0].id, orientation: 0, radius: 2, lineWidth: 0.3,
    scatterProfile: SCATTER_PROFILES[2].key, density: 0.8, scatterSize: 1, scatterSeed: 1742 });
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const generationBusy = useRef(false);
  const [label, setLabel] = useState<{ position: Vec2; layerId: string; text: string } | null>(null);
  const [entityPreview, setEntityPreview] = useState<PlacementSource | null>(null);
  const [dragGhost, setDragGhost] = useState<Vec2 | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null), wrapRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null), space = useRef(false), layerStroke = useRef(false);
  const workspace = useMapWorkspace();
  const [confirmDialog, confirm] = useConfirm();

  const doc = useWorkspaceDocument({ mapId, isGm: user?.role === "gm", leaving,
    isEditing: () => !!gesture.current && gesture.current.type !== "pan",
    onReset: () => { gesture.current = null; setSelection(null); setLabel(null); setEntityPreview(null); setDragGhost(null); setGeneratorOpen(false); },
    onLoaded: (record, loaded) => {
      const set = initialToolSet(record.id, record.scale, loaded);
      const surface = loaded.layers.find((layer) => layer.kind === "terrain" && layer.representation === "cells" && layer.visible && !layer.locked)
        ?? loaded.layers.find((layer) => layer.kind === "terrain" && layer.visible && !layer.locked);
      const preferred: WorkspaceTool = surface?.kind === "terrain" && surface.representation === "mask" ? "surface" : "brush";
      setToolSet(set); setActiveLayer(surface?.id ?? ""); setTool(toolsOf(set).includes(preferred) ? preferred : "select");
    } });
  const { map, document, documentRef, setDocument, history, autosave, commit, showError, disabled } = doc;
  const camera = useMapCamera({ mapId: map?.id ?? null, geom: map, wrapRef, canvasRef });
  const displays = useTokenPresentations(mapId, document);
  const renderWarning = useMemo(() => !!document && createWorkspaceRenderModel(document).diagnostics.length > 0, [document]);
  const canPlace = !!document && !disabled && !leaving && !label && !generatorOpen && !autosave.blocked && autosave.status.kind !== "conflict";
  const placement = useTokenPlacement({ mapId, enabled: canPlace, getDocument: () => documentRef.current, activeLayer, snap,
    center: () => { const rect = wrapRef.current?.getBoundingClientRect(); return { x: ((rect?.width ?? 0) / 2 - camera.camRef.current.ox) / camera.camRef.current.scale,
      y: ((rect?.height ?? 0) / 2 - camera.camRef.current.oy) / camera.camRef.current.scale }; },
    commit, onPlaced: (tokenId, layerId) => { setTool("select"); setActiveLayer(layerId); setSelection({ id: tokenId, layerId, kind: "token" }); }, onError: showError });
  const gestures = useWorkspaceGestures({ doc, gesture, space, camera, tool, activeLayer, setActiveLayer, snap, settings, selection, setSelection, selections, setSelections, placement,
    busy: leaving || !!label || generatorOpen, onLabel: (position, layerId) => setLabel({ position, layerId, text: "" }) });
  const { finishGesture } = gestures;
  const placementActions = useRef({ place: (_source: PlacementSource) => {}, preview: (_source: PlacementSource) => {} });
  placementActions.current = { place: (source) => { finishGesture(); setEntityPreview(null); void placement.begin(source); canvasRef.current?.focus(); },
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

  function chooseTool(next: WorkspaceTool) {
    placement.cancel(); finishGesture(); setTool(next); doc.setActionError(null);
    if (next === "asset") setSelection(null);
    const current = documentRef.current;
    if (!current || next === "select") return;
    const kind = toolLayerKind(next), matches = (entry: MapDocumentV6["layers"][number]) => entry.kind === kind &&
      (next !== "wall" || entry.name === "Стены") &&
      (entry.kind !== "terrain" || next === "eraser" || entry.representation === (next === "surface" ? "mask" : "cells"));
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
    else setActiveLayer("");
  }
  function chooseToolSet(next: ToolSet) {
    setToolSet(next); rememberToolSet(mapId, next);
    if (!toolsOf(next).includes(tool)) chooseTool("select");
  }
  function addLayer(kind: NewLayerKind, name = NEW_LAYERS[kind]) {
    finishGesture(); const layerId = crypto.randomUUID();
    commit((before) => editGeometry(before, (view) => {
      const result = LAYER_CREATORS[kind](view, { id: layerId, name });
      if (!result.ok || kind !== "mask") return result;
      const lastTerrain = view.layers.findLastIndex((layer) => layer.kind === "terrain");
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
    return token?.kind === "token" && token.sourceRef ? displays.get(tokenSourceKey(token.sourceRef)) : undefined;
  })();
  const notice = doc.actionError || doc.compatibilityError || (doc.publishedOldMap ? "Эта карта доступна игрокам. Пока готовится новый показ, редактируйте скрытую копию — текущий показ сохранится."
    : autosave.status.kind === "conflict" ? "Карта изменена в другом окне. Сохранение остановлено; скачайте свои правки перед повторным открытием."
      : autosave.status.kind === "error" ? "Не удалось сохранить карту. Правки остаются в редакторе." : null);

  return <div className="workspace-editor" aria-busy={leaving} data-catalog={CATALOG_TOOLS.includes(tool) || undefined}>
    <MapWorkspaceTools><div className="map-workspace-tool-list" role="toolbar" aria-label="Инструменты нового редактора">
      {TOOL_SETS[toolSet].map((group, index) => <Fragment key={index}>
        {index > 0 && <hr className="map-workspace-tool-sep" />}
        {group.map((name) => <button key={name} title={TOOL_LABELS[name]} aria-label={TOOL_LABELS[name]} aria-pressed={tool === name}
          disabled={toolsLocked} onClick={() => chooseTool(name)}><MapToolIcon tool={name} /><span>{TOOL_LABELS[name]}</span></button>)}
      </Fragment>)}
    </div></MapWorkspaceTools>

    <header className="workspace-editor-header">
      <Link to="/maps" className="workspace-back">← Все карты</Link>
      <div className="workspace-title"><h1 title={map.name}>{map.name}</h1>
        <span aria-live="polite">{leaving ? "Сохраняем перед выходом…" : SAVE_STATE[autosave.status.kind]}{document.grid ? ` · ${document.grid.columns} × ${document.grid.rows} клеток` : ""}</span></div>
      <nav className="workspace-seg" aria-label="Набор инструментов">
        {(Object.keys(TOOL_SET_LABELS) as ToolSet[]).map((set) => <button key={set} type="button" aria-pressed={toolSet === set} onClick={() => chooseToolSet(set)}>{TOOL_SET_LABELS[set]}</button>)}
      </nav>
      <div className="workspace-header-actions">
        <button type="button" className="workspace-icon-button" aria-label="Отменить" title="Отменить · Ctrl+Z" disabled={!history.canUndo || disabled || leaving} onClick={() => { finishGesture(); history.undo(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 4 3 10l6 6M3 10h11c8 0 8 11 0 11" /></svg></button>
        <button type="button" className="workspace-icon-button" aria-label="Повторить" title="Повторить · Ctrl+Y" disabled={!history.canRedo || disabled || leaving} onClick={() => { finishGesture(); history.redo(); }}>
          <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m15 4 6 6-6 6M21 10H10c-8 0-8 11 0 11" /></svg></button>
        <WorkspaceMenu label="СЕТКА ▾" title="Сетка">
          <label>Видимость · {Math.round(gridOpacity * 100)}%<input aria-label="Видимость сетки" type="range" min="0" max="100" value={Math.round(gridOpacity * 100)} onChange={event => setGridOpacity(Number(event.target.value) / 100)} /></label>
          <label>Толщина · {gridLineWidth} px<input aria-label="Толщина линий сетки" type="range" min="0.5" max="4" step="0.5" value={gridLineWidth} onChange={event => setGridLineWidth(Number(event.target.value))} /></label>
          <fieldset><legend>Линии сетки</legend>
            <label><input type="radio" name="grid-line-style" checked={gridLineStyle === "solid"} onChange={() => setGridLineStyle("solid")} />Сплошная</label>
            <label><input type="radio" name="grid-line-style" checked={gridLineStyle === "dashed"} onChange={() => setGridLineStyle("dashed")} />Пунктирная</label>
          </fieldset>
          <fieldset><legend>Цвет сетки</legend>
            {([["#000000", "Чёрная"], ["#ffffff", "Белая"], ["#ff3e91", "Розовая"], ["#ffe14a", "Жёлтая"]] as const).map(([color, name]) => <label key={color}><input type="radio" name="grid-color" checked={gridColor === color} onChange={() => setGridColor(color)} />{name}</label>)}
          </fieldset>
        </WorkspaceMenu>
        <WorkspaceMenu label="Карта ▾" title="Карта" className="workspace-map-menu">
          <fieldset disabled={disabled || leaving}><legend>Оформление</legend>
            {([["comic-punk", "Комикс-панк"], ["paper-ink", "Бумага и тушь"], ["blueprint", "Чертёж"]] as [MapDrawingStyle, string][]).map(([style, name]) => <label key={style}>
              <input type="radio" name="workspace-style" checked={(document.appearance?.style ?? "paper-ink") === style}
                onChange={() => commit((before) => ({ ...before, appearance: { style } }))} />{name}</label>)}
          </fieldset>
          <button type="button" data-close disabled={leaving || !!doc.compatibilityError || autosave.blocked || autosave.status.kind === "conflict"}
            onClick={() => { finishGesture(); placement.cancel(); setSelection(null); setGeneratorOpen(true); }}>Быстрое подземелье…</button>
          <button type="button" data-close disabled={saveBlocked} onClick={() => { finishGesture(); void autosave.flush(); }}>Сохранить сейчас</button>
          <button type="button" data-close onClick={backup}>Скачать копию</button>
          {map.document_version !== 6 && <Link to={`/maps/${map.id}`} data-close>Классический редактор</Link>}
        </WorkspaceMenu>
      </div>
    </header>

    <div className="workspace-editor-body">
      {CATALOG_TOOLS.includes(tool) && <CatalogPanel tool={tool} toolSet={toolSet} comicPunk={document.appearance?.style === "comic-punk"} symbol={settings.symbol} material={settings.material} scatterProfile={settings.scatterProfile}
        onSymbol={(symbol) => { setSettings((current) => ({ ...current, symbol })); canvasRef.current?.focus(); }}
        onMaterial={(material) => { finishGesture(); setSettings((current) => ({ ...current, material })); canvasRef.current?.focus(); }}
        onScatter={(scatterProfile) => { finishGesture(); setSettings((current) => ({ ...current, scatterProfile })); canvasRef.current?.focus(); }} />}

      <div className="workspace-editor-stage" ref={wrapRef}>
        <WorkspaceCanvas map={map} document={document} camera={camera.cam} canvasRef={canvasRef} wrapRef={wrapRef} showGrid={showGrid} gridColor={gridColor} gridOpacity={gridOpacity} gridLineWidth={gridLineWidth} gridLineStyle={gridLineStyle} selectedId={selection?.id ?? null} selectedNodes={gestures.selectedNodes} preview={gestures.preview}
          cellBrush={gestures.cellBrush} wallDraft={gestures.wallDraft} onDoubleClick={() => gestures.finishWall()} selections={selections} marquee={gestures.marquee} assetPreview={gestures.assetPreview} draftLine={gestures.draftLine} brush={gestures.brushCursor && (tool === "surface" || tool === "scatter" || maskEraser) ? { ...gestures.brushCursor, radius: settings.radius } : null}
          onPointerLeave={gestures.leave} displays={displays} ghost={placement.pending?.position ?? dragGhost} onDragOver={dragOver} onDragLeave={() => setDragGhost(null)} onDrop={drop}
          onPointerDown={gestures.down} onPointerMove={gestures.move} onPointerUp={gestures.up} onPointerCancel={gestures.cancel} />
        <div className="workspace-editor-hint" aria-hidden="true"><strong>{TOOL_LABELS[tool]}{active ? ` · ${layerName(active)}` : ""}</strong>{tool === "select" && <span>{selections.length > 1 ? `Выбрано: ${selections.length} · ` : ""}Рамка · Shift — добавить</span>}<span>Пробел — сдвиг</span><span>Esc — отмена</span></div>
        <div className="workspace-editor-camera">
          <button type="button" aria-label="Уменьшить" onClick={() => camera.zoomBy(1 / 1.25)}>−</button>
          <button type="button" aria-label="Увеличить" onClick={() => camera.zoomBy(1.25)}>+</button>
          <button type="button" onClick={() => camera.fitCamera(true)}>Вписать</button>
        </div>
        {placement.pending && <div className="workspace-editor-placement" role="status">
          <span>{placement.pending.source ? `${placement.pending.source.name}: выберите точку · стрелки и Enter` : "Загрузка источника…"}</span>
          <button disabled={!placement.pending.source} onClick={() => placement.confirm()}>Поставить здесь</button><button onClick={placement.cancel}>Отмена</button>
        </div>}
        {gestures.wallDraft && <div className="workspace-editor-placement" role="status">
          <span>Клик — точка · Enter — закончить · Esc — отменить</span>
          <button disabled={gestures.wallDraft.pointCount < 2} onClick={() => gestures.finishWall()}>{gestures.wallDraft.kind === "wall" ? "Завершить стену" : "Завершить линию"}</button>
          <button disabled={!gestures.canCloseWall} onClick={() => gestures.finishWall(true)}>Замкнуть</button>
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
          ? <ArtProperties document={document} selection={selection} selectedNodes={gestures.selectedNodes} onSelectedNodes={gestures.setSelectedNodes} commit={commit} onClose={() => setSelection(null)} onDelete={() => remove(selection)} />
          : selection && tool === "select" && !disabled
            ? <WorkspaceProperties document={document} selection={selection} commit={commit} onClose={() => setSelection(null)} onDelete={() => remove(selection)} display={selectedToken ?? undefined}
              onPreview={() => { if (selectedToken?.state === "active" && selectedToken.id) setEntityPreview({ type: selectedToken.sourceRef.kind, id: selectedToken.id }); }} />
            : <ToolSettings tool={tool} settings={settings} maskEraser={maskEraser}
              selectedRoomCount={selectedRoomShapes(document, selections).length} roomActionsDisabled={disabled || leaving || active?.kind !== "terrain" || active.representation !== "cells" || active.locked || !active.visible || autosave.status.kind === "conflict"}
              onPaintRooms={() => paintRooms(false)} onClearRooms={() => paintRooms(true)}
              onChange={(patch) => { if (gesture.current?.type !== "wall-line" || patch.wallWidth === undefined && patch.lineWidth === undefined) finishGesture(); setSettings((current) => ({ ...current, ...patch })); }} />}
        <LayersPanel document={document} activeLayer={activeLayer} disabled={disabled || leaving} onActivate={(layerId) => { finishGesture(); setActiveLayer(layerId); }}
          commit={commit} live={liveEdit} settle={settleEdit} onAdd={addLayer} confirm={confirm} />
      </aside>
    </div>

    <footer className="workspace-editor-status">
      {map.cell_lore && document.grid && <span>1 клетка = {map.cell_lore}</span>}
      <label className="workspace-status-layer">Слой:
        <select value={activeLayer} onChange={(event) => { finishGesture(); setActiveLayer(event.target.value); }}>
          {!active && <option value="">не выбран</option>}
          {[...document.layers].reverse().map((layer) => <option key={layer.id} value={layer.id}>{layerName(layer)}{layer.locked ? " · заблокирован" : ""}</option>)}
        </select></label>
      <span className="workspace-status-cell">{gestures.cursorCell ? `Клетка ${gestures.cursorCell}` : ""}</span>
      <label><input type="checkbox" checked={showGrid} onChange={event => setShowGrid(event.target.checked)} />Показывать сетку</label>
      <label><input type="checkbox" checked={snap} onChange={event => { finishGesture(); setSnap(event.target.checked); }} />Привязывать к сетке</label>
      <span className="workspace-status-hint">{renderWarning ? "Часть изображения пока недоступна" : "Пробел + мышь — сдвиг · колесо — масштаб · Ctrl+Z — отменить"}</span>
    </footer>

    <DungeonGenerator key={map.id} open={generatorOpen} current={disabled ? undefined : document} seed={map.seed} disabled={leaving || !!doc.compatibilityError || autosave.blocked || autosave.status.kind === "conflict"}
      onClose={() => setGeneratorOpen(false)} onApply={applyDungeon} />
    {label && <Modal className="workspace-editor-label-dialog" ariaLabel="Подпись карты" onClose={() => setLabel(null)}><h2>Подпись карты</h2><form onSubmit={(event) => { event.preventDefault(); commit((before) => addLabel(before, label.layerId, crypto.randomUUID(), label.position, label.text.trim())); setLabel(null); }}><label>Текст<input autoFocus value={label.text} maxLength={200} onChange={(event) => setLabel({ ...label, text: event.target.value })} /></label><div className="modal-footer"><button type="button" onClick={() => setLabel(null)}>Отмена</button><button className="primary" disabled={!label.text.trim()}>Добавить</button></div></form></Modal>}
    {entityPreview && <Modal className="workspace-editor-label-dialog workspace-editor-entity-dialog" ariaLabel="Карточка источника на карте" returnFocusTo={canvasRef} onClose={() => setEntityPreview(null)}>
      <EntityPreviewContent type={entityPreview.type} id={entityPreview.id} hideProfileButton statblockInline onClose={() => setEntityPreview(null)} />
    </Modal>}
    {confirmDialog}
  </div>;
}
