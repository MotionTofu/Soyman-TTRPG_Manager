import { useState } from "react";
import { Link } from "react-router-dom";
import { useResource } from "../../data/hooks";
import { useSettingCalendar } from "../../hooks/useSettingCalendar";
import type { CampaignCalendarEvent, SessionDetail } from "../../types";
import { ChronicleEventModal } from "./ChronicleEventModal";
import "./chronicle.css";

export function SessionChronicleEvents({ session, campaignId, settingId }: { session: SessionDetail; campaignId: number; settingId: number | null }) {
  const events = useResource<CampaignCalendarEvent[]>(`/sessions/${session.id}/calendar-events`);
  const calendar = useSettingCalendar(settingId);
  const [creating, setCreating] = useState(false);
  return <section className="d-block chr-session-events">
    <div className="row"><h3>События мира</h3><button className="d-btn" onClick={() => setCreating(true)}>+ Событие мира</button></div>
    {events.error ? <p role="alert">{events.error}<button className="d-btn" onClick={events.reload}>Повторить</button></p> : events.data?.length
      ? <ul>{events.data.map((event) => <li key={`${event.source}:${event.id}`}><Link to={`/${event.source === "setting" ? "events" : "campaign-events"}/${event.id}`}>{event.title}</Link></li>)}</ul>
      : <p className="muted">С этой сессией пока не связаны события мира.</p>}
    {creating && <ChronicleEventModal campaignId={campaignId} settingId={settingId} calendar={calendar} sessionId={session.id}
      date={{ year: session.inworld_year ?? 1, month: session.inworld_month ?? 1, day: session.inworld_day ?? 1 }} onClose={() => setCreating(false)} />}
  </section>;
}
