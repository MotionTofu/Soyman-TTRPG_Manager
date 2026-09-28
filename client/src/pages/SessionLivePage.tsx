import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EditableTextCard } from "../components/EditableTextCard";
import { SceneSwitcher } from "../components/SceneSwitcher";
import { PresentationPanel } from "../components/presentation/PresentationPanel";
import { SessionTimeStrip } from "../components/SessionTimeStrip";
import { SessionLiveControls } from "../components/SessionLiveControls";
import { PultGrid } from "./PultGrid";
import type { CampaignDetail, Character, SessionDetail, SessionUnionRow } from "../types";
// session.css нужен пульту не меньше cockpit.css: цвета панелей
// (sp-card--plot/location/enemies/loot) и вид их шапок живут там, рядом с
// профилем сессии. Обе страницы — ленивые чанки, поэтому без этой строки
// пульт, открытый напрямую (кнопкой в навигаторе, закладкой, перезагрузкой),
// приезжал без панельных стилей — они появлялись, только если Мастер до
// этого заходил на страницу сессии.
import "../session.css";
import "../cockpit.css";
import { loadPultFinishAction } from "../pultPrefs";
import { SessionOutcomeModal } from "../components/SessionOutcomeModal";
import { useEntity, useResource, useSaveEntity } from "../data/hooks";
import { sessionPaths } from "../data/sessions";

// Пустые списки — постоянными ссылками: панели мемоизированы, и новый `[]` на
// каждой отрисовке перерисовывал бы их зря.
const NO_CHARACTERS: Character[] = [];
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
  // Объединение зависит и от отметок приключений, и от того, какая сцена идёт
  // (пометка «в сцене»): запуск задевает сессию, и оно перечитывается само.
  const union = useResource<SessionUnionRow[]>(sessionPaths.castUnion(sessionId)).data ?? NO_UNION;

  const { save } = useSaveEntity<SessionDetail>("session", sessionId, {
    affects: session ? [{ path: sessionPaths.campaignSessions(session.campaign_id) }] : [],
  });

  // Текст из карточки: не сохранилось — карточка остаётся в правке с набранным,
  // а плашка предлагает повтор.
  async function saveText(patch: Partial<SessionDetail>) {
    if (!(await save(patch))) throw new Error("Не сохранилось");
  }

  // «Завершить» (SessionLiveControls) делает сессию проведённой. Про оплату
  // здесь по умолчанию НЕ спрашиваем: пульт закрывают, когда игра только
  // кончилась и все расходятся. Игра уйдёт в плашку неразобранных на Главной
  // и там дождётся. Кому удобнее считать сразу — включает окно во вкладке
  // настроек «Пульт сессии».
  function onFinished() {
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
      {/* Порядок вечера сверху вниз: где мы во времени → что запускаем → что
          на экране у игроков → с чем сели играть → чем пользуемся.
          Переключатель сцен стоит первым потому, что это главный орган пульта:
          ради него сюда и смотрят, и искать его прокруткой посреди игры
          некогда. Задумка — под ним. Лента сессии живёт в правой панели,
          пока сессия идёт: писать в неё можно с любой страницы. Боевая
          тема — кнопкой в трекере инициативы, рядом со своим событием. */}
      <div className="row session-live-top">
        <SessionTimeStrip session={session} settingId={campaign.setting_id} campaignId={campaign.id} />
        <SessionLiveControls session={session} onFinished={onFinished} />
      </div>

      <SceneSwitcher sessionId={sessionId} />

      <PresentationPanel sessionId={sessionId} campaignId={campaign.id} />

      {/* Блоки контента — на сетке GridStack (таскаются за шапку, раскладка
          запоминается): задумка/события + 8 панелей. Время, сцены и показ
          выше — вне сетки, статично. */}
      <PultGrid
        panelProps={panelProps}
        ideaCard={
          <EditableTextCard
            key={`idea-${session.id}`}
            title="Задумка на сессию"
            draftKey={`session-idea-${sessionId}`}
            value={session.idea_notes}
            onSave={(value) => saveText({ idea_notes: value })}
            entityType="session"
            entityId={sessionId}
            serverSyncsMentions
            collapsible
            defaultOpen
            summaryClassName="pult-drag-handle"
          />
        }
      />
      {outcomeOpen && <SessionOutcomeModal sessionId={sessionId} onClose={() => setOutcomeOpen(false)} />}
    </div>
  );
}
