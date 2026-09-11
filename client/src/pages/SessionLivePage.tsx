import { useState } from "react";
import { Link, useParams } from "react-router-dom";
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
import { PartyHereStrip } from "../components/PartyHereStrip";
import { useAction, useEntity, useResource, useSaveEntity, write } from "../data/hooks";
import { sessionMoneyAffects, sessionPaths } from "../data/sessions";

// Пустые списки — постоянными ссылками: панели мемоизированы, и новый `[]` на
// каждой отрисовке перерисовывал бы их зря.
const NO_CHARACTERS: Character[] = [];
const NO_PLAYLISTS: Playlist[] = [];
const NO_UNION: SessionUnionRow[] = [];

export function SessionLivePage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  // Всё — из кэша слоя данных (docs/adr/0001). Запуск сцены, правка в другом
  // окне и заявка игрока обновляют задетое сами: счётчик запусков, который
  // раньше тянулся через полстраницы к панелям, больше не нужен.
  const sessionState = useEntity<SessionDetail>("session", sessionId);
  const session = sessionState.data ?? null;
  const campaignState = useEntity<CampaignDetail>("campaign", session?.campaign_id);
  const campaign = campaignState.data ?? null;
  const characters =
    useResource<Character[]>(session ? sessionPaths.campaignCharacters(session.campaign_id) : null).data ??
    NO_CHARACTERS;
  // Боевые темы теперь общие: плейлистов сессии и сеттинга больше нет, и
  // выбирать тему приходится из одного списка, а не из двух.
  const battles = useResource<Playlist[]>(sessionPaths.playlists()).data ?? NO_PLAYLISTS;
  // Объединение зависит и от отметок приключений, и от того, какая сцена идёт
  // (пометка «в сцене»): запуск задевает сессию, и оно перечитывается само.
  const union = useResource<SessionUnionRow[]>(sessionPaths.castUnion(sessionId)).data ?? NO_UNION;

  const { save } = useSaveEntity<SessionDetail>("session", sessionId, {
    affects: session ? [{ path: sessionPaths.campaignSessions(session.campaign_id) }] : [],
  });
  const run = useAction();

  // Текст из карточки: не сохранилось — карточка остаётся в правке с набранным,
  // а плашка предлагает повтор.
  async function saveText(patch: Partial<SessionDetail>) {
    if (!(await save(patch))) throw new Error("Не сохранилось");
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
    if (!session) return;
    const done = await run(
      async () => {
        await write.put(`/sessions/${sessionId}`, { main_events: text, status: "held" });
        return true;
      },
      { affects: sessionMoneyAffects(sessionId, session.campaign_id) }
    );
    if (!done) throw new Error("Не сохранилось");
    if (loadPultFinishAction() === "modal") setOutcomeOpen(true);
  }

  function reload() {
    sessionState.reload();
    campaignState.reload();
  }

  // Немой `return null` оставлял пустую страницу навсегда — и при неверном id,
  // и при упавшем сервере: за столом это белый экран без единого слова.
  let loadError: string | null = null;
  if (!session && sessionState.error != null) {
    loadError = sessionState.error || "Сессия не найдена или сервер не отвечает.";
  } else if (session && !campaign && campaignState.error != null) {
    loadError = campaignState.error || "Кампания сессии не читается.";
  }

  if (loadError) {
    return (
      <div className="stack session-live">
        <div className="card stack" role="alert">
          <strong>Пульт не открылся</strong>
          <span className="muted">{loadError}</span>
          <div className="row" style={{ gap: 8 }}>
            <button className="primary" onClick={reload}>
              Попробовать снова
            </button>
            <Link to={`/sessions/${sessionId}`}>К странице сессии</Link>
          </div>
        </div>
      </div>
    );
  }

  if (!session || !campaign) return <span className="muted">Открываем пульт…</span>;

  const panelProps = { sessionId, session, campaign, characters, union };

  return (
    <div className="stack session-live">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          {/* каркас в обход намеренно — страница не карточка сущности: свой вид, каркас для него ещё не построен */}
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

      {/* Где партия (решения 2026-09-11, §3): между шапкой и переключателем
          сцен — на вопрос «где мы» Мастер отвечает, не отводя глаз от пульта. */}
      <PartyHereStrip sessionId={sessionId} />

      {/* Порядок вечера сверху вниз: где мы во времени → что запускаем → что
          на экране у игроков → с чем сели играть → чем пользуемся.
          Переключатель сцен стоит первым потому, что это главный орган пульта:
          ради него сюда и смотрят, и искать его прокруткой посреди игры
          некогда. Задумка, боевая тема и «Основные события» — под ним: их
          читают редко, а пишут в них под конец. */}
      <SessionTimeStrip session={session} settingId={campaign.setting_id} campaignId={campaign.id} />

      <SceneSwitcher sessionId={sessionId} />

      <PresentationPanel sessionId={sessionId} campaignId={campaign.id} />

      <div className="card row" style={{ gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span className="sp-idea-battle__label">Боевая тема</span>
        <select
          value={session.battle_playlist_id ?? ""}
          onChange={(e) => void save({ battle_playlist_id: e.target.value ? Number(e.target.value) : null })}
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
          onSave={(value) => saveText({ idea_notes: value })}
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
          onSave={(value) => saveText({ main_events: value })}
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
              <input
                type="checkbox"
                checked={!!session.main_events_visible}
                onChange={() => void save({ main_events_visible: session.main_events_visible ? 0 : 1 })}
              />
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
            onInsert={(text) =>
              void save({ main_events: session.main_events ? `${session.main_events}\n${text}` : text })
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
      {outcomeOpen && <SessionOutcomeModal sessionId={sessionId} onClose={() => setOutcomeOpen(false)} />}
    </div>
  );
}
