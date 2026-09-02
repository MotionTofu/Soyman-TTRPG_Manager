import { memo, useEffect, useState } from "react";
import { loadDndEquipmentEntries } from "./dndCompendium";
import type { CompendiumEntry } from "../../types";

// Стартовый набор класса или предыстории — ссылками на записи раздела
// «Снаряжение», а не строкой. Строка остаётся рядом как человекочитаемое
// описание (и как единственное место, где живёт то, чего в компендиуме ещё
// нет), а ссылки нужны, чтобы «взять набор» могло положить вещи в инвентарь.

export interface StartingEquipmentPick {
  entryId: number;
  name: string;
  qty: number;
}

export const StartingEquipmentPicker = memo(function StartingEquipmentPicker({
  systemId,
  items,
  gold,
  hasText,
  onChange,
}: {
  systemId: number;
  items: StartingEquipmentPick[];
  gold: string;
  hasText?: boolean;
  onChange: (patch: { items?: StartingEquipmentPick[]; gold?: string }) => void;
}) {
  const [options, setOptions] = useState<CompendiumEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!adding || options.length > 0) return;
    loadDndEquipmentEntries(systemId).then(setOptions);
  }, [adding, systemId, options.length]);

  const safeItems = items ?? [];
  // S-26: поиск по searchableText (имя+оригинал+алиасы) как у MonsterSection
  const filtered = query.trim()
    ? options.filter((o) => {
        const hay = [o.name ?? "", (o as unknown as { name_original?: string }).name_original ?? "", ...((o as unknown as { aliases?: string[] }).aliases ?? [])].join(" ").toLowerCase();
        return hay.includes(query.trim().toLowerCase());
      })
    : options;

  function add(entry: CompendiumEntry) {
    setAdding(false);
    setQuery("");
    // Повторное добавление того же предмета увеличивает количество, а не
    // плодит вторую строку.
    const existing = safeItems.find((i) => i.entryId === entry.id);
    onChange({
      items: existing
        ? safeItems.map((i) => (i.entryId === entry.id ? { ...i, qty: i.qty + 1 } : i))
        : [...safeItems, { entryId: entry.id, name: entry.name, qty: 1 }],
    });
  }

  return (
    <div className="litm-tag-row dnd-effect-row">
      {safeItems.map((item) => (
        <span key={item.entryId} className="litm-tag dnd-check-chip">
          <span className="dnd-effect-chip-fields">
            <input
              type="number"
              min={1}
              className="dnd-effect-dc"
              value={item.qty}
              onChange={(e) =>
                onChange({
                  items: safeItems.map((i) =>
                    i.entryId === item.entryId ? { ...i, qty: Math.max(1, Number(e.target.value) || 1) } : i
                  ),
                })
              }
            />
            <span>{item.name}</span>
          </span>
          <button
            type="button"
            title="Убрать предмет"
            onClick={() => onChange({ items: safeItems.filter((i) => i.entryId !== item.entryId) })}
          >
            −
          </button>
        </span>
      ))}

      {adding ? (
        <div className="dnd-spell-add">
          <input
            autoFocus
            placeholder="Название предмета…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") setAdding(false);
            }}
          />
          {filtered.length > 0 && (
            <div className="mention-dropdown">
              {filtered.slice(0, 8).map((o) => (
                <div
                  key={o.id}
                  className="mention-dropdown-item"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    add(o);
                  }}
                >
                  {o.name}
                </div>
              ))}
            </div>
          )}
          <button type="button" onClick={() => setAdding(false)}>
            Отмена
          </button>
        </div>
      ) : (
        <span className="litm-tag litm-tag-add dnd-effect-add">
          <span className="muted">добавить предмет</span>
          <button type="button" onClick={() => setAdding(true)}>
            +
          </button>
        </span>
      )}

      <span className="litm-tag dnd-cost-chip">
        <span className="dnd-effect-chip-fields">
          <input
            type="number"
            className="dnd-effect-dc"
            placeholder="0"
            value={gold}
            onChange={(e) => onChange({ gold: e.target.value })}
          />
          <span className="muted">ЗМ</span>
        </span>
      </span>
      {safeItems.length === 0 && !adding && (
        <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>
          {hasText ? "Есть текст набора — свяжите предметы, чтобы работал «Взять набор»" : "Ничего не связано — набор существует только текстом"}
        </span>
      )}
    </div>
  );
});
