import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { saveDndPrefs } from "../../dndPrefs";
import { useDndPrefs } from "../../hooks/useDndPrefs";
import type { SaveStatus } from "../../data/queuedSave";
import "./sheet-chrome.css";

/**
 * Верхняя полоса полноэкранного листа основного SoyMan — как шапка OneShot
 * (гриллинг 2026-09-26, Q9/Q19): «← назад», имя, переключатель листов,
 * статус сохранения и меню «⋯». «Отправить Мастеру» здесь нет — Мастер
 * видит лист в приложении.
 */
export function SheetTopBar({
  title,
  status,
  onBack,
  sheets,
  activeId,
  onSelect,
  onNew,
  onDeck,
  onGestures,
  onDownloadHtml,
  onDownloadBackup,
  largeCards,
  onLargeCards,
  busy,
}: {
  title: string;
  status: SaveStatus;
  onBack: () => void;
  sheets: { id: number; title: string }[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew?: () => void;
  /** Колода веером — только у листа D&D. */
  onDeck?: () => void;
  onGestures: () => void;
  onDownloadHtml?: () => void;
  onDownloadBackup?: () => void;
  largeCards: boolean;
  onLargeCards: (v: boolean) => void;
  /** Идёт скачивание: пункты «Файлы» заняты, статус — «Собираю файл…». */
  busy?: boolean;
}) {
  const prefs = useDndPrefs();
  const [open, setOpen] = useState(false);
  const barRef = useRef<HTMLElement>(null);

  // Полоса — от края до края экрана, где бы ни стояла страница листа.
  useLayoutEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    const fit = () => {
      bar.style.marginLeft = "0px";
      bar.style.marginLeft = `${-bar.getBoundingClientRect().left}px`;
    };
    fit();
    // Поля страницы меняются и после первого кадра (класс полноэкранного
    // листа ставит страница своим эффектом) — следим за размером и её.
    const observer = new ResizeObserver(fit);
    if (bar.parentElement) observer.observe(bar.parentElement);
    window.addEventListener("resize", fit);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !barRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };
  const index = sheets.findIndex((s) => s.id === activeId);

  return (
    <header className="sheet-bar" ref={barRef}>
      <button type="button" className="sheet-bar-back" onClick={onBack} aria-label="Назад к профилю персонажа">
        ←
      </button>
      <span className="sheet-bar-title">
        <span className="sheet-bar-name">{title}</span>
        {sheets.length > 1 && (
          <label className="sheet-bar-switch">
            <span>
              ▾ лист {index + 1} из {sheets.length}
            </span>
            <select value={activeId ?? ""} onChange={(e) => onSelect(Number(e.target.value))} aria-label="Какой лист открыть">
              {sheets.map((s, i) => (
                <option key={s.id} value={s.id}>
                  {i + 1}. {s.title}
                </option>
              ))}
            </select>
          </label>
        )}
      </span>
      <span role="status" className="sheet-bar-status">
        {busy ? "Собираю файл…" : status === "saving" ? "Сохраняю…" : status === "error" ? "Не сохранено" : "Сохранено"}
      </span>
      <button
        type="button"
        className="sheet-bar-toggle"
        aria-label="Дополнительные действия"
        aria-expanded={open}
        aria-controls="sheet-bar-options"
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>
      <div id="sheet-bar-options" className="sheet-bar-options" data-open={open}>
        {onDeck && (
          <button type="button" className="sheet-bar-deck" onClick={run(onDeck)}>
            Колода карт
          </button>
        )}
        <span className="sheet-bar-section">Вид</span>
        <label className="sheet-bar-check">
          <input
            type="checkbox"
            checked={prefs.abilityPrimary === "mod"}
            onChange={(e) => saveDndPrefs({ ...prefs, abilityPrimary: e.target.checked ? "mod" : "score" })}
          />{" "}
          На кости — модификатор
        </label>
        <label className="sheet-bar-check">
          <input
            type="checkbox"
            checked={prefs.poolMarks === "strike"}
            onChange={(e) => saveDndPrefs({ ...prefs, poolMarks: e.target.checked ? "strike" : "tofu" })}
          />{" "}
          Ресурсы — зачёркивать
        </label>
        {onDownloadBackup && (
          <label className="sheet-bar-check">
            <input type="checkbox" checked={largeCards} onChange={(e) => onLargeCards(e.target.checked)} /> Большие карты в копии
          </label>
        )}
        {(onDownloadHtml || onDownloadBackup) && <span className="sheet-bar-section">Файлы</span>}
        {onDownloadHtml && (
          <button type="button" disabled={busy} onClick={run(onDownloadHtml)}>
            Скачать автономный HTML
          </button>
        )}
        {onDownloadBackup && (
          <button type="button" disabled={busy} onClick={run(onDownloadBackup)}>
            Скачать резервную копию
          </button>
        )}
        {onNew && (
          <button type="button" onClick={run(onNew)}>
            + Ещё лист
          </button>
        )}
        <button type="button" className="sheet-bar-gestures" onClick={run(onGestures)}>
          Показать жесты
        </button>
      </div>
    </header>
  );
}
