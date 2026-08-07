import { memo, useEffect, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { formatMentionToken } from "../../mentions";
import { FONT_OPTIONS, ensureFontLoaded } from "../../fonts";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { Modal } from "../Modal";
import { MentionPickerModal } from "./MentionPickerModal";
import { NavIcon } from "../NavIcons";
import type { SearchResult } from "../../types";
import { scheduleAutoResize, cancelAutoResize } from "./textareaAutoResize";

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];

// Modern Chromium (and thus this Electron app) can auto-grow a textarea
// purely in CSS via field-sizing: content — no JS involved, so typing
// never forces a synchronous layout read. Where it's unsupported, fall
// back to the old height="auto"+scrollHeight trick.
const SUPPORTS_FIELD_SIZING =
  typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");

// Rebuilds the table modal's cell grid to the given size, keeping any values
// that still fit and defaulting new header cells to "Заголовок N" (matching
// the old fixed 2×2 template) and new body cells to empty.
function resizeGrid(prev: string[][], rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => prev[r]?.[c] ?? (r === 0 ? `Заголовок ${c + 1}` : ""))
  );
}

interface Props {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  // Preselects the "Сеттинг" dropdown in the @-mention modal's "Создать
  // новую сущность" flow — pass it when the caller's own context has an
  // obvious setting (a location/being/community/artifact page, or the
  // setting page itself). Left unset elsewhere; the user just picks one.
  defaultSettingId?: number;
}

// A plain <textarea> that opens the "продвинутое упоминание" modal
// (MentionPickerModal) while typing "@" — replaces the old inline dropdown.
// Picking (or creating) a result inserts a [[type:id|Label]] token —
// rendered as a clickable link by <MentionText> in view mode.
export const MentionTextarea = memo(function MentionTextarea({
  value,
  onChange,
  rows = 5,
  placeholder,
  defaultSettingId,
}: Props) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const menuWrapRef = useRef<HTMLDivElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState<string | null>(null);
  const [queryStart, setQueryStart] = useState(0);
  const [linkMenuOpen, setLinkMenuOpen] = useState(false);
  const [extLabel, setExtLabel] = useState("");
  const [extUrl, setExtUrl] = useState("");
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const [tableRows, setTableRows] = useState(2);
  const [tableCols, setTableCols] = useState(2);
  const [tableCells, setTableCells] = useState<string[][]>([]);

  // Auto-grow to fit content instead of scrolling internally. Handled by
  // CSS field-sizing (see SUPPORTS_FIELD_SIZING) where available — this JS
  // fallback only runs on engines without it, since forcing a synchronous
  // height="auto"+scrollHeight read on every keystroke is what made typing
  // in these fields noticeably laggy on statblocks with many open fields.
  useEffect(() => {
    if (SUPPORTS_FIELD_SIZING) return;
    const el = textareaRef.current;
    if (!el) return;
    // Scheduled through the shared batcher (see textareaAutoResize.ts)
    // rather than measured here directly — a page with many of these
    // fields (e.g. session edit, one note field per roster/location/enemy
    // row) would otherwise have each instance's own read-after-write force
    // a separate synchronous layout in the same frame (DevTools "Forced
    // reflow" violations, one per field) on engines without CSS
    // field-sizing support (this app's bundled Electron/Chromium predates
    // it). The batcher coalesces every mounted field's resize into one
    // write/read/write pass per frame instead.
    scheduleAutoResize(el);
    return () => cancelAutoResize(el);
  }, [value]);

  // Closes the formatting flyout (and any nested link submenu) on an
  // outside click or Escape — same pattern as ContextMenu.tsx.
  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuWrapRef.current && !menuWrapRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
        setLinkMenuOpen(false);
      }
    }
    function handleKey(e: globalThis.KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuOpen(false);
        setLinkMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [menuOpen]);

  function handleChange(e: ChangeEvent<HTMLTextAreaElement>) {
    const text = e.target.value;
    onChange(text);
    const cursor = e.target.selectionStart;
    const upToCursor = text.slice(0, cursor);
    const match = /(?:^|\s)@([^\s\]]*)$/.exec(upToCursor);
    if (match) {
      setQuery(match[1]);
      setQueryStart(cursor - match[1].length - 1);
    } else {
      setQuery(null);
    }
  }

  function insertMention(result: SearchResult) {
    if (query === null) return;
    const before = value.slice(0, queryStart);
    const after = value.slice(queryStart + 1 + query.length);
    const token = formatMentionToken(result.type, result.id, result.title);
    const newText = `${before}${token}${after}`;
    onChange(newText);
    setQuery(null);
    const newCursor = before.length + token.length;
    requestAnimationFrame(() => {
      const el = textareaRef.current;
      if (el) {
        el.focus();
        el.setSelectionRange(newCursor, newCursor);
      }
    });
  }

  // Accepts a search-result drag (from the global search panel, or any other
  // drag source using the same MIME) and inserts it as a mention token —
  // lets e.g. a compendium item get dropped straight into free-text fields
  // like Снаряжение, the same way it drops into structured lists elsewhere.
  function handleDrop(e: DragEvent<HTMLTextAreaElement>) {
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    e.preventDefault();
    const result: SearchResult = JSON.parse(raw);
    const token = formatMentionToken(result.type, result.id, result.title);
    // A spell dropped into free text (e.g. Снаряжение) isn't the spell
    // itself — it's a scroll of it — so mark it as such.
    const suffix = result.kind === "spell" ? " (свиток)" : "";
    const needsSpace = value.length > 0 && !/\s$/.test(value);
    onChange(`${value}${needsSpace ? " " : ""}${token}${suffix}`);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.ctrlKey || e.metaKey) {
      // e.code is the physical key (layout-independent) — e.key would be
      // "и"/"л" etc. on a Cyrillic layout, breaking the shortcut there.
      if (e.code === "KeyB") {
        e.preventDefault();
        wrapSelection("**", "**", "жирный текст");
        return;
      }
      if (e.code === "KeyK") {
        e.preventDefault();
        setLinkMenuOpen(true);
        return;
      }
    }
    // Alt+Q: second way to open the mention picker, alongside typing "@"
    // and the toolbar "@" button — same insertion path (triggerInternalLink).
    if (e.altKey && e.code === "KeyQ") {
      e.preventDefault();
      triggerInternalLink();
    }
    // Alt+W: wraps the selection in a quote block, alongside the toolbar button.
    if (e.altKey && e.code === "KeyW") {
      e.preventDefault();
      wrapSelection("{quote}", "{/quote}", "цитата");
    }
  }

  // Wraps the current selection in `before`/`after` (used for **bold** and
  // *italic*); if nothing is selected, inserts a placeholder and selects it.
  function wrapSelection(before: string, after: string, placeholder: string) {
    setMenuOpen(false);
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const selected = value.slice(start, end) || placeholder;
    const newText = value.slice(0, start) + before + selected + after + value.slice(end);
    onChange(newText);
    const selStart = start + before.length;
    const selEnd = selStart + selected.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(selStart, selEnd);
    });
  }

  // Toggles a #/##/### heading prefix on the line containing the cursor.
  function toggleHeading(level: 1 | 2 | 3) {
    setMenuOpen(false);
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const lineStart = value.lastIndexOf("\n", cursor - 1) + 1;
    let lineEnd = value.indexOf("\n", cursor);
    if (lineEnd === -1) lineEnd = value.length;
    const line = value.slice(lineStart, lineEnd);
    const prefix = "#".repeat(level) + " ";
    const stripped = line.replace(/^#{1,3}\s+/, "");
    const newLine = line.startsWith(prefix) ? stripped : prefix + stripped;
    const newText = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
    onChange(newText);
    const newCursor = cursor + (newLine.length - line.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });
  }

  // Inserts "@" at the cursor to open the mention-search modal. Deliberately
  // does NOT refocus the textarea afterwards (unlike wrapSelection/
  // toggleHeading/insertExternalLink below) — MentionPickerModal's own search
  // input autoFocuses itself, and refocusing the textarea here would steal
  // that focus right back, leaving the user typing into the textarea instead
  // of the picker.
  function triggerInternalLink() {
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const newText = value.slice(0, start) + "@" + value.slice(end);
    onChange(newText);
    setQuery("");
    setQueryStart(start);
    setLinkMenuOpen(false);
    setMenuOpen(false);
  }

  function insertExternalLink() {
    if (!extUrl.trim()) return;
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const label = extLabel.trim() || value.slice(start, end) || extUrl.trim();
    const token = `[${label}](${extUrl.trim()})`;
    const newText = value.slice(0, start) + token + value.slice(end);
    onChange(newText);
    const newCursor = start + token.length;
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCursor, newCursor);
    });
    setExtLabel("");
    setExtUrl("");
    setLinkMenuOpen(false);
    setMenuOpen(false);
  }

  // Wraps the selection in a {span attr="…"}…{/span} styled run.
  function wrapStyle(attr: string) {
    wrapSelection(`{span ${attr}}`, "{/span}", "текст");
  }

  function applyColor(color: string) {
    wrapStyle(`color="${color}"`);
  }

  function applySize(size: string) {
    if (!size) return;
    wrapStyle(`size="${size}"`);
  }

  function applyFont(family: string) {
    if (!family) return;
    const font = FONT_OPTIONS.find((f) => f.family === family);
    if (font) ensureFontLoaded(font);
    wrapStyle(`font="${family}"`);
  }

  // Toggles a "- " bullet prefix on every non-empty line the selection
  // spans (or just the current line, if nothing is selected).
  function toggleBulletList() {
    setMenuOpen(false);
    const el = textareaRef.current;
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    const blockStart = value.lastIndexOf("\n", start - 1) + 1;
    let blockEnd = value.indexOf("\n", Math.max(end - 1, blockStart));
    if (blockEnd === -1) blockEnd = value.length;
    const block = value.slice(blockStart, blockEnd);
    const lines = block.split("\n");
    const nonEmpty = lines.filter((l) => l.trim() !== "");
    const allBulleted = nonEmpty.length > 0 && nonEmpty.every((l) => l.startsWith("- "));
    const newLines = lines.map((l) => {
      if (l.trim() === "") return l;
      if (allBulleted) return l.replace(/^-\s+/, "");
      return l.startsWith("- ") ? l : `- ${l}`;
    });
    const newBlock = newLines.join("\n");
    const newText = value.slice(0, blockStart) + newBlock + value.slice(blockEnd);
    onChange(newText);
    const newCursor = end + (newBlock.length - block.length);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(newCursor, newCursor);
    });
  }

  // Requirement 1: opens a rows×columns modal with a live editable grid
  // instead of inserting a fixed template — the pipe-markdown text is only
  // built once on "Создать".
  function openTableModal() {
    setTableRows(2);
    setTableCols(2);
    setTableCells(resizeGrid([], 2, 2));
    setTableModalOpen(true);
    setMenuOpen(false);
  }

  function changeTableSize(rows: number, cols: number) {
    const clampedRows = Math.min(101, Math.max(1, rows));
    const clampedCols = Math.min(10, Math.max(1, cols));
    setTableRows(clampedRows);
    setTableCols(clampedCols);
    setTableCells((prev) => resizeGrid(prev, clampedRows, clampedCols));
  }

  function setTableCell(r: number, c: number, text: string) {
    setTableCells((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? text : cell)) : row)));
  }

  function confirmTable() {
    const el = textareaRef.current;
    const start = el?.selectionStart ?? value.length;
    const needsLeadingBreak = start > 0 && value[start - 1] !== "\n";
    const rowLine = (cells: string[]) => `| ${cells.map((c) => c || " ").join(" | ")} |\n`;
    const sepLine = `| ${tableCols === 0 ? "" : Array(tableCols).fill("---").join(" | ")} |\n`;
    const template =
      `${needsLeadingBreak ? "\n" : ""}${rowLine(tableCells[0] ?? [])}` +
      sepLine +
      tableCells.slice(1).map(rowLine).join("");
    const newText = value.slice(0, start) + template + value.slice(start);
    onChange(newText);
    const newCursor = start + template.length;
    setTableModalOpen(false);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(newCursor, newCursor);
    });
  }

  return (
    <div className="mention-textarea-wrap">
      <div className="rt-format-trigger-wrap" ref={menuWrapRef}>
        <button
          type="button"
          className="rt-format-trigger"
          title="Форматирование"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setMenuOpen((v) => !v)}
        >
          Aa
        </button>
        {menuOpen && (
      <div className="rt-toolbar rt-format-menu">
        <button type="button" className="rt-btn" title="Жирный" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("**", "**", "жирный текст")}>
          <strong>Ж</strong>
        </button>
        <button type="button" className="rt-btn" title="Курсив" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("*", "*", "курсив")}>
          <em>К</em>
        </button>
        <button type="button" className="rt-btn" title="Цитата (Alt+W)" onMouseDown={(e) => e.preventDefault()} onClick={() => wrapSelection("{quote}", "{/quote}", "цитата")}>
          ❝
        </button>
        <span className="rt-sep" />
        <button type="button" className="rt-btn" title="Заголовок 1" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleHeading(1)}>
          H1
        </button>
        <button type="button" className="rt-btn" title="Заголовок 2" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleHeading(2)}>
          H2
        </button>
        <button type="button" className="rt-btn" title="Заголовок 3" onMouseDown={(e) => e.preventDefault()} onClick={() => toggleHeading(3)}>
          H3
        </button>
        <span className="rt-sep" />
        <button type="button" className="rt-btn" title="Список" onMouseDown={(e) => e.preventDefault()} onClick={toggleBulletList}>
          ≡
        </button>
        <button type="button" className="rt-btn" title="Вставить таблицу" onMouseDown={(e) => e.preventDefault()} onClick={openTableModal}>
          ▦
        </button>
        <span className="rt-sep" />
        <label className="rt-btn rt-color-btn" title="Цвет текста">
          <NavIcon name="palette" />
          <input
            type="color"
            defaultValue="#e3d9c6"
            onChange={(e) => applyColor(e.target.value)}
          />
        </label>
        <select
          className="rt-select"
          title="Размер шрифта"
          defaultValue=""
          onChange={(e) => {
            applySize(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            Размер
          </option>
          {FONT_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}px
            </option>
          ))}
        </select>
        <select
          className="rt-select"
          title="Шрифт"
          defaultValue=""
          onChange={(e) => {
            applyFont(e.target.value);
            e.target.value = "";
          }}
        >
          <option value="" disabled>
            Шрифт
          </option>
          {FONT_OPTIONS.filter((f) => f.family).map((f) => (
            <option key={f.family} value={f.family}>
              {f.label}
            </option>
          ))}
        </select>
        <span className="rt-sep" />
        <button
          type="button"
          className="rt-btn"
          title="Упоминание"
          onMouseDown={(e) => e.preventDefault()}
          onClick={triggerInternalLink}
        >
          @
        </button>
        <div className="rt-link-wrap">
          <button
            type="button"
            className="rt-btn"
            title="Ссылка"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => setLinkMenuOpen((v) => !v)}
          >
            <NavIcon name="link" />
          </button>
          {linkMenuOpen && (
            <div className="rt-link-menu">
              <button type="button" className="rt-link-menu-item" onClick={triggerInternalLink}>
                Внутренняя (упоминание)
              </button>
              <div className="rt-link-menu-item rt-link-external">
                <span className="muted">Внешняя ссылка</span>
                <input
                  placeholder="Текст ссылки"
                  value={extLabel}
                  onChange={(e) => setExtLabel(e.target.value)}
                />
                <input
                  placeholder="https://…"
                  value={extUrl}
                  onChange={(e) => setExtUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && insertExternalLink()}
                />
                <button type="button" className="primary" onClick={insertExternalLink}>
                  Вставить
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
        )}
      </div>
      <textarea
        ref={textareaRef}
        rows={rows}
        value={value}
        placeholder={placeholder}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
      />
      {query !== null && (
        <MentionPickerModal
          initialQuery={query}
          defaultSettingId={defaultSettingId}
          onPick={insertMention}
          onClose={() => setQuery(null)}
        />
      )}
      {tableModalOpen && (
        <Modal onClose={() => setTableModalOpen(false)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Новая таблица</h3>
            <div className="row">
              <label className="row" style={{ gap: 6 }}>
                Строк
                <input
                  type="number"
                  min={1}
                  max={101}
                  value={tableRows}
                  onChange={(e) => changeTableSize(Number(e.target.value) || 1, tableCols)}
                  style={{ width: 60 }}
                />
              </label>
              <label className="row" style={{ gap: 6 }}>
                Столбцов
                <input
                  type="number"
                  min={1}
                  max={10}
                  value={tableCols}
                  onChange={(e) => changeTableSize(tableRows, Number(e.target.value) || 1)}
                  style={{ width: 60 }}
                />
              </label>
            </div>
            <div className="rt-table-editor">
              {tableCells.map((row, r) => (
                <div key={r} className="row rt-table-editor-row">
                  {row.map((cell, c) => (
                    <input
                      key={c}
                      value={cell}
                      placeholder={r === 0 ? `Заголовок ${c + 1}` : "ячейка"}
                      onChange={(e) => setTableCell(r, c, e.target.value)}
                    />
                  ))}
                </div>
              ))}
            </div>
            <div className="row">
              <button className="primary" onClick={confirmTable}>
                Создать
              </button>
              <button onClick={() => setTableModalOpen(false)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
});
