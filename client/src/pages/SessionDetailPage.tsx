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
import { Modal } from "../components/Modal";
import { SessionSceneTree } from "../components/SessionSceneTree";
import { LazyDetails } from "../components/LazyDetails";
import { MentionText } from "../components/mentions/MentionText";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { useTabState } from "../hooks/useTabState";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { elapsedDays, formatInworldDate, formatInworldRange } from "../inworldCalendar";
import { loadHideFinance } from "../financePrivacy";
import type {
  Campaign,
  CampaignGrouped,
  PaymentType,
  Playlist,
  StorySecret,
  SessionDetail,
  SessionReport,
  SessionStatus,
  SessionSummary,
} from "../types";
import "../session.css";
import { sessionLabel } from "../sessionLabel";
import { SessionOutcomeModal } from "../components/SessionOutcomeModal";

// Module-level so SectionDropZone (React.memo'd) sees a stable reference —
// an inline array literal in the JSX below would be a new object every
// render, defeating the memo on every unrelated keystroke on this page.
const PLOT_CHARACTER_TYPES = ["being", "character"];
const LOCATION_TYPES = ["location"];
const LOOT_TYPES = ["resource", "artifact", "compendium_entry"];
const LOOT_COMPENDIUM_KINDS = ["equipment", "magic_item"];

// «Хроника» переименована в «Резюме»: в ней теперь не летопись, а итог
// вечера — сколько прошло дней в мире, что раскрылось, кто пришёл и заплатил.
const SESSION_TABS = ["Обзор", "Подготовка", "Резюме", "Ресурсы"] as const;
type SessionTab = (typeof SESSION_TABS)[number];

const STATUS_LABELS: Record<string, string> = {
  planned: "Запланирована",
  held: "Состоялась",
  cancelled: "Отменена",
};

function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

export function SessionDetailPage() {
  const { id } = useParams();
  const sessionId = Number(id);
  const navigate = useNavigate();
  const [tab, selectTab] = useTabState<SessionTab>(SESSION_TABS, "Обзор");
  const [outcomeOpen, setOutcomeOpen] = useState(false);

  const [session, setSession] = useState<SessionDetail | null>(null);
  const [campaign, setCampaign] = useState<Campaign | null>(null);
  const [dateDraft, setDateDraft] = useState("");
  const [stakeDraft, setStakeDraft] = useState("");
  const [startTimeDraft, setStartTimeDraft] = useState("");
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [campaignSessions, setCampaignSessions] = useState<SessionSummary[]>([]);
  const [battles, setBattles] = useState<Playlist[]>([]);
  const [secretData, setSecretData] = useState<CampaignGrouped<StorySecret>>({
    groups: [],
    own: [],
  });
  const [report, setReport] = useState<SessionReport | null>(null);
  const [inworldYearDraft, setInworldYearDraft] = useState("");
  const [inworldMonthDraft, setInworldMonthDraft] = useState("");
  const [inworldDayDraft, setInworldDayDraft] = useState("");
  const [inworldYearEndDraft, setInworldYearEndDraft] = useState("");
  const [inworldMonthEndDraft, setInworldMonthEndDraft] = useState("");
  const [inworldDayEndDraft, setInworldDayEndDraft] = useState("");
  const [showEndDate, setShowEndDate] = useState(false);
  const [editingInworldDate, setEditingInworldDate] = useState(false);
  // Свёрнуто по умолчанию: нераскрытых тайн к середине кампании набирается
  // несколько десятков, и развёрнутый список закрывал собой весь «Обзор».
  // Открывают одно приключение — то, по которому сегодня играют.
  const [openSecretGroups, setOpenSecretGroups] = useState<string[]>([]);
  const calendar = useSettingCalendar(campaign?.setting_id);
  const { toast: undoToast, deleteWithUndo } = useUndoDelete();

  const refresh = useCallback(() => {
    let cancelled = false;
    api.get<SessionDetail>(`/sessions/${sessionId}`).then((s) => {
      if (cancelled) return;
      setSession(s);
      setStakeDraft(s.stake_override != null ? String(s.stake_override) : "");
      setDateDraft(s.date);
      setStartTimeDraft(s.start_time || "");
      setTitleDraft(s.title || "");
      setInworldYearDraft(s.inworld_year != null ? String(s.inworld_year) : "");
      setInworldMonthDraft(s.inworld_month != null ? String(s.inworld_month) : "");
      setInworldDayDraft(s.inworld_day != null ? String(s.inworld_day) : "");
      setInworldYearEndDraft(s.inworld_year_end != null ? String(s.inworld_year_end) : "");
      setInworldMonthEndDraft(s.inworld_month_end != null ? String(s.inworld_month_end) : "");
      setInworldDayEndDraft(s.inworld_day_end != null ? String(s.inworld_day_end) : "");
      if (s.inworld_year_end != null) setShowEndDate(true);
      api.get<Campaign>(`/campaigns/${s.campaign_id}`).then((c) => { if (!cancelled) setCampaign(c); }).catch(() => {});
      api
        .get<SessionSummary[]>(`/campaigns/${s.campaign_id}/sessions`)
        .then((v) => { if (!cancelled) setCampaignSessions(v); }).catch(() => {});
      // Ответ хранится как есть, разложенным по приключениям: за столом
      // нераскрытая тайна почти всегда вспоминается вместе с приключением, из
      // которого тянется, и плоский список на семь десятков строк не давал
      // понять, где какая ветка.
      api
        .get<CampaignGrouped<StorySecret>>(`/story/campaign-secrets?campaign_id=${s.campaign_id}`)
        .then((v) => { if (!cancelled) setSecretData(v); }).catch(() => {});
    }).catch(() => {});
    api.get<SessionReport>(`/sessions/${sessionId}/summary`).then((r) => { if (!cancelled) setReport(r); }).catch(() => { if (!cancelled) setReport(null); });
    return () => { cancelled = true; };
  }, [sessionId]);

  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh]);

  useEffect(() => {
    api.get<Playlist[]>("/playlists").then(setBattles).catch(() => setBattles([]));
  }, []);

  // Общее число тайн кампании — только для счётчиков «столько-то из
  // стольких-то»; сам список берётся из групп.
  const secretsTotal = useMemo(
    () => secretData.own.length + secretData.groups.reduce((n, g) => n + g.items.length, 0),
    [secretData]
  );

  // Нераскрытое, разложенное по приключениям. Пустые группы не показываются:
  // приключение, в котором всё раскрыто, на этом экране уже не долг.
  const unrevealedGroups = useMemo(() => {
    const open = (items: StorySecret[]) => items.filter((x) => x.state?.revealed !== 1);
    const out: { key: string; title: string; items: StorySecret[] }[] = [];
    const own = open(secretData.own);
    // Собственные тайны кампании идут первыми — тем же порядком, что в разделе
    // «Тайны и зацепки» профиля кампании.
    if (own.length > 0) out.push({ key: "own", title: "Тайны кампании", items: own });
    for (const g of secretData.groups) {
      const items = open(g.items);
      if (items.length > 0) out.push({ key: `arc-${g.arc.id}`, title: g.arc.name, items });
    }
    return out;
  }, [secretData]);

  // Плоский список того же самого — для шпаргалок, которым группировка ни к
  // чему, и для счётчика в шапке карточки.
  const unrevealedSecrets = useMemo(
    () => unrevealedGroups.flatMap((g) => g.items),
    [unrevealedGroups]
  );

  function toggleSecretGroup(key: string) {
    setOpenSecretGroups((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  const [pendingReveal, setPendingReveal] = useState<StorySecret | null>(null);
  const [justRevealed, setJustRevealed] = useState<StorySecret | null>(null);

  async function markSecretRevealed(secretId: number) {
    if (!session) return;
    const secret = [...secretData.own, ...secretData.groups.flatMap((g) => g.items)].find((x) => x.id === secretId) ?? null;
    // Сессия уезжает вместе с отметкой: «Раскрылось в этот вечер» в резюме
    // строится по ней, а не по дате правки.
    await api.put(`/story/secrets/${secretId}/state`, {
      campaign_id: session.campaign_id,
      revealed: true,
      session_id: sessionId,
    });
    // Правка на месте, без перечитывания раздела: списки, которых отметка не
    // касается, сохраняют ссылку, и React перерисовывает одну группу.
    const patch = (list: StorySecret[]) => {
      const i = list.findIndex((x) => x.id === secretId);
      if (i === -1) return list;
      const next = list.slice();
      next[i] = { ...list[i], state: { revealed: 1, note: list[i].state?.note ?? "" } };
      return next;
    };
    setSecretData((prev) => ({
      own: patch(prev.own),
      groups: prev.groups.map((g) => {
        const items = patch(g.items);
        return items === g.items ? g : { ...g, items };
      }),
    }));
    api.get<SessionReport>(`/sessions/${sessionId}/summary`).then((r) => setReport(r)).catch(() => {});
    if (secret) {
      setJustRevealed(secret);
      setTimeout(() => setJustRevealed((cur) => (cur?.id === secretId ? null : cur)), 5000);
    }
  }

  async function undoReveal(secretId: number) {
    if (!session) return;
    await api.put(`/story/secrets/${secretId}/state`, {
      campaign_id: session.campaign_id,
      revealed: false,
    });
    const patch = (list: StorySecret[]) => {
      const i = list.findIndex((x) => x.id === secretId);
      if (i === -1) return list;
      const next = list.slice();
      next[i] = { ...list[i], state: { revealed: 0, note: list[i].state?.note ?? "" } };
      return next;
    };
    setSecretData((prev) => ({
      own: patch(prev.own),
      groups: prev.groups.map((g) => {
        const items = patch(g.items);
        return items === g.items ? g : { ...g, items };
      }),
    }));
    setJustRevealed(null);
    api.get<SessionReport>(`/sessions/${sessionId}/summary`).then((r) => setReport(r)).catch(() => {});
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

  function parseDraftInt(v: string): number | null {
    if (!v.trim()) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
  }

  function validateInworldDraft(): string | null {
    const y = parseDraftInt(inworldYearDraft);
    const m = parseDraftInt(inworldMonthDraft);
    const d = parseDraftInt(inworldDayDraft);
    // Если указана часть даты — проверяем диапазоны
    if (m !== null && (m < 1 || (calendar && calendar.months.length > 0 && m > calendar.months.length))) return "Месяц вне диапазона";
    if (d !== null) {
      if (d < 1 || d > 31) return "День должен быть 1–31";
      if (m !== null && calendar) {
        const month = calendar.months.find((x) => x.position === m);
        if (month && d > month.days) return `В месяце «${month.name}» только ${month.days} дней`;
      }
    }
    if (showEndDate) {
      const ye = parseDraftInt(inworldYearEndDraft);
      const me = parseDraftInt(inworldMonthEndDraft);
      const de = parseDraftInt(inworldDayEndDraft);
      if (me !== null && (me < 1 || (calendar && calendar.months.length > 0 && me > calendar.months.length))) return "Месяц окончания вне диапазона";
      if (de !== null) {
        if (de < 1 || de > 31) return "День окончания должен быть 1–31";
        if (me !== null && calendar) {
          const month = calendar.months.find((x) => x.position === me);
          if (month && de > month.days) return `В месяце «${month.name}» только ${month.days} дней`;
        }
      }
      // Конец не раньше начала (если оба заданы)
      if (y !== null && m !== null && d !== null && ye !== null && me !== null && de !== null && calendar) {
        try {
          const a = elapsedDays(y, m, d, calendar.months);
          const b = elapsedDays(ye, me, de, calendar.months);
          if (b < a) return "Дата окончания раньше начала";
        } catch {}
      }
      void ye; void me; void de;
    }
    void y;
    return null;
  }

  const inworldValidationError = editingInworldDate ? validateInworldDraft() : null;

  async function saveInworldDate() {
    if (validateInworldDraft()) return;
    const y = parseDraftInt(inworldYearDraft);
    const m = parseDraftInt(inworldMonthDraft);
    const d = parseDraftInt(inworldDayDraft);
    const ye = showEndDate ? parseDraftInt(inworldYearEndDraft) : null;
    const me = showEndDate ? parseDraftInt(inworldMonthEndDraft) : null;
    const de = showEndDate ? parseDraftInt(inworldDayEndDraft) : null;
    await api.put(`/sessions/${sessionId}`, {
      inworld_year: y,
      inworld_month: m,
      inworld_day: d,
      inworld_year_end: ye,
      inworld_month_end: me,
      inworld_day_end: de,
    });
    setEditingInworldDate(false);
    refresh();
  }

  async function archiveSession() {
    if (!session) return;
    const date = session.date || "Без даты";
    await deleteWithUndo({
      entityName: `Сессия ${date}`,
      deleteFn: () => api.del(`/sessions/${sessionId}`),
      restoreFn: () => api.del(`/sessions/${sessionId}`),
    });
    navigate(`/campaigns/${session.campaign_id}`);
  }

  async function updateAttendance(
    playerId: number,
    field: "attended" | "amount_paid" | "amount_forgiven",
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
        amount_forgiven: a.amount_forgiven,
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

  // Перенос сессии — это правка её даты, а не заведение новой. Прежняя
  // кнопка «Перенести» создавала пустой дубль и помечала старую сессию
  // rescheduled: название, задумка, состав и подготовка оставались на
  // брошенной записи. Номер сессии считается по порядку дат, так что после
  // правки он пересчитается сам.
  async function saveDate() {
    if (!session || !dateDraft || dateDraft === session.date) return;
    await api.put(`/sessions/${sessionId}`, { date: dateDraft });
    refresh();
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
  const held = session.status === "held";

  const whenLabel = [
    new Date(`${session.date}T00:00:00`).toLocaleDateString("ru-RU", {
      day: "numeric",
      month: "long",
    }),
    session.start_time || null,
  ]
    .filter(Boolean)
    .join(", ");

  // «В мире» в шапке — промежуток одной строкой и БЕЗ эры: шапку читают
  // мельком, а «Летоисчисление Долин» дважды в строке — это половина её длины
  // на то, что и так известно. Полная запись с эрой осталась в «Обзоре».
  const worldLabel =
    (calendar
      ? formatInworldRange(
          { year: draftYear, month: draftMonth, day: draftDay },
          showEndDate ? { year: draftYearEnd, month: draftMonthEnd, day: draftDayEnd } : null,
          calendar.months,
          ""
        )
      : null) ?? "не указана";

  // Сколько прошло внутриигровых дней. Считается тем же способом, что и
  // полоса времени на пульте, иначе они разошлись бы.
  const daysPassed =
    calendar &&
    session.inworld_year != null &&
    session.inworld_month != null &&
    session.inworld_day != null &&
    session.inworld_year_end != null &&
    session.inworld_month_end != null &&
    session.inworld_day_end != null
      ? elapsedDays(
          session.inworld_year_end,
          session.inworld_month_end,
          session.inworld_day_end,
          calendar.months
        ) -
        elapsedDays(
          session.inworld_year,
          session.inworld_month,
          session.inworld_day,
          calendar.months
        )
      : null;

  const allAttended = session.attendance.length > 0 && session.attendance.every((a) => !!a.attended);

  return (
    <div className="stack session-profile">
      <div className="sp-nav">
        <button className="sp-nav__btn" disabled={!prevSession} title={prevSession ? `${sessionLabel(prevSession)} — ${prevSession.date}` : "Это первая сессия кампании"} onClick={() => prevSession && navigate(`/sessions/${prevSession.id}`)}>
          ← {prevSession ? (prevSession.title || `№${prevSession.session_number ?? ""} · ${prevSession.date}`) : "Пред. сессия"}
        </button>
        <button className="sp-nav__btn" disabled={!nextSession} title={nextSession ? `${sessionLabel(nextSession)} — ${nextSession.date}` : "Это последняя сессия кампании"} onClick={() => nextSession && navigate(`/sessions/${nextSession.id}`)}>
          {nextSession ? (nextSession.title || `№${nextSession.session_number ?? ""} · ${nextSession.date}`) : "След. сессия"} →
        </button>
      </div>

      {/* Заголовок. Название правится прямо здесь: пунктир под ним и карандаш
          рядом — единственное, что говорит «это можно переписать». Двойной
          щелчок работал и раньше, но о нём никто не знал, а кнопка «Название»
          в углу стояла среди действий над сессией, а не над её именем. */}
      <div className="row sp-header" style={{ justifyContent: "space-between" }}>
        {editingTitle ? (
          <div className="row">
            <input
              autoFocus
              placeholder={`Сессия №${session.session_number ?? ""}`}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveTitle();
                if (e.key === "Escape") setEditingTitle(false);
              }}
            />
            <button className="primary" onClick={saveTitle}>
              Сохранить
            </button>
            <button onClick={() => setEditingTitle(false)}>Отмена</button>
          </div>
        ) : (
          <h1 className="sp-h1">
            <Link to={`/campaigns/${campaign.id}`}>{campaign.name}</Link> —{" "}
            <span className="sp-name" onClick={() => setEditingTitle(true)}>
              {sessionLabel(session)}
            </span>
            <button
              className="sp-pencil"
              title="Переименовать сессию"
              onClick={() => setEditingTitle(true)}
            >
              <NavIcon name="edit" />
            </button>
          </h1>
        )}

        <div className="row">
          {!isPlayer && !hideFinance && (
            <div className="badge held">
              {session.earned} {campaign.currency}
            </div>
          )}
          <div className="entity-header-actions">
            {!isPlayer && (
              <button className="primary" onClick={() => navigate(`/sessions/${sessionId}/live`)}>
                <NavIcon name="die" /> Пульт сессии
              </button>
            )}
            <button className="danger" onClick={archiveSession}>
              <NavIcon name="archive" /> Архивировать
            </button>
          </div>
        </div>
      </div>

      {/* Шапка одной строкой на всех вкладках, только чтение: «когда», «в
          мире» и номер — это то, что переспрашивают на любой вкладке, а
          править их есть где (Обзор). */}
      <div className="sp-strip">
        <div className="sp-strip__cell">
          <span className="sp-label">Когда</span>
          <span className="sp-value">{whenLabel}</span>
        </div>
        {campaign.setting_id && (
          <div className="sp-strip__cell">
            <span className="sp-label">В мире</span>
            {worldLabel === "не указана" && !editingInworldDate ? (
              <button className="sp-value sp-value--cta" onClick={() => { selectTab("Обзор"); setEditingInworldDate(true); }}>указать →</button>
            ) : (
              <span className="sp-value">{worldLabel}</span>
            )}
          </div>
        )}
        <div className="sp-strip__cell">
          <span className="sp-label">Номер</span>
          <span className="sp-value">№{session.session_number ?? "—"}</span>
        </div>
        <span style={{ flex: 1 }} />
        <div className="sp-strip__status">
          <span className={`badge ${session.status}`}>
            {STATUS_LABELS[session.status] ?? session.status}
          </span>
        </div>
      </div>

      <div className="tabs">
        {SESSION_TABS.map((t) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => selectTab(t)}>
            {t}{t === "Ресурсы" && linkResources.length > 0 ? ` · ${linkResources.length}` : ""}
          </button>
        ))}
      </div>

      {tab === "Обзор" && (
        <div className="stack">
          {/* Три решения о вечере — тремя карточками в ряд, каждая подписана
              капсом над значением (макет владельца, 2026-08-21). */}
          {!isPlayer && (
            <div className="sp-deal">
                  <label className="sp-deal__cell">
                    <span className="sp-deal__label">Статус</span>
                    <span className="sp-deal__body">
                      <select
                        value={session.status}
                        title={STATUS_LABELS[session.status] ?? session.status}
                        onChange={(e) => setStatus(e.target.value as SessionStatus)}
                      >
                        {/* Подписи берутся из того же словаря, что и значок в
                        шапке: раньше список говорил «Отмена», а значок —
                        «Отменена». */}
                        {Object.entries(STATUS_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                      <i className="sp-deal__caret" />
                    </span>
                  </label>
                  {!hideFinance && (
                    <label className="sp-deal__cell">
                      <span className="sp-deal__label">Оплата</span>
                      <span className="sp-deal__body">
                        <select
                          value={session.payment_override ?? ""}
                          title={session.payment_override ? PAYMENT_TYPE_LABELS[session.payment_override as PaymentType] ?? "" : `Как в кампании (${PAYMENT_TYPE_LABELS[campaignPaymentLabel(session, campaign)]})`}
                          onChange={(e) => setPaymentOverride(e.target.value as "" | PaymentType)}
                        >
                          <option value="">
                            Как в кампании (
                            {PAYMENT_TYPE_LABELS[campaignPaymentLabel(session, campaign)]})
                          </option>
                          {PAYMENT_TYPE_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                        <i className="sp-deal__caret" />
                      </span>
                    </label>
                  )}
                  {!hideFinance && isPaidEffective && (
                    <label className="sp-deal__cell">
                      <span className="sp-deal__label">Ставка</span>
                      <span className="sp-deal__body">
                        <input
                          value={stakeDraft}
                          placeholder={String(campaign.session_rate)}
                          onChange={(e) => setStakeDraft(e.target.value)}
                          onBlur={saveStake}
                        />
                        <span className="sp-deal__unit">{campaign.currency}</span>
                      </span>
                    </label>
                  )}
                </div>
          )}

          {/* Два времени, а не одно поле на четыре значения: слева когда
              садимся за стол, справа какое число в мире. Это разные вопросы,
              и слепленные в ряд они читались как один невнятный список. */}
          <div className="card sp-time">
            <div className="sp-time__side">
              <div className="sp-time__head">
                <NavIcon name="calendar" /> За столом
              </div>
              <div className="sp-time__body">
                {/* Дата правится и в кампаниях, где владелец играет, а не
                    ведёт (решение владельца, 2026-08-20): статус, оплата и
                    пульт там скрыты как чужая епархия, а дата — то, что
                    переносят всей группой. */}
                <label className="sp-field">
                  <span className="sp-label">Дата</span>
                  <input
                    type="date"
                    value={dateDraft}
                    onChange={(e) => setDateDraft(e.target.value)}
                    onBlur={saveDate}
                  />
                </label>
                <label className="sp-field">
                  <span className="sp-label">Начало</span>
                  <input
                    type="time"
                    value={startTimeDraft}
                    onChange={(e) => setStartTimeDraft(e.target.value)}
                    onBlur={saveStartTime}
                  />
                </label>
              </div>
            </div>

            <div className="sp-time__split" />

            <div className="sp-time__side">
              <div className="sp-time__head">
                <NavIcon name="globe" /> В мире
              </div>
              <div className="sp-time__body">
                {!campaign.setting_id || !calendar ? (
                  <span className="muted">
                    У кампании нет сеттинга — внутриигровой даты не из чего собрать.
                  </span>
                ) : !editingInworldDate ? (
                  <>
                    <div className="sp-field">
                      <span className="sp-label">Начало</span>
                      <button className="sp-inworld" onClick={() => setEditingInworldDate(true)}>
                        {inworldBadge ?? "указать дату"}
                      </button>
                    </div>
                    <div className="sp-field">
                      <span className="sp-label">Конец</span>
                      <button
                        className={`sp-inworld${inworldBadgeEnd ? "" : " is-empty"}`}
                        onClick={() => setEditingInworldDate(true)}
                      >
                        {inworldBadgeEnd ?? "не указан"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="sp-inworld-edit">
                    <div className="sp-inworld-edit__grid">
                      <span className="sp-inworld-edit__label">Год</span>
                      <div className="sp-inworld-edit__field">
                        <input
                          type="number"
                          value={inworldYearDraft}
                          onChange={(e) => setInworldYearDraft(e.target.value)}
                          placeholder="—"
                        />
                      </div>
                      <span className="sp-inworld-edit__label">Месяц</span>
                      <div className="sp-inworld-edit__field">
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
                      </div>
                      <span className="sp-inworld-edit__label">День</span>
                      <div className="sp-inworld-edit__field">
                        <input
                          type="number"
                          value={inworldDayDraft}
                          onChange={(e) => setInworldDayDraft(e.target.value)}
                          placeholder="—"
                        />
                      </div>
                    </div>
                    <label className="sp-inworld-edit__check">
                      <input
                        type="checkbox"
                        checked={showEndDate}
                        onChange={(e) => setShowEndDate(e.target.checked)}
                      />
                      указать дату окончания
                    </label>
                    {showEndDate && (
                      <div className="sp-inworld-edit__grid">
                        <span className="sp-inworld-edit__label">Конец — год</span>
                        <div className="sp-inworld-edit__field">
                          <input
                            type="number"
                            value={inworldYearEndDraft}
                            onChange={(e) => setInworldYearEndDraft(e.target.value)}
                            placeholder="—"
                          />
                        </div>
                        <span className="sp-inworld-edit__label">Конец — месяц</span>
                        <div className="sp-inworld-edit__field">
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
                        </div>
                        <span className="sp-inworld-edit__label">Конец — день</span>
                        <div className="sp-inworld-edit__field">
                          <input
                            type="number"
                            value={inworldDayEndDraft}
                            onChange={(e) => setInworldDayEndDraft(e.target.value)}
                            placeholder="—"
                          />
                        </div>
                      </div>
                    )}
                    {showEndDate && !inworldValidationError && draftYear !== null && draftMonth !== null && draftDay !== null && draftYearEnd !== null && draftMonthEnd !== null && draftDayEnd !== null && calendar && (() => { try { const d = elapsedDays(draftYearEnd, draftMonthEnd, draftDayEnd, calendar.months) - elapsedDays(draftYear, draftMonth, draftDay, calendar.months); return d >= 0 ? <span className="sp-inworld-edit__hint">Пройдёт {d} {plural(d, "день", "дня", "дней")}</span> : null; } catch { return null; } })()}
                    {inworldValidationError && (
                      <span className="sp-inworld-edit__error">{inworldValidationError}</span>
                    )}
                    <div className="sp-inworld-edit__actions">
                      <button className="primary" onClick={saveInworldDate} disabled={!!inworldValidationError}>
                        Сохранить дату
                      </button>
                      <button onClick={() => setEditingInworldDate(false)}>Отмена</button>
                    </div>
                    {calendar.months.length === 0 && (
                      <span className="muted sp-inworld-edit__hint">
                        Настройте месяцы в{" "}
                        <Link to={`/settings/${campaign.setting_id}`}>календаре сеттинга</Link>,
                        чтобы выбирать месяц из списка.
                      </span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Нераскрытые тайны переехали сюда из «Хроники»: это долг,
              перенесённый с прошлых вечеров, и смотреть на него надо, когда
              вечер только назначают, а не когда он кончился. */}
          {!isPlayer && unrevealedSecrets.length > 0 && (
            <div className="card sp-secrets">
              <div className="sp-secrets__head">
                <span className="sp-title">Нераскрытые тайны и зацепки</span>
                <span className="sp-count">
                  {unrevealedSecrets.length} из {secretsTotal}
                </span>
                <span style={{ flex: 1 }} />
                <span className="muted sp-note">перенесены с прошлых сессий кампании</span>
              </div>
              <div className="sp-secrets__body">
                {unrevealedGroups.map((g) => {
                  const open = openSecretGroups.includes(g.key);
                  return (
                    <div key={g.key} className={`sp-secrets__group${open ? " is-open" : ""}`}>
                      <button
                        className="sp-secrets__group-head"
                        onClick={() => toggleSecretGroup(g.key)}
                      >
                        <i className={`sp-turn is-small${open ? " is-open" : ""}`} />
                        <span className="sp-secrets__group-name">{g.title}</span>
                        <span className="sp-count">{g.items.length}</span>
                      </button>
                      {open &&
                        g.items.map((s) => (
                          <label key={s.id} className="sp-secret">
                            <input type="checkbox" onChange={() => setPendingReveal(s)} />
                            <span style={{ minWidth: 0 }}>
                              <span className="sp-secret__title">{s.title}</span>
                              {s.content && (
                                <div className="sp-secret__content">
                                  <MentionText text={s.content} />
                                </div>
                              )}
                            </span>
                          </label>
                        ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          {justRevealed && (
            <div className="sp-reveal-toast">
              <span>«{justRevealed.title}» — отмечена раскрытой</span>
              <button onClick={() => undoReveal(justRevealed.id)}>Отменить</button>
              <button className="sp-reveal-toast__close" onClick={() => setJustRevealed(null)}>✕</button>
            </div>
          )}
          {pendingReveal && (
            <Modal onClose={() => setPendingReveal(null)}>
              <div className="stack">
                <h3 style={{ margin: 0 }}>Раскрыть тайну?</h3>
                <p className="muted" style={{ margin: 0 }}>
                  «{pendingReveal.title}» отметится как раскрытая в этой сессии и попадёт в «Раскрылось в этот вечер». Отменить можно в течение 5 секунд.
                </p>
                <div className="row">
                  <button
                    className="primary"
                    onClick={() => {
                      const id = pendingReveal.id;
                      setPendingReveal(null);
                      markSecretRevealed(id);
                    }}
                  >
                    Раскрыть
                  </button>
                  <button onClick={() => setPendingReveal(null)}>Отмена</button>
                </div>
              </div>
            </Modal>
          )}
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
            defaultOpen
          >
            {/* Боевая тема задаётся здесь же, рядом с задумкой: её выбирают
                на подготовке к конкретному вечеру, и она главнее темы
                набора — набор заготовлен на всю кампанию. */}
            <label className="sp-idea-battle">
              <span className="sp-idea-battle__label">Боевая тема</span>
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

          {!isPlayer && <SessionSceneTree sessionId={sessionId} />}

          <div className="sp-prep-row">
            <LazyDetails
              title="Сюжетные персонажи"
              className="card stack sp-card--plot"
              style={{ flex: "1 1 280px", minWidth: 260 }}
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
              className="card stack sp-card--location"
              style={{ flex: "1 1 280px", minWidth: 260 }}
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
            <div className="sp-prep-row">
              <LazyDetails title="Препятствия" className="card stack sp-card--enemies" style={{ flex: "1 1 280px", minWidth: 260 }}>
                <ObstacleDropZone sessionId={sessionId} />
              </LazyDetails>

              <LazyDetails
                title="Потенциальный лут"
                className="card stack sp-card--loot"
                style={{ flex: "1 1 280px", minWidth: 260 }}
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

      {tab === "Резюме" && (
        <div className="stack">
          {/* Числа вечера появляются только у проведённой сессии: «прошло 0
              дней, раскрыто 0 тайн» на ещё не сыгранной выглядит как
              сломанный подсчёт, а не как «ещё не время». */}
          {held && report && (
            <div className="sp-stats">
              {daysPassed != null && (
                <div className="sp-stat is-lead">
                  <span className="sp-label">Прошло в мире</span>
                  <span className="sp-stat__value">
                    {daysPassed} {plural(daysPassed, "день", "дня", "дней")}
                  </span>
                  <span className="sp-stat__note">{worldLabel}</span>
                </div>
              )}
              <div className="sp-stat">
                <span className="sp-label">Сыграно сцен</span>
                <span className="sp-stat__value">{report.played}</span>
                <span className="sp-stat__note">
                  из {report.planned} {plural(report.planned, "заготовленной", "заготовленных", "заготовленных")}
                </span>
              </div>
              <div className="sp-stat">
                <span className="sp-label">Раскрыто тайн</span>
                <span className="sp-stat__value">{report.revealed.length}</span>
                <span className="sp-stat__note">из {secretsTotal} по кампании</span>
              </div>
            </div>
          )}

          <EditableTextCard
            key={`events-${session.id}`}
            title="Основные события сессии"
            value={session.main_events}
            onSave={saveMainEvents}
            entityType="session"
            entityId={sessionId}
            collapsible
          >
            <label className="sp-visibility-row">
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

          {held && report && (
            <div className="card sp-revealed">
              <div className="sp-secrets__head">
                <span className="sp-title">Раскрылось в этот вечер</span>
              </div>
              <div className="stack sp-secrets__body">
                {report.revealed.map((r) => (
                  <div key={r.id} className="row" style={{ gap: 8, alignItems: "baseline" }}>
                    <NavIcon name="check" />
                    <span>{r.title}</span>
                  </div>
                ))}
                {report.revealed.length === 0 && (
                  <span className="muted">Ни одной — партия ходила кругами.</span>
                )}
              </div>
            </div>
          )}

          {!held && (
            <div className="sp-pending">
              <NavIcon name="clock" />
              <span>
                Остальное соберётся, когда отметите сессию проведённой: сколько прошло
                внутриигровых дней и какие тайны раскрылись.
              </span>
            </div>
          )}

          {/* Игроки переехали сюда из «Обзора»: состав кампании из сессии в
              сессию один и тот же, а «кто пришёл» и «кто заплатил» отмечают
              ПОСЛЕ вечера, вместе с остальным итогом. */}
          <details className="card stack" open>
            <summary>
              <strong className="entry-title">Игроки</strong>
            </summary>
            <div className="session-attendance-table-wrap">
              <table className="session-attendance-table">
                <thead>
                  <tr>
                    <th>Игрок</th>
                    <th>
                      <label className="sp-check-head" title="Отметить/снять всех">
                        <input type="checkbox" checked={allAttended} onChange={toggleAllAttendance} />
                        Пришёл
                      </label>
                    </th>
                    {!isPlayer && !hideFinance && (
                      <th>
                        {isPaidEffective ? (
                          <button type="button" className="sp-head-btn" title="Оплатить всем по умолчанию" onClick={payAllDefault}>
                            Оплачено · всем
                          </button>
                        ) : (
                          "Оплачено"
                        )}
                      </th>
                    )}
                    {!isPlayer && !hideFinance && isPaidEffective && <th></th>}
                    {!isPlayer && !hideFinance && isPaidEffective && <th title="Списанное Мастером — долг закрывает, в «заработано» не идёт">Прощено</th>}
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
                      {!isPlayer && !hideFinance && isPaidEffective && (
                        <td data-label="Прощено">
                          <input
                            type="number"
                            style={{ width: 90 }}
                            value={a.amount_forgiven || ""}
                            placeholder="0"
                            onChange={(e) =>
                              updateAttendance(a.player_id, "amount_forgiven", Number(e.target.value) || 0)
                            }
                          />
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

          {/* Раньше кнопка просто ставила held, и деньги оставались невнесёнными:
              статус проставлен, напоминать больше нечему, а сводка занижена.
              Теперь оба вопроса задаёт одно окно, и его можно закрыть, ничего
              не заполнив. */}
          {!isPlayer && !held && (
            <button className="primary sp-finish" onClick={() => setOutcomeOpen(true)}>
              Отметить сессию проведённой
            </button>
          )}
          {!isPlayer && outcomeOpen && (
            <SessionOutcomeModal
              sessionId={sessionId}
              onClose={() => setOutcomeOpen(false)}
              onSaved={refresh}
            />
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
      {undoToast && (
        <div className="archive-toast" role="status" aria-live="polite">
          <span className="archive-toast__msg">{undoToast.msg}</span>
          <div className="archive-toast__actions">
            <button className="archive-toast__undo" onClick={() => { const cb = undoToast.onUndo; cb(); }}>Отменить</button>
            <button className="archive-toast__close" onClick={() => {}} aria-label="Закрыть">×</button>
          </div>
        </div>
      )}
    </div>
  );
}

function campaignPaymentLabel(session: SessionDetail, campaign: Campaign): PaymentType {
  return session.campaign_payment_type ?? campaign.payment_type;
}
