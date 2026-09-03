import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { daysInYear, dateFromElapsed, elapsedDays, formatByPrecision } from "../inworldCalendar";
import type { CalendarMonth, DatePrecision, EventStatus, ImportantDate, SettingCalendarEra, SettingCycle } from "../types";
import "../timeline.css";

// Ось времени — общая для хроники мира и расписания кампании.
//
// Это не третья вкладка, а третий вид рядом с «Сеткой» и «Списком»: список
// читают и правят, ось показывает РАССТОЯНИЯ — что через год после падения
// крепости началась война, а через сто лет не случилось ничего.
//
// Решения, из-за которых она устроена именно так, записаны в
// docs/node-editor.md, раздел «Время».

export interface TimelineEvent {
  id: number;
  title: string;
  year: number;
  month: number;
  day: number;
  precision: DatePrecision;
  year_end: number | null;
  month_end: number | null;
  day_end: number | null;
  status: EventStatus;
  important: boolean;
  /** Сессия рисуется иначе, чем событие: это отметка «где были», а не факт мира. */
  kind?: "event" | "session";
}

// Пять масштабов. Ширина дня в пикселях на каждом подобрана так, чтобы
// соседний масштаб отличался заметно, а не на глаз: век — обзор всей истории,
// день — работа внутри одной недели.
const ZOOMS: { key: DatePrecision; label: string; pxPerDay: number }[] = [
  { key: "century", label: "Век", pxPerDay: 0.0022 },
  { key: "decade", label: "Десятилетие", pxPerDay: 0.022 },
  { key: "year", label: "Год", pxPerDay: 0.22 },
  { key: "month", label: "Месяц", pxPerDay: 2.2 },
  { key: "day", label: "День", pxPerDay: 14 },
  { key: "day", label: "3 дня", pxPerDay: 280 },
];

// Ближе этого события считаются слипшимися и сворачиваются в одну метку.
// Раскладывать их столбиком на пятидесяти событиях — стена высотой в экран, и
// ось перестаёт читаться как ось.
const CLUSTER_PX = 26;

interface Placed {
  event: TimelineEvent;
  x: number;
  width: number;
}

export function Timeline({
  events,
  months,
  era,
  eras,
  selectedTimelineId,
  now,
  cycles = [],
  importantDates = [],
  onMoveEvent,
  onNowChange,
  onEventClick,
  title,
  action,
  leftAction,
  focusDate,
}: {
  events: TimelineEvent[];
  months: CalendarMonth[];
  era: string;
  eras?: SettingCalendarEra[];
  selectedTimelineId?: number | null;
  /** «Сейчас» в мире. Рисуется красной стрелкой, её можно тянуть. */
  now: { year: number; month: number; day?: number } | null;
  cycles?: SettingCycle[];
  importantDates?: ImportantDate[];
  onMoveEvent?: (id: number, date: { year: number; month: number; day: number; precision: DatePrecision }) => void;
  onNowChange?: (date: { year: number; month: number }) => void;
  onEventClick?: (id: number) => void;
  title?: string;
  action?: React.ReactNode;
  leftAction?: React.ReactNode;
  focusDate?: { year: number; month: number; day: number } | null;
}) {
  const [zoom, setZoom] = useState(2); // «Год» по умолчанию
  const [offsetDay, setOffsetDay] = useState(0);
  // Ширина с запасным значением, а не с нулём: замер приходит из
  // ResizeObserver, и пока его нет, ось всё равно должна что-то показывать.
  const [width, setWidth] = useState(900);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const perYear = daysInYear(months) || 365;

  // Плавный зум: zoom — вещественное число, интерполируем pxPerDay между соседними уровнями
  const pxPerDay = useMemo(() => {
    const lo = Math.max(0, Math.floor(zoom));
    const hi = Math.min(ZOOMS.length - 1, lo + 1);
    const t = zoom - lo;
    return ZOOMS[lo].pxPerDay * (1 - t) + ZOOMS[hi].pxPerDay * t;
  }, [zoom]);
  // precision берётся по ближайшему целевому уровню
  const precision = ZOOMS[Math.round(zoom)].key;

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const dayOf = useCallback(
    (y: number, m: number, d: number) => elapsedDays(y, m, d, months),
    [months]
  );

  // Первое открытие показывает то, где что-то есть: пустая ось на нулевом
  // году — это экран, с которого не начать.
  //
  // Центрируется заново при каждом уточнении ширины — до тех пор, пока Мастер
  // сам не повозил ось. Запасная ширина почти наверняка не равна настоящей, и
  // без пересчёта ось встала бы мимо; а ждать замера нельзя, потому что
  // ResizeObserver может и не сработать (так бывает, когда окно не
  // отрисовывается), и тогда ось не встанет никогда.
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || events.length === 0) return;
    const anchor = now
      ? dayOf(now.year, now.month, now.day ?? 1)
      : dayOf(events[events.length - 1].year, events[events.length - 1].month, events[events.length - 1].day);
    setOffsetDay(anchor - width / 2 / pxPerDay);
  }, [events, now, width, pxPerDay, dayOf]);

  useEffect(() => {
    if (!focusDate) return;
    const day = dayOf(focusDate.year, focusDate.month, focusDate.day);
    setOffsetDay(day - width / 2 / pxPerDay);
    touched.current = true;
  }, [focusDate, dayOf, width, pxPerDay]);

  const xOf = useCallback((day: number) => (day - offsetDay) * pxPerDay, [offsetDay, pxPerDay]);
  const dayAt = useCallback((x: number) => offsetDay + x / pxPerDay, [offsetDay, pxPerDay]);

  /**
   * Сменить масштаб, удержав точку на месте. По умолчанию удерживается
   * СЕРЕДИНА экрана: без этого зум кнопкой держал бы левый край, и на переходе
   * с года на месяц окно схлопывалось в четырнадцать дней где-то слева от
   * того, на что смотрели, — то есть в пустоту.
   */
  const zoomTo = useCallback(
    (next: number, holdX?: number) => {
      const clamped = Math.max(0, Math.min(ZOOMS.length - 1, next));
      if (clamped === zoom) return;
      touched.current = true;
      const x = holdX ?? width / 2;
      const day = dayAt(x);
      // Интерпелируем pxPerDay для целевого уровня
      const lo = Math.max(0, Math.floor(clamped));
      const hi = Math.min(ZOOMS.length - 1, lo + 1);
      const t = clamped - lo;
      const targetPxPerDay = ZOOMS[lo].pxPerDay * (1 - t) + ZOOMS[hi].pxPerDay * t;
      setZoom(clamped);
      setOffsetDay(day - x / targetPxPerDay);
    },
    [zoom, width, dayAt]
  );

  // Размещение событий. Период — сплошная полоса от начала до конца;
  // неточность — полоса во всю ширину той единицы, до которой событие
  // определено. Разница не косметическая: неточное событие ждёт уточнения, а
  // период уже точен и уточнять в нём нечего.
  const placed: Placed[] = useMemo(() => {
    const PAD = 200;
    const vl = offsetDay - PAD / pxPerDay;
    const vr = offsetDay + (width + PAD) / pxPerDay;
    return events
      .filter((e) => {
        const s = dayOf(e.year, e.month, e.day);
        let span = 1;
        if (e.year_end != null) {
          const end = dayOf(e.year_end, e.month_end ?? e.month, e.day_end ?? e.day);
          span = Math.max(1, end - s + 1);
        } else if (e.precision === "year") span = perYear;
        else if (e.precision === "decade") span = perYear * 10;
        else if (e.precision === "century") span = perYear * 100;
        else if (e.precision === "month") span = months.find((m) => m.position === e.month)?.days ?? 30;
        return s + span >= vl && s <= vr;
      })
      .map((e) => {
        const start = dayOf(e.year, e.month, e.day);
        let span = 1;
        if (e.year_end != null) {
          const end = dayOf(e.year_end, e.month_end ?? e.month, e.day_end ?? e.day);
          span = Math.max(1, end - start + 1);
        } else if (e.precision === "year") span = perYear;
        else if (e.precision === "decade") span = perYear * 10;
        else if (e.precision === "century") span = perYear * 100;
        else if (e.precision === "month") span = months.find((m) => m.position === e.month)?.days ?? 30;
        return { event: e, x: xOf(start), width: Math.max(2, span * pxPerDay) };
      });
  }, [events, dayOf, xOf, pxPerDay, perYear, months, offsetDay, width]);

  // Свёртка слипшихся. Считается по экранным пикселям, а не по датам: на
  // масштабе века слипается всё, на масштабе дня — ничего, и порог должен
  // быть один и тот же на глаз.
  const clusters = useMemo(() => {
    const visible = placed
      .filter((p) => p.x > -200 && p.x < width + 200)
      .sort((a, b) => a.x - b.x);
    const out: { x: number; items: Placed[] }[] = [];
    for (const p of visible) {
      const last = out[out.length - 1];
      if (last && p.x - last.x < CLUSTER_PX && p.width < CLUSTER_PX) last.items.push(p);
      else out.push({ x: p.x, items: [p] });
    }
    return out;
  }, [placed, width]);

  function onWheel(e: React.WheelEvent) {
    e.preventDefault();
    touched.current = true;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Плавный зум: шаг 0.15 (~1/7 уровня) для промежуточных значений
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      const holdX = e.clientX - (boxRef.current?.getBoundingClientRect().left ?? 0);
      const next = Math.max(0, Math.min(ZOOMS.length - 1, zoom + delta));
      const lo = Math.max(0, Math.floor(next));
      const hi = Math.min(ZOOMS.length - 1, lo + 1);
      const t = next - lo;
      const targetPxPerDay = ZOOMS[lo].pxPerDay * (1 - t) + ZOOMS[hi].pxPerDay * t;
      touched.current = true;
      const day = dayAt(holdX);
      setZoom(next);
      setOffsetDay(day - holdX / targetPxPerDay);
    } else {
      setOffsetDay((d) => d + e.deltaX / pxPerDay);
    }
  }

  const drag = useRef<{ x: number; offset: number } | null>(null);
  const rafRef = useRef<number>(0);
  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".tl-item, .tl-now")) return;
    touched.current = true;
    drag.current = { x: e.clientX, offset: offsetDay };
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
  }
  function onPointerMove(e: React.PointerEvent) {
    if (!drag.current) return;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (drag.current) setOffsetDay(drag.current.offset - (e.clientX - drag.current.x) / pxPerDay);
    });
  }
  function onPointerUp() {
    drag.current = null;
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  }

  // Засечки. Шаг выбирается по масштабу так, чтобы подписи не слипались: на
  // веке подписываются столетия, на дне — дни.
  const ticks = useMemo(() => {
    const stepDays =
      precision === "century" ? perYear * 100
      : precision === "decade" ? perYear * 10
      : precision === "year" ? perYear
      : precision === "month" ? perYear / Math.max(1, months.length)
      : 1;
    const first = Math.floor(offsetDay / stepDays) * stepDays;
    const out: { x: number; label: string }[] = [];
    for (let d = first; d < offsetDay + width / pxPerDay; d += stepDays) {
      const date = dateFromElapsed(Math.round(d), months);
      out.push({
        x: xOf(d),
        label: formatByPrecision(date.year, date.month, date.day, precision, months, ""),
      });
      if (out.length > 200) break;
    }
    return out;
  }, [precision, perYear, months, offsetDay, width, pxPerDay, xOf]);

  // Точки циклов — только на дне и месяце. Луна с периодом 28 дней на оси
  // столетия это 1300 засечек в один пиксель, то есть серая полоса.
  const cyclePoints = useMemo(() => {
    if (precision !== "day" && precision !== "month") return [];
    const from = Math.floor(offsetDay);
    const to = Math.ceil(offsetDay + width / pxPerDay);
    const out: { x: number; name: string; cycle: string }[] = [];
    for (const cycle of cycles) {
      if (cycle.period_days < 1) continue;
      const anchor = dayOf(cycle.anchor_year, cycle.anchor_month, cycle.anchor_day);
      for (const point of cycle.points) {
        const firstTurn = Math.floor((from - anchor - point.day_offset) / cycle.period_days);
        for (let k = firstTurn; ; k++) {
          const day = anchor + point.day_offset + k * cycle.period_days;
          if (day > to) break;
          if (day >= from) out.push({ x: xOf(day), name: point.name, cycle: cycle.name });
          if (out.length > 300) break;
        }
      }
    }
    return out;
  }, [cycles, precision, offsetDay, width, pxPerDay, dayOf, xOf]);

  // Важные даты на оси — повторяющиеся события как маркеры.
  // Показываем при зуме год/месяц/3 дня/день.
  const importantDatePoints = useMemo(() => {
    if (!importantDates.length) return [];
    if (precision === "century" || precision === "decade") return [];
    const from = Math.floor(offsetDay);
    const to = Math.ceil(offsetDay + width / pxPerDay);
    const perYearDays = daysInYear(months) || 365;
    const out: { x: number; name: string; color?: string }[] = [];
    const cap = 200;
    for (const d of importantDates) {
      if (out.length >= cap) break;
      if (d.recurrence === "annual" && d.month != null) {
        const minYear = Math.floor(from / perYearDays) + 1;
        const maxYear = Math.ceil(to / perYearDays) + 1;
        for (let y = minYear; y <= maxYear; y++) {
          if (out.length >= cap) break;
          const day = dayOf(y, d.month, d.day);
          if (day >= from && day <= to) out.push({ x: xOf(day), name: d.title, color: d.color ?? undefined });
        }
      } else if (d.recurrence === "monthly") {
        const startDate = dateFromElapsed(Math.max(from, 0), months);
        const endDate = dateFromElapsed(to, months);
        for (let y = startDate.year; y <= endDate.year; y++) {
          for (let m = 1; m <= months.length; m++) {
            if (out.length >= cap) break;
            const day = dayOf(y, m, d.day);
            if (day >= from && day <= to) out.push({ x: xOf(day), name: d.title, color: d.color ?? undefined });
          }
        }
      } else if (d.recurrence === "weekly") {
        const day = Math.floor(from);
        for (let d0 = day; d0 <= to && out.length < cap; d0++) {
          const date = dateFromElapsed(d0, months);
          if (date.day === d.day) out.push({ x: xOf(d0), name: d.title, color: d.color ?? undefined });
        }
      }
    }
    return out;
  }, [importantDates, precision, offsetDay, width, pxPerDay, dayOf, xOf, months]);

  const nowX = now ? xOf(dayOf(now.year, now.month, now.day ?? 1)) : null;

  // Стрелку «сейчас» тянут только на годе и мельче: на столетии один пиксель
  // это несколько лет, и «сейчас» уехало бы от дрожания руки.
  const nowDraggable = onNowChange != null && zoom >= 2;

  const eraBands = useMemo(() => {
    if (!eras || eras.length === 0) return [];
    const filtered = selectedTimelineId != null
      ? eras.filter((e) => e.timeline_id === selectedTimelineId)
      : eras.filter((e) => e.timeline_id == null);
    if (filtered.length === 0) return [];
    const sorted = [...filtered].sort((a, b) => a.start_year - b.start_year);
    const perYearDays = daysInYear(months) || 365;
    return sorted.map((era, i) => {
      const startDay = (era.start_year - 1) * perYearDays;
      const endDay = i + 1 < sorted.length ? (sorted[i + 1].start_year - 1) * perYearDays : startDay + perYearDays * 100;
      return { name: era.name, startDay, endDay };
    });
  }, [eras, selectedTimelineId, months]);

  function dropNow(clientX: number) {
    if (!nowDraggable) return;
    const x = clientX - (boxRef.current?.getBoundingClientRect().left ?? 0);
    const date = dateFromElapsed(Math.round(dayAt(x)), months);
    onNowChange?.({ year: date.year, month: date.month });
  }

  function dropEvent(id: number, clientX: number) {
    if (!onMoveEvent) return;
    const x = clientX - (boxRef.current?.getBoundingClientRect().left ?? 0);
    const date = dateFromElapsed(Math.round(dayAt(x)), months);
    // Точность задаёт масштаб, на котором бросили: уточнение и сдвиг — один
    // жест на разных зумах.
    onMoveEvent(id, { ...date, precision });
  }

  // Без календаря оси не из чего строить: длина года, месяцы и их дни —
  // всё оттуда. Рисовать по земному году было бы тихой ложью в мире, где год
  // из 203 дней.
  if (months.length === 0) {
    return (
      <p className="muted">
        В сеттинге не настроен календарь — без него у оси нет ни длины года, ни
        месяцев. Настройте его во вкладке «Календарь».
      </p>
    );
  }

  return (
    <div className="tl">
      <div className="row tl-toolbar" style={{ justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div className="row" style={{ gap: 8, alignItems: "center" }}>
          {title ? <h3 style={{ margin: 0 }}>{title}</h3> : <span />}
          {now && (
            <button onClick={() => setOffsetDay(dayOf(now.year, now.month, now.day ?? 1) - width / 2 / pxPerDay)}>
              К «сейчас»
            </button>
          )}
          {leftAction}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {ZOOMS.map((z, i) => (
            <button
              // Ключ по метке, а не по `key`: «День» и «3 дня» — разные
              // ступени с одной и той же точностью `day`, и React считал их
              // одной кнопкой.
              key={z.label}
              className={i === Math.round(zoom) ? "active-sort" : ""}
              onClick={() => zoomTo(i)}
            >
              {z.label}
            </button>
          ))}
        </div>
        <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
          {action}
        </div>
      </div>

      <div
        ref={boxRef}
        className="tl-canvas"
        onWheel={onWheel}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={onPointerUp}
      >
        {ticks.map((t, i) => (
          <div key={i} className="tl-tick" style={{ left: t.x }}>
            <span>{t.label}</span>
          </div>
        ))}

        {eraBands.map((b, i) => {
          const x = xOf(b.startDay);
          return (
            <div
              key={`era-${i}`}
              className="tl-era-band"
              style={{ left: x, width: Math.max(2, xOf(b.endDay) - x) }}
              title={b.name}
            >
              <span className="tl-era-label">{b.name}</span>
            </div>
          );
        })}

        {cyclePoints.map((p, i) => (
          <div key={i} className="tl-cycle" style={{ left: p.x }} title={`${p.cycle}: ${p.name}`} />
        ))}

        {importantDatePoints.map((p, i) => (
          <div
            key={`imp-${i}`}
            className="tl-cycle"
            style={{ left: p.x, background: p.color ?? "var(--accent)", borderColor: p.color ?? "var(--accent)" }}
            title={p.name}
          />
        ))}

        {clusters.map((c, i) =>
          c.items.length > 1 ? (
            <button
              key={`c${i}`}
              className="tl-item tl-cluster"
              style={{ left: c.x }}
              onClick={() => {
                // Щелчок по свёртке зумит В НЕЁ: скрыть событие нельзя, но и
                // разложить его на этом масштабе некуда. Держим саму метку,
                // иначе отрезок, ради которого нажали, уезжает за край.
                zoomTo(zoom + 1, c.x);
              }}
              title={c.items.map((p) => p.event.title).join("\n")}
            >
              {c.items.length}
            </button>
          ) : (
            <EventBar
              key={c.items[0].event.id}
              placed={c.items[0]}
              months={months}
              era={era}
              draggable={onMoveEvent != null}
              onDrop={(clientX) => dropEvent(c.items[0].event.id, clientX)}
              onClick={() => onEventClick?.(c.items[0].event.id)}
            />
          )
        )}

        {nowX != null && (
          <div
            className={`tl-now${nowDraggable ? " is-draggable" : ""}`}
            style={{ left: nowX }}
            title={nowDraggable ? "Сейчас в мире — перетащите" : "Сейчас в мире"}
            onPointerDown={(e) => {
              if (!nowDraggable) return;
              e.stopPropagation();
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onPointerUp={(e) => nowDraggable && dropNow(e.clientX)}
          >
            <span className="tl-now-head" />
          </div>
        )}
      </div>
    </div>
  );
}

function EventBar({
  placed,
  months,
  era,
  draggable,
  onDrop,
  onClick,
}: {
  placed: Placed;
  months: CalendarMonth[];
  era: string;
  draggable: boolean;
  onDrop: (clientX: number) => void;
  onClick: () => void;
}) {
  // Позиция нажатия: бросок засчитывается только если реально тащили, иначе
  // обычный щелчок по событию переставлял бы ему дату.
  const down = useRef<number | null>(null);
  const e = placed.event;
  const isPeriod = e.year_end != null;
  // Период — сплошная полоса с засечками на концах, неточность — размытая.
  // Слив их в одно, получили бы ось, на которой нельзя ответить «что тут ещё
  // не решено».
  const classes = [
    "tl-item",
    "tl-event",
    isPeriod ? "is-period" : e.precision !== "day" ? "is-fuzzy" : "",
    e.status === "cancelled" ? "is-cancelled" : "",
    e.status === "upcoming" ? "is-upcoming" : "",
    e.important ? "is-important" : "",
    e.kind === "session" ? "is-session" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      className={classes}
      style={{ left: placed.x, width: placed.width }}
      title={`${e.title}\n${formatByPrecision(e.year, e.month, e.day, e.precision, months, era)}`}
      onClick={onClick}
      onPointerUp={(ev) => {
        if (!draggable) return;
        if (Math.abs(ev.clientX - (down.current ?? ev.clientX)) > 4) onDrop(ev.clientX);
      }}
      onPointerDown={(ev) => {
        down.current = ev.clientX;
        if (draggable) ev.stopPropagation();
      }}
    >
      <span className="tl-event-title">{e.title}</span>
    </button>
  );
}
