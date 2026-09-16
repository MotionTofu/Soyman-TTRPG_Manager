import { Link } from "react-router-dom";
import { useResource } from "../data/hooks";
import type { MentioningSession } from "../types";
import { sessionLabel } from "../sessionLabel";

// "Упоминания" tab for Being/Location/Community/Artifact pages: lists every
// session whose Задумка/Основные события text @-mentions this entity.
export function MentionsTab({ entityType, entityId }: { entityType: string; entityId: number }) {
  const state = useResource<MentioningSession[]>(`/links/mentioning-sessions?type=${entityType}&id=${entityId}`);
  const sessions = state.data;

  if (state.error && !sessions) {
    return (
      <div className="card row">
        <span className="muted">Не удалось загрузить упоминания: {state.error}</span>
        <button onClick={state.reload}>Повторить</button>
      </div>
    );
  }
  if (!sessions) return <div className="card muted">Загрузка…</div>;

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
