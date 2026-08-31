import { useEffect, useRef, useState } from "react";
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
  focusDate?: { year: number; month: number } | null;
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
  focusDate,
}: Props) {
  const [cursor, setCursor] = useState({
    year: initialYear ?? pinned?.year ?? 1,
    month: initialMonth ?? pinned?.month ?? 1,
  });
  useEffect(() => {
    if (focusDate) setCursor({ year: focusDate.year, month: focusDate.month });
  }, [focusDate?.year, focusDate?.month]);

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

  const longPress = useRef<number | null>(null);
  function clearLongPress() {
    if (longPress.current != null) { clearTimeout(longPress.current); longPress.current = null; }
  }
  const cells: { day: number | null }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null });
  for (let d = 1; d <= dayCount; d++) cells.push({ day: d });

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
        <button onClick={goPrev}>← Пред</button>
        <div className="row" style={{ gap: 8 }}>
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
        </div>
        <button onClick={goNext}>След →</button>
      </div>
      {onPin && (
        <div className="row" style={{ justifyContent: "center" }}>
          {pinned?.year === cursor.year && pinned?.month === cursor.month ? (
            <button onClick={() => onPin(null)} title="Сейчас в мире — отсюда считается статус предстоящее/случилось и центрируется ось">Открепить месяц</button>
          ) : (
            <button onClick={() => onPin({ year: cursor.year, month: cursor.month })} title="Сейчас в мире — отсюда считается статус предстоящее/случилось и центрируется ось">
              Закрепить месяц
            </button>
          )}
        </div>
      )}
      <div
        className="month-calendar"
        style={{ gridTemplateColumns: `repeat(${weekdays.length || 7}, minmax(0, 1fr))` }}
      >
        {weekdays.map((w) => (
          <div key={w.id} className="weekday">
            {w.name.slice(0, 3)}
          </div>
        ))}
        {cells.map((c, i) => {
          if (c.day === null) return <div key={`empty-${i}`} className="day empty" />;
          const dayItems = visibleItems.filter((it) => it.day === c.day);
          const hasSession = dayItems.some((it) => it.kind === "session");
          const hasEvent = dayItems.some((it) => it.kind === "event");
          return (
            <div
              key={c.day}
              className={`day${hasSession ? " has-session" : ""}${hasEvent ? " has-event" : ""}`}
              onClick={() => onDayClick?.(cursor.year, cursor.month, c.day!)}
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDayContextMenu?.(cursor.year, cursor.month, c.day!, e.clientX, e.clientY);
              }}
              onTouchStart={(e) => {
                const touch = e.touches[0];
                clearLongPress();
                longPress.current = window.setTimeout(() => {
                  onDayContextMenu?.(cursor.year, cursor.month, c.day!, touch.clientX, touch.clientY);
                }, 520);
              }}
              onTouchEnd={clearLongPress}
              onTouchMove={clearLongPress}
            >
              <span className="num">{c.day}</span>
            </div>
          );
        }
        )}
      </div>
    </div>
  );
}
