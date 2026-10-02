import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { daysInYear, dateFromElapsed, elapsedDays, formatByPrecision } from "../inworldCalendar";
import type { CalendarMonth, DatePrecision, EventStatus, ImportantDate, SettingCalendarEra } from "../types";
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

// Масштабы честные (просьба владельца 2026-10-02): «Век» — на всю ширину оси
// сто лет, «День» — один день. Длина задаётся в годах или днях, а пиксели на
// день считаются от ширины оси и длины года сеттинга; «Месяц» — средний месяц
// календаря, а не земной.
// Тысячелетия нет среди точностей даты — бросок события на нём ставит век.
const ZOOMS: { key: DatePrecision; label: string; years?: number; days?: number }[] = [
  { key: "century", label: "Тысячелетие", years: 1000 },
  { key: "century", label: "Век", years: 100 },
  { key: "decade", label: "Десятилетие", years: 10 },
  { key: "year", label: "Год", years: 1 },
  { key: "month", label: "Месяц" },
  { key: "day", label: "3 дня", days: 3 },
  { key: "day", label: "День", days: 1 },
];
const YEAR_ZOOM = ZOOMS.findIndex((z) => z.key === "year");

// Подписи засечек длинные («14 Март 1496») — ближе этого они слипаются.
const TICK_PX = 110;

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
  importantDates = [],
  onMoveEvent,
  onNowChange,
  onEventClick,
  title,
  action,
  leftAction,
  focusDate,
  below,
}: {
  events: TimelineEvent[];
  months: CalendarMonth[];
  era: string;
  eras?: SettingCalendarEra[];
  selectedTimelineId?: number | null;
  /** «Сейчас» в мире. Рисуется красной стрелкой, её можно тянуть. */
  now: { year: number; month: number; day?: number } | null;
  importantDates?: ImportantDate[];
  onMoveEvent?: (id: number, date: { year: number; month: number; day: number; precision: DatePrecision }) => void;
  onNowChange?: (date: { year: number; month: number }) => void;
  onEventClick?: (id: number) => void;
  title?: string;
  action?: React.ReactNode;
  leftAction?: React.ReactNode;
  focusDate?: { year: number; month: number; day: number } | null;
  /** Панель под осью с тем же масштабом и сдвигом — циклы сеттинга. */
  below?: (view: TimelineView) => React.ReactNode;
}) {
  const [zoom, setZoom] = useState(YEAR_ZOOM); // «Год» по умолчанию
  const [offsetDay, setOffsetDay] = useState(0);
  // Ширина с запасным значением, а не с нулём: замер приходит из
  // ResizeObserver, и пока его нет, ось всё равно должна что-то показывать.
  const [width, setWidth] = useState(900);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const perYear = daysInYear(months) || 365;

  // Плавный зум: zoom — вещественное число; между соседними уровнями пиксели
  // на день меняются в геометрической пропорции, чтобы каждый щелчок колеса
  // увеличивал одинаково.
  const pxAt = useCallback(
    (z: number) => {
      const level = (i: number) => {
        const { days, years } = ZOOMS[i];
        return width / (days ?? (years != null ? perYear * years : perYear / Math.max(1, months.length)));
      };
      const lo = Math.max(0, Math.min(ZOOMS.length - 1, Math.floor(z)));
      const hi = Math.min(ZOOMS.length - 1, lo + 1);
      return level(lo) * Math.pow(level(hi) / level(lo), z - lo);
    },
    [width, perYear, months.length]
  );
  const pxPerDay = pxAt(zoom);
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
      setZoom(clamped);
      setOffsetDay(day - x / pxAt(clamped));
    },
    [zoom, width, dayAt, pxAt]
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

  function onWheel(e: WheelEvent) {
    e.preventDefault();
    touched.current = true;
    if (e.ctrlKey || e.metaKey || Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      // Плавный зум: шаг 0.15 (~1/7 уровня) для промежуточных значений
      const delta = e.deltaY > 0 ? -0.15 : 0.15;
      const holdX = e.clientX - (boxRef.current?.getBoundingClientRect().left ?? 0);
      const next = Math.max(0, Math.min(ZOOMS.length - 1, zoom + delta));
      const day = dayAt(holdX);
      setZoom(next);
      setOffsetDay(day - holdX / pxAt(next));
    } else {
      setOffsetDay((d) => d + e.deltaX / pxPerDay);
    }
  }
  // Колесо — родным слушателем: React вешает onWheel пассивным, preventDefault
  // не срабатывал, и вместе с зумом прокручивалась страница. Слушатель один на
  // всю ось; ось и панели под ней помечены data-tl-pan.
  const rootRef = useRef<HTMLDivElement | null>(null);
  const wheelRef = useRef(onWheel);
  useEffect(() => {
    wheelRef.current = onWheel;
  });
  const hasCalendar = months.length > 0;
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const listener = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-tl-pan]")) wheelRef.current(e);
    };
    root.addEventListener("wheel", listener, { passive: false });
    return () => root.removeEventListener("wheel", listener);
  }, [hasCalendar]);

  const drag = useRef<{ x: number; offset: number } | null>(null);
  const rafRef = useRef<number>(0);
  function onPointerDown(e: React.PointerEvent) {
    if ((e.target as HTMLElement).closest(".tl-item, .tl-now, label, button, input")) return;
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

  // Засечки. Шаг — самый мелкий из круглых (дни, месяцы, годы), при котором
  // подписи не слипаются. Месяцы и годы встают на настоящие начала, а не на
  // кратные среднему месяцу: иначе «Март» стоял бы в конце февраля.
  const ticks = useMemo(() => {
    const out: { x: number; label: string }[] = [];
    const end = offsetDay + width / pxPerDay;
    const fits = (days: number) => days * pxPerDay >= TICK_PX;
    const push = (day: number, at: DatePrecision) => {
      const date = dateFromElapsed(day, months);
      out.push({ x: xOf(day), label: formatByPrecision(date.year, date.month, date.day, at, months, "") });
    };
    const ordered = [...months].sort((a, b) => a.position - b.position);
    const dayStep = [1, 2, 5, 10].find(fits);
    const monthStep = [1, 2, 3, 6].find((k) => k < ordered.length && fits((k * perYear) / ordered.length));
    const firstYear = dateFromElapsed(Math.max(0, Math.floor(offsetDay)), months).year;
    if (dayStep) {
      for (let d = Math.floor(offsetDay / dayStep) * dayStep; d < end && out.length < 200; d += dayStep) push(d, "day");
    } else if (monthStep) {
      for (let y = firstYear; (y - 1) * perYear < end && out.length < 200; y++) {
        ordered.forEach((m, i) => {
          const d = dayOf(y, m.position, 1);
          if (i % monthStep === 0 && d >= offsetDay - perYear && d < end) push(d, "month");
        });
      }
    } else {
      const yearStep = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000].find((k) => fits(k * perYear)) ?? 10000;
      for (let y = Math.floor((firstYear - 1) / yearStep) * yearStep + 1; (y - 1) * perYear < end && out.length < 200; y += yearStep) {
        push((y - 1) * perYear, "year");
      }
    }
    return out;
  }, [perYear, months, offsetDay, width, pxPerDay, xOf, dayOf]);

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
  const nowDraggable = onNowChange != null && zoom >= YEAR_ZOOM;

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
    <div className="tl" ref={rootRef}>
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
        data-tl-pan=""
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
      {below?.({
        from: Math.floor(offsetDay),
        to: Math.ceil(offsetDay + width / pxPerDay),
        pxPerDay,
        xOf,
        dayOf,
        pan: { "data-tl-pan": "", onPointerDown, onPointerMove, onPointerUp, onPointerLeave: onPointerUp },
      })}
    </div>
  );
}

export interface TimelineView {
  /** Видимое окно оси в днях от начала летоисчисления. */
  from: number;
  to: number;
  pxPerDay: number;
  xOf: (day: number) => number;
  dayOf: (year: number, month: number, day: number) => number;
  /** Обработчики оси: тянешь панель — едет и ось. */
  pan: Pick<React.DOMAttributes<HTMLElement>, "onPointerDown" | "onPointerMove" | "onPointerUp" | "onPointerLeave"> & { "data-tl-pan": "" };
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
