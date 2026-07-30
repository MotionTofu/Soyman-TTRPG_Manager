import { useState } from "react";
import { Link } from "react-router-dom";
import type { SessionSummary } from "../types";

interface Props {
  sessions: SessionSummary[];
}

export function UpcomingSessionsNotice({ sessions }: Props) {
  const [dismissed, setDismissed] = useState<Set<number>>(new Set());

  const today = new Date().toISOString().slice(0, 10);
  const upcoming = sessions
    .filter((s) => s.status === "planned" && s.date >= today)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .slice(0, 3)
    .filter((s) => !dismissed.has(s.id));

  if (upcoming.length === 0) return null;

  return (
    <div className="upcoming-notice-stack">
      {upcoming.map((s) => (
        <div key={s.id} className="upcoming-notice">
          <span className="muted">Ближайшая сессия:</span>
          <Link to={`/sessions/${s.id}`}>
            <strong>{s.campaign_name}</strong>
          </Link>
          <span className="muted">{s.date}</span>
          <button
            className="upcoming-notice-close"
            onClick={() => setDismissed((prev) => new Set(prev).add(s.id))}
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  );
}
