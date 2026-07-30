import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api } from "../api/client";
import { MentionText } from "../components/mentions/MentionText";
import type {
  SettingPlayerBeing,
  SettingPlayerChronicleEvent,
  SettingPlayerCommunity,
  SettingPlayerLocation,
} from "../types";

function formatDate(y: number, m: number, d: number): string {
  return `${d}.${m}.${y}`;
}

interface PlayerSettingDetail {
  setting: { id: number; name: string };
  locations: SettingPlayerLocation[];
  beings: SettingPlayerBeing[];
  communities: SettingPlayerCommunity[];
  chronicleEvents: SettingPlayerChronicleEvent[];
}

// Player-role setting view — what's been revealed across every campaign of
// theirs that uses this setting (grants are per campaign+player, a location
// can be shown in one campaign and hidden in another sharing the same
// setting; see GET /api/player/settings/:id for the union logic).
export function PlayerSettingPage() {
  const { id } = useParams();
  const settingId = Number(id);
  const [data, setData] = useState<PlayerSettingDetail | null>(null);

  useEffect(() => {
    api.get<PlayerSettingDetail>(`/player/settings/${settingId}`).then(setData);
  }, [settingId]);

  if (!data) return <p className="muted">Загрузка…</p>;

  const nothingVisible =
    data.locations.length === 0 &&
    data.beings.length === 0 &&
    data.communities.length === 0 &&
    data.chronicleEvents.length === 0;

  return (
    <div className="stack">
      <h1 style={{ margin: 0 }}>{data.setting.name}</h1>
      {nothingVisible && <p className="muted">Мастер пока ничего не открыл игрокам в этом сеттинге.</p>}

      {data.locations.length > 0 && (
        <div className="card stack">
          <strong className="entry-title">Локации</strong>
          {data.locations.map((l) => (
            <div key={l.id} className="stack" style={{ gap: 2 }}>
              <strong>{l.name}</strong>
              {l.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={l.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {(data.beings.length > 0 || data.communities.length > 0) && (
        <div className="card stack">
          <strong className="entry-title">Личности и фракции</strong>
          {data.beings.map((b) => (
            <div key={`being-${b.id}`} className="stack" style={{ gap: 2 }}>
              <strong>{b.name}</strong>
              {b.history && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={b.history} />
                </div>
              )}
            </div>
          ))}
          {data.communities.map((c) => (
            <div key={`community-${c.id}`} className="stack" style={{ gap: 2 }}>
              <strong>{c.name}</strong>
              {c.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={c.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {data.chronicleEvents.length > 0 && (
        <div className="card stack">
          <strong className="entry-title">История</strong>
          {data.chronicleEvents.map((e) => (
            <div key={e.id} className="stack" style={{ gap: 2 }}>
              <span>
                {formatDate(e.inworld_year, e.inworld_month, e.inworld_day)} — <strong>{e.title}</strong>
              </span>
              {e.description && (
                <div className="muted" style={{ whiteSpace: "pre-wrap" }}>
                  <MentionText text={e.description} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
