import type { InstanceSummary } from "../components/workbooks/model";
import { useCompendiumEntries } from "../components/dnd/useCompendiumEntries";
import { liveEffectEntryIds, withLiveEffects } from "../components/dnd/dndFeatures";
import { useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { entityQuery, resourceQuery, useAction, useEntity, useResource, write } from "../data/hooks";
import { afterWriteAnywhere } from "../data/imperative";
import {
  campaignEventAffects,
  campaignFieldsAffects,
  campaignGroupAffects,
  campaignPaths,
  rosterAffects,
} from "../data/campaigns";
import { useQueries } from "@tanstack/react-query";
import { statblockListPath } from "../data/statblocks";
import { chroniclePaths } from "../data/settingPage";
import { sessionMoneyAffects } from "../data/sessions";
import { labelled } from "../data/notices";
import { deriveSheet } from "@shared/dnd/derive";
import { normalizeDndCharacter } from "@shared/dnd/normalize";
import { toLocalDateKey, formatDateKeyRu, parseDateKey } from "../utils/date";
import { copySessionPrep } from "../sessionCopy";
import { Modal } from "../components/Modal";
import { MonthCalendar, type CalendarEvent } from "../components/MonthCalendar";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { CampaignEntryList } from "../components/CampaignEntryList";
import { WorldExplorationTab } from "../components/WorldExplorationTab";
import { CampaignIssuanceTab } from "../components/CampaignIssuanceTab";
import { TaskTracker } from "../components/TaskTracker";
import { CampaignSecrets, type SecretsNavStats } from "../components/CampaignSecrets";
import { CampaignMilestones, type MilestonesNavStats } from "../components/CampaignMilestones";
import { CampaignChaptersScenes, type ChaptersNavStats } from "../components/CampaignChaptersScenes";
import { CampaignAdventuresCard } from "../components/CampaignAdventuresCard";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import { EmptyState } from "../components/EmptyState";
import { RemindersWidget } from "../components/RemindersWidget";
import { CharacterRequestsBlock } from "../components/CharacterRequestsBlock";
import { NavIcon } from "../components/NavIcons";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
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
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useTabState } from "../hooks/useTabState";
import { dateFromElapsed, formatInworldDate, formatEventDate } from "../inworldCalendar";
import { InworldCalendar, type InworldDatedItem } from "../components/InworldCalendar";
import { EntityPage } from "../components/EntityPage";
import { LoadErrorCard } from "../components/Loadable";
import { useImageCrop } from "../hooks/useImageCrop";
import { loadHideFinance } from "../financePrivacy";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { useConfirm, useAlert } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import type {
  CampaignCalendarEvent,
  CampaignDetail,
  CampaignEntry,
  CampaignGroup,
  CampaignType,
  Character,
  ImportantDate,
  PaymentFrequency,
  PaymentType,
  Player,
  RateSplit,
  RosterPlayer,
  SessionStatus,
  SessionSummary,
  Setting,
  SettingCalendarEra,
  SettingCycle,
  System,
  CampaignDebt,
  WorldExplorationEntry,
} from "../types";
import { Timeline } from "../components/Timeline";
import { SettingCyclePanel } from "../components/setting/SettingCyclePanel";
import { SettingCycles } from "../components/SettingCycles";
import { PresentationEditor } from "../components/presentation/PresentationEditor";
import { EntityTabWorkspace } from "../components/EntityTabWorkspace";
import { sessionLabel } from "../sessionLabel";
import { CampaignRevealList } from "../components/RevealList";
import { CampaignVesselsTab } from "../components/CampaignVesselsTab";
import { CampaignPassport } from "../components/campaign/CampaignPassport";
import { CampaignNow } from "../components/campaign/CampaignNow";
import { OldNotesFold } from "../components/campaign/OldNotesFold";
import { ExtraPayments } from "../components/campaign/ExtraPayments";

// Вкладки кампании (спека campaign-paper, Q19/Q20/Q26/Q31). «Сюжет» собрал
// «Главы и сцены», «Вехи», «Тайны и зацепки» и «Выводы» разделами; «Заметок»
// нет — свободные записи живут в листах тетради. «Тетрадь» видна, когда она
// привязана; у ваншота нет «Хроники мира».
const GM_TABS = [
  "Обзор",
  "Игроки и персонажи",
  // Корабли партии — сразу за составом (спека profiles-paper-2, «Корабль кампании»).
  "Транспорт",
  "Сюжет",
  "Сессии",
  "Хроника мира",
  "Тетрадь",
  "Выдача",
] as const;

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
  "Заметки по ведению": "Обзор",
  Заметки: "Обзор",
  "Для игроков": "Выдача",
  "Хроника игр": "Сессии",
  "Главы и сцены": "Сюжет",
  Вехи: "Сюжет",
  "Тайны и зацепки": "Сюжет",
  Выводы: "Сюжет",
} as const;
const PLAYER_TABS = ["Заметки", "Клёвые цитаты", "Трекер задач", "Сессии", "Исследование Мира"] as const;
const PLAYER_TAB_ALIASES = { "Хроника игр": "Сессии" } as const;

// Пустые значения до загрузки — одними ссылками, чтобы useMemo над ними не
// пересчитывался на каждую отрисовку.
const NO_SESSIONS: SessionSummary[] = [];
const NO_PLAYERS: Player[] = [];
const NO_DEBTS: CampaignDebt[] = [];
const NO_CYCLES: SettingCycle[] = [];
const NO_ERAS: SettingCalendarEra[] = [];
const NO_SYSTEMS: System[] = [];
const NO_SETTINGS: Setting[] = [];
const NO_EVENTS: CampaignCalendarEvent[] = [];
const NO_DATES: ImportantDate[] = [];

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
      {campaign.folder_missing && (
        <div className="card campaign-folder-missing">
          <p>
            {campaign.folder_path
              ? "Папки кампании нет в хранилище — её удалили или перенесли."
              : "У кампании нет папки в хранилище."}{" "}
            Файлы загружать и переименовывать кампанию нельзя.
          </p>
          <button onClick={() => void repair()}>Создать папку заново</button>
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
  const gmTabs = GM_TABS.filter(
    (t) => (t !== "Хроника мира" || campaign?.type !== "oneshot") && (t !== "Тетрадь" || workbooks.length > 0)
  );
  const tabs = campaign?.role === "player" ? PLAYER_TABS : gmTabs;
  const [tab, selectTab] = useTabState(
    tabs,
    "Обзор",
    campaign?.role === "player" ? PLAYER_TAB_ALIASES : GM_TAB_ALIASES
  );
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  // Навигация внутри таба «Игроки и персонажи» (Master–Detail).
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
  const [mileStats, setMileStats] = useState<MilestonesNavStats | null>(null);
  const [secStats, setSecStats] = useState<SecretsNavStats | null>(null);
  const { deleteWithUndo } = useUndoDelete();
  // Ось кампании — частный случай оси сеттинга (разбор 2026-10-02, Q1–Q4):
  // панель циклов (сеттинга и свои), эпохи общего таймлайна сеттинга.
  const cycles = useResource<SettingCycle[]>(campaign?.setting_id ? chroniclePaths.cycles(campaign.setting_id, campaignId) : null).data ?? NO_CYCLES;
  const allEras = useResource<SettingCalendarEra[]>(campaign?.setting_id ? chroniclePaths.eras(campaign.setting_id) : null).data ?? NO_ERAS;
  const eras = useMemo(() => allEras.filter((e) => e.timeline_id == null).sort((a, b) => a.start_year - b.start_year), [allEras]);
  const [worldEraId, setWorldEraId] = useState<number | null>(null);
  const cyclesRef = useRef<HTMLDivElement>(null);

  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newStatus, setNewStatus] = useState<SessionStatus>("planned");
  const [newPaymentOverride, setNewPaymentOverride] = useState<"" | PaymentType>("");
  const [newStake, setNewStake] = useState("");
  const [repeatInterval, setRepeatInterval] = useState<"none" | "7" | "14">("none");
  const [repeatCount, setRepeatCount] = useState("4");
  const [newCopyFromSessionId, setNewCopyFromSessionId] = useState("");

  const systems = useResource<System[]>(campaignPaths.systems()).data ?? NO_SYSTEMS;
  const settingsList = useResource<Setting[]>(campaignPaths.settings()).data ?? NO_SETTINGS;

  const [menu, setMenu] = useState<{ x: number; y: number; event: CalendarEvent } | null>(
    null
  );

  // Хроника кампании — свои события и события сеттинга живыми (спека
  // campaign-paper, Q28). У событий сеттинга id из другой таблицы, поэтому в
  // интерфейсе им дан сдвиг SETTING_EVENT_UID: ключи строк и оси не путаются
  // со своими, а путь записи выбирает eventPath.
  const rawEvents =
    useResource<CampaignCalendarEvent[]>(invalidCampaignId ? null : campaignPaths.calendarEvents(campaignId)).data ?? NO_EVENTS;
  const calendarEvents = useMemo(
    () =>
      rawEvents
        .filter((e) => !e.hidden)
        .map((e) => (e.source === "setting" ? { ...e, id: SETTING_EVENT_UID + e.id } : e)),
    [rawEvents]
  );
  const hiddenEvents = useMemo(() => rawEvents.filter((e) => e.hidden), [rawEvents]);
  const eventAffects = (id?: number) => [
    ...campaignEventAffects(campaignId, id),
    ...(campaign?.setting_id && id != null && isSettingEvent(id) ? [{ path: chroniclePaths.events(campaign.setting_id) }] : []),
  ];
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const settingImportantDates =
    useResource<ImportantDate[]>(campaign?.setting_id ? chroniclePaths.importantDates(campaign.setting_id) : null).data ?? NO_DATES;
  const [calendarMenu, setCalendarMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(
    null
  );
  const [eventModal, setEventModal] = useState<{
    id?: number;
    year: number;
    month: number;
    day: number;
    title: string;
    description: string;
    important: boolean;
    precision: import("../types").DatePrecision;
    status: import("../types").EventStatus;
    year_end: string;
    month_end: string;
    day_end: string;
    cancel_note: string;
  } | null>(null);
  const [worldFilter, setWorldFilter] = useState("");
  const [worldSort, setWorldSort] = useState<"asc" | "desc">("asc");
  const sortedCalendarEvents = useMemo(() => [...calendarEvents].sort((a, b) => {
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;
    if (a.inworld_year !== b.inworld_year) return a.inworld_year - b.inworld_year;
    if (a.inworld_month !== b.inworld_month) return a.inworld_month - b.inworld_month;
    return a.inworld_day - b.inworld_day;
  }), [calendarEvents]);
  const worldFiltered = useMemo(() => {
    const q = worldFilter.trim().toLowerCase();
    let list = sortedCalendarEvents;
    if (q) list = list.filter((ev) => ev.title.toLowerCase().includes(q) || (ev.description ?? "").toLowerCase().includes(q));
    const era = eras.find((e) => e.id === worldEraId);
    if (era) {
      const endYear = eras.find((e) => e.start_year > era.start_year)?.start_year ?? Infinity;
      list = list.filter((ev) => ev.inworld_year >= era.start_year && ev.inworld_year < endYear);
    }
    if (worldSort === "desc") list = [...list].reverse();
    return list;
  }, [sortedCalendarEvents, worldFilter, worldSort, eras, worldEraId]);
  const timelineNow = useMemo(() => {
    const held = sessions.filter((s) => s.status === "held" && s.inworld_year != null);
    if (held.length > 0) {
      const sorted = [...held].sort((a, b) => {
        const aY = a.inworld_year_end ?? a.inworld_year!;
        const bY = b.inworld_year_end ?? b.inworld_year!;
        if (aY !== bY) return aY - bY;
        const aM = a.inworld_month_end ?? a.inworld_month!;
        const bM = b.inworld_month_end ?? b.inworld_month!;
        if (aM !== bM) return aM - bM;
        const aD = a.inworld_day_end ?? a.inworld_day!;
        const bD = b.inworld_day_end ?? b.inworld_day!;
        return aD - bD;
      });
      const last = sorted[sorted.length - 1];
      return {
        year: last.inworld_year_end ?? last.inworld_year!,
        month: last.inworld_month_end ?? last.inworld_month!,
        day: last.inworld_day_end ?? last.inworld_day!,
      };
    }
    if (campaign?.pinned_calendar_year != null && campaign?.pinned_calendar_month != null) {
      return { year: campaign.pinned_calendar_year, month: campaign.pinned_calendar_month, day: 1 };
    }
    return null;
  }, [sessions, campaign]);
  const inworldTodayStr = useMemo(() => {
    if (!calendar || !timelineNow) return null;
    const monthName = calendar.months.find((m) => m.position === timelineNow.month)?.name ?? String(timelineNow.month);
    return "Сегодня: " + timelineNow.day + " " + monthName + " " + timelineNow.year + (calendar.era ? " " + calendar.era : "");
  }, [calendar, timelineNow]);
  const [chronicleFilter, setChronicleFilter] = useState("");
  const [chronicleSort] = useState<"asc" | "desc">("desc");
  const chronicleFiltered = useMemo(() => {
    let list = sessions.filter((s) => s.status !== "cancelled");
    if (chronicleFilter.trim()) {
      const q = chronicleFilter.trim().toLowerCase();
      list = list.filter((s) => s.title?.toLowerCase().includes(q) || s.date.includes(q) || (s.notes_text ?? "").toLowerCase().includes(q));
    }
    return [...list].sort((a, b) => chronicleSort === "asc" ? a.date.localeCompare(b.date) : b.date.localeCompare(a.date));
  }, [sessions, chronicleFilter, chronicleSort]);
  const axisRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLDivElement>(null);
  const [timelineFocus, setTimelineFocus] = useState<{ year: number; month: number; day: number } | null>(null);
  const [calendarFocus, setCalendarFocus] = useState<{ year: number; month: number } | null>(null);

  if (invalidCampaignId) return <div className="stack" style={{ padding: 24 }}><p>Кампания не найдена</p><Link to="/campaigns">К списку кампаний →</Link></div>;
  if (campaignState.error && !campaign) return <div className="stack" style={{ padding: 24 }}><p className="muted">{campaignState.error}</p><button onClick={campaignState.reload}>Повторить</button></div>;
  if (!campaign) return <p className="muted">Загрузка…</p>;

  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    paymentType: s.effective_payment_type,
    campaignRole: campaign.role,
    label: sessionLabel(s),
  }));

  const inworldItems: InworldDatedItem[] = [
    ...sessions
      .filter((s) => s.inworld_year != null && s.inworld_month != null && s.inworld_day != null)
      .map((s) => ({
        id: `session-${s.id}`,
        year: s.inworld_year!,
        month: s.inworld_month!,
        day: s.inworld_day!,
        label: sessionLabel(s),
        kind: "session" as const,
      })),
    ...calendarEvents.map((e) => ({
      id: `event-${e.id}`,
      year: e.inworld_year,
      month: e.inworld_month,
      day: e.inworld_day,
      label: e.title,
      kind: "event" as const,
      important: !!e.important,
    })),
  ];

  function openCreateEventModal(year: number, month: number, day: number) {
    setEventModal({ year, month, day, title: "", description: "", important: false, precision: "day", status: "happened", year_end: "", month_end: "", day_end: "", cancel_note: "" });
    setCalendarMenu(null);
  }

  function openEditEventModal(ev: CampaignCalendarEvent) {
    setEventModal({
      id: ev.id,
      year: ev.inworld_year,
      month: ev.inworld_month,
      day: ev.inworld_day,
      title: ev.title,
      description: ev.description,
      important: !!ev.important,
      precision: ev.date_precision ?? "day",
      status: ev.status ?? "happened",
      year_end: ev.inworld_year_end != null ? String(ev.inworld_year_end) : "",
      month_end: ev.inworld_month_end != null ? String(ev.inworld_month_end) : "",
      day_end: ev.inworld_day_end != null ? String(ev.inworld_day_end) : "",
      cancel_note: ev.cancel_note ?? "",
    });
    setCalendarMenu(null);
  }

  async function deleteCalendarEvent(eventId: number) {
    // Событие мира принадлежит сеттингу: кампания только прячет его у себя (Q28).
    if (isSettingEvent(eventId)) {
      setCalendarMenu(null);
      await setEventHidden(eventId - SETTING_EVENT_UID, true);
      return;
    }
    const ok = await confirm({ message: "Удалить событие?", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    setCalendarMenu(null);
    await run(labelled("Событие хроники", () => write.del(eventPath(eventId))), {
      affects: eventAffects(eventId),
    });
  }

  async function setEventHidden(settingEventId: number, hidden: boolean) {
    await run(
      labelled("Событие мира", () => write.put(`/campaigns/${campaignId}/hidden-events/${settingEventId}`, { hidden })),
      { affects: [...campaignEventAffects(campaignId), { path: `/player` }] }
    );
  }

  async function toggleEventImportant(ev: CampaignCalendarEvent) {
    await run(labelled("Событие хроники", () => write.put(eventPath(ev.id), { important: !ev.important })), {
      affects: eventAffects(ev.id),
    });
  }

  // Сдвиг события по оси: точность приходит от масштаба, на котором бросили.
  async function moveCampaignEvent(
    id: number,
    date: { year: number; month: number; day: number; precision: string }
  ) {
    // Сессию по оси не двигают: её внутриигровая дата — часть записи о
    // проведённой игре, и менять её мимо страницы сессии значило бы править
    // историю жестом, который задумывался как «переставить план».
    if (id < 0) return;
    await run(
      labelled("Событие хроники", () =>
        write.put(eventPath(id), {
          inworld_year: date.year,
          inworld_month: date.month,
          inworld_day: date.day,
          date_precision: date.precision,
        })
      ),
      { affects: eventAffects(id) }
    );
  }

  async function pinCampaignCalendar(pinned: { year: number; month: number } | null) {
    await run(
      labelled("Месяц календаря", () =>
        write.put(`/campaigns/${campaignId}/pinned-calendar`, {
          year: pinned?.year ?? null,
          month: pinned?.month ?? null,
        })
      ),
      { affects: campaignFieldsAffects(campaignId) }
    );
  }

  async function saveEventModal() {
    if (!eventModal || !eventModal.title.trim()) return;
    const hasPeriod = eventModal.year_end.trim() !== "" || eventModal.month_end.trim() !== "" || eventModal.day_end.trim() !== "";
    // Валидация порядка start/end: конец периода не может быть раньше начала.
    if (hasPeriod) {
      const sy = Number(eventModal.year) || 0;
      const ey = eventModal.year_end.trim() !== "" ? Number(eventModal.year_end) : sy;
      const sm = Number(eventModal.month) || 1;
      const em = eventModal.month_end.trim() !== "" ? Number(eventModal.month_end) : sm;
      const sd = Number(eventModal.day) || 1;
      const ed = eventModal.day_end.trim() !== "" ? Number(eventModal.day_end) : sd;
      if (ey < sy || (ey === sy && em < sm) || (ey === sy && em === sm && ed < sd)) {
        showAlert("Дата окончания периода раньше даты начала.");
        return;
      }
    }
    const payload: Record<string, unknown> = {
      title: eventModal.title,
      description: eventModal.description,
      inworld_year: eventModal.year,
      inworld_month: eventModal.month,
      inworld_day: eventModal.day,
      important: eventModal.important,
      date_precision: eventModal.precision,
      status: eventModal.status,
      cancel_note: eventModal.cancel_note,
      inworld_year_end: hasPeriod && eventModal.year_end.trim() !== "" ? Number(eventModal.year_end) : hasPeriod ? eventModal.year : null,
      inworld_month_end: hasPeriod && eventModal.month_end.trim() !== "" ? Number(eventModal.month_end) : hasPeriod ? eventModal.month : null,
      inworld_day_end: hasPeriod && eventModal.day_end.trim() !== "" ? Number(eventModal.day_end) : hasPeriod ? eventModal.day : null,
    };
    if (!hasPeriod) { payload.inworld_year_end = null; payload.inworld_month_end = null; payload.inworld_day_end = null; }
    // Окно закрывается только после записи: при отказе набранное остаётся.
    if (eventModal.id) {
      const eventId = eventModal.id;
      const original = calendarEvents.find((e) => e.id === eventId);
      const saved = await run(
        labelled("Событие хроники", () => write.put(eventPath(eventId), payload).then(() => true)),
        { affects: eventAffects(eventId) }
      );
      if (!saved) return;
      if (isSettingEvent(eventId))
        await syncMentionLinks("setting_event", eventId - SETTING_EVENT_UID, original?.description ?? "", eventModal.description);
      else await syncMentionLinks("campaign_event", eventId, original?.description ?? "", eventModal.description);
    } else {
      const created = await run(
        labelled("Новое событие", () => write.post<CampaignCalendarEvent>(`/campaigns/${campaignId}/calendar-events`, payload)),
        { affects: campaignEventAffects(campaignId), retry: false }
      );
      if (!created) return;
      await syncMentionLinks("campaign_event", created.id, "", eventModal.description);
    }
    setEventModal(null);
  }

  function handleCalendarDayContextMenu(year: number, month: number, day: number, x: number, y: number) {
    const dayEvents = calendarEvents.filter((ev) => ev.inworld_year === year && ev.inworld_month === month && ev.inworld_day === day);
    const daySessions = sessions.filter((s) => s.inworld_year === year && s.inworld_month === month && s.inworld_day === day);
    const items: import("../components/ContextMenu").ContextMenuItem[] = [];
    if (dayEvents.length > 0) {
      for (const ev of dayEvents) {
        items.push({ label: `Событие: ${ev.title}`, onClick: () => openEditEventModal(ev) });
      }
    }
    if (daySessions.length > 0) {
      for (const s of daySessions) {
        items.push({ label: `Сессия: ${sessionLabel(s)}`, onClick: () => navigate(`/sessions/${s.id}`) });
      }
    }
    items.push({ label: "Создать событие", onClick: () => openCreateEventModal(year, month, day) });
    setCalendarMenu({ x, y, items });
  }

  function handleCalendarItemContextMenu(item: InworldDatedItem, x: number, y: number) {
    if (item.kind !== "event") return;
    const ev = calendarEvents.find((e) => `event-${e.id}` === item.id);
    if (!ev) return;
    setCalendarMenu({
      x,
      y,
      items: [
        { label: "Редактировать", onClick: () => openEditEventModal(ev) },
        isSettingEvent(ev.id)
          ? { label: "Скрыть у кампании", onClick: () => deleteCalendarEvent(ev.id) }
          : { label: "Удалить", danger: true, onClick: () => deleteCalendarEvent(ev.id) },
      ],
    });
  }

  function handleCalendarItemClick(item: InworldDatedItem) {
    if (item.kind === "session") {
      navigate(`/sessions/${item.id.replace("session-", "")}`);
    }
  }

  function toggleEventExpanded(eventId: number) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

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
        label: "Удалить (в архив)",
        danger: true,
        onClick: () =>
          void run(labelled("Сессия в архив", () => write.del(`/sessions/${event.id}`)), {
            affects: [...sessionMoneyAffects(event.id, campaignId), { path: "/archive" }],
          }),
      },
    ];
  }

  async function archiveSession(sessionId: number) {
    const ok = await confirm({ message: "Отправить сессию в архив?", confirmLabel: "Архивировать", danger: true });
    if (!ok) return;
    await run(labelled("Сессия в архив", () => write.del(`/sessions/${sessionId}`)), {
      affects: [...sessionMoneyAffects(sessionId, campaignId), { path: "/archive" }],
    });
  }

  const safeBgLayer = safeBackgroundImage(campaign.background_image_url && isSafeImageUrl(campaign.background_image_url) ? campaign.background_image_url : null);
  return (
    <EntityPage
      crumbs={[{ label: "Кампании", to: "/campaigns" }, { label: campaign.name }]}
      entityType="campaign"
      title={campaign.name}
      badges={
        campaign.role === "player" ? (
          <span className="badge role-player-badge zine-rotate">Я игрок</span>
        ) : (
          !loadHideFinance() && (
            <span className="badge tag">
              <span className="campaign-earned">{campaign.finance.earned}</span> {campaign.currency}
            </span>
          )
        )
      }
      // Бумага (спека campaign-paper, доски 41–42): под именем — метки типа
      // и системы; статус — в фактах «Обзора».
      paper
      meta={
        <span className="paper-ident-tags">
          <span className="badge tag">{CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === campaign.type)?.label ?? campaign.type}</span>
          {campaign.system_name && <span className="badge tag">{campaign.system_name}</span>}
        </span>
      }
      backdrop={safeBgLayer}
      actions={[{ label: "Архивировать", danger: true, onClick: archiveCampaign }]}
      tabs={tabs}
      tab={tab}
      onTab={(t) => selectTab(t as (typeof tabs)[number])}
    >
      <CampaignFolderNotice campaign={campaign} />

      {tab === "Обзор" && campaign.role === "player" && (
        <PlayerOverviewTab campaign={campaign} systems={systems} settingsList={settingsList} />
      )}

      {tab === "Заметки" && campaign.role === "player" && (
        <CampaignEntryList
          campaignId={campaignId}
          category="notes"
          addLabel="+ Добавить заметку"
          emptyLabel="Заметок пока нет."
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Клёвые цитаты" && (
        <CampaignEntryList
          campaignId={campaignId}
          category="quotes"
          addLabel="+ Добавить цитату"
          emptyLabel="Цитат пока нет."
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Трекер задач" && (
        <TaskTracker campaignId={campaignId} defaultSettingId={campaign.setting_id ?? undefined} />
      )}

      {tab === "Сюжет" && (
        <EntityTabWorkspace
          sections={[
            {
              id: "chapters",
              label: "Главы и сцены",
              count: (chapStats?.adventures ?? []).reduce((n, a) => n + a.scenes, 0),
              items: (chapStats?.adventures ?? []).map((a) => ({ id: String(a.id), label: `${a.name} · ${a.scenes}` })),
            },
            {
              id: "milestones",
              label: "Вехи",
              count: (mileStats?.own.total ?? 0) + (mileStats?.groups ?? []).reduce((n, g) => n + g.total, 0),
              items: [
                { id: "own", label: `Свои · ${mileStats?.own.done ?? 0}/${mileStats?.own.total ?? 0}` },
                ...(mileStats?.groups ?? []).map((g) => ({ id: String(g.id), label: `${g.name} · ${g.done}/${g.total}` })),
              ],
            },
            {
              id: "secrets",
              label: "Тайны и зацепки",
              count: (secStats?.own.total ?? 0) + (secStats?.groups ?? []).reduce((n, g) => n + g.total, 0),
              items: [
                { id: "own", label: `Свои · ${secStats?.own.done ?? 0}/${secStats?.own.total ?? 0}` },
                ...(secStats?.groups ?? []).map((g) => ({ id: String(g.id), label: `${g.name} · ${g.done}/${g.total}` })),
              ],
            },
            { id: "reveals", label: "Выводы" },
          ]}
          selection={storySel}
          onSelect={setStorySel}
          workspaceKey={campaignId}
        >
          {storySel.section === "chapters" && (
            <CampaignChaptersScenes
              campaignId={campaignId}
              settingId={campaign.setting_id}
              adventureId={storySel.item != null ? Number(storySel.item) : null}
              chapterId={null}
              onStats={(st) => setChapStats((prev) => (JSON.stringify(prev) === JSON.stringify(st) ? prev : st))}
            />
          )}
          {storySel.section === "milestones" && (
            <CampaignMilestones
              campaignId={campaignId}
              settingId={campaign.setting_id}
              groupId={storySel.item ?? null}
              onStats={(st) => setMileStats((prev) => (JSON.stringify(prev) === JSON.stringify(st) ? prev : st))}
            />
          )}
          {storySel.section === "secrets" && (
            <CampaignSecrets
              campaignId={campaignId}
              settingId={campaign.setting_id}
              groupId={storySel.item ?? null}
              onStats={(st) => setSecStats((prev) => (JSON.stringify(prev) === JSON.stringify(st) ? prev : st))}
            />
          )}
          {storySel.section === "reveals" && <CampaignRevealList campaignId={campaignId} />}
        </EntityTabWorkspace>
      )}

      {tab === "Тетрадь" && (
        // Свободные записи кампании — в листах тетради (Q31), как у сеттинга.
        <section className="paper-groups" aria-label="Тетрадь кампании">
          <ul className="paper-rows">
            {workbooks.map((w) => (
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
        </section>
      )}

        {tab === "Обзор" && campaign.role !== "player" && (
           <>
             <OverviewTab
               campaign={campaign}
               systems={systems}
               settingsList={settingsList}
               sessions={sessions}
               onSchedule={() => setCreatingDate(toLocalDateKey(new Date()))}
               onSecrets={() => openStory("secrets")}
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

      {tab === "Игроки и персонажи" && (
        <EntityTabWorkspace
          sections={[
            { id: "roster", label: "Состав", count: campaign.roster.length },
            { id: "reminders", label: "Напоминания" },
            { id: "journals", label: "Путевые заметки" },
          ]}
          selection={playersSel}
          onSelect={setPlayersSel}
          workspaceKey={campaignId}
        >
          {playersSel.section === "roster" && (
          <section className="stack">
            <div className="section-heading-sub">
              <h3 className="section-heading-sub-title"><span className="section-heading-sub-icon" aria-hidden="true">◆</span> Состав</h3>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{campaign.roster.length} в игре</span>
            </div>
            <CharacterRequestsBlock campaignId={campaignId} />
            <PlayersAndCharactersTab
              campaignId={campaignId}
              roster={campaign.roster}
              allPlayers={allPlayers}
              debts={debts}
              currency={campaign.currency}
            />
          </section>
          )}
          {playersSel.section === "reminders" && (
          <section className="stack">
            <div className="section-heading-sub">
              <h3 className="section-heading-sub-title"><span className="section-heading-sub-icon" aria-hidden="true">✦</span> Напоминания игрокам</h3>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>видны на Главной игроков</span>
            </div>
            <RemindersWidget targetType="campaign" targetId={campaignId} />
          </section>
          )}
          {playersSel.section === "journals" && (
          <section className="stack">
            <div className="section-heading-sub">
              <h3 className="section-heading-sub-title"><span className="section-heading-sub-icon" aria-hidden="true">◈</span> Путевые заметки игроков</h3>
              <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>только чтение — как игроки понимают сюжет</span>
            </div>
            <PlayerJournalsSection campaignId={campaignId} />
          </section>
          )}
        </EntityTabWorkspace>
      )}

      {tab === "Транспорт" && <CampaignVesselsTab campaignId={campaignId} />}

      {tab === "Сессии" && (
        <div className="chronicle-split">
          <div className="chronicle-left">
            {(() => {
              const filtered = chronicleFiltered;
              return (
                <details className="card res-group" open style={{ margin: 0 }}>
                  <summary className="res-group__band">
                    <span className="res-group__title">Все сессии</span>
                    <span className="res-group__count">
                      {filtered.length} из {sessions.length}
                    </span>
                  </summary>
                  <div className="res-group__body" style={{ padding: 12, gap: 12, display: "flex", flexDirection: "column" }}>
                    <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                      <input
                        placeholder="Поиск по названию, дате, событиям"
                        value={chronicleFilter}
                        onChange={(e) => setChronicleFilter(e.target.value)}
                        style={{ flex: "1 1 220px", minWidth: 180 }}
                      />
                      {chronicleFilter && (
                        <button onClick={() => setChronicleFilter("")}>Сбросить</button>
                      )}
                    </div>

                    {sessions.length === 0 ? (
                      <EmptyState
                        title="Сессий пока нет"
                        hint="Запланируйте первую игру — здесь появится лента сыгранных сессий."
                        action={
                          <button className="primary" onClick={() => setCreatingDate(toLocalDateKey(new Date()))}>
                            + Запланировать сессию
                          </button>
                        }
                      />
                    ) : filtered.length === 0 ? (
                      <p className="muted">
                        Ничего не найдено.{" "}
                        <button onClick={() => setChronicleFilter("")}>
                          Сбросить фильтр
                        </button>
                      </p>
                    ) : (
                      // Строками по группам (спека campaign-paper, Q23): впереди —
                      // от ближайшей, сыгранные — от последней. Отменённых нет.
                      ([
                        ["Запланированы", filtered.filter((x) => x.status === "planned").sort((x, y) => x.date.localeCompare(y.date))],
                        ["Сыграны", filtered.filter((x) => x.status === "held").sort((x, y) => y.date.localeCompare(x.date))],
                      ] as const).map(([title, list]) =>
                        list.length === 0 ? null : (
                          <section key={title} className="paper-list-group">
                            <h3 className="paper-group__head">
                              {title} <span className="paper-group__count">· {list.length}</span>
                            </h3>
                            <ul className="paper-rows session-rows">
                              {list.map((x) => {
                                const inworld = calendar
                                  ? formatInworldDate(x.inworld_year, x.inworld_month, x.inworld_day, calendar.months, calendar.era)
                                  : "";
                                const first = x.notes_text?.split("\n").find((l) => l.trim())?.trim() ?? "";
                                return (
                                  <li key={x.id}>
                                    <span className="paper-rows__main">
                                      <Link to={`/sessions/${x.id}`}>
                                        {formatDateKeyRu(x.date)} — {sessionLabel(x)}
                                      </Link>
                                      {first ? (
                                        <span className="session-rows__line">
                                          <MentionText text={first} />
                                        </span>
                                      ) : (
                                        x.status === "held" && (
                                          <span className="session-rows__line muted">
                                            лента пуста · <Link to={`/sessions/${x.id}`}>дописать</Link>
                                          </span>
                                        )
                                      )}
                                    </span>
                                    {inworld && <span className="paper-rows__sub">{inworld}</span>}
                                    <button className="comp-mini" onClick={() => archiveSession(x.id)} title="В архив" aria-label="Архивировать сессию">
                                      ✕
                                    </button>
                                  </li>
                                );
                              })}
                            </ul>
                          </section>
                        )
                      )
                    )}
                  </div>
                </details>
              );
            })()}
          </div>
          <div className="chronicle-right stack" style={{ gap: "var(--sp-6)" }}>
            {(() => {
              const todayKey = toLocalDateKey(new Date());
              const sorted = [...sessions].sort((a, b) => a.date.localeCompare(b.date));
              const nextPlanned = sorted.find((s) => s.status === "planned" && s.date >= todayKey) || sorted.find((s) => s.status === "planned") || null;
              const diffDays = nextPlanned ? Math.round((parseDateKey(nextPlanned.date).getTime() - parseDateKey(todayKey).getTime()) / 86400000) : null;
              const diffLabel = diffDays == null ? null : diffDays === 0 ? "сегодня" : diffDays === 1 ? "завтра" : diffDays > 0 ? `через ${diffDays} дн.` : `${Math.abs(diffDays)} дн. назад`;
              return (
                <details className="card res-group" open>
                  <summary className="res-group__band">
                    <span className="res-group__title">Календарь игр</span>
                    <span className="res-group__count" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
                      {nextPlanned ? (
                        <span>
                          след. <span style={{ color: "var(--on-surface)" }}>{formatDateKeyRu(nextPlanned.date)}</span>
                          {nextPlanned.start_time ? ` ${nextPlanned.start_time}` : ""} · {sessionLabel(nextPlanned)}
                          {diffLabel ? ` · ${diffLabel}` : ""}
                        </span>
                      ) : (
                        <span>{sessions.filter((s) => s.status !== "cancelled").length} игр · проведено {campaign.finance.heldSessions}</span>
                      )}
                    </span>
                  </summary>
                  <div className="res-group__body" style={{ padding: 12 }}>
                    <MonthCalendar
                      events={events}
                      onDayClick={(date) => setCreatingDate(date)}
                      onEventClick={(e) => navigate(`/sessions/${e.id}`)}
                      onEventContextMenu={(event, x, y) => setMenu({ x, y, event })}
                    />


                  </div>
                </details>
              );
            })()}
            {campaign.role !== "player" && !loadHideFinance() && (
              <details className="card res-group" open>
                <summary className="res-group__band">
                  <span className="res-group__title">Финансы</span>
                  <span className="res-group__count">
                    <span style={{ fontFamily: "var(--font-mono)" }}>{campaign.finance.earned}</span> {campaign.currency} · {PAYMENT_TYPE_LABELS[campaign.payment_type].toLowerCase()}
                  </span>
                </summary>
                <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
                  <div>
                    Проведено сессий: <span style={{ fontFamily: "var(--font-mono)" }}>{campaign.finance.heldSessions}</span>
                  </div>
                  <div>Оплата: {PAYMENT_TYPE_LABELS[campaign.payment_type]}</div>
                  {campaign.payment_type === "paid" && (
                    <div>
                      Ставка: {campaign.session_rate} {campaign.currency} ({PAYMENT_FREQUENCY_LABELS[campaign.payment_frequency].toLowerCase()},{" "}
                      {RATE_SPLIT_LABELS[campaign.rate_split].toLowerCase()})
                    </div>
                  )}
                </div>
              </details>
            )}
          </div>
        </div>
      )}

      {tab === "Исследование Мира" && <WorldExplorationTab campaignId={campaignId} />}

      {tab === "Хроника мира" && (
        <div className="stack" style={{ gap: "var(--sp-7)" }}>
          <div ref={axisRef} className="card stack" style={{ gap: 8 }}>
            <Timeline
              title="Ось времени"
              action={<button className="primary" onClick={() => openCreateEventModal(timelineNow?.year ?? 1, timelineNow?.month ?? 1, timelineNow?.day ?? 1)}>+ Создать событие</button>}
              focusDate={timelineFocus}
              events={[
                ...sortedCalendarEvents.map((ev) => ({
                  id: ev.id,
                  title: ev.title,
                  year: ev.inworld_year,
                  month: ev.inworld_month,
                  day: ev.inworld_day,
                  precision: ev.date_precision,
                  year_end: ev.inworld_year_end,
                  month_end: ev.inworld_month_end,
                  day_end: ev.inworld_day_end,
                  status: ev.status,
                  important: ev.important === 1,
                  kind: "event" as const,
                })),
                ...sessions
                  .filter((s) => s.inworld_year != null && s.status !== "cancelled")
                  .map((s) => ({
                    id: -s.id,
                    title: sessionLabel(s),
                    year: s.inworld_year as number,
                    month: s.inworld_month ?? 1,
                    day: s.inworld_day ?? 1,
                    precision: "day" as const,
                    year_end: s.inworld_year_end ?? null,
                    month_end: s.inworld_month_end ?? null,
                    day_end: s.inworld_day_end ?? null,
                    status: "happened" as const,
                    important: false,
                    kind: "session" as const,
                  })),
              ]}
              months={calendar?.months ?? []}
              era={calendar?.era ?? ""}
              eras={eras}
              now={timelineNow}
              below={(view) =>
                campaign.setting_id ? (
                  <SettingCyclePanel
                    settingId={campaign.setting_id}
                    campaignId={campaignId}
                    cycles={cycles}
                    view={view}
                    onAddCycle={() => cyclesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}
                    onDayMenu={(day, x, y) => {
                      const date = dateFromElapsed(day, calendar?.months ?? []);
                      setCalendarMenu({
                        x,
                        y,
                        items: [{ label: "Событие на этот день", onClick: () => openCreateEventModal(date.year, date.month, date.day) }],
                      });
                    }}
                  />
                ) : null
              }
              importantDates={settingImportantDates}
              onMoveEvent={moveCampaignEvent}
              onNowChange={(date) => pinCampaignCalendar(date)}
              onEventClick={(id) => {
                if (id < 0) navigate(`/sessions/${-id}`);
              }}
            />
          </div>
          <div className="chronicle-split">
            <div className="chronicle-left">
              <details className="card res-group" open style={{ margin: 0 }}>
                <summary className="res-group__band">
                  <span className="res-group__title">События</span>
                  <span className="res-group__count">{worldFiltered.length} из {sortedCalendarEvents.length}</span>
                </summary>
                <div className="res-group__body" style={{ padding: 12, gap: 12, display: "flex", flexDirection: "column" }}>
                  <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                    <input placeholder="Поиск по хронике мира" value={worldFilter} onChange={(e) => setWorldFilter(e.target.value)} style={{ flex: "1 1 200px" }} />
                    <button onClick={() => setWorldSort((s) => (s === "asc" ? "desc" : "asc"))}>{worldSort === "asc" ? "↑ Старые → новые" : "↓ Новые → старые"}</button>
                    {eras.length > 0 && (
                      <select value={worldEraId ?? ""} onChange={(e) => setWorldEraId(e.target.value ? Number(e.target.value) : null)} aria-label="Эпоха">
                        <option value="">Все эпохи</option>
                        {eras.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.name} ({e.start_year})
                          </option>
                        ))}
                      </select>
                    )}
                    {worldFilter && <button onClick={() => setWorldFilter("")}>Сбросить</button>}
                  </div>
                  {worldFiltered.length === 0 && sortedCalendarEvents.length > 0 ? <p className="muted">Ничего не найдено.</p> : null}
                  <div className="stack">
                    {worldFiltered.map((ev) => {
                      const expanded = expandedEvents.has(ev.id);
                      return (
                        <div key={ev.id} className="stack" style={{ gap: 2 }}>
                          <div className="row" style={{ justifyContent: "space-between" }}>
                            <span className="row" style={{ alignItems: "center" }}>
                              {ev.description && (
                                <button style={{ padding: "2px 6px" }} onClick={() => toggleEventExpanded(ev.id)}>
                                  {expanded ? "▾" : "▸"}
                                </button>
                              )}
                              <span className="row chronicle-row" style={{ alignItems: "center" }}>
                                <span className="chronicle-date">{calendar ? formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar.months) : `${ev.inworld_year}.${ev.inworld_month}.${ev.inworld_day}`}</span>
                                <span className={`chronicle-status is-${ev.status}`}>{ev.status === "cancelled" ? "Отменено" : ev.status === "upcoming" ? "Предстоит" : "Случилось"}</span>
                                <span className="chronicle-title">{ev.title}</span>
                                {isSettingEvent(ev.id) && <span className="chronicle-source">мир</span>}
                              </span>
                            </span>
                            <div className="row" style={{ gap: "var(--sp-4)", alignItems: "center" }}>
                              <button
                                onClick={() => toggleEventImportant(ev)}
                                title={ev.important ? "Убрать из избранного" : "В избранное"}
                                className={`comp-mini ${ev.important ? "primary" : ""}`}
                                style={{ padding: "2px 6px", fontSize: "var(--fs-meta)", lineHeight: 1 }}
                              >
                                {ev.important ? "★" : "☆"}
                              </button>
                              <button className="comp-mini" onClick={() => openEditEventModal(ev)}>Редактировать</button>
                              {isSettingEvent(ev.id) ? (
                                <button className="comp-mini" onClick={() => deleteCalendarEvent(ev.id)} title="Событие мира — скрыть у этой кампании">
                                  Скрыть
                                </button>
                              ) : (
                                <button className="comp-mini danger" onClick={() => deleteCalendarEvent(ev.id)}>✕</button>
                              )}
                              <button className="comp-mini" onClick={() => { setTimelineFocus({ year: ev.inworld_year, month: ev.inworld_month, day: ev.inworld_day }); axisRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} title="На оси">Ось</button>
                              <button className="comp-mini" onClick={() => { setCalendarFocus({ year: ev.inworld_year, month: ev.inworld_month }); calendarRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }); }} title="На календаре">Календарь</button>
                            </div>
                          </div>
                          {expanded && ev.description && (
                            <div className="chronicle-row__expanded reading-text" style={{ whiteSpace: "pre-wrap" }}>
                              <MentionText text={ev.description} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {hiddenEvents.length > 0 && (
                      <details className="paper-fold">
                        <summary>
                          Скрытые события мира <span className="paper-fold__count">· {hiddenEvents.length}</span>
                        </summary>
                        <ul className="paper-rows">
                          {hiddenEvents.map((ev) => (
                            <li key={ev.id}>
                              <span className="paper-rows__main">{ev.title}</span>
                              <span className="paper-rows__sub">
                                {calendar ? formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar.months) : `${ev.inworld_year}.${ev.inworld_month}.${ev.inworld_day}`}
                              </span>
                              <button className="comp-mini" onClick={() => void setEventHidden(ev.id, false)}>
                                Вернуть
                              </button>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                    {calendarEvents.length === 0 && <EmptyState title="Хроника пуста" hint="Первое событие задаёт летоисчисление мира" action={<button className="primary" onClick={() => openCreateEventModal(timelineNow?.year ?? 1, timelineNow?.month ?? 1, timelineNow?.day ?? 1)}>+ Создать событие</button>} />}
                  </div>
                </div>
              </details>
            </div>
            <div ref={calendarRef} className="chronicle-right stack" style={{ gap: "var(--sp-6)" }}>
              <details className="card res-group" open>
                <summary className="res-group__band">
                  <span className="res-group__title">Календарь</span>
                  <span className="res-group__count" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>{inworldTodayStr ?? "—"}</span>
                </summary>
                <div className="res-group__body" style={{ padding: 12 }}>
                  {!campaign.setting_id ? (
                    <p className="muted">У кампании не привязан сеттинг — календарь недоступен.</p>
                  ) : !calendar ? (
                    <p className="muted">Загрузка…</p>
                  ) : calendar.months.length === 0 ? (
                    <p className="muted">
                      В сеттинге не настроен календарь.{" "}
                      <Link to={`/settings/${campaign.setting_id}?tab=${encodeURIComponent("Календарь")}`}>
                        Настроить →
                      </Link>
                    </p>
                  ) : (
                    <InworldCalendar
                      months={calendar.months}
                      weekdays={calendar.weekdays}
                      items={inworldItems}
                      importantDates={settingImportantDates}
                      pinned={
                        campaign.pinned_calendar_year != null && campaign.pinned_calendar_month != null
                          ? { year: campaign.pinned_calendar_year, month: campaign.pinned_calendar_month }
                          : null
                      }
                      focusDate={calendarFocus}
                      onPin={pinCampaignCalendar}
                      onDayContextMenu={handleCalendarDayContextMenu}
                      onItemClick={handleCalendarItemClick}
                      onItemContextMenu={handleCalendarItemContextMenu}
                    />
                  )}
                  <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                    ПКМ — создать событие, посмотреть список событий и сессий на день.
                  </span>
                </div>
              </details>
            </div>
          </div>
          {campaign.setting_id && (
            <div ref={cyclesRef}>
              <SettingCycles
                settingId={campaign.setting_id}
                campaignId={campaignId}
                months={calendar?.months ?? []}
                now={{ year: campaign.pinned_calendar_year ?? null, month: campaign.pinned_calendar_month ?? null }}
              />
            </div>
          )}
        </div>
      )}

      {menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          items={contextMenuItems(menu.event)}
          onClose={() => setMenu(null)}
        />
      )}

      {calendarMenu && (
        <ContextMenu
          x={calendarMenu.x}
          y={calendarMenu.y}
          items={calendarMenu.items}
          onClose={() => setCalendarMenu(null)}
        />
      )}

      {eventModal && (
        <Modal onClose={() => setEventModal(null)}>
          <h3>{eventModal.id ? "Редактировать событие" : "Новое событие"}</h3>
          <div className="stack">
            <input
              placeholder="Название"
              value={eventModal.title}
              onChange={(e) => setEventModal({ ...eventModal, title: e.target.value })}
            />
            <MentionTextarea
              value={eventModal.description}
              onChange={(v) => setEventModal({ ...eventModal, description: v })}
              rows={4}
              placeholder="Описание"
            />
            <div className="row">
              <label className="row">
                Год
                <input
                  type="number"
                  style={{ width: 80 }}
                  value={eventModal.year}
                  onChange={(e) => setEventModal({ ...eventModal, year: Number(e.target.value) })}
                />
              </label>
              <label className="row">
                Месяц
                <select
                  value={eventModal.month}
                  onChange={(e) => setEventModal({ ...eventModal, month: Number(e.target.value) })}
                >
                  {(calendar?.months ?? []).map((m) => (
                    <option key={m.id} value={m.position}>
                      {m.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="row">
                День
                <input
                  type="number"
                  style={{ width: 70 }}
                  value={eventModal.day}
                  onChange={(e) => setEventModal({ ...eventModal, day: Number(e.target.value) })}
                />
              </label>
            </div>
            <label className="row">
              <input
                type="checkbox"
                checked={eventModal.important}
                onChange={(e) => setEventModal({ ...eventModal, important: e.target.checked })}
              />
              Важно
            </label>
            <div className="row" style={{ flexWrap: "wrap" }}>
              <label className="row">
                Точность
                <select value={eventModal.precision} onChange={(e) => setEventModal({ ...eventModal, precision: e.target.value as import("../types").DatePrecision })}>
                  <option value="day">День</option>
                  <option value="month">Месяц</option>
                  <option value="year">Год</option>
                  <option value="decade">Десятилетие</option>
                  <option value="century">Век</option>
                </select>
              </label>
              <label className="row">
                Статус
                <select value={eventModal.status} onChange={(e) => setEventModal({ ...eventModal, status: e.target.value as import("../types").EventStatus })}>
                  <option value="happened">Случилось</option>
                  <option value="upcoming">Предстоит</option>
                  <option value="cancelled">Отменено</option>
                </select>
              </label>
            </div>
            {eventModal.status === "cancelled" && (
              <label className="stack" style={{ gap: 4 }}>
                Чем отменилось
                <input placeholder="Что игроки сделали, чтобы этого не произошло" value={eventModal.cancel_note} onChange={(e) => setEventModal({ ...eventModal, cancel_note: e.target.value })} />
              </label>
            )}
            <details className="card" style={{ padding: 10 }}>
              <summary>Период (если событие растянуто)</summary>
              <div className="row" style={{ marginTop: 8, flexWrap: "wrap" }}>
                <label className="row">Год до <input type="number" style={{ width: 90 }} placeholder="—" value={eventModal.year_end} onChange={(e) => setEventModal({ ...eventModal, year_end: e.target.value })} /></label>
                <label className="row">Мес. до <input type="number" style={{ width: 70 }} placeholder="—" value={eventModal.month_end} onChange={(e) => setEventModal({ ...eventModal, month_end: e.target.value })} /></label>
                <label className="row">День до <input type="number" style={{ width: 70 }} placeholder="—" value={eventModal.day_end} onChange={(e) => setEventModal({ ...eventModal, day_end: e.target.value })} /></label>
              </div>
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>Оставьте пустым — событие точечное. Заполните — период («осада март–май»).</span>
            </details>
            <div className="row">
              <button className="primary" onClick={saveEventModal}>
                Сохранить
              </button>
              <button onClick={() => setEventModal(null)}>Отмена</button>
            </div>
          </div>
        </Modal>
       )}

      {confirmDialog}
      {alertDialog}
      {creatingDate && (
        <Modal onClose={() => setCreatingDate(null)}>
          <h2>Сессия — {formatDateKeyRu(creatingDate)}</h2>
          <div className="stack">
            <label>
              Статус
              <select value={newStatus} onChange={(e) => setNewStatus(e.target.value as SessionStatus)}>
                <option value="planned">Запланировано</option>
                <option value="held">Состоялась</option>
                <option value="cancelled">Отмена</option>
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
}: {
  campaignId: number;
  roster: RosterPlayer[];
  allPlayers: Player[];
  debts: CampaignDebt[];
  currency: string;
}) {
  const hideFinance = loadHideFinance();
  const run = useAction();
  // Персонажи кампании — тот же ключ, что у пульта.
  const characters = useResource<Character[]>(campaignPaths.characters(campaignId)).data ?? NO_CHARACTERS;
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [peekCharId, setPeekCharId] = useState<number | null>(null);
  const [pcConfirmDialog, pcConfirm] = useConfirm();
  const [pcAlertDialog, showPcAlert] = useAlert();

  async function addToRoster(playerId: string, e: React.ChangeEvent<HTMLSelectElement>) {
    if (!playerId) return;
    e.target.value = "";
    await run(labelled("Игрок в состав", () => write.post(`/campaigns/${campaignId}/roster/${playerId}`)), {
      affects: rosterAffects(campaignId),
    });
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

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
        <select value="" onChange={(e) => addToRoster(e.target.value, e)} disabled={available.length === 0}>
          <option value="">{available.length === 0 ? "Все игроки уже в составе" : "Добавить игрока в состав…"}</option>
          {available.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{roster.length} в составе{available.length ? ` · ещё ${available.length} вне` : ""}</span>
      </div>
      {roster.length === 0 ? (
        <EmptyState
          title="Команда ещё не собрана"
          hint="Добавьте первого игрока — его персонажи появятся здесь же, на карточке."
          action={available.length > 0 ? <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Выберите игрока выше ↑</span> : <Link to="/players">Создать игрока →</Link>}
        />
      ) : (
        // Состав строками (спека campaign-paper, Q21): игрок · персонажи ·
        // статус · долг. Тамбнейл игрока правится на его профиле.
        <ul className="paper-rows roster-rows">
          {roster.map((p) => {
            const playerCharacters = characters.filter((c) => c.player_id === p.id);
            const isLeft = p.roster_status === "left";
            const debt = debts.find((d) => d.player_id === p.id);
            return (
              <li key={p.id} className={isLeft ? "is-left" : undefined}>
                <span className="paper-rows__main">
                  <Link to={`/players/${p.id}`}>{p.name}</Link>
                  {isLeft && <span className="badge cancelled">покинул</span>}
                </span>
                <span className="roster-rows__chars">
                  {playerCharacters.map((c) => (
                    <span key={c.id} className="roster-rows__char">
                      <Link to={`/characters/${c.id}`}>{c.character_name}</Link>
                      <button className="comp-mini" onClick={() => setPeekCharId(c.id)} aria-label={`Быстрый просмотр ${c.character_name}`} title="Быстрый просмотр">
                        <NavIcon name="eye" />
                      </button>
                    </span>
                  ))}
                  {addingFor === p.id ? (
                    <span className="roster-rows__add">
                      <input
                        autoFocus
                        placeholder="Имя персонажа"
                        value={drafts[p.id] ?? ""}
                        onChange={(e) => setDrafts((d) => ({ ...d, [p.id]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void addCharacter(p.id);
                          if (e.key === "Escape") {
                            setAddingFor(null);
                            setDrafts((d) => ({ ...d, [p.id]: "" }));
                          }
                        }}
                      />
                      <button className="primary" onClick={() => void addCharacter(p.id)} disabled={!(drafts[p.id] ?? "").trim()}>
                        ОК
                      </button>
                    </span>
                  ) : (
                    <button className="comp-mini" onClick={() => setAddingFor(p.id)}>
                      + персонаж
                    </button>
                  )}
                </span>
                {debt && !hideFinance && (
                  <span className="paper-rows__sub roster-rows__debt">
                    долг {debt.owed} {currency} · {debt.sessions} {debt.sessions === 1 ? "игра" : debt.sessions < 5 ? "игры" : "игр"}
                  </span>
                )}
                <span className="roster-rows__actions">
                  <button className="comp-mini" onClick={() => void toggleLeft(p.id, p.roster_status)}>
                    {isLeft ? "Вернуть" : "Покинул"}
                  </button>
                  <button className="comp-mini" title="Убрать из состава" aria-label={`Убрать ${p.name} из состава`} onClick={() => void removeFromRoster(p.id)}>
                    ✕
                  </button>
                </span>
              </li>
            );
          })}
        </ul>
       )}
      {characters.length > 0 && <CampaignSquadSummary characters={characters} />}
      {characters.length > 0 && <CampaignSquadDates characters={characters} />}
      {pcConfirmDialog}
      {pcAlertDialog}
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
  const authors = useMemo(() => {
    const map = new Map<string, string>();
    for (const r of rows ?? []) {
      const key = `${r.player_name ?? "—"} · ${r.character_name ?? "без персонажа"}`;
      if (!map.has(key)) map.set(key, key);
    }
    return [...map.keys()].sort((a, b) => a.localeCompare(b, "ru"));
  }, [rows]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (rows ?? [])
      .filter((r) => (author === "all" ? true : `${r.player_name ?? "—"} · ${r.character_name ?? "без персонажа"}` === author))
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.description.toLowerCase().includes(q));
  }, [rows, query, author]);
  if (rows === null) return <p className="muted">Загрузка…</p>;
  if (error) {
    return (
      <LoadErrorCard
        message={<>Заметки не загрузились: {error}</>}
        onRetry={load}
      />
    );
  }
  if (rows.length === 0) return <p className="muted">Игроки пока ничего не записали.</p>;
  return (
    <div className="stack">
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <input
          className="res-toolbar__search"
          placeholder="Поиск по заметкам…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Поиск по заметкам игроков"
          style={{ flex: "1 1 200px", minWidth: 160 }}
        />
        <select value={author} onChange={(e) => setAuthor(e.target.value)} aria-label="Фильтр по автору" style={{ maxWidth: 260 }}>
          <option value="all">Все авторы</option>
          {authors.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", whiteSpace: "nowrap" }}>
          {visible.length} из {rows.length}
        </span>
      </div>
      {visible.length === 0 ? (
        <p className="muted">По этому запросу записей нет — снимите фильтр.</p>
      ) : (
        visible.map((r) => (
          <div key={r.id} className="card stack" style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
              <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
                {r.created_at.slice(0, 10).split("-").reverse().join(".")}
                {" · "}
                {r.player_name ?? "—"}
                {" · "}
                {r.character_name ?? "без персонажа"}
              </span>
              {r.kind && (
                <span className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  {r.kind}
                </span>
              )}
            </div>
            {r.name && <strong>{r.name}</strong>}
            <p style={{ whiteSpace: "pre-wrap", margin: 0 }}>{r.description}</p>
          </div>
        ))
      )}
    </div>
  );
}

function CampaignSquadSummary({ characters }: { characters: Character[] }) {
  // Статблоки — под тем же ключом, что у листа: правка листа в соседнем окне
  // меняет сводку без перечитывания всего отряда.
  const statblocks = useQueries({
    queries: characters.map((c) =>
      resourceQuery<{ content: string; format: string }[]>(statblockListPath("character", c.id))
    ),
  });
  // Эффекты умений и вещей — из справочника, как в самом листе: «Оборона» и
  // «Защита без доспехов» живут в записях, а не в сохранённом листе.
  const parsedSheets = statblocks.map((q) => {
    const dnd = q.data?.find((s) => s.format === "dnd_character");
    try {
      return dnd ? normalizeDndCharacter(JSON.parse(dnd.content || "{}")) : null;
    } catch {
      return null;
    }
  });
  const getEntry = useCompendiumEntries(parsedSheets.flatMap((d) => (d ? liveEffectEntryIds(d) : [])));
  if (statblocks.some((q) => q.isPending)) return null;
  const rows = characters.map((c, i) => {
    const empty = { id: c.id, name: c.character_name, level: "—", ac: "—", hp: "—", speed: "—" };
    const dnd = statblocks[i]?.data?.find((s) => s.format === "dnd_character");
    if (!dnd) return empty;
    try {
      // «Сводка отряда» читала сохранённые поля листа как есть — а они
      // свободный текст, который пишет импорт и который устаревает при
      // любой правке класса или снаряжения. Теперь числа те же, что на
      // самом чарнике: один модуль на оба экрана.
      const parsed = parsedSheets[i];
      if (!parsed) return empty;
      const sheet = deriveSheet(withLiveEffects(parsed, getEntry));
      return {
        id: c.id,
        name: c.character_name,
        level: String(sheet.level.value || "—"),
        ac: String(sheet.armorClass.value),
        hp: sheet.maxHitPoints.value ? String(sheet.maxHitPoints.value) : "—",
        speed: sheet.walkSpeed.value ? String(sheet.walkSpeed.value) : "—",
      };
    } catch {
      return empty;
    }
  });
  if (rows.length === 0) return null;
  const hasAny = rows.some((r) => r.ac !== "—" || r.hp !== "—");
  if (!hasAny) return null;
  return (
    <div className="card stack" style={{ marginTop: 8, overflowX: "auto" }}>
      <div className="campaign-player-header" style={{ margin: "-14px -14px 10px" }}><span>Сводка отряда</span><span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>{rows.length} ПК</span></div>
      <table style={{ width: "100%", fontSize: "var(--fs-meta)", borderCollapse: "collapse" }}>
        <thead><tr className="muted" style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}><th style={{ textAlign: "left", padding: "4px 6px" }}>Персонаж</th><th style={{ padding: "4px 6px" }}>Ур.</th><th style={{ padding: "4px 6px" }}>КЗ</th><th style={{ padding: "4px 6px" }}>Хиты</th><th style={{ padding: "4px 6px" }}>Скорость</th><th></th></tr></thead>
        <tbody>{rows.map((r) => (
          <tr key={r.id} style={{ borderTop: "1px solid var(--line)" }}><td style={{ padding: "4px 6px" }}><Link to={`/characters/${r.id}`}>{r.name}</Link></td><td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.level}</td><td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.ac}</td><td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.hp}</td><td style={{ padding: "4px 6px", textAlign: "center", fontFamily: "var(--font-mono)" }}>{r.speed}</td><td style={{ padding: "4px 6px" }}><button className="comp-mini" onClick={() => { window.location.hash = `peek-${r.id}`; }} style={{ visibility: "hidden" }} aria-hidden="true">·</button></td></tr>
        ))}</tbody>
      </table>
    </div>
  );
}

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
    <div className="card stack" style={{ marginTop: 8 }}>
      <div className="campaign-player-header" style={{ margin: "-14px -14px 10px" }}><span>Важные даты отряда</span><span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>{dates.length}</span></div>
      <div className="stack" style={{ gap: 4 }}>
        {dates.slice(0, 8).map((r) => (
          <div key={`${r.charId}-${r.date.id}`} className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span><strong>{r.charName}</strong> — {r.date.title} <span className="muted">· {r.date.day}.{r.date.month ?? "—"}.{r.date.year ?? "—"}</span></span>
            <Link to={`/characters/${r.charId}`} className="comp-mini">→ лист</Link>
          </div>
        ))}
        {dates.length > 8 && <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>+ ещё {dates.length - 8}</span>}
      </div>
    </div>
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
}: {
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
}) {
  const campaignId = campaign.id;
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

  return (
    <div className="stack">
      <details className="card res-group" open>
        <summary className="res-group__band">
          <span className="res-group__title">Основное</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
          {!editingMain ? (
            <div className="stack">
              <table className="detail-table">
                <tbody>
                  <tr><td className="detail-label">Название</td><td>{campaign.name}</td></tr>
                  <tr><td className="detail-label">Тип</td><td>{CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === campaign.type)?.label ?? campaign.type}</td></tr>
                  <tr><td className="detail-label">Система</td><td>{systemName}</td></tr>
                  <tr><td className="detail-label">Сеттинг</td><td>{settingName}</td></tr>
                  <tr><td className="detail-label">Статус</td><td>{CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}</td></tr>
                  <tr><td className="detail-label">Оплата</td><td>{PAYMENT_TYPE_LABELS[campaign.payment_type] ?? campaign.payment_type}</td></tr>
                  {campaign.payment_type === "paid" && (
                    <>
                      <tr><td className="detail-label">Периодичность</td><td>{PAYMENT_FREQUENCY_LABELS[campaign.payment_frequency] ?? campaign.payment_frequency}</td></tr>
                      <tr><td className="detail-label">Тип ставки</td><td>{RATE_SPLIT_LABELS[campaign.rate_split] ?? campaign.rate_split}</td></tr>
                      <tr><td className="detail-label">Ставка</td><td><span className="detail-value-mono">{campaign.session_rate ?? 0}</span> {campaign.currency}</td></tr>
                    </>
                  )}
                </tbody>
              </table>
              <div className="campaign-actions">
                <button onClick={startEdit}>Редактировать</button>
              </div>
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

          <div style={{ marginTop: 8 }}>
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
      </details>

      <details className="card res-group">
        <summary className="res-group__band">
          <span className="res-group__title">Персонаж</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <PlayerCharacterTab campaignId={campaignId} />
        </div>
      </details>
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
  campaign,
  systems,
  settingsList,
  sessions,
  onSchedule,
  onSecrets,
}: {
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
  sessions: SessionSummary[];
  onSchedule: () => void;
  onSecrets: () => void;
}) {
  const campaignId = campaign.id;
  const oneshot = campaign.type === "oneshot";
  const [editing, setEditing] = useState<"main" | "payment" | null>(null);
  const { save, saving } = useCampaignFieldsSave(campaignId);
  const run = useAction();
  const { allGroups, campaignGroupIds, toggleGroup } = useCampaignGroups(campaignId);
  const [adventuresCount, setAdventuresCount] = useState<number | null>(null);
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
  function upload(kind: "background" | "thumbnail", label: string, file: File) {
    const fd = new FormData();
    fd.append("file", file);
    void run(labelled(label, () => write.post(`/campaigns/${campaignId}/${kind}`, fd, { timeoutMs: UPLOAD_TIMEOUT_MS })), {
      affects: campaignFieldsAffects(campaignId),
    });
  }
  const bgCrop = useImageCrop("background", (file) => upload("background", "Фон кампании", file));
  const thumbCrop = useImageCrop("thumbnail", (file) => upload("thumbnail", "Обложка кампании", file));
  const thumbInput = useRef<HTMLInputElement>(null);
  const bgInput = useRef<HTMLInputElement>(null);
  const [ovConfirmDialog, ovConfirm] = useConfirm();
  async function removeImage(kind: "background" | "thumbnail") {
    const what = kind === "background" ? "фон страницы" : "обложку";
    const ok = await ovConfirm({ message: `Убрать ${what}?`, confirmLabel: "Убрать", danger: true });
    if (!ok) return;
    await run(labelled(kind === "background" ? "Фон кампании" : "Обложка кампании", () => write.del(`/campaigns/${campaignId}/${kind}`)), {
      affects: campaignFieldsAffects(campaignId),
    });
  }

  function start(which: "main" | "payment") {
    setForm(formFrom(campaign));
    setEditing(which);
  }
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

  const system = systems.find((s) => s.id === campaign.system_id);
  const setting = settingsList.find((s) => s.id === campaign.setting_id);
  const held = sessions.filter((s) => s.status === "held").length;
  const planned = sessions.filter((s) => s.status === "planned").length;

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

  return (
    <div className="dossier campaign-overview">
      <aside className="dossier__aside">
        {/* Обложка — щелчком; фон страницы — строкой под ней (Q10). */}
        <button
          type="button"
          className="dossier__portrait dossier__portrait--cover"
          title="Сменить обложку"
          onClick={() => thumbInput.current?.click()}
        >
          {coverSrc ? <img src={coverSrc} alt={`Обложка: ${campaign.name}`} /> : <span className="dossier__portrait-empty">Обложка</span>}
          <span className="dossier__portrait-hint">Сменить обложку</span>
        </button>
        <input ref={thumbInput} hidden type="file" accept={IMAGE_ACCEPT} onChange={(e) => thumbCrop.onSelect(e.target.files?.[0] ?? null)} />
        <input ref={bgInput} hidden type="file" accept={IMAGE_ACCEPT} onChange={(e) => bgCrop.onSelect(e.target.files?.[0] ?? null)} />
        <p className="campaign-overview__images muted">
          {campaign.thumbnail_image_url && (
            <>
              <button type="button" className="paper-more" onClick={() => void removeImage("thumbnail")}>убрать обложку</button>
              {" · "}
            </>
          )}
          фон страницы:{" "}
          <button type="button" className="paper-more" onClick={() => bgInput.current?.click()} title={IMAGE_HINT}>
            {campaign.background_image_url ? "сменить" : "задать"}
          </button>
          {campaign.background_image_url && (
            <>
              {" · "}
              <button type="button" className="paper-more" onClick={() => void removeImage("background")}>убрать</button>
            </>
          )}
        </p>
        {thumbCrop.modal}
        {bgCrop.modal}
        <dl className="paper-facts">
          <div>
            <dt className="paper-label">Тип</dt>
            <dd>{CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === campaign.type)?.label ?? campaign.type}</dd>
          </div>
          <div>
            <dt className="paper-label">Система</dt>
            <dd>{system ? <Link to={`/systems/${system.id}`}>{system.name}</Link> : "—"}</dd>
          </div>
          <div>
            <dt className="paper-label">Сеттинг</dt>
            <dd>{setting ? <Link to={`/settings/${setting.id}`}>{setting.name} ›</Link> : "—"}</dd>
          </div>
          <div>
            <dt className="paper-label">Статус</dt>
            <dd>{CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}</dd>
          </div>
          <div>
            <dt className="paper-label">{oneshot ? "Прогонов" : "Сессий"}</dt>
            <dd>
              {held} сыграно{planned > 0 ? ` · ${planned} впереди` : ""}
            </dd>
          </div>
          {allGroups.length > 0 && (
            <div>
              <dt className="paper-label">Группы</dt>
              <dd className="campaign-overview__groups">
                {allGroups.map((g) => {
                  const isIn = campaignGroupIds.includes(g.id);
                  return (
                    <label key={g.id} className={`campaign-group-chip${isIn ? " is-in" : ""}`}>
                      <input type="checkbox" checked={isIn} onChange={() => void toggleGroup(g.id, isIn)} />
                      {g.name}
                    </label>
                  );
                })}
              </dd>
            </div>
          )}
        </dl>
        {editing !== "main" && (
          <button type="button" className="paper-more" onClick={() => start("main")}>
            Править основное ›
          </button>
        )}
      </aside>

      <div className="dossier__main">
        {editing === "main" && mainForm}
        <CampaignNow
          campaignId={campaignId}
          oneshot={oneshot}
          sessions={sessions}
          onSchedule={onSchedule}
          onSecrets={onSecrets}
        />
        <CampaignPassport campaign={campaign} />
        <section className="paper-groups">
          <h2 className="paper-group__head">
            Приключения {adventuresCount != null && <span className="paper-group__count">· {adventuresCount}</span>}
          </h2>
          <CampaignAdventuresCard campaignId={campaign.id} settingId={campaign.setting_id} onCount={setAdventuresCount} />
        </section>

        {!hideFinance && (
          <details className="paper-fold" open={editing === "payment" || undefined}>
            <summary>
              Оплата <span className="paper-fold__count">· {paymentSummary}</span>
            </summary>
            <div className="paper-fold__body">
              {editing === "payment" ? (
                paymentForm
              ) : (
                <>
                  <dl className="paper-facts">
                    <div>
                      <dt className="paper-label">Оплата</dt>
                      <dd>{PAYMENT_TYPE_LABELS[campaign.payment_type] ?? campaign.payment_type}</dd>
                    </div>
                    {campaign.payment_type === "paid" && (
                      <>
                        <div>
                          <dt className="paper-label">Периодичность</dt>
                          <dd>{PAYMENT_FREQUENCY_LABELS[campaign.payment_frequency] ?? campaign.payment_frequency}</dd>
                        </div>
                        <div>
                          <dt className="paper-label">Ставка</dt>
                          <dd>
                            {campaign.session_rate ?? 0} {campaign.currency} · {RATE_SPLIT_LABELS[campaign.rate_split] ?? campaign.rate_split}
                          </dd>
                        </div>
                      </>
                    )}
                  </dl>
                  <button type="button" className="paper-more" onClick={() => start("payment")}>
                    Править оплату ›
                  </button>
                  <ExtraPayments campaignId={campaignId} roster={campaign.roster} currency={campaign.currency} />
                </>
              )}
            </div>
          </details>
        )}

        <ResultsFold campaign={campaign} sessions={sessions} />
        <OldNotesFold campaignId={campaignId} settingId={campaign.setting_id} />

        <details className="paper-fold">
          <summary>Заглавное представление</summary>
          <div className="paper-fold__body">
            <p className="muted">
              Заглушка на второй экран: показывается до первого представления сцены и по кнопке из пульта.
            </p>
            <PresentationEditor owner={{ kind: "campaign", campaignId: campaign.id, campaignName: campaign.name }} />
          </div>
        </details>
        <details className="paper-fold">
          <summary>Связать имена</summary>
          <div className="paper-fold__body">
            <CrossLinksWizard
              ownerKind="campaign"
              ownerId={campaignId}
              help="Ищет имена сущностей сеттинга и записей компендиума в текстах кампании — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
            />
          </div>
        </details>
      </div>
      {ovConfirmDialog}
    </div>
  );
}

// «Итоги» (бывший «Пост-продакшен», Q15): свободные записи итогов кампании.
// Видны после первой сыгранной сессии или когда записи уже есть.
function ResultsFold({ campaign, sessions }: { campaign: CampaignDetail; sessions: SessionSummary[] }) {
  const post = useResource<CampaignEntry[]>(campaignPaths.entries(campaign.id, "post_production")).data;
  if (!post) return null;
  if (!sessions.some((s) => s.status === "held") && post.length === 0) return null;
  return (
    <details className="paper-fold">
      <summary>
        Итоги <span className="paper-fold__count">· {post.length}</span>
      </summary>
      <div className="paper-fold__body">
        <p className="muted">Что получилось, что нет, эпилоги персонажей, несбывшиеся линии, идеи для сиквела.</p>
        <CampaignEntryList
          campaignId={campaign.id}
          category="post_production"
          addLabel="+ Запись"
          emptyLabel="Итогов пока нет."
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      </div>
    </details>
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
const SETTING_EVENT_UID = 1_000_000_000;
const isSettingEvent = (id: number) => id >= SETTING_EVENT_UID;
const eventPath = (id: number) =>
  isSettingEvent(id) ? `/settings/calendar-events/${id - SETTING_EVENT_UID}` : `/campaigns/calendar-events/${id}`;
const NO_WORKBOOKS: InstanceSummary[] = [];
const NO_CHARACTERS: Character[] = [];
