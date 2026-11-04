import type { InstanceSummary } from "../components/workbooks/model";
import {ProjectWorkbooks} from "../components/workbooks/ProjectWorkbooks";
import {EmbeddedWorkbook} from "./WorkbookPage";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { entityQuery, useAction, useEntity, useResource, write } from "../data/hooks";
import { afterWriteAnywhere } from "../data/imperative";
import {
  campaignAdventureAffects,
  campaignFieldsAffects,
  campaignGroupAffects,
  campaignPaths,
  rosterAffects,
} from "../data/campaigns";
import { useQueries } from "@tanstack/react-query";
import { sessionMoneyAffects } from "../data/sessions";
import { vesselPaths, type VesselSummary } from "../data/campaignVessels";
import { labelled } from "../data/notices";
import { toLocalDateKey, formatDateKeyRu, addDays } from "../utils/date";
import { CampaignSessionList } from "../components/campaign/CampaignSessionList";
import { SessionOutcomeModal } from "../components/SessionOutcomeModal";
import { copySessionPrep } from "../sessionCopy";
import { Modal } from "../components/Modal";
import { MiniCalendar } from "../components/MiniCalendar";
import { type CalendarEvent } from "../components/MonthCalendar";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { CampaignEntryList } from "../components/CampaignEntryList";
import { WorldExplorationTab } from "../components/WorldExplorationTab";
import { CampaignIssuanceTab } from "../components/CampaignIssuanceTab";
import { TaskTracker } from "../components/TaskTracker";
import { CampaignSecrets } from "../components/CampaignSecrets";
import { CampaignMilestones } from "../components/CampaignMilestones";
import { CampaignChaptersScenes, useAdventureDetach, type ChaptersNavStats } from "../components/CampaignChaptersScenes";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import { EmptyState } from "../components/EmptyState";
import { CampaignReminders } from "../components/campaign/CampaignReminders";
import { TypeGlyph } from "../components/TypeGlyph";
import "../components/campaign/campaign-d.css";
import { CharacterRequestsBlock } from "../components/CharacterRequestsBlock";
import { IMAGE_ACCEPT } from "../imageUpload";
import {
  PAYMENT_TYPE_LABELS,
  PAYMENT_TYPE_OPTIONS,
  CAMPAIGN_TYPE_OPTIONS,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_STATUS_OPTIONS,
  PAYMENT_FREQUENCY_OPTIONS,
  PAYMENT_FREQUENCY_LABELS,
  RATE_SPLIT_OPTIONS,
  RATE_SPLIT_LABELS,
} from "../paymentTypes";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useTabState } from "../hooks/useTabState";
import { formatInworldDate } from "../inworldCalendar";
import { EntityPage } from "../components/EntityPage";
import { LoadErrorCard } from "../components/Loadable";
import { useImageCrop } from "../hooks/useImageCrop";
import { loadHideFinance } from "../financePrivacy";
import { isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { useConfirm, useAlert, usePrompt } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import type {
  CampaignCalendarEvent,
  ImportantDate,
  StoryArc,
  CampaignDetail,
  CampaignEntry,
  CampaignGroup,
  CampaignType,
  Character,
  PaymentFrequency,
  PaymentType,
  Player,
  RateSplit,
  RosterPlayer,
  SessionStatus,
  SessionSummary,
  Setting,
  System,
  CampaignDebt,
  WorldExplorationEntry,
  WorldExplorationKind,
  GmReminder,
} from "../types";
import { CampaignChronicle } from "../components/chronicle/CampaignChronicle";
import { CutsceneBindings } from "../components/cutscenes/CutsceneBindings";
import { PresentationEditor } from "../components/presentation/PresentationEditor";
import { EntityTabWorkspace } from "../components/EntityTabWorkspace";
import { sessionLabel } from "../sessionLabel";
import { remindersPath } from "../data/sessions";
import { daysUntilLabel } from "../components/campaign/sessionGroups";
import { CampaignRevealList } from "../components/RevealList";
import { CampaignVesselsTab } from "../components/CampaignVesselsTab";
import { CampaignPassport } from "../components/campaign/CampaignPassport";
import { plural, sceneWord } from "../sceneKinds";
import { CampaignDossierFiles, useCharacterSheets } from "../components/campaign/CampaignDossierFiles";
import { statusOf, useSetCharacterStatus } from "../characterStatus";
import { CampaignNow } from "../components/campaign/CampaignNow";
import { NavIcon } from "../components/NavIcons";
import { CampaignDebtors, LastSessionResult, NextSessionPrep, useSettleDebt } from "../components/campaign/CampaignPrep";
import { OldNotesFold } from "../components/campaign/OldNotesFold";
import { ExtraPayments } from "../components/campaign/ExtraPayments";
import { CampaignWorldTab } from "../components/campaign/CampaignWorldTab";

// Вкладки кампании (спека campaign-paper, Q19/Q20/Q26/Q31). «Сюжет» собрал
// «Главы и сцены», «Вехи», «Тайны и зацепки» и «Выводы» разделами; «Заметок»
// нет — свободные записи живут в листах тетради. «Тетрадь» видна, когда она
// привязана; у ваншота нет «Хроники мира». «Мир кампании» — задействованные
// сущности сеттинга (ADR-0006), есть и у ваншота.
const GM_TABS = [
  "Обзор",
  "Персонажи игроков",
  "Сюжет",
  "Сессии",
  "Мир кампании",
  "Хроника мира",
  "Тетрадь",
  "Выдача",
  "Оплата",
  "Представление",
  "Транспорт",
  "Итоги",
] as const;

const CAMPAIGN_MORE_TABS = ["Оплата", "Представление", "Транспорт", "Итоги"] as const;

// Язычки: короче подпись и знак (гриллинг 2026-10-23, Q25–Q26). Ключ вкладки
// прежний — на него завязаны ?tab=, закрепы и старые ссылки.
const TAB_SHORT: Record<string, string> = {
  "Персонажи игроков": "Партия",
  "Мир кампании": "Мир",
  "Хроника мира": "Хроника",
  "Клёвые цитаты": "Цитаты",
  "Трекер задач": "Задачи",
  "Исследование Мира": "Исследование мира",
};

// Разделы «Сюжета» и старые имена вкладок, которые теперь ведут в них.
const STORY_SECTIONS = [
  { id: "chapters", label: "Главы и сцены" },
  { id: "milestones", label: "Вехи" },
  { id: "secrets", label: "Тайны и зацепки" },
  { id: "reveals", label: "Выводы" },
] as const;
const storySectionOf = (oldTab: string | null) => STORY_SECTIONS.find((x) => x.label === oldTab)?.id;

// Сохранённые ссылки на прежнее имя вкладки не должны падать на «Обзор».
// «Хроника игр» стала «Сессиями» (2026-09-18): «хроника» путалась с «Хроникой мира».
const GM_TAB_ALIASES = {
  "Игроки и персонажи": "Персонажи игроков",
  "Заметки по ведению": "Обзор",
  Заметки: "Обзор",
  "Для игроков": "Выдача",
  "Хроника игр": "Сессии",
  "Главы и сцены": "Сюжет",
  Вехи: "Сюжет",
  "Тайны и зацепки": "Сюжет",
  Выводы: "Сюжет",
} as const;
const PLAYER_TABS = ["Обзор", "Заметки", "Клёвые цитаты", "Трекер задач", "Сессии", "Исследование Мира"] as const;
const PLAYER_TAB_ALIASES = { "Хроника игр": "Сессии" } as const;

// Пустые значения до загрузки — одними ссылками, чтобы useMemo над ними не
// пересчитывался на каждую отрисовку.
const NO_SESSIONS: SessionSummary[] = [];
const NO_PLAYERS: Player[] = [];
const NO_DEBTS: CampaignDebt[] = [];
const NO_SYSTEMS: System[] = [];
const NO_SETTINGS: Setting[] = [];
const NO_EVENTS: CampaignCalendarEvent[] = [];

/**
 * Папки кампании нет в хранилище. Полоса стоит в профиле, а не только на
 * «Здоровье»: сюда Мастер приходит работать, и упереться в отказ при попытке
 * загрузить картинку хуже, чем прочитать причину заранее.
 */
function CampaignFolderNotice({ campaign }: { campaign: CampaignDetail }) {
  const run = useAction();
  const [alertDialog, alert] = useAlert();
  async function repair() {
    const done = await run(
      labelled("Не удалось вернуть папку", () =>
        write.post<{ folder_path: string; bound: boolean }>(`/campaigns/${campaign.id}/folder/repair`, {})
      ),
      { affects: campaignFieldsAffects(campaign.id) }
    );
    if (!done) return;
    // Полоса исчезает сразу, как только сервер отдаст кампанию с папкой,
    // поэтому итог показываем отдельным окном, а не строкой внутри неё.
    alert(
      done.bound
        ? `Нашлась папка «${done.folder_path}» — привязал её. Файлы кампании вернулись вместе с ней.`
        : "Папка создана заново. Файлы из прежней в неё не вернутся: если папка просто переехала, укажите её на странице «Здоровье»."
    );
  }
  return (
    <>
      {alertDialog}
      {/* Строка «Д» на всех вкладках (блок «Кампании», Q5): тонкая линия,
          малиновая метка, кнопка контуром. */}
      {campaign.folder_missing && (
        <div className="d-nofold">
          <span className="d-mark">Нет папки</span>
          <p>
            {campaign.folder_path
              ? "Папки кампании нет в хранилище — её удалили или перенесли."
              : "У кампании нет папки в хранилище."}{" "}
            Файлы загружать и переименовывать кампанию нельзя.
          </p>
          <button type="button" className="d-btn d-btn--sm" onClick={() => void repair()}>Создать папку заново</button>
        </div>
      )}
    </>
  );
}

export function CampaignDetailPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const invalidCampaignId = !Number.isFinite(campaignId);
  const navigate = useNavigate();

  const run = useAction();
  const campaignState = useResource<CampaignDetail>(invalidCampaignId ? null : campaignPaths.detail(campaignId));
  const campaign = campaignState.data ?? null;
  const calendar = useSettingCalendar(campaign?.setting_id);
  const sessions = useResource<SessionSummary[]>(invalidCampaignId ? null : campaignPaths.sessions(campaignId)).data ?? NO_SESSIONS;
  const allPlayers = useResource<Player[]>(campaignPaths.players()).data ?? NO_PLAYERS;
  const debts = useResource<CampaignDebt[]>(invalidCampaignId ? null : campaignPaths.debts(campaignId)).data ?? NO_DEBTS;
  const workbooks = useResource<InstanceSummary[]>(invalidCampaignId ? null : `/workbooks/instances?project_type=campaign&project_id=${campaignId}`).data ?? NO_WORKBOOKS;
  const gmCampaignId = !invalidCampaignId && campaign?.role !== "player" && campaign ? campaignId : null;
  const vessels = useResource<VesselSummary[]>(gmCampaignId == null ? null : vesselPaths.list(gmCampaignId)).data;
  const gmTabs = GM_TABS.filter(
    (t) => (t !== "Хроника мира" || campaign?.type !== "oneshot")
  );
  const tabs = campaign?.role === "player" ? PLAYER_TABS : gmTabs;
  const [tab, selectTab] = useTabState(
    tabs,
    "Обзор",
    campaign?.role === "player" ? PLAYER_TAB_ALIASES : GM_TAB_ALIASES
  );
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  // Навигация внутри таба «Персонажи игроков» (Master–Detail).
  const [playersSel, setPlayersSel] = useState<{ section: string; item?: string }>({ section: "roster" });
  // «Сюжет»: раздел слева, под ним — фильтр по приключению. Старая ссылка на
  // «Вехи» или «Тайны и зацепки» открывает свой раздел.
  const [storySel, setStorySel] = useState<{ section: string; item?: string }>(() => ({
    section: storySectionOf(new URLSearchParams(window.location.search).get("tab")) ?? "chapters",
  }));
  function openStory(section: string) {
    setStorySel({ section });
    selectTab("Сюжет");
  }
  const [chapStats, setChapStats] = useState<ChaptersNavStats | null>(null);
  // «Убрать из кампании» — местный пункт ПКМ приключения; после — к «Все приключения».
  const [adventureDetachDialog, adventureMenu] = useAdventureDetach(campaignId, (adventureId) =>
    setStorySel((sel) => (sel.item === String(adventureId) ? { section: "chapters", item: "all" } : sel))
  );
  // Пока Мастер сам ничего не выбрал, «Сюжет» открывается на текущем
  // приключении, а без него — на всех (Q7). Один раз: дальше выбор его.
  const storyPicked = useRef(false);
  useEffect(() => {
    // Пустой список — дерево ещё не пришло (до загрузки оно EMPTY).
    if (!chapStats?.adventures.length || storyPicked.current) return;
    storyPicked.current = true;
    if (storySel.section !== "chapters" || storySel.item != null) return;
    const current = chapStats.adventures.find((a) => a.current);
    setStorySel({ section: "chapters", item: current ? String(current.id) : "all" });
  }, [chapStats, storySel]);
  const { deleteWithUndo } = useUndoDelete();
  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  // «Редактировать» в шапке «Обзора»: счётчик щелчков для OverviewTab.
  const [editMainTick, setEditMainTick] = useState(0);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newStatus, setNewStatus] = useState<SessionStatus>("planned");
  const [newPaymentOverride, setNewPaymentOverride] = useState<"" | PaymentType>("");
  const [newStake, setNewStake] = useState("");
  const [repeatInterval, setRepeatInterval] = useState<"none" | "7" | "14">("none");
  const [repeatCount, setRepeatCount] = useState("4");
  const [newCopyFromSessionId, setNewCopyFromSessionId] = useState("");
  const [newStartTime, setNewStartTime] = useState("");
  const [outcomeSessionId, setOutcomeSessionId] = useState<number | null>(null);
  const [movingSession, setMovingSession] = useState<{ id: number; date: string; start_time: string } | null>(null);

  const systems = useResource<System[]>(campaignPaths.systems()).data ?? NO_SYSTEMS;
  const settingsList = useResource<Setting[]>(campaignPaths.settings()).data ?? NO_SETTINGS;

  const [menu, setMenu] = useState<{ x: number; y: number; event: CalendarEvent } | null>(
    null
  );

  const [sessionMenu, setSessionMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const rawEvents = useResource<CampaignCalendarEvent[]>(invalidCampaignId ? null : campaignPaths.calendarEvents(campaignId)).data ?? NO_EVENTS;
  // Отменённые живут в Архиве, на вкладке их нет.
  const chronicleFiltered = useMemo(() => sessions.filter((s) => s.status !== "cancelled"), [sessions]);
  if (invalidCampaignId) return <div className="stack" style={{ padding: 24 }}><p>Кампания не найдена</p><Link to="/campaigns">К списку кампаний →</Link></div>;
  if (campaignState.error && !campaign) return <div className="stack" style={{ padding: 24 }}><p className="muted">{campaignState.error}</p><button onClick={campaignState.reload}>Повторить</button></div>;
  if (!campaign) return <p className="muted">Загрузка…</p>;

  const todayKey = toLocalDateKey();
  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    // Q14: прошедшая, но не закрытая игра в календаре видна как «ждёт разбора».
    overdue: s.status === "planned" && s.date < todayKey,
    paymentType: s.effective_payment_type,
    campaignRole: campaign.role,
    label: sessionLabel(s),
  }));

  async function createSession() {
    if (!creatingDate || creatingSession) return;
    setCreatingSession(true);
    try {
      const total = repeatInterval === "none" ? 1 : Math.max(1, Number(repeatCount) || 1);
      const step = repeatInterval === "none" ? 0 : Number(repeatInterval);
      const base = new Date(creatingDate + "T00:00:00");
      for (let i = 0; i < total; i++) {
        const d = new Date(base);
        d.setDate(d.getDate() + i * step);
        const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
        const created = await run(
          labelled("Новая сессия", () =>
            write.post<{ id: number }>("/sessions", {
              campaign_id: campaignId,
              date: dateStr,
              status: newStatus,
              payment_override: newPaymentOverride || null,
              stake_override: newStake ? Number(newStake) : undefined,
              start_time: newStartTime || null,
            })
          ),
          // Без «Повторить»: ответ мог потеряться после записи, повтор задвоил бы сессию.
          { affects: [{ kind: "session" }, { kind: "campaign", id: campaignId }], retry: false }
        );
        // Серия останавливается на первом отказе; окно остаётся открытым.
        if (!created) return;
        if (newCopyFromSessionId) {
          await run(labelled("Подготовка из прогона", () => copySessionPrep(Number(newCopyFromSessionId), created.id)), {
            affects: [{ kind: "session", id: created.id }],
            retry: false,
          });
        }
      }
      setCreatingDate(null);
      setNewStartTime("");
      setNewStatus("planned");
      setNewPaymentOverride("");
      setNewStake("");
      setRepeatInterval("none");
      setRepeatCount("4");
      setNewCopyFromSessionId("");
    } finally {
      setCreatingSession(false);
    }
  }

  async function archiveCampaign() {
    const ok = await confirm({ title: "Архивировать кампанию?", message: "Отправить кампанию в архив? Она пропадёт из основных разделов.", confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    const name = campaign?.name || "Без названия";
    // Без catch падение уходило в никуда, а `navigate` ниже не срабатывал —
    // мастер оставался на странице кампании без единого объяснения.
    try {
      await deleteWithUndo({
        entityName: name,
        deleteFn: async () => {
          await write.del(`/campaigns/${campaignId}`);
          afterWriteAnywhere([{ kind: "campaign" }, { path: "/archive" }]);
        },
        restoreFn: async () => {
          await write.put(`/campaigns/${campaignId}/restore`);
          afterWriteAnywhere([{ kind: "campaign" }, { path: "/archive" }]);
        },
      });
    } catch (e) {
      showAlert(`Не удалось архивировать «${name}»: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    navigate("/campaigns");
  }

  function contextMenuItems(event: CalendarEvent): ContextMenuItem[] {
    const session = sessions.find((s) => s.id === event.id);
    const paymentItems: ContextMenuItem[] = [
      { value: "", label: `Оплата: как в кампании (${PAYMENT_TYPE_LABELS[campaign!.payment_type]})` },
      ...PAYMENT_TYPE_OPTIONS.map((o) => ({ value: o.value, label: `Оплата: ${o.label}` })),
    ]
      .filter((o) => o.value !== (session?.payment_override ?? ""))
      .map((o) => ({
        label: o.label,
        onClick: () =>
          void run(labelled("Оплата сессии", () => write.put(`/sessions/${event.id}`, { payment_override: o.value || null })), {
            affects: sessionMoneyAffects(event.id, campaignId),
          }),
      }));

    return [
      // Q14: разбор — первым у всего, что уже наступило.
      ...(event.date <= toLocalDateKey()
        ? [{ label: "Разбор игры", onClick: () => setOutcomeSessionId(event.id) }]
        : []),
      {
        label: "Статус: Запланировано",
        onClick: () =>
          void run(labelled("Статус сессии", () => write.put(`/sessions/${event.id}`, { status: "planned" })), {
            affects: sessionMoneyAffects(event.id, campaignId),
          }),
      },
      {
        label: "Статус: Состоялась",
        onClick: () =>
          void run(labelled("Статус сессии", () => write.put(`/sessions/${event.id}`, { status: "held" })), {
            affects: sessionMoneyAffects(event.id, campaignId),
          }),
      },
      ...paymentItems,
      {
        label: "Не состоялась — в архив",
        danger: true,
        onClick: () =>
          void run(labelled("Сессия в архив", () => write.del(`/sessions/${event.id}`)), {
            affects: [...sessionMoneyAffects(event.id, campaignId), { path: "/archive" }],
          }),
      },
    ];
  }

  async function archiveSession(sessionId: number) {
    const ok = await confirm({
      title: "Игра не состоялась?",
      message: "Сессия уйдёт в архив — вернуть её можно со страницы «Архив».",
      confirmLabel: "Не состоялась",
      danger: true,
    });
    if (!ok) return;
    await run(labelled("Сессия в архив", () => write.del(`/sessions/${sessionId}`)), {
      affects: [...sessionMoneyAffects(sessionId, campaignId), { path: "/archive" }],
    });
  }

  function openCreate(date: string, startTime = "") {
    setNewStartTime(startTime);
    setCreatingDate(date);
  }

  // «+ Запланировать» (Q12): обычно играют в один день недели — через неделю
  // после последней игры в то же время. Ушедшая в прошлое дата шагает
  // неделями до сегодняшней, день недели сохраняется.
  function scheduleNext() {
    const today = toLocalDateKey();
    const last = [...sessions].filter((s) => s.status !== "cancelled").sort((a, b) => a.date.localeCompare(b.date)).pop();
    if (!last) return openCreate(today);
    let date = addDays(last.date, 7);
    while (date < today) date = addDays(date, 7);
    openCreate(date, last.start_time ?? "");
  }

  function openSessionMenu(e: React.MouseEvent<HTMLElement>, s: SessionSummary) {
    const at = e.currentTarget.getBoundingClientRect();
    setSessionMenu({
      x: at.left,
      y: at.bottom,
      items: [
        { label: "Разбор игры", onClick: () => setOutcomeSessionId(s.id) },
        { label: "Изменить дату", onClick: () => setMovingSession({ id: s.id, date: s.date, start_time: s.start_time ?? "" }) },
        { label: "Не состоялась — в архив", danger: true, dividerBefore: true, onClick: () => void archiveSession(s.id) },
      ],
    });
  }

  async function saveMovedSession() {
    if (!movingSession) return;
    const { id, date, start_time } = movingSession;
    const ok = await run(labelled("Дата сессии", () => write.put(`/sessions/${id}`, { date, start_time: start_time || null })), {
      affects: sessionMoneyAffects(id, campaignId),
    });
    if (ok !== undefined) setMovingSession(null);
  }

  const tabCounts: Partial<Record<(typeof tabs)[number], number>> = {
    "Персонажи игроков": campaign.roster.length,
    "Сессии": sessions.length,
    "Хроника мира": rawEvents.filter((event) => !event.hidden).length,
    "Тетрадь": workbooks.length,
  };
  return (
    <EntityPage
      crumbs={[{ label: "Кампании", to: "/campaigns" }, { label: campaign.name }]}
      entityType="campaign"
      title={campaign.name}
      badges={campaign.role === "player" && <span className="badge role-player-badge zine-rotate">Я игрок</span>}
      // Бумага (спека campaign-paper, доски 41–42). Под именем Мастера — одна
      // строка фактов и два действия (гриллинг 2026-10-23, Q2–Q3): заработок
      // ушёл во вкладку «Оплата», тип — плашкой только у ваншота.
      paper
      hideIdent={campaign.role === "player"}
      meta={
        campaign.role === "player" ? (
          <span className="paper-ident-tags">
            <span className="badge tag">{CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === campaign.type)?.label ?? campaign.type}</span>
            {campaign.system_name && <span className="badge tag">{campaign.system_name}</span>}
          </span>
        ) : (
          <CampaignNow
            campaign={campaign}
            sessions={sessions}
            onSchedule={scheduleNext}
            onEdit={() => setEditMainTick((n) => n + 1)}
          />
        )
      }
      actions={[{ label: "Архивировать", danger: true, onClick: archiveCampaign }]}
      tabs={tabs.filter(id => !CAMPAIGN_MORE_TABS.some(t => t === id)).map(id => {
        // Ярлыки «Д» без знаков, счётчик машинописью (блок «Кампании», пачка 1).
        return { id, label: TAB_SHORT[id] ?? id, count: tabCounts[id] || undefined };
      })}
      hiddenTabs={CAMPAIGN_MORE_TABS.filter(id => tabs.some(t => t === id))}
      hiddenTabHints={{
        "Оплата": debts.length ? `должны ${debts.length}` : undefined,
        "Транспорт": vessels ? String(vessels.filter((v) => !v.archived_at).length) : undefined,
      }}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof tabs)[number])}
    >
      <CampaignFolderNotice campaign={campaign} />

      {tab === "Обзор" && campaign.role === "player" && (
        <PlayerOverviewTab campaign={campaign} systems={systems} settingsList={settingsList} sessions={sessions} />
      )}

      {tab === "Заметки" && campaign.role === "player" && (
        <CampaignEntryList
          campaignId={campaignId}
          category="notes"
          addLabel="+ Добавить заметку"
          emptyLabel="Заметок пока нет."
          title="Заметки"
          sub="видите только вы"
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Клёвые цитаты" && (
        <CampaignEntryList
          campaignId={campaignId}
          category="quotes"
          addLabel="+ Добавить цитату"
          emptyLabel="Цитат пока нет."
          title="Цитаты"
          sub="что сказано за столом"
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Трекер задач" && (
        <TaskTracker campaignId={campaignId} defaultSettingId={campaign.setting_id ?? undefined} />
      )}

      {adventureDetachDialog}
      {tab === "Сюжет" && (
        <EntityTabWorkspace
          sections={[
            {
              id: "chapters",
              label: "Приключения",
              count: (chapStats?.adventures ?? []).reduce((n, a) => n + a.scenes, 0),
              // Корзина «вне приключений» — последней, бледной и только непустая (Q6).
              items: [
                { id: "all", label: "Все приключения" },
                ...(chapStats?.adventures ?? [])
                  .filter((a) => !a.is_default || a.scenes > 0)
                  .map((a) => ({
                    id: String(a.id),
                    label: a.name,
                    count: a.scenes,
                    current: a.current,
                    dim: a.is_default,
                    ...(!a.is_default && {
                      entity: { type: "adventure", id: a.id, name: a.name },
                      menu: adventureMenu({ id: a.id, name: a.name, has_campaign_edits: a.has_edits }),
                    }),
                  })),
              ],
              // «+ Приключение» кислотой под списком (Q4, макет Camp-Story).
              footer: campaign.setting_id != null && (
                <CampaignAdventureAdd
                  campaignId={campaignId}
                  onAdded={(id) => {
                    storyPicked.current = true;
                    setStorySel({ section: "chapters", item: String(id) });
                  }}
                />
              ),
            },
            // Материалы — строками со знаком; группы вех и тайн — блоками на
            // странице раздела, а не пунктами колонки (макет Camp-Story-Milestones).
            { id: "milestones", group: "Материалы", label: "Вехи", icon: "book" },
            { id: "secrets", group: "Материалы", label: "Тайны и зацепки", icon: "book" },
            { id: "reveals", group: "Материалы", label: "Выводы", icon: "book" },
          ]}
          phoneSelect
          plates
          selection={storySel}
          onSelect={(sel) => {
            storyPicked.current = true;
            setStorySel(sel);
          }}
          workspaceKey={campaignId}
        >
          {storySel.section === "chapters" && (
            <CampaignChaptersScenes
              campaignId={campaignId}
              settingId={campaign.setting_id}
              adventureId={storySel.item != null && storySel.item !== "all" ? Number(storySel.item) : null}
              chapterId={null}
              onStats={(st) => setChapStats((prev) => (JSON.stringify(prev) === JSON.stringify(st) ? prev : st))}
              onPickAdventure={(id) => {
                storyPicked.current = true;
                setStorySel({ section: "chapters", item: String(id) });
              }}
              adventureMenu={adventureMenu}
            />
          )}
          {storySel.section === "milestones" && (
            <CampaignMilestones
              campaignId={campaignId}
              settingId={campaign.setting_id}
              groupId={null}
            />
          )}
          {storySel.section === "secrets" && (
            <CampaignSecrets
              campaignId={campaignId}
              settingId={campaign.setting_id}
              groupId={null}
            />
          )}
          {storySel.section === "reveals" && (
            // Плашка, как у вех и тайн (макет Camp-Story-Milestones).
            <section>
              <div className="d-gh">
                <h3 className="d-plate">Выводы</h3>
                <span className="d-note">куда ведут найденные улики</span>
              </div>
              <CampaignRevealList campaignId={campaignId} />
            </section>
          )}
        </EntityTabWorkspace>
      )}

      {tab === "Тетрадь" && (
        // Свободные записи кампании — в листах тетради (Q31), как у сеттинга.
        <section className="paper-groups" aria-label="Тетрадь кампании">
          {campaign.type === "oneshot" ? <OneshotWorkbook campaignId={campaignId} campaignBooks={workbooks}/> : <>
          {!workbooks.length&&<ProjectWorkbooks type="campaign" id={campaignId} inline/>}
          {workbooks.length === 1 ? <EmbeddedWorkbook id={workbooks[0].id}/> : <WorkbookRows books={workbooks}/>}
          </>}
        </section>
      )}

        {(tab === "Обзор" || tab === "Оплата") && campaign.role !== "player" && (
           <>
             <OverviewTab
               key={tab}
               editTick={editMainTick}
               section={tab === "Оплата" ? "payment" : "overview"}
               campaign={campaign}
               systems={systems}
               settingsList={settingsList}
               sessions={sessions}
             />
           </>
        )}

      {tab === "Выдача" && (
        <CampaignIssuanceTab
          campaignId={campaignId}
          settingId={campaign.setting_id}
          roster={campaign.roster}
        />
      )}

      {tab === "Персонажи игроков" && (
        <div className="campaign-players-workspace">
        <EntityTabWorkspace
          sections={[
            { id: "roster", label: "Состав", count: campaign.roster.length, icon: "players" },
            { id: "reminders", label: "Напоминания", icon: "document" },
            { id: "journals", label: "Путевые заметки", icon: "book" },
          ]}
          selection={playersSel}
          onSelect={setPlayersSel}
          workspaceKey={campaignId}
          seg
        >
          {playersSel.section === "roster" && (
            <PlayersAndCharactersTab
              campaignId={campaignId}
              roster={campaign.roster}
              allPlayers={allPlayers}
              debts={debts}
              currency={campaign.currency}
              sessions={sessions}
            />
          )}
          {playersSel.section === "reminders" && <CampaignReminders campaignId={campaignId} roster={campaign.roster} />}
          {playersSel.section === "journals" && <PlayerJournalsSection campaignId={campaignId} />}
        </EntityTabWorkspace>
        </div>
      )}

      {tab === "Представление" && (
        <section className="stack">
          <p className="muted">Заглавное представление показывается на втором экране до первого представления сцены и по кнопке из пульта.</p>
          <PresentationEditor owner={{ kind: "campaign", campaignId, campaignName: campaign.name }} />
          {campaign.role !== "player" && <CutsceneBindings context={{ kind: "campaign", campaignId }} />}
        </section>
      )}
      {tab === "Итоги" && <ResultsTab campaign={campaign} />}
      {tab === "Транспорт" && <CampaignVesselsTab campaignId={campaignId} />}
      {tab === "Мир кампании" && (
        <CampaignWorldTab campaignId={campaignId} settingId={campaign.setting_id} sessions={sessions} />
      )}

      {tab === "Сессии" && (
        // Макет Camp-Sessions: слева «Ждут разбора», главный блок ближайшей и
        // сыгранные; справа календарь месяца и деньги одной строкой.
        <div className="campaign-sessions">
          <div className="campaign-sessions__list">
            {sessions.length === 0 && campaign.role === "player" ? (
              <p className="muted">Сессий пока нет.</p>
            ) : (
              <CampaignSessionList
                sessions={chronicleFiltered}
                today={toLocalDateKey()}
                isGm={campaign.role !== "player"}
                showMoney={campaign.role !== "player" && !loadHideFinance()}
                oneshot={campaign.type === "oneshot"}
                inworldLabel={(x) =>
                  (calendar && formatInworldDate(x.inworld_year, x.inworld_month, x.inworld_day, calendar.months, calendar.era)) || ""
                }
                onSchedule={scheduleNext}
                onMenu={openSessionMenu}
                onOutcome={(x) => setOutcomeSessionId(x.id)}
              />
            )}
          </div>
          <aside className="d-block campaign-sessions__cal" aria-label="Календарь игр">
            <MiniCalendar
              months={1}
              events={sessions.map((x) => ({
                id: x.id,
                date: x.date,
                status: x.status,
                campaignId,
                startTime: x.start_time,
                overdue: x.status === "planned" && x.date < todayKey,
              }))}
              onDayClick={campaign.role !== "player" ? (date) => openCreate(date) : undefined}
              onEventContextMenu={(e, x, y) => {
                const ev = events.find((v) => v.id === e.id);
                if (ev && campaign.role !== "player") setMenu({ x, y, event: ev });
              }}
            />
            <ul className="campaign-sessions__legend" aria-hidden="true">
              <li><i className="is-planned" />запланирована</li>
              <li><i className="is-held" />сыграна</li>
              {campaign.role !== "player" && <li><i className="is-overdue" />ждёт разбора</li>}
            </ul>
            {/* Q10: финансы одной строкой — сколько получено и кто должен, подробности на «Оплате». */}
            {campaign.role !== "player" && !loadHideFinance() && campaign.payment_type !== "free" && (
              <p className="campaign-sessions__money">
                Получено {campaign.finance.earned} {campaign.currency}
                {debts.length > 0 && ` · должны ${debts.length} ${plural(debts.length, "игрок", "игрока", "игроков")}`}
                <br />
                <button type="button" className="session-finance__link" onClick={() => selectTab("Оплата")}>
                  Оплата ›
                </button>
              </p>
            )}
          </aside>
        </div>
      )}

      {tab === "Исследование Мира" && <WorldExplorationTab campaignId={campaignId} />}

      {tab === "Хроника мира" && <CampaignChronicle campaign={campaign} sessions={sessions} events={rawEvents} />}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={contextMenuItems(menu.event)}
          onClose={() => setMenu(null)}
        />
      )}


      {sessionMenu && <ContextMenu {...sessionMenu} onClose={() => setSessionMenu(null)} />}
      {confirmDialog}
      {alertDialog}
      {outcomeSessionId != null && <SessionOutcomeModal sessionId={outcomeSessionId} onClose={() => setOutcomeSessionId(null)} />}
      {movingSession && (
        <Modal onClose={() => setMovingSession(null)}>
          <h2>Изменить дату</h2>
          <div className="stack">
            <div className="row" style={{ gap: 8 }}>
              <label style={{ flex: 1 }}>
                Дата
                <input
                  type="date"
                  value={movingSession.date}
                  onChange={(e) => e.target.value && setMovingSession({ ...movingSession, date: e.target.value })}
                />
              </label>
              <label style={{ flex: 1 }}>
                Начало
                <input
                  type="time"
                  value={movingSession.start_time}
                  onChange={(e) => setMovingSession({ ...movingSession, start_time: e.target.value })}
                />
              </label>
            </div>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setMovingSession(null)}>Отмена</button>
              <button className="primary" onClick={() => void saveMovedSession()}>Сохранить</button>
            </div>
          </div>
        </Modal>
      )}
      {creatingDate && (
        <Modal onClose={() => setCreatingDate(null)}>
          <h2>Сессия — {formatDateKeyRu(creatingDate)}</h2>
          <div className="stack">
            <div className="row" style={{ gap: 8 }}>
              <label style={{ flex: 1 }}>
                Дата
                <input type="date" value={creatingDate} onChange={(e) => e.target.value && setCreatingDate(e.target.value)} />
              </label>
              <label style={{ flex: 1 }}>
                Начало
                <input type="time" value={newStartTime} onChange={(e) => setNewStartTime(e.target.value)} />
              </label>
            </div>
            <label>
              Статус
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as SessionStatus)}>
                <option value="planned">Запланировано</option>
                <option value="held">Состоялась</option>
              </select>
            </label>
            <label>
              Оплата
              <select
                value={newPaymentOverride}
                onChange={(e) => setNewPaymentOverride(e.target.value as "" | PaymentType)}
              >
                <option value="">Как в кампании ({PAYMENT_TYPE_LABELS[campaign.payment_type]})</option>
                {PAYMENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {(newPaymentOverride === "paid" ||
              (newPaymentOverride === "" && campaign.payment_type === "paid")) && (
              <label>
                Ставка (если отличается от {campaign.session_rate})
                <input value={newStake} onChange={(e) => setNewStake(e.target.value)} />
              </label>
            )}
            <label>
              Повторять
              <select
                value={repeatInterval}
                onChange={(e) => setRepeatInterval(e.target.value as "none" | "7" | "14")}
              >
                <option value="none">Не повторять</option>
                <option value="7">Каждую неделю</option>
                <option value="14">Каждые 2 недели</option>
              </select>
            </label>
            {repeatInterval !== "none" && (
              <label>
                Сколько всего сессий (включая эту)
                <input
                  type="number"
                  min={1}
                  max={52}
                  value={repeatCount}
                  onChange={(e) => setRepeatCount(e.target.value)}
                />
              </label>
            )}
            {campaign.type === "oneshot" && sessions.length > 0 && (
              <label>
                Скопировать подготовку из прогона (необязательно)
                <select
                  value={newCopyFromSessionId}
                  onChange={(e) => setNewCopyFromSessionId(e.target.value)}
                >
                  <option value="">Не копировать</option>
                  {sessions.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.date}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setCreatingDate(null)} disabled={creatingSession}>Отмена</button>
              <button className="primary" onClick={createSession} disabled={creatingSession}>
                {creatingSession ? "Создаю…" : "Сохранить"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </EntityPage>
  );
}

function PlayersAndCharactersTab({
  campaignId,
  roster,
  allPlayers,
  debts,
  currency,
  sessions,
}: {
  campaignId: number;
  roster: RosterPlayer[];
  allPlayers: Player[];
  debts: CampaignDebt[];
  currency: string;
  sessions: SessionSummary[];
}) {
  const hideFinance = loadHideFinance();
  const run = useAction();
  // Персонажи кампании — тот же ключ, что у пульта.
  const characters = useResource<Character[]>(campaignPaths.characters(campaignId)).data ?? NO_CHARACTERS;
  const sheets = useCharacterSheets(characters);
  const settle = useSettleDebt(campaignId);
  const setStatus = useSetCharacterStatus();
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [peekCharId, setPeekCharId] = useState<number | null>(null);
  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [pcConfirmDialog, pcConfirm] = useConfirm();
  const [pcAlertDialog, showPcAlert] = useAlert();
  const [pcPromptDialog, pcPrompt] = usePrompt();

  async function addToRoster(playerId: number) {
    await run(labelled("Игрок в состав", () => write.post(`/campaigns/${campaignId}/roster/${playerId}`)), {
      affects: rosterAffects(campaignId),
    });
  }
  // «Новый игрок…» (Q9): завести и сразу в состав, не уходя в «Игроков».
  async function createPlayer() {
    const name = (await pcPrompt({ message: "Имя нового игрока", confirmLabel: "Добавить" }))?.trim();
    if (!name) return;
    const created = await run(labelled("Новый игрок", () => write.post<Player>("/players", { name, notes: "" })), {
      affects: [{ kind: "player" }],
      retry: false,
    });
    if (created) await addToRoster(created.id);
  }
  async function removeFromRoster(playerId: number) {
    const ok = await pcConfirm({ message: `Убрать игрока из состава кампании? Персонажи сохранятся.`, confirmLabel: "Убрать", danger: true });
    if (!ok) return;
    await run(labelled("Игрок из состава", () => write.del(`/campaigns/${campaignId}/roster/${playerId}`)), {
      affects: rosterAffects(campaignId),
    });
  }
  async function toggleLeft(playerId: number, currentStatus: string) {
    await run(
      labelled("Состав кампании", () =>
        write.put(`/campaigns/${campaignId}/roster/${playerId}`, { status: currentStatus === "left" ? "active" : "left" })
      ),
      { affects: rosterAffects(campaignId) }
    );
  }

  // Архив — для мусора, созданного по ошибке; погибший — статус, а не архив (Q21).
  async function deleteCharacter(characterId: number, name: string) {
    const ok = await pcConfirm({ message: `Удалить «${name}»? Персонаж уйдёт в Архив, оттуда его можно вернуть.`, confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    await run(labelled("Персонаж в архив", () => write.del(`/characters/${characterId}`)), {
      affects: [{ kind: "character" }, { path: "/archive" }],
    });
  }

  async function addCharacter(playerId: number) {
    const name = (drafts[playerId] ?? "").trim();
    if (!name) return;
    if (characters.some((c) => c.player_id === playerId && c.character_name.toLowerCase() === name.toLowerCase())) {
      showPcAlert("Персонаж с таким именем уже есть у этого игрока.");
      return;
    }
    // Поле закрывается только после записи: при отказе имя остаётся набранным.
    const created = await run(
      labelled("Новый персонаж", () =>
        write.post("/characters", { player_id: playerId, campaign_id: campaignId, character_name: name }).then(() => true)
      ),
      { affects: [{ kind: "character" }], retry: false }
    );
    if (!created) return;
    setDrafts((d) => ({ ...d, [playerId]: "" }));
    setAddingFor(null);
  }

  const available = allPlayers.filter((p) => !roster.some((r) => r.id === p.id));

  // Сводка над делами (Q10, Q25): плашка без данных не рисуется.
  const inRoster = roster.filter((p) => p.roster_status !== "left");
  const active = characters.filter((c) => statusOf(c) === "active" && inRoster.some((p) => p.id === c.player_id));
  const levels = active.map((c) => sheets.get(c.id)).flatMap((i) => (i?.kind === "dnd" && i.level ? [i.level] : []));
  const avgLevel = levels.length ? Math.round(levels.reduce((a, b) => a + b, 0) / levels.length) : null;
  const today = toLocalDateKey();
  const next = sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  // Полоса фактов над делами (Q10, Q25; макет Camp-Party): пустое не рисуется.
  const summary = [
    inRoster.length > 0 && ["Игроки", String(inRoster.length)],
    active.length > 0 && ["Активные", String(active.length)],
    avgLevel != null && ["Ср. уровень", String(avgLevel)],
    next && ["Следующая игра", formatDateKeyRu(next.date)],
  ].filter(Boolean) as [string, string][];

  return (
    <div className="campaign-dossier">
      <header className="d-head campaign-dossier__header">
        <div>
          <h2>Личные дела</h2>
          <div className="d-head__sub">Игроки и их персонажи</div>
        </div>
        {summary.length > 0 && (
          <div className="d-strip">
            {summary.map(([k, v]) => <div key={k}><small>{k}</small><b>{v}</b></div>)}
          </div>
        )}
        <div className="d-head__acts">
          <button type="button" className="d-btn d-btn--primary" aria-haspopup="menu" aria-expanded={!!addMenu}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setAddMenu(addMenu ? null : { x: r.left, y: r.bottom });
            }}>
            Добавить игрока ▾
          </button>
        </div>
        {addMenu && (
          <ContextMenu
            x={addMenu.x}
            y={addMenu.y}
            title="В состав"
            items={[
              ...available.map((p) => ({ label: p.name, onClick: () => void addToRoster(p.id) })),
              { label: "Новый игрок…", dividerBefore: available.length > 0, onClick: () => void createPlayer() },
            ]}
            onClose={() => setAddMenu(null)}
          />
        )}
      </header>
      <CharacterRequestsBlock campaignId={campaignId} />
      {roster.length === 0 ? (
        <EmptyState
          title="Команда ещё не собрана"
          hint="Добавьте первого игрока — его персонажи появятся здесь же, в его деле."
          action={<span className="muted" style={{ fontSize: "var(--fs-meta)" }}>«Добавить игрока» выше ↑</span>}
        />
      ) : (
        <CampaignDossierFiles
          roster={roster} characters={characters} sheets={sheets} debts={debts} currency={currency} hideFinance={hideFinance}
          addingFor={addingFor} drafts={drafts}
          onDraft={(playerId, name) => setDrafts((d) => ({ ...d, [playerId]: name }))}
          onStartAdding={setAddingFor}
          onCancelAdding={() => {
            if (addingFor != null) setDrafts((d) => ({ ...d, [addingFor]: "" }));
            setAddingFor(null);
          }}
          onAddCharacter={(playerId) => void addCharacter(playerId)}
          onPeek={setPeekCharId}
          onStatus={(c, status) => void setStatus(c, status)}
          onDelete={(id, name) => void deleteCharacter(id, name)}
          onSettle={(d) => void settle(d)}
          onToggleLeft={(id, status) => void toggleLeft(id, status)}
          onRemovePlayer={(id) => void removeFromRoster(id)}
        />
      )}
      {characters.length > 0 && <CampaignSquadDates characters={characters} />}
      {pcConfirmDialog}
      {pcAlertDialog}
      {pcPromptDialog}
      {peekCharId != null && <CharacterPeekModal characterId={peekCharId} onClose={() => setPeekCharId(null)} />}
    </div>
  );
}

// Путевые заметки игроков глазами мастера (read-only, решение 2026-09-07):
// как игроки понимают сюжет и что им важно. Без правок и удаления — дневник
// остаётся инструментом игрока, мастер по нему готовится, а не пишет в него.
function PlayerJournalsSection({ campaignId }: { campaignId: number }) {
  type JournalRow = WorldExplorationEntry & { player_name?: string | null; character_name?: string | null };
  const journals = useResource<JournalRow[]>(campaignPaths.playerJournals(campaignId));
  const error = journals.error;
  const rows = useMemo(() => journals.data ?? (error ? [] : null), [journals.data, error]);
  const load = journals.reload;
  const [query, setQuery] = useState("");
  const [author, setAuthor] = useState("all");
  // Авторы колонкой (макет Camp-Party-Journals): игрок, под ним персонаж, число записей.
  const authors = useMemo(() => {
    const map = new Map<string, { player: string; character: string; n: number }>();
    for (const r of rows ?? []) {
      const key = `${r.player_name ?? "—"} · ${r.character_name ?? "без персонажа"}`;
      const a = map.get(key) ?? { player: r.player_name ?? "—", character: r.character_name ?? "без персонажа", n: 0 };
      a.n += 1;
      map.set(key, a);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], "ru"));
  }, [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => (author === "all" ? true : `${r.player_name ?? "—"} · ${r.character_name ?? "без персонажа"}` === author))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [rows, query, author]);
  const head = (
    <div className="d-head">
      <div>
        <h2>Путевые заметки игроков</h2>
        <div className="d-head__sub">как игроки понимают сюжет</div>
      </div>
      <div className="d-head__acts">
        <span className="campaign-readonly">только чтение</span>
      </div>
    </div>
  );
  if (rows === null) return <>{head}<p className="muted">Загрузка…</p></>;
  if (error) {
    return (
      <>
        {head}
        <LoadErrorCard message={<>Заметки не загрузились: {error}</>} onRetry={load} />
      </>
    );
  }
  if (rows.length === 0) return <>{head}<p className="muted">Игроки пока ничего не записали.</p></>;
  return (
    <>
      {head}
      <div className="campaign-journals">
        <aside className="campaign-col" aria-label="Авторы">
          <h3 className="d-plate">Авторы</h3>
          <button type="button" className={author === "all" ? "is-on" : ""} onClick={() => setAuthor("all")}>
            <span>Все авторы</span>
            <span className="campaign-col__n">{rows.length}</span>
          </button>
          {authors.map(([key, a]) => (
            <button key={key} type="button" className={author === key ? "is-on" : ""} onClick={() => setAuthor(key)}>
              <span>
                {a.player}
                <small>{a.character}</small>
              </span>
              <span className="campaign-col__n">{a.n}</span>
            </button>
          ))}
        </aside>
        <div>
          <div className="d-gh">
            <h3 className="d-plate">{author === "all" ? "Все заметки" : authors.find(([k]) => k === author)?.[1].player}</h3>
            <span className="d-note">{visible.length} · новые сверху</span>
            <label className="d-end d-field campaign-journals__search">
              <NavIcon name="search" />
              <input placeholder="Поиск" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Поиск по заметкам игроков" />
            </label>
          </div>
          {visible.length === 0 ? (
            <p className="muted">По этому запросу записей нет — снимите фильтр.</p>
          ) : (
            <ul className="campaign-journals__list">
              {visible.map((r) => (
                <li key={r.id}>
                  <span className="campaign-journals__glyph">
                    {r.kind && <TypeGlyph type={JOURNAL_GLYPH[r.kind]} />}
                  </span>
                  <div>
                    <div className="d-mono">
                      {formatDateKeyRu(r.created_at.slice(0, 10))} · {r.player_name ?? "—"} · {r.character_name ?? "без персонажа"}
                    </div>
                    {r.name && <b>{r.name}</b>}
                    <p>{r.description}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}

// Метка записи дневника → знак типа сущности (находка: раньше выводился сырой ключ).
const JOURNAL_GLYPH: Record<WorldExplorationKind, string> = {
  being: "being",
  location: "location",
  item: "artifact",
  event: "setting_event",
};

function CampaignSquadDates({ characters }: { characters: Character[] }) {
  // Карточки персонажей — тот же ключ, что у профиля персонажа.
  const cards = useQueries({
    queries: characters.map((c) => entityQuery<Character & { important_dates?: ImportantDate[] }>("character", c.id)),
  });
  const dates = characters.flatMap((c, i) =>
    (cards[i]?.data?.important_dates ?? []).map((d) => ({ charId: c.id, charName: c.character_name, date: d }))
  );
  if (dates.length === 0) return null;
  return (
    <section className="d-block campaign-squad-dates" aria-label="Важные даты отряда">
      <h3 className="d-plate">Важные даты отряда</h3>
      <ul>
        {dates.slice(0, 8).map((r) => (
          <li key={`${r.charId}-${r.date.id}`}>
            <span className="d-mono">{r.date.day}.{r.date.month ?? "—"}.{r.date.year ?? "—"}</span>
            <span>
              {r.date.title} · <Link to={`/characters/${r.charId}`}>{r.charName}</Link>
            </span>
          </li>
        ))}
      </ul>
      {dates.length > 8 && <span className="d-note">+ ещё {dates.length - 8}</span>}
    </section>
  );
}

function CharacterPeekModal({ characterId, onClose }: { characterId: number; onClose: () => void }) {
  const char = useEntity<Character>("character", characterId).data ?? null;
  return (
    <Modal onClose={onClose}>
      <div className="stack" style={{ minWidth: 320, maxWidth: 520 }}>
        <h3 style={{ margin: 0 }}>{char ? char.character_name : "Загрузка…"}</h3>
        {char && <div className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Игрок: {char.player_name} · <Link to={`/characters/${char.id}`} onClick={onClose}>Открыть лист →</Link></div>}
        {char && <div className="muted" style={{ fontSize: "var(--fs-meta)" }}>{char.short_name ? `Короткое: ${char.short_name}` : ""}</div>}
        {!char && <p className="muted">Загрузка…</p>}
      </div>
    </Modal>
  );
}


function PlayerCharacterTab({ campaignId }: { campaignId: number }) {
  const run = useAction();
  const self = useResource<Player>(campaignPaths.selfPlayer()).data;
  const chars = useResource<Character[]>(campaignPaths.characters(campaignId)).data;
  const character = self && chars ? (chars.find((c) => c.player_id === self.id) ?? null) : undefined;
  const [nameDraft, setNameDraft] = useState("");

  async function createCharacter() {
    if (!nameDraft.trim() || !self) return;
    const created = await run(
      labelled("Новый персонаж", () =>
        write.post("/characters", { player_id: self.id, campaign_id: campaignId, character_name: nameDraft }).then(() => true)
      ),
      { affects: [{ kind: "character" }], retry: false }
    );
    if (created) setNameDraft("");
  }

  if (character === undefined) return <p className="muted">Загрузка…</p>;

  if (!character) {
    return (
      <div className="card stack">
        <p className="muted">Персонаж для этой кампании ещё не создан.</p>
        <div className="row">
          <input
            placeholder="Имя персонажа"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
          />
          <button className="primary" onClick={createCharacter}>
            Создать персонажа
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="card row">
      {character.thumbnail_image_url || character.avatar_image_url ? (
        <img
          src={character.thumbnail_image_url ?? character.avatar_image_url ?? undefined}
          alt=""
          className="roster-avatar"
        />
      ) : (
        <div className="roster-avatar roster-avatar-placeholder" />
      )}
      <div className="stack">
        <h3>{character.character_name}</h3>
        <Link to={`/characters/${character.id}`}>Открыть полную страницу персонажа →</Link>
      </div>
    </div>
  );
}

// Player-role overview: "Основное" (editable info) + "Персонажи" (the player's
// own character card). Same collapsible-section pattern as the GM overview.
function PlayerOverviewTab({
  campaign,
  systems,
  settingsList,
  sessions,
}: {
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
  sessions: SessionSummary[];
}) {
  const campaignId = campaign.id;
  const reminders = useResource<GmReminder[]>(remindersPath("campaign", campaignId)).data ?? [];
  const today = toLocalDateKey();
  const next = sessions.filter((x) => x.status === "planned" && x.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const [editingMain, setEditingMain] = useState(false);
  const { allGroups, campaignGroupIds, toggleGroup } = useCampaignGroups(campaignId);
  const { save, saving } = useCampaignFieldsSave(campaignId);
  const [form, setForm] = useState({
    name: campaign.name,
    type: campaign.type,
    payment_type: campaign.payment_type,
    payment_frequency: campaign.payment_frequency,
    rate_split: campaign.rate_split,
    session_rate: String(campaign.session_rate ?? 0),
    currency: campaign.currency,
    status: campaign.status,
    system_id: campaign.system_id ? String(campaign.system_id) : "",
    setting_id: campaign.setting_id ? String(campaign.setting_id) : "",
  });


  function startEdit() {
    setForm({
      name: campaign.name,
      type: campaign.type,
      payment_type: campaign.payment_type,
      payment_frequency: campaign.payment_frequency,
      rate_split: campaign.rate_split,
      session_rate: String(campaign.session_rate ?? 0),
      currency: campaign.currency,
      status: campaign.status,
      system_id: campaign.system_id ? String(campaign.system_id) : "",
      setting_id: campaign.setting_id ? String(campaign.setting_id) : "",
    });
    setEditingMain(true);
  }

  const systemName = systems.find((s) => s.id === campaign.system_id)?.name ?? "—";
  const settingName = settingsList.find((s) => s.id === campaign.setting_id)?.name ?? "—";

  // Обзор глазами игрока (макет Camp-Player-Overview): имя кампании и кто
  // ведёт, факты полосой, слева «Напоминания от Мастера» и персонаж, справа
  // «Следующая сессия». Пустые блоки не рисуются (§6.11).
  const rate = campaign.payment_type === "paid" ? `${campaign.session_rate ?? 0} ${campaign.currency} ${campaign.payment_frequency === "per_month" ? "в месяц" : "за сессию"}` : PAYMENT_TYPE_LABELS[campaign.payment_type] ?? campaign.payment_type;
  return (
    <div className="campaign-player-overview">
      <div className="d-head">
        <div>
          <h2>{campaign.name}</h2>
          <div className="d-head__sub">ведёт Мастер{campaign.system_name ? ` · ${campaign.system_name}` : ""}</div>
        </div>
        {!editingMain && (
          <div className="d-head__acts">
            <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={startEdit}>Редактировать</button>
          </div>
        )}
      </div>
          {!editingMain ? (
            <div className="d-strip campaign-player-overview__facts">
              <div><small>Система</small><b>{systemName}</b></div>
              <div><small>Сеттинг</small><b>{settingName}</b></div>
              <div><small>Статус</small><b>{CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}</b></div>
              <div><small>Оплата</small><b>{rate}</b></div>
            </div>
          ) : (
            <div className="campaign-edit-form">
              <label>
                <span className="campaign-field-label">Название</span>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
              </label>
              <label>
                <span className="campaign-field-label">Тип</span>
                <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CampaignType })}>
                  {CAMPAIGN_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </label>
              <label>
                <span className="campaign-field-label">Система</span>
                <select value={form.system_id} onChange={(e) => setForm({ ...form, system_id: e.target.value })}>
                  <option value="">—</option>
                  {systems.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </label>
              <label>
                <span className="campaign-field-label">Сеттинг</span>
                <select value={form.setting_id} onChange={(e) => setForm({ ...form, setting_id: e.target.value })}>
                  <option value="">—</option>
                  {settingsList.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                </select>
              </label>
              <label>
                <span className="campaign-field-label">Статус</span>
                <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {CAMPAIGN_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
              </label>
              <label>
                <span className="campaign-field-label">Оплата</span>
                <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value as PaymentType })}>
                  {PAYMENT_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                </select>
                <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Бесплатная — без учёта · Платная — по ставке · Условно — договорная</span>
              </label>
              {form.payment_type === "paid" && (
                <>
                  <label>
                    <span className="campaign-field-label">Периодичность</span>
                    <select value={form.payment_frequency} onChange={(e) => setForm({ ...form, payment_frequency: e.target.value as PaymentFrequency })}>
                      {PAYMENT_FREQUENCY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  </label>
                  <label>
                    <span className="campaign-field-label">Тип ставки</span>
                    <select value={form.rate_split} onChange={(e) => setForm({ ...form, rate_split: e.target.value as RateSplit })}>
                      {RATE_SPLIT_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
                    </select>
                  </label>
                  <label>
                    <span className="campaign-field-label">Ставка{" "}
                      {form.payment_frequency === "per_month" ? "в месяц" : "за сессию"}
                      {form.rate_split === "per_person" ? " (с человека)" : " (со стола)"}</span>
                    <input type="number" value={form.session_rate} onChange={(e) => setForm({ ...form, session_rate: e.target.value })} placeholder="500" />
                    <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>С человека — сумма × игроков, со стола — фикс за игру</span>
                  </label>
                </>
              )}
              <label>
                <span className="campaign-field-label">Валюта</span>
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </label>
              <div className="campaign-actions">
                <button onClick={() => setEditingMain(false)} disabled={saving}>Отмена</button>
                <button className="primary" disabled={saving} onClick={async () => {
                  // Форма закрывается только после записи: при отказе набранное остаётся.
                  const saved = await save({
                    name: form.name,
                    type: form.type,
                    payment_type: form.payment_type,
                    payment_frequency: form.payment_frequency,
                    rate_split: form.rate_split,
                    session_rate: Number(form.session_rate) || 0,
                    currency: form.currency,
                    status: form.status,
                    system_id: form.system_id ? Number(form.system_id) : null,
                    setting_id: form.setting_id ? Number(form.setting_id) : null,
                  });
                  if (saved) setEditingMain(false);
                }}>{saving ? "Сохранение…" : "Сохранить"}</button>
              </div>
            </div>
          )}

      <div className="campaign-player-overview__cols">
        <div className="campaign-player-overview__main">
          {reminders.length > 0 && (
            <section>
              <div className="d-gh"><h3 className="d-plate">Напоминания от Мастера</h3></div>
              <ul className="campaign-player-overview__reminders">
                {reminders.map((r) => <li key={r.id}>{r.message}</li>)}
              </ul>
            </section>
          )}
          <section>
            <div className="d-gh"><h3 className="d-plate">Персонаж</h3></div>
            <PlayerCharacterTab campaignId={campaignId} />
          </section>
        </div>
        {next && (
          <aside className="d-block campaign-player-overview__next">
            <h3 className="d-plate">Следующая сессия</h3>
            <b>{formatDateKeyRu(next.date)}{next.start_time ? ` · ${next.start_time}` : ""}</b>
            <span>{sessionLabel(next)} · {daysUntilLabel(next.date, today)}</span>
          </aside>
        )}
      </div>
          <div className="campaign-player-overview__groups">
            <span className="campaign-field-label" style={{ fontSize: "var(--fs-meta)" }}>Группы кампаний</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)", marginLeft: 6 }}>папки в списке кампаний ·</span> <Link to="/campaigns" style={{ fontSize: "var(--fs-meta)" }}>Настроить группы →</Link>
            {allGroups.length > 0 ? (
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 4 }}>
                {allGroups.map((g) => {
                  const isIn = campaignGroupIds.includes(g.id);
                  return (
                    <label
                      key={g.id}
                      className={`campaign-group-chip${isIn ? " is-in" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={isIn}
                        onChange={() => void toggleGroup(g.id, isIn)}
                      />
                      {g.name}
                    </label>
                  );
                })}
              </div>
            ) : (
              <div className="muted" style={{ marginTop: 4 }}>Групп пока нет — создайте на странице кампаний.</div>
            )}
          </div>
    </div>
  );
}

// (a live dashboard for an ongoing campaign) + Пост-продакшен (retrospective
// once it's done) — three phases of the same campaign's life, so the section
// that's actually relevant right now opens by default while the other two
// stay collapsed rather than competing for space.
// «Обзор» кампании — досье на бумаге (спека campaign-paper, Q10–Q18; доски
// 41–42). Слева обложка и факты, справа «Сейчас», паспорт и приключения;
// реже нужное — свёртками внизу. «Препродакшен» уехал в паспорт, «Продакшен» —
// в «Сейчас», «Изображения» — в щелчок по обложке, «Пост-продакшен» — в «Итоги».
function OverviewTab({
  section,
  editTick,
  campaign,
  systems,
  settingsList,
  sessions,
}: {
  section: "overview" | "payment";
  /** Щелчок «Редактировать» в шапке: каждый новый номер открывает правку основного. */
  editTick: number;
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
  sessions: SessionSummary[];
}) {
  const campaignId = campaign.id;
  const oneshot = campaign.type === "oneshot";
  const [editing, setEditing] = useState<"main" | "payment" | null>(null);
  const { save, saving } = useCampaignFieldsSave(campaignId);
  const run = useAction();
  const { allGroups, campaignGroupIds, toggleGroup } = useCampaignGroups(campaignId);
  const hideFinance = loadHideFinance();
  const formFrom = (c: CampaignDetail) => ({
    name: c.name,
    type: c.type,
    payment_type: c.payment_type,
    payment_frequency: c.payment_frequency,
    rate_split: c.rate_split,
    session_rate: String(c.session_rate ?? 0),
    currency: c.currency,
    status: c.status,
    system_id: c.system_id ? String(c.system_id) : "",
    setting_id: c.setting_id ? String(c.setting_id) : "",
  });
  const [form, setForm] = useState(() => formFrom(campaign));
  // Загрузка изображения: окно обрезки закрывается сразу, поэтому отказ виден
  // только плашкой.
  function upload(kind: "thumbnail", label: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    void run(labelled(label, () => write.post(`/campaigns/${campaignId}/${kind}`, fd, { timeoutMs: UPLOAD_TIMEOUT_MS })), {
      affects: campaignFieldsAffects(campaignId),
    });
  }
  const thumbCrop = useImageCrop("thumbnail", (file) => upload("thumbnail", "Обложка кампании", file));
  const thumbInput = useRef<HTMLInputElement>(null);

  function start(which: "main" | "payment") {
    setForm(formFrom(campaign));
    setEditing(which);
  }
  // Номер щелчка, уже отработанный: вкладка пересоздаётся (key), и прежний
  // щелчок не должен снова открыть форму.
  const handledTick = useRef(editTick);
  useEffect(() => {
    if (editTick === handledTick.current) return;
    handledTick.current = editTick;
    start("main");
  });
  async function submit() {
    const patch =
      editing === "main"
        ? {
            name: form.name,
            type: form.type,
            status: form.status,
            system_id: form.system_id ? Number(form.system_id) : null,
            setting_id: form.setting_id ? Number(form.setting_id) : null,
          }
        : {
            payment_type: form.payment_type,
            payment_frequency: form.payment_frequency,
            rate_split: form.rate_split,
            session_rate: Number(form.session_rate) || 0,
            currency: form.currency,
          };
    // Форма закрывается только после записи: при отказе набранное остаётся.
    if (await save(patch)) setEditing(null);
  }

  const today = toLocalDateKey();
  const nextSession = sessions.filter((s) => s.status === "planned" && s.date >= today).sort((a, b) => a.date.localeCompare(b.date))[0];
  const lastSession = sessions.filter((s) => s.status === "held").sort((a, b) => b.date.localeCompare(a.date))[0];

  const rawThumbUrl = campaign.thumbnail_image_url ?? campaign.background_image_url ?? null;
  const thumbUrl = rawThumbUrl && isSafeImageUrl(rawThumbUrl) ? rawThumbUrl : null;
  const authThumb = useAuthenticatedFileUrl(thumbUrl?.startsWith("/files/") ? thumbUrl : null);
  const coverSrc = thumbUrl?.startsWith("/files/") ? authThumb : thumbUrl;

  const paymentSummary =
    campaign.payment_type === "paid"
      ? `${campaign.session_rate ?? 0} ${campaign.currency} ${campaign.payment_frequency === "per_month" ? "в месяц" : "за игру"}`
      : (PAYMENT_TYPE_LABELS[campaign.payment_type] ?? campaign.payment_type).toLowerCase();

  const mainForm = (
    <div className="campaign-edit-form">
      <label>
        <span className="campaign-field-label">Название</span>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label>
        <span className="campaign-field-label">Тип</span>
        <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as CampaignType })}>
          {CAMPAIGN_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </label>
      <label>
        <span className="campaign-field-label">Система</span>
        <select value={form.system_id} onChange={(e) => setForm({ ...form, system_id: e.target.value })}>
          <option value="">—</option>
          {systems.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
      </label>
      <label>
        <span className="campaign-field-label">Сеттинг</span>
        <select value={form.setting_id} onChange={(e) => setForm({ ...form, setting_id: e.target.value })}>
          <option value="">—</option>
          {settingsList.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
        </select>
      </label>
      <label>
        <span className="campaign-field-label">Статус</span>
        <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
          {CAMPAIGN_STATUS_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
      </label>
      <div className="campaign-actions">
        <button onClick={() => setEditing(null)} disabled={saving}>Отмена</button>
        <button className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Сохранение…" : "Сохранить"}</button>
      </div>
    </div>
  );

  const paymentForm = (
    <div className="campaign-edit-form">
      <label>
        <span className="campaign-field-label">Оплата</span>
        <select value={form.payment_type} onChange={(e) => setForm({ ...form, payment_type: e.target.value as PaymentType })}>
          {PAYMENT_TYPE_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
        </select>
        <span className="muted">Бесплатная — без учёта · Платная — по ставке · Условно — договорная</span>
      </label>
      {form.payment_type === "paid" && (
        <>
          <label>
            <span className="campaign-field-label">Периодичность</span>
            <select value={form.payment_frequency} onChange={(e) => setForm({ ...form, payment_frequency: e.target.value as PaymentFrequency })}>
              {PAYMENT_FREQUENCY_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </label>
          <label>
            <span className="campaign-field-label">Тип ставки</span>
            <select value={form.rate_split} onChange={(e) => setForm({ ...form, rate_split: e.target.value as RateSplit })}>
              {RATE_SPLIT_OPTIONS.map((o) => (<option key={o.value} value={o.value}>{o.label}</option>))}
            </select>
          </label>
          <label>
            <span className="campaign-field-label">
              Ставка {form.payment_frequency === "per_month" ? "в месяц" : "за сессию"}
              {form.rate_split === "per_person" ? " (с человека)" : " (со стола)"}
            </span>
            <input type="number" value={form.session_rate} onChange={(e) => setForm({ ...form, session_rate: e.target.value })} placeholder="500" />
          </label>
        </>
      )}
      <label>
        <span className="campaign-field-label">Валюта</span>
        <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
      </label>
      <div className="campaign-actions">
        <button onClick={() => setEditing(null)} disabled={saving}>Отмена</button>
        <button className="primary" disabled={saving} onClick={() => void submit()}>{saving ? "Сохранение…" : "Сохранить"}</button>
      </div>
    </div>
  );

  // «Ещё → Оплата» (макет Camp-More): голова с итогом словами, слева
  // условия и «Сверх сессий», справа должники и полученное.
  if (section === "payment") return (
    <section className="campaign-pay">
      <div className="d-head">
        <div>
          <h2>Оплата</h2>
          {!hideFinance && <div className="d-head__sub">{paymentSummary}</div>}
        </div>
        {!hideFinance && editing !== "payment" && (
          <div className="d-head__acts">
            <button type="button" className="d-btn d-btn--sm d-btn--quiet" onClick={() => start("payment")}>
              Править оплату
            </button>
          </div>
        )}
      </div>
        {hideFinance ? (
          <p className="muted">Финансы скрыты в настройках интерфейса.</p>
        ) : (
          <div className="campaign-pay__cols">
          <div className="campaign-pay__main">
              {editing === "payment" ? (
                paymentForm
              ) : (
                <>
                  <dl className="d-strip campaign-pay__facts">
                    <div>
                      <dt>Оплата</dt>
                      <dd>{PAYMENT_TYPE_LABELS[campaign.payment_type] ?? campaign.payment_type}</dd>
                    </div>
                    {campaign.payment_type === "paid" && (
                      <>
                        <div>
                          <dt>Периодичность</dt>
                          <dd>{PAYMENT_FREQUENCY_LABELS[campaign.payment_frequency] ?? campaign.payment_frequency}</dd>
                        </div>
                        <div>
                          <dt>Ставка</dt>
                          <dd>
                            {campaign.session_rate ?? 0} {campaign.currency} · {RATE_SPLIT_LABELS[campaign.rate_split] ?? campaign.rate_split}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <ExtraPayments campaignId={campaignId} roster={campaign.roster} currency={campaign.currency} />
                </>
              )}
          </div>
          <aside className="d-block campaign-pay__aside">
            <CampaignDebtors campaignId={campaignId} currency={campaign.currency} />
            <p className="campaign-pay__earned">
              Получено {campaign.finance.earned} {campaign.currency} за {campaign.finance.heldSessions}{" "}
              {plural(campaign.finance.heldSessions, "сессию", "сессии", "сессий")}
            </p>
          </aside>
          </div>
        )}
    </section>
  );

  return (
    // Макет «Д» (docs/design-system.md §6.8): обложка — справа от названия
    // (в paper.css сетка листа ставит её во вторую колонку героя), ниже две
    // колонки: главный блок и паспорт слева, итог, должники, группы справа.
    <div className="dossier campaign-overview">
      {/* Обложка меняется щелчком по изображению. */}
      <figure className="campaign-overview__cover">
        <button type="button" title="Сменить обложку" onClick={() => thumbInput.current?.click()}>
          {coverSrc ? <img src={coverSrc} alt={`Обложка: ${campaign.name}`} /> : <span className="campaign-overview__cover-empty">{campaign.system_name || "Обложка"}</span>}
        </button>
        <figcaption>Обложка · сменить</figcaption>
      </figure>
      <input ref={thumbInput} hidden type="file" accept={IMAGE_ACCEPT} onChange={(e) => thumbCrop.onSelect(e.target.files?.[0] ?? null)} />
      {thumbCrop.modal}
      {editing === "main" && <div className="campaign-overview__form">{mainForm}</div>}
      <div className="campaign-overview__cols">
      <div className="campaign-overview__col">
        <NextSessionPrep next={nextSession} oneshot={oneshot} />
        <CampaignPassport campaign={campaign} />
        <OldNotesFold campaignId={campaignId} settingId={campaign.setting_id} />
      </div>
      <div className="campaign-overview__col">
        <LastSessionResult last={lastSession} />
        {!hideFinance && <CampaignDebtors campaignId={campaignId} currency={campaign.currency} />}
        {allGroups.length > 0 && (
          <section className="campaign-overview__groups-block d-block" aria-label="Группы">
            <h3 className="d-plate">Группы</h3>
            <div className="campaign-overview__groups">
              {allGroups.map((g) => {
                const isIn = campaignGroupIds.includes(g.id);
                return (
                  <label key={g.id} className={`campaign-group-chip${isIn ? " is-in" : ""}`}>
                    <input type="checkbox" checked={isIn} onChange={() => void toggleGroup(g.id, isIn)} />
                    {g.name}
                  </label>
                );
              })}
            </div>
          </section>
        )}
        {/* Автолинковка — сразу своим свёрнутым блоком: уровень «Связать
            имена» над ним был лишней обёрткой (гриллинг 2026-10-23, Q6). */}
        <CrossLinksWizard
          ownerKind="campaign"
          ownerId={campaignId}
          help="Ищет имена сущностей сеттинга и записей компендиума в текстах кампании — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
        />
      </div>
      </div>
    </div>
  );
}

// «Итоги» (бывший «Пост-продакшен», Q15): свободные записи итогов кампании.
function ResultsTab({ campaign }: { campaign: CampaignDetail }) {
  return (
    <CampaignEntryList
      campaignId={campaign.id}
      category="post_production"
      addLabel="+ Запись"
      emptyLabel="Итогов пока нет."
      defaultSettingId={campaign.setting_id ?? undefined}
      title="Итоги"
      sub="что получилось, эпилоги, несбывшиеся линии, идеи для сиквела"
    />
  );
}

// Загрузка обложки дольше обычной записи: файл до 15 МБ.
const UPLOAD_TIMEOUT_MS = 120_000;

/**
 * «Основное» кампании: сохранение полей через слой. Возвращает true, если
 * записалось; при отказе — плашка «Не сохранилось», форма остаётся с набранным.
 * Раньше отказ (например, переименование упёрлось в папку хранилища) проходил
 * молча.
 */
function useCampaignFieldsSave(campaignId: number) {
  const run = useAction();
  const [saving, setSaving] = useState(false);
  async function save(partial: Record<string, unknown>): Promise<boolean> {
    if (saving) return false;
    setSaving(true);
    try {
      const saved = await run(labelled("Кампания", () => write.put(`/campaigns/${campaignId}`, partial).then(() => true)), {
        affects: campaignFieldsAffects(campaignId),
      });
      return saved === true;
    } finally {
      setSaving(false);
    }
  }
  return { save, saving };
}

/** Группы кампаний на «Обзоре»: все группы, отметки этой кампании и переключатель. */
function useCampaignGroups(campaignId: number) {
  const run = useAction();
  const allGroups = useResource<CampaignGroup[]>(campaignPaths.groups()).data ?? NO_GROUPS;
  const ofCampaign = useResource<CampaignGroup[]>(campaignPaths.groupsOf(campaignId)).data;
  const campaignGroupIds = useMemo(() => (ofCampaign ?? []).map((g) => g.id), [ofCampaign]);
  async function toggleGroup(groupId: number, isIn: boolean) {
    await run(
      labelled("Группа кампаний", () =>
        isIn
          ? write.del(`/campaign-groups/${groupId}/members?campaignIds=${campaignId}`)
          : write.post(`/campaign-groups/${groupId}/members`, { campaignIds: [campaignId] })
      ),
      { affects: campaignGroupAffects() }
    );
  }
  return { allGroups, campaignGroupIds, toggleGroup };
}

const NO_GROUPS: CampaignGroup[] = [];

/** Сдвиг id событий сеттинга в хронике кампании — см. calendarEvents. */
const NO_WORKBOOKS: InstanceSummary[] = [];
const NO_CHARACTERS: Character[] = [];

/** Список тетрадей строками: название и заполненность. */
function WorkbookRows({ books }: { books: InstanceSummary[] }) {
  return (
    <ul className="paper-rows">
      {books.map((w) => (
        <li key={w.id}>
          <Link className="paper-rows__main" to={`/workbooks/${w.id}`}>
            {w.title} →
          </Link>
          <span className="paper-rows__sub">
            {w.template_title}
            {w.progress ? ` · заполнено ${w.progress.filled} из ${w.progress.total}` : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * «Тетрадь» ваншота (спека workbook-rework, Q19) — тетрадь его приключения:
 * первое не служебное приключение кампании. Заведённая раньше тетрадь
 * кампании остаётся строкой ниже и открывается.
 */
function OneshotWorkbook({ campaignId, campaignBooks }: { campaignId: number; campaignBooks: InstanceSummary[] }) {
  // «Сцены вне приключения» — служебная корзина, не приключение ваншота.
  const arcs = useResource<StoryArc[]>(campaignPaths.adventures(campaignId)).data;
  const arc = arcs?.find((a) => !a.is_default);
  const books = useResource<InstanceSummary[]>(arc ? `/workbooks/instances?project_type=adventure&project_id=${arc.id}` : null).data;
  if (!arcs) return <p className="muted">Открываем приключение…</p>;
  return (
    <>
      {!arc ? (
        <EmptyState title="У ваншота пока нет приключения" hint="Тетрадь ваншота — тетрадь его приключения. Добавьте приключение на вкладке «Сюжет»." />
      ) : !books ? (
        <p className="muted">Открываем тетрадь…</p>
      ) : books.length === 0 ? (
        <ProjectWorkbooks type="adventure" id={arc.id} inline />
      ) : books.length === 1 ? (
        <EmbeddedWorkbook id={books[0].id} />
      ) : (
        <WorkbookRows books={books} />
      )}
      {campaignBooks.length > 0 && (
        <section>
          <h3 className="paper-group__head">Тетрадь кампании</h3>
          <WorkbookRows books={campaignBooks} />
        </section>
      )}
    </>
  );
}

/**
 * «+ Приключение» в колонке «Сюжета»: приключения сеттинга, ещё не взятые в
 * кампанию, — меню у кнопки; выбранное открывается сразу.
 */
function CampaignAdventureAdd({ campaignId, onAdded }: { campaignId: number; onAdded: (id: number) => void }) {
  const run = useAction();
  const [at, setAt] = useState<{ x: number; y: number } | null>(null);
  const available = useResource<StoryArc[]>(at ? campaignPaths.availableAdventures(campaignId) : null);
  async function attach(arcId: number) {
    const done = await run(
      labelled("Приключение в кампанию", () =>
        write.post("/story/campaign-adventures", { campaign_id: campaignId, arc_id: arcId }).then(() => true)
      ),
      { affects: campaignAdventureAffects(campaignId), retry: false }
    );
    if (done) onAdded(arcId);
  }
  const list = (available.data ?? []).filter((a) => a.is_default !== 1);
  return (
    <>
      <button
        type="button"
        className="d-btn d-btn--primary"
        aria-haspopup="menu"
        aria-label="Добавить приключение"
        onClick={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setAt(at ? null : { x: r.left, y: r.bottom });
        }}
      >
        +<span className="etw-phone-hide"> Приключение</span>
      </button>
      {at && (
        <ContextMenu
          x={at.x}
          y={at.y}
          title="Из сеттинга"
          items={
            available.data == null
              ? [{ label: "Загрузка…" }]
              : list.length
                ? list.map((a) => ({ label: a.name, hint: `${a.scene_count} ${sceneWord(a.scene_count)}`, onClick: () => void attach(a.id) }))
                : [{ label: "Все приключения сеттинга уже в кампании" }]
          }
          onClose={() => setAt(null)}
        />
      )}
    </>
  );
}
