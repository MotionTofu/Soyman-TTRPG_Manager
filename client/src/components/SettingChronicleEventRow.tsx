import { memo } from "react";
import { Link } from "react-router-dom";
import { MentionText } from "./mentions/MentionText";
import { RowDeleteButton, RowEditButton } from "./RowIconButtons";
import { formatEventDate } from "../inworldCalendar";
import type { SettingCalendar, SettingCalendarEvent } from "../types";

export interface SettingChronicleEventRowProps {
  ev: SettingCalendarEvent;
  expanded: boolean;
  calendar: SettingCalendar | null;
  onToggleExpand: (id: number) => void;
  onToggleImportant: (ev: SettingCalendarEvent) => void;
  onToggleVisible: (ev: SettingCalendarEvent) => void;
  onEdit: (ev: SettingCalendarEvent) => void;
  onDelete: (id: number) => void;
  onShowOnAxis: (ev: SettingCalendarEvent) => void;
  onShowOnCalendar: () => void;
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

export const SettingChronicleEventRow = memo(function SettingChronicleEventRow({
  ev, expanded, calendar,
  onToggleExpand, onToggleImportant, onToggleVisible,
  onEdit, onDelete, onShowOnAxis, onShowOnCalendar,
}: SettingChronicleEventRowProps) {
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
          {mentionChips.slice(0, 2).map((label) => <span key={label} className="badge tag">{label}</span>)}
          {mentionChips.length > 2 && <span className="muted">+{mentionChips.length - 2}</span>}
        </span>
        <Link to={`/events/${ev.id}`} className="chronicle-item__title">{ev.title}</Link>
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
        <label className="chronicle-item__visible">
          <input type="checkbox" checked={!!ev.visible_to_players} onChange={() => onToggleVisible(ev)} />
          Видно игрокам
        </label>
        <button type="button" className="comp-mini" onClick={() => onShowOnAxis(ev)} title="Показать на оси">Ось</button>
        <button type="button" className="comp-mini" onClick={onShowOnCalendar} title="Показать на календаре">Календарь</button>
        <RowEditButton onClick={() => onEdit(ev)} />
        <RowDeleteButton onClick={() => onDelete(ev.id)} />
      </span>
      {expanded && ev.description && (
        <div className="chronicle-item__expanded">
          <MentionText text={ev.description} />
        </div>
      )}
    </div>
  );
});
