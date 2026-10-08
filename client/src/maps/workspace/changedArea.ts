import type { MapDocumentV6 } from "@shared/maps/core";
import { shapeBounds } from "../scatter";
import { labelBox } from "../labelStyle";
import type { SelectionRect } from "./multiSelection";

type Layer = MapDocumentV6["layers"][number];
type Entry = { id: string; item: unknown; bounds: SelectionRect };
// Запас вокруг предмета, клеток: тень, обводка выбора, подпись фишки. Что не влезло — дорисует сцена, когда рука остановится.
const PAD = 0.25;

/** Предметы слоя с рамкой того, что они рисуют. null — по слою нельзя сказать, где он изменился (клетки, комнаты). */
function entries(layer: Layer): Entry[] | null {
  if (layer.kind === "object") return layer.items.map(item => {
    const { position, scale, rotation } = item.transform, angle = rotation * Math.PI / 180;
    const w = Math.abs(scale.x * Math.cos(angle)) + Math.abs(scale.y * Math.sin(angle)), h = Math.abs(scale.x * Math.sin(angle)) + Math.abs(scale.y * Math.cos(angle));
    return { id: item.id, item, bounds: { x: position.x - w / 2, y: position.y - h / 2, w, h } };
  });
  if (layer.kind === "scatter") return layer.areas.map(item => {
    const b = shapeBounds(item.shape), pad = Number(item.overrides?.size ?? 1) * 2; // символ у края области выходит за неё
    return { id: item.id, item, bounds: { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 } };
  });
  if (layer.kind === "path") {
    const out: Entry[] = [];
    for (const item of layer.paths) {
      if (item.geometry.type !== "spline") return null;
      const points = item.geometry.nodes.flatMap(node => [node.position, ...(node.in ? [node.in] : []), ...(node.out ? [node.out] : [])]);
      const xs = points.map(p => p.x), ys = points.map(p => p.y), x = Math.min(...xs), y = Math.min(...ys);
      const width = Math.max(item.width, ...item.geometry.nodes.map(node => node.width ?? item.width));
      out.push({ id: item.id, item, bounds: { x: x - width / 2, y: y - width / 2, w: Math.max(...xs) - x + width, h: Math.max(...ys) - y + width } });
    }
    return out;
  }
  if (layer.kind === "terrain" && layer.representation === "mask") {
    // Край мазка растушёван на соседние куски поверхности, отсюда запас в полторы клетки.
    const { origin, sampleSize } = layer.mask, pad = 1.5 - PAD;
    return layer.mask.chunks.map(item => ({ side: Math.sqrt(item.payload.values.length) * sampleSize, item })).map(({ side, item }) => ({ id: `${item.cx}:${item.cy}`, item: item.payload, bounds: { x: origin.x + item.cx * side - pad, y: origin.y + item.cy * side - pad, w: side + pad * 2, h: side + pad * 2 } }));
  }
  if (layer.kind === "gameplay") return layer.items.map(item => item.kind === "token"
    ? { id: item.id, item, bounds: { x: item.position.x - item.size / 2, y: item.position.y - item.size / 2, w: item.size, h: item.size } }
    : { id: item.id, item, bounds: { x: NaN, y: 0, w: 0, h: 0 } }); // комната или дверь меняет стены вокруг: рамки нет
  if (layer.kind === "label") return layer.items.map(item => ({ id: item.id, item, bounds: labelBox(item) }));
  return null;
}
const rest = (value: object, skip: readonly string[]) => JSON.stringify(value, (key, inner) => skip.includes(key) ? undefined : inner);

/**
 * Область карты (в клетках), которую задела правка между двумя документами.
 * null — неизвестно: перерисовывать надо всё; пустая область — картинка не изменилась. Нужна, чтобы перетаскивание предмета
 * перерисовывало плитки вокруг него, а не весь экран.
 */
export function changedArea(before: MapDocumentV6, after: MapDocumentV6): SelectionRect | null {
  if (before.layers.length !== after.layers.length || rest(before, ["layers"]) !== rest(after, ["layers"])) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < after.layers.length; i++) {
    const a = before.layers[i], b = after.layers[i];
    if (a === b) continue;
    const skip = ["items", "paths", "areas", "chunks"];
    if (a.id !== b.id || rest(a, skip) !== rest(b, skip)) return null;
    const old = entries(a), next = entries(b);
    if (!old || !next) return null;
    const oldById = new Map(old.map(entry => [entry.id, entry])), nextIds = new Set(next.map(entry => entry.id));
    // Порядок предметов — это порядок наложения: его смена меняет картинку там, где рамок нет.
    if (b.kind !== "terrain" && old.length === next.length && old.some((entry, j) => entry.id !== next[j].id)) return null;
    const same = (p: Entry, q: Entry) => p.item === q.item || JSON.stringify(p.item) === JSON.stringify(q.item);
    const touched = [...next.filter(entry => { const was = oldById.get(entry.id); return !was || !same(was, entry); }).flatMap(entry => [entry, ...(oldById.has(entry.id) ? [oldById.get(entry.id)!] : [])]),
      ...old.filter(entry => !nextIds.has(entry.id))];
    for (const { bounds } of touched) {
      if (!Number.isFinite(bounds.x + bounds.y + bounds.w + bounds.h)) return null;
      x0 = Math.min(x0, bounds.x - PAD); y0 = Math.min(y0, bounds.y - PAD); x1 = Math.max(x1, bounds.x + bounds.w + PAD); y1 = Math.max(y1, bounds.y + bounds.h + PAD);
    }
  }
  return x0 <= x1 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : { x: 0, y: 0, w: 0, h: 0 };
}
