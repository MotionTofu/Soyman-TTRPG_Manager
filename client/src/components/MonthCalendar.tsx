import { useMemo, useState } from "react";
import type { CampaignRole, PaymentType, SessionStatus } from "../types";

export interface CalendarEvent {
  id: number;
  date: string; // YYYY-MM-DD
  status: SessionStatus;
  paymentType?: PaymentType;
  campaignRole?: CampaignRole;
  label: string;
  startTime?: string | null; // "HH:MM", shown as a prefix on the day cell
}

interface Props {
  events: CalendarEvent[];
  onDayClick: (date: string) => void;
  onEventClick?: (event: CalendarEvent) => void;
  onEventContextMenu?: (event: CalendarEvent, x: number, y: number) => void;
  onDayContextMenu?: (date: string, x: number, y: number) => void;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function MonthCalendar({ events, onDayClick, onEventClick, onEventContextMenu, onDayContextMenu }: Props) {
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    return map;
  }, [events]);

  const { year, month } = cursor;
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = (firstOfMonth.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: { day: number | null; key: string | null }[] = [];
  for (let i = 0; i < startWeekday; i++) cells.push({ day: null, key: null });
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ day: d, key: toDateKey(year, month, d) });
  }

  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button
          onClick={() =>
            setCursor((c) =>
              c.month === 0
                ? { year: c.year - 1, month: 11 }
                : { year: c.year, month: c.month - 1 }
            )
          }
        >
          ← Пред
        </button>
        <strong>
          {MONTH_NAMES[month]} {year}
        </strong>
        <button
          onClick={() =>
            setCursor((c) =>
              c.month === 11
                ? { year: c.year + 1, month: 0 }
                : { year: c.year, month: c.month + 1 }
            )
          }
        >
          След →
        </button>
      </div>
      <div className="month-calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="weekday">
            {w}
          </div>
        ))}
        {cells.map((c, i) =>
          c.day === null ? (
            <div key={`empty-${i}`} className="day empty" />
          ) : (
            <div
              key={c.key}
              className={`day${c.key === todayKey ? " today" : ""}`}
              onClick={() => onDayClick(c.key!)}
              onContextMenu={(ev) => {
                ev.preventDefault();
                onDayContextMenu?.(c.key!, ev.clientX, ev.clientY);
              }}
            >
              <span className="num">{c.day}</span>
              {(eventsByDate.get(c.key!) ?? []).map((e) => (
                <span
                  key={e.id}
                  className={`dot ${e.status}${e.paymentType === "paid" ? " pay-paid" : ""}${e.paymentType === "negotiable" ? " pay-negotiable" : ""}${e.campaignRole === "player" ? " role-player" : ""}`}
                  title={e.label}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    onEventClick?.(e);
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onEventContextMenu?.(e, ev.clientX, ev.clientY);
                  }}
                >
                  {e.startTime ? `${e.startTime} ${e.label}` : e.label}
                </span>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
