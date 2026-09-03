import { memo, useState, useEffect } from "react";
import type { LitMPower, LitMThemeCard } from "../../types";
import { TagList } from "./TagList";
import { TrackGroup } from "./TrackGroup";
import { api } from "../../api/client";
import type { CompendiumEntry } from "../../types";
import { TreasurePickerModal } from "./TreasurePickerModal";
import { MagicWayPickerModal } from "./MagicWayPickerModal";

const POWER_LABELS: Record<LitMPower, string> = {
  "": "",
  origin: "Origin",
  adventure: "Adventure",
  greatness: "Greatness",
  // Ступень «Могущества» у темы Магического пути: её выбирает не игрок, а сама
  // тема (см. handleMagicWayPick). Ключ был во всём остальном коде — в типе
  // LitMPower, в POWER_CLASS, в .litm-power-variable, — и только здесь его не
  // было: подпись у такой темы выходила пустой.
  variable: "Variable",
};
const POWER_CLASS: Record<LitMPower, string> = {
  "": "",
  origin: "litm-power-origin",
  adventure: "litm-power-adventure",
  greatness: "litm-power-greatness",
  variable: "litm-power-variable",
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

/** Модалка выбора набора темы (theme_kit) */
function ThemeKitPicker({
  isOpen,
  onClose,
  onPick,
  themeTypeFilter,
}: {
  isOpen: boolean;
  onClose: () => void;
  onPick: (kit: CompendiumEntry) => void;
  themeTypeFilter?: string; // optional filter by themebook type (e.g. "Personality")
}): React.ReactElement | null {
  // Хуки идут до любого возврата: `if (!isOpen) return null` стоял выше них,
  // и при открытии модалки число хуков менялось между рендерами. Закрытая
  // модалка теперь тоже проходит через хуки, но ничего не грузит — за это
  // отвечает ранний выход внутри эффекта.
  const [kits, setKits] = useState<CompendiumEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    async function load() {
      try {
        const systems = await api.get<{ id: number; name: string }[]>("/systems");
        const litm = systems.find(s => s.name === "Legend in the Mist");
        if (!litm) return;
        const sections = await api.get<{ id: number; name: string; kind: string }[]>(`/systems/${litm.id}/sections`);
        const sec = sections.find(s => s.name === "Могущество и Темы");
        if (!sec) return;
        const entries = await api.get<CompendiumEntry[]>(`/systems/${litm.id}/entries?section_id=${sec.id}`);
        const filtered = entries
          .filter(e => e.kind === "theme_kit")
          .filter(e => !themeTypeFilter || e.parent_id === getThemebookId(entries, themeTypeFilter));
        setKits(filtered);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [themeTypeFilter, isOpen]);

  function getThemebookId(entries: CompendiumEntry[], themebookEn: string): number | null {
    const tb = entries.find(e => e.kind === "themebook" && e.name.includes(`[${themebookEn}]`));
    return tb?.id ?? null;
  }

  const filtered = kits.filter(k => 
    k.name.toLowerCase().includes(search.toLowerCase()) ||
    (k.data.powerTags as string[] | undefined)?.some(t => t.toLowerCase().includes(search.toLowerCase()))
  );

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ maxWidth: 700, maxHeight: "80vh", overflow: "auto" }} onClick={e => e.stopPropagation()}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <h3>Выбрать набор темы</h3>
          <button onClick={onClose}>✕</button>
        </div>
        <input
          placeholder="Поиск по названию или тегам…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{ width: "100%", marginBottom: 12, padding: "6px 10px", border: "1.5px solid var(--ink)", background: "var(--paper)" }}
        />
        {loading ? (
          <div className="muted">Загрузка…</div>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(260px, 1fr))", gap: 10 }}>
            {filtered.map(kit => (
              <button
                key={kit.id}
                onClick={() => { onPick(kit); onClose(); }}
                style={{
                  textAlign: "left", cursor: "pointer",
                  border: "2px solid var(--ink)", background: "var(--paper)",
                  padding: 12, borderRadius: 0, fontFamily: "inherit",
                }}
              >
                <div className="litm-theme-subtitle" style={{ fontSize: "var(--fs-meta)", marginBottom: 6 }}>
                  {kit.name.split(" [")[1]?.replace("]", "") ?? ""}
                </div>
                <div style={{ fontWeight: "bold", fontSize: "var(--fs-meta)", marginBottom: 8 }}>
                  {kit.name.split(" [")[0]}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: "var(--fs-meta)" }}>
                  {(kit.data.powerTags as string[] | undefined)?.slice(0, 3).map(t => (
                    <span key={t} className="tg tg-pow" style={{ fontSize: "var(--fs-micro)" }}>{t}</span>
                  ))}
                  {(kit.data.weaknessTags as string[] | undefined)?.slice(0, 2).map(t => (
                    <span key={t} className="tg tg-weak" style={{ fontSize: "var(--fs-micro)" }}>{t}</span>
                  ))}
                </div>
                {(kit.data.quest as string | undefined) && (
                  <div className="muted" style={{ fontSize: "var(--fs-meta)", marginTop: 6 }}>
                    {String(kit.data.quest).slice(0, 60)}…
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
    if (!confirm("Вы уверены, что хотите удалить ЭТО?")) return;
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
  const [showKitPicker, setShowKitPicker] = useState(false);
  const [kitPickerFilter, setKitPickerFilter] = useState<string | undefined>(value.themeType || undefined);
  const [showTreasurePicker, setShowTreasurePicker] = useState(false);
  const [showMagicWayPicker, setShowMagicWayPicker] = useState(false);

  function handleKitPick(kit: CompendiumEntry) {
    const pt = (kit.data.powerTags as string[] | undefined) ?? [];
    const wt = (kit.data.weaknessTags as string[] | undefined) ?? [];
    const q = (kit.data.quest as string | undefined) ?? "";
    const might = (kit.data.might as string | undefined) ?? "";
    const name = kit.name.split(" [")[0];
    const themeType = kit.name.split(" [")[1]?.replace("]", "") ?? "";
    
    onChange({
      ...value,
      name,
      themeType,
      power: (might || value.power) as LitMPower,
      powerTags: pt.length ? pt : value.powerTags,
      weaknessTags: wt.length ? wt : value.weaknessTags,
      quest: q || value.quest,
    });
    setShowKitPicker(false);
  }

  function handleTreasurePick(treasure: any) {
    const tags = (treasure.data?.tags ?? treasure.tags ?? []) as string[];
    const name = treasure.name;
    
    onChange({
      ...value,
      name,
      powerTags: tags.length ? tags : value.powerTags,
    });
    setShowTreasurePicker(false);
  }

  function handleMagicWayPick(magicWay: any) {
    const name = magicWay.name;
    
    onChange({
      ...value,
      name,
      themeType: "Magic",
      power: "variable",
    });
    setShowMagicWayPicker(false);
  }

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
      <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
        <label style={{ flex: 1 }}>
          Тип темы
          <input
            value={value.themeType}
            onChange={(e) => onChange({ ...value, themeType: e.target.value })}
          />
        </label>
        <button
          type="button"
          onClick={() => { setKitPickerFilter(value.themeType || undefined); setShowKitPicker(true); }}
          style={{ padding: "6px 12px", border: "1.5px solid var(--ink)", background: "transparent", cursor: "pointer" }}
        >
          Из наборов…
        </button>
        <button
          type="button"
          onClick={() => setShowTreasurePicker(true)}
          style={{ padding: "6px 12px", border: "1.5px solid var(--ink)", background: "transparent", cursor: "pointer" }}
        >
          Из сокровищницы
        </button>
        <button
          type="button"
          onClick={() => setShowMagicWayPicker(true)}
          style={{ padding: "6px 12px", border: "1.5px solid var(--ink)", background: "transparent", cursor: "pointer" }}
        >
          Путь магии
        </button>
      </div>
      <ThemeKitPicker
        isOpen={showKitPicker}
        onClose={() => setShowKitPicker(false)}
        onPick={handleKitPick}
        themeTypeFilter={kitPickerFilter}
      />
      <TreasurePickerModal
        isOpen={showTreasurePicker}
        onClose={() => setShowTreasurePicker(false)}
        onPick={handleTreasurePick}
      />
      <MagicWayPickerModal
        isOpen={showMagicWayPicker}
        onClose={() => setShowMagicWayPicker(false)}
        onPick={handleMagicWayPick}
      />
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
