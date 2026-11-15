import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { EditableTextCard } from "../components/EditableTextCard";
import { BagRulesControl } from "../components/BagRulesControl";
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
import { CombatMode } from "../combat/CombatMode";
import { setCombatModeOpen, useCombatModeOpen } from "../combat/combatModeStore";
import { ContextMenu } from "../components/ContextMenu";
import { requestPultGridReset } from "../pultGridReset";
import { sessionPaths } from "../data/sessions";
import { isAtTable } from "../characterStatus";
import { LitmConflictMode, LitmRibbonTarget } from "../components/litm/pult/LitmConflictMode";
import { useSessionSystemCode } from "../components/litm/pult/useLitmRibbon";

// Пустые списки — постоянными ссылками: панели мемоизированы, и новый `[]` на
// каждой отрисовке перерисовывал бы их зря.
const NO_CHARACTERS: Character[] = [];
const NO_UNION: SessionUnionRow[] = [];

/** «YYYY-MM-DD HH:MM:SS» в UTC (SQLite datetime('now')) → Date. */
function fromSqlUtc(s: string): Date {
  return new Date(`${s.replace(" ", "T")}Z`);
}

/**
 * Таймер «За столом» (рестайл «Д», Q9): сколько идёт игра и с какого часа.
 * Без паузы — перерыв за столом тоже время вечера. Минутной точности хватает,
 * поэтому тик раз в 20 секунд.
 */
function PultTimer({ session }: { session: SessionDetail }) {
  const [now, setNow] = useState(() => Date.now());
  const running = !!session.live_mode && !!session.live_started_at;
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 20_000);
    return () => clearInterval(id);
  }, [running]);
  if (!running) {
    return (
      <div className="pult-clock__cell">
        <small className="pult-clock__label">За столом</small>
        <b className="pult-clock__time">—</b>
      </div>
    );
  }
  const started = fromSqlUtc(session.live_started_at!);
  const mins = Math.max(0, Math.floor((now - started.getTime()) / 60_000));
  const since = started.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  return (
    <>
      <div className="pult-clock__cell">
        <small className="pult-clock__label">За столом</small>
        <b className="pult-clock__time">
          {Math.floor(mins / 60)}:{String(mins % 60).padStart(2, "0")}
        </b>
      </div>
      <span className="pult-clock__live">
        <i aria-hidden="true" />
        {session.live_mode === "rehearsal" ? "ПРОГОН" : "ИДЁТ"} С {since}
      </span>
    </>
  );
}

export function SessionLivePage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const [outcomeOpen, setOutcomeOpen] = useState(false);
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const moreRef = useRef<HTMLButtonElement>(null);

  // Всё — из кэша слоя данных (docs/adr/0001). Запуск сцены, правка в другом
  // окне и заявка игрока обновляют задетое сами: счётчик запусков, который
  // раньше тянулся через полстраницы к панелям, больше не нужен.
  const sessionState = useEntity<SessionDetail>("session", sessionId);
  const session = sessionState.data ?? null;
  const combatMode = useCombatModeOpen(sessionId, !!session?.combat_active);
  const campaignState = useEntity<CampaignDetail>("campaign", session?.campaign_id);
  const campaign = campaignState.data ?? null;
  const allCharacters =
    useResource<Character[]>(session ? sessionPaths.campaignCharacters(session.campaign_id) : null).data ??
    NO_CHARACTERS;
  // Партия стола — без запасных, погибших и ушедших (гриллинг «Партия», Q26).
  const characters = useMemo(() => allCharacters.filter(isAtTable), [allCharacters]);
  // Объединение зависит и от отметок приключений, и от того, какая сцена идёт
  // (пометка «в сцене»): запуск задевает сессию, и оно перечитывается само.
  const union = useResource<SessionUnionRow[]>(sessionPaths.castUnion(sessionId)).data ?? NO_UNION;
  // Кампания LitM: вместо боя D&D — режим «Вызовы» (Д33, Q1).
  const systemCode = useSessionSystemCode(sessionId);
  const litm = systemCode === "litm";
  // Пока система кампании читается, режим не выбирается: иначе на миг встал бы бой D&D.
  const systemKnown = systemCode !== undefined;

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
      {/* Часы (макет Roll-Pult, Q9–Q11): за столом и в мире одной плашкой,
          справа «Бой», «Завершить» и «⋯» с редким. */}
      <div className="pult-top">
        <div className="pult-clock">
          <PultTimer session={session} />
          <span className="pult-clock__sp" aria-hidden="true" />
          <SessionTimeStrip session={session} settingId={campaign.setting_id} campaignId={campaign.id} />
        </div>
        <div className="pult-top__acts">
          <button
            type="button"
            className={`d-btn d-btn--sm${combatMode ? " is-on" : ""}`}
            aria-pressed={combatMode}
            disabled={!systemKnown}
            onClick={() => setCombatModeOpen(sessionId, !combatMode)}
          >
            {litm ? "Вызовы" : "Бой"}
          </button>
          <SessionLiveControls session={session} onFinished={onFinished} />
          <button
            ref={moreRef}
            type="button"
            className="d-btn d-btn--sm"
            aria-label="Ещё действия"
            aria-haspopup="menu"
            onClick={() => {
              const r = moreRef.current?.getBoundingClientRect();
              if (r) setMenuAt({ x: r.right, y: r.bottom });
            }}
          >
            …
          </button>
        </div>
        {menuAt && (
          <ContextMenu
            x={menuAt.x}
            y={menuAt.y}
            items={[{ label: "Сбросить раскладку панелей", onClick: () => requestPultGridReset() }]}
            onClose={() => setMenuAt(null)}
          />
        )}
      </div>
      <BagRulesControl />

      {/* Боевой режим (Q1) занимает основную область пульта: сцены, показ и
          сетку панелей. Полоса времени и управление сессией остаются. */}
      {litm && <LitmRibbonTarget sessionId={sessionId} />}
      {combatMode && !systemKnown ? null : combatMode && litm ? (
        <LitmConflictMode sessionId={sessionId} systemId={campaign.system_id} settingId={campaign.setting_id} characters={characters} union={union} />
      ) : combatMode ? (
        <CombatMode sessionId={sessionId} />
      ) : (
        <>
          <SceneSwitcher sessionId={sessionId} />

          {/* Блоки контента — на сетке GridStack (таскаются за шапку, раскладка
              запоминается): задумка/события + 8 панелей. Время, сцены и показ
              выше — вне сетки, статично. */}
          <PultGrid
            presentation={<PresentationPanel sessionId={sessionId} campaignId={campaign.id} />}
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
        </>
      )}
      {outcomeOpen && <SessionOutcomeModal sessionId={sessionId} onClose={() => setOutcomeOpen(false)} />}
    </div>
  );
}
