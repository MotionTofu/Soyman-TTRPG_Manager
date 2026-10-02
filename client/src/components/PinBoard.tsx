import { useEffect, useRef, useState, type DragEvent, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { write } from "../data/hooks";
import { showSaveError } from "../data/notices";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { SearchPanel } from "../layout/SearchPanel";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import { NavIcon } from "./NavIcons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { glyphName, typeTint } from "../typeGlyphs";
import { isSafeImageUrl } from "../utils/safeUrl";
import { pickTextOn } from "../themes";
import { useConfirm, useAlert } from "../hooks/useConfirm";
import type { SearchResult } from "../types";

// Картинка с пинами (гриллинг профилей 2026-10-02, Q9; тикет 04): ядро
// карты места, не знающее о месте. Картинка, зум и панорама, пины с
// перетаскиванием, замок, колонка пинов с группами и «Не на …», полный
// экран. Владелец (карта места, чертёж судна) даёт пины, адреса API и то,
// что про пины знает только он: подписи, карточку выбранного, меню.

const MAX_PINS = 100;

/** Пин на картинке. `kind` — тип для знака, цвета и группы в колонке. */
export interface BoardPin {
  id: number;
  kind: string;
  x: number;
  y: number;
  color: string | null;
  size: number | null;
  border_color: string | null;
  /** Подпись на картинке — бывает короткой. */
  label: string;
  /** Полное имя для колонки, если отличается от подписи. */
  fullLabel?: string;
  /** Вид для экранного чтения: «Существо», «Пост». */
  typeLabel?: string;
  /** Подпись видна всегда — метка-подпись чертежа сама и есть текст. */
  alwaysLabel?: boolean;
}

/** То, что тянут на картинку из колонки «Не на …» или из поиска. */
export interface LooseItem {
  key: string;
  label: string;
  drag: Pick<SearchResult, "type" | "id" | "title">;
}

interface Props {
  /** Слова владельца: заголовок полосы и падежи для подсказок. */
  words: { title: string; acc: string; on: string; to: string; away: string };
  imageUrl: string | null;
  pins: BoardPin[];
  pinsLoading?: boolean;
  maxZoom: number;
  startZoom: number;
  gotoZoom: number;
  labelsAlways: boolean;
  /** POST нового пина и PUT/DELETE одного — тело как у пинов карты места. */
  api: { create: string; pin: (id: number) => string };
  onChanged: () => void;
  /** Загрузка картинки; проверку размера и формата ядро делает само. */
  onUpload: (file: File) => Promise<void>;
  uploading: boolean;
  /** Брошенное из поиска или «Не на …» — в тело POST; строка — отказ (тост). */
  dropBody: (item: Pick<SearchResult, "type" | "id" | "title">) => Record<string, unknown> | string;
  /** Тело POST для «Дублировать»: всё, кроме места и вида. */
  duplicateBody: (pin: BoardPin) => Record<string, unknown>;
  groups: { key: string; label: string }[];
  /** Колонка справа: что показать про выбранный пин. */
  renderPicked: (pin: BoardPin) => ReactNode;
  loose?: { items: LooseItem[] };
  /** Кнопки полосы между замком и «На весь экран». */
  barActions?: ReactNode;
  /** Пункты «…»; «Заменить …» ядро вставляет на место `replaceAt`. */
  menuItems: ContextMenuItem[];
  replaceAt?: number;
  /** Подсказка пустой колонки и пустой картинки. */
  emptyPinsHint: string;
  emptyImageHint: string;
  /** Предупреждение о поломанном адресе картинки. */
  brokenImageHint: string;
  showToast: (msg: string, onUndo?: () => void) => void;
  /** Только знаки, без цвета типа — например, метки-подписи. */
  defaultsFor?: (kind: string) => { color: string; border: string } | null;
}

interface View {
  zoom: number;
  panX: number;
  panY: number;
}

const DEFAULT_PIN_COLOR = "#b08968";
const DEFAULT_PIN_BORDER = "#16141c";
const DEFAULT_PIN_SIZE = 14;

// Цвет пина по умолчанию — цвет типа в графах (палитра Полотна), обводка —
// бумага: знак должен читаться поверх любой картинки. Ручной цвет пина
// (панель «Отображение») всегда главнее.
const PIN_HALO = "#fffdf5";
function typeDefaults(kind: string): { color: string; border: string } {
  const tint = typeTint(kind);
  if (tint.kind === "color") return { color: tint.color, border: PIN_HALO };
  if (glyphName(kind)) return { color: DEFAULT_PIN_BORDER, border: PIN_HALO };
  return { color: DEFAULT_PIN_COLOR, border: DEFAULT_PIN_BORDER };
}

// Фон подписи по типу: существо и персонаж — общий «живой» красный, у
// персонажа свой модификатор (index.css).
function pinLabelBucket(kind: string): "being" | "character" | "location" | "artifact" | "label" | "other" {
  if (kind === "being" || kind === "character" || kind === "location" || kind === "artifact" || kind === "label") return kind;
  return "other";
}
const MIN_ZOOM = 1;
// Пины держат экранный размер при любом зуме: растёт картинка, а не знак.
const PIN_HIT_PADDING = 2; // кольцо попадания вокруг видимой точки
function pinCounterScale(zoom: number) {
  if (zoom >= MIN_ZOOM) return 1 / zoom;
  return (1 - (1 - zoom) * 0.15) / zoom;
}

type Box = { left: number; top: number; width: number; height: number };

function clampPan(zoom: number, panX: number, panY: number, rect: { width: number; height: number }, imageBox?: Box | null) {
  if (imageBox) {
    // Края картинки не уходят из окна.
    const minX = rect.width - (imageBox.left + imageBox.width) * zoom;
    const maxX = -imageBox.left * zoom;
    const minY = rect.height - (imageBox.top + imageBox.height) * zoom;
    const maxY = -imageBox.top * zoom;
    // Картинка уже окна по оси — держим её по центру, а не у края: иначе
    // широкий чертёж в высоком окне прилипал к верху.
    const fit = (lo: number, hi: number, v: number) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
    return { x: fit(minX, maxX, panX), y: fit(minY, maxY, panY) };
  }
  const minX = Math.min(0, rect.width - rect.width * zoom);
  const minY = Math.min(0, rect.height - rect.height * zoom);
  return { x: Math.min(0, Math.max(minX, panX)), y: Math.min(0, Math.max(minY, panY)) };
}

// Точка содержимого (в px без масштаба) остаётся в центре окна при зуме.
function centeredPan(zoom: number, contentX: number, contentY: number, rect: { width: number; height: number }, imageBox?: Box | null) {
  return clampPan(zoom, rect.width / 2 - zoom * contentX, rect.height / 2 - zoom * contentY, rect, imageBox);
}

// Пины хранятся в процентах от собственного прямоугольника картинки, а не
// обёртки: object-fit:contain оставляет поля, и они меняются с окном (F11).
function computeImageBox(natural: { w: number; h: number } | null, wrap: { w: number; h: number } | null): Box {
  if (!wrap || !wrap.w || !wrap.h) return { left: 0, top: 0, width: wrap?.w ?? 0, height: wrap?.h ?? 0 };
  if (!natural || !natural.w || !natural.h) return { left: 0, top: 0, width: wrap.w, height: wrap.h };
  const imgAspect = natural.w / natural.h;
  let width: number, height: number;
  if (imgAspect > wrap.w / wrap.h) {
    width = wrap.w;
    height = width / imgAspect;
  } else {
    height = wrap.h;
    width = height * imgAspect;
  }
  return { left: (wrap.w - width) / 2, top: (wrap.h - height) / 2, width, height };
}

function pinWord(n: number): string {
  if (n % 10 === 1 && n % 100 !== 11) return "пин";
  if (n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20)) return "пина";
  return "пинов";
}

export function PinBoard({
  words,
  imageUrl,
  pins,
  pinsLoading,
  maxZoom,
  startZoom: rawStartZoom,
  gotoZoom: rawGotoZoom,
  labelsAlways,
  api,
  onChanged,
  onUpload,
  uploading,
  dropBody,
  duplicateBody,
  groups,
  renderPicked,
  loose,
  barActions,
  menuItems,
  replaceAt = 0,
  emptyPinsHint,
  emptyImageHint,
  brokenImageHint,
  showToast,
  defaultsFor,
}: Props) {
  const startZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, rawStartZoom));
  const gotoZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, rawGotoZoom));
  const pinDefaults = (kind: string) => defaultsFor?.(kind) ?? typeDefaults(kind);

  // Своя копия пинов — под мгновенный отклик при перетаскивании и правке
  // цвета; приходящие с сервера пины её перезаписывают.
  const [items, setItems] = useState<BoardPin[]>(pins);
  useEffect(() => setItems(pins), [pins]);
  const [dragOver, setDragOver] = useState(false);
  const [selectedPinId, setSelectedPinId] = useState<number | null>(null);
  const [editingStyle, setEditingStyle] = useState(false);
  const [view, setView] = useState<View>({ zoom: 1, panX: 0, panY: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [pinQuery, setPinQuery] = useState("");
  const [rawPinQuery, setRawPinQuery] = useState("");
  // «Заблокировать пины» (Q1, Q10): по умолчанию пины двигаются, замок не
  // запоминается.
  const [locked, setLocked] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const [fileDragOver, setFileDragOver] = useState(false);
  const moreRef = useRef<HTMLButtonElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null);
  const [wrapSize, setWrapSize] = useState<{ w: number; h: number } | null>(null);
  const imgWrapRef = useRef<HTMLDivElement>(null);
  const initializedForUrlRef = useRef<string | null>(null);
  const dragState = useRef<{ pinId: number; moved: boolean; x: number; y: number } | null>(null);
  const justDraggedRef = useRef(false);
  const panState = useRef<{ startX: number; startY: number; originX: number; originY: number; moved: boolean } | null>(null);
  const justPannedRef = useRef(false);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, alertFn] = useAlert();
  // Цвет и размер правятся ползунком и палитрой, а они шлют событие на каждое
  // движение. На экране пин уже перекрашен — владелец перечитывает один раз,
  // когда Мастер отпустил ползунок.
  const styleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function changedSoon() {
    if (styleTimer.current) clearTimeout(styleTimer.current);
    styleTimer.current = setTimeout(onChanged, 600);
  }

  // Размер обёртки — чтобы пины пересчитывались при её смене (F11), а не
  // только при зуме. Inline и полноэкранная обёртка — разные узлы.
  useEffect(() => {
    const el = imgWrapRef.current;
    if (!el || !imageUrl) return;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWrapSize({ w: entry.contentRect.width, h: entry.contentRect.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [imageUrl, fullscreen]);

  useEffect(() => {
    initializedForUrlRef.current = null;
    setNaturalSize(null);
  }, [imageUrl]);

  // Один раз на картинку ставит стартовый зум по центру её прямоугольника.
  useEffect(() => {
    if (!imageUrl || initializedForUrlRef.current === imageUrl) return;
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect || !rect.width) return;
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    const clamped = centeredPan(startZoom, box.left + box.width / 2, box.top + box.height / 2, rect, box);
    setView({ zoom: startZoom, panX: clamped.x, panY: clamped.y });
    initializedForUrlRef.current = imageUrl;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [imageUrl, naturalSize, wrapSize]);

  useEffect(() => {
    if (!fullscreen) return;
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

  // onWheel в React пассивный — preventDefault там молча не работает.
  useEffect(() => {
    const el = imgWrapRef.current;
    if (!el || !imageUrl) return;
    function onWheel(e: WheelEvent) {
      e.preventDefault();
      const rect = el!.getBoundingClientRect();
      const mx = e.clientX - rect.left;
      const my = e.clientY - rect.top;
      setView((v) => {
        const newZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, v.zoom * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
        // На пределе зума пан не трогаем, иначе картинка «едет» за курсором.
        if (newZoom === v.zoom) return v;
        const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
        const clamped = centeredPan(newZoom, (mx - v.panX) / v.zoom, (my - v.panY) / v.zoom, rect, box);
        return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
      });
    }
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [imageUrl, fullscreen, maxZoom, naturalSize]);

  useEffect(() => {
    const t = window.setTimeout(() => setPinQuery(rawPinQuery), 150);
    return () => window.clearTimeout(t);
  }, [rawPinQuery]);

  useEffect(() => {
    return () => {
      panState.current = null;
      dragState.current = null;
    };
  }, []);

  function zoomBy(factor: number) {
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    setView((v) => {
      const newZoom = Math.min(maxZoom, Math.max(MIN_ZOOM, v.zoom * factor));
      if (newZoom === v.zoom) return v;
      const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
      const clamped = centeredPan(newZoom, (rect.width / 2 - v.panX) / v.zoom, (rect.height / 2 - v.panY) / v.zoom, rect, box);
      return { zoom: newZoom, panX: clamped.x, panY: clamped.y };
    });
  }

  function centerImage() {
    const rect = imgWrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    setView((v) => {
      const clamped = centeredPan(v.zoom, box.left + box.width / 2, box.top + box.height / 2, rect, box);
      return { ...v, panX: clamped.x, panY: clamped.y };
    });
  }

  async function upload(file: File | null) {
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) {
      alertFn("Файл слишком большой. Максимум — 15 МБ.");
      return;
    }
    if (!/^image\/(jpeg|png|gif|webp|avif)/.test(file.type)) {
      alertFn("Недопустимый формат. Используйте JPG, PNG, GIF, WebP или AVIF.");
      return;
    }
    await onUpload(file);
  }

  function toContentPercent(clientX: number, clientY: number) {
    const el = imgWrapRef.current;
    if (!el) return { x: 0, y: 0 };
    const rect = el.getBoundingClientRect();
    const contentX = (clientX - rect.left - view.panX) / view.zoom;
    const contentY = (clientY - rect.top - view.panY) / view.zoom;
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
    if (locked) {
      showToast("Пины заблокированы — снимите замок, чтобы ставить новые");
      return;
    }
    let dropped: SearchResult;
    try {
      dropped = JSON.parse(raw);
    } catch {
      return; // чужие данные перетаскивания
    }
    const body = dropBody(dropped);
    if (typeof body === "string") {
      showToast(body);
      return;
    }
    const { x, y } = toContentPercent(e.clientX, e.clientY);
    write
      .post(api.create, { ...body, x, y })
      .then(onChanged)
      .catch((err) => showSaveError(`Пин не добавился: ${err instanceof Error ? err.message : String(err)}`));
  }

  function deselect() {
    setSelectedPinId(null);
    setEditingStyle(false);
  }

  async function removePin(pinId: number) {
    const ok = await confirm({ title: "Удалить пин?", message: `Удалить этот пин ${words.on}?`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    try {
      await write.del(api.pin(pinId));
      if (selectedPinId === pinId) deselect();
      onChanged();
    } catch (e) {
      showSaveError(`Пин не удалился: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  async function duplicatePin(pin: BoardPin) {
    if (items.length >= MAX_PINS) {
      alertFn(`Максимум ${MAX_PINS} пинов ${words.on}.`);
      return;
    }
    try {
      const created = await write.post<{ id: number }>(api.create, {
        ...duplicateBody(pin),
        x: Math.min(100, pin.x + 4),
        y: Math.min(100, pin.y + 4),
        color: pin.color,
        size: pin.size,
        border_color: pin.border_color,
      });
      setSelectedPinId(created.id);
      showToast("Пин скопирован");
      onChanged();
    } catch (e) {
      showSaveError(`Пин не скопировался: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Правка цвета и размера видна сразу; если сохранение не прошло,
  // перечитываем сохранённое, а не оставляем экран врать.
  function revertPinEditOnFailure(err: unknown) {
    console.error(err);
    showSaveError(`Пин не сохранился, вернулось сохранённое: ${err instanceof Error ? err.message : String(err)}`);
    onChanged();
  }

  function patchPin(pin: BoardPin, local: Partial<BoardPin>, body: Record<string, unknown>) {
    setItems((prev) => prev.map((p) => (p.id === pin.id ? { ...p, ...local } : p)));
    write.put(api.pin(pin.id), body).then(changedSoon, revertPinEditOnFailure);
  }
  const setPinColor = (pin: BoardPin, color: string | null) =>
    patchPin(pin, { color }, color === null ? { clear_color: true } : { color });
  const setPinBorderColor = (pin: BoardPin, border: string | null) =>
    patchPin(pin, { border_color: border }, border === null ? { clear_border_color: true } : { border_color: border });
  const setPinSize = (pin: BoardPin, size: number) => patchPin(pin, { size }, { size });

  function handlePinPointerDown(e: PointerEvent<HTMLSpanElement>, pin: BoardPin) {
    if (locked || !imgWrapRef.current) return;
    e.stopPropagation();
    dragState.current = { pinId: pin.id, moved: false, x: pin.x, y: pin.y };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function handlePinPointerMove(e: PointerEvent<HTMLSpanElement>, pin: BoardPin) {
    if (!dragState.current || dragState.current.pinId !== pin.id || !imgWrapRef.current) return;
    const { x, y } = toContentPercent(e.clientX, e.clientY);
    Object.assign(dragState.current, { moved: true, x, y });
    setItems((prev) => prev.map((p) => (p.id === pin.id ? { ...p, x, y } : p)));
  }

  // Отпускание пина — самый рискованный момент: сорвавшийся запрос молча
  // теряет передвинутый пин. Пара повторов, потом честное «не сохранилось».
  async function putPinPositionWithRetry(pinId: number, x: number, y: number, attempts = 3) {
    for (let i = 0; i < attempts; i++) {
      try {
        await write.put(api.pin(pinId), { x, y });
        onChanged();
        return;
      } catch (err) {
        if (i === attempts - 1) {
          console.error(err);
          showSaveError(`Положение пина не сохранилось, он вернулся на прежнее место: ${err instanceof Error ? err.message : String(err)}`);
          onChanged();
        } else {
          await new Promise((r) => setTimeout(r, 300 * (i + 1)));
        }
      }
    }
  }

  function handlePinPointerUp(pin: BoardPin) {
    if (!dragState.current || dragState.current.pinId !== pin.id) return;
    const { moved, x, y } = dragState.current;
    dragState.current = null;
    if (moved) {
      justDraggedRef.current = true;
      void putPinPositionWithRetry(pin.id, x, y);
    }
  }

  function handlePinClick(pin: BoardPin) {
    if (justDraggedRef.current) {
      justDraggedRef.current = false;
      return;
    }
    if (selectedPinId !== pin.id) {
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

  // Щелчок по строке колонки: подлететь к пину и выбрать его.
  function goToPin(pin: BoardPin) {
    setSelectedPinId(pin.id);
    setEditingStyle(false);
    if (!imgWrapRef.current) return;
    const rect = imgWrapRef.current.getBoundingClientRect();
    const box = computeImageBox(naturalSize, { w: rect.width, h: rect.height });
    const clamped = centeredPan(gotoZoom, box.left + (pin.x / 100) * box.width, box.top + (pin.y / 100) * box.height, rect, box);
    setView({ zoom: gotoZoom, panX: clamped.x, panY: clamped.y });
  }

  const imageBox = computeImageBox(naturalSize, wrapSize);
  const safeUrl = imageUrl && isSafeImageUrl(imageUrl) ? imageUrl : null;
  const fullName = (p: BoardPin) => p.fullLabel ?? p.label;

  const board = safeUrl && (
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
      {/* инлайн-стили намеренно — зум и пан считаются на лету */}
      <div className="location-map-inner" style={{ transform: `translate(${view.panX}px, ${view.panY}px) scale(${view.zoom})` }}>
        <img
          src={safeUrl}
          alt=""
          className="location-map-img"
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget;
            if (img.naturalWidth && img.naturalHeight) setNaturalSize({ w: img.naturalWidth, h: img.naturalHeight });
          }}
        />
        {items.map((p) => {
          const isSelected = p.id === selectedPinId;
          const defaults = pinDefaults(p.kind);
          // Знак типа — на круглой подложке: белой под тёмный знак, чёрной под
          // светлый. Знак крупнее точки: рисунок на 14 px не читается.
          const glyph = glyphName(p.kind);
          const pinSize = Math.round((p.size ?? DEFAULT_PIN_SIZE) * (glyph ? 1.6 : 1));
          const hitSize = pinSize + PIN_HIT_PADDING * 2;
          const glyphColor = p.color ?? defaults.color;
          const dotStyle = glyph
            ? {
                width: pinSize,
                height: pinSize,
                background: pickTextOn(glyphColor),
                borderColor: p.border_color ?? "transparent",
                color: glyphColor,
                cursor: locked ? "pointer" : "grab",
              }
            : {
                width: pinSize,
                height: pinSize,
                background: p.color ?? defaults.color,
                borderColor: p.border_color ?? defaults.border,
                cursor: locked ? "pointer" : "grab",
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
                className={glyph ? "location-map-pin-disc" : "location-map-pin-dot"}
                style={dotStyle}
                role="button"
                tabIndex={0}
                aria-label={p.typeLabel ? `${p.label}, ${p.typeLabel}` : p.label}
                onClick={(e) => {
                  e.stopPropagation();
                  handlePinClick(p);
                }}
                onPointerDown={(e) => handlePinPointerDown(e, p)}
                onPointerMove={(e) => handlePinPointerMove(e, p)}
                onPointerUp={() => handlePinPointerUp(p)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handlePinClick(p);
                  }
                }}
              >
                {glyph && <span className={`location-map-pin-glyph type-glyph type-glyph--${glyph}`} aria-hidden="true" />}
              </span>
              <div className={`location-map-pin-label pin-label-${pinLabelBucket(p.kind)}${labelsAlways || isSelected || p.alwaysLabel ? " always" : ""}`}>
                {p.label}
              </div>
            </div>
          );
        })}
      </div>
      {pinsLoading && pins.length > 0 && <div className="location-map-pin-loading">Загружаю подписи…</div>}
      <div className="location-map-zoom-controls">
        <button type="button" onClick={() => zoomBy(1.3)} title="Приблизить">
          <NavIcon name="plus" />
        </button>
        <button type="button" onClick={() => setView({ zoom: 1, panX: 0, panY: 0 })} title="Сбросить масштаб">
          {Math.round(view.zoom * 100)}%
        </button>
        <button type="button" onClick={() => zoomBy(1 / 1.3)} title="Отдалить">
          <NavIcon name="minus" />
        </button>
        <button type="button" onClick={centerImage} title="Центрировать">
          <NavIcon name="center" />
        </button>
      </div>
    </div>
  );

  const selected = items.find((p) => p.id === selectedPinId) ?? null;
  const q = pinQuery.trim().toLocaleLowerCase("ru");
  const shownPins = q ? items.filter((p) => `${p.label} ${fullName(p)}`.toLocaleLowerCase("ru").includes(q)) : items;
  const groupKeys = groups.map((g) => g.key);
  const fallbackGroup = groupKeys[groupKeys.length - 1];
  const pinGroups = groups
    .map((g) => ({
      ...g,
      pins: shownPins
        .filter((p) => (groupKeys.includes(p.kind) ? p.kind === g.key : g.key === fallbackGroup))
        .sort((a, b) => fullName(a).localeCompare(fullName(b), "ru", { numeric: true })),
    }))
    .filter((g) => g.pins.length > 0);
  const looseItems = loose?.items ?? [];

  function openMenu() {
    const r = moreRef.current?.getBoundingClientRect();
    if (r) setMenuAt({ x: r.right, y: r.bottom });
  }
  const allMenuItems: ContextMenuItem[] = [...menuItems];
  allMenuItems.splice(replaceAt, 0, { label: `Заменить ${words.acc}…`, onClick: () => fileRef.current?.click() });

  return (
    <>
      <div className="location-map-sheet">
        <div className="location-map-bar">
          <h2 className="location-map-bar__title">
            {words.title}{" "}
            {pins.length > 0 && (
              <span className="location-map-bar__count">
                · {pins.length} {pinWord(pins.length)}
              </span>
            )}
          </h2>
          <span className="location-map-bar__spacer" />
          {safeUrl && (
            <>
              {/* Замок не запоминается: каждый раз пины подвижны (Q1, Q10). */}
              <button
                type="button"
                className={`location-map-lock${locked ? " is-on" : ""}`}
                aria-pressed={locked}
                onClick={() => {
                  setLocked((v) => !v);
                  setEditingStyle(false);
                }}
              >
                <NavIcon name={locked ? "lock" : "unlock"} /> {locked ? "Пины заблокированы" : "Заблокировать пины"}
              </button>
              {barActions}
              <button type="button" onClick={() => setFullscreen(true)} title="Развернуть на весь экран">
                <NavIcon name="fullscreen" /> На весь экран
              </button>
              <button ref={moreRef} type="button" aria-label={`Ещё действия: ${words.title}`} aria-haspopup="menu" onClick={openMenu}>
                …
              </button>
            </>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={IMAGE_ACCEPT}
            hidden
            onChange={(e) => {
              void upload(e.target.files?.[0] ?? null);
              e.target.value = "";
            }}
          />
        </div>

        {!safeUrl && (
          <label
            className={`location-map-empty${fileDragOver ? " drag-over" : ""}`}
            onDragOver={(e) => {
              e.preventDefault();
              setFileDragOver(true);
            }}
            onDragLeave={() => setFileDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setFileDragOver(false);
              void upload(e.dataTransfer.files?.[0] ?? null);
            }}
          >
            <span className="location-map-empty__title">
              {uploading ? "Загрузка…" : `Перетащите сюда ${words.acc}`}
            </span>
            <span>
              или <span className="location-map-empty__pick">выберите файл</span>
            </span>
            {imageUrl && <span className="muted">{brokenImageHint}</span>}
            <span className="muted">{IMAGE_HINT}</span>
            <span className="muted">{emptyImageHint}</span>
            <input type="file" accept={IMAGE_ACCEPT} hidden onChange={(e) => void upload(e.target.files?.[0] ?? null)} />
          </label>
        )}

        {safeUrl && (
          <div className="location-map-split">
            {fullscreen ? <div className="location-map-away muted">{words.away}</div> : board}
            <aside className="location-map-side" aria-label="Пины">
              <input
                type="search"
                className="location-map-side__search"
                placeholder="Найти пин…"
                aria-label="Найти пин"
                value={rawPinQuery}
                onChange={(e) => setRawPinQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && shownPins[0]) goToPin(shownPins[0]);
                  if (e.key === "Escape") setRawPinQuery("");
                }}
              />

              {selected && (
                <div className="location-map-picked">
                  {renderPicked(selected)}
                  {!locked && (
                    <div className="location-map-tools">
                      <button type="button" aria-pressed={editingStyle} onClick={() => setEditingStyle((v) => !v)}>
                        Отображение
                      </button>
                      <button type="button" onClick={() => void duplicatePin(selected)}>
                        Дублировать
                      </button>
                      <button type="button" className="is-danger" onClick={() => void removePin(selected.id)}>
                        Удалить
                      </button>
                    </div>
                  )}
                  {!locked && editingStyle && (
                    <div className="location-map-style">
                      <label>
                        Цвет
                        <input
                          type="color"
                          value={selected.color ?? pinDefaults(selected.kind).color}
                          onChange={(e) => setPinColor(selected, e.target.value)}
                        />
                        <button type="button" className="comp-mini" onClick={() => setPinColor(selected, null)}>
                          По умолчанию
                        </button>
                      </label>
                      <label>
                        Размер
                        <input
                          type="range"
                          min={8}
                          max={32}
                          value={selected.size ?? DEFAULT_PIN_SIZE}
                          onChange={(e) => setPinSize(selected, Number(e.target.value))}
                        />
                      </label>
                      <label>
                        Обводка
                        <input
                          type="color"
                          value={selected.border_color ?? pinDefaults(selected.kind).border}
                          onChange={(e) => setPinBorderColor(selected, e.target.value)}
                        />
                        <button type="button" className="comp-mini" onClick={() => setPinBorderColor(selected, null)}>
                          По умолчанию
                        </button>
                      </label>
                    </div>
                  )}
                </div>
              )}

              {pinGroups.map((g) => (
                <div key={g.key} className="location-map-group">
                  <span className="paper-label">
                    {g.label} · {g.pins.length}
                  </span>
                  {g.pins.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      className={`location-map-row${p.id === selectedPinId ? " is-on" : ""}`}
                      aria-current={p.id === selectedPinId ? "true" : undefined}
                      onClick={() => goToPin(p)}
                    >
                      {/* инлайн-стиль намеренно — цвет пина задаёт Мастер */}
                      <span
                        className="location-map-row__mark"
                        style={p.id === selectedPinId ? undefined : { color: p.color ?? pinDefaults(p.kind).color }}
                      >
                        {glyphName(p.kind) ? (
                          <span className={`type-glyph type-glyph--${glyphName(p.kind)}`} aria-hidden="true" />
                        ) : (
                          <span className="location-map-row__dot" aria-hidden="true" />
                        )}
                      </span>
                      <span className="location-map-row__name">{fullName(p)}</span>
                    </button>
                  ))}
                </div>
              ))}
              {items.length > 0 && shownPins.length === 0 && <span className="muted">Таких пинов нет.</span>}
              {pins.length === 0 && <span className="muted">{emptyPinsHint}</span>}

              {looseItems.length > 0 && (
                <div className="location-map-loose">
                  <span className="paper-label location-map-loose__head">
                    Не {words.on} · {looseItems.length}
                    <span className="location-map-loose__hint">{locked ? "сними замок, чтобы ставить" : `тяни ${words.to}`}</span>
                  </span>
                  <div className="location-map-loose__items">
                    {looseItems.map((l) => (
                      <span
                        key={l.key}
                        className="location-map-loose__item"
                        draggable={!locked}
                        aria-disabled={locked || undefined}
                        title={locked ? undefined : `Перетащите ${words.to}`}
                        onDragStart={(e) => {
                          e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify(l.drag));
                          e.dataTransfer.effectAllowed = "copy";
                        }}
                      >
                        {l.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        )}
      </div>
      {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={allMenuItems} onClose={() => setMenuAt(null)} />}
      {safeUrl &&
        fullscreen &&
        createPortal(
          <div
            className="location-map-fullscreen"
            role="dialog"
            aria-modal="true"
            aria-label={`${words.title} на весь экран`}
            ref={(el) => {
              if (el) el.focus();
            }}
          >
            <div className="location-map-fullscreen-bar">
              <SearchPanel horizontal />
              <button type="button" className="location-map-fullscreen-close" onClick={() => setFullscreen(false)} title="Закрыть (Esc)">
                <NavIcon name="close" />
              </button>
            </div>
            <div className="location-map-card">{board}</div>
          </div>,
          document.body
        )}
      {confirmDialog}
      {alertDialog}
    </>
  );
}
