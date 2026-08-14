import { useEffect, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { copySessionPrep } from "../sessionCopy";
import { Modal } from "../components/Modal";
import { MonthCalendar, type CalendarEvent } from "../components/MonthCalendar";
import { LinkDropZone } from "../components/LinkDropZone";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { CampaignEntryList } from "../components/CampaignEntryList";
import { WorldExplorationTab } from "../components/WorldExplorationTab";
import { CampaignPlayerSectionsTab } from "../components/CampaignPlayerSectionsTab";
import { TaskTracker } from "../components/TaskTracker";
import { SecretsTracker } from "../components/SecretsTracker";
import { ResourceCard } from "../components/ResourceCard";
import { RemindersWidget } from "../components/RemindersWidget";
import { NavIcon } from "../components/NavIcons";
import { IMAGE_ACCEPT, IMAGE_HINT } from "../imageUpload";
import {
  PAYMENT_TYPE_LABELS,
  PAYMENT_TYPE_OPTIONS,
  CAMPAIGN_TYPE_OPTIONS,
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
import { AdventuresTab } from "../components/AdventuresTab";
import type {
  CampaignCalendarEvent,
  CampaignDetail,
  CampaignEntry,
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
  System,
} from "../types";

const GM_TABS = [
  "Обзор",
  "Игроки и персонажи",
  "Приключения",
  "Тайны и зацепки",
  "Заметки по ведению",
  "Хроника игр",
  "Хроника мира",
  "Для игроков",
] as const;
const PLAYER_TABS = ["Персонаж", "Заметки", "Клёвые цитаты", "Трекер задач", "Хроника игр", "Исследование Мира"] as const;

export function CampaignDetailPage() {
  const { id } = useParams();
  const campaignId = Number(id);
  const navigate = useNavigate();

  const [campaign, setCampaign] = useState<CampaignDetail | null>(null);
  const calendar = useSettingCalendar(campaign?.setting_id);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [allPlayers, setAllPlayers] = useState<Player[]>([]);
  const tabs = campaign?.role === "player" ? PLAYER_TABS : GM_TABS;
  const [tab, selectTab] = useTabState(tabs, campaign?.role === "player" ? "Персонаж" : "Обзор");
  const [worldView, setWorldView] = useState<"calendar" | "list">(
    () => (localStorage.getItem("campaignWorldView") as "calendar" | "list") || "calendar"
  );
  function changeWorldView(v: "calendar" | "list") {
    setWorldView(v);
    localStorage.setItem("campaignWorldView", v);
  }

  const [creatingDate, setCreatingDate] = useState<string | null>(null);
  const [newStatus, setNewStatus] = useState<SessionStatus>("planned");
  const [newPaymentOverride, setNewPaymentOverride] = useState<"" | PaymentType>("");
  const [newStake, setNewStake] = useState("");
  const [repeatInterval, setRepeatInterval] = useState<"none" | "7" | "14">("none");
  const [repeatCount, setRepeatCount] = useState("4");
  const [newCopyFromSessionId, setNewCopyFromSessionId] = useState("");

  const [editing, setEditing] = useState(false);
  const [systems, setSystems] = useState<System[]>([]);
  const [settingsList, setSettingsList] = useState<Setting[]>([]);
  const [bgFile, setBgFile] = useState<File | null>(null);
  const bgCrop = useImageCrop("background", setBgFile);
  const [thumbFile, setThumbFile] = useState<File | null>(null);
  const thumbCrop = useImageCrop("thumbnail", setThumbFile);
  const [editForm, setEditForm] = useState({
    name: "",
    type: "campaign" as CampaignType,
    payment_type: "free" as PaymentType,
    payment_frequency: "per_session" as PaymentFrequency,
    rate_split: "per_person" as RateSplit,
    session_rate: "0",
    currency: "RUB",
    status: "active",
    system_id: "",
    setting_id: "",
  });

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
  } | null>(null);

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
    api.get<CampaignDetail>(`/campaigns/${campaignId}`).then((c) => {
      setCampaign(c);
      setEditForm({
        name: c.name,
        type: c.type,
        payment_type: c.payment_type,
        payment_frequency: c.payment_frequency,
        rate_split: c.rate_split,
        session_rate: String(c.session_rate),
        currency: c.currency,
        status: c.status,
        system_id: c.system_id ? String(c.system_id) : "",
        setting_id: c.setting_id ? String(c.setting_id) : "",
      });
    });
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
    setEventModal({ year, month, day, title: "", description: "", important: false });
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

  async function pinCampaignCalendar(pinned: { year: number; month: number } | null) {
    await api.put(`/campaigns/${campaignId}/pinned-calendar`, {
      year: pinned?.year ?? null,
      month: pinned?.month ?? null,
    });
    refreshCampaign();
  }

  async function saveEventModal() {
    if (!eventModal || !eventModal.title.trim()) return;
    const payload = {
      title: eventModal.title,
      description: eventModal.description,
      inworld_year: eventModal.year,
      inworld_month: eventModal.month,
      inworld_day: eventModal.day,
      important: eventModal.important,
    };
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

  const sortedCalendarEvents = [...calendarEvents].sort((a, b) => {
    if (!!a.important !== !!b.important) return a.important ? -1 : 1;
    if (a.inworld_year !== b.inworld_year) return a.inworld_year - b.inworld_year;
    if (a.inworld_month !== b.inworld_month) return a.inworld_month - b.inworld_month;
    return a.inworld_day - b.inworld_day;
  });

  function toggleEventExpanded(eventId: number) {
    setExpandedEvents((prev) => {
      const next = new Set(prev);
      if (next.has(eventId)) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
  }

  async function createSession() {
    if (!creatingDate) return;
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
  }

  async function saveCampaignEdit() {
    await api.put(`/campaigns/${campaignId}`, {
      name: editForm.name,
      type: editForm.type,
      payment_type: editForm.payment_type,
      payment_frequency: editForm.payment_frequency,
      rate_split: editForm.rate_split,
      session_rate: Number(editForm.session_rate) || 0,
      currency: editForm.currency,
      status: editForm.status,
      system_id: editForm.system_id ? Number(editForm.system_id) : null,
      setting_id: editForm.setting_id ? Number(editForm.setting_id) : null,
    });
    if (bgFile) {
      const form = new FormData();
      form.append("file", bgFile);
      await api.post(`/campaigns/${campaignId}/background`, form);
      setBgFile(null);
    }
    if (thumbFile) {
      const form = new FormData();
      form.append("file", thumbFile);
      await api.post(`/campaigns/${campaignId}/thumbnail`, form);
      setThumbFile(null);
    }
    setEditing(false);
    refreshCampaign();
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
      {
        label: "Статус: Отмена",
        onClick: async () => {
          await api.put(`/sessions/${event.id}`, { status: "cancelled" });
          refreshSessions();
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
              {campaign.role === "player" ? (
                campaign.name
              ) : (
                <button type="button" className="entity-title-link" onClick={() => selectTab("Обзор")} title="К обзору">
                  {campaign.name}
                </button>
              )}
            </h1>
            <EntityTypeChip type="campaign" />
          </div>
          <div className="muted">
            {campaign.system_name ?? "система не выбрана"} · {campaign.status}
          </div>
        </div>
        <div className="row">
          {campaign.role === "player" ? (
            <div className="badge role-player-badge zine-rotate">Я игрок</div>
          ) : (
            !loadHideFinance() && (
              <div className="badge tag">
                {campaign.finance.earned} {campaign.currency}
              </div>
            )
          )}
          <div className="entity-header-actions">
            <button onClick={() => setEditing(true)}>Редактировать</button>
            <button className="danger" onClick={archiveCampaign}>
              Архивировать
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

      {tab === "Персонаж" && <PlayerCharacterTab campaignId={campaignId} />}

      {tab === "Заметки" && (
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

      {tab === "Заметки по ведению" && (
        <CampaignEntryList
          campaignId={campaignId}
          category="gm_notes"
          addLabel="+ Добавить заметку"
          emptyLabel="Заметок по ведению пока нет."
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Трекер задач" && (
        <TaskTracker campaignId={campaignId} defaultSettingId={campaign.setting_id ?? undefined} />
      )}

      {tab === "Приключения" &&
        (campaign.setting_id ? (
          <div className="card stack">
            <AdventuresTab settingId={campaign.setting_id} campaignId={campaignId} />
          </div>
        ) : (
          <p className="muted">
            Приключения живут в сеттинге — выберите сеттинг кампании во вкладке «Обзор».
          </p>
        ))}

      {tab === "Тайны и зацепки" && (
        <SecretsTracker campaignId={campaignId} defaultSettingId={campaign.setting_id ?? undefined} />
      )}

      {tab === "Обзор" && (
        <OverviewTab campaign={campaign} systems={systems} settingsList={settingsList} sessions={sessions} />
      )}

      {tab === "Для игроков" && (
        <CampaignPlayerSectionsTab
          campaignId={campaignId}
          roster={campaign.roster}
          defaultSettingId={campaign.setting_id ?? undefined}
        />
      )}

      {tab === "Игроки и персонажи" && (
        <div className="stack">
          <PlayersAndCharactersTab
            campaignId={campaignId}
            roster={campaign.roster}
            allPlayers={allPlayers}
            onRosterChange={refreshCampaign}
          />
          <RemindersWidget targetType="campaign" targetId={campaignId} />
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
                <div>Проведено сессий: {campaign.finance.heldSessions}</div>
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
                <div>Проведено сессий: {campaign.finance.heldSessions}</div>
                <strong>
                  Заработано: {campaign.finance.earned} {campaign.currency}
                </strong>
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
                      <button onClick={() => archiveSession(s.id)}>✕</button>
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
        <div className="card stack">
          <div className="row sort-toggle" style={{ gap: 4, justifyContent: "space-between" }}>
            <div className="row" style={{ gap: 4 }}>
              <button
                className={worldView === "calendar" ? "active-sort" : ""}
                onClick={() => changeWorldView("calendar")}
              >
                Сетка
              </button>
              <button className={worldView === "list" ? "active-sort" : ""} onClick={() => changeWorldView("list")}>
                Список
              </button>
            </div>
            <button className="primary" onClick={() => openCreateEventModal(1, 1, 1)}>
              + Создать событие
            </button>
          </div>

          {worldView === "calendar" ? (
            <>
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
              <span className="muted">
                Правый клик по дню — создать событие; по событию — редактировать или удалить. Серые
                метки — важные даты, перенесённые из профилей существ и сообществ сеттинга.
              </span>
            </>
          ) : (
            <div className="stack">
              {sortedCalendarEvents.map((ev) => {
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
                        <span>
                          {formatEventDate(ev.inworld_year, ev.inworld_month, ev.inworld_day, calendar?.months ?? [])}
                          {" — "}
                          <strong>{ev.title}</strong>
                        </span>
                      </span>
                      <div className="row">
                        <label className="row">
                          <input
                            type="checkbox"
                            checked={!!ev.important}
                            onChange={() => toggleEventImportant(ev)}
                          />
                          Важно
                        </label>
                        <button onClick={() => openEditEventModal(ev)}>Редактировать</button>
                        <button className="danger" onClick={() => deleteCalendarEvent(ev.id)}>
                          Удалить
                        </button>
                      </div>
                    </div>
                    {expanded && ev.description && (
                      <div style={{ whiteSpace: "pre-wrap", marginLeft: 28 }}>
                        <MentionText text={ev.description} />
                      </div>
                    )}
                  </div>
                );
              })}
              {calendarEvents.length === 0 && <p className="muted">Событий пока нет.</p>}
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
          <h2>Сессия {creatingDate}</h2>
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
              <button onClick={() => setCreatingDate(null)}>Отмена</button>
              <button className="primary" onClick={createSession}>
                Сохранить
              </button>
            </div>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal onClose={() => setEditing(false)}>
          <h2>Редактировать кампанию</h2>
          <div className="stack">
            <label>
              Название
              <input
                value={editForm.name}
                onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
              />
            </label>
            <label>
              Тип
              <select
                value={editForm.type}
                onChange={(e) => setEditForm({ ...editForm, type: e.target.value as CampaignType })}
              >
                {CAMPAIGN_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Система
              <select
                value={editForm.system_id}
                onChange={(e) => setEditForm({ ...editForm, system_id: e.target.value })}
              >
                <option value="">—</option>
                {systems.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Сеттинг
              <select
                value={editForm.setting_id}
                onChange={(e) => setEditForm({ ...editForm, setting_id: e.target.value })}
              >
                <option value="">—</option>
                {settingsList.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Статус
              <select
                value={editForm.status}
                onChange={(e) => setEditForm({ ...editForm, status: e.target.value })}
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="completed">completed</option>
              </select>
            </label>
            <label>
              Оплата
              <select
                value={editForm.payment_type}
                onChange={(e) =>
                  setEditForm({ ...editForm, payment_type: e.target.value as PaymentType })
                }
              >
                {PAYMENT_TYPE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            {editForm.payment_type === "paid" && (
              <>
                <label>
                  Периодичность
                  <select
                    value={editForm.payment_frequency}
                    onChange={(e) =>
                      setEditForm({ ...editForm, payment_frequency: e.target.value as PaymentFrequency })
                    }
                  >
                    {PAYMENT_FREQUENCY_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Тип ставки
                  <select
                    value={editForm.rate_split}
                    onChange={(e) => setEditForm({ ...editForm, rate_split: e.target.value as RateSplit })}
                  >
                    {RATE_SPLIT_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Ставка{" "}
                  {editForm.payment_frequency === "per_month" ? "в месяц" : "за сессию"}
                  {editForm.rate_split === "per_person" ? " (с человека)" : " (со стола)"}
                  <input
                    type="number"
                    value={editForm.session_rate}
                    onChange={(e) => setEditForm({ ...editForm, session_rate: e.target.value })}
                  />
                </label>
              </>
            )}
            <label>
              Валюта
              <input
                value={editForm.currency}
                onChange={(e) => setEditForm({ ...editForm, currency: e.target.value })}
              />
            </label>
            <label>
              Фоновая картинка
              <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => bgCrop.onSelect(e.target.files?.[0] ?? null)} />
              <span className="muted image-hint">{IMAGE_HINT}</span>
            </label>
            {bgCrop.modal}
            <label>
              Тамбнейл (для списка кампаний)
              <input type="file" accept={IMAGE_ACCEPT} onChange={(e) => thumbCrop.onSelect(e.target.files?.[0] ?? null)} />
              <span className="muted image-hint">{IMAGE_HINT}</span>
            </label>
            {thumbCrop.modal}
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setEditing(false)}>Отмена</button>
              <button className="primary" onClick={saveCampaignEdit}>
                Сохранить
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
  const [charNameDraft, setCharNameDraft] = useState("");
  const thumbnailStyles = loadThumbnailStyles();

  function refresh() {
    api.get<Character[]>(`/characters?campaign_id=${campaignId}`).then(setCharacters);
  }
  useEffect(refresh, [campaignId]);

  async function addToRoster(playerId: string) {
    if (!playerId) return;
    await api.post(`/campaigns/${campaignId}/roster/${playerId}`);
    onRosterChange();
  }
  async function removeFromRoster(playerId: number) {
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
    if (!charNameDraft.trim()) return;
    await api.post("/characters", {
      player_id: playerId,
      campaign_id: campaignId,
      character_name: charNameDraft,
    });
    setCharNameDraft("");
    setAddingFor(null);
    refresh();
  }

  return (
    <div className="stack">
      <div className="row">
        <select defaultValue="" onChange={(e) => addToRoster(e.target.value)}>
          <option value="">Добавить игрока в состав…</option>
          {allPlayers
            .filter((p) => !roster.some((r) => r.id === p.id))
            .map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
        </select>
      </div>
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
              charNameDraft={charNameDraft}
              onCharNameDraftChange={setCharNameDraft}
              onStartAddCharacter={() => setAddingFor(p.id)}
              onCancelAddCharacter={() => setAddingFor(null)}
              onAddCharacter={() => addCharacter(p.id)}
              onToggleLeft={() => toggleLeft(p.id, p.roster_status)}
              onRemove={() => removeFromRoster(p.id)}
              onThumbnailChanged={onRosterChange}
            >
              {playerCharacters.map((c) => (
                <Link key={c.id} to={`/characters/${c.id}`} className="badge planned">
                  {c.character_name}
                </Link>
              ))}
            </RosterCard>
          );
        })}
        {roster.length === 0 && <p className="muted">Состав кампании пуст.</p>}
      </div>
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

  return (
    <div className={`card stack roster-card ${thumb.className}`} style={thumb.style}>
      <label className="roster-card-thumb-btn" title="Изменить тамбнейл">
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
          <img src={thumb.bannerUrl} alt="" className="campaign-thumb" />
        ) : (
          <div className="campaign-card-band zine-grain zine-torn-bottom-b" />
        )
      )}
      <div className="row" style={{ flexWrap: "wrap" }}>
        <Link to={`/players/${player.id}`} className="roster-card-name">
          {player.name}
        </Link>
        {player.roster_status === "left" && <span className="badge cancelled">Покинул(а) кампанию</span>}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        {children}
        {addingCharacter ? (
          <>
            <input
              autoFocus
              placeholder="Имя персонажа"
              value={charNameDraft}
              onChange={(e) => onCharNameDraftChange(e.target.value)}
              style={{ maxWidth: 140 }}
            />
            <button className="primary" onClick={onAddCharacter}>
              ОК
            </button>
            <button onClick={onCancelAddCharacter}>✕</button>
          </>
        ) : (
          <button className="btn-capsule" onClick={onStartAddCharacter}>
            + Персонаж
          </button>
        )}
      </div>
      <div className="row roster-card-actions" style={{ flexWrap: "wrap" }}>
        <button onClick={onToggleLeft}>
          {player.roster_status === "left" ? "Вернуть в состав" : "Покинул(а) кампанию"}
        </button>
        <button onClick={onRemove}>Убрать из состава</button>
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
// (a live dashboard for an ongoing campaign) + Пост-продакшен (retrospective
// once it's done) — three phases of the same campaign's life, so the section
// that's actually relevant right now opens by default while the other two
// stay collapsed rather than competing for space.
function OverviewTab({
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
  const hasSessions = sessions.length > 0;
  const isCompleted = campaign.status === "completed";

  return (
    <div className="stack">
      <details className="card" open={!hasSessions}>
        <summary>
          <strong className="entry-title">Препродакшен</strong>
        </summary>
        <PreproductionTab campaign={campaign} systems={systems} settingsList={settingsList} />
      </details>

      <details className="card" open={hasSessions && !isCompleted}>
        <summary>
          <strong className="entry-title">Продакшен</strong>
        </summary>
        <ProductionDashboard campaign={campaign} sessions={sessions} />
      </details>

      <details className="card" open={isCompleted}>
        <summary>
          <strong className="entry-title">Пост-продакшен</strong>
        </summary>
        <div className="stack">
          <p className="muted">
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
      .get<CampaignEntry[]>(`/campaign-entries?campaign_id=${campaign.id}&category=secrets`)
      .then((rows) => setSecretsCount(rows.filter((r) => r.status !== "done").length));
  }, [campaign.id]);

  const today = new Date().toISOString().slice(0, 10);
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
        <strong>Ближайшая сессия</strong>
        {nextSession ? (
          <Link to={`/sessions/${nextSession.id}`}>
            {nextSession.date} — {nextSession.title || `Сессия №${nextSession.session_number ?? ""}`}
          </Link>
        ) : (
          <span className="muted">Сессий не запланировано.</span>
        )}
      </div>
      <div className="card stack">
        <strong>Недавние события</strong>
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
          <span className="muted">Пока нет записанных событий.</span>
        )}
      </div>
      <div className="card row" style={{ justifyContent: "space-between" }}>
        <span>Нераскрытых тайн: {secretsCount ?? "…"}</span>
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
                  <strong>{f.label}</strong>
                  <div style={{ whiteSpace: "pre-wrap" }}>
                    <MentionText text={pre[f.key] as string} />
                  </div>
                </div>
              )
          )}
          {pre.adventure_stakes_hooks && (
            <div className="card stack">
              <strong>Adventure Stakes and Hooks</strong>
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
              <strong>{f.label}</strong>
              {f.help && <span className="muted">{f.help}</span>}
              <MentionTextarea
                value={pre[f.key] as string}
                onChange={(v) => setPre({ ...pre, [f.key]: v })}
                rows={3}
              />
            </div>
          ))}
          <div className="card stack">
            <strong>Adventure Stakes and Hooks</strong>
            <span className="muted">
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
