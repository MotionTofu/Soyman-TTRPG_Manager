import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EditableTextCard } from "../components/EditableTextCard";
import { NavIcon } from "../components/NavIcons";
import { SceneSwitcher } from "../components/SceneSwitcher";
import { SessionTimeStrip } from "../components/SessionTimeStrip";
import { SceneJournal } from "../components/SceneJournal";
import { InitiativeTracker } from "../components/InitiativeTracker";
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
import { sessionLabel } from "../sessionLabel";
import { loadPultFinishAction } from "../pultPrefs";
import { SessionOutcomeModal } from "../components/SessionOutcomeModal";

export function SessionLivePage() {
  const { id } = useParams();
  const sessionId = Number(id);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
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
    let cancelled = false;
    api
      .get<SessionDetail>(`/sessions/${sessionId}`)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        api.get<CampaignDetail>(`/campaigns/${s.campaign_id}`).then((c) => { if (!cancelled) setCampaign(c); }).catch(() => {});
        api.get<Character[]>(`/characters?campaign_id=${s.campaign_id}`).then((ch) => { if (!cancelled) setCharacters(ch); }).catch(() => {});
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    api.get<Playlist[]>("/playlists").then(setBattles).catch(() => setBattles([]));
  }, []);

  // Объединение зависит и от отметок приключений, и от того, какая сцена идёт
  // (пометка «в сцене»), поэтому перечитывается на каждом запуске.
  useEffect(() => {
    api.get<SessionUnionRow[]>(`/sessions/${sessionId}/cast-union`).then(setUnion).catch(() => {});
  }, [sessionId, launches]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh]);

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
  //
  // Про оплату здесь по умолчанию НЕ спрашиваем: пульт закрывают, когда игра
  // только кончилась и все расходятся. Игра уйдёт в плашку неразобранных на
  // Главной и там дождётся. Кому удобнее считать сразу — включает окно во
  // вкладке настроек «Пульт сессии».
  async function finishSession(text: string) {
    await api.put(`/sessions/${sessionId}`, { main_events: text, status: "held" });
    refresh();
    if (loadPultFinishAction() === "modal") setOutcomeOpen(true);
  }

  async function toggleMainEventsVisible() {
    await api.put(`/sessions/${sessionId}`, { main_events_visible: !session!.main_events_visible });
    refresh();
  }

  if (!session || !campaign) return null;

  const panelProps = { sessionId, session, campaign, characters, launches, union, onChanged: refresh };

  return (
    <div className="stack session-live">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <h1>
            <Link to={`/campaigns/${campaign.id}`}>{campaign.name}</Link> —{" "}
            {sessionLabel(session)}
          </h1>
          <span className={`badge ${session.status}`}>{session.status}</span>
        </div>
        <div className="row" style={{ gap: 6, alignItems: "center" }}>
          <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>[ / Х — док · ] / Ъ — поиск · Ctrl+\ — оба</span>
          <Link to={`/sessions/${sessionId}`}>← К странице сессии</Link>
        </div>
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

      <div className="card row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="sp-idea-battle__label">Боевая тема</span>
        <select
          value={session.battle_playlist_id ?? ""}
          onChange={(e) => saveBattlePlaylist(e.target.value ? Number(e.target.value) : null)}
          style={{ flex: 1, minWidth: 160, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}
        >
          <option value="">— из набора —</option>
          {battles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      <div className="session-live-idea-events">
        <EditableTextCard
          key={`idea-${session.id}`}
          title="Задумка на сессию"
          value={session.idea_notes}
          onSave={saveIdea}
          entityType="session"
          entityId={sessionId}
          collapsible
          defaultOpen
        />
        <EditableTextCard
          key={`events-${session.id}`}
          title="Основные события сессии"
          value={session.main_events}
          onSave={saveMainEvents}
          entityType="session"
          entityId={sessionId}
          collapsible
          defaultOpen={!!session.main_events}
          extraAction={
            session.status === "held"
              ? undefined
              : { label: "Сохранить и завершить сессию", onAct: finishSession }
          }
          inlineFooter={
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
        </EditableTextCard>
      </div>

      <SceneSwitcher sessionId={sessionId} onLaunched={() => setLaunches((n) => n + 1)} />

      <div className="card session-live-central-tracker" style={{ padding: 0, overflow: "hidden" }}>
        <div style={{ padding: "7px 12px", background: "var(--surface)", color: "var(--on-surface)", borderBottom: "1px solid var(--surface)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>Трекер инициативы</div>
        <div style={{ padding: 12 }}>
          <InitiativeTracker sessionId={sessionId} />
        </div>
      </div>

      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}><PlotCharactersPanel {...panelProps} /></div>
          <div style={{ flex: 1, minWidth: 260 }}><LocationsPanel {...panelProps} /></div>
        </div>
        <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}><ObstaclesPanel {...panelProps} /></div>
          <div style={{ flex: 1, minWidth: 260 }}><LootPanel {...panelProps} /></div>
        </div>
        <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}><RemindersPanel {...panelProps} /></div>
          <div style={{ flex: 1, minWidth: 260 }}><CompendiumPanel {...panelProps} /></div>
        </div>
        <div className="row" style={{ gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 260 }}><RosterPanel {...panelProps} /></div>
          <div style={{ flex: 1, minWidth: 260 }}><SecretsPanel {...panelProps} /></div>
        </div>
      </div>
      {outcomeOpen && (
        <SessionOutcomeModal
          sessionId={sessionId}
          onClose={() => setOutcomeOpen(false)}
          onSaved={refresh}
        />
      )}
    </div>
  );
}
