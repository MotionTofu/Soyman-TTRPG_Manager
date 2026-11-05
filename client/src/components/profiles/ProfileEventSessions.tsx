import { Link } from "react-router-dom";
import type { ChronicleSession } from "../../types";
import { sessionLabel } from "../../sessionLabel";
import { ProfileBlock } from "./ProfileParts";

export function ProfileEventSessions({ sessions }: { sessions?: ChronicleSession[] }) {
  if (!sessions?.length) return null;
  return <ProfileBlock title="Сессия" count={sessions.length}>
    {sessions.map((s) => <div className="profile-game-row" key={s.link_id}><span className="d-note">{s.date}</span><Link to={`/sessions/${s.id}`}>{sessionLabel(s)}</Link></div>)}
  </ProfileBlock>;
}
