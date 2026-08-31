import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { toLocalDateKey, formatDateKeyRu } from "../utils/date";
import { copySessionPrep } from "../sessionCopy";
import { Modal } from "../components/Modal";
import { MonthCalendar, type CalendarEvent } from "../components/MonthCalendar";
import { LinkDropZone } from "../components/LinkDropZone";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { CampaignEntryList } from "../components/CampaignEntryList";
import { WorldExplorationTab } from "../components/WorldExplorationTab";
import { CampaignPlayerSectionsTab } from "../components/CampaignPlayerSectionsTab";
import { TaskTracker } from "../components/TaskTracker";
import { CampaignSecrets } from "../components/CampaignSecrets";
import { CampaignMilestones } from "../components/CampaignMilestones";
import { CampaignChaptersScenes } from "../components/CampaignChaptersScenes";
import { CampaignAdventuresCard } from "../components/CampaignAdventuresCard";
import { CrossLinksWizard } from "../components/CrossLinksWizard";
import { EmptyState } from "../components/EmptyState";
import { ResourceCard } from "../components/ResourceCard";
import { RemindersWidget } from "../components/RemindersWidget";
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
import { ThemeCardEdit, ThemeCardView, emptyTheme } from "../components/litm/ThemeCard";
import { normalizeTheme } from "../components/litm/LitMCharacterForm";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useTabState } from "../hooks/useTabState";
import { formatInworldDate, formatEventDate } from "../inworldCalendar";
import { InworldCalendar, type InworldDatedItem } from "../components/InworldCalendar";
import { EntityTypeChip } from "../components/EntityTypeChip";
import { useImageCrop } from "../hooks/useImageCrop";
import { cardThumbnailProps, loadThumbnailStyles, type ThumbnailStyle } from "../thumbnailStyles";
import { loadHideFinance } from "../financePrivacy";
import type {
  CampaignCalendarEvent,
  CampaignDetail,
  CampaignEntry,
  CampaignGroup,
  CampaignGrouped,
  CampaignType,
  Character,
  ImportantDate,
  LitMThemeCard,
  PaymentFrequency,
  PaymentType,
  Player,
  Preproduction,
  RateSplit,
  Resource,
  RosterPlayer,
  SessionStatus,
  SessionSummary,
  Setting,
  SettingCycle,
  StorySecret,
  System,
} from "../types";
import { Timeline } from "../components/Timeline";

// Три вида одних и тех же событий: сетка показывает месяц, список — порядок,
// ось — расстояния.
type WorldView = "calendar" | "list" | "axis";

const GM_TABS = [
  "Обзор",
  "Игроки и персонажи",
  // Сюжет кампании стоит сразу за игроками: к игре готовятся по нему, а не
  // по мастерским заметкам.
  "Главы и сцены",
  "Вехи",
  "Тайны и зацепки",
  "Заметки",
  "Хроника игр",
  "Хроника мира",
  "Для игроков",
] as const;

// Сохранённые ссылки на прежнее имя вкладки не должны падать на «Обзор».
const GM_TAB_ALIASES = { "Заметки по ведению": "Заметки" } as const;
const PLAYER_TABS = ["Заметки", "Клёвые цитаты", "Трекер задач", "Хроника игр", "Исследование Мира"] as const;

export function CampaignDetailPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const calendar = useSettingCalendar(campaign?.setting_id);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const tabs = campaign?.role === "player" ? PLAYER_TABS : GM_TABS;
  const [tab, selectTab] = useTabState(
    tabs,
    "Обзор",
    campaign?.role === "player" ? undefined : GM_TAB_ALIASES
  );
  // Третий вид рядом с сеткой и списком: сетка показывает месяц, список —
  // порядок, ось — расстояния и «сколько у них осталось».
  const [worldView, setWorldView] = useState<WorldView>(
    () => (localStorage.getItem("campaignWorldView") as WorldView) || "calendar"
  );
  function changeWorldView(v: WorldView) {
    setWorldView(v);
    localStorage.setItem("campaignWorldView", v);
  }
  const [cycles, setCycles] = useState<SettingCycle[]>([]);
  useEffect(() => {
    if (!campaign?.setting_id) return;
    api.get<SettingCycle[]>(`/settings/${campaign.setting_id}/cycles`).then(setCycles);
  }, [campaign?.setting_id]);

  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [creatingSession, setCreatingSession] = useState(false);
  const [newStatus, setNewStatus] = useState<SessionStatus>("planned");
  const [newPaymentOverride, setNewPaymentOverride] = useState<"" | PaymentType>("");
  const [newStake, setNewStake] = useState("");
  const [repeatInterval, setRepeatInterval] = useState<"none" | "7" | "14">("none");
  const [repeatCount, setRepeatCount] = useState("4");
  const [newCopyFromSessionId, setNewCopyFromSessionId] = useState("");

  const [systems, setSystems] = useState<System[]>([]);
  const [settingsList, setSettingsList] = useState<Setting[]>([]);

  const [menu, setMenu] = useState<{ x: number; y: number; event: CalendarEvent } | null>(
    null
  );

  const [calendarEvents, setCalendarEvents] = useState<CampaignCalendarEvent[]>([]);
  const [expandedEvents, setExpandedEvents] = useState<Set<number>>(new Set());
  const [settingImportantDates, setSettingImportantDates] = useState<ImportantDate[]>([]);
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
    if (worldSort === "desc") list = [...list].reverse();
    return list;
  }, [sortedCalendarEvents, worldFilter, worldSort]);

  function refreshCalendarEvents() {
    api.get<CampaignCalendarEvent[]>(`/campaigns/${campaignId}/calendar-events`).then(setCalendarEvents);
  }
  useEffect(refreshCalendarEvents, [campaignId]);

  useEffect(() => {
    if (!campaign?.setting_id) {
      setSettingImportantDates([]);
      return;
    }
    api.get<ImportantDate[]>(`/settings/${campaign.setting_id}/important-dates`).then(setSettingImportantDates);
  }, [campaign?.setting_id]);

  function refreshCampaign() {
    api.get<CampaignDetail>(`/campaigns/${campaignId}`).then(setCampaign);
  }
  function refreshSessions() {
    api
      .get<SessionSummary[]>(`/campaigns/${campaignId}/sessions`)
      .then(setSessions);
  }
  useEffect(() => {
    refreshCampaign();
    refreshSessions();
    api.get<Player[]>("/players").then(setAllPlayers);
    api.get<System[]>("/systems").then(setSystems);
    api.get<Setting[]>("/settings").then(setSettingsList);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  if (!campaign) return <p className="muted">Загрузка…</p>;

  const events: CalendarEvent[] = sessions.map((s) => ({
    id: s.id,
    date: s.date,
    status: s.status,
    paymentType: s.effective_payment_type,
    campaignRole: campaign.role,
    label: s.title || `Сессия №${s.session_number ?? ""}`,
  }));

  const inworldItems: InworldDatedItem[] = [
    ...sessions
      .filter((s) => s.inworld_year != null && s.inworld_month != null && s.inworld_day != null)
      .map((s) => ({
        id: `session-${s.id}`,
        year: s.inworld_year!,
        month: s.inworld_month!,
        day: s.inworld_day!,
        label: s.title || `Сессия №${s.session_number ?? ""}`,
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
    if (!confirm("Удалить событие?")) return;
    await api.del(`/campaigns/calendar-events/${eventId}`);
    setCalendarMenu(null);
    refreshCalendarEvents();
  }

  async function toggleEventImportant(ev: CampaignCalendarEvent) {
    await api.put(`/campaigns/calendar-events/${ev.id}`, { important: !ev.important });
    refreshCalendarEvents();
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
    await api.put(`/campaigns/calendar-events/${id}`, {
      inworld_year: date.year,
      inworld_month: date.month,
      inworld_day: date.day,
      date_precision: date.precision,
    });
    refreshCalendarEvents();
  }

  async function pinCampaignCalendar(pinned: { year: number; month: number } | null) {
    await api.put(`/campaigns/${campaignId}/pinned-calendar`, {
      year: pinned?.year ?? null,
      month: pinned?.month ?? null,
    });
    refreshCampaign();
  }

  async function saveEventModal() {
    if (!eventModal || !eventModal.title.trim()) return;
    const hasPeriod = eventModal.year_end.trim() !== "" || eventModal.month_end.trim() !== "" || eventModal.day_end.trim() !== "";
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
    if (eventModal.id) {
      const original = calendarEvents.find((e) => e.id === eventModal.id);
      await api.put(`/campaigns/calendar-events/${eventModal.id}`, payload);
      await syncMentionLinks("campaign_event", eventModal.id, original?.description ?? "", eventModal.description);
    } else {
      const created = await api.post<CampaignCalendarEvent>(`/campaigns/${campaignId}/calendar-events`, payload);
      await syncMentionLinks("campaign_event", created.id, "", eventModal.description);
    }
    setEventModal(null);
    refreshCalendarEvents();
  }

  function handleCalendarDayContextMenu(year: number, month: number, day: number, x: number, y: number) {
    setCalendarMenu({
      x,
      y,
      items: [{ label: "Создать событие", onClick: () => openCreateEventModal(year, month, day) }],
    });
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
        { label: "Удалить", danger: true, onClick: () => deleteCalendarEvent(ev.id) },
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
        const created = await api.post<{ id: number }>("/sessions", {
          campaign_id: campaignId,
          date: dateStr,
          status: newStatus,
          payment_override: newPaymentOverride || null,
          stake_override: newStake ? Number(newStake) : undefined,
        });
        if (newCopyFromSessionId) {
          await copySessionPrep(Number(newCopyFromSessionId), created.id);
        }
      }
      setCreatingDate(null);
      setNewStatus("planned");
      setNewPaymentOverride("");
      setNewStake("");
      setRepeatInterval("none");
      setRepeatCount("4");
      setNewCopyFromSessionId("");
      refreshSessions();
      refreshCampaign();
    } finally {
      setCreatingSession(false);
    }
  }

  async function archiveCampaign() {
    if (!confirm("Отправить кампанию в архив? Она пропадёт из основных разделов.")) return;
    await api.del(`/campaigns/${campaignId}`);
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
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { payment_override: o.value || null });
          refreshSessions();
          refreshCampaign();
        },
      }));

    return [
      {
        label: "Статус: Запланировано",
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { status: "planned" });
          refreshSessions();
        },
      },
      {
        label: "Статус: Состоялась",
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { status: "held" });
          refreshSessions();
          refreshCampaign();
        },
      },
      ...paymentItems,
      {
        label: "Удалить (в архив)",
        danger: true,
        onClick: async () => {
          await api.del(`/sessions/${event.id}`);
          refreshSessions();
          refreshCampaign();
        },
      },
    ];
  }

  async function archiveSession(sessionId: number) {
    if (!confirm("Отправить сессию в архив?")) return;
    await api.del(`/sessions/${sessionId}`);
    refreshSessions();
    refreshCampaign();
  }

  return (
    <div className="stack" style={{ position: "relative" }}>
      {campaign.background_image_url && (
        <div
          className="campaign-bg-layer"
          style={{ backgroundImage: `url("${campaign.background_image_url}")` }}
        />
      )}
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          <div className="row" style={{ alignItems: "center" }}>
            <h1>
                <button type="button" className="entity-title-link" onClick={() => selectTab("Обзор")} title="К обзору">
                  {campaign.name}
                </button>
            </h1>
            <EntityTypeChip type="campaign" />
          </div>
          <div className="muted">
            {campaign.system_name ?? "система не выбрана"} · {CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}
          </div>
        </div>
        <div className="row">
          {campaign.role === "player" ? (
            <div className="badge role-player-badge zine-rotate">Я игрок</div>
          ) : (
            !loadHideFinance() && (
              <div className="badge tag">
                <span style={{ fontFamily: "var(--font-mono)" }}>{campaign.finance.earned}</span> {campaign.currency}
              </div>
            )
          )}
          <div className="entity-header-actions">
            <button className="danger" onClick={archiveCampaign}>
              <NavIcon name="archive" /> Архивировать
            </button>
          </div>
        </div>
      </div>

      <div className="tabs">
        {tabs.filter((t) => t !== "Обзор").map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Обзор" && campaign.role === "player" && (
        <PlayerOverviewTab campaign={campaign} systems={systems} settingsList={settingsList} onRefresh={refreshCampaign} />
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

      {tab === "Заметки" && campaign.role !== "player" && (
        <CampaignEntryList
          campaignId={campaignId}
          category="gm_notes"
          addLabel="+ Добавить заметку"
          emptyLabel="Заметок пока нет."
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Трекер задач" && (
        <TaskTracker campaignId={campaignId} defaultSettingId={campaign.setting_id ?? undefined} />
      )}

      {tab === "Главы и сцены" && (
        <CampaignChaptersScenes campaignId={campaignId} settingId={campaign.setting_id} />
      )}

      {tab === "Вехи" && (
        <CampaignMilestones campaignId={campaignId} settingId={campaign.setting_id} />
      )}

      {tab === "Тайны и зацепки" && (
        <CampaignSecrets campaignId={campaignId} settingId={campaign.setting_id} />
      )}

       {tab === "Обзор" && campaign.role !== "player" && (
          <>
            <OverviewTab campaign={campaign} systems={systems} settingsList={settingsList} sessions={sessions} onRefresh={refreshCampaign} />
            <CrossLinksWizard
              ownerKind="campaign"
              ownerId={campaignId}
              help="Ищет имена сущностей сеттинга и записей компендиума в текстах кампании — и делает их кликабельными. Шаг за шагом, по одному типу цели. Ничего не пишет, пока вы не подтвердите."
            />
          </>
       )}

      {tab === "Для игроков" && (
        <CampaignPlayerSectionsTab
          campaignId={campaignId}
          roster={campaign.roster}
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Игроки и персонажи" && (
        <div className="stack" style={{ gap: 24 }}>
          <section className="stack">
            <div className="section-heading-sub">
              <h3 className="section-heading-sub-title"><span className="section-heading-sub-icon" aria-hidden="true">◆</span> Состав</h3>
              <span className="muted" style={{ fontSize: 11 }}>{campaign.roster.length} в игре</span>
            </div>
            <PlayersAndCharactersTab
              campaignId={campaignId}
              roster={campaign.roster}
              allPlayers={allPlayers}
              onRosterChange={refreshCampaign}
            />
          </section>
          <section className="stack">
            <div className="section-heading-sub">
              <h3 className="section-heading-sub-title"><span className="section-heading-sub-icon" aria-hidden="true">✦</span> Напоминания игрокам</h3>
              <span className="muted" style={{ fontSize: 11 }}>видны на Главной игроков</span>
            </div>
            <RemindersWidget targetType="campaign" targetId={campaignId} />
          </section>
        </div>
      )}

      {tab === "Хроника игр" && (
        <div className="stack">
          <div className="plane-grid">
            <MonthCalendar
              events={events}
              onDayClick={(date) => setCreatingDate(date)}
              onEventClick={(e) => navigate(`/sessions/${e.id}`)}
              onEventContextMenu={(event, x, y) => setMenu({ x, y, event })}
            />
            {campaign.role === "player" || loadHideFinance() ? (
              <div className="card stack">
                <h3>Сессии</h3>
                <div>Проведено сессий: <span style={{ fontFamily: "var(--font-mono)" }}>{campaign.finance.heldSessions}</span></div>
              </div>
            ) : (
              <div className="card stack">
                <h3>Финансы</h3>
                <div>Оплата: {PAYMENT_TYPE_LABELS[campaign.payment_type]}</div>
                {campaign.payment_type === "paid" && (
                  <div>
                    Ставка: {campaign.session_rate} {campaign.currency}{" "}
                    ({PAYMENT_FREQUENCY_LABELS[campaign.payment_frequency].toLowerCase()},{" "}
                    {RATE_SPLIT_LABELS[campaign.rate_split].toLowerCase()})
                  </div>
                )}
                <div>Проведено сессий: <span style={{ fontFamily: "var(--font-mono)" }}>{campaign.finance.heldSessions}</span></div>
                <div>
                  Заработано: <span style={{ fontFamily: "var(--font-mono)" }}>{campaign.finance.earned} {campaign.currency}</span>
                </div>
              </div>
            )}
          </div>

          <details className="card">
            <summary>Хроника кампании</summary>
            <div className="timeline">
              {sessions
                .filter((s) => s.status !== "cancelled")
                .map((s) => (
                  <div key={s.id} className="timeline-entry">
                    <div className="timeline-date">
                      <Link to={`/sessions/${s.id}`}>
                        {s.date} — {s.title || `Сессия №${s.session_number ?? ""}`}
                      </Link>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                      {calendar &&
                        formatInworldDate(s.inworld_year, s.inworld_month, s.inworld_day, calendar.months, calendar.era) && (
                          <span className="muted">
                            {formatInworldDate(s.inworld_year, s.inworld_month, s.inworld_day, calendar.months, calendar.era)}
                          </span>
                        )}
                    </div>
                    {s.main_events ? (
                      <p style={{ whiteSpace: "pre-wrap" }}>
                        <MentionText text={s.main_events} />
                      </p>
                    ) : (
                      <p className="muted">Основные события не записаны.</p>
                    )}
                  </div>
                ))}
              {sessions.filter((s) => s.status !== "cancelled").length === 0 && (
                <p className="muted">Пока нет сессий.</p>
              )}
            </div>
          </details>

          <details className="card">
            <summary>История сессий ({sessions.length})</summary>
            <table>
              <thead>
                <tr>
                  <th>Дата</th>
                  <th>Название</th>
                  <th>Статус</th>
                  {!loadHideFinance() && <th>Оплата</th>}
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((s) => (
                  <tr key={s.id}>
                    <td>{s.date}</td>
                    <td>{s.title || `Сессия №${s.session_number ?? ""}`}</td>
                    <td>
                      <span className={`badge ${s.status}`}>{s.status}</span>
                    </td>
                    {!loadHideFinance() && <td>{PAYMENT_TYPE_LABELS[s.effective_payment_type]}</td>}
                    <td className="row">
                      <Link to={`/sessions/${s.id}`}>Открыть →</Link>
                      <button onClick={() => archiveSession(s.id)} aria-label="Архивировать сессию">✕</button>
                    </td>
                  </tr>
                ))}
                {sessions.length === 0 && (
                  <tr>
                    <td colSpan={loadHideFinance() ? 4 : 5} className="muted">
                      Пока нет сессий.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </details>
        </div>
      )}

      {tab === "Исследование Мира" && <WorldExplorationTab campaignId={campaignId} />}

      {tab === "Хроника мира" && (
        <div className="stack" style={{ gap: "var(--sp-5)" }}>
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
              <h3 style={{ margin: 0 }}>Ось времени</h3>
              <button className="primary" onClick={() => openCreateEventModal(1, 1, 1)}>+ Создать событие</button>
            </div>
            <Timeline
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
                    title: s.title || `Сессия №${s.session_number ?? ""}`,
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
              now={
                campaign.pinned_calendar_year != null && campaign.pinned_calendar_month != null
                  ? { year: campaign.pinned_calendar_year, month: campaign.pinned_calendar_month }
                  : null
              }
              cycles={cycles}
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
                    <input placeholder="Поиск по хроноике мира" value={worldFilter} onChange={(e) => setWorldFilter(e.target.value)} style={{ flex: "1 1 200px" }} />
                    <button onClick={() => setWorldSort((s) => (s === "asc" ? "desc" : "asc"))}>{worldSort === "asc" ? "↑ Старые → новые" : "↓ Новые → старые"}</button>
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
                              </span>
                            </span>
                            <div className="row" style={{ gap: "var(--sp-2)" }}>
                              <label className="row" style={{ fontSize: "var(--fs-meta)" }}>
                                <input type="checkbox" checked={!!ev.important} onChange={() => toggleEventImportant(ev)} />
                                Важно
                              </label>
                              <button onClick={() => openEditEventModal(ev)}>Редактировать</button>
                              <button className="comp-mini danger" onClick={() => deleteCalendarEvent(ev.id)}>✕</button>
                            </div>
                          </div>
                          {expanded && ev.description && (
                            <div className="chronicle-row__expanded" style={{ whiteSpace: "pre-wrap" }}>
                              <MentionText text={ev.description} />
                            </div>
                          )}
                        </div>
                      );
                    })}
                    {calendarEvents.length === 0 && <EmptyState icon="issueStamp" title="ХРОНИКА ПУСТА" hint="Первое событие задаёт летоисчисление мира" action={<button className="primary" onClick={() => openCreateEventModal(1, 1, 1)}>+ Создать событие</button>} />}
                  </div>
                </div>
              </details>
            </div>
            <div className="chronicle-right stack" style={{ gap: "var(--sp-4)" }}>
              <details className="card res-group" open>
                <summary className="res-group__band">
                  <span className="res-group__title">Календарь</span>
                  <span className="res-group__count" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>{calendar ? `${calendar.months.length} мес.` : "—"}</span>
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
                      onPin={pinCampaignCalendar}
                      onDayContextMenu={handleCalendarDayContextMenu}
                      onItemClick={handleCalendarItemClick}
                      onItemContextMenu={handleCalendarItemContextMenu}
                    />
                  )}
                  <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
                    Правый клик / долгое нажатие по дню — создать событие; по событию — редактировать или удалить. Серые метки — важные даты из профилей сеттинга.
                  </span>
                </div>
              </details>
            </div>
          </div>
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
    </div>
  );
}

// Not currently rendered — the "Ресурсы" tab was removed (Phase 3), but this
// stays wired and exported in case the tab comes back.
export function GroupThemeSection({ campaignId, initial }: { campaignId: number; initial: string | null }) {
  const [saved, setSaved] = useState<LitMThemeCard>(() =>
    initial ? normalizeTheme(JSON.parse(initial)) : emptyTheme()
  );
  const [draft, setDraft] = useState<LitMThemeCard>(saved);
  const [editing, setEditing] = useState(false);

  function startEdit() {
    setDraft(saved);
    setEditing(true);
  }

  async function save() {
    await api.put(`/campaigns/${campaignId}`, { group_theme_litm: JSON.stringify(draft) });
    setSaved(draft);
    setEditing(false);
  }

  async function quickUpdate(v: LitMThemeCard) {
    setSaved(v);
    await api.put(`/campaigns/${campaignId}`, { group_theme_litm: JSON.stringify(v) });
  }

  async function applyToAll(theme: LitMThemeCard) {
    if (
      !confirm(
        "Применить эту тему как общую командную тему для всех персонажей кампании? Она заменит текущую командную тему у каждого персонажа."
      )
    ) {
      return;
    }
    await api.post(`/campaigns/${campaignId}/group-theme/apply`, { theme });
    setSaved(theme);
    setEditing(false);
  }

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3>Тема группы (Legend in the Mist)</h3>
        {!editing && <button onClick={startEdit}>Редактировать</button>}
      </div>
      <p className="muted">
        Автоматически добавляется каждому новому персонажу кампании при создании статблока.
      </p>
      {editing ? (
        <>
          <ThemeCardEdit value={draft} onChange={setDraft} onMakeGroupTheme={() => applyToAll(draft)} />
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </>
      ) : (
        <ThemeCardView value={saved} onQuickUpdate={quickUpdate} onMakeGroupTheme={() => applyToAll(saved)} />
      )}
    </div>
  );
}

// Same as GroupThemeSection above — kept for if the "Ресурсы" tab returns.
export function CampaignResourcesTab({
  campaignId,
  resources,
  onChange,
}: {
  campaignId: number;
  resources: Resource[];
  onChange: () => void;
}) {
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [linkUrl, setLinkUrl] = useState("");
  const [category, setCategory] = useState<CampaignResourceCategory>("misc");

  async function addResource() {
    if (!name.trim()) return;
    const form = new FormData();
    form.append("name", name);
    form.append("scope", "campaign");
    form.append("campaign_id", String(campaignId));
    form.append("type", category);
    if (file) form.append("file", file);
    if (linkUrl) form.append("link_url", linkUrl);
    await api.post("/resources", form);
    setName("");
    setFile(null);
    setLinkUrl("");
    onChange();
  }

  async function archiveResource(id: number) {
    await api.del(`/resources/${id}`);
    onChange();
  }

  function renderGroup(label: string, type: CampaignResourceCategory) {
    const knownTypes: string[] = CAMPAIGN_RESOURCE_CATEGORIES.map((c) => c.value);
    const group = resources.filter((r) =>
      type === "misc" ? !knownTypes.includes(r.type) || r.type === "misc" : r.type === type
    );
    return (
      <div>
        <strong>{label}</strong>
        <div className="grid-cards">
          {group.map((r) => (
            <ResourceCard key={r.id} resource={r} onChange={onChange} onArchive={archiveResource} />
          ))}
          {group.length === 0 && <span className="muted">нет</span>}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="row">
        <input
          placeholder="Название ресурса"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as CampaignResourceCategory)}
        >
          {CAMPAIGN_RESOURCE_CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
        <input type="file" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        <input
          placeholder="…или ссылка (вместо файла)"
          value={linkUrl}
          onChange={(e) => setLinkUrl(e.target.value)}
        />
        <button className="primary" onClick={addResource}>
          Добавить
        </button>
      </div>
      {CAMPAIGN_RESOURCE_CATEGORIES.map((c) => (
        <div key={c.value}>{renderGroup(c.label, c.value)}</div>
      ))}
    </div>
  );
}

type CampaignResourceCategory = "reference" | "photo" | "misc";
const CAMPAIGN_RESOURCE_CATEGORIES: { value: CampaignResourceCategory; label: string }[] = [
  { value: "reference", label: "Референсы" },
  { value: "photo", label: "Фотохроника" },
  { value: "misc", label: "Разное" },
];

function PlayersAndCharactersTab({
  campaignId,
  roster,
  allPlayers,
  onRosterChange,
}: {
  campaignId: number;
  roster: RosterPlayer[];
  allPlayers: Player[];
  onRosterChange: () => void;
}) {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [addingFor, setAddingFor] = useState<number | null>(null);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const thumbnailStyles = loadThumbnailStyles();

  function refresh() {
    api.get<Character[]>(`/characters?campaign_id=${campaignId}`).then(setCharacters);
  }
  useEffect(refresh, [campaignId]);

  async function addToRoster(playerId: string, e: React.ChangeEvent<HTMLSelectElement>) {
    if (!playerId) return;
    await api.post(`/campaigns/${campaignId}/roster/${playerId}`);
    e.target.value = "";
    onRosterChange();
  }
  async function removeFromRoster(playerId: number) {
    if (!confirm(`Убрать игрока из состава кампании? Персонажи сохранятся.`)) return;
    await api.del(`/campaigns/${campaignId}/roster/${playerId}`);
    onRosterChange();
  }
  async function toggleLeft(playerId: number, currentStatus: string) {
    await api.put(`/campaigns/${campaignId}/roster/${playerId}`, {
      status: currentStatus === "left" ? "active" : "left",
    });
    onRosterChange();
  }

  async function addCharacter(playerId: number) {
    const name = (drafts[playerId] ?? "").trim();
    if (!name) return;
    if (characters.some((c) => c.player_id === playerId && c.character_name.toLowerCase() === name.toLowerCase())) {
      alert("Персонаж с таким именем уже есть у этого игрока.");
      return;
    }
    await api.post("/characters", {
      player_id: playerId,
      campaign_id: campaignId,
      character_name: name,
    });
    setDrafts((d) => ({ ...d, [playerId]: "" }));
    setAddingFor(null);
    refresh();
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
        <span className="muted" style={{ fontSize: 11 }}>{roster.length} в составе{available.length ? ` · ещё ${available.length} вне` : ""}</span>
      </div>
      {roster.length === 0 ? (
        <EmptyState
          icon="skullDie"
          title="КОМАНДА ЕЩЁ НЕ СОБРАНА"
          hint="Добавьте первого игрока — его персонажи появятся здесь же, на карточке."
          action={available.length > 0 ? <span className="muted" style={{ fontSize: 12 }}>Выберите игрока выше ↑</span> : <Link to="/players">Создать игрока →</Link>}
        />
      ) : (
        <div className="grid-cards roster-grid">
          {roster.map((p) => {
            const playerCharacters = characters.filter((c) => c.player_id === p.id);
            const firstAvatar = playerCharacters.find((c) => c.avatar_image_url)?.avatar_image_url;
            return (
              <RosterCard
                key={p.id}
                player={p}
                fallbackAvatar={firstAvatar ?? null}
                thumbnailStyle={thumbnailStyles.roster}
                addingCharacter={addingFor === p.id}
                charNameDraft={drafts[p.id] ?? ""}
                onCharNameDraftChange={(v) => setDrafts((d) => ({ ...d, [p.id]: v }))}
                onStartAddCharacter={() => setAddingFor(p.id)}
                onCancelAddCharacter={() => { setAddingFor(null); setDrafts((d) => ({ ...d, [p.id]: "" })); }}
                onAddCharacter={() => addCharacter(p.id)}
                onToggleLeft={() => toggleLeft(p.id, p.roster_status)}
                onRemove={() => removeFromRoster(p.id)}
                onThumbnailChanged={onRosterChange}
              >
                {playerCharacters.map((c) => (
                  <Link key={c.id} to={`/characters/${c.id}`} className="badge tag">
                    {c.character_name}
                  </Link>
                ))}
              </RosterCard>
            );
          })}
        </div>
      )}
    </div>
  );
}

function RosterCard({
  player,
  fallbackAvatar,
  thumbnailStyle,
  addingCharacter,
  charNameDraft,
  onCharNameDraftChange,
  onStartAddCharacter,
  onCancelAddCharacter,
  onAddCharacter,
  onToggleLeft,
  onRemove,
  onThumbnailChanged,
  children,
}: {
  player: RosterPlayer;
  fallbackAvatar: string | null;
  thumbnailStyle: ThumbnailStyle;
  addingCharacter: boolean;
  charNameDraft: string;
  onCharNameDraftChange: (v: string) => void;
  onStartAddCharacter: () => void;
  onCancelAddCharacter: () => void;
  onAddCharacter: () => void;
  onToggleLeft: () => void;
  onRemove: () => void;
  onThumbnailChanged: () => void;
  children: ReactNode;
}) {
  async function handleThumbnailChange(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    await api.post(`/players/${player.id}/thumbnail`, form);
    onThumbnailChanged();
  }
  const thumbnailCrop = useImageCrop("thumbnail", handleThumbnailChange);

  const thumb = cardThumbnailProps(thumbnailStyle, player.thumbnail_image_url ?? fallbackAvatar);

  const isLeft = player.roster_status === "left";
  return (
    <div className={`card roster-card ${thumb.className}${isLeft ? " is-left" : ""}`} style={thumb.style}>
      <label className="roster-card-thumb-btn" title="Изменить тамбнейл" aria-label="Изменить тамбнейл">
        <NavIcon name="image" />
        <input
          type="file"
          accept={IMAGE_ACCEPT}
          style={{ display: "none" }}
          onChange={(e) => thumbnailCrop.onSelect(e.target.files?.[0] ?? null)}
        />
      </label>
      {thumbnailCrop.modal}
      {thumb.showBanner && (
        thumb.bannerUrl ? (
          <div className="roster-card-cover cover-halftone">
            <div className="cover-art cover-photo">
              <div className="cover-art-image" style={{ backgroundImage: `url("${thumb.bannerUrl}")` }} aria-hidden="true" />
            </div>
          </div>
        ) : (
          <div className="roster-card-cover campaign-card-band zine-grain zine-torn-bottom-b" />
        )
      )}
      <div className="roster-card-body stack">
        <div className="row" style={{ flexWrap: "wrap", alignItems: "center", gap: 8 }}>
          <Link to={`/players/${player.id}`} className="roster-card-name">
            {player.name}
          </Link>
          {isLeft && <span className="badge cancelled">Покинул</span>}
        </div>
        <div className="row" style={{ flexWrap: "wrap", gap: 6, minHeight: 22 }}>
          {children}
          {addingCharacter ? (
            <>
              <input
                autoFocus
                placeholder="Имя персонажа"
                value={charNameDraft}
                onChange={(e) => onCharNameDraftChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onAddCharacter();
                  if (e.key === "Escape") onCancelAddCharacter();
                }}
                style={{ minWidth: 120, flex: "1 1 120px" }}
              />
              <button className="primary" onClick={onAddCharacter} disabled={!charNameDraft.trim()}>
                ОК
              </button>
              <button onClick={onCancelAddCharacter} aria-label="Отмена">✕</button>
            </>
          ) : (
            <button className="btn-capsule" onClick={onStartAddCharacter}>
              + Персонаж
            </button>
          )}
        </div>
        <div className="row roster-card-actions" style={{ flexWrap: "wrap", gap: 6 }}>
          <button className={isLeft ? "primary" : ""} onClick={onToggleLeft}>
            {isLeft ? "Вернуть в состав" : "Покинул"}
          </button>
          <button className="danger" onClick={onRemove}>Убрать</button>
        </div>
      </div>
    </div>
  );
}

function PlayerCharacterTab({ campaignId }: { campaignId: number }) {
  const [character, setCharacter] = useState<Character | null | undefined>(undefined);
  const [nameDraft, setNameDraft] = useState("");

  function refresh() {
    api.get<Player>("/players/self").then((self) => {
      api.get<Character[]>(`/characters?campaign_id=${campaignId}`).then((chars) => {
        setCharacter(chars.find((c) => c.player_id === self.id) ?? null);
      });
    });
  }
  useEffect(refresh, [campaignId]);

  async function createCharacter() {
    if (!nameDraft.trim()) return;
    const self = await api.get<Player>("/players/self");
    await api.post("/characters", {
      player_id: self.id,
      campaign_id: campaignId,
      character_name: nameDraft,
    });
    setNameDraft("");
    refresh();
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

const PREPRODUCTION_FIELDS: { key: keyof Preproduction; label: string; help?: string }[] = [
  {
    key: "adventure_challenge",
    label: "Adventure Challenge",
    help: "Главная проблема, которую предстоит решить в приключении.",
  },
  {
    key: "gameplay_styles",
    label: "Gameplay styles",
    help: "Основные предполагаемые активности персонажей в этом приключении.",
  },
  {
    key: "background",
    label: "Background",
    help: "Предыстория приключения: что случилось перед ним и способствовало его началу.",
  },
  {
    key: "threads_clues_lore",
    label: "Threads, clues, and lore",
    help: "Что связывает между собой происходящее в приключении.",
  },
];

// Обзор = Препродакшен (design doc, written before play starts) + Продакшен
// Player-role overview: "Основное" (editable info) + "Персонажи" (the player's
// own character card). Same collapsible-section pattern as the GM overview.
function PlayerOverviewTab({
  campaign,
  systems,
  settingsList,
  onRefresh,
}: {
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
  onRefresh: () => void;
}) {
  const campaignId = campaign.id;
  const [editingMain, setEditingMain] = useState(false);
  const [allGroups, setAllGroups] = useState<CampaignGroup[]>([]);
  const [campaignGroupIds, setCampaignGroupIds] = useState<number[]>([]);
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

  async function save(partial: Record<string, unknown>) {
    await api.put(`/campaigns/${campaignId}`, partial);
    onRefresh();
  }

  useEffect(() => {
    api.get<CampaignGroup[]>("/campaign-groups").then(setAllGroups).catch(() => {});
    api.get<CampaignGroup[]>(`/campaign-groups/by-campaign/${campaignId}`).then((groups) => {
      setCampaignGroupIds(groups.map((g) => g.id));
    }).catch(() => {});
  }, [campaignId]);

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
                    <input type="number" value={form.session_rate} onChange={(e) => setForm({ ...form, session_rate: e.target.value })} />
                  </label>
                </>
              )}
              <label>
                <span className="campaign-field-label">Валюта</span>
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </label>
              <div className="campaign-actions">
                <button onClick={() => setEditingMain(false)}>Отмена</button>
                <button className="primary" onClick={() => {
                  save({
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
                  setEditingMain(false);
                }}>Сохранить</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <span className="campaign-field-label" style={{ fontSize: 11 }}>Группы кампаний</span>
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
                        onChange={async () => {
                          if (isIn) {
                            await api.del(`/campaign-groups/${g.id}/members?campaignIds=${campaignId}`);
                          } else {
                            await api.post(`/campaign-groups/${g.id}/members`, { campaignIds: [campaignId] });
                          }
                          const groups = await api.get<CampaignGroup[]>(`/campaign-groups/by-campaign/${campaignId}`);
                          setCampaignGroupIds(groups.map((gr) => gr.id));
                        }}
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
function OverviewTab({
  campaign,
  systems,
  settingsList,
  sessions,
  onRefresh,
}: {
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
  sessions: SessionSummary[];
  onRefresh: () => void;
}) {
  const campaignId = campaign.id;
  const [editingMain, setEditingMain] = useState(false);
  const [allGroups, setAllGroups] = useState<CampaignGroup[]>([]);
  const [campaignGroupIds, setCampaignGroupIds] = useState<number[]>([]);
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
  const bgCrop = useImageCrop("background", async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    await api.post(`/campaigns/${campaignId}/background`, fd);
    onRefresh();
  });
  const thumbCrop = useImageCrop("thumbnail", async (file) => {
    const fd = new FormData();
    fd.append("file", file);
    await api.post(`/campaigns/${campaignId}/thumbnail`, fd);
    onRefresh();
  });

  async function save(partial: Record<string, unknown>) {
    await api.put(`/campaigns/${campaignId}`, partial);
    onRefresh();
  }

  useEffect(() => {
    api.get<CampaignGroup[]>("/campaign-groups").then(setAllGroups).catch(() => {});
    api.get<CampaignGroup[]>(`/campaign-groups/by-campaign/${campaignId}`).then((groups) => {
      setCampaignGroupIds(groups.map((g) => g.id));
    }).catch(() => {});
  }, [campaignId]);

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

  const bgUrl = campaign.background_image_url ?? null;
  const thumbUrl = campaign.thumbnail_image_url ?? null;

  return (
    <div className="stack campaign-overview">
      <details className="card res-group" open>
        <summary className="res-group__band">
          <span className="res-group__title">Основное</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
          {!editingMain ? (
            <div className="stack">
              <table className="detail-table">
                <tbody>
                  <tr><td className="detail-label">Название</td><td><span className="detail-value-mono">{campaign.name}</span></td></tr>
                  <tr><td className="detail-label">Тип</td><td><span className="detail-value-mono">{CAMPAIGN_TYPE_OPTIONS.find((o) => o.value === campaign.type)?.label ?? campaign.type}</span></td></tr>
                  <tr><td className="detail-label">Система</td><td><span className="detail-value-mono">{systemName}</span></td></tr>
                  <tr><td className="detail-label">Сеттинг</td><td><span className="detail-value-mono">{settingName}</span></td></tr>
                  <tr><td className="detail-label">Статус</td><td><span className="detail-value-mono">{CAMPAIGN_STATUS_LABELS[campaign.status as keyof typeof CAMPAIGN_STATUS_LABELS] ?? campaign.status}</span></td></tr>
                  <tr><td className="detail-label">Оплата</td><td><span className="detail-value-mono">{PAYMENT_TYPE_LABELS[campaign.payment_type] ?? campaign.payment_type}</span></td></tr>
                  {campaign.payment_type === "paid" && (
                    <>
                      <tr><td className="detail-label">Периодичность</td><td><span className="detail-value-mono">{PAYMENT_FREQUENCY_LABELS[campaign.payment_frequency] ?? campaign.payment_frequency}</span></td></tr>
                      <tr><td className="detail-label">Тип ставки</td><td><span className="detail-value-mono">{RATE_SPLIT_LABELS[campaign.rate_split] ?? campaign.rate_split}</span></td></tr>
                      <tr><td className="detail-label">Ставка</td><td><span className="detail-value-mono">{campaign.session_rate ?? 0} {campaign.currency}</span></td></tr>
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
                    <input type="number" value={form.session_rate} onChange={(e) => setForm({ ...form, session_rate: e.target.value })} />
                  </label>
                </>
              )}
              <label>
                <span className="campaign-field-label">Валюта</span>
                <input value={form.currency} onChange={(e) => setForm({ ...form, currency: e.target.value })} />
              </label>
              <div className="campaign-actions">
                <button onClick={() => setEditingMain(false)}>Отмена</button>
                <button className="primary" onClick={() => {
                  save({
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
                  setEditingMain(false);
                }}>Сохранить</button>
              </div>
            </div>
          )}

          <div style={{ marginTop: 8 }}>
            <span className="campaign-field-label" style={{ fontSize: 11 }}>Группы кампаний</span>
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
                        onChange={async () => {
                          if (isIn) {
                            await api.del(`/campaign-groups/${g.id}/members?campaignIds=${campaignId}`);
                          } else {
                            await api.post(`/campaign-groups/${g.id}/members`, { campaignIds: [campaignId] });
                          }
                          const groups = await api.get<CampaignGroup[]>(`/campaign-groups/by-campaign/${campaignId}`);
                          setCampaignGroupIds(groups.map((gr) => gr.id));
                        }}
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
          <span className="res-group__title">Приключения</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <CampaignAdventuresCard campaignId={campaign.id} settingId={campaign.setting_id} />
        </div>
      </details>

      <details className="card res-group">
        <summary className="res-group__band">
          <span className="res-group__title">Препродакшен</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <PreproductionTab campaign={campaign} systems={systems} settingsList={settingsList} />
        </div>
      </details>

      <details className="card res-group" open>
        <summary className="res-group__band">
          <span className="res-group__title">Продакшен</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <ProductionDashboard campaign={campaign} sessions={sessions} />
        </div>
      </details>

      <PostProductionSection campaign={campaign} sessions={sessions} />

      <details className="card res-group">
        <summary className="res-group__band">
          <span className="res-group__title">Изображения</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}>
          <div className="row" style={{ gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          <div style={{ flex: "1 1 0", minWidth: 220 }}>
            <div className="muted" style={{ marginBottom: 6, fontSize: 11 }}>Фон страницы — на всю ширину, приглушён на 30 % (как в плитке):</div>
            {bgUrl ? (
              <div className="campaign-tile-cover cover-halftone" style={{ border: "1px solid var(--line)", marginBottom: 8, aspectRatio: "16 / 10", background: "var(--paper-2)" }}>
                <div className="cover-art cover-photo">
                  <div className="cover-art-image" style={{ backgroundImage: `url("${bgUrl}")` }} aria-hidden="true" />
                </div>
                <div className="campaign-tile-scrim" style={{ opacity: 0.35 }} />
              </div>
            ) : (
              <div className="campaign-tile-cover campaign-card-band zine-grain" style={{ border: "1px solid var(--line)", marginBottom: 8, aspectRatio: "16 / 10" }} aria-hidden="true" />
            )}
            <label>
              Заменить фон
              <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => bgCrop.onSelect(e.target.files?.[0] ?? null)} />
              <span className="muted image-hint">{IMAGE_HINT}</span>
            </label>
            {bgCrop.modal}
          </div>
          <div style={{ flex: "1 1 0", minWidth: 220 }}>
            <div className="muted" style={{ marginBottom: 6, fontSize: 11 }}>Тамбнейл — 16×10, так в сетке «Кампании» и на Главной:</div>
            {thumbUrl ? (
              <div className="card campaign-tile" style={{ padding: 0, overflow: "hidden", marginBottom: 8 }}>
                <div className="campaign-tile-cover cover-halftone">
                  <div className="cover-art cover-photo">
                    <div className="cover-art-image" style={{ backgroundImage: `url("${thumbUrl}")` }} aria-hidden="true" />
                  </div>
                  <div className="campaign-tile-scrim" />
                  <h3 className="campaign-tile-name" style={{ fontSize: "var(--fs-h3)" }}>{campaign.name}</h3>
                </div>
                <div className="campaign-tile-meta">
                  <div className="campaign-tile-system" style={{ fontSize: "var(--fs-meta)" }}>{systems.find((s) => s.id === campaign.system_id)?.name ?? "система не выбрана"}</div>
                  <div className="campaign-tile-next" style={{ fontSize: "var(--fs-meta)" }}><span className="campaign-tile-next-mark" aria-hidden="true" /><span>превью 16×10</span></div>
                </div>
              </div>
            ) : (
              <div className="card campaign-tile" style={{ padding: 0, overflow: "hidden", marginBottom: 8 }}>
                <div className="campaign-tile-cover campaign-card-band zine-grain" style={{ aspectRatio: "16 / 10" }} aria-hidden="true" />
                <div className="campaign-tile-meta"><span className="muted" style={{ fontSize: 11 }}>Без тамбнейла — показывается полоса темы</span></div>
              </div>
            )}
            <label>
              Заменить тамбнейл
              <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => thumbCrop.onSelect(e.target.files?.[0] ?? null)} />
              <span className="muted image-hint">{IMAGE_HINT}</span>
            </label>
            {thumbCrop.modal}
          </div>
        </div>
        </div>
      </details>
    </div>
  );
}

// A quick "what's the state of this campaign right now" glance: the next
// planned session, the last couple of chronicle entries, and how many
// secrets are still unrevealed — everything a GM might otherwise have to
// visit three different tabs to piece together. Deliberately lighter than
// Хроника игр (the full session index) — this is a summary, not a duplicate.
function ProductionDashboard({ campaign, sessions }: { campaign: CampaignDetail; sessions: SessionSummary[] }) {
  const [secretsCount, setSecretsCount] = useState<number | null>(null);

  useEffect(() => {
    api
      .get<CampaignGrouped<StorySecret>>(`/story/campaign-secrets?campaign_id=${campaign.id}`)
      .then((data) => {
        const all = [...data.own, ...data.groups.flatMap((g) => g.items)];
        setSecretsCount(all.filter((s) => s.state?.revealed !== 1).length);
      });
  }, [campaign.id]);

  const today = toLocalDateKey();
  const nextSession = sessions
    .filter((s) => s.status === "planned" && s.date >= today)
    .sort((a, b) => a.date.localeCompare(b.date))[0];
  const recentChronicle = sessions
    .filter((s) => s.status === "held" && s.main_events)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 2);

  return (
    <div className="stack">
      <div className="card stack">
        <span className="campaign-field-label">Ближайшая сессия</span>
        {nextSession ? (
          <Link to={`/sessions/${nextSession.id}`} style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-body)" }}>
            {nextSession.date} — {nextSession.title || `Сессия №${nextSession.session_number ?? ""}`}
          </Link>
        ) : (
          <div className="card" style={{ borderStyle: "dashed" }}>
            <p style={{ maxWidth: "62ch" }}>Сессий не запланировано — время наметить следующую игру.</p>
            <Link to="/sessions" className="campaign-actions"><button className="primary">Запланировать сессию</button></Link>
          </div>
        )}
      </div>
      <div className="card stack">
        <span className="campaign-field-label">Недавние события</span>
        {recentChronicle.length > 0 ? (
          recentChronicle.map((s) => (
            <div key={s.id} className="stack" style={{ gap: 2 }}>
              <Link to={`/sessions/${s.id}`}>
                {s.date} — {s.title || `Сессия №${s.session_number ?? ""}`}
              </Link>
              <p className="muted" style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={s.main_events ?? ""} />
              </p>
            </div>
          ))
        ) : (
          <span className="muted">Пока нет записанных событий — появятся из «Хроники игр».</span>
        )}
      </div>
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span><span className="campaign-field-label" style={{ display: "inline", marginRight: 6 }}>Нераскрытых тайн:</span> <span style={{ fontFamily: "var(--font-mono)" }}>{secretsCount ?? "…"}</span></span>
      </div>
      {campaign.setting_id && (
        <div className="row">
          <Link to={`/settings/${campaign.setting_id}?tab=${encodeURIComponent("Население")}`}>
            Население сеттинга →
          </Link>
          <Link to={`/settings/${campaign.setting_id}?tab=${encodeURIComponent("География")}`}>
            География сеттинга →
          </Link>
        </div>
      )}
    </div>
  );
}

function PostProductionSection({ campaign, sessions }: { campaign: CampaignDetail; sessions: SessionSummary[] }) {
  const [postCount, setPostCount] = useState<number | null>(null);
  useEffect(() => {
    api.get<CampaignEntry[]>(`/campaign-entries?campaign_id=${campaign.id}&category=post_production`).then((rows) => setPostCount(rows.length)).catch(() => setPostCount(0));
  }, [campaign.id]);
  const hasHeld = sessions.some((s) => s.status === "held");
  if (postCount === null) {
    return (
      <details className="card res-group">
        <summary className="res-group__band">
          <span className="res-group__title">Пост-продакшен</span>
        </summary>
        <div className="res-group__body" style={{ padding: 12 }}><span className="muted">Загрузка…</span></div>
      </details>
    );
  }
  if (!hasHeld && postCount === 0) return null;
  return (
    <details className="card res-group">
      <summary className="res-group__band">
        <span className="res-group__title">Пост-продакшен</span>
      </summary>
      <div className="res-group__body" style={{ padding: 12, gap: 8, display: "flex", flexDirection: "column" }}>
        <p className="muted" style={{ maxWidth: "62ch" }}>
          Итоги кампании: что получилось, что нет, эпилоги персонажей, несбывшиеся сюжетные
          линии, идеи для сиквела — свободные записи, как и в остальных списках заметок.
        </p>
        <CampaignEntryList
          campaignId={campaign.id}
          category="post_production"
          addLabel="+ Добавить запись"
          emptyLabel="Итогов пока нет."
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      </div>
    </details>
  );
}

function PreproductionTab({
  campaign,
  systems,
  settingsList,
}: {
  campaign: CampaignDetail;
  systems: System[];
  settingsList: Setting[];
}) {
  const campaignId = campaign.id;
  const [pre, setPre] = useState<Preproduction | null>(null);
  const [originalPre, setOriginalPre] = useState<Preproduction | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [initialized, setInitialized] = useState(false);

  function refresh() {
    api.get<Preproduction>(`/campaigns/${campaignId}/preproduction`).then((p) => {
      setPre(p);
      setOriginalPre(p);
    });
  }
  useEffect(() => {
    setInitialized(false);
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaignId]);

  useEffect(() => {
    if (pre && !initialized) {
      const empty =
        PREPRODUCTION_FIELDS.every((f) => !pre[f.key]) && !pre.adventure_stakes_hooks;
      setEditMode(empty);
      setInitialized(true);
    }
  }, [pre, initialized]);

  if (!pre) return <p className="muted">Загрузка…</p>;

  async function save() {
    if (!pre) return;
    await api.put(`/campaigns/${campaignId}/preproduction`, pre);
    if (originalPre) {
      for (const f of PREPRODUCTION_FIELDS) {
        syncMentionLinks(
          "campaign",
          campaignId,
          (originalPre[f.key] as string) ?? "",
          (pre[f.key] as string) ?? ""
        );
      }
      syncMentionLinks(
        "campaign",
        campaignId,
        originalPre.adventure_stakes_hooks ?? "",
        pre.adventure_stakes_hooks ?? ""
      );
    }
    refresh();
    setEditMode(false);
  }

  const system = systems.find((s) => s.id === campaign.system_id);
  const setting = settingsList.find((s) => s.id === campaign.setting_id);

  return (
    <div className="stack">
      <div className="card row">
        <span className="row" style={{ gap: 4 }}>
          <span className="muted">Система:</span>
          {system ? <Link to={`/systems/${system.id}`}>{system.name}</Link> : <span className="muted">—</span>}
        </span>
        <span className="row" style={{ gap: 4 }}>
          <span className="muted">Сеттинг:</span>
          {setting ? <Link to={`/settings/${setting.id}`}>{setting.name}</Link> : <span className="muted">—</span>}
        </span>
      </div>

      {!editMode ? (
        <div className="stack">
          {PREPRODUCTION_FIELDS.map(
            (f) =>
              pre[f.key] && (
                <div key={f.key} className="card stack">
                  <span className="campaign-field-label" style={{ color: "var(--ink)" }}>{f.label}</span>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={pre[f.key] as string} />
                  </div>
                </div>
              )
          )}
          {pre.adventure_stakes_hooks && (
            <div className="card stack">
              <span className="campaign-field-label" style={{ color: "var(--ink)" }}>Adventure Stakes and Hooks</span>
              <div style={{ whiteSpace: "pre-wrap" }}>
                <MentionText text={pre.adventure_stakes_hooks} />
              </div>
            </div>
          )}
          <LinkDropZone entityType="preproduction" entityId={campaignId} title="Крючки (персонажи)" />
          <button className="primary" onClick={() => setEditMode(true)} style={{ alignSelf: "flex-start" }}>
            Редактировать
          </button>
        </div>
      ) : (
        <div className="stack">
          {PREPRODUCTION_FIELDS.map((f) => (
            <div key={f.key} className="card stack">
              <span className="campaign-field-label" style={{ color: "var(--ink)" }}>{f.label}</span>
              {f.help && <span className="muted" style={{ fontSize: "11px", maxWidth: "62ch" }}>{f.help}</span>}
              <MentionTextarea
                value={pre[f.key] as string}
                onChange={(v) => setPre({ ...pre, [f.key]: v })}
                rows={3}
              />
            </div>
          ))}
          <div className="card stack">
            <span className="campaign-field-label" style={{ color: "var(--ink)" }}>Adventure Stakes and Hooks</span>
            <span className="muted" style={{ fontSize: "11px", maxWidth: "62ch" }}>
              Как эта проблема связана с героями приключения. Перетащите сюда персонажей игроков
              из поиска — появится связь в разделе «Отношения» персонажа.
            </span>
            <MentionTextarea
              value={pre.adventure_stakes_hooks}
              onChange={(v) => setPre({ ...pre, adventure_stakes_hooks: v })}
              rows={3}
            />
            <LinkDropZone entityType="preproduction" entityId={campaignId} title="Крючки (персонажи)" />
          </div>
          <div className="row">
            <button className="primary" onClick={save}>
              Сохранить
            </button>
            <button onClick={() => setEditMode(false)}>Отмена</button>
          </div>
        </div>
      )}
    </div>
  );
}
