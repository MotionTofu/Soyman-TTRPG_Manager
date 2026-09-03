// Общие типы и пресеты раздела «Карты» (UI-слой, без математики сетки —
// она приедет в тикете 03). Значения зеркалют серверные
// routes/mapsValidation.ts: расхождение чинится здесь, а не там.

export type MapGrid = "square" | "hex";
export type MapScale = "planet" | "continent" | "country" | "region" | "settlement" | "locality";

export const MAP_GRID_LABELS: Record<MapGrid, string> = {
  square: "Квадраты",
  hex: "Гексы",
};

export const MAP_SCALE_LABELS: Record<MapScale, string> = {
  planet: "Планета",
  continent: "Континент",
  country: "Страна",
  region: "Регион",
  settlement: "Населённый пункт",
  locality: "Местность",
};

export const MAP_SCALE_ORDER: MapScale[] = [
  "planet",
  "continent",
  "country",
  "region",
  "settlement",
  "locality",
];

export const MAP_SCALE_PRESETS: Record<MapScale, { width: number; height: number; cellLore: string }> = {
  planet: { width: 24, height: 18, cellLore: "500 км" },
  continent: { width: 40, height: 30, cellLore: "100 км" },
  country: { width: 50, height: 36, cellLore: "20 км" },
  region: { width: 60, height: 44, cellLore: "2 км" },
  settlement: { width: 40, height: 30, cellLore: "20 м" },
  locality: { width: 50, height: 36, cellLore: "5 м" },
};

export const MAP_MIN_SIDE = 8;
export const MAP_MAX_SIDE = 100;

// Разбор подписи «1 клетка = …» в метры (P2-1): «20 м», «2 км», «5 футов».
// Не распарсилось — null, линейка показывает только клетки.
export function parseCellLore(lore: string): number | null {
  const m = /^\s*(\d+(?:[.,]\d+)?)\s*(мм|см|м|км|фут(?:а|ов)?|ft)?\s*$/i.exec(lore);
  if (!m) return null;
  const v = Number(m[1].replace(",", "."));
  if (!Number.isFinite(v) || v <= 0) return null;
  const unit = (m[2] ?? "м").toLowerCase();
  if (unit === "мм") return v / 1000;
  if (unit === "см") return v / 100;
  if (unit === "км") return v * 1000;
  if (unit.startsWith("фут") || unit === "ft") return v * 0.3048;
  return v;
}

// Человечий формат метров для линейки: «800 м», «2,5 км».
export function formatMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} м`;
  const km = meters / 1000;
  const str = km >= 10 ? String(Math.round(km)) : String(Math.round(km * 10) / 10).replace(".", ",");
  return `${str} км`;
}
// Перевод технических ошибок API карт на русский (P1-8): сервер отвечает
// по-английски, мастер читает по-русски. Клиентский таймаут уже по-русски —
// пропускаем как есть; неизвестное отдаём сырым текстом без выдуманного
// префикса про «сохранение» (ошибка может быть и чтением, и удалением).
export function translateMapError(raw: unknown): string {
  const msg = raw instanceof Error ? raw.message : String(raw ?? "");
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(msg))
    return "Нет связи с сервером — проверьте, что он запущен, и повторите.";
  // Д-8: таблица сгруппирована по доменам; порядок внутри — от частного к общему
  // (первое совпадение побеждает, поэтому generic-паттерны всегда в конце группы).
  const table: [RegExp, string][] = [
    // --- Мета карты ---
    [/name is required|name must be a non-empty string/i, "Название обязательно."],
    [/name too long/i, "Название слишком длинное (максимум 200 символов)."],
    [/grid must be/i, "Неизвестный тип сетки."],
    [/scale must be one of/i, "Неизвестный масштаб."],
    [/width\/height must be integers|width must be an integer/i, "Ширина и высота — целые числа 8–100."],
    [/cell_lore must be/i, "Подпись клетки — строка до 64 символов."],
    [/changing grid requires clearCells/i, "Смена сетки требует очистки клеток."],
    [/parent map not found/i, "Родительская карта не найдена."],
    // --- Параметры генератора ---
    [/sea must be/i, "Море — целое число 20–80."],
    [/mountains must be/i, "Горы — целое число 0–40."],
    [/forest must be/i, "Лес — целое число 0–60."],
    [/seed must be/i, "Сид — целое число."],
    // --- Содержимое (клетки/подписи/объекты): частное раньше общего ---
    [/cells must be valid JSON|cells must be an object|cells\.v must be/i, "Данные клеток повреждены — не сохраняю поверх."],
    [/cells\.labels must be an array|too many labels|label \d+ /i, "Подписи повреждены — поправьте текст и повторите."],
    [/cells\.(rooms|doors|traps|markers) must be an array|too many (rooms|doors|traps|markers)|(room|door|trap|marker) \d+ |start out of bounds|finish out of bounds|start has bad|finish has bad|markers needs v4|rivers needs v4/i, "Объекты карты повреждены — поправьте и повторите."],
    [/cell \S+ out of bounds|road \S+ out of bounds|river \S+ out of bounds/i, "Часть клеток за пределами поля — сотрите край."],
    [/out of bounds/i, "Часть клеток выходит за новое поле — сотрите край или ужмите слабее."],
    [/unknown terrain/i, "Неизвестный террейн в данных — не сохраняю поверх."],
    // --- Превью ---
    [/thumbnail must be a PNG data URL|thumbnail too large|thumbnail must be a string/i, "Превью не сохранилось (битый формат) — клетки в порядке, повторите."],
    // --- Привязки ---
    [/target_type must be|target_id must be/i, "Выберите сущность для привязки."],
    [/target not found/i, "Сущность не найдена — возможно, её удалили."],
    [/already bound/i, "Уже привязано."],
    // --- Общее (всегда последними) ---
    [/\bnot found\b/i, "Карта не найдена — возможно, её удалили в другом окне."],
  ];
  for (const [re, ru] of table) if (re.test(msg)) return ru;
  return msg || "Неизвестная ошибка.";
}

// Строка списка GET /api/maps (мета без клеток).
export interface MapSummary {
  id: number;
  name: string;
  grid: MapGrid;
  scale: MapScale;
  width: number;
  height: number;
  cell_lore: string;
  seed: number;
  sea: number;
  mountains: number;
  forest: number;
  thumbnail: string | null;
  player_visible: number;
  parent_map_id: number | null;
  created_at: string;
  updated_at: string;
}

// Полная строка GET /api/maps/:id (мета + blob клеток).
export interface MapFull extends MapSummary {
  cells: string;
}
