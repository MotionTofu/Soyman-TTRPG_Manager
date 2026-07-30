import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EditableTextCard } from "../components/EditableTextCard";
import {
  LocationsPanel,
  PlotCharactersPanel,
  ObstaclesPanel,
  LootPanel,
  RosterPanel,
  SecretsPanel,
  RemindersPanel,
  PlaylistPanel,
  CompendiumPanel,
} from "./sessionLivePanels";
import type { CampaignDetail, Character, Playlist, SessionDetail } from "../types";

export function SessionLivePage() {
  const { id } = useParams();
  const sessionId = Number(id);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [sessionPlaylists, setSessionPlaylists] = useState<Playlist[]>([]);
  const [settingPlaylists, setSettingPlaylists] = useState<Playlist[]>([]);

  const refresh = useCallback(() => {
    api.get<SessionDetail>(`/sessions/${sessionId}`).then((s) => {
      setSession(s);
      api.get<CampaignDetail>(`/campaigns/${s.campaign_id}`).then((c) => {
        setCampaign(c);
        if (c.setting_id) {
          api.get<Playlist[]>(`/playlists?scope=setting&setting_id=${c.setting_id}`).then(setSettingPlaylists);
        }
      });
      api.get<Character[]>(`/characters?campaign_id=${s.campaign_id}`).then(setCharacters);
    });
    api.get<Playlist[]>(`/playlists?scope=session&session_id=${sessionId}`).then(setSessionPlaylists);
  }, [sessionId]);

  useEffect(refresh, [refresh]);

  async function saveIdea(value: string) {
    await api.put(`/sessions/${sessionId}`, { idea_notes: value });
    refresh();
  }

  async function saveBattlePlaylist(playlistId: number | null) {
    await api.put(`/sessions/${sessionId}`, { battle_playlist_id: playlistId });
    refresh();
  }

  async function saveMainEvents(value: string) {
    await api.put(`/sessions/${sessionId}`, { main_events: value });
    refresh();
  }

  async function toggleMainEventsVisible() {
    await api.put(`/sessions/${sessionId}`, { main_events_visible: !session!.main_events_visible });
    refresh();
  }

  if (!session || !campaign) return null;

  const panelProps = { sessionId, session, campaign, characters };

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>
            <Link to={`/campaigns/${campaign.id}`}>{campaign.name}</Link> —{" "}
            {session.title || `Сессия №${session.session_number ?? ""}`}
          </h1>
          <span className={`badge ${session.status}`}>{session.status}</span>
        </div>
        <Link to={`/sessions/${sessionId}`}>← К странице сессии</Link>
      </div>

      <EditableTextCard
        key={`idea-${session.id}`}
        title="Задумка на сессию"
        value={session.idea_notes}
        onSave={saveIdea}
        entityType="session"
        entityId={sessionId}
        collapsible
      >
        <label className="row" style={{ gap: 6, alignItems: "center" }}>
          Плейлист боя:
          <select
            value={session.battle_playlist_id ?? ""}
            onChange={(e) => saveBattlePlaylist(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— не выбран —</option>
            {sessionPlaylists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {settingPlaylists.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} (сеттинг)
              </option>
            ))}
          </select>
        </label>
      </EditableTextCard>

      <EditableTextCard
        key={`events-${session.id}`}
        title="Основные события сессии"
        value={session.main_events}
        onSave={saveMainEvents}
        entityType="session"
        entityId={sessionId}
      >
        <label className="row muted" style={{ gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!session.main_events_visible} onChange={toggleMainEventsVisible} />
          {session.main_events_visible ? "👁 Видно игрокам" : "Видно игрокам"}
        </label>
      </EditableTextCard>

      <div className="row" style={{ alignItems: "flex-start" }}>
        <div className="stack" style={{ flex: 1, minWidth: 260 }}>
          <LocationsPanel {...panelProps} />
          <PlotCharactersPanel {...panelProps} />
          <ObstaclesPanel {...panelProps} />
          <LootPanel {...panelProps} />
          <RosterPanel {...panelProps} />
        </div>

        <div className="stack" style={{ flex: 1, minWidth: 260 }}>
          <SecretsPanel {...panelProps} />
          <RemindersPanel {...panelProps} />
          <PlaylistPanel {...panelProps} />
          <CompendiumPanel {...panelProps} />
        </div>
      </div>
    </div>
  );
}
