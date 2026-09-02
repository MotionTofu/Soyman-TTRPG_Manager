import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { MentioningSession } from "../types";
import { sessionLabel } from "../sessionLabel";

// "Упоминания" tab for Being/Location/Community/Artifact pages: lists every
// session whose Задумка/Основные события text @-mentions this entity.
export function MentionsTab({ entityType, entityId }: { entityType: string; entityId: number }) {
  const [sessions, setSessions] = useState<MentioningSession[] | null>(null);

  useEffect(() => {
    api
      .get<MentioningSession[]>(`/links/mentioning-sessions?type=${entityType}&id=${entityId}`)
      .then(setSessions);
  }, [entityType, entityId]);

  if (sessions === null) return <div className="card muted">Загрузка…</div>;

  return (
    <div className="card stack">
      <span className="muted">Сессии, в задумке или основных событиях которых упоминается эта сущность.</span>
      {sessions.length === 0 && <p className="muted">Упоминаний пока нет.</p>}
      {sessions.map((s) => (
        <div key={s.id} className="row" style={{ gap: 6 }}>
          <Link to={`/campaigns/${s.campaign_id}`}>{s.campaign_name}</Link>
          <span className="muted">—</span>
          <Link to={`/sessions/${s.id}`}>{sessionLabel(s)}</Link>
          <span className="muted">— {s.date}</span>
        </div>
      ))}
    </div>
  );
}
