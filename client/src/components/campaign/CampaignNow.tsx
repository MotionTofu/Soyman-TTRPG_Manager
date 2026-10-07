import { useMemo } from "react";
import { Link } from "react-router-dom";
import { sessionLabel } from "../../sessionLabel";
import { toLocalDateKey, formatDateKeyRu } from "../../utils/date";
import type { SessionSummary } from "../../types";

// Ближайшая сессия в строке названия кампании.
export function CampaignNow({
  oneshot,
  sessions,
  onSchedule,
}: {
  oneshot: boolean;
  sessions: SessionSummary[];
  onSchedule: () => void;
}) {
  const today = toLocalDateKey();
  const next = useMemo(
    () => sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0],
    [sessions, today]
  );
  return (
    <section className="campaign-now" aria-label="Ближайшая сессия">
      <div>
        <span className="paper-label">{oneshot ? "Ближайший прогон" : "Ближайшая"}</span>
        {next ? (
          <Link to={`/sessions/${next.id}`}>
            {formatDateKeyRu(next.date)} — {sessionLabel(next)}
          </Link>
        ) : (
          <button type="button" className="paper-more" onClick={onSchedule}>
            Запланировать ›
          </button>
        )}
      </div>
    </section>
  );
}
