import { useEffect, useState } from "react";
import { api } from "../api/client";
import { useConfirm } from "../hooks/useConfirm";
import type { SettingCalendar, SettingCalendarEra, SettingCalendarTimeline } from "../types";

interface Props {
  settingId: number;
}

export function SettingCalendarSettings({ settingId }: Props) {
  const [calendar, setCalendar] = useState<SettingCalendar | null>(null);
  const [editing, setEditing] = useState(false);
  const [months, setMonths] = useState<{ name: string; days: number }[]>([]);
  const [weekdays, setWeekdays] = useState<{ name: string }[]>([]);
  const [era, setEra] = useState("");
  const [confirmDialog, confirm] = useConfirm();

  const [eras, setEras] = useState<SettingCalendarEra[]>([]);
  const [timelines, setTimelines] = useState<SettingCalendarTimeline[]>([]);
  const [eraName, setEraName] = useState("");
  const [eraStartYear, setEraStartYear] = useState("");
  const [eraTimelineId, setEraTimelineId] = useState<number | null>(null);

  function refresh() {
    api.get<SettingCalendar>(`/settings/${settingId}/calendar`).then((c) => {
      setCalendar(c);
      setMonths(c.months.map((m) => ({ name: m.name, days: m.days })));
      setWeekdays(c.weekdays.map((w) => ({ name: w.name })));
      setEra(c.era);
    });
    api.get<SettingCalendarEra[]>(`/settings/${settingId}/calendar-eras`).then(setEras);
    api.get<SettingCalendarTimeline[]>(`/settings/${settingId}/calendar-timelines`).then(setTimelines);
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

  async function createEra() {
    if (!eraName.trim()) return;
    await api.post(`/settings/${settingId}/calendar-eras`, {
      name: eraName.trim(),
      start_year: Number(eraStartYear) || 1,
      timeline_id: eraTimelineId,
    });
    setEraName("");
    setEraStartYear("");
    setEraTimelineId(null);
    refresh();
  }

  async function deleteEra(id: number) {
    if (!await confirm("Удалить эпоху?")) return;
    await api.del(`/settings/${settingId}/calendar-eras/${id}`);
    refresh();
  }

  return (
    <div className="stack">
      {/* === Календарь (месяцы/дни/эра текстом) === */}
      {!editing ? (
        <div className="card stack">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>Календарь</h3>
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
      ) : (
        <div className="card stack">
          <h3 style={{ margin: 0 }}>Календарь</h3>
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
                <button
                  className="danger"
                  onClick={async () => {
                    if (!await confirm("Вы уверены, что хотите удалить ЭТО?")) return;
                    setMonths((prev) => prev.filter((_, j) => j !== i));
                  }}
                >
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
                <button
                  className="danger"
                  onClick={async () => {
                    if (!await confirm("Вы уверены, что хотите удалить ЭТО?")) return;
                    setWeekdays((prev) => prev.filter((_, j) => j !== i));
                  }}
                >
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
            <button className="primary" onClick={save}>Сохранить</button>
            <button onClick={() => setEditing(false)}>Отмена</button>
          </div>
        </div>
      )}

      {/* === Эпохи === */}
      <div className="card stack">
        <h3 style={{ margin: 0 }}>Эпохи</h3>
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          Периоды времени с определённым началом. Отображаются на оси времени как цветные полосы.
        </span>
        {eras.length > 0 && (
          <div className="stack" style={{ gap: 4 }}>
            {eras.sort((a, b) => a.start_year - b.start_year).map((e) => {
              const tl = timelines.find((t) => t.id === e.timeline_id);
              return (
                <div key={e.id} className="row" style={{ justifyContent: "space-between" }}>
                  <span><strong>{e.name}</strong> <span className="muted">({e.start_year}){tl ? ` — ${tl.name}` : ""}</span></span>
                  <button className="comp-mini danger" onClick={() => deleteEra(e.id)} title="Удалить">✕</button>
                </div>
              );
            })}
          </div>
        )}
        {eras.length === 0 && <p className="muted">Эпох пока нет.</p>}
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <input placeholder="Название эпохи" value={eraName} onChange={(e) => setEraName(e.target.value)} />
          <input type="number" placeholder="Год начала" style={{ width: 110 }} value={eraStartYear} onChange={(e) => setEraStartYear(e.target.value)} />
          <select value={eraTimelineId ?? ""} onChange={(e) => setEraTimelineId(e.target.value ? Number(e.target.value) : null)}>
            <option value="">Без таймлайна</option>
            {timelines.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
          <button className="primary" onClick={createEra}>Добавить</button>
        </div>
      </div>
      {confirmDialog}
    </div>
  );
}
