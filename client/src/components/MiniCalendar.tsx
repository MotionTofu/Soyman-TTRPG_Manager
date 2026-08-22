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
  campaignName?: string;
  startTime?: string | null;
}

interface Props {
  onEventContextMenu?: (event: MiniEvent, x: number, y: number) => void;
  onDayContextMenu?: (date: string, x: number, y: number) => void;
  /** Сколько месяцев показывать подряд, начиная с текущего курсора. */
  months?: number;
  /** Календарь тянет сессии сам, поэтому о правках снаружи — созданной
   *  сессии, смене статуса, удалении — он узнаёт только отсюда: страница
   *  меняет число, календарь перечитывает. */
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
export function MiniCalendar({ onEventContextMenu, onDayContextMenu, months = 2, refreshKey = 0 }: Props) {
  const { user } = useCurrentUser();
  const isPlayer = user?.role === "player";
  const navigate = useNavigate();
  const [events, setEvents] = useState<MiniEvent[]>([]);
  const [dayList, setDayList] = useState<{ key: string; events: MiniEvent[] } | null>(null);
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
          setEvents(
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
  }, [isPlayer, refreshKey]);

  const eventsByDate = useMemo(() => {
    const map = new Map<string, MiniEvent[]>();
    for (const e of events) {
      const list = map.get(e.date) ?? [];
      list.push(e);
      map.set(e.date, list);
    }
    // Внутри дня — по времени начала: список, который открывается по клику,
    // должен идти в том порядке, в каком игры пойдут.
    for (const list of map.values()) {
      list.sort((a, b) => (a.startTime ?? "").localeCompare(b.startTime ?? ""));
    }
    return map;
  }, [events]);

  const now = new Date();
  const todayKey = toDateKey(now.getFullYear(), now.getMonth(), now.getDate());

  function openEvent(e: MiniEvent) {
    setDayList(null);
    navigate(isPlayer ? `/campaigns/${e.campaignId}` : `/sessions/${e.id}`);
  }

  function shiftMonth(delta: number) {
    setDayList(null);
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
  const grids = Array.from({ length: months }, (_, offset) => {
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
                dayList?.key === c.key ? "day-open" : "",
              ]
                .filter(Boolean)
                .join(" ");
              return (
                <div
                  key={c.key}
                  className={cls}
                  role={dayEvents.length > 0 ? "button" : undefined}
                  tabIndex={dayEvents.length > 0 ? 0 : undefined}
                  title={
                    many
                      ? `${dayEvents.length} игры в этот день`
                      : one
                        ? `${dayEvents[0].campaignName ?? "Сессия"} — ${STATUS_LABELS[dayEvents[0].status]}`
                        : undefined
                  }
                  onClick={() => {
                    if (dayEvents.length === 1) openEvent(dayEvents[0]);
                    else if (many) setDayList((cur) => (cur?.key === c.key ? null : { key: c.key!, events: dayEvents }));
                  }}
                  onContextMenu={(ev) => {
                    ev.preventDefault();
                    // Меню одной игры имеет смысл только когда игра одна;
                    // в дне с несколькими сначала выбирают, какую.
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

      {dayList && (
        <div className="mini-calendar-daylist">
          <div className="mini-calendar-daylist-head">
            {new Date(`${dayList.key}T00:00:00`).toLocaleDateString("ru", { day: "numeric", month: "long" })}
          </div>
          {dayList.events.map((e) => (
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
      )}
    </div>
  );
}
