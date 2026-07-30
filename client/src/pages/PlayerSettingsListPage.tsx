import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface SettingSummary {
  id: number;
  name: string;
}

// Player-role replacement for the GM's SettingsListPage — just the settings
// used by campaigns this player is actually in (see /api/player/settings).
export function PlayerSettingsListPage() {
  const [settings, setSettings] = useState<SettingSummary[] | null>(null);

  useEffect(() => {
    api.get<SettingSummary[]>("/player/settings").then(setSettings);
  }, []);

  if (!settings) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <h1>Сеттинги</h1>
      {settings.length === 0 && <p className="muted">Ваши кампании пока не привязаны к сеттингу.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {settings.map((s) => (
          <Link key={s.id} to={`/settings/${s.id}`} className="card row" style={{ textDecoration: "none" }}>
            <strong>{s.name}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
