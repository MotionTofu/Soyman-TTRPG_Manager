import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api/client";
import { EditableTextCard } from "../components/EditableTextCard";
import { NavIcon } from "../components/NavIcons";
import { SceneSwitcher } from "../components/SceneSwitcher";
import { PresentationPanel } from "../components/presentation/PresentationPanel";
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
// session.css нужен пульту не меньше cockpit.css: цвета панелей
// (sp-card--plot/location/enemies/loot) и вид их шапок живут там, рядом с
// профилем сессии. Обе страницы — ленивые чанки, поэтому без этой строки
// пульт, открытый напрямую (кнопкой в навигаторе, закладкой, перезагрузкой),
// приезжал без панельных стилей — они появлялись, только если Мастер до
// этого заходил на страницу сессии.
import "../session.css";
import "../cockpit.css";
import { sessionLabel } from "../sessionLabel";
import { loadPultFinishAction } from "../pultPrefs";
import { SessionOutcomeModal } from "../components/SessionOutcomeModal";

function errorText(e: unknown, fallback: string): string {
  const message = e instanceof Error ? e.message : "";
  return message || fallback;
}

export function SessionLivePage() {
  const { id } = useParams();
  const sessionId = Number(id);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    setLoadError(null);
    api
      .get<SessionDetail>(`/sessions/${sessionId}`)
      .then((s) => {
        if (cancelled) return;
        setSession(s);
        api
          .get<CampaignDetail>(`/campaigns/${s.campaign_id}`)
          .then((c) => { if (!cancelled) setCampaign(c); })
          .catch((e) => { if (!cancelled) setLoadError(errorText(e, "Кампания сессии не читается.")); });
        api.get<Character[]>(`/characters?campaign_id=${s.campaign_id}`).then((ch) => { if (!cancelled) setCharacters(ch); }).catch(() => {});
      })
      .catch((e) => {
        if (!cancelled) setLoadError(errorText(e, "Сессия не найдена или сервер не отвечает."));
      });
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

  // Немой `return null` оставлял пустую страницу навсегда — и при неверном id,
  // и при упавшем сервере: за столом это белый экран без единого слова.
  if (loadError) {
    return (
      <div className="stack session-live">
        <div className="card stack" role="alert">
          <strong>Пульт не открылся</strong>
          <span className="muted">{loadError}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={refresh}>
              Попробовать снова
            </button>
            <Link to={`/sessions/${sessionId}`}>К странице сессии</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!session || !campaign) return <span className="muted">Открываем пульт…</span>;

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

      {/* Порядок вечера сверху вниз: где мы во времени → что запускаем → что
          на экране у игроков → с чем сели играть → чем пользуемся.
          Переключатель сцен стоит первым потому, что это главный орган пульта:
          ради него сюда и смотрят, и искать его прокруткой посреди игры
          некогда. Задумка, боевая тема и «Основные события» — под ним: их
          читают редко, а пишут в них под конец. */}
      <SessionTimeStrip
        session={session}
        settingId={campaign.setting_id}
        campaignId={campaign.id}
        onChanged={refresh}
      />

      <SceneSwitcher sessionId={sessionId} onLaunched={() => setLaunches((n) => n + 1)} />

      <PresentationPanel sessionId={sessionId} campaignId={campaign.id} launches={launches} />

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
          draftKey={`session-idea-${sessionId}`}
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
          draftKey={`session-main-events-${sessionId}`}
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

      {/* Трекер инициативы живёт в правой панели (SearchPanel) и только там.
          Здесь стояла его вторая копия: на широком экране она пряталась через
          display:none, а на узком показывалась — и обе висели в DOM
          одновременно, с независимым состоянием. Правка хитов в одной во
          второй не появлялась, подсветка текущего хода расходилась. На узком
          экране панель открывается кнопкой поиска в шапке (или «]»). */}

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
