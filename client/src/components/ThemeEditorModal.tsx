import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import {
  type Theme, type ThemeMode, type StoredThemePrefs,
  applyTheme, findTheme, BUILTIN_THEMES,
} from "../themes";

interface Props {
  theme: Theme;
  prefs: StoredThemePrefs;
  onSave: (prefs: StoredThemePrefs) => void;
  onClose: () => void;
}

const COLOR_FIELDS: { key: string; label: string; varName: string }[] = [
  { key: "paper", label: "Бумага (фон)", varName: "--paper" },
  { key: "ink", label: "Чернила (текст)", varName: "--ink" },
  { key: "accent", label: "Акцент", varName: "--accent" },
  { key: "border", label: "Обводка", varName: "--line" },
];

const FONT_DISPLAY_OPTIONS = [
  { value: "'RussianPunk', 'Anton', sans-serif", label: "RussianPunk" },
  { value: "'NewZelek', 'Anton', sans-serif", label: "NewZelek" },
  { value: "'Cormorant SC', serif", label: "Cormorant SC" },
  { value: "'Cormorant Garamond', serif", label: "Cormorant Garamond" },
  { value: "'PT Serif', serif", label: "PT Serif" },
  { value: "'Anton', sans-serif", label: "Anton" },
];

const FONT_BODY_OPTIONS = [
  { value: "'Archivo', sans-serif", label: "Archivo" },
  { value: "'PT Serif', serif", label: "PT Serif" },
  { value: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", label: "System" },
];

function isBuiltIn(theme: Theme): boolean {
  return BUILTIN_THEMES.some((b) => b.id === theme.id);
}

function deriveVars(
  base: Theme,
  colors: Record<string, string>,
  fontDisplay: string,
  fontBody: string,
  mode: ThemeMode,
): Record<string, string> {
  const v = { ...base.vars };
  // Apply edited colors
  v["--paper"] = colors.paper;
  v["--ink"] = colors.ink;
  v["--accent"] = colors.accent;
  v["--accent-text"] = luminance(colors.accent) > 0.55 ? "#181818" : "#ffffff";
  v["--accent-soft"] = colors.accent + "2a";
  v["--line"] = colors.border;
  // Derive surface/on-surface from paper/ink (standard inversion)
  v["--surface"] = colors.ink;
  v["--on-surface"] = colors.paper;
  // Derive secondary surfaces
  const towards = mode === "dark" ? "#ffffff" : "#000000";
  v["--paper-2"] = mixHex(colors.paper, towards, mode === "dark" ? 0.06 : 0.035);
  v["--bg-elevated"] = mixHex(colors.paper, towards, mode === "dark" ? 0.1 : 0.06);
  // Derive muted
  v["--muted"] = mixHex(colors.ink, colors.paper, mode === "dark" ? 0.45 : 0.37);
  v["--ink-2"] = mixHex(colors.ink, v["--muted"], 0.5);
  v["--on-surface-muted"] = mixHex(colors.paper, colors.ink, 0.34);
  // Fonts
  v["--font-display"] = fontDisplay;
  v["--font-body"] = fontBody;
  return v;
}

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16) / 255;
  const g = parseInt(h.slice(2, 4), 16) / 255;
  const b = parseInt(h.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixHex(hex1: string, hex2: string, t: number): string {
  const h1 = hex1.replace("#", "");
  const h2 = hex2.replace("#", "");
  const r1 = parseInt(h1.slice(0, 2), 16), g1 = parseInt(h1.slice(2, 4), 16), b1 = parseInt(h1.slice(4, 6), 16);
  const r2 = parseInt(h2.slice(0, 2), 16), g2 = parseInt(h2.slice(2, 4), 16), b2 = parseInt(h2.slice(4, 6), 16);
  const r = Math.round(r1 + (r2 - r1) * t);
  const g = Math.round(g1 + (g2 - g1) * t);
  const b = Math.round(b1 + (b2 - b1) * t);
  return "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, "0")).join("");
}

export function ThemeEditorModal({ theme, prefs, onSave, onClose }: Props) {
  const originalTheme = findTheme(theme.id, prefs.customThemes);
  const wasBuiltIn = isBuiltIn(theme);

  // Copy-on-write: if built-in, create a custom copy
  const [editingId] = useState(() => wasBuiltIn ? "custom-" + Date.now() : theme.id);
  const [name, setName] = useState(wasBuiltIn ? theme.name + " (копия)" : theme.name);
  const [mode, setMode] = useState<ThemeMode>(theme.mode);
  const [colors, setColors] = useState<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    COLOR_FIELDS.forEach((f) => { out[f.key] = theme.vars[f.varName] || "#000000"; });
    return out;
  });
  const [fontDisplay, setFontDisplay] = useState(theme.vars["--font-display"] || FONT_DISPLAY_OPTIONS[0].value);
  const [fontBody, setFontBody] = useState(theme.vars["--font-body"] || FONT_BODY_OPTIONS[0].value);

  // Build the editing theme object
  function buildEditing(): Theme {
    return {
      id: editingId,
      name,
      mode,
      vars: deriveVars(theme, colors, fontDisplay, fontBody, mode),
    };
  }

  // Apply live on every change
  useEffect(() => {
    const t = buildEditing();
    applyTheme(t);
  }, [name, mode, colors, fontDisplay, fontBody]); // eslint-disable-line react-hooks/exhaustive-deps

  // Restore original on unmount (cancel path)
  useEffect(() => () => { applyTheme(originalTheme); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleSave() {
    const customThemes = prefs.customThemes.filter((t) => t.id !== editingId);
    customThemes.push(buildEditing());
    const newPrefs: StoredThemePrefs = { themeId: editingId, customThemes };
    applyTheme(buildEditing());
    onSave(newPrefs);
  }

  function handleCancel() {
    applyTheme(originalTheme);
    onClose();
  }

  return (
    <Modal onClose={handleCancel} closeOnBackdropClick={false}>
      <div className="stack" style={{ gap: 16, minWidth: 380, maxWidth: 480 }}>
        <h3 style={{ margin: 0 }}>
          {wasBuiltIn ? "Новая тема (копия)" : "Редактирование темы"}
        </h3>

        {/* Name */}
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Название</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} />
        </label>

        {/* Mode */}
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted" style={{ fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Режим</span>
          <div className="row" style={{ gap: 8 }}>
            <label className="row" style={{ gap: 4 }}>
              <input type="radio" name="theme-editor-mode" checked={mode === "light"} onChange={() => setMode("light")} />
              Светлая
            </label>
            <label className="row" style={{ gap: 4 }}>
              <input type="radio" name="theme-editor-mode" checked={mode === "dark"} onChange={() => setMode("dark")} />
              Тёмная
            </label>
          </div>
        </label>

        {/* Colors */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Цвета</span>
          {COLOR_FIELDS.map((f) => (
            <label key={f.key} className="row" style={{ gap: 8, alignItems: "center" }}>
              <input
                type="color"
                value={colors[f.key].slice(0, 7)}
                onChange={(e) => setColors((prev) => ({ ...prev, [f.key]: e.target.value }))}
                style={{ width: 32, height: 24, padding: 0, border: "1px solid var(--line)", cursor: "pointer" }}
              />
              <span style={{ flex: 1, fontSize: 12 }}>{f.label}</span>
              <input
                value={colors[f.key]}
                onChange={(e) => {
                  const v = e.target.value;
                  if (/^#[0-9a-f]{6}$/i.test(v)) setColors((prev) => ({ ...prev, [f.key]: v }));
                  else setColors((prev) => ({ ...prev, [f.key]: v }));
                }}
                style={{ width: 80, fontFamily: "var(--font-mono)", fontSize: 11 }}
                maxLength={7}
              />
            </label>
          ))}
        </div>

        {/* Fonts */}
        <div className="stack" style={{ gap: 8 }}>
          <span className="muted" style={{ fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Шрифты</span>
          <label className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 12 }}>Заголовки (Display)</span>
            <select value={fontDisplay} onChange={(e) => setFontDisplay(e.target.value)}>
              {FONT_DISPLAY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="stack" style={{ gap: 4 }}>
            <span style={{ fontSize: 12 }}>Основной текст (Body)</span>
            <select value={fontBody} onChange={(e) => setFontBody(e.target.value)}>
              {FONT_BODY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>

        {/* Preview */}
        <div className="card" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column", background: colors.paper, color: colors.ink, border: `1px solid ${colors.border}` }}>
          <div style={{ fontFamily: fontDisplay, fontWeight: 600, fontSize: 18 }}>Заголовок карточки</div>
          <div style={{ fontSize: 12, lineHeight: 1.4 }}>Пример текста на фоне темы. Чернила на бумаге, обводка вокруг.</div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ background: colors.accent, color: "#fff", padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>АКЦЕНТ</span>
            <span style={{ fontSize: 11, opacity: 0.6 }}>Число: 42</span>
          </div>
        </div>

        {/* Actions */}
        <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
          <button onClick={handleCancel}>Отмена</button>
          <button className="primary" onClick={handleSave}>Сохранить</button>
        </div>
      </div>
    </Modal>
  );
}
