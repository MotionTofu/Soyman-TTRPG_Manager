import { Link } from "react-router-dom";
import { parseMentions, formatMentionToken, LEGACY_MENTION_RE } from "../../mentions";
import { DETAIL_ROUTES } from "../../entityTypes";
import type { CampaignCalendarEvent } from "../../types";
import { MentionText } from "../mentions/MentionText";
import { TypeGlyph } from "../TypeGlyph";

// Логика строки из codex/campaign-chronicle: отношения, иначе упоминания.
export function EventParticipants({ event }: { event: CampaignCalendarEvent }) {
  const mentioned = parseMentions(event.description).map((mention) => ({
    type: mention.type, id: 0, name: mention.label,
    token: formatMentionToken(mention.type, mention.uid, mention.source, mention.label),
  }));
  const legacy = [...event.description.matchAll(LEGACY_MENTION_RE)].map((match) => ({ type: match[1], id: Number(match[2]), name: match[3] }));
  const participants: { type: string; id: number; name: string; token?: string }[] = event.participants?.length ? event.participants : [...mentioned, ...legacy];
  const unique = participants.filter((p, index) => participants.findIndex((other) => (p.token ? other.token === p.token : other.type === p.type && other.id === p.id)) === index);
  if (!unique.length && !event.sessions?.length && event.source !== "setting") return null;
  const numbers = [...new Set(event.sessions?.map((session) => session.session_number) ?? [])].sort((a, b) => a - b);
  const range = numbers.length > 1 && numbers.length === numbers.at(-1)! - numbers[0] + 1;
  const sessionLabel = numbers.length === 1 ? `Сессия №${numbers[0]}` : `№${range ? `${numbers[0]}–${numbers.at(-1)}` : numbers.join(", ")}`;
  return <span className="chr-ev__meta">
    {unique.slice(0, 2).map((p) => <span className="chr-participant" key={p.token ?? `${p.type}:${p.id}`}>
      <TypeGlyph type={p.type} />
      {p.token ? <MentionText text={p.token} /> : DETAIL_ROUTES[p.type]
        ? <Link to={`${DETAIL_ROUTES[p.type]}/${p.id}`}>{p.name}</Link> : p.name}
    </span>)}
    {unique.length > 2 && <span>+{unique.length - 2}</span>}
    {!!numbers.length && <Link className="chr-tag" to={`/sessions/${event.sessions![0].id}`} title={event.sessions!.map((session) => `Сессия №${session.session_number}`).join(" · ")}>{sessionLabel}</Link>}
    {event.source === "setting" && <span className="chr-tag">мир</span>}
  </span>;
}
