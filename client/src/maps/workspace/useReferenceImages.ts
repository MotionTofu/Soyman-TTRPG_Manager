import { randomUUID } from "../../utils/uuid";
import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { MapDocumentV6, ReferenceImage, Vec2 } from "@shared/maps/core";
import { addReferenceImage, createReferenceLayer, updateReferenceImage } from "../core/mutations/references";
import { loadMapImageAsset, registerMapImageResources, resourceImageAssetId } from "../assets/registry";
import { cellWidth, worldBounds } from "../grid";
import type { MapFull } from "../mapTypes";
import { editGeometry } from "./editDocument";
import { mapWorkspaceApi } from "./mapApi";
import { dragReference, placeReference, referenceAt, referenceHandles, type ReferenceHandle } from "./referenceImages";
import { NEW_LAYERS } from "./layerNames";

type Edit = (operation: (before: MapDocumentV6) => MapDocumentV6) => void;
type Camera = { cam: { scale: number; ox: number; oy: number }; toWorld: (event: { clientX: number; clientY: number }) => { wx: number; wy: number } };
/** Радиус ручки, точек экрана. */
const GRAB = 9;

/** Подложка для обрисовки (П1–П16): файлы, выбор, ручки на холсте, стрелки и клавиша H. */
export function useReferenceImages({ map, document, documentRef, activeLayer, setActiveLayer, commit, live, settle, camera, center, space, writable, onError }: {
  map: MapFull | null; document: MapDocumentV6 | null; documentRef: { current: MapDocumentV6 | null };
  activeLayer: string; setActiveLayer: (id: string) => void;
  commit: Edit; live: Edit; settle: () => void; camera: Camera; space: { current: boolean }; writable: boolean; onError: (error: unknown) => void;
  /** Середина экрана в мире: туда встаёт новая картинка. */
  center: () => Vec2;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [cropping, setCropping] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [peek, setPeek] = useState(false);
  const drag = useRef<{ start: ReferenceImage; handle: ReferenceHandle; from: Vec2; moved: boolean } | null>(null);
  const mapId = map?.id ?? null;
  const layer = document?.layers.find((entry) => entry.id === activeLayer);
  const open = layer?.kind === "reference" ? layer : null;
  const item = open?.items.find((entry) => entry.id === selected) ?? null;
  const movable = !!open && open.visible && !open.locked && writable;
  const cell = cellWidth(document?.grid?.type ?? "square");

  // Адреса файлов сохранённой карты — в общий загрузчик картинок; дальше их грузит и рисует карта.
  useEffect(() => {
    if (mapId === null) return;
    let alive = true;
    mapWorkspaceApi.references(mapId).then((files) => {
      if (!alive) return;
      registerMapImageResources(files.map((file) => ({ uid: file.uid, name: "Подложка", file_url: file.url })));
      for (const file of files) void loadMapImageAsset(resourceImageAssetId(file.uid)).catch(() => undefined);
    }).catch(() => undefined);
    return () => { alive = false; };
  }, [mapId]);
  // Другой слой или картинка пропала (отмена) — выбор и обрезка снимаются.
  useEffect(() => { if (!item) { if (selected) setSelected(null); setCropping(false); } }, [item, selected]);
  // H держат — подложки нет (П9). Клавиша по месту на клавиатуре: в русской раскладке тоже.
  useEffect(() => {
    const typing = (event: KeyboardEvent) => event.target instanceof Element && !!event.target.closest("input, textarea, select, [contenteditable=true]");
    const down = (event: KeyboardEvent) => { if (event.code === "KeyH" && !event.ctrlKey && !event.metaKey && !event.altKey && !typing(event)) setPeek(true); };
    const up = (event: KeyboardEvent) => { if (event.code === "KeyH") setPeek(false); };
    const blur = () => setPeek(false);
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);

  /** Загрузить картинку в подложку: в открытый слой подложки, иначе в верхний, иначе в новый наверху (П12, П13). */
  async function upload(file: File, at?: Vec2) {
    if (!map || mapId === null || uploading) return;
    setUploading(true);
    try {
      const saved = await mapWorkspaceApi.uploadReference(mapId, file);
      registerMapImageResources([{ uid: saved.uid, name: file.name.slice(0, 80) || "Подложка", file_url: saved.url }]);
      void loadMapImageAsset(resourceImageAssetId(saved.uid)).catch(() => undefined);
      const current = documentRef.current;
      if (!current) return;
      const target = open ?? [...current.layers].reverse().find((entry) => entry.kind === "reference");
      const layerId = target?.id ?? randomUUID(), id = randomUUID();
      const all = current.layers.flatMap((entry) => entry.kind === "reference" ? entry.items : []);
      const previous = (target?.kind === "reference" ? target.items.at(-1) : undefined) ?? all.at(-1) ?? null;
      const bounds = worldBounds(map.grid, map.width, map.height);
      const image = placeReference(id, saved.uid, { w: saved.width, h: saved.height }, bounds, at ?? center(), previous);
      commit((before) => editGeometry(before, (view) => {
        let base = view;
        if (!view.layers.some((entry) => entry.id === layerId)) {
          const created = createReferenceLayer(view, { id: layerId, name: NEW_LAYERS.reference });
          if (!created.ok) return created;
          base = created.document;
        }
        const added = addReferenceImage(base, layerId, image);
        return added.ok && base !== view ? { ...added, changed: true } : added;
      }));
      setActiveLayer(layerId); setSelected(id); setCropping(false);
    } catch (error) { onError(error); } finally { setUploading(false); }
  }

  const world = (event: { clientX: number; clientY: number }) => { const p = camera.toWorld(event); return { x: p.wx, y: p.wy }; };
  /** Нажатие на холсте, пока открыта подложка: ручка, картинка или мимо. true — нажатие забрано. */
  function down(event: PointerEvent<HTMLCanvasElement>): boolean {
    if (!open || event.button !== 0 || space.current) return false;
    const p = world(event), scale = camera.cam.scale;
    if (movable && item) {
      const near = referenceHandles(item, scale, cropping).find(({ at }) => Math.hypot((at.x - p.x) * scale, (at.y - p.y) * scale) <= GRAB);
      if (near) return grab(event, item, near.handle, p);
    }
    const hit = documentRef.current ? referenceAt(documentRef.current, open.id, p) : null;
    if (!hit) { setSelected(null); setCropping(false); return true; }
    if (hit.id !== selected) { setSelected(hit.id); setCropping(false); }
    return movable && !cropping ? grab(event, hit, { kind: "move" }, p) : true;
  }
  function grab(event: PointerEvent<HTMLCanvasElement>, start: ReferenceImage, handle: ReferenceHandle, from: Vec2) {
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { start, handle, from, moved: false };
    return true;
  }
  function move(event: PointerEvent<HTMLCanvasElement>): boolean {
    const current = drag.current;
    if (!current) return false;
    const patch = dragReference(current.start, current.handle, current.from, world(event), event.shiftKey);
    current.moved = true;
    live((before) => editGeometry(before, (view) => updateReferenceImage(view, current.start.id, patch)));
    return true;
  }
  function up(): boolean {
    if (!drag.current) return false;
    drag.current = null; settle();
    return true;
  }
  /** Стрелки: сдвиг выбранной картинки на ¼ клетки, с Shift — на клетку (П7). */
  function nudge(event: KeyboardEvent): boolean {
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!step || !item || !movable) return false;
    event.preventDefault();
    const d = (event.shiftKey ? 1 : 0.25) * cell;
    commit((before) => editGeometry(before, (view) => updateReferenceImage(view, item.id, { position: { x: item.position.x + step[0] * d, y: item.position.y + step[1] * d } })));
    return true;
  }
  return { open, item, selected, setSelected, cropping, setCropping, uploading, upload, peek, movable, cell, down, move, up, nudge };
}

/** Документ без подложки — пока держат H. */
export const withoutReferences = (document: MapDocumentV6): MapDocumentV6 =>
  ({ ...document, layers: document.layers.map((layer) => layer.kind === "reference" && layer.visible ? { ...layer, visible: false } : layer) });
