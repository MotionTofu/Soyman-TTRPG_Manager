import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EditableTextCard } from "../components/EditableTextCard";
import { NavIcon } from "../components/NavIcons";
import { SceneSwitcher } from "../components/SceneSwitcher";
import { SessionTimeStrip } from "../components/SessionTimeStrip";
import { SceneJournal } from "../components/SceneJournal";
import {
  LocationsPanel,
  PlotCharactersPanel,
  ObstaclesPanel,
  LootPanel,
  RosterPanel,
  SecretsPanel,
  RemindersPanel,
  CompendiumPanel,
} from "./sessionLivePanels";
import type { CampaignDetail, Character, Playlist, SessionDetail, SessionUnionRow } from "../types";
import "../cockpit.css";

export function SessionLivePage() {
  const { id } = useParams();
  const sessionId = Number(id);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const [characters, setCharacters] = useState<Character[]>([]);
  // Боевые темы теперь общие: плейлистов сессии и сеттинга больше нет, и
  // выбирать тему приходится из одного списка, а не из двух.
  const [battles, setBattles] = useState<Playlist[]>([]);
  // Запуск сцены меняет и ленту вечера, и панели, а они живут ниже
  // переключателя и о нём не знают. Счётчик — самый дешёвый способ сказать им
  // «перечитайте», не таща состояние пульта через полстраницы.
  const [launches, setLaunches] = useState(0);
  const [union, setUnion] = useState<SessionUnionRow[]>([]);

  const refresh = useCallback(() => {
    api.get<SessionDetail>(`/sessions/${sessionId}`).then((s) => {
      setSession(s);
      api.get<CampaignDetail>(`/campaigns/${s.campaign_id}`).then(setCampaign);
      api.get<Character[]>(`/characters?campaign_id=${s.campaign_id}`).then(setCharacters);
    });
    api.get<Playlist[]>("/playlists").then(setBattles);
  }, [sessionId]);

  // Объединение зависит и от отметок приключений, и от того, какая сцена идёт
  // (пометка «в сцене»), поэтому перечитывается на каждом запуске.
  useEffect(() => {
    api.get<SessionUnionRow[]>(`/sessions/${sessionId}/cast-union`).then(setUnion);
  }, [sessionId, launches]);

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

  // «Сохранить и завершить сессию» — одна кнопка вместо двух шагов: записать
  // итог и пойти в профиль ставить статус. Без подтверждения: статус правится
  // там же обратно, а лишний вопрос за столом это лишняя секунда.
  async function finishSession(text: string) {
    await api.put(`/sessions/${sessionId}`, { main_events: text, status: "held" });
    refresh();
  }

  async function toggleMainEventsVisible() {
    await api.put(`/sessions/${sessionId}`, { main_events_visible: !session!.main_events_visible });
    refresh();
  }

  if (!session || !campaign) return null;

  const panelProps = { sessionId, session, campaign, characters, launches, union };

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

      {/* Порядок вечера сверху вниз: где мы во времени → с чем сели играть →
          что запускаем → чем пользуемся → что записали. «Основные события»
          внизу потому, что это итог, а не начало: их заполняют под конец. */}
      <SessionTimeStrip
        session={session}
        settingId={campaign.setting_id}
        campaignId={campaign.id}
        onChanged={refresh}
      />

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
          Боевая тема:
          <select
            value={session.battle_playlist_id ?? ""}
            onChange={(e) => saveBattlePlaylist(e.target.value ? Number(e.target.value) : null)}
          >
            <option value="">— не выбран —</option>
            {battles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
      </EditableTextCard>

      <SceneSwitcher sessionId={sessionId} onLaunched={() => setLaunches((n) => n + 1)} />

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
          <CompendiumPanel {...panelProps} />
        </div>
      </div>

      <EditableTextCard
        key={`events-${session.id}`}
        title="Основные события сессии"
        value={session.main_events}
        onSave={saveMainEvents}
        entityType="session"
        entityId={sessionId}
        extraAction={
          session.status === "held"
            ? undefined
            : { label: "Сохранить и завершить сессию", onAct: finishSession }
        }
      >
        <SceneJournal
          sessionId={sessionId}
          version={launches}
          onInsert={(text) =>
            saveMainEvents(session.main_events ? `${session.main_events}
${text}` : text)
          }
        />
        <label className="row muted" style={{ gap: 6, alignItems: "center" }}>
          <input type="checkbox" checked={!!session.main_events_visible} onChange={toggleMainEventsVisible} />
          {session.main_events_visible ? (
            <>
              <NavIcon name="eye" /> Видно игрокам
            </>
          ) : (
            "Видно игрокам"
          )}
        </label>
      </EditableTextCard>
    </div>
  );
}
