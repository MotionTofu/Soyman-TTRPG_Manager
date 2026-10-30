import { forwardRef, useState } from "react";
import { useConfirm } from "../../hooks/useConfirm";
import { weekdayIndexFor } from "../../inworldCalendar";
import type { CalendarMonth, CalendarWeekday } from "../../types";
import { eventOccursOn, monthName, TONE_LABEL, TONES, type ChronicleNow, type TimeTone, type TonedEvent } from "./time";

// Календарь Хроники (доска Set-Chronicle, решение 2026-10-30 — у сеттинга и
// кампании одинаково): полоса из трёх месяцев внизу страницы — предыдущий ·
// выбранный в рамке · следующий. «Сейчас» возвращает к месяцу «сейчас».
// Пин — только если вкладка его передала: залит малиновым на закреплённом
// месяце, контуром на других, на другом месяце спрашивает «Закрепить новый
// месяц?». ПКМ по дню отдаётся вкладке.

export type YM = { year: number; month: number };
export type StripEvent = TonedEvent & { id: number; title: string };

function shift(at: YM, by: number, months: CalendarMonth[]): YM {
  const order = months.map((m) => m.position).sort((a, b) => a - b);
  let i = order.indexOf(at.month) + by;
  let year = at.year;
  while (i < 0) {
    i += order.length;
    year -= 1;
  }
  while (i >= order.length) {
    i -= order.length;
    year += 1;
  }
  return { year, month: order[i] };
}

export const PinIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="square" aria-hidden="true">
    <path d="M9 3h6l-1 6 4 4H6l4-4z" />
    <path d="M12 13v8" />
  </svg>
);

export interface ChronicleMonthStripProps<E extends StripEvent> {
  months: CalendarMonth[];
  weekdays: CalendarWeekday[];
  events: { ev: E; tone: TimeTone }[];
  /** Месяц «сейчас» (и день, если источник его знает — тогда день обведён). */
  now: ChronicleNow | null;
  /** Закрепление месяца. Нет — нет и пина. */
  pin?: { pinned: YM | null; onPin: (at: YM) => void };
  /** Подпись месяца справа — сезон. */
  seasonOf?: (year: number, month: number) => string | null;
  /** Месяц, к которому перешли из строки хроники. */
  focus?: YM | null;
  selectedDay?: { year: number; month: number; day: number } | null;
  onDayClick?: (at: { year: number; month: number; day: number }) => void;
  sessions?: { id: number; title: string; year: number; month: number; day: number }[];
  onDayMenu: (year: number, month: number, day: number, x: number, y: number, events: E[]) => void;
}

function ChronicleMonthStripInner<E extends StripEvent>(
  { months, weekdays, events, now, pin, seasonOf, focus, onDayMenu, onDayClick, selectedDay, sessions = [] }: ChronicleMonthStripProps<E>,
  ref: React.ForwardedRef<HTMLElement>
) {
  const [confirmDialog, confirm] = useConfirm();
  const [picked, setPicked] = useState<YM | null>(null);
  const [lastFocus, setLastFocus] = useState(focus);
  if (focus !== lastFocus) {
    setLastFocus(focus);
    if (focus) setPicked(focus);
  }
  const ordered = [...months].sort((a, b) => a.position - b.position);
  if (!ordered.length) return null;
  const home: YM = now ? { year: now.year, month: now.month } : { year: events[0]?.ev.inworld_year ?? 1, month: ordered[0].position };
  const center = picked ?? home;
  const pinned = pin?.pinned ?? null;
  const isPinned = !!pinned && pinned.year === center.year && pinned.month === center.month;
  const wd = [...weekdays].sort((a, b) => a.position - b.position);
  const name = (m: number) => monthName(months, m);

  async function doPin() {
    if (!pin || isPinned) return;
    const ok = await confirm({
      title: "Закрепить новый месяц?",
      message: `«Сейчас» станет ${name(center.month)} ${center.year}${pinned ? ` вместо ${name(pinned.month)} ${pinned.year}` : ""}.`,
      confirmLabel: "Закрепить",
    });
    if (ok) pin.onPin(center);
  }

  const key = (y: number, m: number, d: number) => (y * 1000 + m) * 100 + d;
  const ongoing = events.filter(({ tone, ev }) => tone === "on" && ev.inworld_year_end != null);

  function month(at: YM, cur: boolean) {
    const n = months.find((x) => x.position === at.month)?.days ?? 0;
    const lead = wd.length ? weekdayIndexFor(at.year, at.month, 1, months, wd.length) : 0;
    // Идущий период — подложкой по дням, которые он накрывает в этом месяце.
    const inPeriod = (d: number) =>
      ongoing.some(({ ev }) => {
        const k = key(at.year, at.month, d);
        return key(ev.inworld_year, ev.inworld_month, ev.inworld_day) <= k && k <= key(ev.inworld_year_end!, ev.inworld_month_end ?? 999, ev.inworld_day_end ?? 99);
      });
    const monthPinned = !!pinned && pinned.year === at.year && pinned.month === at.month;
    const today = now?.day != null && now.year === at.year && now.month === at.month ? now.day : null;
    const season = seasonOf?.(at.year, at.month);
    return (
      <div key={`${at.year}-${at.month}`} className={`chr-cal__m${cur ? " is-cur" : ""}`}>
        <div className="chr-cal__mh">
          <b>
            {name(at.month)} {at.year}
            {monthPinned && (
              <i className="chr-pinmk" title="Закреплённый месяц">
                <PinIcon />
              </i>
            )}
          </b>
          {season && <span>{season}</span>}
        </div>
        {/* Неделя в мире бывает любой длины — столбцов столько, сколько дней недели. */}
        <div className={`chr-cal__g chr-cal__g--${wd.length || 7}`}>
          {wd.map((w) => (
            <i key={w.id}>{w.name.slice(0, 2).toLowerCase()}</i>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <span key={`l${i}`} />
          ))}
          {Array.from({ length: n }, (_, i) => {
            const d = i + 1;
            const dayEvents = events.filter(({ ev }) => eventOccursOn(ev, { ...at, day: d }));
            const daySessions = sessions.filter((session) => session.year === at.year && session.month === at.month && session.day === d);
            const selected = selectedDay?.year === at.year && selectedDay.month === at.month && selectedDay.day === d;
            const tone = dayEvents[0]?.tone;
            return (
              <button
                type="button"
                key={d}
                aria-label={`${d} ${name(at.month)} ${at.year}`}
                aria-pressed={onDayClick ? selected : undefined}
                onClick={() => onDayClick?.({ ...at, day: d })}
                className={`chr-cal__d${selected ? " is-selected" : ""}${inPeriod(d) ? " is-per" : ""}${d === today ? " is-today" : ""}${tone ? ` chr-tone--${tone}` : ""}`}
                title={[...dayEvents.map(({ ev }) => ev.title), ...daySessions.map((session) => session.title)].join("\n") || undefined}
                onContextMenu={(e) => {
                  e.preventDefault();
                  onDayMenu(at.year, at.month, d, e.clientX, e.clientY, dayEvents.map(({ ev }) => ev));
                }}
              >
                {d}
                {tone && <em aria-hidden="true" />}
                {!!daySessions.length && <small className="chr-cal__session" aria-hidden="true">◇</small>}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <section ref={ref} className="d-block chr-cal" aria-label="Календарь">
      {confirmDialog}
      <div className="chr-cal__h">
        <h2 className="d-plate">Календарь</h2>
        <span className="d-note">
          {wd.length ? `неделя ${wd.length} дн.` : "без дней недели"} · {ordered.length} мес. в году
        </span>
        <span className="chr-cal__nav">
          <button type="button" className="d-btn d-btn--sm" aria-label="Предыдущий месяц" onClick={() => setPicked(shift(center, -1, months))}>
            ‹
          </button>
          <button type="button" className="d-btn d-btn--sm" disabled={!now} onClick={() => setPicked(null)} title={now ? "К месяцу «сейчас»" : "«Сейчас» не задано"}>
            Сейчас
          </button>
          {pin && (
            <button
              type="button"
              className={`d-btn d-btn--sm chr-cal__pin${isPinned ? " is-on" : ""}`}
              aria-pressed={isPinned}
              title={isPinned ? "Закреплённый месяц — это «сейчас»" : "Закрепить этот месяц как «сейчас»"}
              aria-label={isPinned ? "Закреплённый месяц" : "Закрепить месяц"}
              onClick={() => void doPin()}
            >
              <PinIcon />
            </button>
          )}
          <button type="button" className="d-btn d-btn--sm" aria-label="Следующий месяц" onClick={() => setPicked(shift(center, 1, months))}>
            ›
          </button>
        </span>
      </div>
      <div className="chr-cal__ms">
        {month(shift(center, -1, months), false)}
        {month(center, true)}
        {month(shift(center, 1, months), false)}
      </div>
      <div className="chr-cal__leg">
        {TONES.map((t) => (
          <span key={t} className={`chr-tone--${t}`}>
            <i />
            {TONE_LABEL[t].toLowerCase()}
          </span>
        ))}
        <span className="chr-cal__hint">
          {pin && (
            <i className="chr-pinmk">
              <PinIcon />
            </i>
          )}
          {pin ? "закреплённый месяц = «сейчас» · " : ""}ПКМ по дню — «Событие на этот день»
        </span>
      </div>
    </section>
  );
}

export const ChronicleMonthStrip = forwardRef(ChronicleMonthStripInner) as <E extends StripEvent>(
  p: ChronicleMonthStripProps<E> & { ref?: React.Ref<HTMLElement> }
) => React.ReactElement | null;
