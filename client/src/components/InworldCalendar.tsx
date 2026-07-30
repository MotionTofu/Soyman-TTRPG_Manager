import { useState } from "react";
import type { CalendarMonth, CalendarWeekday, ImportantDate } from "../types";
import { weekdayIndexFor } from "../inworldCalendar";

export interface InworldDatedItem {
  id: string;
  year: number;
  month: number; // 1-based position into months
  day: number;
  label: string;
  kind: "session" | "event";
  important?: boolean;
}

interface Props {
  months: CalendarMonth[];
  weekdays: CalendarWeekday[];
  items: InworldDatedItem[];
  importantDates?: ImportantDate[];
  initialYear?: number;
  initialMonth?: number;
  pinned?: { year: number; month: number } | null;
  onPin?: (pinned: { year: number; month: number } | null) => void;
  onDayClick?: (year: number, month: number, day: number) => void;
  onDayContextMenu?: (year: number, month: number, day: number, x: number, y: number) => void;
  onItemClick?: (item: InworldDatedItem) => void;
  onItemContextMenu?: (item: InworldDatedItem, x: number, y: number) => void;
  onImportantDateContextMenu?: (date: ImportantDate, x: number, y: number) => void;
}

export function InworldCalendar({
  months,
  weekdays,
  items,
  importantDates,
  initialYear,
  initialMonth,
  pinned,
  onPin,
  onDayClick,
  onDayContextMenu,
  onItemClick,
  onItemContextMenu,
  onImportantDateContextMenu,
}: Props) {
  const [cursor, setCursor] = useState({
    year: initialYear ?? pinned?.year ?? 1,
    month: initialMonth ?? pinned?.month ?? 1,
  });

  if (months.length === 0) {
    return <p className="muted">Календарь сеттинга не настроен.</p>;
  }

  function goPrev() {
    setCursor((c) =>
      c.month === 1 ? { year: c.year - 1, month: months.length } : { year: c.year, month: c.month - 1 }
    );
  }
  function goNext() {
    setCursor((c) =>
      c.month === months.length ? { year: c.year + 1, month: 1 } : { year: c.year, month: c.month + 1 }
    );
  }
  function setYear(year: number) {
    if (Number.isFinite(year)) setCursor((c) => ({ ...c, year }));
  }
  function setMonth(month: number) {
    setCursor((c) => ({ ...c, month }));
  }

  const currentMonth = months.find((m) => m.position === cursor.month) ?? months[0];
  const dayCount = currentMonth.days;

  const startWeekday = weekdayIndexFor(cursor.year, cursor.month, 1, months, weekdays.length);

  const visibleItems = items.filter((it) => it.year === cursor.year && it.month === cursor.month);

  const expandedDates: { day: number; date: ImportantDate }[] = [];
  for (const d of importantDates ?? []) {
    if (d.recurrence === "monthly") {
      expandedDates.push({ day: d.day, date: d });
    } else if (d.recurrence === "annual" && d.month === cursor.month) {
      expandedDates.push({ day: d.day, date: d });
    } else if (d.recurrence === "once" && d.year === cursor.year && d.month === cursor.month) {
      expandedDates.push({ day: d.day, date: d });
    }
  }

  const cells: { day: number | null }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null });
  for (let d = 1; d <= dayCount; d++) cells.push({ day: d });

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button onClick={goPrev}>← Пред</button>
        <div className="row">
          <select value={cursor.month} onChange={(e) => setMonth(Number(e.target.value))}>
            {months.map((m) => (
              <option key={m.id} value={m.position}>
                {m.name}
              </option>
            ))}
          </select>
          <input
            type="number"
            value={cursor.year}
            onChange={(e) => setYear(Number(e.target.value))}
            style={{ width: 90 }}
          />
          {onPin &&
            (pinned?.year === cursor.year && pinned?.month === cursor.month ? (
              <button onClick={() => onPin(null)}>Открепить месяц</button>
            ) : (
              <button onClick={() => onPin({ year: cursor.year, month: cursor.month })}>
                Закрепить месяц
              </button>
            ))}
        </div>
        <button onClick={goNext}>След →</button>
      </div>
      <div
        className="month-calendar"
        style={{ gridTemplateColumns: `repeat(${weekdays.length || 7}, 1fr)` }}
      >
        {weekdays.map((w) => (
          <div key={w.id} className="weekday">
            {w.name}
          </div>
        ))}
        {cells.map((c, i) =>
          c.day === null ? (
            <div key={`empty-${i}`} className="day empty" />
          ) : (
            <div
              key={c.day}
              className="day"
              onClick={() => onDayClick?.(cursor.year, cursor.month, c.day!)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDayContextMenu?.(cursor.year, cursor.month, c.day!, e.clientX, e.clientY);
              }}
            >
              <span className="num">{c.day}</span>
              {visibleItems
                .filter((it) => it.day === c.day)
                .map((it) => (
                  <span
                    key={it.id}
                    className={`dot kind-${it.kind}${it.important ? " important" : ""}`}
                    title={it.label}
                    onClick={(e) => {
                      e.stopPropagation();
                      onItemClick?.(it);
                    }}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onItemContextMenu?.(it, e.clientX, e.clientY);
                    }}
                  >
                    {it.label}
                  </span>
                ))}
              {expandedDates
                .filter((ed) => ed.day === c.day)
                .map((ed) => (
                  <span
                    key={`date-${ed.date.id}`}
                    className="dot kind-date"
                    title={ed.date.title}
                    onClick={(e) => e.stopPropagation()}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onImportantDateContextMenu?.(ed.date, e.clientX, e.clientY);
                    }}
                  >
                    {ed.date.title}
                  </span>
                ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
