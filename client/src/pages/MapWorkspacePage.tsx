import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { serializeMapDocumentV6, type MapDocumentV6, type Vec2 } from "@shared/maps/core";
import { useCurrentUser } from "../api/currentUser";
import { useAfterWrite } from "../data/hooks";
import { Modal } from "../components/Modal";
import { EntityPreviewContent } from "../components/EntityPreviewModal";
import { SEARCH_DRAG_MIME } from "../components/LinkDropZone";
import { MapWorkspaceTools } from "../maps/workspace/MapWorkspace";
import { MapToolIcon } from "../maps/workspace/MapToolIcon";
import { mapWorkspaceApi, downloadMapJson, downloadStoredMapOriginal } from "../maps/workspace/mapApi";
import { geometryView, editGeometry } from "../maps/workspace/editDocument";
import { useMapNavigationGuard } from "../maps/workspace/useMapNavigationGuard";
import { WorkspaceCanvas } from "../maps/workspace/WorkspaceCanvas";
import { WorkspaceProperties } from "../maps/workspace/WorkspaceProperties";
import { createWorkspaceRenderModel } from "../maps/workspace/renderV6";
import { TOOL_LABELS, toolLayerKind, paintSegment, createRoom, createDoor, addLabel, addSymbol,
  quantize, roomRect, moveSelection, removeSelection, requireEditableLayer, type WorkspaceTool, type WorkspaceSelection } from "../maps/workspace/editorCommands";
import { loadStoredWorkspaceDocument } from "../maps/editor/loadDocument";
import { useMapCamera } from "../maps/editor/hooks/useMapCamera";
import { useMapHistory } from "../maps/editor/hooks/useMapHistory";
import { useMapAutosave } from "../maps/editor/hooks/useMapAutosave";
import { assessCurrentEditorCompatibility, hitTestGameplay } from "../maps/core";
import { createTerrainLayer, createGameplayLayer, createLabelLayer, createObjectLayer, moveLayer, renameLayer, setLayerOpacity } from "../maps/core/mutations/layers";
import { MAP_SYMBOL_ASSETS } from "../maps/assets/registry";
import { buildMasterSoyMapV3 } from "../maps/core/exchangeV3";
import type { MapFull } from "../maps/mapTypes";
import { useMapWorkspace } from "../maps/workspace/workspaceContext";
import { useTokenPlacement } from "../maps/workspace/useTokenPlacement";
import { useTokenPresentations } from "../maps/workspace/useTokenPresentations";
import { parsePlacementPayload, tokenSourceKey, tokenTarget, type PlacementSource } from "../maps/workspace/tokenPlacement";
import "../maps/workspace/workspace-editor.css";

type Gesture = { type: "paint" | "room" | "move"; before: MapDocumentV6; start: Vec2; last: Vec2; pointerId: number }
  | { type: "pan"; start: Vec2; ox: number; oy: number; pointerId: number };
const clone = (document: MapDocumentV6 | null) => document ? structuredClone(document) : null;
const TOOLS = Object.keys(TOOL_LABELS) as WorkspaceTool[];
const LEGACY_LAYER_NAMES: Record<string, [string, string]> = { "lyr-terrain": ["Terrain", "Поверхности"], "lyr-river": ["Rivers", "Реки"], "lyr-road": ["Roads", "Дороги"],
  "lyr-gameplay": ["Gameplay", "Комнаты и двери"], "lyr-labels": ["Labels", "Подписи"], "lyr-objects": ["Objects", "Объекты"], "lyr-scatter": ["Scatter", "Россыпи"] };
const layerName = (layer: { id: string; name: string }) => LEGACY_LAYER_NAMES[layer.id]?.[0] === layer.name ? LEGACY_LAYER_NAMES[layer.id][1] : layer.name;

export function MapWorkspacePage() {
  const { id } = useParams(), mapId = Number(id);
  const { user } = useCurrentUser();
  const navigate = useNavigate(), afterWrite = useAfterWrite();
  const [map, setMap] = useState<MapFull | null>(null);
  const [document, setDocumentState] = useState<MapDocumentV6 | null>(null);
  const documentRef = useRef(document);
  const setDocument = (next: MapDocumentV6 | null) => { documentRef.current = next; setDocumentState(next); };
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tool, setTool] = useState<WorkspaceTool>("brush");
  const [activeLayer, setActiveLayer] = useState("");
  const [selection, setSelection] = useState<WorkspaceSelection | null>(null);
  const [showGrid, setShowGrid] = useState(true), [snap, setSnap] = useState(true);
  const [material, setMaterial] = useState("stone"), [orientation, setOrientation] = useState(0);
  const [symbol, setSymbol] = useState(MAP_SYMBOL_ASSETS[0].id);
  const [layersOpen, setLayersOpen] = useState(false);
  const [label, setLabel] = useState<{ position: Vec2; layerId: string; text: string } | null>(null);
  const [preview, setPreview] = useState<ReturnType<typeof roomRect> | null>(null);
  const [leaving, setLeaving] = useState(false), [copying, setCopying] = useState(false);
  const [compatibilityError, setCompatibilityError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null), wrapRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null), space = useRef(false);
  const workspace = useMapWorkspace();
  const [entityPreview, setEntityPreview] = useState<PlacementSource | null>(null);
  const [dragGhost, setDragGhost] = useState<Vec2 | null>(null);
  const params = useMemo(() => ({ seed: map?.seed ?? 1, sea: map?.sea ?? 55, mountains: map?.mountains ?? 12, forest: map?.forest ?? 30 }),
    [map?.seed, map?.sea, map?.mountains, map?.forest]);
  const history = useMapHistory({ value: document, onChange: setDocument, clone, getValue: () => documentRef.current });
  // Published old maps remain readable by the existing player flow. Use a
  // private copy until V6 public projection is connected in ticket 09.
  const publishedOldMap = !!map && map.player_visible === 1 && map.document_version !== 6;
  const disabled = !!compatibilityError || publishedOldMap || user?.role !== "gm";
  const autosave = useMapAutosave({ map, value: document, getValue: () => documentRef.current, params,
    isEditing: () => !!gesture.current && gesture.current.type !== "pan",
    serialize: serializeMapDocumentV6, save: mapWorkspaceApi.saveBody, buildThumbnail: () => null,
    disabled, onSaved: (savedId) => { setMap((record) => record?.id === savedId ? { ...record, document_version: 6 } : record); afterWrite([{ kind: "map", id: savedId, card: true }]); } });
  const camera = useMapCamera({ mapId: map?.id ?? null, geom: map, wrapRef, canvasRef });
  const displays = useTokenPresentations(mapId, document);
  const canPlace = !!document && !disabled && !leaving && !label && !autosave.blocked && autosave.status.kind !== "conflict";
  const placement = useTokenPlacement({ mapId, enabled: canPlace, getDocument: () => documentRef.current, activeLayer, snap,
    center: () => { const rect = wrapRef.current?.getBoundingClientRect(); return { x: ((rect?.width ?? 0) / 2 - camera.camRef.current.ox) / camera.camRef.current.scale,
      y: ((rect?.height ?? 0) / 2 - camera.camRef.current.oy) / camera.camRef.current.scale }; },
    commit, onPlaced: (tokenId, layerId) => { setTool("select"); setActiveLayer(layerId); setSelection({ id: tokenId, layerId, kind: "token" }); }, onError: showError });
  const placementActions = useRef({ place: (source: PlacementSource) => { finishGesture(); setEntityPreview(null); void placement.begin(source); canvasRef.current?.focus(); },
    preview: (source: PlacementSource) => { finishGesture(); placement.cancel(); setEntityPreview(source); } });
  placementActions.current = { place: (source) => { finishGesture(); setEntityPreview(null); void placement.begin(source); canvasRef.current?.focus(); },
    preview: (source) => { finishGesture(); placement.cancel(); setEntityPreview(source); } };
  const registerPlacement = workspace?.setPlacement;
  useEffect(() => {
    if (!canPlace || !registerPlacement) return;
    registerPlacement({ place: (source) => placementActions.current.place(source), preview: (source) => placementActions.current.preview(source) });
    return () => registerPlacement(null);
  }, [canPlace, mapId, registerPlacement]);

  function finishGesture(cancel = false) {
    const current = gesture.current;
    gesture.current = null;
    setPreview(null);
    if (!current || current.type === "pan") return;
    autosave.schedule();
    if (cancel) { history.cancelStroke(); if (current.type !== "paint") setDocument(current.before); return; }
    if (current.type === "paint") history.commitStroke();
    else if (current.type === "move") {
      if (documentRef.current !== current.before) history.push(current.before);
    } else {
      try {
        const next = createRoom(current.before, activeLayer, crypto.randomUUID(), current.start, current.last, snap);
        history.push(current.before); setDocument(next);
      } catch (error) { showError(error); }
    }
  }
  function showError(error: unknown) { setActionError(error instanceof Error ? error.message : "Не удалось выполнить действие"); }
  async function leave() {
    placement.cancel(); finishGesture(); setLeaving(true); setActionError(null);
    try {
      const saved = await autosave.flush();
      if (!saved) setActionError("Не удалось сохранить карту. Ваши правки остаются здесь; повторите сохранение или скачайте копию.");
      return saved;
    } finally { setLeaving(false); }
  }
  useMapNavigationGuard(() => !!gesture.current || autosave.hasPendingChanges(), leave);

  useEffect(() => {
    if (user?.role !== "gm") return;
    let alive = true;
    autosave.beginLoad(); history.clear(); gesture.current = null; setDocument(null); setMap(null);
    setLoadError(null); setActionError(null); setCompatibilityError(null); setSelection(null); setPreview(null); setLabel(null);
    setEntityPreview(null); setDragGhost(null);
    mapWorkspaceApi.read(mapId).then((record) => {
      if (!alive) return;
      const loaded = loadStoredWorkspaceDocument(record);
      if (loaded.status !== "supported") {
        setLoadError(loaded.status === "unsupported" ? "Эта карта использует функции, которые редактор пока не поддерживает." : "Документ карты повреждён. Можно скачать исходник для восстановления.");
        return;
      }
      const compat = assessCurrentEditorCompatibility(geometryView(loaded.document));
      const missingRevision = !Number.isSafeInteger(record.revision);
      setCompatibilityError(!compat.compatible ? "Некоторые элементы этой карты пока нельзя редактировать здесь. Исходник доступен для скачивания."
        : missingRevision ? "Сервер ещё не поддерживает безопасное сохранение. Обновите приложение перед редактированием." : null);
      setMap({ ...record, document_version: loaded.sourceFormat === "v6" ? 6 : record.document_version });
      setDocument(loaded.document);
      setActiveLayer(loaded.document.layers.find((layer) => layer.kind === "terrain" && layer.visible && !layer.locked)?.id ?? "");
      setTool("brush");
      autosave.markLoaded(serializeMapDocumentV6(loaded.document), JSON.stringify({ seed: record.seed, sea: record.sea, mountains: record.mountains, forest: record.forest }), false, record.revision);
    }).catch((error) => { if (alive) setLoadError(error instanceof Error ? error.message : "Не удалось открыть карту"); });
    return () => { alive = false; };
    // Lifecycle belongs to map identity/role, not to hook return objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapId, user?.role]);

  function chooseTool(next: WorkspaceTool) {
    placement.cancel(); finishGesture(); setTool(next); setActionError(null);
    const doc = documentRef.current;
    if (!doc || next === "select") return;
    const kind = toolLayerKind(next), layer = doc.layers.find((entry) => entry.id === activeLayer);
    if (layer?.kind !== kind) setActiveLayer([...doc.layers].reverse().find((entry) => entry.kind === kind && entry.visible && !entry.locked)?.id ?? "");
  }
  function commit(operation: (before: MapDocumentV6) => MapDocumentV6) {
    const before = documentRef.current;
    if (!before || disabled || leaving || autosave.blocked || autosave.status.kind === "conflict") return;
    try { const next = operation(before); if (next !== before) { history.push(before); setDocument(next); } setActionError(null); }
    catch (error) { showError(error); }
  }
  function pick(point: Vec2): WorkspaceSelection | null {
    const doc = documentRef.current;
    if (!doc) return null;
    for (const layer of [...doc.layers].reverse()) {
      if (!layer.visible || layer.locked) continue;
      if (layer.kind === "gameplay") {
        const view = geometryView(doc);
        for (const item of [...layer.items].reverse()) {
          if (item.kind === "token") {
            const angle = -item.rotation * Math.PI / 180, dx = point.x - item.position.x, dy = point.y - item.position.y;
            const x = dx * Math.cos(angle) - dy * Math.sin(angle), y = dx * Math.sin(angle) + dy * Math.cos(angle);
            const radius = item.size / 2 + 5 / camera.cam.scale;
            if ((item.appearance.shape === "circle" ? Math.hypot(x, y) : Math.abs(x) + Math.abs(y)) <= radius) return { id: item.id, layerId: layer.id, kind: "token" };
          } else {
            const hit = hitTestGameplay({ ...view, layers: view.layers.flatMap((entry) => entry.id === layer.id && entry.kind === "gameplay" ? [{ ...entry, items: entry.items.filter((entity) => entity.id === item.id) }] : []) }, point, 5 / camera.cam.scale);
            if (hit) return { id: hit.entityId, layerId: layer.id, kind: "gameplay" };
          }
        }
      } else if (layer.kind === "label" || layer.kind === "object") {
        for (const item of [...layer.items].reverse()) {
          const position = "transform" in item ? item.transform.position : item.position;
          if (Math.hypot(point.x - position.x, point.y - position.y) <= Math.max(0.5, 12 / camera.cam.scale)) return { id: item.id, layerId: layer.id, kind: layer.kind };
        }
      }
    }
    return null;
  }
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (gesture.current || leaving || label) return;
    const world = camera.toWorld(event), point = { x: world.wx, y: world.wy };
    event.currentTarget.focus();
    if (event.button === 1 || (event.button === 0 && space.current)) {
      event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
      gesture.current = { type: "pan", start: { x: event.clientX, y: event.clientY }, ox: camera.cam.ox, oy: camera.cam.oy, pointerId: event.pointerId }; return;
    }
    if (event.button !== 0 || disabled || autosave.status.kind === "conflict") return;
    if (placement.pending) { placement.confirm(point); return; }
    const doc = documentRef.current;
    if (!doc) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    if (tool === "select") {
      const found = pick(point); setSelection(found);
      if (found) { setActiveLayer(found.layerId); gesture.current = { type: "move", before: doc, start: point, last: point, pointerId: event.pointerId }; }
    } else if (tool === "brush" || tool === "wall" || tool === "eraser") {
      try {
        const next = paintSegment(doc, activeLayer, point, point, tool === "eraser" ? null : tool === "wall" ? "wall" : material);
        history.beginStroke(); gesture.current = { type: "paint", before: doc, start: point, last: point, pointerId: event.pointerId };
        if (next !== doc) { history.markStrokeChanged(); setDocument(next); }
      } catch (error) { showError(error); }
    } else if (tool === "shape") gesture.current = { type: "room", before: doc, start: point, last: point, pointerId: event.pointerId };
    else if (tool === "door") commit((before) => createDoor(before, activeLayer, crypto.randomUUID(), point, snap, orientation));
    else if (tool === "label") {
      try { requireEditableLayer(doc, activeLayer, "label"); setLabel({ position: quantize(doc, point, snap), layerId: activeLayer, text: "" }); }
      catch (error) { showError(error); }
    }
    else if (tool === "asset") commit((before) => addSymbol(before, activeLayer, crypto.randomUUID(), quantize(before, point, snap), symbol));
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    if (placement.pending && !gesture.current) { const world = camera.toWorld(event); placement.move({ x: world.wx, y: world.wy }); return; }
    const current = gesture.current;
    if (!current || current.pointerId !== event.pointerId) return;
    if (current.type === "pan") {
      camera.setCam((cam) => ({ ...cam, ox: current.ox + event.clientX - current.start.x, oy: current.oy + event.clientY - current.start.y })); return;
    }
    const world = camera.toWorld(event), point = { x: world.wx, y: world.wy };
    try {
      if (current.type === "room") setPreview(roomRect(current.start, point, snap));
      else if (current.type === "paint" && documentRef.current) {
        const next = paintSegment(documentRef.current, activeLayer, current.last, point, tool === "eraser" ? null : tool === "wall" ? "wall" : material);
        if (next !== documentRef.current) { history.markStrokeChanged(); setDocument(next); }
      } else if (current.type === "move" && selection) {
        const origin = quantize(current.before, current.start, snap), end = quantize(current.before, point, snap);
        setDocument(moveSelection(current.before, selection, { x: end.x - origin.x, y: end.y - origin.y }));
      }
      current.last = point;
    } catch (error) { showError(error); finishGesture(true); }
  }
  const up = (event: PointerEvent<HTMLCanvasElement>) => {
    if (gesture.current?.pointerId === event.pointerId) { move(event); finishGesture(); }
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.closest("input, textarea, select, [contenteditable=true], [role=dialog]")) return;
      if (event.code === "Space") { event.preventDefault(); space.current = true; }
      if (event.key === "Escape") { placement.cancel(); setDragGhost(null); finishGesture(true); setLayersOpen(false); setSelection(null); }
      if (disabled || leaving || autosave.status.kind === "conflict") return;
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
      if ((event.key === "Delete" || event.key === "Backspace") && selection) { event.preventDefault(); finishGesture(); commit((before) => removeSelection(before, selection)); setSelection(null); }
    };
    const upKey = (event: KeyboardEvent) => { if (event.code === "Space") space.current = false; };
    const blur = () => { space.current = false; finishGesture(true); };
    window.addEventListener("keydown", onKey); window.addEventListener("keyup", upKey); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("keyup", upKey); window.removeEventListener("blur", blur); };
  });
  function backup() {
    if (!map || !documentRef.current) return;
    const envelope = buildMasterSoyMapV3({ name: map.name, scale: map.scale, cellLore: map.cell_lore }, documentRef.current, params);
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
    if (!source) { setActionError("На карту можно перенести локацию, существо сеттинга или существо из бестиария"); return; }
    const point = camera.toWorld(event); void placement.begin(source, { x: point.wx, y: point.wy });
  }
  function addLayer(kind: "terrain" | "gameplay" | "label" | "object") {
    finishGesture(); const layerId = crypto.randomUUID();
    const creators = { terrain: createTerrainLayer, gameplay: createGameplayLayer, label: createLabelLayer, object: createObjectLayer };
    const names = { terrain: "Поверхности", gameplay: "Комнаты и двери", label: "Подписи", object: "Объекты" };
    commit((before) => editGeometry(before, (view) => creators[kind](view, { id: layerId, name: names[kind] })));
    setActiveLayer(layerId);
  }
  async function privateCopy() {
    if (!map || !document) return;
    setCopying(true);
    try { const created = await mapWorkspaceApi.createPrivateCopy(map, document); afterWrite([{ kind: "map", card: true }]); navigate(`/maps/${created.id}/workspace`); }
    catch (error) { showError(error); } finally { setCopying(false); }
  }
  if (user?.role === "player") return <p>Новый редактор доступен мастеру.</p>;
  if (loadError) return <div className="workspace-editor-message"><p role="alert">{loadError}</p>{actionError && <p role="alert">{actionError}</p>}<button onClick={() => void downloadStoredMapOriginal(mapId).catch(showError)}>Скачать исходный документ</button><Link to="/maps">Мои карты</Link></div>;
  if (!map || !document) return <p className="workspace-editor-message">Загрузка карты…</p>;
  const locked = document.layers.find((layer) => layer.id === activeLayer)?.locked;
  const stateText = { saved: "Сохранено", dirty: "Есть правки", saving: "Сохраняем…", error: "Ошибка сохранения", conflict: "Карта изменена в другом окне" }[autosave.status.kind];
  const renderWarning = createWorkspaceRenderModel(document).diagnostics.length > 0;
  return <div className="workspace-editor" aria-busy={leaving}>
    <MapWorkspaceTools><div className="map-workspace-tool-list" role="toolbar" aria-label="Инструменты нового редактора">
      {TOOLS.map((name) => <button key={name} title={TOOL_LABELS[name]} aria-label={TOOL_LABELS[name]} aria-pressed={tool === name}
        disabled={disabled || leaving} onClick={() => chooseTool(name)}><MapToolIcon tool={name} /><span>{TOOL_LABELS[name]}</span></button>)}
      <button aria-label="Слои" aria-expanded={layersOpen} onClick={() => { finishGesture(); setLayersOpen(!layersOpen); }}>☷<span>Слои</span></button>
    </div></MapWorkspaceTools>
    <header className="workspace-editor-header"><Link to="/maps">Мои карты</Link><h1 title={map.name}>{map.name}</h1>
      {map.document_version !== 6 && <Link to={`/maps/${map.id}`} title="Временно: генератор и показ игрокам">Классический редактор</Link>}
      <button onClick={backup}>Скачать копию</button><button className="primary" disabled={disabled || leaving || autosave.status.kind === "conflict"} onClick={() => { finishGesture(); void autosave.flush(); }}>Сохранить</button>
    </header>
    <div className="workspace-editor-context" role="toolbar" aria-label="Параметры карты">
      <strong>{TOOL_LABELS[tool]}</strong>
      {(tool === "brush") && <select aria-label="Материал пола" value={material} onChange={(event) => { finishGesture(); setMaterial(event.target.value); }}><option value="stone">Каменный пол</option><option value="wood">Деревянный пол</option><option value="earth">Земля</option><option value="shallow_water">Вода</option></select>}
      {tool === "door" && <select aria-label="Поворот двери" value={orientation} onChange={(event) => setOrientation(Number(event.target.value))}><option value={0}>Вдоль стены →</option><option value={90}>Вдоль стены ↓</option></select>}
      {tool === "asset" && <select aria-label="Объект карты" value={symbol} onChange={(event) => setSymbol(event.target.value)}>{MAP_SYMBOL_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}</select>}
      <label><input type="checkbox" checked={showGrid} onChange={(event) => setShowGrid(event.target.checked)} />Сетка</label>
      <label><input type="checkbox" checked={snap} onChange={(event) => { finishGesture(); setSnap(event.target.checked); }} />Привязка</label>
      <button disabled={!history.canUndo || disabled || leaving} onClick={() => { finishGesture(); history.undo(); }}>Отменить</button>
      <button disabled={!history.canRedo || disabled || leaving} onClick={() => { finishGesture(); history.redo(); }}>Повторить</button>
    </div>
    <div className="workspace-editor-stage" ref={wrapRef}>
      <WorkspaceCanvas map={map} document={document} camera={camera.cam} canvasRef={canvasRef} wrapRef={wrapRef} showGrid={showGrid} selectedId={selection?.id ?? null} preview={preview}
        displays={displays} ghost={placement.pending?.position ?? dragGhost} onDragOver={dragOver} onDragLeave={() => setDragGhost(null)} onDrop={drop}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={(event) => { if (gesture.current?.pointerId === event.pointerId) finishGesture(true); }} />
      <div className="workspace-editor-camera"><button aria-label="Уменьшить" onClick={() => camera.zoomBy(1 / 1.25)}>−</button><button onClick={() => camera.fitCamera(true)}>Вписать</button><button aria-label="Увеличить" onClick={() => camera.zoomBy(1.25)}>+</button></div>
      {placement.pending && <div className="workspace-editor-placement" role="status">
        <span>{placement.pending.source ? `${placement.pending.source.name}: выберите точку · стрелки и Enter` : "Загрузка источника…"}</span>
        <button disabled={!placement.pending.source} onClick={() => placement.confirm()}>Поставить здесь</button><button onClick={placement.cancel}>Отмена</button>
      </div>}
      {(actionError || compatibilityError || publishedOldMap || autosave.status.kind === "error" || autosave.status.kind === "conflict") && <div className="workspace-editor-notice" role="alert">
        <p>{actionError || compatibilityError || (publishedOldMap ? "Эта карта доступна игрокам. Пока готовится новый показ, редактируйте скрытую копию — текущий показ сохранится." : autosave.status.kind === "conflict" ? "Карта изменена в другом окне. Сохранение остановлено; скачайте свои правки перед повторным открытием." : "Не удалось сохранить карту. Правки остаются в редакторе.")}</p>
        {publishedOldMap && <button disabled={copying || !!compatibilityError} onClick={() => void privateCopy()}>Создать скрытую копию</button>}
        {compatibilityError && <button onClick={() => void downloadStoredMapOriginal(map.id).catch(showError)}>Скачать исходный документ</button>}
        {!disabled && autosave.status.kind !== "conflict" && <button onClick={() => void autosave.flush()}>Повторить сохранение</button>}
        <button onClick={backup}>Скачать мои правки</button>
      </div>}
      {layersOpen && <aside className="workspace-editor-layers" aria-label="Слои карты"><div className="workspace-editor-panel-heading"><h2>Слои</h2><button aria-label="Закрыть слои" onClick={() => setLayersOpen(false)}>×</button></div>
        <p>Выберите слой. Верхний в списке лежит поверх остальных.</p>
        {[...document.layers].reverse().map((layer) => <div className="workspace-editor-layer" key={layer.id}>
          <button aria-pressed={activeLayer === layer.id} onClick={() => { finishGesture(); setActiveLayer(layer.id); }}>{layerName(layer)}</button>
          <input aria-label={`Имя слоя: ${layer.name}`} defaultValue={layerName(layer)} key={`${layer.id}:${layer.name}`} disabled={disabled} onBlur={(event) => {
            if (event.target.value.trim() && event.target.value !== layerName(layer)) commit((before) => editGeometry(before, (view) => renameLayer(view, layer.id, event.target.value.trim())));
          }} />
          <label><input type="checkbox" aria-label={`Видимость: ${layer.name}`} checked={layer.visible} disabled={disabled} onChange={(event) => commit((before) => ({ ...before, layers: before.layers.map((entry) => entry.id === layer.id ? { ...entry, visible: event.target.checked } : entry) }))} />Виден</label>
          <label><input type="checkbox" aria-label={`Блокировка: ${layer.name}`} checked={layer.locked} disabled={disabled} onChange={(event) => commit((before) => ({ ...before, layers: before.layers.map((entry) => entry.id === layer.id ? { ...entry, locked: event.target.checked } : entry) }))} />Замок</label>
          <label>Плотность<input type="range" aria-label={`Плотность: ${layer.name}`} min={0} max={1} step={0.1} value={layer.opacity} disabled={disabled} onChange={(event) => commit((before) => editGeometry(before, (view) => setLayerOpacity(view, layer.id, Number(event.target.value))))} /></label>
          <button aria-label={`Поднять слой: ${layer.name}`} disabled={disabled || document.layers.at(-1)?.id === layer.id} onClick={() => commit((before) => editGeometry(before, (view) => moveLayer(view, layer.id, before.layers.findIndex((entry) => entry.id === layer.id) + 1)))}>↑ Поднять</button>
          <button aria-label={`Опустить слой: ${layer.name}`} disabled={disabled || document.layers[0]?.id === layer.id} onClick={() => commit((before) => editGeometry(before, (view) => moveLayer(view, layer.id, before.layers.findIndex((entry) => entry.id === layer.id) - 1)))}>↓ Опустить</button>
        </div>)}
        <div className="workspace-editor-add-layers">{(["terrain", "gameplay", "label", "object"] as const).map((kind) => <button key={kind} disabled={disabled} onClick={() => addLayer(kind)}>+ {{ terrain: "Поверхности", gameplay: "Комнаты", label: "Подписи", object: "Объекты" }[kind]}</button>)}</div>
      </aside>}
      {selection && !disabled && <WorkspaceProperties document={document} selection={selection} commit={commit} onClose={() => setSelection(null)} onDelete={() => { commit((before) => removeSelection(before, selection)); setSelection(null); }}
        display={(() => { const layer = document.layers.find((entry) => entry.id === selection.layerId); const token = layer?.kind === "gameplay" ? layer.items.find((item) => item.id === selection.id) : null; return token?.kind === "token" && token.sourceRef ? displays.get(tokenSourceKey(token.sourceRef)) : undefined; })()}
        onPreview={() => { const layer = document.layers.find((entry) => entry.id === selection.layerId); const token = layer?.kind === "gameplay" ? layer.items.find((item) => item.id === selection.id) : null;
          const display = token?.kind === "token" && token.sourceRef ? displays.get(tokenSourceKey(token.sourceRef)) : null;
          if (display?.state === "active" && display.id) setEntityPreview({ type: display.sourceRef.kind, id: display.id }); }} />}
    </div>
    <footer className="workspace-editor-status" aria-live="polite"><span>{leaving ? "Сохраняем перед выходом…" : stateText}</span><span>{locked ? "Слой заблокирован" : document.layers.find((layer) => layer.id === activeLayer) ? layerName(document.layers.find((layer) => layer.id === activeLayer)!) : "Выберите слой"}</span><span>{renderWarning ? "Часть изображения пока недоступна" : "Пробел + мышь: сдвиг · колесо: масштаб"}</span></footer>
    {label && <Modal className="workspace-editor-label-dialog" ariaLabel="Подпись карты" onClose={() => setLabel(null)}><h2>Подпись карты</h2><form onSubmit={(event) => { event.preventDefault(); commit((before) => addLabel(before, label.layerId, crypto.randomUUID(), label.position, label.text.trim())); setLabel(null); }}><label>Текст<input autoFocus value={label.text} maxLength={200} onChange={(event) => setLabel({ ...label, text: event.target.value })} /></label><div className="modal-footer"><button type="button" onClick={() => setLabel(null)}>Отмена</button><button className="primary" disabled={!label.text.trim()}>Добавить</button></div></form></Modal>}
    {entityPreview && <Modal className="workspace-editor-label-dialog workspace-editor-entity-dialog" ariaLabel="Карточка источника на карте" returnFocusTo={canvasRef} onClose={() => setEntityPreview(null)}>
      <EntityPreviewContent type={entityPreview.type} id={entityPreview.id} hideProfileButton statblockInline onClose={() => setEntityPreview(null)} />
    </Modal>}
  </div>;
}
