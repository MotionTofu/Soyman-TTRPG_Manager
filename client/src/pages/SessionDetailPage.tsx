import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { api } from "../api/client";
import { PAYMENT_TYPE_LABELS, PAYMENT_TYPE_OPTIONS } from "../paymentTypes";
import { ObstacleDropZone } from "../components/ObstacleDropZone";
import { EditableTextCard } from "../components/EditableTextCard";
import { NavIcon } from "../components/NavIcons";
import { SectionDropZone } from "../components/SectionDropZone";
import { ResourcesSection } from "../components/ResourcesSection";
import { CheatSheetsSection } from "../components/CheatSheetsSection";
import { LazyDetails } from "../components/LazyDetails";
import { MentionText } from "../components/mentions/MentionText";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useTabState } from "../hooks/useTabState";
import { formatInworldDate } from "../inworldCalendar";
import { loadHideFinance } from "../financePrivacy";
import type {
  Campaign,
  CampaignGrouped,
  PaymentType,
  Playlist,
  StorySecret,
  SessionDetail,
  SessionStatus,
  SessionSummary,
} from "../types";

// Module-level so SectionDropZone (React.memo'd) sees a stable reference —
// an inline array literal in the JSX below would be a new object every
// render, defeating the memo on every unrelated keystroke on this page.
const PLOT_CHARACTER_TYPES = ["being", "character"];
const LOCATION_TYPES = ["location"];
const LOOT_TYPES = ["resource", "artifact", "compendium_entry"];
const LOOT_COMPENDIUM_KINDS = ["equipment", "magic_item"];

const SESSION_TABS = ["Обзор", "Подготовка", "Хроника", "Ресурсы"] as const;
type SessionTab = (typeof SESSION_TABS)[number];

export function SessionDetailPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const navigate = useNavigate();
  const [tab, selectTab] = useTabState<SessionTab>(SESSION_TABS, "Обзор");

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [showReschedule, setShowReschedule] = useState(false);
  const [toDate, setToDate] = useState("");
  const [stakeDraft, setStakeDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [campaignSessions, setCampaignSessions] = useState<SessionSummary[]>([]);
  const [battles, setBattles] = useState<Playlist[]>([]);
  const [unrevealedSecrets, setUnrevealedSecrets] = useState<StorySecret[]>([]);
  const [inworldYearDraft, setInworldYearDraft] = useState("");
  const [inworldMonthDraft, setInworldMonthDraft] = useState("");
  const [inworldDayDraft, setInworldDayDraft] = useState("");
  const [inworldYearEndDraft, setInworldYearEndDraft] = useState("");
  const [inworldMonthEndDraft, setInworldMonthEndDraft] = useState("");
  const [inworldDayEndDraft, setInworldDayEndDraft] = useState("");
  const [showEndDate, setShowEndDate] = useState(false);
  const [editingInworldDate, setEditingInworldDate] = useState(false);
  const calendar = useSettingCalendar(campaign?.setting_id);

  const refresh = useCallback(() => {
    api.get<SessionDetail>(`/sessions/${sessionId}`).then((s) => {
      setSession(s);
      setStakeDraft(s.stake_override != null ? String(s.stake_override) : "");
      setStartTimeDraft(s.start_time || "");
      setTitleDraft(s.title || "");
      setInworldYearDraft(s.inworld_year != null ? String(s.inworld_year) : "");
      setInworldMonthDraft(s.inworld_month != null ? String(s.inworld_month) : "");
      setInworldDayDraft(s.inworld_day != null ? String(s.inworld_day) : "");
      setInworldYearEndDraft(s.inworld_year_end != null ? String(s.inworld_year_end) : "");
      setInworldMonthEndDraft(s.inworld_month_end != null ? String(s.inworld_month_end) : "");
      setInworldDayEndDraft(s.inworld_day_end != null ? String(s.inworld_day_end) : "");
      if (s.inworld_year_end != null) setShowEndDate(true);
      api.get<Campaign>(`/campaigns/${s.campaign_id}`).then(setCampaign);
      api
        .get<SessionSummary[]>(`/campaigns/${s.campaign_id}/sessions`)
        .then(setCampaignSessions);
      // Тайны кампании и тайны её приключений — один список: с тех пор как
      // это одна модель, за игровым столом разделять их незачем.
      api
        .get<CampaignGrouped<StorySecret>>(`/story/campaign-secrets?campaign_id=${s.campaign_id}`)
        .then((data) =>
          setUnrevealedSecrets(
            [...data.own, ...data.groups.flatMap((g) => g.items)].filter(
              (x) => x.state?.revealed !== 1
            )
          )
        );
    });
  }, [sessionId]);

  useEffect(refresh, [refresh]);

  useEffect(() => {
    api.get<Playlist[]>("/playlists").then(setBattles).catch(() => setBattles([]));
  }, []);

  async function markSecretRevealed(secretId: number) {
    if (!session) return;
    await api.put(`/story/secrets/${secretId}/state`, {
      campaign_id: session.campaign_id,
      revealed: true,
    });
    setUnrevealedSecrets((prev) => prev.filter((s) => s.id !== secretId));
  }

  // useMemo (not a plain filter) so ResourcesSection's React.memo sees a
  // stable array reference across renders that don't actually touch
  // session.resources — otherwise a new array every render defeats the memo.
  // Must run before the early return below (Rules of Hooks), hence the
  // null-guard here instead of relying on the guard to have already fired.
  const linkResources = useMemo(
    () => session?.resources.filter((r) => r.type === "link") ?? [],
    [session]
  );

  // Recommendation #4: the summary badge should reflect what's currently
  // typed in the date fields, not just what's already saved — so it updates
  // live as the GM fills the date in, before hitting "Сохранить дату".
  const draftYear = inworldYearDraft ? Number(inworldYearDraft) : null;
  const draftMonth = inworldMonthDraft ? Number(inworldMonthDraft) : null;
  const draftDay = inworldDayDraft ? Number(inworldDayDraft) : null;
  const draftYearEnd = inworldYearEndDraft ? Number(inworldYearEndDraft) : null;
  const draftMonthEnd = inworldMonthEndDraft ? Number(inworldMonthEndDraft) : null;
  const draftDayEnd = inworldDayEndDraft ? Number(inworldDayEndDraft) : null;
  const inworldBadge = calendar
    ? formatInworldDate(draftYear, draftMonth, draftDay, calendar.months, calendar.era)
    : null;
  const inworldBadgeEnd =
    calendar && showEndDate
      ? formatInworldDate(draftYearEnd, draftMonthEnd, draftDayEnd, calendar.months, calendar.era)
      : null;

  if (!session || !campaign) return <p className="muted">Загрузка…</p>;

  async function setStatus(status: SessionStatus) {
    await api.put(`/sessions/${sessionId}`, { status });
    refresh();
  }

  async function setBattlePlaylist(id: number | null) {
    await api.put(`/sessions/${sessionId}`, { battle_playlist_id: id });
    refresh();
  }

  async function saveIdea(value: string) {
    await api.put(`/sessions/${sessionId}`, { idea_notes: value });
    refresh();
  }

  async function saveMainEvents(value: string) {
    await api.put(`/sessions/${sessionId}`, { main_events: value });
    refresh();
  }

  async function toggleMainEventsVisible() {
    await api.put(`/sessions/${sessionId}`, { main_events_visible: !session!.main_events_visible });
    refresh();
  }

  async function saveTitle() {
    await api.put(`/sessions/${sessionId}`, { title: titleDraft || null });
    setEditingTitle(false);
    refresh();
  }

  async function setPaymentOverride(value: "" | PaymentType) {
    await api.put(`/sessions/${sessionId}`, { payment_override: value || null });
    refresh();
  }

  async function saveStake() {
    await api.put(`/sessions/${sessionId}`, {
      stake_override: stakeDraft ? Number(stakeDraft) : null,
    });
    refresh();
  }

  async function saveStartTime() {
    await api.put(`/sessions/${sessionId}`, { start_time: startTimeDraft || null });
    refresh();
  }

  async function saveInworldDate() {
    await api.put(`/sessions/${sessionId}`, {
      inworld_year: inworldYearDraft ? Number(inworldYearDraft) : null,
      inworld_month: inworldMonthDraft ? Number(inworldMonthDraft) : null,
      inworld_day: inworldDayDraft ? Number(inworldDayDraft) : null,
      inworld_year_end: showEndDate && inworldYearEndDraft ? Number(inworldYearEndDraft) : null,
      inworld_month_end: showEndDate && inworldMonthEndDraft ? Number(inworldMonthEndDraft) : null,
      inworld_day_end: showEndDate && inworldDayEndDraft ? Number(inworldDayEndDraft) : null,
    });
    setEditingInworldDate(false);
    refresh();
  }

  async function archiveSession() {
    if (!session) return;
    if (!confirm("Отправить сессию в архив?")) return;
    await api.del(`/sessions/${sessionId}`);
    navigate(`/campaigns/${session.campaign_id}`);
  }

  async function updateAttendance(
    playerId: number,
    field: "attended" | "amount_paid",
    value: number
  ) {
    if (!session) return;
    const next = session.attendance.map((a) =>
      a.player_id === playerId ? { ...a, [field]: value } : a
    );
    setSession({ ...session, attendance: next });
    await api.put(`/sessions/${sessionId}/attendance`, {
      attendance: next.map((a) => ({
        player_id: a.player_id,
        attended: !!a.attended,
        amount_paid: a.amount_paid,
      })),
    });
    refresh();
  }

  // Header checkbox column acts as a select-all/none toggle: if everyone is
  // already checked, clicking it clears everyone; otherwise it checks
  // everyone (mirrors a typical table "select all" header).
  async function toggleAllAttendance() {
    if (!session) return;
    const allAttended = session.attendance.every((a) => !!a.attended);
    const nextValue = allAttended ? 0 : 1;
    const next = session.attendance.map((a) => ({ ...a, attended: nextValue }));
    setSession({ ...session, attendance: next });
    await api.put(`/sessions/${sessionId}/attendance`, {
      attendance: next.map((a) => ({
        player_id: a.player_id,
        attended: !!a.attended,
        amount_paid: a.amount_paid,
      })),
    });
    refresh();
  }

  // Honors the campaign's payment_frequency × rate_split terms: "per_table"
  // splits the configured rate across attendees, "per_month" divides it
  // across however many sessions this campaign already has in that same
  // calendar month. A manual stake_override always wins outright.
  function defaultStake(): number {
    if (session!.stake_override != null) return session!.stake_override;
    let amount = campaign!.session_rate ?? 0;
    if (campaign!.rate_split === "per_table") {
      const attended = session!.attendance.filter((a) => a.attended).length;
      const attendeeCount = attended > 0 ? attended : session!.attendance.length || 1;
      amount = amount / attendeeCount;
    }
    if (campaign!.payment_frequency === "per_month") {
      const monthPrefix = session!.date.slice(0, 7);
      const sessionsThisMonth =
        campaignSessions.filter((s) => s.date.slice(0, 7) === monthPrefix).length || 1;
      amount = amount / sessionsThisMonth;
    }
    return Math.round(amount * 100) / 100;
  }

  // Mirrors toggleAllAttendance: pays everyone the currently-computed
  // default stake in one call, instead of clicking each row's own button.
  async function payAllDefault() {
    if (!session) return;
    const amount = defaultStake();
    const next = session.attendance.map((a) => ({ ...a, amount_paid: amount }));
    setSession({ ...session, attendance: next });
    await api.put(`/sessions/${sessionId}/attendance`, {
      attendance: next.map((a) => ({
        player_id: a.player_id,
        attended: !!a.attended,
        amount_paid: a.amount_paid,
      })),
    });
    refresh();
  }

  async function doReschedule() {
    if (!toDate) return;
    const result = await api.post<{ newSession: { id: number } }>(
      `/sessions/${sessionId}/reschedule`,
      { to_date: toDate }
    );
    navigate(`/sessions/${result.newSession.id}`);
  }

  const sortedSessions = [...campaignSessions].sort((a, b) => (a.date < b.date ? -1 : 1));
  const currentIndex = sortedSessions.findIndex((s) => s.id === sessionId);
  const prevSession = currentIndex > 0 ? sortedSessions[currentIndex - 1] : null;
  const nextSession =
    currentIndex >= 0 && currentIndex < sortedSessions.length - 1
      ? sortedSessions[currentIndex + 1]
      : null;

  const isPaidEffective = session.effective_payment_type === "paid";
  const isPlayer = campaign.role === "player";
  const hideFinance = loadHideFinance();

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <button disabled={!prevSession} onClick={() => prevSession && navigate(`/sessions/${prevSession.id}`)}>
          ← Пред. сессия
        </button>
        <button disabled={!nextSession} onClick={() => nextSession && navigate(`/sessions/${nextSession.id}`)}>
          След. сессия →
        </button>
      </div>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <div>
          {editingTitle ? (
            <div className="row">
              <input
                placeholder={`Сессия №${session.session_number ?? ""}`}
                value={titleDraft}
                onChange={(e) => setTitleDraft(e.target.value)}
              />
              <button className="primary" onClick={saveTitle}>
                Сохранить
              </button>
              <button onClick={() => setEditingTitle(false)}>Отмена</button>
            </div>
          ) : (
            <h1 onDoubleClick={() => setEditingTitle(true)}>
              <Link to={`/campaigns/${campaign.id}`}>{campaign.name}</Link> —{" "}
              {session.title || `Сессия №${session.session_number ?? ""}`}
            </h1>
          )}
          <span className={`badge ${session.status}`}>{session.status}</span>
        </div>
        <div className="row">
          {!isPlayer && !hideFinance && (
            <div className="badge held">
              {session.earned} {campaign.currency}
            </div>
          )}
          <div className="entity-header-actions">
            {!isPlayer && (
              <button onClick={() => navigate(`/sessions/${sessionId}/live`)}>
                <NavIcon name="die" /> Пульт сессии
              </button>
            )}
            <button onClick={() => setEditingTitle(true)}>Название</button>
            <button className="danger" onClick={archiveSession}>
              Архивировать
            </button>
          </div>
        </div>
      </div>

      <div className="tabs">
        {SESSION_TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === "Обзор" && (
        <div className="stack">
          {!isPlayer && (
            <div className="row">
              <label>
                Статус
                <select
                  value={session.status}
                  onChange={(e) => setStatus(e.target.value as SessionStatus)}
                >
                  <option value="planned">Запланировано</option>
                  <option value="held">Состоялась</option>
                  <option value="cancelled">Отмена</option>
                </select>
              </label>
              {!hideFinance && (
                <label>
                  Оплата
                  <select
                    value={session.payment_override ?? ""}
                    onChange={(e) => setPaymentOverride(e.target.value as "" | PaymentType)}
                  >
                    <option value="">
                      Как в кампании ({PAYMENT_TYPE_LABELS[campaignPaymentLabel(session, campaign)]})
                    </option>
                    {PAYMENT_TYPE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {!hideFinance && isPaidEffective && (
                <label className="row">
                  Ставка
                  <input
                    style={{ width: 90 }}
                    value={stakeDraft}
                    placeholder={String(campaign.session_rate)}
                    onChange={(e) => setStakeDraft(e.target.value)}
                    onBlur={saveStake}
                  />
                </label>
              )}
              <button onClick={() => setShowReschedule((v) => !v)}>Перенести</button>
              {session.rescheduled_to_id && (
                <Link to={`/sessions/${session.rescheduled_to_id}`}>→ перенесена на новую дату</Link>
              )}
              {session.rescheduled_from_id && (
                <Link to={`/sessions/${session.rescheduled_from_id}`}>← перенесена с другой даты</Link>
              )}
            </div>
          )}

          {showReschedule && (
            <div className="row">
              <input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              <button className="primary" onClick={doReschedule}>
                Подтвердить перенос
              </button>
            </div>
          )}

          <div className="card stack">
            <strong className="entry-title">Время и дата</strong>
            <div className="row">
              <label className="row">
                Время начала
                <input
                  type="time"
                  value={startTimeDraft}
                  onChange={(e) => setStartTimeDraft(e.target.value)}
                  onBlur={saveStartTime}
                />
              </label>
              <span className="muted">{session.date}</span>
            </div>

            {campaign.setting_id && calendar && (
              <div className="stack">
                {!editingInworldDate ? (
                  <span
                    className="badge planned"
                    style={{ cursor: "pointer", alignSelf: "flex-start" }}
                    onClick={() => setEditingInworldDate(true)}
                  >
                    {inworldBadge ? (
                      <>
                        {inworldBadge}
                        {showEndDate && inworldBadgeEnd && <> – {inworldBadgeEnd}</>}
                      </>
                    ) : (
                      "Указать внутриигровую дату"
                    )}
                  </span>
                ) : (
                  <div className="stack">
                    <div className="row">
                      <label className="row">
                        Игровая дата: год
                        <input
                          type="number"
                          style={{ width: 90 }}
                          value={inworldYearDraft}
                          onChange={(e) => setInworldYearDraft(e.target.value)}
                        />
                      </label>
                      <label className="row">
                        месяц
                        <select
                          value={inworldMonthDraft}
                          onChange={(e) => setInworldMonthDraft(e.target.value)}
                          disabled={calendar.months.length === 0}
                        >
                          <option value="">—</option>
                          {calendar.months.map((m) => (
                            <option key={m.id} value={m.position}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="row">
                        день
                        <input
                          type="number"
                          style={{ width: 70 }}
                          value={inworldDayDraft}
                          onChange={(e) => setInworldDayDraft(e.target.value)}
                        />
                      </label>
                      <label className="row">
                        <input
                          type="checkbox"
                          checked={showEndDate}
                          onChange={(e) => setShowEndDate(e.target.checked)}
                        />
                        указать дату окончания
                      </label>
                      <button onClick={saveInworldDate}>Сохранить дату</button>
                    </div>
                    {showEndDate && (
                      <div className="row">
                        <label className="row">
                          Конец: год
                          <input
                            type="number"
                            style={{ width: 90 }}
                            value={inworldYearEndDraft}
                            onChange={(e) => setInworldYearEndDraft(e.target.value)}
                          />
                        </label>
                        <label className="row">
                          месяц
                          <select
                            value={inworldMonthEndDraft}
                            onChange={(e) => setInworldMonthEndDraft(e.target.value)}
                            disabled={calendar.months.length === 0}
                          >
                            <option value="">—</option>
                            {calendar.months.map((m) => (
                              <option key={m.id} value={m.position}>
                                {m.name}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="row">
                          день
                          <input
                            type="number"
                            style={{ width: 70 }}
                            value={inworldDayEndDraft}
                            onChange={(e) => setInworldDayEndDraft(e.target.value)}
                          />
                        </label>
                      </div>
                    )}
                    {calendar.months.length === 0 && (
                      <span className="muted">
                        Настройте месяцы в{" "}
                        <Link to={`/settings/${campaign.setting_id}`}>календаре сеттинга</Link>,
                        чтобы выбирать месяц из списка.
                      </span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>

          <details className="card stack" open>
            <summary>
              <strong className="entry-title">Игроки</strong>
            </summary>
            <div className="session-attendance-table-wrap">
            <table className="session-attendance-table">
              <thead>
                <tr>
                  <th>Игрок</th>
                  <th
                    style={{ cursor: "pointer" }}
                    title="Отметить/снять всех"
                    onClick={toggleAllAttendance}
                  >
                    Пришёл
                  </th>
                  {!isPlayer && !hideFinance && (
                    <th
                      style={isPaidEffective ? { cursor: "pointer" } : undefined}
                      title={isPaidEffective ? "Оплатить всем по умолчанию" : undefined}
                      onClick={isPaidEffective ? payAllDefault : undefined}
                    >
                      Оплачено
                    </th>
                  )}
                  {!isPlayer && !hideFinance && isPaidEffective && <th></th>}
                </tr>
              </thead>
              <tbody>
                {session.attendance.map((a) => (
                  <tr key={a.player_id}>
                    <td data-label="Игрок">{a.name}</td>
                    <td data-label="Пришёл">
                      <input
                        type="checkbox"
                        checked={!!a.attended}
                        onChange={(e) =>
                          updateAttendance(a.player_id, "attended", e.target.checked ? 1 : 0)
                        }
                      />
                    </td>
                    {!isPlayer && !hideFinance && (
                      <td data-label="Оплачено">
                        <input
                          type="number"
                          style={{ width: 90 }}
                          value={a.amount_paid || ""}
                          placeholder="0"
                          disabled={session.effective_payment_type === "free"}
                          onChange={(e) =>
                            updateAttendance(a.player_id, "amount_paid", Number(e.target.value) || 0)
                          }
                        />
                      </td>
                    )}
                    {!isPlayer && !hideFinance && isPaidEffective && (
                      <td>
                        <button onClick={() => updateAttendance(a.player_id, "amount_paid", defaultStake())}>
                          Ставка ({defaultStake()})
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
                {session.attendance.length === 0 && (
                  <tr>
                    <td colSpan={isPlayer || hideFinance ? 2 : 4} className="muted">
                      В составе кампании нет игроков.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
            </div>
          </details>
        </div>
      )}

      {tab === "Подготовка" && (
        <div className="stack">
          <EditableTextCard
            key={`idea-${session.id}`}
            title="Задумка на сессию"
            value={session.idea_notes}
            onSave={saveIdea}
            entityType="session"
            entityId={sessionId}
            collapsible
          >
            {/* Боевая тема задаётся здесь же, рядом с задумкой: её выбирают
                на подготовке к конкретному вечеру, и она главнее темы
                набора — набор заготовлен на всю кампанию. */}
            <label className="row" style={{ gap: 6, alignItems: "center" }}>
              Боевая тема:
              <select
                value={session.battle_playlist_id ?? ""}
                onChange={(e) => setBattlePlaylist(e.target.value ? Number(e.target.value) : null)}
              >
                <option value="">— из набора —</option>
                {battles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </label>
          </EditableTextCard>

          <div className="row" style={{ alignItems: "flex-start" }}>
            <LazyDetails
              title="Сюжетные персонажи"
              className="card stack"
              style={{ flex: 1, minWidth: 260 }}
              defaultOpen
            >
              <SectionDropZone
                entityType="session"
                entityId={sessionId}
                section="plot_characters"
                acceptTypes={PLOT_CHARACTER_TYPES}
                placeholder="Перетащите сюда существо или персонажа из поиска"
                mentionText={session.idea_notes}
                mentionTypes={PLOT_CHARACTER_TYPES}
              />
            </LazyDetails>

            <LazyDetails
              title="Локации"
              className="card stack"
              style={{ flex: 1, minWidth: 260 }}
              defaultOpen
            >
              <SectionDropZone
                entityType="session"
                entityId={sessionId}
                section="locations"
                acceptTypes={LOCATION_TYPES}
                placeholder="Перетащите сюда локацию из поиска"
                mentionText={session.idea_notes}
                mentionTypes={LOCATION_TYPES}
              />
            </LazyDetails>
          </div>

          {!isPlayer && (
            <div className="row" style={{ alignItems: "flex-start" }}>
              <LazyDetails title="Препятствия" className="card stack" style={{ flex: 1, minWidth: 260 }}>
                <ObstacleDropZone sessionId={sessionId} />
              </LazyDetails>

              <LazyDetails
                title="Потенциальный лут"
                className="card stack"
                style={{ flex: 1, minWidth: 260 }}
              >
                <SectionDropZone
                  entityType="session"
                  entityId={sessionId}
                  section="loot"
                  acceptTypes={LOOT_TYPES}
                  acceptCompendiumKinds={LOOT_COMPENDIUM_KINDS}
                  placeholder="Перетащите сюда ресурс, артефакт или предмет из компендиума"
                />
              </LazyDetails>
            </div>
          )}

          {!isPlayer && (
            <LazyDetails title="Шпаргалки" className="card stack">
              <CheatSheetsSection
                sessionId={sessionId}
                campaignId={session.campaign_id}
                ideaNotes={session.idea_notes}
                cheatsheetData={session.cheatsheet_data}
                unrevealedSecrets={unrevealedSecrets}
              />
            </LazyDetails>
          )}
        </div>
      )}

      {tab === "Хроника" && (
        <div className="stack">
          <EditableTextCard
            key={`events-${session.id}`}
            title="Основные события сессии"
            value={session.main_events}
            onSave={saveMainEvents}
            entityType="session"
            entityId={sessionId}
            collapsible
          >
            <label className="row muted" style={{ gap: 6, alignItems: "center" }}>
              <input
                type="checkbox"
                checked={!!session.main_events_visible}
                onChange={toggleMainEventsVisible}
              />
              {session.main_events_visible ? (
                <>
                  <NavIcon name="eye" /> Видно игрокам
                </>
              ) : (
                "Видно игрокам"
              )}
            </label>
          </EditableTextCard>

          {unrevealedSecrets.length > 0 && (
            <details className="card stack" open>
              <summary>
                <strong className="entry-title">Нераскрытые тайны и зацепки</strong>
              </summary>
              <span className="muted">Перенесены из предыдущих сессий кампании — отметьте, если раскрыли.</span>
              <div className="stack">
                {unrevealedSecrets.map((s) => (
                  <label key={s.id} className="row" style={{ alignItems: "flex-start" }}>
                    <input type="checkbox" onChange={() => markSecretRevealed(s.id)} />
                    <span>
                      <strong>{s.title}</strong>
                      {s.content && (
                        <div className="muted" style={{ whiteSpace: "pre-wrap", margin: 0 }}>
                          <MentionText text={s.content} />
                        </div>
                      )}
                    </span>
                  </label>
                ))}
              </div>
            </details>
          )}
        </div>
      )}

      {tab === "Ресурсы" && (
        <ResourcesSection
          scope="session"
          entityId={sessionId}
          resources={linkResources}
          onChange={refresh}
          settingId={campaign?.setting_id ?? null}
        />
      )}
    </div>
  );
}

function campaignPaymentLabel(session: SessionDetail, campaign: Campaign): PaymentType {
  return session.campaign_payment_type ?? campaign.payment_type;
}
