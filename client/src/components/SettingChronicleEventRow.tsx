import { memo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { MentionText } from "./mentions/MentionText";
import { RowDeleteButton, RowEditButton } from "./RowIconButtons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { formatEventDate } from "../inworldCalendar";
import type { EventTimeFields, SettingCalendar } from "../types";

/** Что строке нужно от события — общее у событий сеттинга и кампании. */
export type ChronicleRowEvent = EventTimeFields & {
  id: number;
  title: string;
  description: string;
  inworld_year: number;
  inworld_month: number;
  inworld_day: number;
  important: number;
  visible_to_players?: number;
};

export interface SettingChronicleEventRowProps<E extends ChronicleRowEvent> {
  ev: E;
  expanded: boolean;
  calendar: SettingCalendar | null;
  /** Куда ведёт название; пусто — название просто текстом. */
  href?: string | null;
  /** Пометка рядом с датой, например «мир» у события сеттинга в кампании. */
  tag?: ReactNode;
  onToggleExpand: (id: number) => void;
  onToggleImportant: (ev: E) => void;
  /** Без него переключателя «Видно игрокам» нет. */
  onToggleVisible?: (ev: E) => void;
  onEdit: (ev: E) => void;
  /** Без него корзины нет. */
  onDelete?: (id: number) => void;
  /** Редкие действия — под «…», чтобы не нажать случайно. */
  menu?: ContextMenuItem[];
  onShowOnAxis: (ev: E) => void;
  onShowOnCalendar: (ev: E) => void;
}

function extractMentionChips(description: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of description.matchAll(/\[\[(\w+):\d+\|([^\]]+)\]\]/g)) {
    const label = m[2];
    if (!seen.has(label)) { seen.add(label); out.push(label); if (out.length >= 3) break; }
  }
  return out;
}

// Строка хроники — одна у сеттинга и у кампании (просьба владельца 2026-10-02).
function ChronicleEventRow<E extends ChronicleRowEvent>({
  ev, expanded, calendar, href, tag,
  onToggleExpand, onToggleImportant, onToggleVisible,
  onEdit, onDelete, menu, onShowOnAxis, onShowOnCalendar,
}: SettingChronicleEventRowProps<E>) {
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const mentionChips = extractMentionChips(ev.description ?? "");
  // Сетка (просьба владельца 2026-10-02): дата жирно, название — следующей
  // строкой, действия — одинаковыми столбцами у всех строк. «Случилось» —
  // обычное состояние и не подписывается; «предстоит» и «отменено» — да.
  return (
    <div className="chronicle-item">
      <span className="chronicle-item__toggle">
        {ev.description && (
          <button type="button" className="desc-toggle" aria-expanded={expanded} aria-label="Описание" onClick={() => onToggleExpand(ev.id)}>
            <span className={`desc-toggle__chev${expanded ? " is-open" : ""}`} aria-hidden="true">›</span>
          </button>
        )}
      </span>
      <span className="chronicle-item__main">
        <span className="chronicle-item__head">
          <span className="chronicle-item__date">
            {calendar ? formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar.months) : `${ev.inworld_year}.${ev.inworld_month}.${ev.inworld_day}`}
          </span>
          {ev.status !== "happened" && (
            <span className={`chronicle-status is-${ev.status}`}>{ev.status === "cancelled" ? "Отменено" : "Предстоит"}</span>
          )}
          {tag}
          {mentionChips.slice(0, 2).map((label) => <span key={label} className="badge tag">{label}</span>)}
          {mentionChips.length > 2 && <span className="muted">+{mentionChips.length - 2}</span>}
        </span>
        {href ? (
          <Link to={href} className="chronicle-item__title">{ev.title}</Link>
        ) : (
          <span className="chronicle-item__title">{ev.title}</span>
        )}
      </span>
      <span className="chronicle-item__actions">
        <button
          type="button"
          onClick={() => onToggleImportant(ev)}
          title={ev.important ? "Убрать из важных" : "В важные"}
          aria-pressed={!!ev.important}
          className={`comp-mini${ev.important ? " primary" : ""}`}
        >
          {ev.important ? "★" : "☆"}
        </button>
        {onToggleVisible && (
          <label className="chronicle-item__visible">
            <input type="checkbox" checked={!!ev.visible_to_players} onChange={() => onToggleVisible(ev)} />
            Видно игрокам
          </label>
        )}
        <button type="button" className="comp-mini" onClick={() => onShowOnAxis(ev)} title="Показать на оси">Ось</button>
        <button type="button" className="comp-mini" onClick={() => onShowOnCalendar(ev)} title="Показать на календаре">Календарь</button>
        <RowEditButton onClick={() => onEdit(ev)} />
        {onDelete && <RowDeleteButton onClick={() => onDelete(ev.id)} />}
        {menu && menu.length > 0 && (
          <button
            type="button"
            className="comp-mini"
            aria-label="Ещё действия"
            aria-haspopup="menu"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenuAt({ x: r.right, y: r.bottom });
            }}
          >
            …
          </button>
        )}
        {menuAt && menu && <ContextMenu x={menuAt.x} y={menuAt.y} items={menu} onClose={() => setMenuAt(null)} />}
      </span>
      {expanded && ev.description && (
        <div className="chronicle-item__expanded">
          <MentionText text={ev.description} />
        </div>
      )}
    </div>
  );
}

export const SettingChronicleEventRow = memo(ChronicleEventRow) as typeof ChronicleEventRow;
