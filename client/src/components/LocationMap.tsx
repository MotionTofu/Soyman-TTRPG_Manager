import { useEffect, useMemo, useRef, useState, type DragEvent, type PointerEvent } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { api, deleteFileWithChoice } from "../api/client";
import { resolveEntityMapLabels, type ResolvedLabelResult } from "../api/resolveEntity";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { SearchPanel } from "../layout/SearchPanel";
import { Modal } from "./Modal";
import { DETAIL_ROUTES, ENTITY_TYPE_LABELS } from "../entityTypes";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { LocationCascadePicker } from "./LocationCascadePicker";
import { SendMapToSessionModal } from "./SendMapToSessionModal";
import { addToBag } from "../bag";
import { NavIcon } from "./NavIcons";
import { isSafeImageUrl } from "../utils/safeUrl";
import { useConfirm, useAlert } from "../hooks/useConfirm";
import type { LocationPin, SearchResult, SettingLocation } from "../types";

const MAX_PINS = 100;

interface Props {
  locationId: number;
  locationName: string;
  settingId: number | null;
  mapImageUrl: string | null;
  pins: LocationPin[];
  mapMaxZoom: number | null;
  mapStartZoom: number | null;
  mapGotoZoom: number | null;
  mapLabelsAlways: number;
  // Every other location in the same setting — feeds the "Перенести карту"
  // target picker. Omitted (or empty) simply hides that button.
  otherLocations?: SettingLocation[];
  onChange: () => void;
}

interface ResolvedPin extends LocationPin {
  label: string;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const DEFAULT_PIN_COLOR = "#b08968";
const DEFAULT_PIN_BORDER = "#16141c";
const DEFAULT_PIN_SIZE = 14;

// Default fill/border per entity type, applied only when a pin has no manual
// color override — once the user picks a color for a specific pin (the
// "Отображение" toolbar), that override always wins, so these are just
// sensible starting points, not an enforced convention.
const LEGEND_ITEMS: { label: string; color: string; border: string }[] = [
  { label: "Персонажи", color: "#c97b4a", border: "#5c3a21" },
  { label: "Локации", color: "#4a90a4", border: "#2f6b3a" },
  { label: "Предметы", color: "#8a5fb0", border: "#c9a227" },
];
const PIN_TYPE_DEFAULTS: Record<string, { color: string; border: string }> = {
  character: LEGEND_ITEMS[0],
  being: LEGEND_ITEMS[0],
  location: LEGEND_ITEMS[1],
  artifact: LEGEND_ITEMS[2],
};
function pinDefaultsFor(targetType: string): { color: string; border: string } {
  return PIN_TYPE_DEFAULTS[targetType] ?? { color: DEFAULT_PIN_COLOR, border: DEFAULT_PIN_BORDER };
}

// Tooltip background bucket by entity type — being and character share the
// same red hue (both "living" pins), but character gets its own modifier
// class (index.css) for a distinct border and a slightly larger label.
function pinLabelBucket(targetType: string): "being" | "character" | "location" | "artifact" | "other" {
  if (targetType === "being") return "being";
  if (targetType === "character") return "character";
  if (targetType === "location") return "location";
  if (targetType === "artifact") return "artifact";
  return "other";
}
const MIN_ZOOM = 1;
const DEFAULT_MAX_ZOOM = 6;
const DEFAULT_START_ZOOM = 1;
const DEFAULT_GOTO_ZOOM = 3;
// Pins stay a constant on-screen size regardless of zoom level (the
// map image is what grows/shrinks, not the pins). MIN_ZOOM currently floors
// zoom at 1, so the <1 branch is a small defensive shrink in case that floor
// is ever relaxed — kept subtle so pins never look cramped when zoomed out.
const PIN_HIT_PADDING = 2; // extends the circular hit-area beyond the visible dot, on every side
function pinCounterScale(zoom: number) {
  if (zoom >= MIN_ZOOM) return 1 / zoom;
  return (1 - (1 - zoom) * 0.15) / zoom;
}

function clampPan(
  zoom: number,
  panX: number,
  panY: number,
  rect: { width: number; height: number },
  imageBox?: { left: number; top: number; width: number; height: number } | null
) {
  if (imageBox) {
    // Clamp so image edges never leave the viewport.
    const imgLeft = imageBox.left;
    const imgTop = imageBox.top;
    const imgRight = imgLeft + imageBox.width;
    const imgBottom = imgTop + imageBox.height;
    const minX = rect.width - imgRight * zoom;
    const maxX = -imgLeft * zoom;
    const minY = rect.height - imgBottom * zoom;
    const maxY = -imgTop * zoom;
    return {
      x: Math.min(maxX, Math.max(minX, panX)),
      y: Math.min(maxY, Math.max(minY, panY)),
    };
  }
  // Fallback: clamp to wrap edges (no imageBox available).
  const scaledW = rect.width * zoom;
  const scaledH = rect.height * zoom;
  const minX = Math.min(0, rect.width - scaledW);
  const minY = Math.min(0, rect.height - scaledH);
  return {
    x: Math.min(0, Math.max(minX, panX)),
    y: Math.min(0, Math.max(minY, panY)),
  };
}

// Keeps the given content point (in unscaled px, relative to the map's own box)
// fixed at the center of the current viewport rect while zooming to `zoom`.
function centeredPan(
  zoom: number,
  contentX: number,
  contentY: number,
  rect: { width: number; height: number },
  imageBox?: { left: number; top: number; width: number; height: number } | null
) {
  const panX = rect.width / 2 - zoom * contentX;
  const panY = rect.height / 2 - zoom * contentY;
  return clampPan(zoom, panX, panY, rect, imageBox);
}

// Pins are stored as a percentage of the *image's own* rendered box, not the
// (possibly letterboxed) wrap box — object-fit:contain can leave empty strips
// on the sides or top/bottom when the wrap's aspect ratio doesn't match the
// image's, and that gap changes with window/viewport size (e.g. F11).
function computeImageBox(
  natural: { w: number; h: number } | null,
  wrap: { w: number; h: number } | null
): { left: number; top: number; width: number; height: number } {
  if (!wrap || !wrap.w || !wrap.h) return { left: 0, top: 0, width: wrap?.w ?? 0, height: wrap?.h ?? 0 };
  if (!natural || !natural.w || !natural.h) return { left: 0, top: 0, width: wrap.w, height: wrap.h };
  const imgAspect = natural.w / natural.h;
  const wrapAspect = wrap.w / wrap.h;
  let width: number, height: number;
  if (imgAspect > wrapAspect) {
    width = wrap.w;
    height = width / imgAspect;
  } else {
    height = wrap.h;
    width = height * imgAspect;
  }
  return { left: (wrap.w - width) / 2, top: (wrap.h - height) / 2, width, height };
}

export function LocationMap({
  locationId,
  locationName,
  settingId,
  mapImageUrl,
  pins,
  mapMaxZoom,
  mapStartZoom,
  mapGotoZoom,
  mapLabelsAlways,
  otherLocations,
  onChange,
}: Props) {
  const maxZoom = mapMaxZoom ?? DEFAULT_MAX_ZOOM;
  const startZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, mapStartZoom ?? DEFAULT_START_ZOOM));
  const gotoZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, mapGotoZoom ?? DEFAULT_GOTO_ZOOM));

  const [resolved, setResolved] = useState<ResolvedPin[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<number | null>(null);
  const [editingStyle, setEditingStyle] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsDraft, setSettingsDraft] = useState({
    maxZoom: "",
    startZoom: "",
    gotoZoom: "",
    labelsAlways: false,
  });
  const [transferOpen, setTransferOpen] = useState(false);
  const [transferTarget, setTransferTarget] = useState<number | null>(null);
  const [transferKeepCopy, setTransferKeepCopy] = useState(false);
  const [transferring, setTransferring] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const [rawPinQuery, setRawPinQuery] = useState("");
  const [pinDropdownOpen, setPinDropdownOpen] = useState(false);
  const [pinTarget, setPinTarget] = useState<ResolvedPin | null>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number } | null>(null);
  const [pinsLoading, setPinsLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; onUndo?: () => void } | null>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const initializedForUrlRef = useRef<string | null>(null);
  const dragState = useRef<{ pinId: number; moved: boolean; x: number; y: number } | null>(null);
  const justDraggedRef = useRef(false);
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(
    null
  );
  const justPannedRef = useRef(false);
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, alertFn] = useAlert();

  function showToast(msg: string, onUndo?: () => void) {
    setToast({ msg, onUndo });
    window.setTimeout(() => setToast((t) => (t?.msg === msg ? null : t)), 5000);
  }

  useEffect(() => {
    if (pins.length === 0) { setResolved([]); return; }
    let cancelled = false;
    setPinsLoading(true);
    resolveEntityMapLabels(pins.map((p) => ({ target_type: p.target_type, target_id: p.target_id })))
      .then((results) => {
        if (cancelled) return;
        const labelMap = new Map(results.map((r) => [`${r.target_type}:${r.target_id}`, r.label]));
        setResolved(
          pins.map((p) => ({
            ...p,
            label: labelMap.get(`${p.target_type}:${p.target_id}`) ?? `${p.target_type} #${p.target_id}`,
          }))
        );
      })
      .catch((err) => {
        if (!cancelled && err?.name !== "AbortError") {
          console.error("Failed to resolve pin labels:", err);
          showToast("Не удалось загрузить подписи пинов");
        }
      })
      .finally(() => {
        if (!cancelled) setPinsLoading(false);
      });
    return () => { cancelled = true; };
  }, [pins]);

  // Track the wrap's own box so pin/image math re-runs whenever it resizes
  // (e.g. toggling browser fullscreen with F11), not just on zoom/pan changes.
  // Re-runs on `fullscreen` too: the wrap is a *different* DOM node inline vs.
  // in the portal, so switching modes needs a fresh observe() call or pins
  // keep using the old node's stale (and eventually disconnected) size.
  useEffect(() => {
    const el = imgWrapRef.current;
    if (!el || !mapImageUrl) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWrapSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [mapImageUrl, fullscreen]);

  useEffect(() => {
    initializedForUrlRef.current = null;
    setNaturalSize(null);
  }, [mapImageUrl]);

  // Centers the view on the image's own box exactly once per loaded map,
  // waiting for natural size / wrap size to be known so it isn't thrown off
  // by any letterboxing from object-fit:contain.
  useEffect(() => {
    if (!mapImageUrl) return;
    if (initializedForUrlRef.current === mapImageUrl) return;
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    const contentX = box.left + box.width / 2;
    const contentY = box.top + box.height / 2;
    const clamped = centeredPan(startZoom, contentX, contentY, rect, box);
    setView({ zoom: startZoom, panX: clamped.x, panY: clamped.y });
    initializedForUrlRef.current = mapImageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapImageUrl, naturalSize, wrapSize]);

  useEffect(() => {
    if (!fullscreen) return;
    // Re-clamp pan when fullscreen changes so the image doesn't appear offset
    // in the new (larger) container.
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    setView((v) => {
      const clamped = clampPan(v.zoom, v.panX, v.panY, rect, box);
      if (clamped.x === v.panX && clamped.y === v.panY) return v;
      return { ...v, panX: clamped.x, panY: clamped.y };
    });
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setFullscreen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen, naturalSize]);

  // React makes onWheel passive by default, so preventDefault() there silently
  // no-ops — attach a real listener to actually stop the page from scrolling.
  useEffect(() => {
    const el = imgWrapRef.current;
    if (!el || !mapImageUrl) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
        const newZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, v.zoom * factor));
        // Already at the zoom limit — leave pan untouched instead of
        // re-centering on the cursor, or it "drives" around the map.
        if (newZoom === v.zoom) return v;
        const contentX = (mx - v.panX) / v.zoom;
        const contentY = (my - v.panY) / v.zoom;
        const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
        const clamped = centeredPan(newZoom, contentX, contentY, rect, box);
        return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [mapImageUrl, fullscreen, maxZoom]);

  // Debounce pin query to avoid re-filtering on every keystroke
  useEffect(() => {
    const t = window.setTimeout(() => setPinQuery(rawPinQuery), 150);
    return () => window.clearTimeout(t);
  }, [rawPinQuery]);

  // Cleanup pan/drag state on unmount to avoid stale refs
  useEffect(() => {
    return () => {
      panState.current = null;
      dragState.current = null;
    };
  }, []);

  function highlight(text: string, query: string): React.ReactNode {
    if (!query.trim()) return text;
    const q = query.trim().toLocaleLowerCase("ru");
    const lower = text.toLocaleLowerCase("ru");
    const idx = lower.indexOf(q);
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", color: "inherit", padding: 0 }}>
          {text.slice(idx, idx + q.length)}
        </mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  function zoomBy(factor: number) {
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const cx = rect.width / 2;
    const cy = rect.height / 2;
    setView((v) => {
      const newZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, v.zoom * factor));
      if (newZoom === v.zoom) return v;
      const contentX = (cx - v.panX) / v.zoom;
      const contentY = (cy - v.panY) / v.zoom;
      const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
      const clamped = centeredPan(newZoom, contentX, contentY, rect, box);
      return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
    });
  }

  function centerMap() {
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    const contentX = box.left + box.width / 2;
    const contentY = box.top + box.height / 2;
    setView((v) => {
      const clamped = centeredPan(v.zoom, contentX, contentY, rect, box);
      return { ...v, panX: clamped.x, panY: clamped.y };
    });
  }

  function resetView() {
    setView({ zoom: 1, panX: 0, panY: 0 });
  }

  async function uploadMap(file: File | null) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) { alertFn("Файл слишком большой. Максимум — 15 МБ."); return; }
    if (!/^image\/(jpeg|png|gif|webp|avif)/.test(file.type)) { alertFn("Недопустимый формат. Используйте JPG, PNG, GIF, WebP или AVIF."); return; }
    setUploading(true);
    try {
      const form = new FormData();
      form.append("file", file);
      await api.post(`/setting-locations/${locationId}/map`, form);
      showToast("Карта загружена");
      onChange();
    } catch {
      alertFn("Не удалось загрузить карту — проверьте соединение с сервером.");
    } finally {
      setUploading(false);
    }
  }

  async function removeMap() {
    const ok = await confirm({
      title: "Убрать карту?",
      message: `Убрать карту локации «${locationName}» и все пины на ней (${pins.length})?`,
      confirmLabel: "Убрать",
      danger: true,
    });
    if (!ok) return;
    try {
      const deleted = await deleteFileWithChoice(`/setting-locations/${locationId}/map`);
      if (!deleted) return;
      showToast("Карта удалена", () => {
        void api.post(`/setting-locations/${locationId}/map/restore`).then(onChange);
      });
      onChange();
    } catch {
      alertFn("Не удалось удалить карту — проверьте соединение с сервером.");
    }
  }

  function addMapToBag() {
    addToBag({ type: "location_map", id: locationId, title: `Карта: ${locationName}` });
  }

  async function transferMap() {
    if (transferTarget == null) return;
    setTransferring(true);
    try {
      await api.post(`/setting-locations/${locationId}/map/transfer`, {
        targetLocationId: transferTarget,
        keepCopy: transferKeepCopy,
      });
      setTransferOpen(false);
      setTransferTarget(null);
      setTransferKeepCopy(false);
      onChange();
    } catch {
      showToast("Не удалось перенести карту — возможно, у выбранной локации уже есть своя карта.");
    } finally {
      setTransferring(false);
    }
  }

  function openSettings() {
    setSettingsDraft({
      maxZoom: String(mapMaxZoom ?? DEFAULT_MAX_ZOOM),
      startZoom: String(mapStartZoom ?? DEFAULT_START_ZOOM),
      gotoZoom: String(mapGotoZoom ?? DEFAULT_GOTO_ZOOM),
      labelsAlways: !!mapLabelsAlways,
    });
    setShowSettings(true);
  }

  function parseDraftNumber(value: string, fallback: number): number {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.min(maxZoom, Math.max(MIN_ZOOM, n));
  }

  function parseSettingNumber(value: string, fallback: number): number {
    const n = Number(value.replace(",", "."));
    if (!Number.isFinite(n) || n <= 0) return fallback;
    return Math.max(MIN_ZOOM, n);
  }

  async function saveSettings() {
    try {
      await api.put(`/setting-locations/${locationId}/map-settings`, {
        max_zoom: parseSettingNumber(settingsDraft.maxZoom, DEFAULT_MAX_ZOOM),
        start_zoom: parseSettingNumber(settingsDraft.startZoom, DEFAULT_START_ZOOM),
        goto_zoom: parseSettingNumber(settingsDraft.gotoZoom, DEFAULT_GOTO_ZOOM),
        labels_always: settingsDraft.labelsAlways,
      });
      setShowSettings(false);
      showToast("Настройки карты сохранены");
      onChange();
    } catch {
      alertFn("Не удалось сохранить настройки карты.");
    }
  }

  function toContentPercent(clientX: number, clientY: number) {
    const el = imgWrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const localX = clientX - rect.left;
    const localY = clientY - rect.top;
    const contentX = (localX - view.panX) / view.zoom;
    const contentY = (localY - view.panY) / view.zoom;
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    return {
      x: box.width ? Math.max(0, Math.min(100, ((contentX - box.left) / box.width) * 100)) : 0,
      y: box.height ? Math.max(0, Math.min(100, ((contentY - box.top) / box.height) * 100)) : 0,
    };
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw || !imgWrapRef.current) return;
    try {
      const result: SearchResult = JSON.parse(raw);
      const { x, y } = toContentPercent(e.clientX, e.clientY);
      api
        .post(`/setting-locations/${locationId}/pins`, {
          target_type: result.type,
          target_id: result.id,
          x,
          y,
        })
        .then(onChange)
        .catch(() => alertFn("Не удалось добавить пин — проверьте соединение с сервером и попробуйте ещё раз."));
    } catch {
      // Silently ignore invalid drag data
    }
  }

  function deselect() {
    setSelectedPinId(null);
    setEditingStyle(false);
  }

  async function removePin(pinId: number) {
    const ok = await confirm({ title: "Удалить пин?", message: "Удалить этот пин с карты?", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    try {
      await api.del(`/setting-locations/pins/${pinId}`);
      if (selectedPinId === pinId) deselect();
      onChange();
    } catch {
      alertFn("Не удалось удалить пин — проверьте соединение с сервером и попробуйте ещё раз.");
    }
  }

  async function duplicatePin(pin: ResolvedPin) {
    if (resolved.length >= MAX_PINS) { alertFn(`Максимум ${MAX_PINS} пинов на одной карте.`); return; }
    try {
      const created = await api.post<LocationPin>(`/setting-locations/${locationId}/pins`, {
        target_type: pin.target_type,
        target_id: pin.target_id,
        x: Math.min(100, pin.x + 4),
        y: Math.min(100, pin.y + 4),
        color: pin.color,
        size: pin.size,
        border_color: pin.border_color,
      });
      setSelectedPinId(created.id);
      showToast("Пин скопирован");
      onChange();
    } catch {
      alertFn("Не удалось скопировать пин — проверьте соединение с сервером и попробуйте ещё раз.");
    }
  }

  function goToTarget(pin: ResolvedPin) {
    const route = DETAIL_ROUTES[pin.target_type];
    if (route) navigate(`${route}/${pin.target_id}`);
  }

  // Local state is updated optimistically for instant feedback while dragging
  // color/size sliders, but if the save itself fails we must resync from the
  // server rather than let the UI silently drift out of sync with what's
  // actually persisted (that drift is what makes pins look like they "reset").
  function revertPinEditOnFailure(err: unknown) {
    console.error(err);
    alertFn("Не удалось сохранить изменение пина — проверьте соединение с сервером. Восстанавливаю последнее сохранённое состояние.");
    onChange();
  }

  function setPinColor(pin: ResolvedPin, color: string | null) {
    setResolved((prev) => prev.map((p) => (p.id === pin.id ? { ...p, color } : p)));
    api
      .put(`/setting-locations/pins/${pin.id}`, color === null ? { clear_color: true } : { color })
      .catch(revertPinEditOnFailure);
  }

  function setPinBorderColor(pin: ResolvedPin, borderColor: string | null) {
    setResolved((prev) => prev.map((p) => (p.id === pin.id ? { ...p, border_color: borderColor } : p)));
    api
      .put(
        `/setting-locations/pins/${pin.id}`,
        borderColor === null ? { clear_border_color: true } : { border_color: borderColor }
      )
      .catch(revertPinEditOnFailure);
  }

  function setPinSize(pin: ResolvedPin, size: number) {
    setResolved((prev) => prev.map((p) => (p.id === pin.id ? { ...p, size } : p)));
    api.put(`/setting-locations/pins/${pin.id}`, { size }).catch(revertPinEditOnFailure);
  }

  function handlePinPointerDown(e: PointerEvent<HTMLSpanElement>, pin: ResolvedPin) {
    if (selectedPinId !== pin.id || !imgWrapRef.current) return;
    e.stopPropagation();
    dragState.current = { pinId: pin.id, moved: false, x: pin.x, y: pin.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePinPointerMove(e: PointerEvent<HTMLSpanElement>, pin: ResolvedPin) {
    if (!dragState.current || dragState.current.pinId !== pin.id || !imgWrapRef.current) return;
    const { x, y } = toContentPercent(e.clientX, e.clientY);
    dragState.current.moved = true;
    dragState.current.x = x;
    dragState.current.y = y;
    setResolved((prev) => prev.map((p) => (p.id === pin.id ? { ...p, x, y } : p)));
  }

  // The pointer-up write is the highest-risk moment for losing a repositioned
  // pin (e.g. a dev-server restart landing exactly here) since it's the one
  // point where a dropped request silently discards real user input. Retry a
  // couple of times before giving up, and if it still fails, resync from the
  // server and tell the user instead of leaving the drag looking "saved" when
  // it wasn't.
  async function putPinPositionWithRetry(pinId: number, x: number, y: number, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        await api.put(`/setting-locations/pins/${pinId}`, { x, y });
        return;
      } catch (err) {
        if (i === attempts - 1) {
          console.error(err);
          alertFn(
            "Не удалось сохранить новое положение пина — проверьте соединение с сервером. Пин вернётся на последнюю сохранённую позицию."
          );
          onChange();
        } else {
          await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
      }
    }
  }

  function handlePinPointerUp(pin: ResolvedPin) {
    if (!dragState.current || dragState.current.pinId !== pin.id) return;
    const { moved, x, y } = dragState.current;
    dragState.current = null;
    if (moved) {
      justDraggedRef.current = true;
      putPinPositionWithRetry(pin.id, x, y);
    }
  }

  function handlePinClick(pin: ResolvedPin) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (selectedPinId === pin.id) {
      deselect();
    } else {
      setSelectedPinId(pin.id);
      setEditingStyle(false);
    }
  }

  function handleWrapPointerDown(e: PointerEvent<HTMLDivElement>) {
    if ((e.target as HTMLElement).closest(".location-map-pin")) return;
    if (view.zoom <= 1) return;
    panState.current = { startX: e.clientX, startY: e.clientY, originX: view.panX, originY: view.panY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handleWrapPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (!panState.current || !imgWrapRef.current) return;
    const dx = e.clientX - panState.current.startX;
    const dy = e.clientY - panState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) panState.current.moved = true;
    const rect = imgWrapRef.current.getBoundingClientRect();
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    const clamped = clampPan(view.zoom, panState.current.originX + dx, panState.current.originY + dy, rect, box);
    setView((v) => ({ ...v, panX: clamped.x, panY: clamped.y }));
  }

  function handleWrapPointerUp() {
    if (panState.current?.moved) justPannedRef.current = true;
    panState.current = null;
  }

  function handleWrapClick() {
    if (justPannedRef.current) {
      justPannedRef.current = false;
      return;
    }
    deselect();
  }

  function selectPinSuggestion(p: ResolvedPin) {
    setPinQuery(p.label);
    setPinTarget(p);
    setPinDropdownOpen(false);
  }

  function goToPin() {
    if (!pinTarget || !imgWrapRef.current) return;
    const rect = imgWrapRef.current.getBoundingClientRect();
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    const contentX = box.left + (pinTarget.x / 100) * box.width;
    const contentY = box.top + (pinTarget.y / 100) * box.height;
    const clamped = centeredPan(gotoZoom, contentX, contentY, rect);
    setView({ zoom: gotoZoom, panX: clamped.x, panY: clamped.y });
    setSelectedPinId(pinTarget.id);
    setEditingStyle(false);
  }

  const pinSuggestions = pinQuery.trim()
    ? resolved.filter((p) => p.label.toLocaleLowerCase("ru").includes(pinQuery.trim().toLocaleLowerCase("ru")))
    : [];

  const debouncedPinQuery = pinQuery;

  const imageBox = computeImageBox(naturalSize, wrapSize);
  const safeMapUrl = mapImageUrl && isSafeImageUrl(mapImageUrl) ? mapImageUrl : null;

  const mapBody = safeMapUrl && (
    <div
      ref={imgWrapRef}
      className={`location-map-wrap${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={handleWrapClick}
      onPointerDown={handleWrapPointerDown}
      onPointerMove={handleWrapPointerMove}
      onPointerUp={handleWrapPointerUp}
    >
      <div
        className="location-map-inner"
        style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}
      >
        <img
          src={safeMapUrl}
          alt=""
          className="location-map-img"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) {
              setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
            }
          }}
        />
        {resolved.map((p) => {
          const isSelected = p.id === selectedPinId;
          const pinSize = p.size ?? DEFAULT_PIN_SIZE;
          const hitSize = pinSize + PIN_HIT_PADDING * 2;
          const typeDefaults = pinDefaultsFor(p.target_type);
          const dotStyle = {
            width: pinSize,
            height: pinSize,
            background: p.color ?? typeDefaults.color,
            borderColor: p.border_color ?? typeDefaults.border,
            cursor: isSelected ? "grab" : "pointer",
          };
          return (
            <div
              key={p.id}
              className={`location-map-pin${isSelected ? " selected" : ""}`}
              style={{
                left: `${imageBox.left + (p.x / 100) * imageBox.width}px`,
                top: `${imageBox.top + (p.y / 100) * imageBox.height}px`,
                width: hitSize,
                height: hitSize,
                transform: `translate(-50%, -50%) scale(${pinCounterScale(view.zoom)})`,
              }}
            >
              <span
                className="location-map-pin-dot"
                style={dotStyle}
                role="button"
                tabIndex={0}
                aria-label={`${p.label}, ${ENTITY_TYPE_LABELS[p.target_type] ?? p.target_type}`}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePinClick(p);
                }}
                onPointerDown={(e) => handlePinPointerDown(e, p)}
                onPointerMove={(e) => handlePinPointerMove(e, p)}
                onPointerUp={() => handlePinPointerUp(p)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handlePinClick(p); } }}
              />
              {!isSelected && (
                <div
                  className={`location-map-pin-label pin-label-${pinLabelBucket(p.target_type)}${mapLabelsAlways ? " always" : ""}`}
                >
                  {p.label}
                </div>
              )}
              {isSelected && (
                <div className="location-map-pin-toolbar" onClick={(e) => e.stopPropagation()}>
                  <strong>{p.label}</strong>
                  <div className="row">
                    {DETAIL_ROUTES[p.target_type] && (
                      <button type="button" onClick={() => goToTarget(p)}>
                        Перейти
                      </button>
                    )}
                    <button type="button" onClick={() => setEditingStyle((v) => !v)}>
                      Отображение
                    </button>
                    <button type="button" onClick={() => duplicatePin(p)}>
                      Дублировать
                    </button>
                    <button type="button" className="danger" onClick={() => removePin(p.id)}>
                      Удалить
                    </button>
                  </div>
                  {editingStyle && (
                    <div className="stack" style={{ gap: 6 }}>
                      <label className="row">
                        Цвет
                        <input
                          type="color"
                          value={p.color ?? pinDefaultsFor(p.target_type).color}
                          onChange={(e) => setPinColor(p, e.target.value)}
                        />
                        <button type="button" onClick={() => setPinColor(p, null)}>
                          По умолчанию
                        </button>
                      </label>
                      <label className="row">
                        Размер
                        <input
                          type="range"
                          min={8}
                          max={32}
                          value={p.size ?? DEFAULT_PIN_SIZE}
                          onChange={(e) => setPinSize(p, Number(e.target.value))}
                        />
                      </label>
                      <label className="row">
                        Обводка
                        <input
                          type="color"
                          value={p.border_color ?? pinDefaultsFor(p.target_type).border}
                          onChange={(e) => setPinBorderColor(p, e.target.value)}
                        />
                        <button type="button" onClick={() => setPinBorderColor(p, null)}>
                          По умолчанию
                        </button>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {pinsLoading && pins.length > 0 && (
        <div className="location-map-pin-loading">Загружаю подписи…</div>
      )}
      <div className="location-map-zoom-controls">
        <button type="button" onClick={() => zoomBy(1.3)} title="Приблизить">
          <NavIcon name="plus" />
        </button>
        <button type="button" onClick={resetView} title="Сбросить масштаб">
          {Math.round(view.zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} title="Отдалить">
          <NavIcon name="minus" />
        </button>
        <button type="button" onClick={centerMap} title="Центрировать карту">
          <NavIcon name="center" />
        </button>
      </div>
      <div className="location-map-legend">
        {LEGEND_ITEMS.map((item) => (
          <div key={item.label} className="location-map-legend-item">
            <span
              className="location-map-legend-dot"
              style={{ background: item.color, borderColor: item.border }}
            />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <>
      <div className="card stack location-map-card">
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <h3>Карта {pins.length > 0 && <span className="map-pin-count">({pins.length} {pins.length === 1 ? "пин" : pins.length < 5 ? "пина" : "пинов"})</span>}</h3>
          {safeMapUrl && (
            <div className="row">
              <button type="button" onClick={openSettings}>
                <NavIcon name="gear" /> Настройки карты
              </button>
              <label className="character-avatar-upload">
                {uploading ? "Загрузка…" : "Заменить карту"}
                <input
                  type="file"
                  accept={IMAGE_ACCEPT}
                  style={{ display: "none" }}
                  onChange={(e) => uploadMap(e.target.files?.[0] ?? null)}
                />
              </label>
              <button className="danger" onClick={removeMap}>
                Убрать карту
              </button>
              {otherLocations && otherLocations.length > 0 && (
                <button type="button" onClick={() => setTransferOpen(true)}>
                  <NavIcon name="swap" /> Перенести карту
                </button>
              )}
              <button type="button" onClick={addMapToBag}>
                <NavIcon name="bag" /> В мешок
              </button>
              <button type="button" onClick={() => setSendOpen(true)}>
                <NavIcon name="arrowRight" /> В сессию
              </button>
              <button type="button" onClick={() => setFullscreen(true)} title="Развернуть на весь экран">
                <NavIcon name="fullscreen" /> На весь экран
              </button>
            </div>
          )}
        </div>
        {!safeMapUrl && (
          <>
            {mapImageUrl && <span className="muted">Карта повреждена или содержит небезопасный URL. Загрузите изображение заново.</span>}
            {!mapImageUrl && <span className="muted">Загрузите изображение карты, чтобы размещать на ней пины.</span>}
            <label className="character-avatar-upload" style={{ alignSelf: "flex-start" }}>
              {uploading ? "Загрузка…" : "Загрузить карту"}
              <input
                type="file"
                accept={IMAGE_ACCEPT}
                style={{ display: "none" }}
                onChange={(e) => uploadMap(e.target.files?.[0] ?? null)}
              />
            </label>
            <span className="muted image-hint">{IMAGE_HINT}</span>
          </>
        )}
        {safeMapUrl && !fullscreen && (
          <>
            {mapBody}
            <div className="location-map-pin-search">
              <input
                placeholder="Найти пин по названию…"
                value={rawPinQuery}
                onChange={(e) => {
                  setRawPinQuery(e.target.value);
                  setPinTarget(null);
                  setPinDropdownOpen(true);
                }}
                onFocus={() => setPinDropdownOpen(true)}
                onBlur={() => setTimeout(() => setPinDropdownOpen(false), 150)}
              />
              {pinDropdownOpen && pinSuggestions.length > 0 && (
                <div className="location-map-pin-search-dropdown">
                  {pinSuggestions.map((p) => (
                    <div
                      key={p.id}
                      className="location-map-pin-search-item"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectPinSuggestion(p)}
                    >
                      <span className="muted">{ENTITY_TYPE_LABELS[p.target_type] ?? p.target_type}</span>{" "}
                      {highlight(p.label, debouncedPinQuery)}
                    </div>
                  ))}
                </div>
              )}
              <button type="button" disabled={!pinTarget} onClick={goToPin}>
                Перейти
              </button>
            </div>
          </>
        )}
        {safeMapUrl && fullscreen && (
          <span className="muted">Карта открыта в полноэкранном режиме.</span>
        )}
      </div>
      {safeMapUrl &&
        fullscreen &&
        createPortal(
          <div className="location-map-fullscreen" role="dialog" aria-modal="true" aria-label="Карта на весь экран" ref={(el) => { if (el) el.focus(); }}>
            <div className="location-map-fullscreen-bar">
              <SearchPanel horizontal />
              <button
                type="button"
                className="location-map-fullscreen-close"
                onClick={() => setFullscreen(false)}
                title="Закрыть (Esc)"
              >
                <NavIcon name="close" />
              </button>
            </div>
            <div className="location-map-card">{mapBody}</div>
          </div>,
          document.body
        )}
      {showSettings && (
        <Modal onClose={() => setShowSettings(false)}>
          <h3>Настройки карты</h3>
          <div className="stack">
            <label className="stack" style={{ gap: 4 }}>
              Максимальный зум (×)
              <input
                type="text"
                inputMode="decimal"
                value={settingsDraft.maxZoom}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, maxZoom: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Предел приближения колесом мыши и кнопками +/−.</span>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              Стартовый зум (при открытии страницы)
              <input
                type="text"
                inputMode="decimal"
                value={settingsDraft.startZoom}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, startZoom: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Какая степень приближения будет установлена при первом открытии карты.</span>
            </label>
            <label className="stack" style={{ gap: 4 }}>
              Зум при переходе к пину
              <input
                type="text"
                inputMode="decimal"
                value={settingsDraft.gotoZoom}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, gotoZoom: e.target.value }))}
              />
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Приближение при нажатии «Перейти» в поиске пинов.</span>
            </label>
            <label className="row">
              <input
                type="checkbox"
                checked={settingsDraft.labelsAlways}
                onChange={(e) => setSettingsDraft((d) => ({ ...d, labelsAlways: e.target.checked }))}
              />
              Всегда показывать подписи пинов
            </label>
            <div className="row">
              <button className="primary" onClick={saveSettings}>
                Сохранить
              </button>
              <button onClick={() => setShowSettings(false)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
      {transferOpen && otherLocations && (
        <Modal onClose={() => setTransferOpen(false)}>
          <h3>Перенести карту</h3>
          <div className="stack">
            <p className="muted">
              Карта и все её пины переедут в выбранную локацию. Если хотите оставить копию карты
              здесь тоже — отметьте флажок ниже.
            </p>
            <LocationCascadePicker locations={otherLocations} value={transferTarget} onChange={setTransferTarget} />
            {transferTarget === locationId && (
              <p className="muted">Нельзя перенести карту в ту же локацию — выберите другую.</p>
            )}
            <label className="row">
              <input
                type="checkbox"
                checked={transferKeepCopy}
                onChange={(e) => setTransferKeepCopy(e.target.checked)}
              />
              Оставить копию карты здесь
            </label>
            <div className="row">
              <button
                className="primary"
                disabled={transferTarget == null || transferTarget === locationId || transferring}
                onClick={transferMap}
              >
                {transferring ? "Переношу…" : "Перенести"}
              </button>
              <button onClick={() => setTransferOpen(false)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
      {sendOpen && (
        <SendMapToSessionModal locationId={locationId} settingId={settingId} onClose={() => setSendOpen(false)} />
      )}
      {confirmDialog}
      {alertDialog}
      {toast && (
        <div className="location-map-toast">
          <span>{toast.msg}</span>
          {toast.onUndo && <button type="button" className="location-map-toast-undo" onClick={() => { const cb = toast.onUndo; setToast(null); cb?.(); }}>Отменить</button>}
          <button type="button" className="location-map-toast-close" onClick={() => setToast(null)} aria-label="Закрыть">×</button>
        </div>
      )}
    </>
  );
}
