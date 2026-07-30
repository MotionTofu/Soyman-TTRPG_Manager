import { useEffect, useState } from "react";
import type { CalendarSession, Campaign } from "./types";

interface Props {
  campaign: Campaign;
  onOpenSession: (session: CalendarSession) => void;
  onOpenCompendium: () => void;
  onOpenBeings: () => void;
  onOpenImages: () => void;
}

export function CampaignView({ campaign, onOpenSession, onOpenCompendium, onOpenBeings, onOpenImages }: Props) {
  const [sessions, setSessions] = useState<CalendarSession[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    window.gmApp
      .apiGet<CalendarSession[]>("/api/calendar")
      .then((all) => setSessions(all.filter((s) => s.campaign_id === campaign.id)))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [campaign.id]);

  return (
    <div className="stack">
      <h2 style={{ margin: 0 }}>{campaign.name}</h2>

      <div className="row">
        {campaign.system_id && <button onClick={onOpenCompendium}>📖 Компендиум</button>}
        {campaign.setting_id && <button onClick={onOpenBeings}>🐉 Бестиарий</button>}
        {campaign.setting_id && <button onClick={onOpenImages}>🖼 Показать изображение</button>}
      </div>

      <div className="card stack">
        <strong className="entry-title">Сессии</strong>
        {error && <p className="error">{error}</p>}
        {!sessions && !error && <p className="muted">Загрузка…</p>}
        {sessions?.length === 0 && <p className="muted">Сессий пока нет.</p>}
        {sessions
          ?.slice()
          .sort((a, b) => (a.date < b.date ? 1 : -1))
          .map((s) => (
            <button key={s.id} onClick={() => onOpenSession(s)} style={{ alignSelf: "flex-start" }}>
              {s.date} {s.title && `— ${s.title}`}
            </button>
          ))}
      </div>
    </div>
  );
}
