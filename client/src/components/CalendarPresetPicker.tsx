import { useEffect, useState } from "react";
import { api } from "../api/client";

// Заготовка календаря при создании сеттинга.
//
// Пустой календарь — плохая точка старта: пока не заведены месяцы и дни
// недели, хроника мира не показывает ничего осмысленного, а завести их можно
// только руками. Две готовые системы закрывают большинство случаев, третья
// строится из трёх чисел.
//
// Эра — отдельная галочка, а не часть заготовки: григорианский календарь
// сплошь и рядом используют там, где счёт лет от рождества Христова не имеет
// смысла, и навязывать «н. э.» такому сеттингу неправильно.

export interface CalendarChoice {
  preset: string;
  withEra: boolean;
  months: number;
  daysPerMonth: number;
  weekdays: number;
}

export const EMPTY_CALENDAR: CalendarChoice = {
  preset: "none",
  withEra: false,
  months: 12,
  daysPerMonth: 30,
  weekdays: 7,
};

interface PresetInfo {
  key: string;
  label: string;
  hint: string;
  months: number;
  weekdays: number;
  era: string | null;
}

export function CalendarPresetPicker({
  value,
  onChange,
}: {
  value: CalendarChoice;
  onChange: (v: CalendarChoice) => void;
}) {
  const [presets, setPresets] = useState<PresetInfo[]>([]);
  useEffect(() => {
    api
      .get<PresetInfo[]>("/settings/calendar-presets")
      .then(setPresets)
      .catch(() => setPresets([]));
  }, []);

  const chosen = presets.find((p) => p.key === value.preset);
  const set = (patch: Partial<CalendarChoice>) => onChange({ ...value, ...patch });

  return (
    <div className="stack" style={{ gap: 6 }}>
      <label>
        Календарь
        <select value={value.preset} onChange={(e) => set({ preset: e.target.value })}>
          <option value="none">Не заводить — заполню сам</option>
          {presets.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
          <option value="custom">Собственный</option>
        </select>
      </label>

      {chosen && <span className="muted">{chosen.hint}</span>}

      {chosen?.era && (
        <label className="row">
          <input
            type="checkbox"
            checked={value.withEra}
            onChange={(e) => set({ withEra: e.target.checked })}
          />
          Добавить эру «{chosen.era}»
        </label>
      )}

      {value.preset === "custom" && (
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <label>
            Месяцев в году
            <input
              type="number"
              min={1}
              max={100}
              value={value.months}
              onChange={(e) => set({ months: Number(e.target.value) })}
            />
          </label>
          <label>
            Дней в месяце
            <input
              type="number"
              min={1}
              max={200}
              value={value.daysPerMonth}
              onChange={(e) => set({ daysPerMonth: Number(e.target.value) })}
            />
          </label>
          <label>
            Дней в неделе
            <input
              type="number"
              min={1}
              max={100}
              value={value.weekdays}
              onChange={(e) => set({ weekdays: Number(e.target.value) })}
            />
          </label>
        </div>
      )}

      {value.preset === "custom" && (
        <span className="muted">
          Месяцы и дни получат номерные названия — переименовать их можно в календаре сеттинга. В
          году выйдет {Math.max(1, value.months) * Math.max(1, value.daysPerMonth)} дней.
        </span>
      )}
    </div>
  );
}
