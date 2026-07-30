import { memo } from "react";
import type { LitMPower, LitMThemeCard } from "../../types";
import { TagList } from "./TagList";
import { TrackGroup } from "./TrackGroup";

const POWER_LABELS: Record<LitMPower, string> = {
  "": "",
  origin: "Origin",
  adventure: "Adventure",
  greatness: "Greatness",
};
const POWER_CLASS: Record<LitMPower, string> = {
  "": "",
  origin: "litm-power-origin",
  adventure: "litm-power-adventure",
  greatness: "litm-power-greatness",
};

export function emptyTheme(): LitMThemeCard {
  return {
    power: "",
    themeType: "",
    name: "",
    powerTags: [],
    weaknessTags: [],
    quest: "",
    improve: 0,
    abandon: 0,
    milestone: 0,
    specialImprovements: [],
  };
}

function ImprovementsEdit({
  items,
  onChange,
}: {
  items: LitMThemeCard["specialImprovements"];
  onChange: (items: LitMThemeCard["specialImprovements"]) => void;
}) {
  function update(i: number, patch: { text: string; active: boolean }) {
    const list = items.slice();
    list[i] = patch;
    onChange(list);
  }
  function add() {
    onChange([...items, { text: "", active: true }]);
  }
  function remove(i: number) {
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted">Особые улучшения темы</span>
      <ul className="litm-improvements">
        {items.map((imp, i) => (
          <li key={i} className="litm-improvement-row">
            <input
              type="checkbox"
              checked={imp.active}
              onChange={(e) => update(i, { ...imp, active: e.target.checked })}
            />
            <input
              className="litm-improvement-text"
              value={imp.text}
              onChange={(e) => update(i, { ...imp, text: e.target.value })}
            />
            <button type="button" onClick={() => remove(i)}>
              ✕
            </button>
          </li>
        ))}
      </ul>
      <button type="button" onClick={add} style={{ alignSelf: "flex-start" }}>
        + Добавить
      </button>
    </div>
  );
}

export const ThemeCardEdit = memo(function ThemeCardEdit({
  value,
  onChange,
  onRemove,
  headerColorClass,
  onMakeGroupTheme,
}: {
  value: LitMThemeCard;
  onChange: (v: LitMThemeCard) => void;
  onRemove?: () => void;
  headerColorClass?: string;
  onMakeGroupTheme?: () => void;
}) {
  return (
    <div className="card stack litm-theme-card">
      <div className={`litm-theme-header ${headerColorClass ?? POWER_CLASS[value.power]}`}>
        <div className="litm-theme-title-row">
          <input
            className="litm-theme-title"
            placeholder="Название темы"
            value={value.name}
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
          {onRemove && (
            <button type="button" onClick={onRemove}>
              ✕
            </button>
          )}
        </div>
        <div className="litm-theme-subtitle">
          {POWER_LABELS[value.power] || "—"}
          {value.themeType ? ` · ${value.themeType}` : ""}
        </div>
      </div>
      <label>
        Мощь
        <select
          value={value.power}
          onChange={(e) => onChange({ ...value, power: e.target.value as LitMPower })}
        >
          <option value="">—</option>
          <option value="origin">Origin</option>
          <option value="adventure">Adventure</option>
          <option value="greatness">Greatness</option>
        </select>
      </label>
      <label>
        Тип темы (впишите вручную)
        <input
          value={value.themeType}
          onChange={(e) => onChange({ ...value, themeType: e.target.value })}
        />
      </label>
      <div>
        <span className="muted">Ключи силы</span>
        <TagList
          tags={value.powerTags}
          variant="power"
          leadingChip={value.name || undefined}
          onChange={(tags) => onChange({ ...value, powerTags: tags })}
        />
      </div>
      <div>
        <span className="muted">Тэг слабости</span>
        <TagList
          tags={value.weaknessTags}
          variant="weak"
          onChange={(tags) => onChange({ ...value, weaknessTags: tags })}
        />
      </div>
      <label>
        Квест темы
        <input value={value.quest} onChange={(e) => onChange({ ...value, quest: e.target.value })} />
      </label>
      <TrackGroup
        tracks={[
          { label: "Improve", value: value.improve, onChange: (n) => onChange({ ...value, improve: n }) },
          { label: "Abandon", value: value.abandon, onChange: (n) => onChange({ ...value, abandon: n }) },
          { label: "Milestone", value: value.milestone, onChange: (n) => onChange({ ...value, milestone: n }) },
        ]}
      />
      <ImprovementsEdit
        items={value.specialImprovements}
        onChange={(items) => onChange({ ...value, specialImprovements: items })}
      />
      {onMakeGroupTheme && (
        <button type="button" onClick={onMakeGroupTheme} style={{ alignSelf: "flex-start" }}>
          Сделать общей командной темой
        </button>
      )}
    </div>
  );
});

export const ThemeCardView = memo(function ThemeCardView({
  value,
  onQuickUpdate,
  headerColorClass,
  onMakeGroupTheme,
}: {
  value: LitMThemeCard;
  onQuickUpdate: (v: LitMThemeCard) => void;
  headerColorClass?: string;
  onMakeGroupTheme?: () => void;
}) {
  return (
    <div className="card stack litm-theme-card">
      <div className={`litm-theme-header ${headerColorClass ?? POWER_CLASS[value.power]}`}>
        <div className="litm-theme-title-row">
          <strong className="litm-theme-title">{value.name || "Без названия"}</strong>
        </div>
        {value.power && (
          <div className="litm-theme-subtitle">
            {POWER_LABELS[value.power]}
            {value.themeType ? ` · ${value.themeType}` : ""}
          </div>
        )}
      </div>
      <div>
        <span className="muted">Ключи силы</span>
        <TagList
          tags={value.powerTags}
          variant="power"
          leadingChip={value.name || undefined}
          onChange={(tags) => onQuickUpdate({ ...value, powerTags: tags })}
        />
      </div>
      <div>
        <span className="muted">Тэг слабости</span>
        <TagList
          tags={value.weaknessTags}
          variant="weak"
          onChange={(tags) => onQuickUpdate({ ...value, weaknessTags: tags })}
        />
      </div>
      {value.quest && <div className="muted">Квест: {value.quest}</div>}
      <TrackGroup
        tracks={[
          { label: "Improve", value: value.improve, onChange: (n) => onQuickUpdate({ ...value, improve: n }) },
          { label: "Abandon", value: value.abandon, onChange: (n) => onQuickUpdate({ ...value, abandon: n }) },
          { label: "Milestone", value: value.milestone, onChange: (n) => onQuickUpdate({ ...value, milestone: n }) },
        ]}
      />
      {value.specialImprovements.some((imp) => imp.active) && (
        <ul className="litm-improvements">
          {value.specialImprovements
            .filter((imp) => imp.active)
            .map((imp, i) => (
              <li key={i}>{imp.text}</li>
            ))}
        </ul>
      )}
      {onMakeGroupTheme && (
        <button type="button" onClick={onMakeGroupTheme} style={{ alignSelf: "flex-start" }}>
          Сделать общей командной темой
        </button>
      )}
    </div>
  );
});
