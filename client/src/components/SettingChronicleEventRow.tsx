import { memo } from "react";
import { Link } from "react-router-dom";
import { MentionText } from "./mentions/MentionText";
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
  return (
    <div className="stack" style={{ gap: "var(--sp-2)" }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <span className="row chronicle-row" style={{ alignItems: "center", flexWrap: "wrap", gap: "var(--sp-2)" }}>
          {ev.description && (
            <button style={{ padding: "2px 6px" }} onClick={() => onToggleExpand(ev.id)}>
              {expanded ? "▾" : "▸"}
            </button>
          )}
          <span className="chronicle-date">{calendar ? formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar.months) : `${ev.inworld_year}.${ev.inworld_month}.${ev.inworld_day}`}</span>
          <span className={`chronicle-status is-${ev.status}`}>{ev.status === "cancelled" ? "Отменено" : ev.status === "upcoming" ? "Предстоит" : "Случилось"}</span>
          <Link to={`/events/${ev.id}`} className="chronicle-title">{ev.title}</Link>
          {mentionChips.length > 0 && (
            <span className="row" style={{ gap: 4, flexWrap: "wrap" }}>
              {mentionChips.slice(0, 2).map((label) => <span key={label} className="badge tag" style={{ fontSize: "var(--fs-micro)" }}>{label}</span>)}
              {mentionChips.length > 2 && <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>+{mentionChips.length - 2}</span>}
            </span>
          )}
        </span>
        <div className="row" style={{ gap: "var(--sp-2)", alignItems: "center" }}>
          <button
            onClick={() => onToggleImportant(ev)}
            title={ev.important ? "Убрать из избранного" : "В избранное"}
            className={`comp-mini ${ev.important ? "primary" : ""}`}
            style={{ padding: "2px 6px", fontSize: 14, lineHeight: 1 }}
          >
            {ev.important ? "★" : "☆"}
          </button>
          <label className="row" style={{ fontSize: "var(--fs-meta)" }}>
            <input type="checkbox" checked={!!ev.visible_to_players} onChange={() => onToggleVisible(ev)} />
            Видно игрокам
          </label>
          <button className="comp-mini" onClick={() => onEdit(ev)}>Редактировать</button>
          <button className="comp-mini" onClick={() => onShowOnAxis(ev)} title="На оси">Ось</button>
          <button className="comp-mini" onClick={onShowOnCalendar} title="На календаре">Календарь</button>
          <button className="comp-mini danger" onClick={() => onDelete(ev.id)}>✕</button>
        </div>
      </div>
      {expanded && ev.description && (
        <div className="chronicle-row__expanded" style={{ whiteSpace: "pre-wrap" }}>
          <MentionText text={ev.description} />
        </div>
      )}
    </div>
  );
});
