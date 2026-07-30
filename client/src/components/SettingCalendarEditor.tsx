import { useEffect, useState } from "react";
import { api } from "../api/client";
import { InworldCalendar, type InworldDatedItem } from "./InworldCalendar";
import type { ImportantDate, SettingCalendar } from "../types";

interface Props {
  settingId: number;
  items?: InworldDatedItem[];
  pinned?: { year: number; month: number } | null;
  onPin?: (pinned: { year: number; month: number } | null) => void;
  onDayContextMenu?: (year: number, month: number, day: number, x: number, y: number) => void;
  onItemContextMenu?: (item: InworldDatedItem, x: number, y: number) => void;
}

export function SettingCalendarEditor({
  settingId,
  items,
  pinned,
  onPin,
  onDayContextMenu,
  onItemContextMenu,
}: Props) {
  const [calendar, setCalendar] = useState<SettingCalendar | null>(null);
  const [importantDates, setImportantDates] = useState<ImportantDate[]>([]);
  const [editing, setEditing] = useState(false);
  const [months, setMonths] = useState<{ name: string; days: number }[]>([]);
  const [weekdays, setWeekdays] = useState<{ name: string }[]>([]);
  const [era, setEra] = useState("");

  function refresh() {
    api.get<SettingCalendar>(`/settings/${settingId}/calendar`).then((c) => {
      setCalendar(c);
      setMonths(c.months.map((m) => ({ name: m.name, days: m.days })));
      setWeekdays(c.weekdays.map((w) => ({ name: w.name })));
      setEra(c.era);
    });
    api.get<ImportantDate[]>(`/settings/${settingId}/important-dates`).then(setImportantDates);
  }
  useEffect(refresh, [settingId]);

  if (!calendar) return <p className="muted">Загрузка…</p>;

  function startEditing() {
    setMonths(calendar!.months.map((m) => ({ name: m.name, days: m.days })));
    setWeekdays(calendar!.weekdays.map((w) => ({ name: w.name })));
    setEra(calendar!.era);
    setEditing(true);
  }

  async function save() {
    await api.put(`/settings/${settingId}/calendar`, { months, weekdays, era });
    setEditing(false);
    refresh();
  }

  if (!editing) {
    return (
      <div className="stack">
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3>Календарь сеттинга</h3>
            <button onClick={startEditing}>Редактировать</button>
          </div>
          {calendar.era && <div className="muted">Эра/эпоха: {calendar.era}</div>}
          <div>
            <strong>Месяцы: </strong>
            {calendar.months.length > 0
              ? calendar.months.map((m) => `${m.name} (${m.days})`).join(", ")
              : "не заданы"}
          </div>
          <div>
            <strong>Дни недели: </strong>
            {calendar.weekdays.length > 0 ? calendar.weekdays.map((w) => w.name).join(", ") : "не заданы"}
          </div>
        </div>
        <div className="card">
          <h3>Предпросмотр</h3>
          <InworldCalendar
            months={calendar.months}
            weekdays={calendar.weekdays}
            items={items ?? []}
            importantDates={importantDates}
            pinned={pinned}
            onPin={onPin}
            onDayContextMenu={onDayContextMenu}
            onItemContextMenu={onItemContextMenu}
          />
        </div>
        <span className="muted">
          Правый клик по дню — создать событие; по событию — редактировать или удалить.
        </span>
      </div>
    );
  }

  return (
    <div className="card stack">
      <h3>Календарь сеттинга</h3>
      <span className="muted">
        Свои месяцы (с числом дней в каждом) и дни недели — чтобы проставлять сессиям и событиям
        игровую дату, а не только реальную.
      </span>
      <label className="stack" style={{ gap: 4 }}>
        Эра/эпоха (необязательно, добавляется после года — например «Эра Пепла»)
        <input value={era} onChange={(e) => setEra(e.target.value)} />
      </label>

      <div className="stack">
        <strong>Месяцы</strong>
        {months.map((m, i) => (
          <div key={i} className="row">
            <input
              placeholder="Название месяца"
              value={m.name}
              onChange={(e) =>
                setMonths((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <input
              type="number"
              style={{ width: 90 }}
              placeholder="Дней"
              value={m.days}
              onChange={(e) =>
                setMonths((prev) =>
                  prev.map((x, j) => (j === i ? { ...x, days: Number(e.target.value) || 0 } : x))
                )
              }
            />
            <button className="danger" onClick={() => setMonths((prev) => prev.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => setMonths((prev) => [...prev, { name: "", days: 30 }])} style={{ alignSelf: "flex-start" }}>
          + Добавить месяц
        </button>
        {months.length === 0 && <span className="muted">Месяцы пока не заданы.</span>}
      </div>

      <div className="stack">
        <strong>Дни недели</strong>
        {weekdays.map((w, i) => (
          <div key={i} className="row">
            <input
              placeholder="Название дня недели"
              value={w.name}
              onChange={(e) =>
                setWeekdays((prev) => prev.map((x, j) => (j === i ? { name: e.target.value } : x)))
              }
            />
            <button className="danger" onClick={() => setWeekdays((prev) => prev.filter((_, j) => j !== i))}>
              ✕
            </button>
          </div>
        ))}
        <button onClick={() => setWeekdays((prev) => [...prev, { name: "" }])} style={{ alignSelf: "flex-start" }}>
          + Добавить день недели
        </button>
        {weekdays.length === 0 && <span className="muted">Дни недели пока не заданы.</span>}
      </div>

      <div className="row">
        <button className="primary" onClick={save}>
          Сохранить
        </button>
        <button onClick={() => setEditing(false)}>Отмена</button>
      </div>
    </div>
  );
}
