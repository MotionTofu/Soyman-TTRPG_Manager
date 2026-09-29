import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import "./sheet.css";

// Экран «Лист»: длинный текст страницей А4 (гриллинг 2026-09-29, Q1–Q34).
// Лист — соотношение 210:297, а не пиксели: масштаб меняет ширину и поля,
// шрифт растёт вместе с ним, но не падает ниже обычного (Q17). Плашки
// действий и вида висят у верхних углов листа и не уезжают при прокрутке
// (Q26). Оглавление — слева, если в тексте хотя бы два заголовка (Q21).

export type SheetMode = "source" | "hybrid" | "reading";

const MODE_LABEL: Record<SheetMode, { short: string; title: string }> = {
  source: { short: "MD", title: "Исходник — разметка как есть" },
  hybrid: { short: "◧", title: "Гибрид — разметка раскрывается под курсором" },
  reading: { short: "¶", title: "Чтение" },
};

/** Ширина листа при 100 % — А4 на экране 96 dpi. */
const BASE_WIDTH = 794;
const PAGE_RATIO = 297 / 210;
const ZOOM_STEPS = [0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
/** «По ширине» не раздувает лист больше этого: строка длиннее уже не читается. */
const FIT_MAX = 1.25;
const FIT_MIN = 0.5;
/** Колонка оглавления + зазоры по краям сцены. */
const TOC_WIDTH = 190;
const STAGE_GUTTER = 48;

type Zoom = number | "fit";

function readPref(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writePref(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* приватное окно — настройка просто не запомнится */ }
}

function readZoom(): Zoom {
  const raw = Number(readPref("sheet.zoom"));
  return ZOOM_STEPS.includes(raw) ? raw : "fit";
}

/** Режим, который зритель выбирал последним (Q10). */
export function rememberedSheetMode(allowed: SheetMode[]): SheetMode | null {
  const raw = readPref("sheet.mode") as SheetMode | null;
  return raw && allowed.includes(raw) ? raw : null;
}

/** Кнопка плашки с всплывающим меню; закрывается щелчком мимо и Escape. */
export function SheetMenu({ label, icon, open, onOpenChange, children, wide }: {
  label: string;
  icon: ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      if (!ref.current?.contains(event.target as Node)) onOpenChange(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onOpenChange(false); };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, onOpenChange]);
  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex" }}>
      <button type="button" className={`sheet-btn${open ? " is-on" : ""}`} title={label} aria-label={label}
        aria-expanded={open} onClick={() => onOpenChange(!open)}>{icon}</button>
      {open && <div className="sheet-pop" style={wide ? { width: 360 } : undefined}>{children}</div>}
    </span>
  );
}

interface Heading { level: number; text: string; el: HTMLElement }

interface Props {
  /** Ключ документа — под ним запоминается место прокрутки (Q30). */
  docKey: string;
  /** «Назад»: ссылкой (`to`) или действием — лист поверх карточки закрывается, а не уходит. */
  back: { to?: string; label: string; onClick?: (event: MouseEvent<HTMLElement>) => void };
  /** Кнопки левой плашки, после «Назад». */
  actions?: ReactNode;
  modes: SheetMode[];
  mode: SheetMode;
  onMode: (mode: SheetMode) => void;
  /** Меняется вместе с текстом — по нему пересобирается оглавление. */
  contentKey: unknown;
  /** Строка над листом: ошибки сохранения, конфликт версий. */
  notice?: ReactNode;
  children: ReactNode;
}

export function SheetView({ docKey, back, actions, modes, mode, onMode, contentKey, notice, children }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const [stageWidth, setStageWidth] = useState(0);
  const [sheetHeight, setSheetHeight] = useState(0);
  const [zoom, setZoomState] = useState<Zoom>(readZoom);
  const [breaks, setBreaksState] = useState(() => readPref("sheet.breaks") === "1");
  const [headings, setHeadings] = useState<Heading[]>([]);
  const [activeHeading, setActiveHeading] = useState(0);
  const [tocOpen, setTocOpen] = useState(false);

  const showToc = headings.length >= 2;
  const fitZoom = Math.min(FIT_MAX, Math.max(FIT_MIN,
    (stageWidth - STAGE_GUTTER - (showToc ? TOC_WIDTH : 0)) / BASE_WIDTH));
  const z = zoom === "fit" ? fitZoom : zoom;
  const pageHeight = BASE_WIDTH * z * PAGE_RATIO;

  function setZoom(next: Zoom) {
    setZoomState(next);
    writePref("sheet.zoom", next === "fit" ? null : String(next));
  }
  function stepZoom(dir: 1 | -1) {
    const next = dir > 0 ? ZOOM_STEPS.find(s => s > z + 0.001) : [...ZOOM_STEPS].reverse().find(s => s < z - 0.001);
    if (next) setZoom(next);
  }
  function toggleBreaks() {
    setBreaksState(v => { writePref("sheet.breaks", v ? null : "1"); return !v; });
  }
  function pickMode(next: SheetMode) {
    writePref("sheet.mode", next);
    onMode(next);
  }

  useLayoutEffect(() => {
    const stage = stageRef.current, sheet = sheetRef.current;
    if (!stage || !sheet) return;
    const ro = new ResizeObserver(() => {
      setStageWidth(stage.clientWidth);
      setSheetHeight(sheet.offsetHeight);
    });
    ro.observe(stage);
    ro.observe(sheet);
    return () => ro.disconnect();
  }, []);

  // Ctrl+колесо — масштаб. Слушатель не пассивный: иначе браузер начнёт
  // масштабировать всю страницу.
  const stepRef = useRef(stepZoom);
  stepRef.current = stepZoom;
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const onWheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      stepRef.current(event.deltaY < 0 ? 1 : -1);
    };
    stage.addEventListener("wheel", onWheel, { passive: false });
    return () => stage.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    // MentionText рисует заголовки span-ами .rt-h1…3 (тот же текст живёт и
    // строкой в карточке), редактор — настоящими h1…3.
    setHeadings([...sheet.querySelectorAll<HTMLElement>("h1, h2, h3, .rt-h1, .rt-h2, .rt-h3")].map(el => ({
      level: /^H\d$/.test(el.tagName) ? Number(el.tagName[1]) : Number(el.className.match(/rt-h(\d)/)?.[1] ?? 1),
      text: el.textContent?.trim() ?? "",
      el,
    })).filter(h => h.text));
  }, [contentKey, mode]);

  // Место прокрутки: возвращается при открытии, пишется по ходу чтения.
  // Текст приезжает не сразу: пока лист короче сохранённой позиции, браузер
  // обрежет прокрутку, поэтому возврат ждёт, когда высоты хватит, а до него
  // позиция не перезаписывается.
  const scrollKey = `sheet.scroll.${docKey}`;
  const restoredRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!stage || restoredRef.current === scrollKey) return;
    const saved = Number(readPref(scrollKey));
    if (!(saved > 0)) { restoredRef.current = scrollKey; return; }
    if (stage.scrollHeight - stage.clientHeight < saved) return;
    stage.scrollTop = saved;
    restoredRef.current = scrollKey;
  }, [scrollKey, sheetHeight, contentKey]);
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (restoredRef.current !== scrollKey) return;
        writePref(scrollKey, stage.scrollTop > 0 ? String(Math.round(stage.scrollTop)) : null);
        const top = stage.getBoundingClientRect().top + 80;
        let current = 0;
        headings.forEach((h, i) => { if (h.el.getBoundingClientRect().top <= top) current = i; });
        setActiveHeading(current);
      }, 150);
    };
    stage.addEventListener("scroll", onScroll, { passive: true });
    return () => { stage.removeEventListener("scroll", onScroll); window.clearTimeout(timer); };
  }, [scrollKey, headings]);

  // Щелчок по пустому полю листа под текстом — курсор в конец, как в
  // Obsidian; иначе промах мимо строк не давал писать вовсе.
  function focusEditorEnd(event: MouseEvent<HTMLElement>) {
    if (event.button !== 0 || mode === "reading") return;
    const content = sheetRef.current?.querySelector<HTMLElement>(".cm-content");
    if (!content || content.contains(event.target as Node)) return;
    const view = EditorView.findFromDOM(content);
    if (!view) return;
    event.preventDefault();
    view.dispatch({ selection: EditorSelection.cursor(view.state.doc.length), scrollIntoView: true });
    view.focus();
  }

  function jump(h: Heading) {
    h.el.scrollIntoView({ behavior: "smooth", block: "start" });
    setTocOpen(false);
  }

  const pages = breaks ? Math.max(0, Math.ceil(sheetHeight / pageHeight) - 1) : 0;
  const backLink = back.to
    ? <Link to={back.to} onClick={back.onClick} className="sheet-btn" title={back.label} aria-label={back.label}>←</Link>
    : <button type="button" onClick={back.onClick} className="sheet-btn" title={back.label} aria-label={back.label}>←</button>;
  const toc = (
    <nav className="sheet-toc__list" aria-label="Содержание">
      {headings.map((h, i) => (
        <button key={i} type="button" onClick={() => jump(h)}
          className={`sheet-toc__item sheet-toc__item--h${h.level}${i === activeHeading ? " is-current" : ""}`}>
          {h.text}
        </button>
      ))}
    </nav>
  );

  return (
    <div className="sheet-stage" ref={stageRef}>
      <div className="sheet-layout">
        {showToc && (
          <aside className="sheet-toc">
            {back.to
              ? <Link to={back.to} onClick={back.onClick} className="sheet-toc__back">← {back.label}</Link>
              : <button type="button" onClick={back.onClick} className="sheet-toc__back">← {back.label}</button>}
            <span className="sheet-toc__title">Содержание</span>
            {toc}
          </aside>
        )}
        {showToc && (
          <div className="sheet-toc-spine">
            <button type="button" className="sheet-toc-spine__btn" aria-expanded={tocOpen} onClick={() => setTocOpen(v => !v)}>Содержание</button>
            {tocOpen && <div className="sheet-toc-spine__pop">{toc}</div>}
          </div>
        )}
        <div className="sheet-col" style={{ width: BASE_WIDTH * z }}>
          {notice}
          <div className="sheet-bar">
            <div className="sheet-plate sheet-plate--left">
              {/* При колонке оглавления «Назад» стоит в ней; на узком окне,
                  где колонка свёрнута в корешок, — здесь. */}
              <span className={showToc ? "sheet-back--narrow" : "sheet-back"}>{backLink}</span>
              {actions}
            </div>
            <div className="sheet-plate sheet-plate--right" role="group" aria-label="Вид документа">
              {modes.map(m => (
                <button key={m} type="button" className={`sheet-btn${m === mode ? " is-on" : ""}`}
                  aria-pressed={m === mode} title={MODE_LABEL[m].title} aria-label={MODE_LABEL[m].title}
                  onClick={() => pickMode(m)}>{MODE_LABEL[m].short}</button>
              ))}
              <span className="sheet-plate__sep" />
              <button type="button" className="sheet-btn" title="Мельче (Ctrl+колесо)" aria-label="Мельче" onClick={() => stepZoom(-1)}>−</button>
              <span className="sheet-plate__zoom">{Math.round(z * 100)}%</span>
              <button type="button" className="sheet-btn" title="Крупнее (Ctrl+колесо)" aria-label="Крупнее" onClick={() => stepZoom(1)}>+</button>
              <button type="button" className={`sheet-btn${zoom === "fit" ? " is-on" : ""}`} aria-pressed={zoom === "fit"}
                title="По ширине" aria-label="По ширине" onClick={() => setZoom("fit")}>↔</button>
              <span className="sheet-plate__sep" />
              <button type="button" className={`sheet-btn${breaks ? " is-on" : ""}`} aria-pressed={breaks}
                title="Разрывы страниц" aria-label="Разрывы страниц" onClick={toggleBreaks}>⋯</button>
            </div>
          </div>
          <article ref={sheetRef} className={`sheet sheet--${mode}`} onMouseDown={focusEditorEnd}
            style={{ ["--sheet-z" as string]: z, minHeight: pageHeight }}>
            {children}
            {Array.from({ length: pages }, (_, i) => (
              <div key={i} className="sheet-break" style={{ top: pageHeight * (i + 1) }} aria-hidden="true">
                <span>— {i + 2} —</span>
              </div>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}
