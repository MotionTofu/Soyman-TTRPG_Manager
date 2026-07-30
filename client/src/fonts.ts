// Curated font list for the text-formatting toolbar. System fonts render
// immediately; Google fonts are lazy-loaded (a <link> is injected the first
// time one is picked) so we don't pay for fonts nobody uses.
export interface FontOption {
  label: string;
  family: string;
  google?: string; // Google Fonts family name (query param), if not a system font
}

export const FONT_OPTIONS: FontOption[] = [
  { label: "По умолчанию", family: "" },
  { label: "Georgia", family: "Georgia, serif" },
  { label: "Times New Roman", family: "'Times New Roman', serif" },
  { label: "Courier New", family: "'Courier New', monospace" },
  { label: "Trebuchet MS", family: "'Trebuchet MS', sans-serif" },
  { label: "Cinzel (фэнтези)", family: "'Cinzel', serif", google: "Cinzel" },
  { label: "MedievalSharp (фэнтези)", family: "'MedievalSharp', cursive", google: "MedievalSharp" },
  { label: "Uncial Antiqua (рунический)", family: "'Uncial Antiqua', cursive", google: "Uncial Antiqua" },
  { label: "IM Fell English (старинный)", family: "'IM Fell English', serif", google: "IM Fell English" },
  { label: "Merriweather", family: "'Merriweather', serif", google: "Merriweather" },
];

const loadedGoogleFonts = new Set<string>();

export function ensureFontLoaded(font: FontOption) {
  if (!font.google || loadedGoogleFonts.has(font.google)) return;
  loadedGoogleFonts.add(font.google);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.google)}&display=swap`;
  document.head.appendChild(link);
}
