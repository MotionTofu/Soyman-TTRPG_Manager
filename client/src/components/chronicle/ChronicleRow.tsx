import { memo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MentionText } from "../mentions/MentionText";
import { NavIcon } from "../NavIcons";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import type { CalendarMonth, DatePrecision } from "../../types";
import { formatByPrecision } from "../../inworldCalendar";
import { monthName, type TimeTone } from "./time";

// Строка Хроники в «Д» (доска Set-Chronicle): точка тоном времени, дата
// столбиком (число Oswald, месяц машинописью), название с меткой статуса и
// описанием строкой, справа глаз и «⋯». Одна у сеттинга и кампании;
// своё кампания кладёт в `tags` (метка «мир», «Сессия №») и `extra`
// (участники).

export interface ChronicleRowEvent {
  id: number;
  title: string;
  description: string;
  status: string;
  cancel_note?: string;
  date_precision?: DatePrecision | null;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
  inworld_year_end: number | null;
  inworld_month_end: number | null;
  inworld_day_end: number | null;
  important: number;
  visible_to_players?: number;
}

const STATUS: Partial<Record<TimeTone, string>> = { on: "Идёт", up: "Предстоит", off: "Отменено" };

function ChronicleRowInner({
  ev,
  tone,
  months,
  href,
  tags,
  extra,
  menu,
  onToggleVisible,
  onToggleImportant,
  onSelect,
  selected,
  dateLabel,
}: {
  ev: ChronicleRowEvent;
  tone: TimeTone;
  months: CalendarMonth[];
  /** Куда ведёт название; пусто — название текстом. */
  href?: string | null;
  /** Метки после названия (у кампании — «мир», «Сессия №»). */
  tags?: ReactNode;
  /** Строка под описанием (у кампании — участники). */
  extra?: ReactNode;
  /** Действия под «⋯» — их собирает вкладка. */
  menu: ContextMenuItem[];
  /** Без него глаза нет. */
  onToggleVisible?: () => void;
  onToggleImportant?: () => void;
  onSelect?: () => void;
  selected?: boolean;
  dateLabel?: { big: string; small: string };
}) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const precision = ev.date_precision ?? "day";
  const sameMonth = ev.inworld_year_end === ev.inworld_year && ev.inworld_month_end === ev.inworld_month;
  // Число — день (или «18–30» у периода внутри месяца); у неточной даты — месяц или год.
  const big =
    precision === "day"
      ? sameMonth && ev.inworld_day_end != null
        ? `${ev.inworld_day}–${ev.inworld_day_end}`
        : String(ev.inworld_day)
      : precision === "month"
        ? monthName(months, ev.inworld_month)
        : formatByPrecision(ev.inworld_year, ev.inworld_month, ev.inworld_day, precision, months, "");
  const small = precision === "day" ? `${monthName(months, ev.inworld_month)} ${ev.inworld_year}` : precision === "month" ? String(ev.inworld_year) : "";
  const visible = !!ev.visible_to_players;
  const text = ev.status === "cancelled" && ev.cancel_note ? ev.cancel_note : ev.description;

  return (
    <div className={`chr-ev chr-tone--${tone}${selected ? " is-selected" : ""}`} tabIndex={onSelect ? 0 : undefined}
      onClick={(e) => { if (!(e.target as HTMLElement).closest("a, button, input")) onSelect?.(); }}
      onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onSelect?.(); } }}>
      <span className="chr-ev__dot" aria-hidden="true" />
      <span className="chr-ev__date">
        <b>{dateLabel?.big ?? big}</b>
        <span>{dateLabel?.small ?? small}</span>
        {ev.inworld_year_end != null && !sameMonth && <span>→ {formatByPrecision(ev.inworld_year_end, ev.inworld_month_end ?? ev.inworld_month, ev.inworld_day_end ?? ev.inworld_day, precision, months, "")}</span>}
      </span>
      <span className="chr-ev__main">
        <span className="chr-ev__head">
          {href ? (
            <Link to={href} className="chr-ev__title">
              {ev.title}
            </Link>
          ) : (
            <span className="chr-ev__title">{ev.title}</span>
          )}
          {ev.important && !onToggleImportant ? (
            <span className="chr-ev__star" title="Важное">
              ★
            </span>
          ) : null}
          {STATUS[tone] && <span className="chr-ev__st">{STATUS[tone]}</span>}
          {tags}
        </span>
        {text && (
          <span className="chr-ev__desc">
            <MentionText text={text} />
          </span>
        )}
        {extra}
      </span>
      <span className="chr-ev__acts">
        {onToggleImportant && <button type="button" className="chr-dots" aria-label={`Важное: ${ev.title}`} aria-pressed={!!ev.important} onClick={onToggleImportant}>{ev.important ? "★" : "☆"}</button>}
        {onToggleVisible && (
          <button
            type="button"
            className={`chr-vis${visible ? "" : " is-hidden"}`}
            aria-pressed={visible}
            title={visible ? "Видно игрокам — скрыть" : "Скрыто от игроков — показать"}
            aria-label={visible ? "Видно игрокам — скрыть" : "Скрыто от игроков — показать"}
            onClick={onToggleVisible}
          >
            <NavIcon name="eye" />
          </button>
        )}
        <button
          type="button"
          className="chr-dots"
          aria-label="Действия с событием"
          aria-haspopup="menu"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            setMenuAt({ x: r.right, y: r.bottom });
          }}
        >
          ⋯
        </button>
        {menuAt && <ContextMenu x={menuAt.x} y={menuAt.y} items={menu} onClose={() => setMenuAt(null)} />}
      </span>
    </div>
  );
}

export const ChronicleRow = memo(ChronicleRowInner);
