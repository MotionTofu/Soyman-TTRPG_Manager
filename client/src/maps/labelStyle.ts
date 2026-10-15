import type { MapDocumentV6, MapLabel } from "@shared/maps/core";
import "../caveat.css";

/** Шрифты подписей карты: только те, что уже лежат в приложении. Ключ хранится в карте. */
export const LABEL_FONTS: Readonly<Record<string, { name: string; family: string }>> = {
  dirt: { name: "Грязный", family: '"Rubik Dirt", sans-serif' },
  zelek: { name: "Заголовочный", family: '"NewZelek", sans-serif' },
  punk: { name: "Панк", family: '"RussianPunk", sans-serif' },
  rookie: { name: "Панк неровный", family: '"RookiePunk", sans-serif' },
  caveat: { name: "Рукописный", family: '"Caveat", cursive' },
};
export const labelFamily = (font: string | undefined) => font ? LABEL_FONTS[font]?.family : undefined;

type Sized = Pick<MapLabel, "position" | "text" | "style">;
/** Рамка подписи в клетках, с запасом: по ней подпись выбирают кликом и перерисовывают при перетаскивании.
 * Без своего размера буквы заданы в экранных точках — берём самый мелкий масштаб, где подпись ещё видна
 * (12 точек на клетку); шире восьми клеток такой текст не рисуется. */
export function labelBox(label: Sized) {
  const size = label.style?.size, spread = 1 + (label.style?.spacing ?? 0);
  const w = size ? label.text.length * size * 0.7 * spread + size : Math.min(8, label.text.length * 0.6 * spread + 0.5), up = size ? size * 1.3 + 0.2 : 1.2;
  // Изогнутая или повёрнутая подпись может уйти в любую сторону от точки — рамка квадратом вокруг неё.
  if (label.style?.bend || label.style?.rotation) return { x: label.position.x - w / 2, y: label.position.y - w / 2 - up, w, h: w + up + 0.3 };
  return { x: label.position.x - w / 2, y: label.position.y - up, w, h: up + 0.3 };
}

/** Холст рисует шрифтом, только когда тот загружен. Возвращает true, если что-то догрузилось и карту надо перерисовать. */
export async function prepareLabelFonts(map: MapDocumentV6): Promise<boolean> {
  if (typeof document === "undefined" || !document.fonts?.load) return false;
  const wanted = new Set<string>();
  for (const layer of map.layers) if (layer.kind === "label") for (const item of layer.items) {
    const family = labelFamily(item.style?.font);
    if (family) wanted.add(`${item.style?.italic ? "italic " : ""}${item.style?.bold ? 700 : 500} 16px ${family}`);
  }
  const missing = [...wanted].filter(font => !document.fonts.check(font));
  await Promise.all(missing.map(font => document.fonts.load(font).catch(() => undefined)));
  return missing.length > 0;
}
