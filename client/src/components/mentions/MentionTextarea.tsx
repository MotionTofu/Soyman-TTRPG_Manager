import { memo, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type KeyboardEvent } from "react";
import { buildMentionToken } from "../../mentions";
import { FONT_OPTIONS, ensureFontLoaded } from "../../fonts";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { MentionPickerModal } from "./MentionPickerModal";
import { TableInsertModal } from "./TableInsertModal";
import { MentionTable, type TableSelection } from "./MentionTable";
import { findTextTables, replaceTableBlock, serializeTextTable, splitTableDocument, type TableCell, type TextTable } from "./tableDocument";
import { NavIcon } from "../NavIcons";
import type { SearchResult } from "../../types";
import { scheduleAutoResize, cancelAutoResize } from "./textareaAutoResize";
import "./mention-editor.css";

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];
const SUPPORTS_FIELD_SIZING = typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("field-sizing", "content");
function isShortcutKey(e: KeyboardEvent<HTMLTextAreaElement>, letter: string) {
  return e.code === `Key${letter}` || e.key.toUpperCase() === letter;
}

interface Props {
  id?: string;
  value: string;
  onChange: (v: string) => void;
  insertRequest?: { key: number; text: string } | null;
  onInsertHandled?: (key: number) => void;
  rows?: number;
  /** Отключает рост поля в редакторах с собственной прокруткой. */
  autoGrow?: boolean;
  placeholder?: string;
  defaultSettingId?: number;
  onKeyDown?: (e: KeyboardEvent<HTMLTextAreaElement>) => void;
  /** По умолчанию: постоянная у больших полей, при фокусе у коротких. */
  toolbar?: "always" | "focus";
}
type Location = TableSelection | null;
interface MentionRequest { location: Location; from: number; to: number; query: string }
interface EditSnapshot { value: string; location: Location; start: number; end: number }

function CommittedColorInput({ value, onCommit }: { value: string; onCommit: (color: string) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // React's onChange also handles live input events from the native color picker.
    // Native change fires when the choice is committed, after dragging finishes.
    const commit = () => onCommit(input.value);
    input.addEventListener("change", commit);
    return () => input.removeEventListener("change", commit);
  }, [onCommit]);
  return <input ref={inputRef} type="color" defaultValue={value} />;
}

/** Prose keeps its original string format; table blocks are edited as cells. */
export const MentionTextarea = memo(function MentionTextarea({ id, value, onChange, insertRequest, onInsertHandled,
  rows = 5, autoGrow = true, placeholder, defaultSettingId, onKeyDown, toolbar }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const cellRef = useRef<HTMLTextAreaElement | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;
  const lastSelection = useRef<[number, number] | null>(null);
  const cellSelectionRef = useRef<TableSelection | null>(null);
  const [cellSelection, setCellSelection] = useState<TableSelection | null>(null);
  const [focused, setFocused] = useState(false);
  const [menu, setMenu] = useState<"insert" | "style" | "link" | null>(null);
  const [query, setQuery] = useState<MentionRequest | null>(null);
  const queryRef = useRef(query);
  queryRef.current = query;
  const [extLabel, setExtLabel] = useState("");
  const [extUrl, setExtUrl] = useState("");
  const extUrlRef = useRef<HTMLInputElement>(null);
  const [tableModalOpen, setTableModalOpen] = useState(false);
  const lastInsertKey = useRef<number | null>(null);
  const undoStack = useRef<EditSnapshot[]>([]);
  const redoStack = useRef<EditSnapshot[]>([]);
  const expectedValue = useRef(value);
  const blocks = useMemo(() => splitTableDocument(value), [value]);
  const activeTable = blocks.find(block => block.kind === "table" && block.table.id === cellSelection?.id);
  const activeCell = activeTable?.kind === "table" && cellSelection ? activeTable.table.cells[cellSelection.row]?.[cellSelection.column] : undefined;
  const panelMode = toolbar ?? (rows >= 5 ? "always" : "focus");

  function snapshot(): EditSnapshot { const selected = target(); return { value: valueRef.current, ...selected }; }
  function publish(next: string, history = true) {
    if (next === valueRef.current) return;
    if (history) {
      undoStack.current.push(snapshot());
      if (undoStack.current.length > 80) undoStack.current.shift();
      redoStack.current = [];
    }
    expectedValue.current = next;
    valueRef.current = next;
    onChange(next);
  }
  function restoreEdit(redo: boolean) {
    const stack = redo ? redoStack.current : undoStack.current;
    const saved = stack.pop();
    if (!saved) return;
    (redo ? undoStack.current : redoStack.current).push(snapshot());
    publish(saved.value, false);
    setMenu(null); setQuery(null); queryRef.current = null;
    if (saved.location && findTextTables(saved.value).some(block => block.table.id === saved.location!.id)) {
      cellSelectionRef.current = saved.location; setCellSelection(saved.location);
      focusCell(saved.location, saved.start, saved.end);
    } else {
      cellSelectionRef.current = null; setCellSelection(null);
      lastSelection.current = [saved.start, saved.end]; focusText(saved.start, saved.end);
    }
  }
  function tableAt(location: TableSelection) {
    return findTextTables(valueRef.current).find(block => block.table.id === location.id);
  }
  function textAt(location: Location): string {
    if (!location) return valueRef.current;
    return tableAt(location)?.table.cells[location.row]?.[location.column]?.text ?? "";
  }
  function target() {
    const location = cellSelectionRef.current;
    if (location && cellRef.current && tableAt(location)) return { location, start: cellRef.current.selectionStart, end: cellRef.current.selectionEnd };
    return { location: null, start: lastSelection.current?.[0] ?? 0, end: lastSelection.current?.[1] ?? 0 };
  }
  function focusText(position: number, end = position) {
    requestAnimationFrame(() => {
      const inputs = Array.from(rootRef.current?.querySelectorAll<HTMLTextAreaElement>(".rt-prose-input") ?? []);
      const input = inputs.find(el => Number(el.dataset.from) <= position && Number(el.dataset.to) >= position) ?? inputs.at(-1);
      if (!input) return;
      cellSelectionRef.current = null;
      setCellSelection(null);
      textareaRef.current = input;
      input.focus();
      const offset = Number(input.dataset.from);
      input.setSelectionRange(Math.max(0, position - offset), Math.max(0, end - offset));
      lastSelection.current = [offset + input.selectionStart, offset + input.selectionEnd];
    });
  }
  function focusCell(location: TableSelection, start?: number, end = start) {
    requestAnimationFrame(() => {
      const table = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-table-id]") ?? []).find(el => el.dataset.tableId === location.id);
      const input = table?.querySelector<HTMLTextAreaElement>(`[data-row="${location.row}"][data-column="${location.column}"]`);
      input?.focus();
      if (input && start !== undefined) input.setSelectionRange(start, end ?? start);
    });
  }
  function updateTable(table: TextTable) {
    const block = findTextTables(valueRef.current).find(part => part.table.id === table.id);
    if (block) publish(replaceTableBlock(valueRef.current, block, table));
  }
  function changeCell(location: TableSelection, patch: Partial<TableCell>) {
    const block = tableAt(location);
    if (!block || !block.table.cells[location.row]?.[location.column]) return;
    const cells = block.table.cells.map((row, r) => row.map((cell, c) => r === location.row && c === location.column ? { ...cell, ...patch } : cell));
    updateTable({ ...block.table, cells });
  }
  function editProse(start: number, end: number, insert: string) {
    const source = valueRef.current;
    const block = splitTableDocument(source).find(part => part.kind === "text" && start >= part.from && end <= part.to);
    if (!block || block.kind !== "text") return { value: source.slice(0, start) + insert + source.slice(end), shift: 0 };
    let text = source.slice(block.from, start) + insert + source.slice(end, block.to);
    // Separators belong to the table boundary, even when the adjacent prose is emptied.
    const shift = block.from > 0 && !text.startsWith("\n") && !text.startsWith("\r\n") ? 1 : 0;
    if (shift) text = "\n" + text;
    if (block.to < source.length && !text.endsWith("\n")) text += "\n";
    return { value: source.slice(0, block.from) + text + source.slice(block.to), shift };
  }
  function replaceText(location: Location, start: number, end: number, insert: string, selectFrom = start + insert.length, selectTo = selectFrom, focus = true) {
    const text = textAt(location);
    const next = text.slice(0, start) + insert + text.slice(end);
    if (location) {
      changeCell(location, { text: next });
      if (focus) focusCell(location, selectFrom, selectTo);
    } else {
      const edited = editProse(start, end, insert);
      publish(edited.value);
      lastSelection.current = [selectFrom + edited.shift, selectTo + edited.shift];
      if (focus) focusText(selectFrom + edited.shift, selectTo + edited.shift);
    }
  }
  function rememberText(el: HTMLTextAreaElement) {
    textareaRef.current = el;
    cellSelectionRef.current = null;
    setCellSelection(null);
    const offset = Number(el.dataset.from);
    lastSelection.current = [offset + el.selectionStart, offset + el.selectionEnd];
  }
  function rememberCell(location: TableSelection, el: HTMLTextAreaElement) {
    cellRef.current = el;
    cellSelectionRef.current = location;
    setCellSelection(previous => previous?.id === location.id && previous.row === location.row && previous.column === location.column ? previous : location);
  }
  function detectMention(text: string, cursor: number, location: Location) {
    const match = /(?:^|\s)@([^\s\]]*)$/.exec(text.slice(0, cursor));
    setQuery(match ? { location, from: cursor - match[1].length - 1, to: cursor, query: match[1] } : null);
  }
  function handleChange(event: ChangeEvent<HTMLTextAreaElement>, from: number, to: number) {
    const el = event.currentTarget;
    rememberText(el);
    const edited = editProse(from, to, el.value);
    const cursor = from + el.selectionStart + edited.shift;
    publish(edited.value);
    lastSelection.current = [cursor, from + el.selectionEnd + edited.shift];
    if (edited.shift) focusText(cursor);
    detectMention(edited.value, cursor, null);
  }
  function cellChange(text: string, el: HTMLTextAreaElement, location: TableSelection) {
    rememberCell(location, el);
    changeCell(location, { text });
    detectMention(text, el.selectionStart, location);
  }
  function wrapSelection(before: string, after: string, fallback: string) {
    const { location, start, end } = target();
    const selected = textAt(location).slice(start, end) || fallback;
    replaceText(location, start, end, before + selected + after, start + before.length, start + before.length + selected.length);
    setMenu(null);
  }
  function toggleWeight(weight: "bold" | "italic") {
    const location = cellSelectionRef.current;
    if (location) {
      const cell = tableAt(location)?.table.cells[location.row]?.[location.column];
      if (cell) { changeCell(location, { [weight]: !cell[weight] }); focusCell(location); }
    } else wrapSelection(weight === "bold" ? "**" : "*", weight === "bold" ? "**" : "*", weight === "bold" ? "жирный текст" : "курсив");
  }
  function heading(level: number) {
    const { location, start } = target();
    const text = textAt(location);
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const newline = text.indexOf("\n", start);
    const to = newline < 0 ? text.length : newline;
    const stripped = text.slice(from, to).replace(/^#{1,3}\s+/, "");
    const next = (level ? "#".repeat(level) + " " : "") + stripped;
    replaceText(location, from, to, next, Math.max(from, start + next.length - (to - from)));
  }
  function bulletList() {
    const { location, start, end } = target();
    const text = textAt(location);
    const from = text.lastIndexOf("\n", start - 1) + 1;
    const newline = text.indexOf("\n", Math.max(end - 1, from));
    const to = newline < 0 ? text.length : newline;
    const lines = text.slice(from, to).split("\n");
    const nonempty = lines.filter(line => line.trim());
    const remove = nonempty.length > 0 && nonempty.every(line => line.startsWith("- "));
    const next = lines.map(line => !line.trim() ? line : remove ? line.replace(/^-\s+/, "") : line.startsWith("- ") ? line : `- ${line}`).join("\n");
    replaceText(location, from, to, next);
  }
  function applyStyle(patch: Partial<TableCell>, attr: string) {
    const location = cellSelectionRef.current;
    if (location) { changeCell(location, patch); focusCell(location); setMenu(null); }
    else wrapSelection(`{span ${attr}}`, "{/span}", "текст");
  }
  function triggerMention() {
    const { location, start, end } = target();
    replaceText(location, start, end, "@", start + 1, start + 1, false);
    setQuery({ location, from: start, to: start + 1, query: "" });
    setMenu(null);
  }
  async function insertMention(result: SearchResult) {
    const request = queryRef.current;
    if (!request) return;
    const token = await buildMentionToken(result.type, result.id, result.title);
    if (queryRef.current !== request) return;
    setQuery(null);
    queryRef.current = null;
    if (!token || textAt(request.location).slice(request.from, request.to) !== `@${request.query}`) return;
    replaceText(request.location, request.from, request.to, token);
  }
  function openLink() {
    const { location, start, end } = target();
    setExtLabel(textAt(location).slice(start, end));
    setExtUrl("");
    setMenu("link");
    requestAnimationFrame(() => extUrlRef.current?.focus());
  }
  function insertLink() {
    if (!extUrl.trim()) return;
    const { location, start, end } = target();
    const label = extLabel.trim() || textAt(location).slice(start, end) || extUrl.trim();
    replaceText(location, start, end, `[${label}](${extUrl.trim()})`);
    setMenu(null); setExtLabel(""); setExtUrl("");
  }
  function insertTable(table: TextTable) {
    const selected = cellSelectionRef.current;
    const currentTable = selected ? tableAt(selected) : undefined;
    const start = currentTable?.to ?? lastSelection.current?.[0] ?? valueRef.current.length;
    const end = currentTable?.to ?? lastSelection.current?.[1] ?? start;
    const before = start > 0 && valueRef.current[start - 1] !== "\n" ? "\n" : "";
    const after = valueRef.current[end] === "\n" ? "" : "\n";
    publish(valueRef.current.slice(0, start) + before + serializeTextTable(table) + after + valueRef.current.slice(end));
    setTableModalOpen(false); setMenu(null);
    const location = { id: table.id, row: table.cells.length > 1 ? 1 : 0, column: 0 };
    cellSelectionRef.current = location; setCellSelection(location); focusCell(location, 0);
  }
  function handleDrop(event: DragEvent<HTMLTextAreaElement>) {
    const raw = event.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    event.preventDefault();
    let result: SearchResult;
    try { result = JSON.parse(raw); } catch { return; }
    const input = event.currentTarget;
    const tableId = input.closest<HTMLElement>("[data-table-id]")?.dataset.tableId;
    if (tableId) rememberCell({ id: tableId, row: Number(input.dataset.row), column: Number(input.dataset.column) }, input);
    else rememberText(input);
    const { location, start, end } = target();
    void buildMentionToken(result.type, result.id, result.title).then(token => {
      if (token) replaceText(location, start, end, token + (result.kind === "spell" ? " (свиток)" : ""));
    });
  }
  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Chat's Enter/↑ shortcuts apply to prose; cells keep multiline input.
    if (!event.currentTarget.classList.contains("rt-table-cell-input")) onKeyDown?.(event);
    if (event.defaultPrevented) return;
    if (event.ctrlKey || event.metaKey) {
      if (isShortcutKey(event, "Z") || isShortcutKey(event, "Y")) {
        event.preventDefault(); restoreEdit(isShortcutKey(event, "Y") || event.shiftKey); return;
      }
      if (isShortcutKey(event, "B") || isShortcutKey(event, "I")) { event.preventDefault(); toggleWeight(isShortcutKey(event, "B") ? "bold" : "italic"); return; }
      if (isShortcutKey(event, "K")) { event.preventDefault(); openLink(); return; }
    }
    if (event.altKey && isShortcutKey(event, "Q")) { event.preventDefault(); triggerMention(); }
    if (event.altKey && isShortcutKey(event, "W")) { event.preventDefault(); wrapSelection("{quote}", "{/quote}", "цитата"); }
  }

  useEffect(() => {
    if (value !== expectedValue.current) { undoStack.current = []; redoStack.current = []; expectedValue.current = value; }
  }, [value]);

  // The request key guards repeat renders; always use the current document and caret.
  useEffect(() => {
    if (!insertRequest || lastInsertKey.current === insertRequest.key) return;
    lastInsertKey.current = insertRequest.key;
    const { location, start, end } = target();
    const from = !location && lastSelection.current === null ? valueRef.current.length : start;
    const to = !location && lastSelection.current === null ? from : end;
    const prefix = !location && lastSelection.current === null && from > 0 && !valueRef.current.endsWith("\n") ? "\n\n" : "";
    replaceText(location, from, to, prefix + insertRequest.text);
    onInsertHandled?.(insertRequest.key);
  });

  useEffect(() => {
    if (!autoGrow || SUPPORTS_FIELD_SIZING) return;
    const inputs = Array.from(rootRef.current?.querySelectorAll<HTMLTextAreaElement>(".rt-prose-input") ?? []);
    inputs.forEach(scheduleAutoResize);
    return () => inputs.forEach(cancelAutoResize);
  }, [value, autoGrow]);

  useEffect(() => {
    if (!menu) return;
    function outside(event: MouseEvent) {
      const popover = event.target instanceof Element ? event.target.closest(".rt-format-popover, .rt-popover-trigger") : null;
      if (!popover || !rootRef.current?.contains(popover)) setMenu(null);
    }
    function escape(event: globalThis.KeyboardEvent) { if (event.key === "Escape") { setMenu(null); const location = cellSelectionRef.current; if (location) focusCell(location); else if (lastSelection.current) focusText(lastSelection.current[0], lastSelection.current[1]); } }
    document.addEventListener("mousedown", outside); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("mousedown", outside); document.removeEventListener("keydown", escape); };
  }, [menu]);

  const keep = (event: React.MouseEvent) => event.preventDefault();
  return <div ref={rootRef} className={`mention-textarea-wrap rt-editor rt-editor--${panelMode}${focused ? " is-focused" : ""}${autoGrow ? "" : " rt-editor--scroll"}`}
    onFocus={() => setFocused(true)} onBlur={event => {
      if (rootRef.current?.contains(event.relatedTarget as Node)) return;
      setFocused(false);
    }}>
    <div className="rt-editor-toolbar-slot">
      <div className="rt-editor-toolbar" role="group" aria-label="Форматирование текста">
        <select className="rt-select rt-block-select" aria-label="Тип абзаца" defaultValue="0" onChange={event => { heading(Number(event.target.value)); event.target.value = "0"; }}>
          <option value="0">Абзац</option><option value="1">Заголовок 1</option><option value="2">Заголовок 2</option><option value="3">Заголовок 3</option>
        </select>
        <button type="button" className="rt-btn" aria-label="Список" title="Список" onMouseDown={keep} onClick={bulletList}>≡</button>
        <button type="button" className="rt-btn" aria-label="Цитата" title="Цитата (Alt+W)" onMouseDown={keep} onClick={() => wrapSelection("{quote}", "{/quote}", "цитата")}>❝</button>
        <span className="rt-sep" />
        <button type="button" className="rt-btn" aria-label="Упоминание" title="Упоминание (Alt+Q)" onMouseDown={keep} onClick={triggerMention}>@</button>
        <button type="button" className="rt-btn rt-popover-trigger" aria-label="Внешняя ссылка" title="Внешняя ссылка (Ctrl+K)" aria-expanded={menu === "link"} onMouseDown={keep} onClick={openLink}><NavIcon name="link" /></button>
        <span className="rt-sep" />
        <button type="button" className="rt-btn rt-popover-trigger" aria-expanded={menu === "insert"} onMouseDown={keep} onClick={() => setMenu(menu === "insert" ? null : "insert")}>Вставить ▾</button>
        <button type="button" className="rt-btn rt-popover-trigger" aria-expanded={menu === "style"} onMouseDown={keep} onClick={() => setMenu(menu === "style" ? null : "style")}>Стиль ▾</button>
      </div>
      {menu && <div className={`rt-format-popover rt-format-popover--${menu}`}>
        {menu === "insert" && <button type="button" className="rt-btn" onClick={() => { setMenu(null); setTableModalOpen(true); }}>Таблица…</button>}
        {menu === "style" && <>
          <label>Цвет текста <CommittedColorInput value={activeCell?.color ?? "#e3d9c6"} onCommit={color => applyStyle({ color }, `color="${color}"`)} /></label>
          <label>Размер <select aria-label="Размер шрифта" defaultValue="" onChange={event => { if (event.target.value) applyStyle({ size: Number(event.target.value) }, `size="${event.target.value}"`); }}>
            <option value="" disabled>Размер</option>{FONT_SIZES.map(size => <option key={size} value={size}>{size}px</option>)}</select></label>
          <label>Шрифт <select aria-label="Шрифт" defaultValue="" onChange={event => {
            const font = FONT_OPTIONS.find(option => option.family === event.target.value);
            if (font) ensureFontLoaded(font);
            if (event.target.value) applyStyle({ font: event.target.value }, `font="${event.target.value}"`);
          }}><option value="" disabled>Шрифт</option>{FONT_OPTIONS.filter(font => font.family).map(font => <option key={font.family} value={font.family}>{font.label}</option>)}</select></label>
        </>}
        {menu === "link" && <>
          <input aria-label="Текст ссылки" placeholder="Текст ссылки" value={extLabel} onChange={event => setExtLabel(event.target.value)} />
          <input ref={extUrlRef} aria-label="Адрес ссылки" placeholder="https://…" value={extUrl} onChange={event => setExtUrl(event.target.value)} onKeyDown={event => { if (event.key === "Enter") insertLink(); }} />
          <button type="button" className="primary" onClick={insertLink}>Вставить ссылку</button>
        </>}
      </div>}
    </div>
    <div className="rt-editor-content">{blocks.map((block, index) => block.kind === "table" ? <div key={`table-${block.table.id}`} data-table-id={block.table.id}>
      <MentionTable table={block.table} selection={cellSelection} onSelect={rememberCell} onChange={updateTable}
        onDelete={() => {
          publish(valueRef.current.slice(0, block.from) + valueRef.current.slice(block.to));
          cellSelectionRef.current = null; setCellSelection(null); lastSelection.current = [block.from, block.from]; focusText(block.from);
        }}
        onKeyDown={handleKeyDown} onCellChange={(text, el) => cellChange(text, el, { id: block.table.id, row: Number(el.dataset.row), column: Number(el.dataset.column) })} onCellDrop={handleDrop} />
    </div> : <textarea key={`text-${block.key}`} id={index === 0 ? id : undefined} className="rt-prose-input" data-from={block.from} data-to={block.to}
      ref={el => { if (index === 0 && !textareaRef.current) textareaRef.current = el; }} rows={blocks.length === 1 ? rows : 1} value={block.text}
      placeholder={index === 0 ? placeholder : "Продолжить текст…"} aria-label={index === 0 ? undefined : "Продолжение текста"}
      onFocus={event => rememberText(event.currentTarget)} onSelect={event => rememberText(event.currentTarget)}
      onChange={event => handleChange(event, block.from, block.to)} onKeyDown={handleKeyDown} onDragOver={event => event.preventDefault()} onDrop={handleDrop} />)}</div>
    {query && <MentionPickerModal initialQuery={query.query} defaultSettingId={defaultSettingId} onPick={insertMention} onClose={() => {
      const location = query.location; setQuery(null); queryRef.current = null;
      if (location) focusCell(location, query.to); else focusText(query.to);
    }} />}
    {tableModalOpen && <TableInsertModal onInsertTable={insertTable} onClose={() => setTableModalOpen(false)} />}
  </div>;
});
