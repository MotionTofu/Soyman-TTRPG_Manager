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
  player: { id: number; name: string } | null;
  characters: MyCharacter[];
}

// Player-role replacement for the GM's "Игроки" section: the logged-in
// player's own characters, sourced from the player-scoped API (the general
// /api/characters routes are GM-only).
export function MyCharactersPage() {
  const [me, setMe] = useState<PlayerMe | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api
      .get<PlayerMe>("/player/me")
      .then(setMe)
      .catch((e) => setError(String(e)));
  }, []);

  if (error) return <p className="error">Не удалось загрузить персонажей: {error}</p>;
  if (!me) return <p className="muted">Загрузка…</p>;

  return (
    <div className="stack">
      <h1>Персонажи</h1>
      {me.characters.length === 0 && <p className="muted">У вас пока нет персонажей.</p>}
      <div className="stack" style={{ gap: 8 }}>
        {me.characters.map((c) => (
          <Link key={c.id} to={`/characters/${c.id}`} className="card row" style={{ textDecoration: "none", gap: 12 }}>
            <strong>{c.character_name}</strong>
            <span className="muted">{c.campaign_name ?? "без кампании"}</span>
          </Link>
        ))}
      </div>
    </div>
  );
}
