// Theme registry + application logic for RPG Manager.
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
  const muted = cfg.textMutedOverride || mixHex(cfg.text, cfg.bg, 0.45);
  // §3.1's `--ink-2` sits between the main ink and the muted ink.
  const ink2 = mixHex(ink, muted, 0.5);
  const line = cfg.border;
  // The inverted card pair: a dark card on a light page and vice versa.
  // In every reference palette that resolves to ink-on-paper flipped.
  const surface = ink;
  const onSurface = paper;

  const vars: Record<string, string> = {
    "--paper": paper,
    "--paper-2": paper2,
    "--ink": ink,
    "--ink-2": ink2,
    "--muted": muted,
    "--surface": surface,
    "--on-surface": onSurface,
    "--line": line,
    "--glow": cfg.glow || "none",
    // legacy aliases — same source values, do not diverge
    "--bg": paper,
    "--bg-panel": paper2,
    "--bg-elevated": paperElevated,
    "--border": line,
    "--text": ink,
    "--text-bright": inkBright,
    "--text-dim": muted,
    "--accent": cfg.accent,
    "--accent-text": pickTextOn(cfg.accent),
    "--accent-soft": cfg.accent + "2a",
    "--accent-2": cfg.accent2 || cfg.accent,
    "--primary-bg": primaryBg,
    "--primary-text": primaryText,
    "--font-display": cfg.fontDisplay,
    "--font-body": cfg.fontBody,
    "--card-radius": `${cfg.cardRadius ?? 6}px`,
    "--card-border-width": `${borderWidth}px`,
    "--card-clip": cfg.cardClip || "none",
    "--card-band-bg": cfg.bandBg || "var(--bg-panel)",
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
  };

  return { id, name, mode, vars };
}

// The app's original hardcoded palette, kept as literal values (not run
// through buildTheme's mix formulas) so this is a pixel-exact match of what
// index.css used to hardcode — the safe, always-available default.
const CLASSIC_THEME: Theme = {
  id: "classic",
  name: "Классическая",
  mode: "dark",
  vars: {
    // design-doc vocabulary, literal like the rest of this theme
    "--paper": "#16141c",
    "--paper-2": "#1e1c26",
    "--ink": "#cac5d6",
    "--ink-2": "#b4aec2",
    "--muted": "#9d97ad",
    "--surface": "#cac5d6",
    "--on-surface": "#16141c",
    "--line": "#35313f",
    "--glow": "none",
    // legacy aliases
    "--bg": "#16141c",
    "--bg-panel": "#1e1c26",
    "--bg-elevated": "#262330",
    "--border": "#35313f",
    "--text": "#cac5d6",
    "--text-bright": "#e9e6f0",
    "--text-dim": "#9d97ad",
    "--accent": "#b08968",
    "--accent-text": "#201a14",
    "--accent-soft": "#b089682a",
    "--accent-2": "#7c9885",
    "--primary-bg": "#b08968",
    "--primary-text": "#201a14",
    "--font-display": "'Segoe UI', system-ui, sans-serif",
    "--font-body": "'Segoe UI', system-ui, sans-serif",
    "--card-radius": "6px",
    "--card-border-width": "1px",
    "--card-clip": "none",
    "--card-band-bg": "var(--bg-panel)",
    "--card-band-image": "none",
    "--page-texture": "none",
    "--card-body-texture": "none",
    "--name-transform": "none",
    "--name-stroke": "none",
    "--status-planned": "#bdccdb",
    "--status-planned-fg": "#243342",
    "--status-held": "#c5dccb",
    "--status-held-fg": "#2c4332",
    "--status-cancelled": "#dbbdbd",
    "--status-cancelled-fg": "#422424",
    "--status-rescheduled": "#dfd5b1",
    "--status-rescheduled-fg": "#463c18",
    "--role-gm": "#a78bfa",
    "--role-gm-soft": "#a78bfa22",
    "--role-player": "#7a2438",
    "--role-player-soft": "#7a243822",
    "--pay-paid": "#fbbf24",
    "--pay-paid-soft": "#fbbf2422",
    "--pay-free": "#4ade80",
    "--pay-free-soft": "#4ade8022",
  },
};

// "Соевый Нуар" is the default/first theme — kept as its own const (rather
// than folded into the list below) so it can be placed first regardless of
// where it's defined.
const SOY_NOIR_THEME = buildTheme("noir", "Соевый Нуар", "light", {
  bg: "#e8e4da", text: "#1c1c1c", accent: "#1c1c1c", border: "#2a2a2a",
  fontDisplay: "'Cormorant SC', serif", fontBody: "'PT Mono', monospace",
  bandImage: "repeating-linear-gradient(180deg, rgba(0,0,0,.06) 0 3px, transparent 3px 22px)",
  pageTexture: "radial-gradient(rgba(0,0,0,.05) 1px, transparent 1px) 0 0/3px 3px",
  cardBodyTexture: "radial-gradient(rgba(0,0,0,.035) 1px, transparent 1px) 0 0/3px 3px",
});

// Palettes, accents, textures and gradients lifted directly from the
// "Статблоки — Гравюра" reference settings (statblocks.html).
const OTHER_THEMES: Theme[] = [
  CLASSIC_THEME,
  buildTheme("engraving", "Гравюра", "light", {
    bg: "#faf7ef", text: "#26251f", accent: "#2e4636", border: "#d8d2c2",
    fontDisplay: "'Alegreya SC', serif", fontBody: "'EB Garamond', serif",
  }),
  buildTheme("cyberpunk", "Киберпанк", "dark", {
    bg: "#0c0f12", text: "#cfe9ec", accent: "#4ef0ff", border: "#1d747a",
    fontDisplay: "'CyberpunkRus', monospace", fontBody: "'Oswald', sans-serif",
    bandImage: "linear-gradient(135deg, transparent 88%, #ff2fa0 88%), repeating-linear-gradient(0deg, rgba(78,240,255,.07) 0 2px, transparent 2px 4px)",
    nameTransform: "uppercase",
    semanticOverrides: { gm: "#ff2fa0", player: "#4ef0ff", paid: "#f5e04e", free: "#39ff88", active: "#39ff88", hold: "#5c8b90", danger: "#ff2fa0" },
  }),
  buildTheme("steampunk", "Стимпанк", "dark", {
    bg: "#2a2119", text: "#e8d9b8", accent: "#e8c979", border: "#8a6a34",
    fontDisplay: "'Steamy', 'Bitter', serif", fontBody: "'Bitter', serif",
  }),
  buildTheme("fey", "Фейский", "light", {
    bg: "#f3f7ec", text: "#3c4a2f", accent: "#4a5e3a", border: "#b9d1a0",
    fontDisplay: "'Comfortaa', sans-serif", fontBody: "'Cormorant', serif",
    bandBg: "linear-gradient(135deg, #cfe3b3, #e6d6f0)",
    semanticOverrides: { gm: "#7a9463", player: "#8e7bb0", paid: "#c9a94a", free: "#4a5e3a" },
  }),
  buildTheme("aberrant", "Аберрантный", "dark", {
    bg: "#0e0c14", text: "#c4b8d4", accent: "#b366e8", border: "#4a2f5c",
    fontDisplay: "'PT Serif', serif", fontBody: "'PT Serif', serif",
    bandBg: "radial-gradient(ellipse at 30% -10%, #3a1f4a, #0e0c14 70%)",
    textMutedOverride: "#7fd88a",
    semanticOverrides: { gm: "#b366e8", player: "#7fd88a", paid: "#e0c15f", free: "#7fd88a", active: "#7fd88a", hold: "#6b5a78", danger: "#e05f5f" },
    statusCapsuleOverrides: { planned: { bg: "#2c1c38", fg: "#c9a8e0" } },
  }),
  buildTheme("undead", "Андедовский", "dark", {
    bg: "#0a0a0b", text: "#a9a49c", accent: "#d8d2c4", border: "#2c2c30",
    fontDisplay: "'Yeseva One', serif", fontBody: "'PT Serif', serif",
    textMutedOverride: "#6b6459",
    semanticOverrides: { gm: "#b8b2a6", player: "#8a8478", paid: "#d8d2c4", free: "#6b6459", active: "#a9a49c", hold: "#5c584f", danger: "#8a6f66" },
  }),
  buildTheme("rustic", "Rustic fantasy", "light", {
    bg: "#efe6d3", text: "#4a3a26", accent: "#7a5c38", border: "#9c7b4f",
    fontDisplay: "'Amatic SC', sans-serif", fontBody: "'Merriweather', serif",
    cardBorderWidth: 2,
  }),
  buildTheme("disney", "Блублускай", "light", {
    bg: "#fbf6ff", text: "#4a3a63", accent: "#8a6fd6", border: "#cbb8f0",
    fontDisplay: "'DOSFont', 'Comfortaa', sans-serif", fontBody: "'Nunito', sans-serif",
    bandBg: "linear-gradient(160deg, #a9c9ff, #d9b8ff 55%, #ffd9ec)",
  }),
  buildTheme("anime", "Баблгам", "light", {
    bg: "#fff8f2", text: "#3a2c33", accent: "#ff6b9d", border: "#ff6b9d",
    fontDisplay: "'BubbleGum', 'Baloo 2', sans-serif", fontBody: "'Nunito', sans-serif",
    bandBg: "linear-gradient(115deg, #ff6b9d 0%, #ff6b9d 40%, #ffb86b 100%)",
    semanticOverrides: { gm: "#ff6b9d", player: "#8a6fd6", paid: "#ffb86b", free: "#4caf7d" },
  }),
  buildTheme("comic", "Комиксовый", "light", {
    bg: "#fff6de", text: "#1a1a1a", accent: "#ff3b30", border: "#1a1a1a",
    fontDisplay: "'Russo One', sans-serif", fontBody: "'PT Sans', sans-serif",
    cardBorderWidth: 4, bandBg: "#ff3b30",
    bandImage: "radial-gradient(#ffffff66 1.5px, transparent 1.5px) 0 0/9px 9px",
    pageTexture: "radial-gradient(rgba(26,26,26,.035) 1px, transparent 1px) 0 0/6px 6px",
    nameTransform: "uppercase", nameStroke: "0.6px #1a1a1a",
    semanticOverrides: { gm: "#4dd6ff", player: "#ffe066", paid: "#ff3b30", free: "#2ecc71", active: "#2ecc71", hold: "#8a8a8a", danger: "#ff3b30" },
  }),
  buildTheme("barovia", "Баровия", "light", {
    bg: "#d9d2be", text: "#3a3126", accent: "#8a2a1f", border: "#3c2a1a",
    fontDisplay: "'Greengoth', 'Fondamento', cursive", fontBody: "'EB Garamond', serif",
    cardBorderWidth: 2, cardRadius: 3,
    bandBg: "linear-gradient(160deg, #1b1410, #2e1a14 70%)",
  }),
  buildTheme("slavic", "Древнеславянский", "light", {
    bg: "#f1e7d2", text: "#332619", accent: "#a1332a", border: "#8a6a42",
    fontDisplay: "'Bulgariamodernav3', serif", fontBody: "'PT Serif', serif",
    cardBorderWidth: 2, cardRadius: 2,
    bandBg: "#a1332a",
  }),
  // Punk-zine collage: aged newsprint, xerox grain, a single blood-red
  // accent against black-on-cream, hard square corners — reference: a
  // "SOLARPUNK RPG MANAGER" zine-cover concept the user supplied.
  buildTheme("zine", "Зин", "light", {
    bg: "#e7dfc9", text: "#181818", accent: "#c31f1f", border: "#181818",
    fontDisplay: "'Anton', sans-serif", fontBody: "'Archivo', sans-serif",
    cardBorderWidth: 2, cardRadius: 0,
    bandBg: "#181818",
    bandImage: "radial-gradient(#ffffff33 1.5px, transparent 1.5px) 0 0/8px 8px",
    pageTexture: "radial-gradient(rgba(0,0,0,.06) 1px, transparent 1px) 0 0/3px 3px",
    cardBodyTexture: "radial-gradient(rgba(0,0,0,.04) 1px, transparent 1px) 0 0/3px 3px",
    nameTransform: "uppercase",
    // A single hand-drawn squiggle stroke in the accent red — the "pencil
    // underline" the reference calendar marks today/selected with, instead
    // of a filled highlight box.
    calendarMarkImage:
      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 40 6' preserveAspectRatio='none'%3E%3Cpath d='M1 3.5c2-3 4-3 6 0s4 3 6 0 4-3 6 0 4 3 6 0 4-3 6 0 4 3 6 0 4-3 6 0' fill='none' stroke='%23c31f1f' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E\")",
    semanticOverrides: { gm: "#181818", player: "#c31f1f", paid: "#c31f1f", free: "#3a6b3a", active: "#3a6b3a", hold: "#7a7568", danger: "#c31f1f" },
  }),
  // Storybook woodcut: warm parchment + rust-terracotta accent, meant to
  // read as an old fable's engraved illustration plates — reference: "Tales
  // & Dice" / "FableMaster" concepts the user supplied.
  buildTheme("fable", "Сказание", "light", {
    bg: "#ecdfc0", text: "#2e2317", accent: "#a1481f", border: "#8a6a42",
    fontDisplay: "'Old Standard TT', serif", fontBody: "'Vollkorn', serif",
    cardBorderWidth: 1, cardRadius: 5,
    bandBg: "linear-gradient(160deg, #efe4c9, #ddc99a)",
    pageTexture: "radial-gradient(rgba(60,40,20,.045) 1px, transparent 1px) 0 0/3px 3px",
    semanticOverrides: { gm: "#5c3a1f", player: "#3a5c4f", paid: "#a1481f", free: "#4f7a4a" },
  }),
  // Bright arcade cartoon — deliberately a curated "Full palette" (blue base
  // + 3 named accent roles), not the busy Drenched maximalism of the source
  // concepts ("RPG ROOM" / "Dungeon Dash"); chunky rounded shapes and bold
  // type carry the identity instead of decoration density.
  buildTheme("arcade", "Аркада", "dark", {
    bg: "#1c2a6b", text: "#f2f3ff", accent: "#ff4fa3", border: "#3a4fc0",
    fontDisplay: "'Fredoka', sans-serif", fontBody: "'Nunito', sans-serif",
    cardBorderWidth: 3, cardRadius: 18,
    bandBg: "linear-gradient(120deg, #ff4fa3 0%, #ffce4f 100%)",
    semanticOverrides: { gm: "#ff4fa3", player: "#4fd1ff", paid: "#ffce4f", free: "#4fe6a0", active: "#4fe6a0", hold: "#8894e8", danger: "#ff5c5c" },
  }),
];

// "Соевый Нуар" first — it's the default theme new users land on.
export const BUILTIN_THEMES: Theme[] = [SOY_NOIR_THEME, ...OTHER_THEMES];

// ---------- persistence + application ----------
const STORAGE_KEY = "rpgManagerTheme";

export interface StoredThemePrefs {
  themeId: string;
  customThemes: Theme[];
}

export function loadThemePrefs(): StoredThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return { themeId: parsed.themeId || "zine", customThemes: parsed.customThemes || [] };
    }
  } catch {
    /* ignore */
  }
  return { themeId: "zine", customThemes: [] };
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
  return allThemes(customThemes).find((t) => t.id === id) || BUILTIN_THEMES[0];
}

// Personal corner-radius override (px), independent of the active theme —
// every built-in theme now ships the same default (6px, "Классическая"'s
// value); this lets a user dial it up/down without needing a custom theme.
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
