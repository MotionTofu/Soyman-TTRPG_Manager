import type { ReactNode } from "react";
import { NavIcon } from "../NavIcons";
import type { CalendarMonth } from "../../types";
import { monthName, TONE_LABEL, TONES, type ChronicleNow, type TimeTone } from "./time";
import "./chronicle.css";

// Каркас вкладки «Хроника» в «Д» (доска Set-Chronicle; решение владельца
// 2026-10-30: Хроника кампании — частный случай Хроники сеттинга, один
// каркас). Сверху вниз: шапка со строкой «сейчас» и действиями → ось
// (гнездо) → сегмент разделов с поиском → чипы тонов (в «Хронологии») →
// содержимое раздела → полоса календаря (гнездо). Данные, правку и слои
// своей сущности кладёт вкладка: сеттинг — закреплённый месяц и пин,
// кампания — свой источник «сейчас», сессии на оси, участников в строке.

export interface ChronicleSection<T extends string> {
  id: T;
  label: string;
  count?: number;
}

export function Chronicle<T extends string>({
  nowLine,
  actions,
  axis,
  sections,
  section,
  onSection,
  search,
  tools,
  chips,
  children,
  calendar,
  mobile,
}: {
  /** Строка под заголовком — обычно `<ChronicleNowLine>`. */
  nowLine: ReactNode;
  /** Кнопки шапки справа («+ Эпоха», главная «+ Событие»). */
  actions?: ReactNode;
  /** Ось времени с панелью циклов; нет данных — не передавать. */
  axis?: ReactNode;
  sections: readonly ChronicleSection<T>[];
  section: T;
  onSection: (id: T) => void;
  /** Поиск в строке сегмента. */
  search?: { value: string; onChange: (v: string) => void; placeholder: string };
  /** Прочее в строке сегмента справа (порядок дат и т. п.). */
  tools?: ReactNode;
  /** Ряд чипов тонов — `<ChronicleToneChips>`, обычно только в «Хронологии». */
  chips?: ReactNode;
  children: ReactNode;
  /** Полоса календаря — `<ChronicleMonthStrip>`. */
  calendar?: ReactNode;
  mobile?: { view: "Список" | "Ось" | "Календарь"; onView: (view: "Список" | "Ось" | "Календарь") => void };
}) {
  return (
    <div className="chr" data-mobile-view={mobile?.view}>
      <div className="chr-head">
        <div>
          <h2>Хроника</h2>
          <div className="chr-head__now">{nowLine}</div>
        </div>
        {actions && <div className="chr-head__acts">{actions}</div>}
      </div>
      {mobile && <div className="chr-mobile-tabs" role="tablist" aria-label="Вид хроники">
        {(["Список", "Ось", "Календарь"] as const).map((view) => <button key={view} type="button" className="d-btn" role="tab" aria-selected={mobile.view === view} onClick={() => mobile.onView(view)}>{view}</button>)}
      </div>}
      {axis && <div className="d-block chr-axis">{axis}</div>}
      <div className="chr-segrow">
        {/* каркас в обход намеренно — переключатель внутри вкладки, а не вкладки страницы: полоса каркаса одна на карточку */}
        <div className="d-seg chr-seg" role="tablist" aria-label="Разделы хроники">
          {sections.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={section === s.id} className={section === s.id ? "active" : ""} onClick={() => onSection(s.id)}>
              {s.label}
              {!!s.count && <b>{s.count}</b>}
            </button>
          ))}
        </div>
        {(search || tools) && (
          <span className="chr-segrow__end">
            {search && (
              <label className="chr-field">
                <NavIcon name="search" />
                <input placeholder={search.placeholder} aria-label={search.placeholder} value={search.value} onChange={(e) => search.onChange(e.target.value)} />
              </label>
            )}
            {tools}
          </span>
        )}
      </div>
      {chips}
      <div className="chr-content">{children}</div>
      {calendar}
    </div>
  );
}

/**
 * Строка «сейчас» шапки: «Октябрь 1507 · закреплённый месяц · Осень · идёт 1 ·
 * ближайшее — …». Источник и его подпись («закреплённый месяц», «по последней
 * сессии») — от вкладки; день показывается, если он есть у «сейчас».
 */
export function ChronicleNowLine({
  now,
  months,
  source,
  season,
  cycleLabels,
  ongoing,
  nearest,
  empty,
}: {
  now: ChronicleNow | null;
  months: CalendarMonth[];
  source: string;
  season?: string | null;
  cycleLabels?: string[];
  ongoing: number;
  nearest?: { title: string; year: number; month: number; day: number; days?: number } | null;
  /** Что сказать, когда «сейчас» не задано. */
  empty: ReactNode;
}) {
  if (!now) return <span className="muted">{empty}</span>;
  return (
    <>
      <b>
        {now.day != null ? `${now.day} ` : ""}
        {monthName(months, now.month)} {now.year}
      </b>
      <span className="d-note">{source}</span>
      {(cycleLabels?.length || season) ? <span>· {[...new Set([season, ...(cycleLabels ?? [])].filter(Boolean))].join(" · ")}</span> : null}
      {ongoing > 0 && <span>· идёт {ongoing}</span>}
      {nearest && (
        <span>
          · ближайшее — {nearest.title}, {nearest.days != null && nearest.days >= 0 ? `через ${nearest.days} дн.` : `${nearest.day} ${monthName(months, nearest.month)}${nearest.year !== now.year ? ` ${nearest.year}` : ""}`}
        </span>
      )}
    </>
  );
}

/** Ряд чипов тонов с цветной точкой; справа — итог («24 события · отменённые свёрнуты»). */
export function ChronicleToneChips({
  tones,
  onToggle,
  offCount,
  extra,
  summary,
}: {
  tones: ReadonlySet<TimeTone>;
  onToggle: (t: TimeTone) => void;
  offCount: number;
  /** Свои чипы вкладки после тонов (★ Важные, «Видно игрокам»). */
  extra?: ReactNode;
  summary: ReactNode;
}) {
  return (
    <div className="chr-tch">
      {TONES.map((t) => (
        <button key={t} type="button" className={`chr-tc chr-tone--${t}${tones.has(t) ? " is-on" : ""}`} aria-pressed={tones.has(t)} onClick={() => onToggle(t)}>
          <i />
          {TONE_LABEL[t]}
          {t === "off" && offCount > 0 && ` · ${offCount}`}
        </button>
      ))}
      {extra}
      <span className="d-note chr-tch__end">{summary}</span>
    </div>
  );
}

/** Заголовок эпохи в списке событий. */
export function ChronicleEra({ name, note }: { name: string; note: string }) {
  return (
    <div className="chr-era">
      {name} <span>· {note}</span>
    </div>
  );
}
