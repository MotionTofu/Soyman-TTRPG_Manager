import { useState, useEffect } from "react";
import type { LitMPower, LitMThemeCard } from "../../types";
import { TreasurePickerModal } from "./TreasurePickerModal";
import { MagicWayPickerModal } from "./MagicWayPickerModal";
import { useConfirm } from "../../hooks/useConfirm";
import { findLitmSystemId, loadLitmThemeKits, type LitmThemeKit, type LitmTreasure } from "./litmCompendium";

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
  onPick: (kit: LitmThemeKit) => void;
  themeTypeFilter?: string; // optional filter by themebook type (e.g. "Personality"); «Magic» — и наборы путей
}): React.ReactElement | null {
  // Хуки идут до любого возврата: `if (!isOpen) return null` стоял выше них,
  // и при открытии модалки число хуков менялось между рендерами. Закрытая
  // модалка теперь тоже проходит через хуки, но ничего не грузит — за это
  // отвечает ранний выход внутри эффекта.
  const [kits, setKits] = useState<LitmThemeKit[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!isOpen) return;
    async function load() {
      try {
        const systemId = await findLitmSystemId();
        if (!systemId) return;
        const all = await loadLitmThemeKits(systemId);
        setKits(all.filter(k => !themeTypeFilter || k.bookEn === themeTypeFilter || k.themebookEn === themeTypeFilter));
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [themeTypeFilter, isOpen]);

  const filtered = kits.filter(k => 
    k.name.toLowerCase().includes(search.toLowerCase()) ||
    k.data.powerTags?.some(t => t.toLowerCase().includes(search.toLowerCase()))
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
                  {kit.themebookEn}
                </div>
                <div style={{ fontWeight: "bold", fontSize: "var(--fs-meta)", marginBottom: 8 }}>
                  {kit.name}
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4, fontSize: "var(--fs-meta)" }}>
                  {kit.data.powerTags?.slice(0, 3).map(t => (
                    <span key={t} className="tg tg-pow" style={{ fontSize: "var(--fs-micro)" }}>{t}</span>
                  ))}
                  {kit.data.weaknessTags?.slice(0, 2).map(t => (
                    <span key={t} className="tg tg-weak" style={{ fontSize: "var(--fs-micro)" }}>{t}</span>
                  ))}
                </div>
                {kit.data.quest && (
                  <div className="muted" style={{ fontSize: "var(--fs-meta)", marginTop: 6 }}>
                    {(() => {
                      const q = String(kit.data.quest);
                      return q.length > 60 ? `${q.slice(0, 60).replace(/\s+\S*$/, "")}…` : q;
                    })()}
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

export function ImprovementsEdit({
  items,
  onChange,
}: {
  items: LitMThemeCard["specialImprovements"];
  onChange: (items: LitMThemeCard["specialImprovements"]) => void;
}) {
  const [confirmDialog, confirm] = useConfirm();
  function update(i: number, patch: { text: string; active: boolean }) {
    const list = items.slice();
    list[i] = patch;
    onChange(list);
  }
  function add() {
    onChange([...items, { text: "", active: true }]);
  }
  async function remove(i: number) {
    const text = items[i]?.text?.trim();
    if (!(await confirm({
      message: text ? `Удалить «${text}»?` : "Удалить эту строку?",
      confirmLabel: "Удалить",
      danger: true,
    }))) return;
    onChange(items.filter((_, idx) => idx !== i));
  }
  return (
    <div className="stack" style={{ gap: 4 }}>
      {confirmDialog}
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

/**
 * «Из набора · Из сокровищницы · Путь магии» для карты темы в правке листа
 * (лист LitM в «Д», доска Litm-Sheet-Edit): заполняют тему из справочника.
 */
export function ThemePickers({ value, onChange }: { value: LitMThemeCard; onChange: (v: LitMThemeCard) => void }) {
  const [kitOpen, setKitOpen] = useState(false);
  const [treasureOpen, setTreasureOpen] = useState(false);
  const [wayOpen, setWayOpen] = useState(false);

  function pickKit(kit: LitmThemeKit) {
    const pt = kit.data.powerTags ?? [];
    const wt = kit.data.weaknessTags ?? [];
    onChange({
      ...value,
      name: kit.name,
      // у набора пути магии тема героя — «Магия» (доска Litm-Way)
      themeType: kit.bookEn,
      power: (kit.data.might || value.power) as LitMPower,
      powerTags: pt.length ? pt : value.powerTags,
      weaknessTags: wt.length ? wt : value.weaknessTags,
      quest: kit.data.quest || value.quest,
    });
    setKitOpen(false);
  }
  function pickTreasure(treasure: LitmTreasure) {
    onChange({
      ...value,
      name: treasure.name,
      powerTags: treasure.powerTags.length ? treasure.powerTags : value.powerTags,
      weaknessTags: treasure.weakness ? [treasure.weakness] : value.weaknessTags,
    });
    setTreasureOpen(false);
  }
  function pickWay(way: { name: string }) {
    onChange({ ...value, name: way.name, themeType: "Magic", power: "variable" });
    setWayOpen(false);
  }

  return (
    <span className="lsh-pickers">
      <button type="button" onClick={() => setKitOpen(true)}>
        из набора…
      </button>
      <button type="button" onClick={() => setTreasureOpen(true)}>
        из сокровищницы
      </button>
      <button type="button" onClick={() => setWayOpen(true)}>
        путь магии
      </button>
      <ThemeKitPicker isOpen={kitOpen} onClose={() => setKitOpen(false)} onPick={pickKit} themeTypeFilter={value.themeType || undefined} />
      <TreasurePickerModal isOpen={treasureOpen} onClose={() => setTreasureOpen(false)} onPick={pickTreasure} />
      <MagicWayPickerModal isOpen={wayOpen} onClose={() => setWayOpen(false)} onPick={pickWay} />
    </span>
  );
}
