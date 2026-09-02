import { useCallback, useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import { useSettingCalendar } from "../hooks/useSettingCalendar";
import { dateFromElapsed, elapsedDays, formatInworldDate } from "../inworldCalendar";
import type {
  CampaignCalendarEvent,
  SessionDetail,
  SessionSummary,
  SettingCalendarEvent,
} from "../types";

// Полоса времени наверху пульта. Только чтение — кроме одной кнопки «прошёл
// день», за которой Мастер тянется прямо за столом.
//
// Не ось, а расстояния словами. Ось хороша, когда на неё смотрят; за столом
// на экран смотрят урывками, и «через 3 дня» читается мгновенно, а положение
// засечки надо разглядывать. Сама ось живёт в профиле сеттинга и кампании —
// там на неё как раз смотрят.

const NEAR_COUNT = 3;

interface Props {
  session: SessionDetail;
  settingId: number | null | undefined;
  campaignId: number;
  onChanged: () => void;
}

export function SessionTimeStrip({ session, settingId, campaignId, onChanged }: Props) {
  const calendar = useSettingCalendar(settingId ?? undefined);
  const [settingEvents, setSettingEvents] = useState<SettingCalendarEvent[]>([]);
  const [campaignEvents, setCampaignEvents] = useState<CampaignCalendarEvent[]>([]);
  const [suggested, setSuggested] = useState<{ year: number; month: number; day: number } | null>(null);

  const months = calendar?.months ?? [];
  const era = calendar?.era ?? "";

  useEffect(() => {
    if (settingId) {
      api
        .get<SettingCalendarEvent[]>(`/settings/${settingId}/calendar-events`)
        .then(setSettingEvents);
    }
    api.get<CampaignCalendarEvent[]>(`/campaigns/${campaignId}/calendar-events`).then(setCampaignEvents);
  }, [settingId, campaignId]);

  // Даты у сессии нет — предлагаем ту, на которой кончилась прошлая
  // проведённая. Кнопкой, а не молча: внутримировое время потом трудно
  // расплести, и запись даты, которой Мастер не назначал, — не помощь.
  const hasDate = session.inworld_year != null;
  useEffect(() => {
    if (hasDate) return;
    api
      .get<SessionSummary[]>(`/campaigns/${campaignId}/sessions`)
      .then((all) => {
        const held = all
          .filter((s) => s.id !== session.id && s.status === "held" && s.inworld_year != null)
          .sort((a, b) => (a.date < b.date ? 1 : -1))[0];
        if (!held) return setSuggested(null);
        setSuggested({
          year: held.inworld_year_end ?? held.inworld_year!,
          month: held.inworld_month_end ?? held.inworld_month ?? 1,
          day: held.inworld_day_end ?? held.inworld_day ?? 1,
        });
      })
      .catch(() => setSuggested(null));
  }, [hasDate, campaignId, session.id]);

  // «Сейчас» сессии — конец её промежутка, если он есть: время внутри сессии
  // идёт, и события считаются от того дня, до которого партия дожила.
  const now = useMemo(() => {
    if (session.inworld_year == null) return null;
    return {
      year: session.inworld_year_end ?? session.inworld_year,
      month: session.inworld_month_end ?? session.inworld_month ?? 1,
      day: session.inworld_day_end ?? session.inworld_day ?? 1,
    };
  }, [session]);

  const nowElapsed = useMemo(
    () => (now && months.length ? elapsedDays(now.year, now.month, now.day, months) : null),
    [now, months]
  );

  const near = useMemo(() => {
    if (nowElapsed == null) return [];
    const all = [
      ...settingEvents.map((e) => ({ ...e, from: "мир" as const })),
      ...campaignEvents.map((e) => ({ ...e, from: "кампания" as const })),
    ];
    return all
      .filter((e) => e.status !== "cancelled")
      .map((e) => ({
        title: e.title,
        important: !!e.important,
        from: e.from,
        distance: elapsedDays(e.inworld_year, e.inworld_month, e.inworld_day, months) - nowElapsed,
      }))
      // Прошедшее не показываем: пульту нужно то, что надвигается. Уже
      // случившееся Мастер и так помнит — оно случилось при нём.
      .filter((e) => e.distance >= 0)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, NEAR_COUNT);
  }, [settingEvents, campaignEvents, months, nowElapsed]);

  const [undo, setUndo] = useState<{ y: number | null; m: number | null; d: number | null } | null>(null);

  const advanceDay = useCallback(async () => {
    if (nowElapsed == null) return;
    const prev = { y: session.inworld_year_end, m: session.inworld_month_end, d: session.inworld_day_end };
    const next = dateFromElapsed(nowElapsed + 1, months);
    await api.put(`/sessions/${session.id}`, {
      inworld_year_end: next.year,
      inworld_month_end: next.month,
      inworld_day_end: next.day,
    });
    setUndo(prev);
    setTimeout(() => setUndo((cur) => (cur === prev ? null : cur)), 5000);
    onChanged();
  }, [nowElapsed, months, session]);

  const undoAdvance = useCallback(async () => {
    if (!undo) return;
    await api.put(`/sessions/${session.id}`, {
      inworld_year_end: undo.y,
      inworld_month_end: undo.m,
      inworld_day_end: undo.d,
    });
    setUndo(null);
    onChanged();
  }, [undo, session.id, onChanged]);

  const applySuggested = useCallback(async () => {
    if (!suggested) return;
    await api.put(`/sessions/${session.id}`, {
      inworld_year: suggested.year,
      inworld_month: suggested.month,
      inworld_day: suggested.day,
    });
    onChanged();
  }, [suggested, session.id, onChanged]);

  // Календаря у сеттинга нет — считать не из чего, и полоса молчит, а не
  // показывает пустую рамку.
  if (months.length === 0) return null;

  if (!now) {
    if (!suggested) return null;
    return (
      <div className="card row ts ts-empty">
        <span className="muted">Внутримировая дата сессии не указана.</span>
        <button onClick={applySuggested}>
          Поставить {formatInworldDate(suggested.year, suggested.month, suggested.day, months, era)}
        </button>
      </div>
    );
  }

  return (
    <div className="card row ts">
      <div className="ts-today">
        <span className="sw-label">Сегодня в мире</span>
        <span className="ts-date">{formatInworldDate(now.year, now.month, now.day, months, era)}</span>
      </div>

      <div className="ts-near">
        {near.length === 0 && <span className="muted">Впереди ничего не отмечено.</span>}
        {near.map((e, i) => (
          <span key={i} className={`ts-event${e.important ? " is-important" : ""}`}>
            <span className="ts-in">{distanceWords(e.distance)}</span>
            <span className="ts-title">{e.title}</span>
          </span>
        ))}
      </div>

      <div className="ts-actions">
        <button onClick={advanceDay} title="Сдвинуть конец промежутка сессии">
          Прошёл день
        </button>
        {undo && (
          <button className="comp-mini" onClick={undoAdvance} title="Отменить сдвиг">
            Отменить
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Расстояние словами. Числом дней, а не датой: за столом важно «скоро или
 * нет», а перевод даты в «сколько осталось» Мастер делает в уме и ошибается.
 */
function distanceWords(days: number): string {
  if (days === 0) return "сегодня";
  if (days === 1) return "завтра";
  if (days < 7) return `через ${days} дн.`;
  if (days < 60) return `через ${Math.round(days / 7)} нед.`;
  return `через ${Math.round(days / 30)} мес.`;
}
