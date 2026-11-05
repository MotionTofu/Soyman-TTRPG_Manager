import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { entityKindByEndpoint, type Affect } from "../../data/entities";
import { useSettingCalendar } from "../../hooks/useSettingCalendar";
import { dateKey, timeTone, type ChronicleNow } from "../chronicle/time";
import { ChronicleNowLine } from "../chronicle/Chronicle";
import { ChronicleRow, type ChronicleRowEvent } from "../chronicle/ChronicleRow";
import { ProfileBlock } from "./ProfileParts";
import { Modal } from "../Modal";
import { formatImportantDate } from "../../inworldCalendar";
import type { ImportantDate, DateRecurrence } from "../../types";
import { useConfirm } from "../../hooks/useConfirm";
import "../chronicle/chronicle.css";

export interface ProfileWorldEvent extends ChronicleRowEvent { source: "setting" | "campaign"; campaign_id?: number }
export interface ProfileGameEvent { id: number; title?: string | null; description?: string; campaign_name?: string; campaign_id?: number | null; session_id?: number | null; session_date?: string; date?: string; reasons?: string[]; session_number?: number }

/** source_event_id относится только к setting_calendar_events: id кампании может совпадать. */
export function mergeProfileWorld(dates: ImportantDate[], events: ProfileWorldEvent[], now: ChronicleNow | null) {
  const shown = new Set(events.filter((e) => e.source === "setting").map((e) => e.id));
  const result = events.map((ev) => ({ key: `${ev.source}:${ev.id}`, ev, date: null as ImportantDate | null }));
  for (const d of dates) {
    if (d.source_event_id != null && shown.has(d.source_event_id)) continue;
    const year = d.recurrence === "once" ? d.year ?? now?.year ?? 0 : now?.year ?? d.year ?? 0;
    const month = d.recurrence === "monthly" ? now?.month ?? d.month ?? 1 : d.month ?? now?.month ?? 1;
    const future = now && dateKey(year,month,now.day == null ? 0 : d.day) > dateKey(now.year,now.month,now.day ?? 0);
    result.push({ key: `date:${d.id}`, date: d, ev: { id: d.id, title: d.title, description: d.description ?? "", status: future ? "upcoming" : "happened", important: 0,
      inworld_year: year, inworld_month: month, inworld_day: d.day,
      inworld_year_end: null, inworld_month_end: null, inworld_day_end: null, source: "setting" } });
  }
  return result.sort((a,b) => dateKey(a.ev.inworld_year,a.ev.inworld_month,a.ev.inworld_day) - dateKey(b.ev.inworld_year,b.ev.inworld_month,b.ev.inworld_day) || a.key.localeCompare(b.key));
}

export function ProfileChronicle({ type, id, settingId, campaignId, dates, gameEvents = [], dateEditor, gameContent, recordCount = 0 }: {
  type: string; id: number; settingId: number; campaignId?: number; dates: ImportantDate[]; gameEvents?: ProfileGameEvent[]; dateEditor?: ReactNode; gameContent?: ReactNode; recordCount?: number;
}) {
  const state = useResource<{ events: ProfileWorldEvent[]; now: ChronicleNow | null; source: string }>(`/links/profile-chronicle?type=${type}&id=${id}${campaignId ? `&campaign_id=${campaignId}` : ""}`);
  const data = state.data;
  const calendar = useSettingCalendar(settingId);
  const months = calendar?.months ?? [];
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState("");
  const [recurrence, setRecurrence] = useState<DateRecurrence>("once");
  const [year, setYear] = useState(""); const [month, setMonth] = useState(""); const [day, setDay] = useState("");
  const run = useAction();
  const [confirmDialog,confirm] = useConfirm();
  const base = ({ being: "/setting-beings", community: "/setting-communities", location: "/setting-locations", artifact: "/artifacts" } as Record<string,string>)[type];
  const kind = entityKindByEndpoint(base);
  const affects: Affect[] = [...(kind ? [{ kind, id }] : []), { path: base }, { path: "/calendar" }, { path: "/links/profile-chronicle" }];
  async function add() {
    const ok = await run(() => write.post(`${base}/${id}/important-dates`, { title: title.trim(), recurrence, year: recurrence === "once" ? Number(year) || null : null, month: recurrence !== "monthly" ? Number(month) || null : null, day: Number(day) }).then(() => true), { affects, retry: false });
    if (ok) { setAdding(false); setTitle(""); setYear(""); setMonth(""); setDay(""); }
  }
  const now = data?.now ?? null;
  const rows = mergeProfileWorld(dates,data?.events ?? [],now);
  const n = now ? dateKey(now.year,now.month,now.day ?? 1) : null;
  let nowPlaced = false;
  const nowLine = <div className="profile-now"><span>Сейчас</span><ChronicleNowLine now={now} months={months} source={data?.source ?? ""} ongoing={0} empty="Дата мира не закреплена" /></div>;
  const games = campaignId ? gameEvents.filter((e) => e.campaign_id === campaignId) : gameEvents;
  return <div className="profile-chronicle">
    {confirmDialog}
    <ProfileBlock title="В мире" count={rows.length} actions={<><Link className="d-btn d-btn--sm d-btn--ghost" to={campaignId ? `/campaigns/${campaignId}?tab=Хроника%20мира` : `/settings/${settingId}?tab=Хроника`}>Вся Хроника ›</Link><button type="button" className="d-btn d-btn--sm" onClick={() => setAdding(true)}>+ Дата</button></>}>
      {state.error && <div role="alert">Не удалось прочитать события. <button onClick={state.reload}>Повторить</button></div>}
      {rows.map(({ key,ev,date }) => {
        const before = n != null && !nowPlaced && dateKey(ev.inworld_year,ev.inworld_month,ev.inworld_day) >= n;
        if (before) nowPlaced = true;
        const href = date ? undefined : ev.source === "setting" ? `/events/${ev.id}` : `/campaign-events/${ev.id}`;
        return <div key={key}>{before && nowLine}<ChronicleRow ev={ev} tone={timeTone(ev,now)} months={months} href={href}
          dateLabel={date && (date.recurrence !== "once" || date.year == null) ? { big: String(date.day), small: formatImportantDate(date,months,calendar?.weekdays ?? []) } : undefined}
          menu={date ? [{ label: "Удалить дату", danger: true, onClick: async () => { if (await confirm({ message:`Удалить дату «${date.title}»?`,confirmLabel:"Удалить",danger:true })) await run(() => write.del(`${base}/important-dates/${date.id}`), { affects }); } }] : [{ label: "Открыть событие", onClick: () => navigate(href!) }]} /></div>;
      })}
      {!nowPlaced && nowLine}
      {!rows.length && <p className="muted">Даты и события с участием этой сущности появятся здесь.</p>}
    </ProfileBlock>
    <ProfileBlock title="В игре" count={games.length + recordCount}>
      {games.length ? games.map((e) => <div className="profile-game-row" key={e.id}><span className="profile-game-row__date">{e.session_number ? `№${e.session_number}` : ""}<small>{e.session_date ?? e.date}</small></span><div><strong>{e.title || "Сессия"}</strong>{e.description && <small>{e.description}</small>}{e.campaign_name && <small>{e.campaign_name}</small>}</div><span>{e.reasons?.join(" · ")}{e.session_id && <Link to={`/sessions/${e.session_id}`}>К сессии ›</Link>}</span></div>) : !gameContent && <p className="muted">Появится, когда сущность отметят в сессии.</p>}
      {gameContent}
    </ProfileBlock>
    {adding && <Modal onClose={() => setAdding(false)} ariaLabel="Добавить дату"><h2>Добавить дату</h2>{dateEditor ?? <div className="stack">
      <label>Название<input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
      <label>Повторение<select value={recurrence} onChange={(e) => setRecurrence(e.target.value as DateRecurrence)}><option value="once">Разовое</option><option value="annual">Ежегодное</option><option value="monthly">Ежемесячное</option></select></label>
      {recurrence === "once" && <label>Год<input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></label>}
      {recurrence !== "monthly" && <label>Месяц<select value={month} onChange={(e) => setMonth(e.target.value)}><option value="">Месяц…</option>{months.map((m) => <option key={m.id} value={m.position}>{m.name}</option>)}</select></label>}
      <label>День<input type="number" min="1" value={day} onChange={(e) => setDay(e.target.value)} /></label>
      <button type="button" className="d-btn" disabled={!title.trim() || Number(day) < 1} onClick={add}>Добавить дату</button>
    </div>}</Modal>}
  </div>;
}
