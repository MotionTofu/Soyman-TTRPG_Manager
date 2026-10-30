import { useState } from "react";
import { useAction, write } from "../../data/hooks";
import { campaignEventAffects } from "../../data/campaigns";
import { chronicleEventAffects } from "../../data/settingPage";
import { syncMentionLinks } from "../../mentions";
import type { CampaignCalendarEvent, DatePrecision, EventStatus, SettingCalendar } from "../../types";
import { Modal } from "../Modal";
import { MentionTextarea } from "../mentions/MentionTextarea";
import { dateKey } from "./time";

/** Одно окно для Хроники и «Итогов» сессии (Q15); дата сессии — начало периода. */
export function ChronicleEventModal({ campaignId, settingId, calendar, initial, date, sessionId, onClose }: {
  campaignId: number;
  settingId: number | null;
  calendar: SettingCalendar | null;
  initial?: CampaignCalendarEvent;
  date: { year: number; month: number; day: number };
  sessionId?: number;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState(() => ({
    title: initial?.title ?? "", description: initial?.description ?? "",
    year: initial?.inworld_year ?? date.year, month: initial?.inworld_month ?? date.month, day: initial?.inworld_day ?? date.day,
    important: !!initial?.important, precision: initial?.date_precision ?? "day" as DatePrecision,
    status: initial?.status ?? "happened" as EventStatus, cancel_note: initial?.cancel_note ?? "",
    year_end: initial?.inworld_year_end?.toString() ?? "", month_end: initial?.inworld_month_end?.toString() ?? "",
    day_end: initial?.inworld_day_end?.toString() ?? "",
  }));
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const run = useAction();
  const patch = <K extends keyof typeof draft>(key: K, value: typeof draft[K]) => setDraft((old) => ({ ...old, [key]: value }));

  async function save() {
    if (saving || !draft.title.trim()) return;
    const period = draft.year_end !== "" || draft.month_end !== "" || draft.day_end !== "";
    const end = { year: Number(draft.year_end || draft.year), month: Number(draft.month_end || draft.month), day: Number(draft.day_end || draft.day) };
    if (period && dateKey(end.year, end.month, end.day) < dateKey(draft.year, draft.month, draft.day)) {
      setError("Дата окончания периода раньше даты начала.");
      return;
    }
    setError("");
    setSaving(true);
    const world = initial?.source === "setting";
    const kind = world ? "setting_event" : "campaign_event";
    const affects = [...campaignEventAffects(campaignId, world ? undefined : initial?.id), { path: "/player" },
      ...(settingId && world ? chronicleEventAffects(settingId, initial?.id) : []),
      ...(initial?.sessions?.map((session) => ({ path: `/sessions/${session.id}/calendar-events` })) ?? []),
      ...(sessionId ? [{ path: `/sessions/${sessionId}/calendar-events` }] : [])];
    const body = {
      title: draft.title.trim(), description: draft.description,
      inworld_year: draft.year, inworld_month: draft.month, inworld_day: draft.day,
      important: draft.important, date_precision: draft.precision, status: draft.status, cancel_note: draft.cancel_note,
      inworld_year_end: period ? end.year : null, inworld_month_end: period ? end.month : null, inworld_day_end: period ? end.day : null,
      ...(sessionId && !initial ? { session_id: sessionId } : {}),
    };
    try {
      const saved = await run(() => initial
        ? write.put<CampaignCalendarEvent>(`/${world ? "settings" : "campaigns"}/calendar-events/${initial.id}`, body)
        : write.post<CampaignCalendarEvent>(`/campaigns/${campaignId}/calendar-events`, body), { affects, retry: false });
      if (!saved) return;
      await run(() => syncMentionLinks(kind, initial?.id ?? saved.id, initial?.description ?? "", draft.description), { affects });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  const months = calendar?.months ?? [];
  return <Modal onClose={onClose}>
    <h2>{initial ? "Редактировать событие" : "Новое событие"}</h2>
    <form className="stack chr-event-form" onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <label>Название<input required maxLength={200} value={draft.title} onChange={(event) => patch("title", event.target.value)} /></label>
      <label>Описание<MentionTextarea value={draft.description} onChange={(value) => patch("description", value)} rows={4} defaultSettingId={settingId ?? undefined} /></label>
      <div className="chr-form-row">
        <label>Год<input type="number" required value={draft.year} onChange={(event) => patch("year", Number(event.target.value))} /></label>
        <label>Месяц{months.length ? <select value={draft.month} onChange={(event) => patch("month", Number(event.target.value))}>
          {months.map((month) => <option key={month.id} value={month.position}>{month.name}</option>)}
        </select> : <input type="number" min={1} max={36} value={draft.month} onChange={(event) => patch("month", Number(event.target.value))} />}</label>
        <label>День<input type="number" required min={1} max={months.find((month) => month.position === draft.month)?.days ?? 60} value={draft.day} onChange={(event) => patch("day", Number(event.target.value))} /></label>
      </div>
      <div className="chr-form-row">
        <label>Точность<select value={draft.precision} onChange={(event) => patch("precision", event.target.value as DatePrecision)}>
          <option value="day">День</option><option value="month">Месяц</option><option value="year">Год</option><option value="decade">Десятилетие</option><option value="century">Век</option>
        </select></label>
        <label>Статус<select value={draft.status} onChange={(event) => patch("status", event.target.value as EventStatus)}>
          <option value="happened">Произошло</option><option value="upcoming">Предстоит</option><option value="cancelled">Отменено</option>
        </select></label>
      </div>
      <label className="row"><input type="checkbox" checked={draft.important} onChange={(event) => patch("important", event.target.checked)} />Важное ★</label>
      {draft.status === "cancelled" && <label>Почему отменено<input value={draft.cancel_note} onChange={(event) => patch("cancel_note", event.target.value)} /></label>}
      <details><summary>Период — дата окончания</summary>
        <div className="chr-form-row">
          <label>Год до<input type="number" value={draft.year_end} onChange={(event) => patch("year_end", event.target.value)} /></label>
          <label>Месяц до<input type="number" min={1} max={36} value={draft.month_end} onChange={(event) => patch("month_end", event.target.value)} /></label>
          <label>День до<input type="number" min={1} max={60} value={draft.day_end} onChange={(event) => patch("day_end", event.target.value)} /></label>
        </div>
        <span className="d-note">Пусто — точечное событие.</span>
      </details>
      {error && <p role="alert">{error}</p>}
      <div className="modal-footer"><button type="button" className="d-btn" onClick={onClose}>Отмена</button><button className="d-btn d-btn--primary" disabled={saving}>{saving ? "Сохранение…" : "Сохранить"}</button></div>
    </form>
  </Modal>;
}
