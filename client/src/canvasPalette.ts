// Единственный источник цвета для раздела «Полотно».
//
// До этого цвета жили в трёх местах — `canvas.css`, инлайн в компонентах нод
// и инлайн в легенде — и уже разошлись между собой. Здесь они заданы один
// раз; CSS получает их переменными (см. `applyCanvasPaletteVars` ниже),
// компоненты и легенда — импортом.
//
// Правило пастельной насыщенности для Полотна владельцем отменено
// (2026-08-26): цвета нод и рамок не обязаны быть блёклыми. Что остаётся
// обязательным — контраст текста на плашке не ниже 4.5:1.

/** Светлый текст на тёмной плашке. */
export const INK_LIGHT = "#F8F6F1";
/** Тёмный текст на светлой плашке. */
export const INK_DARK = "#1A1A1A";

export interface NodeColor {
  /** Цвет обводки ноды и её плашки-шапки. */
  color: string;
  /** Цвет текста на плашке — тот из двух, что даёт 4.5:1. */
  ink: string;
}

/** Цвет типа ноды: обводка + шапка. Ключ — `canvas-node--<ключ>` в CSS. */
export const NODE_COLORS = {
  // 5.04:1 на INK_LIGHT
  being: { color: "#C0392B", ink: INK_LIGHT },
  // Было #2E86C1 — 3.67:1, не проходило. Затемнено до 4.90:1.
  location: { color: "#2471A3", ink: INK_LIGHT },
  artifact: { color: "#B7950B", ink: INK_DARK },
  community: { color: "#1ABC9C", ink: INK_DARK },
  compendium_entry: { color: "#7D3C98", ink: INK_LIGHT },
  // Персонаж игрока (блок G7) — свой цвет, а не общий с существом. Партия
  // это те несколько узлов, которые Мастер ищет на доске боковым зрением, а
  // существ на холстах кампании два десятка: под одним цветом партия в них
  // теряется. 7.0:1 на INK_LIGHT.
  character: { color: "#A04000", ink: INK_LIGHT },
  sound_set: { color: "#145A32", ink: INK_LIGHT },
  // Было #E74C3C со светлым текстом — 3.54:1. Цвет оставлен (он же у разъёма
  // «бой»), текст переведён на тёмный: 4.56:1.
  playlist: { color: "#E74C3C", ink: INK_DARK },
} as const satisfies Record<string, NodeColor>;

export type NodeColorKey = keyof typeof NODE_COLORS;

/** Цвет ромба «истории» — единственный разъём, который не берёт цвет типа. */
export const STORY_COLOR = "#F0DDE8";

/**
 * Цвет разъёма. Роли сцены и типы нод намеренно совпадают там, где ведут в
 * одно и то же: «персонажи» — цвет существа, «лут» — цвет артефакта.
 */
export const HANDLE_COLORS = {
  story: STORY_COLOR,
  location: NODE_COLORS.location.color,
  plot_characters: NODE_COLORS.being.color,
  obstacles: "#6C3483",
  loot: NODE_COLORS.artifact.color,
  consequences: NODE_COLORS.community.color,
  being: NODE_COLORS.being.color,
  artifact: NODE_COLORS.artifact.color,
  members: NODE_COLORS.community.color,
  in: "#117A65",
  audio: NODE_COLORS.sound_set.color,
  battle: NODE_COLORS.playlist.color,
} as const;

export type HandleColorKey = keyof typeof HANDLE_COLORS;

export interface SwatchOption {
  key: string;
  label: string;
  value: string;
}

/** Цвета стикера. Порядок — порядок в панели свойств и в меню. */
export const STICKER_SWATCHES: SwatchOption[] = [
  { key: "paper", label: "Бумага", value: "var(--paper)" },
  { key: "yellow", label: "Жёлтый", value: "var(--sticker-yellow)" },
  { key: "blue", label: "Голубой", value: "var(--sticker-blue)" },
  { key: "green", label: "Зелёный", value: "var(--sticker-green)" },
  { key: "pink", label: "Розовый", value: "var(--sticker-pink)" },
  { key: "sand", label: "Песочный", value: "var(--sticker-sand)" },
  { key: "lavender", label: "Лавандовый", value: "var(--sticker-lavender)" },
];

/** Цвета рамки, главы и пина. Хранятся в базе значением, а не ключом. */
export const FRAME_SWATCHES: SwatchOption[] = [
  { key: "slate", label: "Грифель", value: "#2C3E50" },
  { key: "plum", label: "Слива", value: "#4A235A" },
  { key: "navy", label: "Ночь", value: "#1A252F" },
  { key: "teal", label: "Хвоя", value: "#145A32" },
  { key: "burgundy", label: "Бордо", value: "#7B241C" },
  { key: "brown", label: "Умбра", value: "#6E2C00" },
  { key: "charcoal", label: "Уголь", value: "#17202A" },
  { key: "graphite", label: "Графит", value: "#283747" },
];

/** Цвет по умолчанию у рамки, главы и пина. */
export const DEFAULT_FRAME_COLOR = FRAME_SWATCHES[0].value;

/** Стикер отдаёт в базу ключ, на холст — значение. */
export const STICKER_COLORS: Record<string, string> = Object.fromEntries(
  STICKER_SWATCHES.map((s) => [s.key, s.value]),
);

export type LegendShape = "diamond" | "square" | "dot";

export interface LegendItem {
  key: HandleColorKey;
  label: string;
  shape: LegendShape;
}

/**
 * Легенда холста, двумя колонками — как разъёмы стоят на ноде сцены: слева
 * то, из чего сцена собрана, справа — куда она ведёт. Тип кодируется формой
 * (ромб — история, квадрат — сущность, кружок с точкой — звук), цвет только
 * помогает.
 */
export const CANVAS_LEGEND_IN: LegendItem[] = [
  { key: "story", label: "история", shape: "diamond" },
  { key: "location", label: "локация", shape: "square" },
  { key: "plot_characters", label: "персонажи", shape: "square" },
  { key: "obstacles", label: "препятствия", shape: "square" },
  { key: "loot", label: "лут", shape: "square" },
  { key: "audio", label: "аудио", shape: "dot" },
  { key: "battle", label: "бой", shape: "dot" },
];

export const CANVAS_LEGEND_OUT: LegendItem[] = [
  { key: "story", label: "дальше", shape: "diamond" },
  { key: "consequences", label: "последствия", shape: "square" },
];

/**
 * Переменные для `canvas.css`. Значений в самом CSS нет — он берёт их
 * отсюда, поэтому поменять цвет типа можно ровно в одном месте.
 */
export function canvasPaletteVars(): Record<string, string> {
  const vars: Record<string, string> = {
    "--cv-ink-light": INK_LIGHT,
    "--cv-ink-dark": INK_DARK,
    "--cv-story": STORY_COLOR,
    "--sticker-yellow": "#F2E8C6",
    "--sticker-blue": "#DDE8F0",
    "--sticker-green": "#D8E8D8",
    "--sticker-pink": "#F0DDE8",
    "--sticker-sand": "#E8DDD0",
    "--sticker-lavender": "#E0E0E8",
  };
  for (const [key, v] of Object.entries(NODE_COLORS)) {
    vars[`--cv-node-${key}`] = v.color;
    vars[`--cv-node-${key}-ink`] = v.ink;
  }
  for (const [key, value] of Object.entries(HANDLE_COLORS)) {
    vars[`--cv-handle-${key}`] = value;
  }
  return vars;
}

export function applyCanvasPaletteVars(): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  for (const [name, value] of Object.entries(canvasPaletteVars())) {
    root.style.setProperty(name, value);
  }
}

// Прописываем после applyTheme() — `canvas.css` рассчитывает на эти
// переменные и без них покажет ноды без цвета. Вызов делается
// в `main.tsx`, чтобы палитра Полотна не перезатиралась темой.
