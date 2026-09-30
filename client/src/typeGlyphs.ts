// Знаки типов сущностей (решения 2026-09-30, «Знаки типов»): форма группы +
// рисунок — мир круглый оттиск, сюжет квадратный штамп, персонаж и игрок
// звезда. Растр — маска: цвет знака = цвет текста, одна картинка на обе темы.
// URL живут только в fantasy-punk-skin.css (`--skin-glyph-*`) — ссылка на
// /ui/fantasy-punk/ из другого места роняет старт клиента.
import { NODE_COLORS } from "./canvasPalette";

/** Тип сущности -> имя знака (файл semantic/type-glyphs/<имя>.webp). */
const GLYPH_OF: Record<string, string> = {
  being: "being",
  community: "community",
  location: "location",
  artifact: "artifact",
  setting_event: "event",
  character: "character",
  player: "player",
  campaign: "campaign",
  adventure: "adventure",
  scene: "scene",
  session: "session",
};

export function glyphName(type: string): string | null {
  return GLYPH_OF[type] ?? null;
}

/**
 * Окраска типа в графе — палитра Полотна (`NODE_COLORS`), без переключателя:
 * основная масса — существа и места, радуги не выходит. Персонаж и игрок —
 * без цвета (выделялись сильнее всего), событие — инверсия бесцветного,
 * сюжет (кампания, приключение, сцена, сессия) — бумага и тушь.
 */
export type TypeTint = { kind: "color"; color: string } | { kind: "plain" } | { kind: "inverse" };

export function typeTint(type: string): TypeTint {
  if (type === "setting_event") return { kind: "inverse" };
  const c = (NODE_COLORS as Record<string, { color: string } | undefined>)[type];
  if (c && type !== "character") return { kind: "color", color: c.color };
  return { kind: "plain" };
}

// ── Холст: знак, перекрашенный в нужный цвет ─────────────────────
// Канвас не умеет CSS-маску, поэтому маска перекрашивается один раз на
// пару «знак + цвет» в отдельном холсте и дальше рисуется как картинка.

const images = new Map<string, HTMLImageElement | null>();
const tinted = new Map<string, HTMLCanvasElement>();
const listeners = new Set<() => void>();

/** Позвать, когда догрузится знак: холст графа перерисуется. */
export function onGlyphLoad(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function glyphUrl(name: string): string | null {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--skin-glyph-${name}`).trim();
  const m = raw.match(/^url\(["']?([^"')]+)["']?\)$/);
  return m ? m[1] : null;
}

function loadImage(name: string): HTMLImageElement | null {
  if (images.has(name)) {
    const img = images.get(name)!;
    return img && img.complete && img.naturalWidth > 0 ? img : null;
  }
  const url = glyphUrl(name);
  if (!url) { images.set(name, null); return null; }
  const img = new Image();
  img.onload = () => listeners.forEach((fn) => fn());
  img.src = url;
  images.set(name, img);
  return null;
}

/** Знак типа в цвете `color`, или null — пока грузится или знака у типа нет. */
export function tintedGlyph(type: string, color: string): HTMLCanvasElement | null {
  const name = glyphName(type);
  if (!name) return null;
  const key = `${name}|${color}`;
  const hit = tinted.get(key);
  if (hit) return hit;
  const img = loadImage(name);
  if (!img) return null;
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "source-in";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, c.width, c.height);
  tinted.set(key, c);
  return c;
}
