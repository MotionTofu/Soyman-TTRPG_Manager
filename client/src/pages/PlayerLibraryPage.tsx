import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { SectionHeading } from "../components/SectionHeading";
import { formatNearestDate } from "../nearestDate";

interface MyCharacter {
  id: number;
  character_name: string;
  campaign_id: number | null;
  campaign_name: string | null;
}

interface UpcomingSession {
  id: number;
  campaign_id: number;
  campaign_name: string;
  date: string;
}

interface NameOnly {
  id: number;
  name: string;
}

// Player-role equivalent of the GM's LibraryPage — same "Ближайшая сессия" +
// Кампании/Сеттинги/Системы layout, but sourced from /api/player/* (the
// only endpoints a player token can call — see services/playerAccess.ts)
// instead of the unscoped /campaigns, /settings, /systems the GM page uses.
// No thumbnails here since the player-scoped endpoints don't return them
// (same reduced shape PlayerCampaignsListPage/PlayerSettingsListPage use).
export function PlayerLibraryPage() {
  const [campaigns, setCampaigns] = useState<{ id: number; name: string }[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingSession[]>([]);
  const [settings, setSettings] = useState<NameOnly[]>([]);
  const [systems, setSystems] = useState<NameOnly[]>([]);

  useEffect(() => {
    api.get<{ characters: MyCharacter[] }>("/player/me").then((me) => {
      const seen = new Map<number, string>();
      for (const c of me.characters) {
        if (c.campaign_id != null) seen.set(c.campaign_id, c.campaign_name ?? "");
      }
      setCampaigns([...seen.entries()].map(([id, name]) => ({ id, name })));
    });
    api.get<{ upcomingSessions: UpcomingSession[] }>("/player/dashboard").then((d) => setUpcoming(d.upcomingSessions));
    api.get<NameOnly[]>("/player/settings").then(setSettings);
    api.get<NameOnly[]>("/player/systems").then(setSystems);
  }, []);

  // One highlight row per campaign that has an upcoming session (nearest one only).
  const nearestByCampaign = new Map<number, UpcomingSession>();
  for (const s of upcoming) {
    if (!nearestByCampaign.has(s.campaign_id)) nearestByCampaign.set(s.campaign_id, s);
  }

  return (
    <div className="stack">
      <SectionHeading>Библиотека</SectionHeading>

      {nearestByCampaign.size > 0 && (
        <div className="stack" style={{ gap: 4 }}>
          <div className="player-list-letter">Ближайшая сессия</div>
          <div className="card stack" style={{ gap: 0 }}>
            {[...nearestByCampaign.values()].map((s) => (
              <Link
                key={s.campaign_id}
                to={`/campaigns/${s.campaign_id}`}
                className="row player-list-row player-list-row-upcoming"
              >
                <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                  <strong>{s.campaign_name}</strong>
                  <div className="muted player-list-notes-preview">{formatNearestDate(s.date)}</div>
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      <div className="stack" style={{ gap: 4 }}>
        <div className="player-list-letter">Кампании</div>
        <div className="card stack" style={{ gap: 0 }}>
          {campaigns.map((c) => (
            <Link key={c.id} to={`/campaigns/${c.id}`} className="row player-list-row">
              <strong>{c.name}</strong>
            </Link>
          ))}
          {campaigns.length === 0 && <p className="muted">Вы пока не состоите ни в одной кампании.</p>}
        </div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="player-list-letter">Сеттинги</div>
        <div className="card stack" style={{ gap: 0 }}>
          {settings.map((s) => (
            <Link key={s.id} to={`/settings/${s.id}`} className="row player-list-row">
              <strong>{s.name}</strong>
            </Link>
          ))}
          {settings.length === 0 && <p className="muted">Ваши кампании пока не привязаны к сеттингу.</p>}
        </div>
      </div>

      <div className="stack" style={{ gap: 4 }}>
        <div className="player-list-letter">Системы</div>
        <div className="card stack" style={{ gap: 0 }}>
          {systems.map((s) => (
            <Link key={s.id} to={`/systems/${s.id}`} className="row player-list-row">
              <strong>{s.name}</strong>
            </Link>
          ))}
          {systems.length === 0 && <p className="muted">Пока нет систем.</p>}
        </div>
      </div>
    </div>
  );
}
