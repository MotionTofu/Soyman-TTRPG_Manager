import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { useCurrentUser } from "../api/currentUser";
import { formatDateKeyRu } from "../utils/date";
import type { SessionStatus, SessionSummary } from "../types";

export interface MiniEvent {
  id: number;
  date: string;
  status: SessionStatus;
  campaignId: number;
  campaignName?: string;
  startTime?: string | null;
}

interface Props {
  events?: MiniEvent[];
  onEventContextMenu?: (event: MiniEvent, x: number, y: number) => void;
  onDayContextMenu?: (date: string, x: number, y: number) => void;
  /** Сколько месяцев показывать подряд, начиная с текущего курсора. */
  months?: number;
  /** @deprecated — используется только в режиме без `events` (fallback). */
  refreshKey?: number;
}

interface PlayerDashboardSession {
  id: number;
  campaign_id: number;
  date: string;
  status: SessionStatus;
}

const WEEKDAYS = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const STATUS_LABELS: Record<SessionStatus, string> = {
  planned: "запланирована",
  held: "состоялась",
  cancelled: "отменена",
};
const MONTH_NAMES = [
  "Январь", "Февраль", "Март", "Апрель", "Май", "Июнь",
  "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь",
];

function toDateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// Компактный календарь для рельса главной — нарочно гораздо менее подробный,
// чем полный MonthCalendar на страницах кампании и сессии: он читается глазом
// за полсекунды и отвечает только на «есть ли игра и сколько». Имена кампаний
// и время в ячейку не выносятся сознательно — с ними он перестал бы быть
// картинкой и стал списком, который надо читать.
//
// Дизайн-ревизия изменила две вещи.
//
// 1. Два месяца подряд вместо одного. Горизонт планирования игр — 4–6 недель,
//    и «конец месяца» обрезал картину: 28 августа мастер не видел 3 сентября.
//
// 2. Состояния ячейки вместо одной метки. Раньше индикатор получала ТОЛЬКО
//    первая сессия дня (`(eventsByDate.get(key) ?? [])[0]`, с комментарием
//    «Temporary»), и в дне с тремя играми была видна одна метка, а клик по
//    ней вёл вслепую. Теперь множественность показывается сменой состояния
//    самой ячейки — инверсией плюс счётчик, — а не размножением меток по
//    6 px: инверсия читается с любого расстояния и остаётся одной целью для
//    мыши. Клик по дню с одной игрой ведёт прямо в неё, по дню с несколькими
//    открывает короткий список.
export function MiniCalendar({ events: propEvents, onEventContextMenu, onDayContextMenu, months = 2, refreshKey = 0 }: Props) {
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const navigate = useNavigate();
  const [internalEvents, setInternalEvents] = useState<MiniEvent[]>([]);
  const [popover, setPopover] = useState<{ key: string; events: MiniEvent[]; x: number; y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [cursor, setCursor] = useState(() => {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  });
  const [isMobileCal, setIsMobileCal] = useState(() => typeof window !== "undefined" ? window.matchMedia("(max-width: 860px)").matches : false);
  useEffect(() => {
    const m = window.matchMedia("(max-width: 860px)");
    const h = () => setIsMobileCal(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  const effectiveMonths = isMobileCal ? 1 : months;

  // Если родитель передал events — используем их напрямую (единственный источник).
  // Иначе — fallback: календарь тянет сам (для изоляции/сторибука).
  const events = propEvents ?? internalEvents;

  useEffect(() => {
    if (propEvents !== undefined) return;
    if (isPlayer) {
      api
        .get<{ sessions: PlayerDashboardSession[] }>("/player/dashboard")
        .then((d) =>
          setInternalEvents(d.sessions.map((s) => ({ id: s.id, date: s.date, status: s.status, campaignId: s.campaign_id })))
        );
    } else {
      api
        .get<SessionSummary[]>("/calendar")
        .then((rows) =>
          setInternalEvents(
            rows.map((s) => ({
              id: s.id,
              date: s.date,
              status: s.status,
              campaignId: s.campaign_id,
              campaignName: s.campaign_name,
              startTime: s.start_time,
            }))
          )
        );
    }
  }, [isPlayer, refreshKey, propEvents]);

  // Отменённые в сетке не показываем (история — в Архиве). Фильтр здесь,
  // а не у родителя, чтобы и fallback-режим MiniCalendar вёл себя так же.
  const visibleEvents = useMemo(() => events.filter((e) => e.status !== "cancelled"), [events]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, MiniEvent[]>();
    for (const e of visibleEvents) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    // Внутри дня — по времени начала: список, который открывается по клику,
    // должен идти в том порядке, в каком игры пойдут. Без времени — в конец.
    for (const list of map.values()) {
      list.sort((a, b) => {
        if (!a.startTime && !b.startTime) return 0;
        if (!a.startTime) return 1;
        if (!b.startTime) return -1;
        return a.startTime.localeCompare(b.startTime);
      });
    }
    return map;
  }, [visibleEvents]);

  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60000);
    const onVis = () => { if (document.visibilityState === "visible") setNow(new Date()); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(id); document.removeEventListener("visibilitychange", onVis); };
  }, []);
  const todayKey = toDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  function openEvent(e: MiniEvent) {
    setPopover(null);
    navigate(isPlayer ? `/campaigns/${e.campaignId}` : `/sessions/${e.id}`);
  }

  function openPopoverForDay(key: string, dayEvents: MiniEvent[], anchor: HTMLElement) {
    if (isMobileCal) {
      // На мобиле поповер центрируется CSS left:50% top:50% — JS координаты не нужны
      setPopover((cur) => (cur?.key === key ? null : { key, events: dayEvents, x: 0, y: 0 }));
      return;
    }
    const rect = anchor.getBoundingClientRect();
    const popW = 320;
    const popH = 320;
    const pad = 8;
    const maxX = window.innerWidth - popW - pad;
    const maxY = window.innerHeight - popH - pad;
    const x = Math.min(rect.left, Math.max(pad, maxX));
    const y = Math.min(rect.bottom + 6, Math.max(pad, maxY));
    setPopover((cur) => (cur?.key === key ? null : { key, events: dayEvents, x, y }));
  }

  // Закрытие поповера по Esc / клику вне — mousedown стабильнее click+stopPropagation
  useEffect(() => {
    if (!popover) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setPopover(null);
    }
    function onMouseDown(e: MouseEvent) {
      const t = e.target as HTMLElement;
      if (t.closest(".mini-calendar-popover")) return;
      if (t.closest(".mini-calendar-day.day-open")) return;
      setPopover(null);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onMouseDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onMouseDown);
    };
  }, [popover]);

  useEffect(() => {
    if (!popover || !popoverRef.current) return;
    const firstBtn = popoverRef.current.querySelector("button") as HTMLElement;
    firstBtn?.focus();
  }, [popover]);

  function shiftMonth(delta: number) {
    setPopover(null);
    setCursor((c) => {
      const m = c.month + delta;
      if (m < 0) return { year: c.year - 1, month: 11 };
      if (m > 11) return { year: c.year + 1, month: 0 };
      return { year: c.year, month: m };
    });
  }

  // Месяцы строятся от курсора вперёд: сдвиг ведёт всю связку, а не только
  // первую сетку — иначе стрелка «вперёд» показывала бы один и тот же месяц
  // дважды на соседних сетках.
  const grids = Array.from({ length: effectiveMonths }, (_, offset) => {
    const year = cursor.year + Math.floor((cursor.month + offset) / 12);
    const month = (cursor.month + offset) % 12;
    const startWeekday = (new Date(year, month, 1).getDay() + 6) % 7; // с понедельника
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const cells: { day: number | null; key: string | null }[] = [];
    for (let i = 0; i < startWeekday; i++) cells.push({ day: null, key: null });
    for (let d = 1; d <= daysInMonth; d++) cells.push({ day: d, key: toDateKey(year, month, d) });
    return { year, month, cells };
  });

  return (
    <div className="mini-calendar-widget">
      <div className="mini-calendar-legend" aria-hidden="true">
        <span className="mini-calendar-legend-item legend-planned">— запланирована</span>
        <span className="mini-calendar-legend-item legend-held">— состоялась</span>
      </div>
      <div className="mini-calendar-nav">
        <button type="button" className="comp-mini" onClick={() => shiftMonth(-1)} aria-label="Предыдущий месяц">
          ←
        </button>
        <span className="mini-calendar-month">
          {MONTH_NAMES[grids[0].month]} {grids[0].year}
        </span>
        <button type="button" className="comp-mini" onClick={() => shiftMonth(1)} aria-label="Следующий месяц">
          →
        </button>
      </div>

      {grids.map((g, i) => (
        <div className="mini-calendar-grid-block" key={`${g.year}-${g.month}`}>
          {/* Первую сетку называет шапка со стрелками — второй нужен свой
              заголовок, иначе непонятно, где кончается один месяц. */}
          {i > 0 && (
            <div className="mini-calendar-subheading">
              {MONTH_NAMES[g.month]} {g.year}
            </div>
          )}
          <div className="mini-calendar">
            {WEEKDAYS.map((w) => (
              <div key={w} className="mini-calendar-weekday">
                {w}
              </div>
            ))}
            {g.cells.map((c, idx) => {
              if (c.day === null) return <div key={`empty-${g.month}-${idx}`} className="mini-calendar-day empty" />;
              const dayEvents = eventsByDate.get(c.key!) ?? [];
              const many = dayEvents.length > 1;
              const one = dayEvents.length === 1;
              // Статус кодируется НАЧЕРТАНИЕМ рамки, а не цветом (§1.7):
              // сплошная — предстоит, штриховая — состоялась, пунктир —
              // отменена или перенесена. Так день читается и в «Соевом
              // нуаре», где акцента как отдельного цвета попросту нет.
              // У дня с несколькими играми статус не показывается: он там
              // не один, и выбрать «главный» значило бы соврать — статусы
              // видно в списке, который открывается по клику.
              const cls = [
                "mini-calendar-day",
                c.key === todayKey ? "today" : "",
                one ? "has-one" : "",
                one ? `st-${dayEvents[0].status}` : "",
                many ? "has-many" : "",
                popover?.key === c.key ? "day-open" : "",
              ]
                .filter(Boolean)
                .join(" ");
              const isInteractive = dayEvents.length > 0;
              return (
                <div
                  key={c.key}
                  className={cls}
                  role={isInteractive ? "button" : undefined}
                  tabIndex={isInteractive ? 0 : undefined}
                  aria-label={
                    isInteractive
                      ? many
                        ? `${c.day} число, ${dayEvents.length} игры: ${dayEvents.map((e) => `${e.campaignName ?? "Сессия"} ${STATUS_LABELS[e.status]}${e.startTime ? ` ${e.startTime}` : ""}`).join(", ")}`
                        : `${c.day} число, ${dayEvents[0].campaignName ?? "Сессия"} — ${STATUS_LABELS[dayEvents[0].status]}${dayEvents[0].startTime ? ` ${dayEvents[0].startTime}` : ""}`
                      : undefined
                  }
                  title={
                    many
                      ? `${dayEvents.length} игры в этот день`
                      : one
                        ? `${dayEvents[0].campaignName ?? "Сессия"} — ${STATUS_LABELS[dayEvents[0].status]}`
                        : undefined
                  }
                  onClick={(e) => {
                    if (!isInteractive) return;
                    // Всегда открываем список над датой (даже для 1 игры) — единый паттерн (B1).
                    e.stopPropagation();
                    openPopoverForDay(c.key!, dayEvents, e.currentTarget);
                  }}
                  onKeyDown={(e) => {
                    if (!isInteractive) return;
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      openPopoverForDay(c.key!, dayEvents, e.currentTarget as HTMLElement);
                    }
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    if (dayEvents.length === 1 && onEventContextMenu) {
                      onEventContextMenu(dayEvents[0], ev.clientX, ev.clientY);
                      return;
                    }
                    onDayContextMenu?.(c.key!, ev.clientX, ev.clientY);
                  }}
                >
                  <span className="mini-calendar-num">{c.day}</span>
                  {many && <span className="mini-calendar-count">{dayEvents.length}</span>}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      {popover && (
        <div
          ref={popoverRef}
          className="mini-calendar-popover"
          style={{ left: popover.x, top: popover.y } as React.CSSProperties}
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-label="Игры в этот день"
          aria-modal="true"
          tabIndex={-1}
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              const focusable = Array.from(popoverRef.current?.querySelectorAll("button") ?? []) as HTMLElement[];
              if (focusable.length === 0) return;
              const first = focusable[0];
              const last = focusable[focusable.length - 1];
              if (e.shiftKey && document.activeElement === first) {
                e.preventDefault();
                last.focus();
              } else if (!e.shiftKey && document.activeElement === last) {
                e.preventDefault();
                first.focus();
              }
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setPopover(null);
            }
          }}
        >
          <div className="mini-calendar-daylist">
            <div className="mini-calendar-daylist-head">
              {formatDateKeyRu(popover.key)}
            </div>
            {popover.events.map((e) => (
              <button
                key={e.id}
                type="button"
                className={`mini-calendar-daylist-row ${e.status}`}
                onClick={() => openEvent(e)}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  onEventContextMenu?.(e, ev.clientX, ev.clientY);
                }}
              >
                <span className="mini-calendar-daylist-name">{e.campaignName ?? "Сессия"}</span>
                <span className="mini-calendar-daylist-time">
                  {[STATUS_LABELS[e.status], e.startTime].filter(Boolean).join(" · ")}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
