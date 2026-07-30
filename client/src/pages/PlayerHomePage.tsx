import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { MonthCalendar, type CalendarEvent } from "../components/MonthCalendar";
import { SectionHeading } from "../components/SectionHeading";
import { loadHideFinance } from "../financePrivacy";

interface DashboardSession {
  id: number;
  campaign_id: number;
  campaign_name: string;
  date: string;
  title: string | null;
  start_time: string | null;
  status: "planned" | "held" | "cancelled" | "rescheduled";
}

interface UnpaidSession {
  session_id: number;
  campaign_id: number;
  campaign_name: string;
  date: string;
  title: string | null;
  expected: number;
  paid: number;
}

interface GmReminder {
  id: number;
  target_type: "player" | "campaign";
  target_id: number;
  message: string;
  created_at: string;
}

interface Dashboard {
  unpaidSessions: UnpaidSession[];
  reminders: GmReminder[];
  sessions: DashboardSession[];
}

// Player-role replacement for the GM's HomeCalendarPage — the GM version
// reads /calendar and /finance/summary, both gated to gm role (see
// server/src/services/playerAccess.ts), so a player account got a blank
// page there. This reads /player/dashboard instead, same endpoint
// player-app's Главная uses.
export function PlayerHomePage() {
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    api.get<Dashboard>("/player/dashboard").then(setDashboard);
  }, []);

  if (!dashboard) return <p className="muted">Загрузка…</p>;

  const { unpaidSessions, reminders, sessions } = dashboard;

  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    label: s.campaign_name,
    startTime: s.start_time,
  }));

  return (
    <div className="stack">
      <SectionHeading>Главная</SectionHeading>

      {reminders.length > 0 && (
        <div className="stack">
          {reminders.map((r) => (
            <div key={r.id} className="card" style={{ gap: 4, borderLeft: "3px solid var(--accent)" }}>
              <span className="muted">
                {r.target_type === "campaign" ? "Напоминание по кампании" : "Напоминание от мастера"}
              </span>
              <div style={{ whiteSpace: "pre-wrap" }}>{r.message}</div>
            </div>
          ))}
        </div>
      )}

      <MonthCalendar
        events={events}
        onDayClick={() => {}}
        onEventClick={(e) => navigate(`/campaigns/${sessions.find((s) => s.id === e.id)!.campaign_id}`)}
      />

      {!loadHideFinance() && unpaidSessions.length > 0 && (
        <div className="stack">
          <strong>Не оплачено</strong>
          {unpaidSessions.map((s) => (
            <div key={s.session_id} className="card stack" style={{ gap: 4, borderLeft: "3px solid #e07a5f" }}>
              <Link to={`/campaigns/${s.campaign_id}`}>
                {s.date} — {s.campaign_name}
                {s.title && ` (${s.title})`}
              </Link>
              <span className="muted">
                Оплачено {s.paid} из {s.expected}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
