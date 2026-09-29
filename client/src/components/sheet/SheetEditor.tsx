import { useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import {
  Decoration, EditorView, MatchDecorator, ViewPlugin, keymap, placeholder as cmPlaceholder,
  type DecorationSet, type ViewUpdate,
} from "@codemirror/view";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";
import { LEGACY_MENTION_RE, MENTION_RE, buildMentionToken, mentionTone, resolveMention, useMentionIndex } from "../../mentions";
import { FONT_OPTIONS, ensureFontLoaded } from "../../fonts";
import { SEARCH_DRAG_MIME } from "../LinkDropZone";
import { MentionPickerModal } from "../mentions/MentionPickerModal";
import { TableInsertModal } from "../mentions/TableInsertModal";
import type { SearchResult } from "../../types";

// Редактор листа на CodeMirror 6 — режим «Исходник» (гриллинг 2026-09-29,
// Q8): разметка видна как есть, но размечена цветом. Умеет то же, что
// MentionTextarea: «@» и Alt+Q — упоминание, Alt+W — цитата, Ctrl+B/I/K,
// перетаскивание из поиска. Форматирование — своим меню по ПКМ (Q25), родное
// меню браузера — по Shift+ПКМ.

const FONT_SIZES = [12, 14, 16, 18, 20, 24, 28, 32, 40];

/** Обе формы токена с группами: рабочая — (тип)(ключ), наследная — (тип)(id). */
const TOKEN_RE = new RegExp(`${MENTION_RE.source}|${LEGACY_MENTION_RE.source}`, "g");

const refreshMentions = StateEffect.define<null>();

function mentionClass(m: RegExpExecArray): string {
  if (m[1]) {
    const id = resolveMention(m[1], m[2]);
    return id == null ? "cm-mention cm-mention--dead" : `cm-mention mention--${mentionTone(m[1], id)}`;
  }
  return `cm-mention mention--${mentionTone(m[5], Number(m[6]))}`;
}

// Упоминание подкрашено тем же маркером, что в чтении (Q34). Карта ключей
// может приехать позже текста — тогда разметка пересчитывается целиком.
const mentionDecorator = new MatchDecorator({
  regexp: TOKEN_RE,
  decoration: (m) => Decoration.mark({ class: mentionClass(m) }),
});
const legacyTagDecorator = new MatchDecorator({
  regexp: /\{\/?(?:quote|span)\b[^}]*\}/g,
  decoration: Decoration.mark({ class: "cm-rt-tag" }),
});

function decoPlugin(decorator: MatchDecorator) {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet;
    constructor(view: EditorView) { this.decorations = decorator.createDeco(view); }
    update(u: ViewUpdate) {
      this.decorations = u.transactions.some(tr => tr.effects.some(e => e.is(refreshMentions)))
        ? decorator.createDeco(u.view)
        : decorator.updateDeco(u, this.decorations);
    }
  }, { decorations: v => v.decorations });
}

const highlight = HighlightStyle.define([
  { tag: t.heading1, fontSize: "1.5em", fontWeight: "700", fontFamily: "var(--font-display)" },
  { tag: t.heading2, fontSize: "1.25em", fontWeight: "700", fontFamily: "var(--font-display)" },
  { tag: t.heading3, fontSize: "1.1em", fontWeight: "700" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.quote, fontStyle: "italic" },
  { tag: t.processingInstruction, color: "var(--muted)" },
  { tag: t.link, color: "var(--accent)" },
  { tag: t.url, color: "var(--muted)" },
  { tag: t.monospace, fontFamily: "var(--font-mono)", fontSize: ".92em" },
  { tag: t.contentSeparator, color: "var(--muted)" },
]);

// ---- правки текста: все идут через основное выделение ----

function wrapSelection(view: EditorView, before: string, after: string, placeholder: string) {
  const { from, to } = view.state.selection.main;
  const selected = view.state.sliceDoc(from, to) || placeholder;
  view.dispatch({
    changes: { from, to, insert: before + selected + after },
    selection: EditorSelection.range(from + before.length, from + before.length + selected.length),
    userEvent: "input.format",
  });
  view.focus();
}

function toggleHeading(view: EditorView, level: 1 | 2 | 3) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const prefix = "#".repeat(level) + " ";
  const stripped = line.text.replace(/^#{1,3}\s+/, "");
  const next = line.text.startsWith(prefix) ? stripped : prefix + stripped;
  view.dispatch({ changes: { from: line.from, to: line.to, insert: next }, userEvent: "input.format" });
  view.focus();
}

function toggleBulletList(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const doc = view.state.doc;
  const first = doc.lineAt(from).number, last = doc.lineAt(to).number;
  const lines = [];
  for (let n = first; n <= last; n++) lines.push(doc.line(n));
  const nonEmpty = lines.filter(l => l.text.trim());
  const allBulleted = nonEmpty.length > 0 && nonEmpty.every(l => l.text.startsWith("- "));
  view.dispatch({
    changes: nonEmpty.map(l => allBulleted
      ? { from: l.from, to: l.from + (l.text.match(/^-\s+/)?.[0].length ?? 0), insert: "" }
      : l.text.startsWith("- ") ? { from: l.from, insert: "" } : { from: l.from, insert: "- " }),
    userEvent: "input.format",
  });
  view.focus();
}

function insertAtCursor(view: EditorView, text: string, blockLevel = false) {
  const { from, to } = view.state.selection.main;
  const needsBreak = blockLevel && from > 0 && view.state.sliceDoc(from - 1, from) !== "\n";
  const insert = (needsBreak ? "\n" : "") + text;
  view.dispatch({ changes: { from, to, insert }, selection: EditorSelection.cursor(from + insert.length), userEvent: "input" });
  view.focus();
}

interface MenuState { x: number; y: number; link?: boolean }

interface Props {
  value: string;
  onChange: (value: string) => void;
  insertRequest?: { key: number; text: string } | null;
  onInsertHandled?: (key: number) => void;
  defaultSettingId?: number;
  placeholder?: string;
  /** Растёт — открыть меню форматирования у курсора («Aa» на сенсорном экране, Q27). */
  menuRequest?: number;
}

export function SheetEditor({ value, onChange, insertRequest, onInsertHandled, defaultSettingId, placeholder, menuRequest }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [mention, setMention] = useState<{ from: number; query: string } | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [tableOpen, setTableOpen] = useState(false);
  const mentionIndex = useMentionIndex();

  function openMentionPicker(view: EditorView) {
    const { from, to } = view.state.selection.main;
    view.dispatch({ changes: { from, to, insert: "@" }, selection: EditorSelection.cursor(from + 1), userEvent: "input" });
    setMention({ from, query: "" });
  }

  function openMenuAtCursor(link = false) {
    const view = viewRef.current;
    if (!view) return;
    const rect = view.coordsAtPos(view.state.selection.main.head);
    setMenu({ x: rect?.left ?? 100, y: (rect?.bottom ?? 100) + 4, link });
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = new EditorView({
      parent: host,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          keymap.of([
            { key: "Mod-b", run: v => { wrapSelection(v, "**", "**", "жирный текст"); return true; } },
            { key: "Mod-i", run: v => { wrapSelection(v, "*", "*", "курсив"); return true; } },
            { key: "Mod-k", run: () => { openMenuAtCursor(true); return true; } },
            { key: "Alt-q", run: v => { openMentionPicker(v); return true; } },
            { key: "Alt-w", run: v => { wrapSelection(v, "{quote}", "{/quote}", "цитата"); return true; } },
            ...defaultKeymap,
            ...historyKeymap,
          ]),
          markdown(),
          syntaxHighlighting(highlight),
          EditorView.lineWrapping,
          cmPlaceholder(placeholder ?? "Пишите в Markdown: # заголовок, **жирный**, @ — упоминание"),
          decoPlugin(mentionDecorator),
          decoPlugin(legacyTagDecorator),
          EditorView.updateListener.of(u => {
            if (!u.docChanged) return;
            onChangeRef.current(u.state.doc.toString());
            // «@» набран руками — открыть окно упоминаний с тем, что после него.
            if (!u.transactions.some(tr => tr.isUserEvent("input.type"))) return;
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            const before = line.text.slice(0, head - line.from);
            const m = /(?:^|\s)@([^\s\]]*)$/.exec(before);
            if (m) setMention({ from: head - m[1].length - 1, query: m[1] });
          }),
          EditorView.domEventHandlers({
            drop: (event, v) => {
              const raw = event.dataTransfer?.getData(SEARCH_DRAG_MIME);
              if (!raw) return false;
              event.preventDefault();
              const pos = v.posAtCoords({ x: event.clientX, y: event.clientY }) ?? v.state.doc.length;
              const result: SearchResult = JSON.parse(raw);
              void buildMentionToken(result.type, result.id, result.title).then(token => {
                if (!token) return;
                // Заклинание, брошенное в текст, — это свиток с ним.
                const text = token + (result.kind === "spell" ? " (свиток)" : "");
                v.dispatch({ changes: { from: pos, insert: text }, userEvent: "input.drop" });
              });
              return true;
            },
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
    // Редактор создаётся один раз; value дальше сверяется в эффекте ниже.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Текст сменился снаружи (перечитан с сервера) — подменить целиком.
  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshMentions.of(null) });
  }, [mentionIndex]);

  const lastInsertKey = useRef<number | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !insertRequest || lastInsertKey.current === insertRequest.key) return;
    lastInsertKey.current = insertRequest.key;
    insertAtCursor(view, insertRequest.text);
    onInsertHandled?.(insertRequest.key);
  }, [insertRequest, onInsertHandled]);

  const lastMenuRequest = useRef(menuRequest);
  useEffect(() => {
    if (menuRequest === lastMenuRequest.current) return;
    lastMenuRequest.current = menuRequest;
    openMenuAtCursor();
  }, [menuRequest]);

  async function pickMention(result: SearchResult) {
    const view = viewRef.current;
    const at = mention;
    setMention(null);
    if (!view || !at) return;
    const token = await buildMentionToken(result.type, result.id, result.title);
    if (!token) return;
    const to = Math.min(view.state.doc.length, at.from + 1 + at.query.length);
    view.dispatch({
      changes: { from: at.from, to, insert: token },
      selection: EditorSelection.cursor(at.from + token.length),
      userEvent: "input",
    });
    view.focus();
  }

  function onContextMenu(event: ReactMouseEvent) {
    if (event.shiftKey) return; // Shift+ПКМ — родное меню браузера (орфография)
    event.preventDefault();
    setMenu({ x: event.clientX, y: event.clientY });
  }

  return (
    <div className="sheet-editor" ref={hostRef} onContextMenu={onContextMenu}>
      {mention && (
        <MentionPickerModal initialQuery={mention.query} defaultSettingId={defaultSettingId}
          onPick={pickMention} onClose={() => { setMention(null); viewRef.current?.focus(); }} />
      )}
      {tableOpen && (
        <TableInsertModal onClose={() => setTableOpen(false)} onInsert={table => {
          setTableOpen(false);
          if (viewRef.current) insertAtCursor(viewRef.current, table, true);
        }} />
      )}
      {menu && viewRef.current && (
        <FormatMenu view={viewRef.current} at={menu} onClose={() => setMenu(null)}
          onMention={() => { setMenu(null); if (viewRef.current) openMentionPicker(viewRef.current); }}
          onTable={() => { setMenu(null); setTableOpen(true); }} />
      )}
    </div>
  );
}

function FormatMenu({ view, at, onClose, onMention, onTable }: {
  view: EditorView;
  at: MenuState;
  onClose: () => void;
  onMention: () => void;
  onTable: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [linkOpen, setLinkOpen] = useState(!!at.link);
  const [label, setLabel] = useState(() => {
    const { from, to } = view.state.selection.main;
    return view.state.sliceDoc(from, to);
  });
  const [url, setUrl] = useState("");
  const [pasteError, setPasteError] = useState(false);

  useEffect(() => {
    const onDown = (event: PointerEvent) => { if (!ref.current?.contains(event.target as Node)) onClose(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { onClose(); view.focus(); } };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [onClose, view]);

  // Меню не должно уезжать за край окна.
  const [pos, setPos] = useState({ left: at.x, top: at.y });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setPos({
      left: Math.max(8, Math.min(at.x, window.innerWidth - r.width - 8)),
      top: Math.max(8, Math.min(at.y, window.innerHeight - r.height - 8)),
    });
  }, [at.x, at.y, linkOpen]);

  const act = (fn: () => void) => () => { fn(); onClose(); };
  const keep = (event: ReactMouseEvent) => event.preventDefault(); // выделение в тексте не теряется
  const clip = (command: "cut" | "copy") => act(() => { view.focus(); document.execCommand(command); });

  async function paste() {
    try {
      const text = await navigator.clipboard.readText();
      insertAtCursor(view, text);
      onClose();
    } catch {
      setPasteError(true);
    }
  }

  function insertLink() {
    if (!url.trim()) return;
    const { from, to } = view.state.selection.main;
    const text = `[${label.trim() || view.state.sliceDoc(from, to) || url.trim()}](${url.trim()})`;
    view.dispatch({ changes: { from, to, insert: text }, selection: EditorSelection.cursor(from + text.length) });
    view.focus();
    onClose();
  }

  return (
    <div ref={ref} className="sheet-menu" role="menu" style={pos}>
      <button type="button" onMouseDown={keep} onClick={clip("cut")}>Вырезать <kbd>Ctrl+X</kbd></button>
      <button type="button" onMouseDown={keep} onClick={clip("copy")}>Копировать <kbd>Ctrl+C</kbd></button>
      <button type="button" onMouseDown={keep} onClick={() => void paste()}>Вставить <kbd>Ctrl+V</kbd></button>
      {pasteError && <span className="sheet-menu__note">Браузер не дал прочитать буфер — Ctrl+V</span>}
      <hr />
      <div className="sheet-menu__row">
        <button type="button" onMouseDown={keep} title="Жирный (Ctrl+B)" aria-label="Жирный" onClick={act(() => wrapSelection(view, "**", "**", "жирный текст"))}><b>Ж</b></button>
        <button type="button" onMouseDown={keep} title="Курсив (Ctrl+I)" aria-label="Курсив" onClick={act(() => wrapSelection(view, "*", "*", "курсив"))}><i>К</i></button>
        <button type="button" onMouseDown={keep} title="Цитата (Alt+W)" aria-label="Цитата" onClick={act(() => wrapSelection(view, "{quote}", "{/quote}", "цитата"))}>❝</button>
        <button type="button" onMouseDown={keep} title="Список" aria-label="Список" onClick={act(() => toggleBulletList(view))}>≡</button>
        <button type="button" onMouseDown={keep} title="Заголовок 1" aria-label="Заголовок 1" onClick={act(() => toggleHeading(view, 1))}>H1</button>
        <button type="button" onMouseDown={keep} title="Заголовок 2" aria-label="Заголовок 2" onClick={act(() => toggleHeading(view, 2))}>H2</button>
        <button type="button" onMouseDown={keep} title="Заголовок 3" aria-label="Заголовок 3" onClick={act(() => toggleHeading(view, 3))}>H3</button>
      </div>
      <div className="sheet-menu__row sheet-menu__row--fields">
        <label title="Цвет текста">Цвет
          <input type="color" defaultValue="#e3d9c6"
            onChange={e => { wrapSelection(view, `{span color="${e.target.value}"}`, "{/span}", "текст"); onClose(); }} />
        </label>
        <select aria-label="Размер" defaultValue="" onChange={e => {
          if (e.target.value) wrapSelection(view, `{span size="${e.target.value}"}`, "{/span}", "текст");
          onClose();
        }}>
          <option value="" disabled>Размер</option>
          {FONT_SIZES.map(s => <option key={s} value={s}>{s}px</option>)}
        </select>
        <select aria-label="Шрифт" defaultValue="" onChange={e => {
          const font = FONT_OPTIONS.find(f => f.family === e.target.value);
          if (font) { ensureFontLoaded(font); wrapSelection(view, `{span font="${font.family}"}`, "{/span}", "текст"); }
          onClose();
        }}>
          <option value="" disabled>Шрифт</option>
          {FONT_OPTIONS.filter(f => f.family).map(f => <option key={f.family} value={f.family}>{f.label}</option>)}
        </select>
      </div>
      <hr />
      <button type="button" onMouseDown={keep} onClick={onMention}>Упоминание <kbd>Alt+Q</kbd></button>
      <button type="button" onMouseDown={keep} onClick={() => setLinkOpen(v => !v)}>Внешняя ссылка <kbd>Ctrl+K</kbd></button>
      {linkOpen && (
        <div className="sheet-menu__link">
          <input placeholder="Текст ссылки" value={label} onChange={e => setLabel(e.target.value)} />
          <input autoFocus placeholder="https://…" value={url} onChange={e => setUrl(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter") insertLink(); }} />
          <button type="button" className="primary" onClick={insertLink}>Вставить</button>
        </div>
      )}
      <button type="button" onMouseDown={keep} onClick={onTable}>Таблица…</button>
      <hr />
      <span className="sheet-menu__note">Меню браузера — Shift+ПКМ</span>
    </div>
  );
}
