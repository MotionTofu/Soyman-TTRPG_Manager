import { Fragment, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAction, useResource, write } from "../../data/hooks";
import { campaignEventAffects, campaignFieldsAffects } from "../../data/campaigns";
import { chroniclePaths, chronicleEventAffects, timelineAffects } from "../../data/settingPage";
import { useSettingCalendar } from "../../hooks/useSettingCalendar";
import { useConfirm, usePrompt } from "../../hooks/useConfirm";
import { dateFromElapsed, elapsedDays, formatEventDate } from "../../inworldCalendar";
import { sessionLabel } from "../../sessionLabel";
import type { CampaignCalendarEvent, CampaignDetail, ImportantDate, SessionSummary, SettingCalendarEra, SettingCalendarTimeline, SettingCycle } from "../../types";
import { ContextMenu, type ContextMenuItem } from "../ContextMenu";
import { Modal } from "../Modal";
import { SettingCyclePanel } from "../setting/SettingCyclePanel";
import { SettingCycles } from "../SettingCycles";
import { Timeline, type TimelineEvent } from "../Timeline";
import { Chronicle, ChronicleEra, ChronicleNowLine, ChronicleToneChips } from "./Chronicle";
import { ChronicleMonthStrip, type YM } from "./ChronicleMonthStrip";
import { ChronicleRow } from "./ChronicleRow";
import { ChronicleEventModal } from "./ChronicleEventModal";
import { EventParticipants } from "./EventParticipants";
import { cycleElements, dayInTurn, elementDays } from "../../cycles";
import { campaignClock, dateKey, eventOccursOn, seasonAt, timeTone, type TimeTone } from "./time";

const NO_CYCLES: SettingCycle[] = [];
const NO_ERAS: SettingCalendarEra[] = [];
const NO_TIMELINES: SettingCalendarTimeline[] = [];
const NO_DATES: ImportantDate[] = [];
const WORLD_ID = 1_000_000_000;
type Section = "Хронология" | "Повторяющиеся" | "Циклы" | "Календарь";
type Day = { year: number; month: number; day: number };
const eventKey = (ev: CampaignCalendarEvent) => `${ev.source ?? "campaign"}:${ev.id}`;
const uiId = (ev: CampaignCalendarEvent) => ev.source === "setting" ? WORLD_ID + ev.id : ev.id;
const profile = (ev: CampaignCalendarEvent) => `/${ev.source === "setting" ? "events" : "campaign-events"}/${ev.id}`;
const eventPath = (ev: CampaignCalendarEvent) => `/${ev.source === "setting" ? "settings" : "campaigns"}/calendar-events/${ev.id}`;

/** Camp-Chronicle: тот же каркас, строки и календарь, что у Хроники сеттинга. */
export function CampaignChronicle({ campaign, sessions, events: allEvents }: {
  campaign: CampaignDetail;
  sessions: SessionSummary[];
  events: CampaignCalendarEvent[];
}) {
  const settingId = campaign.setting_id;
  const calendar = useSettingCalendar(settingId);
  const months = calendar?.months ?? [];
  const cycles = useResource<SettingCycle[]>(settingId ? chroniclePaths.cycles(settingId, campaign.id) : null).data ?? NO_CYCLES;
  const allEras = useResource<SettingCalendarEra[]>(settingId ? chroniclePaths.eras(settingId, campaign.id) : null).data ?? NO_ERAS;
  const timelines = useResource<SettingCalendarTimeline[]>(settingId ? chroniclePaths.timelines(settingId, campaign.id) : null).data ?? NO_TIMELINES;
  const importantDates = useResource<ImportantDate[]>(settingId ? chroniclePaths.importantDates(settingId) : null).data ?? NO_DATES;
  const [section, setSection] = useState<Section>("Хронология");
  const [mobileView, setMobileView] = useState<"Список" | "Ось" | "Календарь">("Список");
  const [tones, setTones] = useState<Set<TimeTone>>(() => new Set(["past", "on", "up"]));
  const [search, setSearch] = useState("");
  const [newestFirst, setNewestFirst] = useState(false);
  const [timelineId, setTimelineId] = useState<number | null>(null);
  const [eraId, setEraId] = useState<number | null>(null);
  const [dayFilter, setDayFilter] = useState<Day | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [focus, setFocus] = useState<Day | null>(null);
  const [calendarFocus, setCalendarFocus] = useState<YM | null>(null);
  const [modal, setModal] = useState<{ date: Day; initial?: CampaignCalendarEvent } | null>(null);
  const [eraModal, setEraModal] = useState(false);
  const [cycleModal, setCycleModal] = useState<"new" | "edit" | null>(null);
  const [headerCycles, setHeaderCycles] = useState<SettingCycle[]>(NO_CYCLES);
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const axisRef = useRef<HTMLDivElement>(null);
  const calendarRef = useRef<HTMLElement>(null);
  const run = useAction();
  const navigate = useNavigate();
  const [confirmDialog, confirm] = useConfirm();
  const [promptDialog, prompt] = usePrompt();
  const clock = useMemo(() => campaignClock(campaign, sessions), [campaign, sessions]);
  const now = clock.now;
  const cycleLabels = now ? headerCycles.flatMap((cycle) => {
    const anchor = elapsedDays(cycle.anchor_year, cycle.anchor_month, cycle.anchor_day, months);
    const day = dayInTurn(elapsedDays(now.year, now.month, now.day ?? 1, months), anchor, cycle.period_days);
    return cycleElements(cycle).filter((element) => ((day - element.day_offset) % cycle.period_days + cycle.period_days) % cycle.period_days < elementDays(element, cycle.period_days)).map((element) => element.name);
  }).slice(0, 3) : [];
  const events = allEvents.filter((ev) => !ev.hidden);
  const hidden = allEvents.filter((ev) => ev.hidden);
  const eras = allEras.filter((era) => era.timeline_id === timelineId).sort((a, b) => a.start_year - b.start_year);
  const eraOf = (year: number) => eras.filter((era) => era.start_year <= year).at(-1);
  const toned = events.map((ev) => ({ ev, tone: timeTone(ev, now) }));
  const future = toned.filter(({ ev, tone }) => tone === "up" && (!now || dateKey(ev.inworld_year, ev.inworld_month, ev.inworld_day) > dateKey(now.year, now.month, now.day ?? 1)))
    .map(({ ev }) => ev).sort((a, b) => dateKey(a.inworld_year, a.inworld_month, a.inworld_day) - dateKey(b.inworld_year, b.inworld_month, b.inworld_day));
  const nearest = future[0];
  const daysTo = (ev: CampaignCalendarEvent) => now && months.length ? elapsedDays(ev.inworld_year, ev.inworld_month, ev.inworld_day, months) - elapsedDays(now.year, now.month, now.day ?? 1, months) : null;
  const list = toned.filter(({ ev, tone }) => tones.has(tone)
    && (!search.trim() || `${ev.title} ${ev.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()))
    && (!dayFilter || eventOccursOn(ev, dayFilter))
    && (eraId == null || eraOf(ev.inworld_year)?.id === eraId))
    .map(({ ev }) => ev).sort((a, b) => (newestFirst ? -1 : 1) * (dateKey(a.inworld_year, a.inworld_month, a.inworld_day) - dateKey(b.inworld_year, b.inworld_month, b.inworld_day)));
  const activeSessions = sessions.filter((session) => session.status !== "cancelled" && session.inworld_year != null);
  const axisEvents: TimelineEvent[] = events.filter((ev) => ev.source !== "setting").map((ev) => ({
    id: uiId(ev), title: ev.title, year: ev.inworld_year, month: ev.inworld_month, day: ev.inworld_day,
    precision: ev.date_precision, year_end: ev.inworld_year_end, month_end: ev.inworld_month_end, day_end: ev.inworld_day_end,
    status: ev.status, important: !!ev.important, kind: "event",
  }));
  axisEvents.push(...activeSessions.map((session) => ({ id: -session.id, title: sessionLabel(session), year: session.inworld_year!, month: session.inworld_month ?? 1, day: session.inworld_day ?? 1,
    precision: "day" as const, year_end: session.inworld_year_end ?? null, month_end: session.inworld_month_end ?? null, day_end: session.inworld_day_end ?? null,
    status: "happened" as const, important: false, kind: "session" as const })));

  function create(date?: Day) { setModal({ date: date ?? { year: now?.year ?? 1, month: now?.month ?? months[0]?.position ?? 1, day: now?.day ?? 1 } }); }
  function edit(ev: CampaignCalendarEvent) { setModal({ date: { year: ev.inworld_year, month: ev.inworld_month, day: ev.inworld_day }, initial: ev }); }
  function affects(ev: CampaignCalendarEvent) { return [...campaignEventAffects(campaign.id, ev.source === "setting" ? undefined : ev.id), ...(settingId && ev.source === "setting" ? chronicleEventAffects(settingId, ev.id) : []), ...(ev.sessions?.map((session) => ({ path: `/sessions/${session.id}/calendar-events` })) ?? [])]; }
  async function toggle(ev: CampaignCalendarEvent, key: "important" | "visible_to_players") {
    await run(() => write.put(eventPath(ev), { [key]: !ev[key] }), { affects: [...affects(ev), { path: "/player" }] });
  }
  async function remove(ev: CampaignCalendarEvent) {
    if (ev.source === "setting") {
      await run(() => write.put(`/campaigns/${campaign.id}/hidden-events/${ev.id}`, { hidden: true }), { affects: campaignEventAffects(campaign.id) });
    } else if (await confirm({ message: `Удалить событие «${ev.title}»?`, confirmLabel: "Удалить", danger: true })) {
      await run(() => write.del(eventPath(ev)), { affects: affects(ev) });
    }
  }
  function select(ev: CampaignCalendarEvent) {
    setSelected(eventKey(ev));
    setFocus({ year: ev.inworld_year, month: ev.inworld_month, day: ev.inworld_day });
    setCalendarFocus({ year: ev.inworld_year, month: ev.inworld_month });
  }
  async function pin(at: YM) {
    await run(() => write.put(`/campaigns/${campaign.id}/pinned-calendar`, at), { affects: campaignFieldsAffects(campaign.id) });
  }
  async function addTimeline() {
    if (!settingId) return;
    const name = await prompt({ title: "Новый таймлайн кампании", message: "Название", confirmLabel: "Создать" });
    if (!name?.trim()) return;
    const created = await run(() => write.post<SettingCalendarTimeline>(chroniclePaths.timelines(settingId), { name, campaign_id: campaign.id }), { affects: timelineAffects(settingId), retry: false });
    if (created) { setTimelineId(created.id); setEraId(null); }
  }
  async function deleteCalendarRecord(kind: "calendar-eras" | "calendar-timelines", id: number, name: string) {
    if (!settingId || !await confirm({ message: `Удалить «${name}»?`, confirmLabel: "Удалить", danger: true })) return;
    const done = await run(() => write.del(`/settings/${kind}/${id}?campaign=${campaign.id}`).then(() => true), { affects: timelineAffects(settingId) });
    if (done && kind === "calendar-timelines" && timelineId === id) { setTimelineId(null); setEraId(null); }
  }
  function dayMenu(year: number, month: number, day: number, x: number, y: number, dayEvents: CampaignCalendarEvent[]) {
    setMenu({ x, y, items: [{ label: "Событие на этот день", onClick: () => create({ year, month, day }) }, ...dayEvents.map((ev) => ({ label: ev.title, onClick: () => navigate(profile(ev)) }))] });
  }

  return <>
    {confirmDialog}{promptDialog}
    <Chronicle
      mobile={{ view: mobileView, onView: setMobileView }}
      nowLine={<ChronicleNowLine now={now} months={months} source={clock.source} season={now ? seasonAt(cycles, months, now.year, now.month) : null}
        cycleLabels={cycleLabels} ongoing={toned.filter(({ tone }) => tone === "on").length}
        nearest={now && nearest ? { title: nearest.title, year: nearest.inworld_year, month: nearest.inworld_month, day: nearest.inworld_day, days: daysTo(nearest) ?? undefined } : null}
        empty="«Сейчас» не задано — закрепите месяц или укажите дату проведённой сессии." />}
      actions={<><button className="d-btn" disabled={!settingId} onClick={() => setEraModal(true)}>+ Эпоха</button><button className="d-btn d-btn--primary" onClick={() => create()}>+ Событие</button></>}
      axis={<div ref={axisRef}><Timeline events={axisEvents} months={months} era={calendar?.era ?? ""} eras={allEras} selectedTimelineId={timelineId} now={now} focusDate={focus}
        onNowChange={(at) => void pin(at)}
        onEventClick={(id) => { const ev = events.find((event) => uiId(event) === id); if (id < 0) navigate(`/sessions/${-id}`); else if (ev) navigate(profile(ev)); }}
        onMoveEvent={(id, at) => { const ev = events.find((event) => uiId(event) === id); if (ev) void run(() => write.put(eventPath(ev), { inworld_year: at.year, inworld_month: at.month, inworld_day: at.day, date_precision: at.precision }), { affects: affects(ev) }); }}
        leftAction={<span className="chr-axis__tl"><span className="d-note">таймлайн</span><select className="chr-select" aria-label="Таймлайн" value={timelineId ?? ""} onChange={(event) => { setTimelineId(event.target.value ? Number(event.target.value) : null); setEraId(null); }}>
          <option value="">Общий</option>{timelines.map((line) => <option key={line.id} value={line.id}>{line.campaign_id == null ? "🔒 " : ""}{line.name}</option>)}
        </select><button className="d-btn d-btn--sm d-btn--quiet" title="Новый таймлайн" disabled={!settingId} onClick={() => void addTimeline()}>+</button></span>}
        action={eras.length ? <select className="chr-select" aria-label="Эпоха" value={eraId ?? ""} onChange={(event) => setEraId(event.target.value ? Number(event.target.value) : null)}><option value="">Все эпохи</option>{eras.map((era) => <option key={era.id} value={era.id}>{era.name}</option>)}</select> : undefined}
        below={settingId ? (view) => <SettingCyclePanel settingId={settingId} campaignId={campaign.id} cycles={cycles} view={view}
          onAddCycle={() => setCycleModal("new")} onEditCycles={() => setCycleModal("edit")} onVisibleCycles={setHeaderCycles}
          onDayMenu={(day, x, y) => { const date = dateFromElapsed(day, months); dayMenu(date.year, date.month, date.day, x, y, []); }} /> : undefined}
      />{settingId && <span className="d-note">🔒 — из сеттинга, правка в сеттинге · без замка — циклы кампании</span>}</div>}
      sections={[{ id: "Хронология", label: "Хронология", count: events.length }, { id: "Повторяющиеся", label: "Повторяющиеся", count: importantDates.length }, { id: "Циклы", label: "Циклы", count: cycles.length }, { id: "Календарь", label: "Календарь" }]}
      section={section} onSection={setSection}
      search={section === "Хронология" ? { value: search, onChange: setSearch, placeholder: "Поиск по хронике" } : undefined}
      tools={section === "Хронология" ? <button className="d-btn d-btn--sm d-btn--quiet" onClick={() => setNewestFirst((old) => !old)}>{newestFirst ? "↓ Новые сверху" : "↑ Старые сверху"}</button> : undefined}
      chips={<ChronicleToneChips tones={tones} onToggle={(tone) => setTones((old) => { const next = new Set(old); if (next.has(tone)) next.delete(tone); else next.add(tone); return next; })}
        offCount={events.filter((event) => event.status === "cancelled").length} summary={`${list.length} из ${events.length} событий${!tones.has("off") ? " · отменённые свёрнуты" : ""}`} />}
      calendar={months.length ? <ChronicleMonthStrip ref={calendarRef} months={months} weekdays={calendar?.weekdays ?? []} events={toned} now={now}
        pin={{ pinned: campaign.pinned_calendar_year != null && campaign.pinned_calendar_month != null ? { year: campaign.pinned_calendar_year, month: campaign.pinned_calendar_month } : null, onPin: (at) => void pin(at) }}
        seasonOf={(year, month) => seasonAt(cycles, months, year, month)} focus={calendarFocus} selectedDay={dayFilter}
        sessions={activeSessions.map((session) => ({ id: session.id, title: sessionLabel(session), year: session.inworld_year!, month: session.inworld_month ?? 1, day: session.inworld_day ?? 1 }))}
        onDayClick={(at) => { setDayFilter((old) => old && dateKey(old.year, old.month, old.day) === dateKey(at.year, at.month, at.day) ? null : at); setSection("Хронология"); setMobileView("Список"); }} onDayMenu={dayMenu} /> : <p className="muted">{settingId ? "В сеттинге пока не настроен календарь." : "У кампании не привязан сеттинг — календарь недоступен."}</p>}
    >
      {section === "Хронология" && <>
        {!!future.length && <details className="chr-nearest"><summary>Ближайшие · {future.length}</summary>{future.slice(0, 5).map((ev) => <Link key={eventKey(ev)} to={profile(ev)}>{ev.title}{daysTo(ev) != null ? ` · через ${daysTo(ev)} дн.` : ""}</Link>)}</details>}
        {dayFilter && <button className="d-btn d-btn--sm chr-day-filter" onClick={() => setDayFilter(null)}>{formatEventDate(dayFilter.year, dayFilter.month, dayFilter.day, months)} ✕</button>}
        <div className="chr-list">{list.map((ev, index) => { const era = eraOf(ev.inworld_year); const previous = index ? eraOf(list[index - 1].inworld_year) : null;
          return <Fragment key={eventKey(ev)}>{era && era !== previous && <ChronicleEra name={era.name} note={`с ${era.start_year} года${era.campaign_id == null ? " · из сеттинга" : ""}`} />}
            <ChronicleRow ev={ev} tone={timeTone(ev, now)} months={months} href={profile(ev)} selected={selected === eventKey(ev)} onSelect={() => select(ev)}
              extra={<EventParticipants event={ev} />} onToggleVisible={() => void toggle(ev, "visible_to_players")} onToggleImportant={() => void toggle(ev, "important")}
              menu={[{ label: "Изменить", onClick: () => edit(ev) }, { label: "Показать на оси", onClick: () => { select(ev); setMobileView("Ось"); axisRef.current?.scrollIntoView({ block: "center" }); } },
                { label: ev.source === "setting" ? "Убрать из кампании" : "Удалить", danger: ev.source !== "setting", onClick: () => void remove(ev) }]} />
          </Fragment>; })}{!list.length && <p className="muted">{events.length ? "Ничего не найдено." : "Событий пока нет."}</p>}</div>
        {!!hidden.length && <details className="paper-fold"><summary>Убраны из кампании · {hidden.length}</summary>{hidden.map((ev) => <div className="row" key={eventKey(ev)}><span>{ev.title}</span><button className="d-btn d-btn--sm" onClick={() => void run(() => write.put(`/campaigns/${campaign.id}/hidden-events/${ev.id}`, { hidden: false }), { affects: campaignEventAffects(campaign.id) })}>Вернуть</button></div>)}</details>}
      </>}
      {section === "Повторяющиеся" && <div className="stack"><span className="d-note">Из сеттинга · только чтение</span>{importantDates.map((date) => <div className="row" key={date.id}><b>{date.title}</b><span>{date.day}{date.month ? ` · ${months.find((month) => month.position === date.month)?.name ?? date.month}` : ""}</span></div>)}{!importantDates.length && <p className="muted">Повторяющихся дат пока нет.</p>}</div>}
      {section === "Циклы" && settingId && <SettingCycles settingId={settingId} campaignId={campaign.id} months={months} now={{ year: now?.year ?? null, month: now?.month ?? null }} />}
      {section === "Календарь" && <div className="stack chr-settings">
        <h3>Календарь сеттинга</h3><span className="d-note">Месяцы и дни недели — из сеттинга, только чтение.</span><p>{months.map((month) => `${month.name} (${month.days})`).join(" · ") || "Месяцы не заданы."}</p>
        <h3>Эпохи</h3>{allEras.map((era) => <div className="row" key={era.id}><span>{era.name} · с {era.start_year}</span>{era.campaign_id == null ? <span className="d-note">🔒 из сеттинга</span> : <button className="d-btn d-btn--sm" onClick={() => void deleteCalendarRecord("calendar-eras", era.id, era.name)}>Удалить</button>}</div>)}
        <button className="d-btn" disabled={!settingId} onClick={() => setEraModal(true)}>+ Эпоха кампании</button>
        <h3>Линии времени</h3>{timelines.map((line) => <div className="row" key={line.id}><span>{line.name}</span>{line.campaign_id == null ? <span className="d-note">🔒 из сеттинга</span> : <button className="d-btn d-btn--sm" onClick={() => void deleteCalendarRecord("calendar-timelines", line.id, line.name)}>Удалить</button>}</div>)}
        <button className="d-btn" disabled={!settingId} onClick={() => void addTimeline()}>+ Таймлайн кампании</button>
      </div>}
    </Chronicle>
    {modal && <ChronicleEventModal campaignId={campaign.id} settingId={settingId} calendar={calendar} date={modal.date} initial={modal.initial} onClose={() => setModal(null)} />}
    {cycleModal && settingId && <Modal onClose={() => setCycleModal(null)}><h2>Циклы кампании</h2><SettingCycles settingId={settingId} campaignId={campaign.id} initiallyAdding={cycleModal === "new"} months={months} now={{ year: now?.year ?? null, month: now?.month ?? null }} /></Modal>}
    {eraModal && settingId && <CampaignEraModal settingId={settingId} campaignId={campaign.id} timelines={timelines} year={now?.year ?? 1} onClose={() => setEraModal(false)} />}
    {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
  </>;
}

function CampaignEraModal({ settingId, campaignId, timelines, year, onClose }: { settingId: number; campaignId: number; timelines: SettingCalendarTimeline[]; year: number; onClose: () => void }) {
  const [name, setName] = useState("");
  const [startYear, setStartYear] = useState(year);
  const [timelineId, setTimelineId] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const run = useAction();
  return <Modal onClose={onClose}><h2>Новая эпоха кампании</h2><form className="stack" onSubmit={async (event) => {
    event.preventDefault(); if (saving || !name.trim()) return; setSaving(true);
    try { const saved = await run(() => write.post(chroniclePaths.eras(settingId), { name: name.trim(), start_year: startYear, timeline_id: timelineId, campaign_id: campaignId }).then(() => true), { affects: timelineAffects(settingId), retry: false }); if (saved) onClose(); }
    finally { setSaving(false); }
  }}><label>Название<input required value={name} onChange={(event) => setName(event.target.value)} /></label><label>Год начала<input type="number" required value={startYear} onChange={(event) => setStartYear(Number(event.target.value))} /></label>
    <label>Таймлайн<select value={timelineId ?? ""} onChange={(event) => setTimelineId(event.target.value ? Number(event.target.value) : null)}><option value="">Общий</option>{timelines.map((line) => <option key={line.id} value={line.id}>{line.name}</option>)}</select></label>
    <div className="modal-footer"><button type="button" className="d-btn" onClick={onClose}>Отмена</button><button className="d-btn d-btn--primary" disabled={saving}>Создать</button></div>
  </form></Modal>;
}
