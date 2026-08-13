import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import type { SessionStatus, SessionSummary } from "../types";

export interface MiniEvent {
  id: number;
  date: string;
  status: SessionStatus;
  campaignId: number;
}

interface Props {
  onEventContextMenu?: (event: MiniEvent, x: number, y: number) => void;
  onDayContextMenu?: (date: string, x: number, y: number) => void;
}

interface PlayerDashboardSession {
  id: number;
  campaign_id: number;
  date: string;
  status: SessionStatus;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Compact month calendar for the home sidebar (inside SearchPanel, see
// index.css .mini-calendar) — deliberately much lower-information than the
// full MonthCalendar used on the campaign/session pages: square day cells
// with a big date number, and a row of status-colored indicator squares (one
// per session that day) instead of campaign-name/time labels. All it answers
// at a glance is "is there a session, and how many" — click a square to jump
// to it, right-click for the same status/delete/add-session menu the old
// full calendar had (rendered by the caller via onEventContextMenu/
// onDayContextMenu, same pattern as MonthCalendar).
export function MiniCalendar({ onEventContextMenu, onDayContextMenu }: Props) {
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const navigate = useNavigate();
  const [events, setEvents] = useState<MiniEvent[]>([]);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });

  useEffect(() => {
    if (isPlayer) {
      api
        .get<{ sessions: PlayerDashboardSession[] }>("/player/dashboard")
        .then((d) =>
          setEvents(d.sessions.map((s) => ({ id: s.id, date: s.date, status: s.status, campaignId: s.campaign_id })))
        );
    } else {
      api
        .get<SessionSummary[]>("/calendar")
        .then((rows) =>
          setEvents(rows.map((s) => ({ id: s.id, date: s.date, status: s.status, campaignId: s.campaign_id })))
        );
    }
  }, [isPlayer]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, MiniEvent[]>();
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
  for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, key: toDateKey(year, month, d) });

  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  function openEvent(e: MiniEvent) {
    navigate(isPlayer ? `/campaigns/${e.campaignId}` : `/sessions/${e.id}`);
  }

  return (
    <div className="mini-calendar-widget">
      <div className="mini-calendar-nav">
        <button
          type="button"
          className="comp-mini"
          onClick={() =>
            setCursor((c) => (c.month === 0 ? { year: c.year - 1, month: 11 } : { year: c.year, month: c.month - 1 }))
          }
          aria-label="Предыдущий месяц"
        >
          ←
        </button>
        <span className="mini-calendar-month">
          {MONTH_NAMES[month]} {year}
        </span>
        <button
          type="button"
          className="comp-mini"
          onClick={() =>
            setCursor((c) => (c.month === 11 ? { year: c.year + 1, month: 0 } : { year: c.year, month: c.month + 1 }))
          }
          aria-label="Следующий месяц"
        >
          →
        </button>
      </div>
      <div className="mini-calendar">
        {WEEKDAYS.map((w) => (
          <div key={w} className="mini-calendar-weekday">
            {w}
          </div>
        ))}
        {cells.map((c, i) => {
          if (c.day === null) return <div key={`empty-${i}`} className="mini-calendar-day empty" />;
          // Temporary: only the first session of the day gets an indicator
          // (see index.css's .mini-calendar-dot comment) — not a real
          // one-session-per-day rule, just how the full-cell layered icon
          // is scoped for now.
          const event = (eventsByDate.get(c.key!) ?? [])[0];
          return (
            <div
              key={c.key}
              className={`mini-calendar-day${c.key === todayKey ? " today" : ""}`}
              onContextMenu={(ev) => {
                ev.preventDefault();
                onDayContextMenu?.(c.key!, ev.clientX, ev.clientY);
              }}
            >
              {event && (
                <span
                  className={`mini-calendar-dot ${event.status}`}
                  title={event.status}
                  onClick={(ev) => {
                    ev.stopPropagation();
                    openEvent(event);
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    ev.stopPropagation();
                    onEventContextMenu?.(event, ev.clientX, ev.clientY);
                  }}
                />
              )}
              <span className="mini-calendar-num">{c.day}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
