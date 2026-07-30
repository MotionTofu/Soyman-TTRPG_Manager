import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";

interface MyCharacter {
  id: number;
  character_name: string;
  campaign_id: number | null;
  campaign_name: string | null;
}

interface PlayerMe {
  characters: MyCharacter[];
}

// Player-role replacement for the GM's CampaignsListPage — just the
// campaigns this player actually has a character in, derived from
// /api/player/me (the same endpoint MyCharactersPage uses).
export function PlayerCampaignsListPage() {
  const [campaigns, setCampaigns] = useState<{ id: number; name: string }[] | null>(null);

  useEffect(() => {
    api.get<PlayerMe>("/player/me").then((me) => {
      const seen = new Map<number, string>();
      for (const c of me.characters) {
        if (c.campaign_id != null) seen.set(c.campaign_id, c.campaign_name ?? "");
      }
      setCampaigns([...seen.entries()].map(([id, name]) => ({ id, name })));
    });
  }, []);

  if (!campaigns) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <h1>Кампании</h1>
      {campaigns.length === 0 && <p className="muted">Вы пока не состоите ни в одной кампании.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {campaigns.map((c) => (
          <Link key={c.id} to={`/campaigns/${c.id}`} className="card row" style={{ textDecoration: "none" }}>
            <strong>{c.name}</strong>
          </Link>
        ))}
      </div>
    </div>
  );
}
