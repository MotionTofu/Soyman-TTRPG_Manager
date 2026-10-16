// Подложка для обрисовки (гриллинг 2026-10-16, П1–П16): размеры, ручки и перетаскивание картинки. Всё в мировых координатах.
import type { MapDocumentV6, ReferenceImage, Vec2 } from "@shared/maps/core";
import type { ReferencePatch } from "../core/mutations/references";

type Bounds = { minX: number; minY: number; maxX: number; maxY: number };
const FULL = { x0: 0, y0: 0, x1: 1, y1: 1 };
const MIN_SIDE = 0.25;

/** Размер всей картинки и видимой (обрезанной) части, мир. */
export function referenceSize(item: Pick<ReferenceImage, "width" | "pixels" | "crop">) {
  const c = item.crop ?? FULL, h = item.width * item.pixels.h / item.pixels.w;
  return { w: item.width, h, vw: (c.x1 - c.x0) * item.width, vh: (c.y1 - c.y0) * h };
}
const turn = (v: Vec2, deg: number): Vec2 => { const a = deg * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return { x: v.x * c - v.y * s, y: v.x * s + v.y * c }; };
/** Точка мира в осях картинки (центр видимой части — ноль, без поворота). */
export const toLocal = (item: ReferenceImage, p: Vec2) => turn({ x: p.x - item.position.x, y: p.y - item.position.y }, -item.rotation);
export const fromLocal = (item: Pick<ReferenceImage, "position" | "rotation">, v: Vec2): Vec2 => { const t = turn(v, item.rotation); return { x: item.position.x + t.x, y: item.position.y + t.y }; };
export function referenceHit(item: ReferenceImage, p: Vec2): boolean {
  const { vw, vh } = referenceSize(item), l = toLocal(item, p);
  return Math.abs(l.x) <= vw / 2 && Math.abs(l.y) <= vh / 2;
}

/** Картинки слоя сверху вниз: первая под точкой — верхняя. */
export function referenceAt(document: MapDocumentV6, layerId: string, p: Vec2): ReferenceImage | null {
  const layer = document.layers.find((entry) => entry.id === layerId);
  if (layer?.kind !== "reference") return null;
  return [...layer.items].reverse().find((item) => referenceHit(item, p)) ?? null;
}

// Размер (П6). «Клеток» и «точек на клетку» — по видимой части и по ширине клетки сетки.
export const cellsAcross = (item: ReferenceImage, cell: number) => referenceSize(item).vw / cell;
export const pixelsPerCell = (item: Pick<ReferenceImage, "width" | "pixels">, cell: number) => item.pixels.w * cell / item.width;
/** Ширина всей картинки, при которой видимая часть займёт `cells` клеток. */
export function widthForCells(item: ReferenceImage, cells: number, cell: number) {
  const c = item.crop ?? FULL;
  return Math.max(MIN_SIDE, cells * cell / (c.x1 - c.x0));
}
export const widthForPixels = (item: Pick<ReferenceImage, "pixels">, ppc: number, cell: number) => item.pixels.w * cell / Math.max(1, ppc);
/** По ширине, по высоте карты или целиком в карту: видимая часть — в середину карты. */
export function fitReference(item: ReferenceImage, bounds: Bounds, how: "width" | "height" | "whole"): ReferencePatch {
  const c = item.crop ?? FULL, aspect = item.pixels.h / item.pixels.w;
  // Повёрнутая картинка вписывается по своей рамке на карте, а не по сторонам.
  const a = item.rotation * Math.PI / 180, cos = Math.abs(Math.cos(a)), sin = Math.abs(Math.sin(a));
  const vw1 = c.x1 - c.x0, vh1 = (c.y1 - c.y0) * aspect; // видимая часть при ширине картинки 1
  const across = vw1 * cos + vh1 * sin, down = vw1 * sin + vh1 * cos;
  const byWidth = (bounds.maxX - bounds.minX) / across, byHeight = (bounds.maxY - bounds.minY) / down;
  const width = how === "width" ? byWidth : how === "height" ? byHeight : Math.min(byWidth, byHeight);
  return { width, position: { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 } };
}

/** Новая картинка (П13): первая — целиком в карту, следующие — тем же «точек на клетку», что предыдущая, в точку `at`. */
export function placeReference(id: string, image: string, pixels: { w: number; h: number }, bounds: Bounds, at: Vec2, previous: ReferenceImage | null): ReferenceImage {
  const item: ReferenceImage = { id, image, pixels, position: at, width: 1, rotation: 0, opacity: 1 };
  if (!previous) return { ...item, ...fitReference(item, bounds, "whole") } as ReferenceImage;
  return { ...item, width: previous.width * pixels.w / previous.pixels.w };
}

export type ReferenceHandle = { kind: "move" } | { kind: "corner"; sx: 1 | -1; sy: 1 | -1 } | { kind: "rotate" } | { kind: "edge"; side: "left" | "right" | "top" | "bottom" };
/** Ручки выбранной картинки на экране; `scale` — точек экрана на единицу мира. Отступ ручки поворота — в точках экрана. */
export function referenceHandles(item: ReferenceImage, scale: number, cropping: boolean): { handle: ReferenceHandle; at: Vec2 }[] {
  const { vw, vh } = referenceSize(item), out: { handle: ReferenceHandle; at: Vec2 }[] = [];
  if (cropping) for (const [side, x, y] of [["left", -vw / 2, 0], ["right", vw / 2, 0], ["top", 0, -vh / 2], ["bottom", 0, vh / 2]] as const)
    out.push({ handle: { kind: "edge", side }, at: fromLocal(item, { x, y }) });
  else {
    for (const sx of [-1, 1] as const) for (const sy of [-1, 1] as const) out.push({ handle: { kind: "corner", sx, sy }, at: fromLocal(item, { x: sx * vw / 2, y: sy * vh / 2 }) });
    out.push({ handle: { kind: "rotate" }, at: fromLocal(item, { x: 0, y: -vh / 2 - 28 / scale }) });
  }
  return out;
}

/** Что даёт перетаскивание ручки от `from` до `to` (мир). `start` — картинка в начале жеста. */
export function dragReference(start: ReferenceImage, handle: ReferenceHandle, from: Vec2, to: Vec2, shift: boolean): ReferencePatch {
  if (handle.kind === "move") return { position: { x: start.position.x + to.x - from.x, y: start.position.y + to.y - from.y } };
  if (handle.kind === "rotate") {
    const angle = (p: Vec2) => Math.atan2(p.y - start.position.y, p.x - start.position.x) * 180 / Math.PI;
    let rotation = start.rotation + angle(to) - angle(from);
    rotation = shift ? Math.round(rotation / 15) * 15 : Math.round(rotation * 10) / 10;
    return { rotation: ((rotation % 360) + 540) % 360 - 180 };
  }
  const { w, h, vw, vh } = referenceSize(start), local = toLocal(start, to);
  if (handle.kind === "corner") {
    // Противоположный угол стоит на месте, пропорции сохраняются.
    const opposite = { x: -handle.sx * vw / 2, y: -handle.sy * vh / 2 }, diagonal = { x: handle.sx * vw, y: handle.sy * vh };
    const f = Math.max(MIN_SIDE / vw, ((local.x - opposite.x) * diagonal.x + (local.y - opposite.y) * diagonal.y) / (diagonal.x ** 2 + diagonal.y ** 2));
    return { width: start.width * f, position: fromLocal(start, { x: opposite.x + diagonal.x * f / 2, y: opposite.y + diagonal.y * f / 2 }) };
  }
  // Обрезка: двигается одна сторона, противоположная стоит на месте.
  const c = start.crop ?? FULL, left = -vw / 2 - c.x0 * w, top = -vh / 2 - c.y0 * h, gap = 0.02;
  const crop = { ...c };
  if (handle.side === "left") crop.x0 = Math.max(0, Math.min(c.x1 - gap, (local.x - left) / w));
  if (handle.side === "right") crop.x1 = Math.min(1, Math.max(c.x0 + gap, (local.x - left) / w));
  if (handle.side === "top") crop.y0 = Math.max(0, Math.min(c.y1 - gap, (local.y - top) / h));
  if (handle.side === "bottom") crop.y1 = Math.min(1, Math.max(c.y0 + gap, (local.y - top) / h));
  const center = { x: left + (crop.x0 + crop.x1) / 2 * w, y: top + (crop.y0 + crop.y1) / 2 * h };
  const whole = crop.x0 === 0 && crop.y0 === 0 && crop.x1 === 1 && crop.y1 === 1;
  return { crop: whole ? null : crop, position: fromLocal(start, center) };
}
