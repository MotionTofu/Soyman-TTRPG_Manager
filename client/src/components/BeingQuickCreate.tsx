import { useState } from "react";
import { api } from "../api/client";
import { CREATABLE_BEING_CATEGORIES } from "../beingCategories";
import { LocationCascadePicker } from "./LocationCascadePicker";
import { Modal } from "./Modal";
import { MonsterTemplatePicker } from "./MonsterTemplatePicker";
import type { BeingCategory, SearchResult, SettingCommunity, SettingLocation } from "../types";

// Shared "add a new being right here" form used by Население (full picker
// set) and the embedded creation rows on a Location's "Обитатели" tab
// (location fixed, community picker shown) and a Community's
// "Представители" tab (community fixed, location picker shown).
export function BeingQuickCreate({
  settingId,
  locations,
  communities,
  fixedLocationId = null,
  fixedCommunityIds = [],
  showLocationPicker = false,
  showCommunityPicker = false,
  onCreated,
}: {
  settingId: number;
  locations?: SettingLocation[];
  communities?: SettingCommunity[];
  fixedLocationId?: number | null;
  fixedCommunityIds?: number[];
  showLocationPicker?: boolean;
  showCommunityPicker?: boolean;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<BeingCategory>("key_figure");
  const [locationId, setLocationId] = useState<number | null>(null);
  const [communityIds, setCommunityIds] = useState<Set<number>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [baseMonster, setBaseMonster] = useState<SearchResult | null>(null);

  function toggleCommunity(id: number) {
    setCommunityIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function create() {
    if (!name.trim()) return;
    await api.post("/setting-beings", {
      setting_id: settingId,
      name,
      category,
      location_id: showLocationPicker ? locationId : fixedLocationId,
      community_ids: [...fixedCommunityIds, ...(showCommunityPicker ? [...communityIds] : [])],
      base_monster_id: baseMonster?.id ?? null,
    });
    setName("");
    setLocationId(null);
    setCommunityIds(new Set());
    setBaseMonster(null);
    onCreated();
  }

  return (
    <div className="row">
      <input
        placeholder="Имя существа/персонажа"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && create()}
      />
      <select value={category} onChange={(e) => setCategory(e.target.value as BeingCategory)}>
        {CREATABLE_BEING_CATEGORIES.map((c) => (
          <option key={c.key} value={c.key}>
            {c.label}
          </option>
        ))}
      </select>
      <MonsterTemplatePicker value={baseMonster} onChange={setBaseMonster} />
      {showLocationPicker && (
        <LocationCascadePicker locations={locations ?? []} value={locationId} onChange={setLocationId} />
      )}
      {showCommunityPicker && (
        <button type="button" onClick={() => setPickerOpen(true)}>
          Сообщества{communityIds.size > 0 ? ` (${communityIds.size})` : ""}
        </button>
      )}
      <button className="primary" onClick={create}>
        Добавить
      </button>
      {pickerOpen && (
        <Modal onClose={() => setPickerOpen(false)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Сообщества</h3>
            {(communities ?? []).length === 0 ? (
              <p className="muted">В сеттинге ещё нет сообществ.</p>
            ) : (
              <div className="stack" style={{ gap: 4, maxHeight: 300, overflowY: "auto" }}>
                {(communities ?? []).map((c) => (
                  <label key={c.id} className="row" style={{ gap: 6 }}>
                    <input
                      type="checkbox"
                      checked={communityIds.has(c.id)}
                      onChange={() => toggleCommunity(c.id)}
                    />
                    {c.name}
                  </label>
                ))}
              </div>
            )}
            <button className="primary" onClick={() => setPickerOpen(false)}>
              Готово
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
