// Раскладка верстака по листам А4 (гриллинг 2026-11-11, В7, В17, Q22).
// Блоки идут потоком сверху вниз. Длинный блок режется только там, где
// разрез безопасен (низ строки, низ строки таблицы), и продолжается на
// следующем листе. Половинки встают парами в ряд; ряд не рвётся, а
// половинка выше листа сама становится во всю ширину.
//
// Здесь только арифметика: высоты и точки разреза меряет measure.ts по
// настоящей вёрстке, поэтому раскладка проверяется тестом без браузера.

/** Лист А4 при 96 dpi: 210×297 мм. Высота на полпикселя меньше — без пустого листа в печати. */
export const PAGE_W = 794;
export const PAGE_H = 1122;
export const PAD_TOP = 60;
export const PAD_X = 64;
export const PAD_BOTTOM = 72;
export const CONTENT_W = PAGE_W - PAD_X * 2;
export const CONTENT_H = PAGE_H - PAD_TOP - PAD_BOTTOM;
export const GAP = 26;
export const COL_GAP = 22;
export const HALF_W = (CONTENT_W - COL_GAP) / 2;
/** Короче этого хвост на листе не оставляем — лучше перенести блок целиком. */
const MIN_SLICE = 60;

export type LayoutItem =
  | { id: string; kind: "break" }
  | {
      id: string; kind: "block"; width: "full" | "half"; height: number; breaks: number[]; splittable: boolean;
      /** Для половинки — та же вёрстка во всю ширину: понадобится, если в половину не влезет. */
      full?: { height: number; breaks: number[] };
    };

export interface Piece {
  /** Один блок — во всю ширину; два — ряд половинок (второго может не быть). */
  ids: string[];
  half: boolean;
  from: number;
  to: number;
  /** Кусок продолжает блок с прошлого листа. */
  continued: boolean;
}

export interface Layout {
  pages: Piece[][];
  /** Половинки, которые не влезли в лист и встали во всю ширину (В17). */
  forcedFull: Set<string>;
}

type Block = Extract<LayoutItem, { kind: "block" }>;

export function paginate(items: LayoutItem[], contentHeight = CONTENT_H): Layout {
  const pages: Piece[][] = [[]];
  const forcedFull = new Set<string>();
  let used = 0;
  const newPage = () => { pages.push([]); used = 0; };
  const place = (piece: Piece) => {
    pages[pages.length - 1].push(piece);
    used += (used > 0 ? GAP : 0) + (piece.to - piece.from);
  };
  const avail = () => contentHeight - (used > 0 ? used + GAP : 0);

  const placeFull = (b: Block, height: number, breaks: number[]) => {
    let from = 0;
    for (;;) {
      const rest = height - from;
      const room = avail();
      if (rest <= room) { place({ ids: [b.id], half: false, from, to: height, continued: from > 0 }); return; }
      if (!b.splittable && used > 0) { newPage(); continue; }
      let cut = 0;
      for (const point of breaks) if (point > from && point <= from + room) cut = point;
      if (!b.splittable || cut - from < MIN_SLICE) {
        if (used > 0) { newPage(); continue; }
        // Разрезать негде даже на пустом листе (строка или карточка выше листа):
        // режем по краю листа — текст не теряется, просто строка делится.
        if (cut <= from) cut = from + room;
      }
      place({ ids: [b.id], half: false, from, to: cut, continued: from > 0 });
      newPage();
      from = cut;
    }
  };

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.kind === "break") {
      if (used > 0) newPage();
      continue;
    }
    if (item.width === "full") { placeFull(item, item.height, item.breaks); continue; }
    if (item.height > contentHeight) {
      forcedFull.add(item.id);
      const full = item.full ?? { height: item.height, breaks: item.breaks };
      placeFull(item, full.height, full.breaks);
      continue;
    }
    const next = items[i + 1];
    const pair = next && next.kind === "block" && next.width === "half" && next.height <= contentHeight ? next : null;
    const h = Math.max(item.height, pair ? pair.height : 0);
    if (used > 0 && h > avail()) newPage();
    place({ ids: pair ? [item.id, pair.id] : [item.id], half: true, from: 0, to: h, continued: false });
    if (pair) i++;
  }
  if (pages.length > 1 && pages[pages.length - 1].length === 0) pages.pop();
  return { pages, forcedFull };
}
