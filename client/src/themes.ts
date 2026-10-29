// Theme registry + application logic for SoyMan_ttrpg.
//
// Every theme is a flat map of CSS custom properties. `applyTheme()` writes
// the vars onto document.documentElement, so index.css only ever reads
// var(--xxx). Тем ровно две — светлая и тёмная (docs/design-system.md §2).
//
// This file is INTENTIONALLY independent from any statblock theming
// (statblocks keep their own .sb-scope/theme-* class switch and their own
// persisted preference).

export type ThemeMode = "dark" | "light";

export interface Theme {
  id: string;
  name: string;
  mode: ThemeMode;
  vars: Record<string, string>;
}

// ---------- color helpers ----------
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
function rgbToHex(r: number, g: number, b: number): string {
  return (
    "#" +
    [r, g, b]
      .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
      .join("")
  );
}
function mixHex(hex1: string, hex2: string, t: number): string {
  const a = hexToRgb(hex1);
  const b = hexToRgb(hex2);
  return rgbToHex(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t);
}
function relLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => v / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function pickTextOn(hex: string): string {
  return relLuminance(hex) > 0.55 ? "#181818" : "#ffffff";
}
// Capsule (calendar dot / status badge) colors: a light, desaturated
// "pastel" background paired with a dark tint of the same hue as text —
// keeps the two families visually related (unlike stark black-on-saturated),
// which reads as softer/lower-contrast while staying legible.
function pastelBg(hex: string): string {
  return mixHex(hex, "#ffffff", 0.6);
}
function pastelFg(hex: string): string {
  return mixHex(hex, "#000000", 0.6);
}
// Pull a semantic accent color back toward readable contrast against the
// theme's own background, without renaming/desaturating it outright.
function contrastFix(hex: string, mode: ThemeMode): string {
  const L = relLuminance(hex);
  if (mode !== "dark" && L > 0.62) return mixHex(hex, "#000000", Math.min(0.65, L - 0.28));
  if (mode === "dark" && L < 0.28) return mixHex(hex, "#ffffff", Math.min(0.6, 0.42 - L));
  return hex;
}

interface SemanticSet {
  gm: string;
  player: string;
  paid: string;
  free: string;
  active: string;
  hold: string;
  danger: string;
}
const SEMANTIC_BY_MODE: Record<ThemeMode, SemanticSet> = {
  dark: { gm: "#a78bfa", player: "#7dd3fc", paid: "#fbbf24", free: "#4ade80", active: "#4ade80", hold: "#94a3b8", danger: "#f87171" },
  light: { gm: "#7c3aed", player: "#0369a1", paid: "#b45309", free: "#15803d", active: "#15803d", hold: "#64748b", danger: "#dc2626" },
};
function fixSemanticSet(sem: SemanticSet, mode: ThemeMode): SemanticSet {
  const out = {} as SemanticSet;
  (Object.keys(sem) as (keyof SemanticSet)[]).forEach((k) => {
    out[k] = contrastFix(sem[k], mode);
  });
  return out;
}

// Источник навыка на листе D&D — заливка строки (класс / предыстория / оба).
// Сознательное отступление от §1.7 «цветом не кодируем»: в списке из
// восемнадцати навыков откуда взялось владение — вопрос, который мастер
// задаёт взглядом, а не чтением, и подпись у каждой строки заняла бы столько
// же места, сколько сама строка. Отступление ограничено: на печати заливки
// гаснут и источник подписывается словом (см. dnd-sheet.css).
//
// Синий, зелёный и винный различимы между собой лучше любой тройки с двумя
// соседними тонами.
//
// **Одна плашка на все темы.** Раньше тон считался от бумаги темы, и это
// дважды провалилось на живой проверке: в «Соевом покое» светлая пастель
// читалась вспышкой, а подмес пастели в тёмную бумагу «Соевой аберрации» дал
// три одинаковых серых. Третья попытка — подмес насыщенного семени — держала
// цветность, но в «Соевом нуаре» вышла невзрачной: бумага там уже почти
// чёрная, и плашка от неё почти не отличалась.
//
// Поэтому тон перестал зависеть от темы вовсе. Три строгие тёмные пастели,
// одинаковые везде, со своими светлыми чернилами: на светлой теме это
// тёмная плашка со светлым текстом, на тёмной — та же плашка, на шаг светлее
// фона. Различать три источника друг от друга важнее, чем совпасть с
// бумагой, а совпадать с бумагой у плашки задачи и нет — она затем и плашка.
//
// Насыщенность низкая намеренно: строка навыка стоит в плотной сетке из
// восемнадцати таких же, и яркая заливка там читается как ошибка, а не как
// признак.
function skillSourceVars(_mode: ThemeMode, _paper: string, _ink: string): Record<string, string> {
  return {
    "--skill-source-class": "#2c3d52",
    "--skill-source-background": "#2d4a3e",
    "--skill-source-both": "#4d3038",
    "--skill-source-ink": "#ece7df",
    "--skill-source-ink-muted": "#a8a29a",
  };
}

interface ThemeCfg {
  bg: string;
  text: string;
  accent: string;
  border: string;
  fontDisplay: string;
  fontBody: string;
  accent2?: string; // secondary accent (external links etc); defaults to accent
  surfaceMix?: number;
  surfaceAltMix?: number;
  textMutedOverride?: string;
  // `--level-ink`: подпись уровня на листе D&D (бейдж «ур. N», ромб секции).
  // Тёплое золото только там, где оно из палитры темы; иначе вторые чернила —
  // уровень служебная подпись, акцент темы на неё не тратится (разбор 2026-09-11).
  levelInk?: string;
  cardBorderWidth?: number; // px
  cardRadius?: number; // px
  cardClip?: string; // clip-path value
  bandBg?: string; // decorative campaign-card header background (color or gradient)
  bandImage?: string; // decorative campaign-card header background-image/texture
  playerBarText?: string; // text color for the bottom audio player bar
  pageTexture?: string; // whole-app background-image (very subtle, e.g. paper grain)
  cardBodyTexture?: string; // subtle texture on card bodies (not just the band)
  nameTransform?: string; // text-transform for titles
  nameStroke?: string; // -webkit-text-stroke for titles
  // Design-doc §3.1 `--glow`: an opt-in box-shadow-ish glow value. "none"
  // everywhere except themes that deliberately want the neon treatment.
  glow?: string;
  // Hand-marked accent under a calendar weekday header / the selected day —
  // an SVG squiggle background-image, e.g. a "pencil underline". Absent by
  // default; only themes that want that annotated-page feel set it.
  calendarMarkImage?: string;
  semanticOverrides?: Partial<SemanticSet>;
  // Per-status capsule (calendar dot / badge) bg+text overrides, bypassing
  // the default pastelBg/pastelFg derivation — used by themes that want a
  // moodier, darker capsule than the generic pastel treatment (e.g. aberrant).
  statusCapsuleOverrides?: Partial<Record<"planned" | "held" | "cancelled" | "rescheduled", { bg: string; fg: string }>>;
}

function buildTheme(id: string, name: string, mode: ThemeMode, cfg: ThemeCfg): Theme {
  const towards = mode === "dark" ? "#ffffff" : "#000000";
  const surfaceMix = cfg.surfaceMix ?? (mode === "dark" ? 0.06 : 0.035);
  const surfaceAltMix = cfg.surfaceAltMix ?? (mode === "dark" ? 0.1 : 0.06);
  // По умолчанию — `--card-border-width: 1px` и `--card-radius: 0` (откат 2026-08-29 по просьбе).
  const borderWidth = cfg.cardBorderWidth ?? 1;
  const sem = fixSemanticSet({ ...SEMANTIC_BY_MODE[mode], ...(cfg.semanticOverrides || {}) }, mode);
  const primaryBg = cfg.bandBg || cfg.accent;
  const primaryText = pickTextOn(primaryBg.startsWith("#") ? primaryBg : cfg.accent);

  // ---- design-doc vocabulary (§3.1) ----------------------------------
  // Computed once here and emitted under BOTH the new names and the legacy
  // ones, so the old vars are exact aliases and nothing shifts visually.
  const paper = cfg.bg;
  const paper2 = mixHex(cfg.bg, towards, surfaceMix);
  const paperElevated = mixHex(cfg.bg, towards, surfaceAltMix);
  const ink = cfg.text;
  const inkBright = mode === "dark" ? mixHex(cfg.text, "#ffffff", 0.15) : cfg.text;
  // Подмес чернил в фон для `--muted`. В светлом режиме 0.35 даёт ≈4.8:1 по
  // WCAG на бумаге нуара (#e8e4da), с запасом above 4.5:1. Тёмный не
  // напрягаем: фон там близок к чернилам, и 0.45 тянет к белому (П1.7).
  const muted = cfg.textMutedOverride || mixHex(cfg.text, cfg.bg, mode === "dark" ? 0.45 : 0.35);
  // §3.1's `--ink-2` sits between the main ink and the muted ink.
  const ink2 = mixHex(ink, muted, 0.5);
  const line = cfg.border;
  // The inverted card pair: a dark card on a light page and vice versa.
  // In every reference palette that resolves to ink-on-paper flipped.
  const surface = ink;
  const onSurface = paper;
  // Muted text ON an inverted plate. `--muted` is derived against the PAGE,
  // so it is unreadable on the plate (zine: #6E675C on #12100E ≈ 1.9:1) —
  // every eyebrow/meta line inside an ink header band needs its own token.
  // Коэффициент подобран так, чтобы в зине выйти ровно на #A39A88 из
  // артбордов референса: (0xA3-0x12)/(0xED-0x12) = 0.66 бумаги, то есть
  // 0.34 подмеса чернил.
  const onSurfaceMuted = mixHex(onSurface, surface, 0.34);

  // Источник навыка на листе D&D — заливка строки (класс / предыстория /
  // оба). Сознательное отступление от §1.7 «цветом не кодируем»: в списке из
  // восемнадцати навыков откуда взялось владение — вопрос, который мастер
  // задаёт взглядом, а не чтением, и подпись у каждой строки заняла бы
  // столько же места, сколько сама строка. Отступление ограничено:
  // на печати заливки гаснут и источник подписывается словом (см. dnd-sheet.css).
  //
  const vars: Record<string, string> = {
    ...skillSourceVars(mode, paper, ink),
    "--paper": paper,
    "--paper-2": paper2,
    "--ink": ink,
    "--ink-2": ink2,
    "--level-ink": cfg.levelInk || ink2,
    "--muted": muted,
    "--surface": surface,
    "--on-surface": onSurface,
    "--on-surface-muted": onSurfaceMuted,
    "--line": line,
    "--glow": cfg.glow || "none",
    // --bg-elevated and --text-bright have no exact §3.1 equivalent (an
    // elevated-surface mix and a dark-mode-brightened ink respectively —
    // see the comments on `paperElevated`/`inkBright` above), so they stay
    // as their own tokens instead of being folded into --paper-2/--ink-2.
    "--bg-elevated": paperElevated,
    "--text-bright": inkBright,
    "--accent": cfg.accent,
    "--accent-text": pickTextOn(cfg.accent),
    "--accent-soft": cfg.accent + "2a",
    "--accent-2": cfg.accent2 || cfg.accent,
    "--primary-bg": primaryBg,
    "--primary-text": primaryText,
    "--player-bar-text": cfg.playerBarText || primaryText,
    "--font-display": cfg.fontDisplay,
    "--font-body": cfg.fontBody,
    "--font-ui": "'Oswald', var(--font-body)",
    "--font-mono": "'JetBrains Mono', ui-monospace, 'PT Mono', monospace",
    "--card-radius": `${cfg.cardRadius ?? 0}px`,
    "--card-border-width": `${borderWidth}px`,
    "--card-clip": cfg.cardClip || "none",
    "--card-band-bg": cfg.bandBg || "var(--paper-2)",
    "--card-band-image": cfg.bandImage || "none",
    "--page-texture": cfg.pageTexture || "none",
    "--card-body-texture": cfg.cardBodyTexture || "none",
    "--name-transform": cfg.nameTransform || "none",
    "--name-stroke": cfg.nameStroke || "none",
    "--calendar-mark-image": cfg.calendarMarkImage || "none",
    "--status-planned": cfg.statusCapsuleOverrides?.planned?.bg ?? pastelBg(sem.hold),
    "--status-planned-fg": cfg.statusCapsuleOverrides?.planned?.fg ?? pastelFg(sem.hold),
    "--status-held": cfg.statusCapsuleOverrides?.held?.bg ?? pastelBg(sem.active),
    "--status-held-fg": cfg.statusCapsuleOverrides?.held?.fg ?? pastelFg(sem.active),
    "--status-cancelled": cfg.statusCapsuleOverrides?.cancelled?.bg ?? pastelBg(sem.danger),
    "--status-cancelled-fg": cfg.statusCapsuleOverrides?.cancelled?.fg ?? pastelFg(sem.danger),
    "--status-rescheduled": cfg.statusCapsuleOverrides?.rescheduled?.bg ?? pastelBg(sem.paid),
    "--status-rescheduled-fg": cfg.statusCapsuleOverrides?.rescheduled?.fg ?? pastelFg(sem.paid),
    "--role-gm": sem.gm,
    "--role-gm-soft": sem.gm + "22",
    "--role-player": sem.player,
    "--role-player-soft": sem.player + "22",
    "--pay-paid": sem.paid,
    "--pay-paid-soft": sem.paid + "22",
    "--pay-free": sem.free,
    "--pay-free-soft": sem.free + "22",
    // Scrim color for image-tile gradients: dark themes fade to paper (bg),
    // light themes fade to ink (text). Used by .campaign-tile-scrim,
    // .home-hero-scrim, .setting-card-bg::before.
    "--scrim": mode === "dark" ? paper : ink,
  };

  return { id, name, mode, vars };
}

// Дизайн-система v2 «Д» (docs/design-system.md §2): ровно две встроенные
// темы. Значения закреплены документом, поэтому темы собраны skinTheme из
// явной палитры, а не смешиванием buildTheme.
//
// `--accent` — прежнее имя «акцента»: в коде ~400 мест берут его цветом
// текста и рамки. Кислоту туда ставить нельзя (на светлой бумаге она не
// читается, и доза §5 разошлась бы на весь экран), поэтому `--accent` —
// чернильный акцент, как был у «Соевого нуара», а кислота — отдельный
// `--acid`, который экраны берут только для главного действия и активного
// состояния.

// Fills in everything buildTheme would derive, from an explicit palette.
function skinTheme(
  id: string,
  name: string,
  mode: ThemeMode,
  d: {
    paper: string; paper2: string; ink: string; ink2: string; muted: string;
    accent: string; accent2: string; surface: string; onSurface: string;
    line: string; elevated: string;
    fontDisplay: string; fontBody: string;
    bandBg: string; pageTexture: string; playerBarText: string;
    semantic: SemanticSet;
    v2: Record<string, string>;
  }
): Theme {
  const sem = fixSemanticSet(d.semantic, mode);
  return {
    id,
    name,
    mode,
    vars: {
      ...skillSourceVars(mode, d.paper, d.ink),
      "--paper": d.paper,
      "--paper-2": d.paper2,
      "--ink": d.ink,
      "--ink-2": d.ink2,
      "--level-ink": d.ink2,
      "--muted": d.muted,
      "--surface": d.surface,
      "--on-surface": d.onSurface,
      // `--muted` считается против страницы и на плашке не читается —
      // у плашки свой приглушённый.
      "--on-surface-muted": mixHex(d.onSurface, d.surface, 0.34),
      "--line": d.line,
      "--glow": "none",
      "--bg-elevated": d.elevated,
      "--text-bright": d.ink,
      "--accent": d.accent,
      "--accent-text": pickTextOn(d.accent),
      "--accent-soft": d.accent + "2a",
      "--accent-2": d.accent2,
      "--primary-bg": d.bandBg,
      "--primary-text": pickTextOn(d.bandBg),
      "--player-bar-text": d.playerBarText,
      "--font-display": d.fontDisplay,
      "--font-body": d.fontBody,
      "--font-ui": "'Oswald', var(--font-body)",
      "--font-mono": "'JetBrains Mono', ui-monospace, 'PT Mono', monospace",
      // Радиус 0; пользовательская настройка — поверх (§4.3).
      "--card-radius": "0px",
      "--card-border-width": "1px",
      "--card-clip": "none",
      "--card-band-bg": d.bandBg,
      "--card-band-image": "none",
      "--page-texture": d.pageTexture,
      "--card-body-texture": "none",
      "--name-transform": "none",
      "--name-stroke": "none",
      "--calendar-mark-image": "none",
      "--status-planned": pastelBg(sem.hold),
      "--status-planned-fg": pastelFg(sem.hold),
      "--status-held": pastelBg(sem.active),
      "--status-held-fg": pastelFg(sem.active),
      "--status-cancelled": pastelBg(sem.danger),
      "--status-cancelled-fg": pastelFg(sem.danger),
      "--status-rescheduled": pastelBg(sem.paid),
      "--status-rescheduled-fg": pastelFg(sem.paid),
      "--role-gm": sem.gm,
      "--role-gm-soft": sem.gm + "22",
      "--role-player": sem.player,
      "--role-player-soft": sem.player + "22",
      "--pay-paid": sem.paid,
      "--pay-paid-soft": sem.paid + "22",
      "--pay-free": sem.free,
      "--pay-free-soft": sem.free + "22",
      "--scrim": mode === "dark" ? d.paper : d.ink,
      "--danger": sem.danger,
      ...d.v2,
    },
  };
}

// Светлая — бумага, тушь, кислота у главного, малиновый мелкими метками.
const LIGHT_THEME = skinTheme("light", "Светлая", "light", {
  paper: "#E4E1D9", paper2: mixHex("#E4E1D9", "#000000", 0.035), elevated: mixHex("#E4E1D9", "#000000", 0.06),
  ink: "#151515", ink2: "#34322F", muted: "#5A5650",
  accent: "#151515", accent2: "#34322F",
  surface: "#151515", onSurface: "#F1EEDF",
  line: "rgba(21,21,21,.16)",
  fontDisplay: "'Oswald', 'Sofia Sans Semi Condensed', sans-serif", fontBody: "'Sofia Sans Semi Condensed', sans-serif",
  bandBg: "#151515",
  pageTexture: "radial-gradient(rgba(21,21,21,.05) 1px, transparent 1px) 0 0/3px 3px",
  playerBarText: "#F1EEDF",
  // Роли и статусы различаются подписью и начертанием (§2.2): цвет — только
  // у требующего внимания, и это малиновый.
  semantic: { gm: "#151515", player: "#C2105A", paid: "#151515", free: "#5A5650", active: "#151515", hold: "#5A5650", danger: "#C2105A" },
  v2: {
    "--sheet": "#F4F2EC", "--edge": "#151515",
    "--acid": "#F3FF3A", "--acid-text": "#151515",
    "--mark": "#C2105A", "--on-mark": "#FFFFFF",
    "--danger-bg": "#C2105A", "--danger-bg-hover": "#D8236C", "--danger-text": "#FFFFFF",
    "--nav": "#151515", "--nav-ink": "#EEECE6", "--nav-muted": "#9C988F",
    "--tab": "#D8D4CA", "--field": "#FFFFFF", "--ph": "#E9E6DE",
  },
});

// Тёмная — палитра «Соевого покоя»; характер даёт грамматика, не цвет (Q9).
const DARK_THEME = skinTheme("dark", "Тёмная", "dark", {
  paper: "#092328", paper2: mixHex("#092328", "#ffffff", 0.04), elevated: mixHex("#092328", "#ffffff", 0.08),
  ink: "#DCE6DF", ink2: "#BFD0C4", muted: "#93BC9C",
  accent: "#CEDAD0", accent2: "#8BBB92",
  surface: "#CEDAD0", onSurface: "#092328",
  line: "rgba(206,218,208,.16)",
  fontDisplay: "'Oswald', 'Sofia Sans Semi Condensed', sans-serif", fontBody: "'Sofia Sans Semi Condensed', sans-serif",
  bandBg: "#CEDAD0",
  pageTexture: "radial-gradient(rgba(139,187,146,.06) 1px, transparent 1px) 0 0/3px 3px",
  playerBarText: "#092328",
  semantic: { gm: "#DCE6DF", player: "#FF5FA2", paid: "#DCE6DF", free: "#93BC9C", active: "#DCE6DF", hold: "#93BC9C", danger: "#FF5FA2" },
  v2: {
    "--sheet": "#0D2C31", "--edge": "#CEDAD0",
    "--acid": "#F3FF3A", "--acid-text": "#151515",
    "--mark": "#FF5FA2", "--on-mark": "#092328",
    "--danger-bg": "#FF5FA2", "--danger-bg-hover": "#FF7DB4", "--danger-text": "#092328",
    "--nav": "#051619", "--nav-ink": "#DCE6DF", "--nav-muted": "#7FA592",
    "--tab": "#0A262B", "--field": "#0A262B", "--ph": "#0A262B",
  },
});

// Облик листа и визарда — «Соевый нуар» OneShot (решение владельца
// 2026-09-27). В выборе тем его нет: лист кладёт эти переменные на body сам
// (CharacterDetailPage), пока оболочка листа не переведена на «Д» (§6.10).
export const SHEET_THEME = buildTheme("noir", "Соевый нуар", "light", {
  bg: "#e8e4da", text: "#1c1c1c", accent: "#1c1c1c", border: "#2a2a2a",
  fontDisplay: "'Cormorant SC', serif", fontBody: "'Sofia Sans Semi Condensed', sans-serif",
  bandImage: "repeating-linear-gradient(180deg, rgba(0,0,0,.06) 0 3px, transparent 3px 22px)",
  pageTexture: "radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px) 0 0/3px 3px",
  cardBodyTexture: "radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px) 0 0/3px 3px",
  playerBarText: "#1c1c1c",
  cardBorderWidth: 1,
});

export const BUILTIN_THEMES: Theme[] = [LIGHT_THEME, DARK_THEME];

// На светлую настроен предзагрузочный :root в index.css (защита от вспышки
// чужой палитры до запуска JS).
export const DEFAULT_THEME_ID = "light";

// ---------- persistence + application ----------
const STORAGE_KEY = "rpgManagerTheme";

export interface StoredThemePrefs {
  themeId: string;
}

// Тёмные темы до v2. Сохранённый выбор переводится по режиму: тёмная → «Тёмная»,
// остальное → «Светлая» (Q5). Свои темы хранили режим сами.
const LEGACY_DARK_IDS = new Set(["peace", "neon", "aberrant", "riot"]);

/** Старый id темы → одна из двух тем v2. */
export function migrateThemeId(themeId: unknown, customThemes: unknown): string {
  if (themeId === "light" || themeId === "dark") return themeId;
  if (typeof themeId !== "string") return DEFAULT_THEME_ID;
  if (LEGACY_DARK_IDS.has(themeId)) return "dark";
  if (Array.isArray(customThemes)) {
    const custom = customThemes.find((t) => t && typeof t === "object" && (t as Theme).id === themeId) as Theme | undefined;
    if (custom?.mode === "dark") return "dark";
  }
  return "light";
}

export function loadThemePrefs(): StoredThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { themeId?: unknown; customThemes?: unknown } | null;
      return { themeId: migrateThemeId(parsed?.themeId, parsed?.customThemes) };
    }
  } catch {
    /* ignore — reset to default */
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return { themeId: DEFAULT_THEME_ID };
}

export function saveThemePrefs(prefs: StoredThemePrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function findTheme(id: string): Theme {
  return BUILTIN_THEMES.find((t) => t.id === id) || BUILTIN_THEMES[0];
}

// Personal corner-radius override (px), independent of the active theme —
// every built-in theme now ships the same default (0px, П1.6+Н18); this lets
// a user dial it up/down without needing a custom theme.
const RADIUS_STORAGE_KEY = "rpgManagerRadiusOverride";

export function loadRadiusOverride(): number | null {
  try {
    const raw = localStorage.getItem(RADIUS_STORAGE_KEY);
    return raw != null ? Number(raw) : null;
  } catch {
    return null;
  }
}

export function saveRadiusOverride(px: number | null) {
  try {
    if (px == null) localStorage.removeItem(RADIUS_STORAGE_KEY);
    else localStorage.setItem(RADIUS_STORAGE_KEY, String(px));
  } catch {
    /* ignore */
  }
}

// Writes every CSS var for the theme onto :root. Call this on boot (as early
// as possible, ideally before first paint) and again whenever the user
// switches themes.
export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  Object.entries(theme.vars).forEach(([k, v]) => root.style.setProperty(k, v));
  const radiusOverride = loadRadiusOverride();
  if (radiusOverride != null) root.style.setProperty("--card-radius", `${radiusOverride}px`);
  root.setAttribute("data-theme-mode", theme.mode);
  root.setAttribute("data-theme-id", theme.id);
}
