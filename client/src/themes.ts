// Theme registry + application logic for SoyMan_ttrpg.
//
// Every theme is a flat map of CSS custom properties. Built-in themes are
// computed once (below) from a small palette description. `applyTheme()`
// writes the resulting vars onto document.documentElement, so index.css only
// ever reads var(--xxx) and never needs per-theme selectors.
//
// "Классическая" is a literal (non-computed) copy of this app's original
// hardcoded palette, kept byte-for-byte so switching the theming system on
// doesn't change anything visually until the user actually picks a theme.
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
function pickTextOn(hex: string): string {
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

// Three zine skins from docs/design-system-punk-zine.md §3.1 plus the two
// themes the user kept. Порядок здесь — это порядок в списке выбора; тема по
// умолчанию задаётся отдельно (DEFAULT_THEME_ID), чтобы её можно было менять,
// не переставляя список.
//
// riot/neon are written as literal palettes rather than buildTheme configs:
// the doc pins their exact values, and buildTheme's mixing would drift from
// them. They still emit the same variable set — see zineVars() below.

// Fills in everything buildTheme would derive, from an explicit §3.1 palette.
function skinTheme(
  id: string,
  name: string,
  mode: ThemeMode,
  d: {
    paper: string; paper2: string; ink: string; ink2: string; muted: string;
    accent: string; accent2: string; surface: string; onSurface: string;
    line: string; glow: string; elevated: string;
    fontDisplay: string; fontBody: string;
    bandBg?: string; bandImage?: string; pageTexture?: string; cardBodyTexture?: string;
    playerBarText?: string;
    semantic: SemanticSet;
  }
): Theme {
  const sem = fixSemanticSet(d.semantic, mode);
  const primaryBg = d.bandBg || d.accent;
  return {
    id,
    name,
    mode,
    vars: {
      // Скины собирают переменные сами, мимо buildTheme, — и без этой строки
      // «Соевый бунт» и «Соевый неон» остались бы вовсе без заливки источника
      // навыка: `var(--skill-source-*)` не разрешился бы ни во что.
      ...skillSourceVars(mode, d.paper, d.ink),
      "--paper": d.paper,
      "--paper-2": d.paper2,
      "--ink": d.ink,
      "--ink-2": d.ink2,
      "--muted": d.muted,
      "--surface": d.surface,
      "--on-surface": d.onSurface,
      // See buildTheme's note: `--muted` is derived against the page and is
      // unreadable on an inverted plate, so plates carry their own muted.
      "--on-surface-muted": mixHex(d.onSurface, d.surface, 0.34),
      "--line": d.line,
      "--glow": d.glow,
      // See buildTheme()'s comment: --bg-elevated/--text-bright have no
      // exact §3.1 equivalent, so skins keep emitting them directly.
      "--bg-elevated": d.elevated,
      "--text-bright": d.ink,
      "--accent": d.accent,
      "--accent-text": pickTextOn(d.accent),
      "--accent-soft": d.accent + "2a",
      "--accent-2": d.accent2,
      "--primary-bg": primaryBg,
      "--primary-text": pickTextOn(primaryBg.startsWith("#") ? primaryBg : d.accent),
      "--player-bar-text": d.playerBarText || pickTextOn(primaryBg.startsWith("#") ? primaryBg : d.accent),
      "--font-display": d.fontDisplay,
      "--font-body": d.fontBody,
      "--font-ui": "'Oswald', var(--font-body)",
      "--font-mono": "'JetBrains Mono', ui-monospace, 'PT Mono', monospace",
      // §1.3: 1px по всему контуру — исправлено 2026-08-30 по решению владельца (2px → 1px)
      "--card-radius": "0px",
      "--card-border-width": "1px",
      "--card-clip": "none",
      "--card-band-bg": d.bandBg || "var(--paper-2)",
      "--card-band-image": d.bandImage || "none",
      "--page-texture": d.pageTexture || "none",
      "--card-body-texture": d.cardBodyTexture || "none",
      "--name-transform": "uppercase",
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
    },
  };
}

// ZINE — the base skin: aged paper, ink, one blood red. Palette from §3.1.
const ZINE_THEME = buildTheme("zine", "Соевый панк", "light", {
  bg: "#EDE7D9", text: "#12100E", accent: "#D6321E", border: "#12100E",
  fontDisplay: "'RussianPunk', 'Anton', sans-serif", fontBody: "'Archivo', sans-serif",
  textMutedOverride: "#6E675C",
  cardBorderWidth: 1, cardRadius: 0,
  bandBg: "#12100E",
  bandImage: "radial-gradient(#ffffff33 1.5px, transparent 1.5px) 0 0/8px 8px",
  pageTexture: "radial-gradient(rgba(18,16,14,.06) 1px, transparent 1px) 0 0/3px 3px",
  cardBodyTexture: "radial-gradient(rgba(18,16,14,.04) 1px, transparent 1px) 0 0/3px 3px",
  nameTransform: "uppercase",
  // A hand-drawn squiggle in the accent — the "pencil underline" the
  // reference calendar marks today/selected with, instead of a filled box.
  calendarMarkImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 6' preserveAspectRatio='none'%3E%3Cpath d='M1 3.5c2-3 4-3 6 0s4 3 6 0 4-3 6 0 4 3 6 0 4-3 6 0 4 3 6 0 4-3 6 0' fill='none' stroke='%23c31f1f' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")",
  semanticOverrides: { gm: "#12100E", player: "#D6321E", paid: "#D6321E", free: "#3a6b3a", active: "#3a6b3a", hold: "#6E675C", danger: "#D6321E" },
});

// RIOT — the same world inverted: a black sheet with paper scraps on it.
const RIOT_THEME = skinTheme("riot", "Соевый бунт", "dark", {
  paper: "#0B0B0B", paper2: "#141414", elevated: "#1C1C1C",
  ink: "#F2EDE1", ink2: "#C9C2B4", muted: "#8A8378",
  accent: "#C7261B", accent2: "#F2EDE1",
  surface: "#F2EDE1", onSurface: "#0B0B0B",
  line: "rgba(242,237,225,.22)", glow: "none",
  fontDisplay: "'NewZelek', 'Anton', sans-serif", fontBody: "'Archivo', sans-serif",
  bandBg: "#F2EDE1",
  pageTexture: "radial-gradient(rgba(242,237,225,.05) 1px, transparent 1px) 0 0/3px 3px",
  semantic: { gm: "#F2EDE1", player: "#C7261B", paid: "#C7261B", free: "#8A8378", active: "#F2EDE1", hold: "#8A8378", danger: "#C7261B" },
});

// NEON — acid. The only skin that uses --glow (§3.1).
const NEON_THEME = skinTheme("neon", "Соевый неон", "dark", {
  paper: "#07070A", paper2: "#0F0F14", elevated: "#16161C",
  ink: "#F0FFE8", ink2: "#B9D6AC", muted: "#727E6D",
  accent: "#FF2E88", accent2: "#B6FF2E",
  surface: "#0F0F14", onSurface: "#F0FFE8",
  line: "rgba(182,255,46,.35)", glow: "0 0 12px rgba(182,255,46,.45)",
  fontDisplay: "'NewZelek', 'Anton', sans-serif", fontBody: "'Archivo', sans-serif",
  bandBg: "#0F0F14",
  bandImage: "repeating-linear-gradient(0deg, rgba(182,255,46,.07) 0 2px, transparent 2px 4px)",
  playerBarText: "#FF2E88",
  semantic: { gm: "#FF2E88", player: "#B6FF2E", paid: "#B6FF2E", free: "#B6FF2E", active: "#B6FF2E", hold: "#6F7A6A", danger: "#FF2E88" },
});

const SOY_NOIR_THEME = buildTheme("noir", "Соевый нуар", "light", {
  bg: "#e8e4da", text: "#1c1c1c", accent: "#1c1c1c", border: "#2a2a2a",
  fontDisplay: "'Cormorant SC', serif", fontBody: "'Archivo', sans-serif",
  bandImage: "repeating-linear-gradient(180deg, rgba(0,0,0,.06) 0 3px, transparent 3px 22px)",
  pageTexture: "radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px) 0 0/3px 3px",
  cardBodyTexture: "radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px) 0 0/3px 3px",
  playerBarText: "#1c1c1c",
  cardBorderWidth: 1,
});

const ABERRANT_THEME = buildTheme("aberrant", "Соевая аберрация", "dark", {
  bg: "#0e0c14", text: "#c4b8d4", accent: "#b366e8", border: "#4a2f5c",
  fontDisplay: "'PT Serif', serif", fontBody: "'PT Serif', serif",
  bandBg: "radial-gradient(ellipse at 30% -10%, #3a1f4a, #0e0c14 70%)",
  textMutedOverride: "#7fd88a",
  semanticOverrides: { gm: "#b366e8", player: "#7fd88a", paid: "#e0c15f", free: "#7fd88a", active: "#7fd88a", hold: "#6b5a78", danger: "#e05f5f" },
  statusCapsuleOverrides: { planned: { bg: "#2c1c38", fg: "#c9a8e0" } },
  cardBorderWidth: 1,
});

const PEACE_THEME = buildTheme("peace", "Соевый покой", "dark", {
  bg: "#092328",
  text: "#CEDAD0",
  accent: "#8BBB92",
  accent2: "#2A835F",
  border: "#12544F",
  fontDisplay: "'Cormorant SC', serif",
  fontBody: "'Archivo', sans-serif",
  // Приглушённый текст — ровно самый светлый из палитры, а не микс
  // к фону: так вся четвёрка (#092328/#12544F/#2A835F/#8BBB92) живёт
  // в теме как есть, и при этом muted остаётся читаемым на тёмной бумаге.
  textMutedOverride: "#8BBB92",
  bandBg: "#0E3C3C",
  bandImage: "repeating-linear-gradient(180deg, rgba(139,187,146,.07) 0 3px, transparent 3px 22px)",
  pageTexture: "radial-gradient(rgba(139,187,146,.06) 1px, transparent 1px) 0 0/3px 3px",
  cardBodyTexture: "radial-gradient(rgba(139,187,146,.04) 1px, transparent 1px) 0 0/3px 3px",
  playerBarText: "#CEDAD0",
  semanticOverrides: { gm: "#8BBB92", player: "#8FD0A8", paid: "#D2C49E", free: "#8BBB92", active: "#8BBB92", hold: "#7A9E8E", danger: "#E08E8E" },
  statusCapsuleOverrides: {
    planned: { bg: "#1A3A36", fg: "#8BBB92" },
    held: { bg: "#143528", fg: "#8BBB92" },
    cancelled: { bg: "#3A2526", fg: "#F08080" },
    rescheduled: { bg: "#2F3320", fg: "#C8C9A0" },
  },
  cardBorderWidth: 1,
});
// Инвертированные плашки в «Покое» — тёмные, а не светлый инк, чтобы
// бестиарий (.creature-card__band), группы ресурсов (.res-group__band),
// вырезка (.home-article-band) и т.п. были темнее, как просили.
// 2026-09-02: поднят контраст заголовков 3.6→7.5 — прежнее #0E3C3C/#CEDAD0
// сливалось при ховере (свет на свет 1.2:1, текст на фоне 3.6). Теперь
// #071E22/#F0F5F0 — читается на Retina и на дешёвом TN.
PEACE_THEME.vars["--surface"] = "#071E22";
PEACE_THEME.vars["--on-surface"] = "#F0F5F0";
PEACE_THEME.vars["--on-surface-muted"] = "#A8CDB0";

export const BUILTIN_THEMES: Theme[] = [PEACE_THEME, SOY_NOIR_THEME, NEON_THEME, ABERRANT_THEME, RIOT_THEME, ZINE_THEME];

// Тема по умолчанию — «Соевый Нуар»: на неё же настроен предзагрузочный
// :root в index.css (защита от вспышки чужой палитры до запуска JS).
export const DEFAULT_THEME_ID = "noir";

// ---------- persistence + application ----------
const STORAGE_KEY = "rpgManagerTheme";

export interface StoredThemePrefs {
  themeId: string;
  customThemes: Theme[];
}

function isSafeParsedObject(obj: unknown): boolean {
  if (!obj || typeof obj !== "object") return false;
  const s = JSON.stringify(obj);
  return !s.includes("__proto__") && !s.includes("\"constructor\"") && !s.includes("\"prototype\"");
}
export function loadThemePrefs(): StoredThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      if (raw.includes("__proto__") || raw.includes("constructor") || raw.includes("prototype")) throw new Error("polluted");
      const parsed = JSON.parse(raw) as StoredThemePrefs;
      if (!isSafeParsedObject(parsed)) throw new Error("polluted");
      const themeId = typeof parsed.themeId === "string" && /^[a-z0-9_-]{1,64}$/i.test(parsed.themeId) ? parsed.themeId : DEFAULT_THEME_ID;
      const customThemes = Array.isArray(parsed.customThemes) ? parsed.customThemes.filter((t) => t && typeof t.id === "string" && isSafeParsedObject(t)) : [];
      return { themeId, customThemes };
    }
  } catch {
    /* ignore — reset to default */
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
  return { themeId: DEFAULT_THEME_ID, customThemes: [] };
}

export function saveThemePrefs(prefs: StoredThemePrefs) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
  } catch {
    /* ignore */
  }
}

export function allThemes(customThemes: Theme[] = []): Theme[] {
  return [...BUILTIN_THEMES, ...customThemes];
}

export function findTheme(id: string, customThemes: Theme[] = []): Theme {
  const themes = allThemes(customThemes);
  return (
    themes.find((t) => t.id === id) ||
    themes.find((t) => t.id === DEFAULT_THEME_ID) ||
    BUILTIN_THEMES[0]
  );
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

// Creates a new custom theme from a name + base mode + accent color, mirroring
// the "Новая тема" flow in the design prototype.
export function createCustomTheme(name: string, mode: ThemeMode, accent: string): Theme {
  const base = mode === "dark"
    ? { bg: "#14141a", text: "#ece9f5", border: "#2b2b38" }
    : { bg: "#f5f6f8", text: "#1c1e26", border: "#e1e3ea" };
  return buildTheme("custom-" + Date.now(), name, mode, {
    ...base, accent,
    fontDisplay: "'Cormorant Garamond', serif",
    fontBody: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  });
}
