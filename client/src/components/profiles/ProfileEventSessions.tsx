import { Link } from "react-router-dom";
import type { ChronicleSession } from "../../types";
import { sessionLabel } from "../../sessionLabel";
import { ProfileBlock } from "./ProfileParts";
import { ProfileTypeGlyph } from "./ProfileParts";
import { formatDateKeyRu } from "../../utils/date";

export function ProfileEventSessions({ sessions }: { sessions?: ChronicleSession[] }) {
  if (!sessions?.length) return null;
  return <ProfileBlock title="Сессия" count={sessions.length}>
    {sessions.map((s) => <div className="profile-session-row" key={s.link_id}><ProfileTypeGlyph type="session" /><div><div className="row">Сессия №{s.session_number} · {formatDateKeyRu(s.date.slice(0,10))} · <span className="gch">{s.status === "held" ? "проведена" : s.status === "cancelled" ? "отменена" : "запланирована"}</span></div><small>событие отмечено на этой сессии</small>{s.title && <small>{s.title}</small>}</div><Link to={`/sessions/${s.id}`} aria-label={`Открыть ${sessionLabel(s)}`}>Открыть ›</Link></div>)}
  </ProfileBlock>;
}
