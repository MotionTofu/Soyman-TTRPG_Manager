import { useEffect, useState } from "react";
import { api } from "../../api/client";
import { Modal } from "../Modal";
import { LocationCascadePicker } from "../LocationCascadePicker";
import { ENTITY_TYPES, ENTITY_TYPE_SINGULAR } from "../../entityTypes";
import { CREATABLE_BEING_CATEGORIES } from "../../beingCategories";
import type { BeingCategory, Setting, SettingCommunity, SettingLocation } from "../../types";

interface PickResult {
  type: string;
  id: number;
  title: string;
}

interface SearchHit extends PickResult {
  subtitle?: string;
  context?: string;
}

// "Продвинутое упоминание": opens instead of the old inline @-dropdown.
// Search + type filter (same filter UI as the search panel) + an editable
// "как отображается" label, plus a "Создать новую сущность" flow that can
// mint a Location/Being/Community/Artifact in a chosen Setting without
// leaving the textarea. Location creation can nest under a parent location;
// Being creation can set its habitat location + faction(s) right away.
const CREATE_TYPES: { key: "location" | "being" | "community" | "artifact"; label: string }[] = [
  { key: "location", label: "Локация" },
  { key: "being", label: "Существо" },
  { key: "community", label: "Фракция (сообщество)" },
  { key: "artifact", label: "Артефакт" },
];

// Splits a list into rows of 2 for the faction/community checkbox table.
function chunkPairs<T>(items: T[]): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += 2) rows.push(items.slice(i, i + 2));
  return rows;
}

export function MentionPickerModal({
  initialQuery,
  defaultSettingId,
  onPick,
  onClose,
}: {
  initialQuery: string;
  defaultSettingId?: number;
  onPick: (result: PickResult) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => new Set(ENTITY_TYPES.map((t) => t.key)));
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [results, setResults] = useState<SearchHit[]>([]);
  const [selected, setSelected] = useState<PickResult | null>(null);
  const [label, setLabel] = useState("");

  const [creating, setCreating] = useState(false);
  const [settings, setSettings] = useState<Setting[]>([]);
  const [createSettingId, setCreateSettingId] = useState<number | "">("");
  const [createType, setCreateType] = useState<(typeof CREATE_TYPES)[number]["key"]>("location");
  const [createName, setCreateName] = useState("");
  const [createBusy, setCreateBusy] = useState(false);

  // Only fetched when relevant (location parent picker / being habitat &
  // faction pickers), scoped to whichever setting is currently selected.
  const [createLocations, setCreateLocations] = useState<SettingLocation[]>([]);
  const [createCommunities, setCreateCommunities] = useState<SettingCommunity[]>([]);
  const [createParentLocationId, setCreateParentLocationId] = useState<number | null>(null);
  const [createBeingLocationId, setCreateBeingLocationId] = useState<number | null>(null);
  const [createBeingCommunityIds, setCreateBeingCommunityIds] = useState<number[]>([]);
  const [createBeingCategory, setCreateBeingCategory] = useState<BeingCategory>("key_figure");

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const handle = setTimeout(async () => {
      const types = Array.from(activeTypes).join(",");
      const res = await api.get<SearchHit[]>(`/search?q=${encodeURIComponent(query)}&types=${types}`);
      setResults(res);
    }, 200);
    return () => clearTimeout(handle);
  }, [query, activeTypes]);

  useEffect(() => {
    if (!creating || !createSettingId) return;
    if (createType === "location" || createType === "being") {
      api.get<SettingLocation[]>(`/setting-locations?setting_id=${createSettingId}`).then(setCreateLocations);
    }
    if (createType === "being") {
      api.get<SettingCommunity[]>(`/setting-communities?setting_id=${createSettingId}`).then(setCreateCommunities);
    }
  }, [creating, createSettingId, createType]);

  function toggleType(key: string) {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleBeingCommunity(id: number) {
    setCreateBeingCommunityIds((prev) =>
      prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]
    );
  }

  function choose(result: PickResult) {
    setSelected(result);
    setLabel(result.title);
  }

  function openCreate() {
    if (settings.length === 0) api.get<Setting[]>("/settings").then(setSettings);
    setCreateSettingId(defaultSettingId ?? "");
    setCreateName(query);
    setCreateParentLocationId(null);
    setCreateBeingLocationId(null);
    setCreateBeingCommunityIds([]);
    setCreateBeingCategory("key_figure");
    setCreating(true);
  }

  async function createEntity() {
    if (!createSettingId || !createName.trim()) return;
    setCreateBusy(true);
    try {
      let created: { id: number; name: string };
      if (createType === "artifact") {
        const form = new FormData();
        form.append("setting_id", String(createSettingId));
        form.append("name", createName.trim());
        created = await api.post<{ id: number; name: string }>("/artifacts", form);
      } else if (createType === "location") {
        created = await api.post<{ id: number; name: string }>("/setting-locations", {
          setting_id: createSettingId,
          name: createName.trim(),
          parent_id: createParentLocationId || null,
        });
      } else if (createType === "being") {
        created = await api.post<{ id: number; name: string }>("/setting-beings", {
          setting_id: createSettingId,
          name: createName.trim(),
          category: createBeingCategory,
          location_id: createBeingLocationId || null,
          community_ids: createBeingCommunityIds,
        });
      } else {
        created = await api.post<{ id: number; name: string }>("/setting-communities", {
          setting_id: createSettingId,
          name: createName.trim(),
        });
      }
      choose({ type: createType, id: created.id, title: created.name });
      setCreating(false);
    } finally {
      setCreateBusy(false);
    }
  }

  return (
    <Modal onClose={onClose} closeOnBackdropClick={false}>
      <div className="stack mention-picker-modal">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>{creating ? "Новая сущность" : "Упоминание"}</h3>
          {!creating && (
            <button type="button" onClick={onClose} title="Закрыть">
              ✕
            </button>
          )}
        </div>

        {!creating ? (
          <>
            <input
              autoFocus
              placeholder="Что упоминаем…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="row">
              <button
                type="button"
                className={filtersOpen ? "active-sort" : ""}
                onClick={() => setFiltersOpen((v) => !v)}
              >
                Фильтры
              </button>
            </div>
            {filtersOpen && (
              <>
                <div className="row">
                  <button
                    type="button"
                    onClick={() => setActiveTypes(new Set(ENTITY_TYPES.map((t) => t.key)))}
                  >
                    Выбрать всё
                  </button>
                  <button type="button" onClick={() => setActiveTypes(new Set())}>
                    Сбросить фильтры
                  </button>
                </div>
                <div className="filters">
                  {ENTITY_TYPES.map((t) => (
                    <label key={t.key}>
                      <input
                        type="checkbox"
                        checked={activeTypes.has(t.key)}
                        onChange={() => toggleType(t.key)}
                      />
                      {t.label}
                    </label>
                  ))}
                </div>
              </>
            )}
            <div className="stack mention-picker-results">
              {query.trim() && results.length === 0 && <span className="muted">Ничего не найдено</span>}
              {results.map((r) => (
                <div
                  key={`${r.type}:${r.id}`}
                  className={`search-result${selected?.type === r.type && selected.id === r.id ? " active-sort" : ""}`}
                  onClick={() => choose(r)}
                  style={{ cursor: "pointer" }}
                >
                  <div className="row" style={{ gap: 6, alignItems: "center" }}>
                    <div className={`entity-type-chip ${r.type}`}>{ENTITY_TYPE_SINGULAR[r.type] ?? r.type}</div>
                    {r.context && <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>{r.context}</span>}
                  </div>
                  <div>{r.title}</div>
                  {r.subtitle && <div className="muted">{r.subtitle}</div>}
                </div>
              ))}
            </div>
            <button type="button" onClick={openCreate} style={{ alignSelf: "flex-start" }}>
              + Создать новую сущность
            </button>
            {selected && (
              <div className="stack" style={{ borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                <label>
                  Как отображается
                  <input value={label} onChange={(e) => setLabel(e.target.value)} />
                </label>
                <div className="row">
                  <button
                    type="button"
                    className="primary"
                    onClick={() => onPick({ ...selected, title: label.trim() || selected.title })}
                  >
                    Вставить упоминание
                  </button>
                  <button type="button" onClick={() => setSelected(null)}>
                    Отмена
                  </button>
                </div>
              </div>
            )}
          </>
        ) : (
          <>
            <label>
              Сеттинг
              <select
                value={createSettingId}
                onChange={(e) => setCreateSettingId(e.target.value ? Number(e.target.value) : "")}
              >
                <option value="">— выберите сеттинг —</option>
                {settings.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Тип
              <select value={createType} onChange={(e) => setCreateType(e.target.value as typeof createType)}>
                {CREATE_TYPES.map((t) => (
                  <option key={t.key} value={t.key}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Название
              <input value={createName} onChange={(e) => setCreateName(e.target.value)} />
            </label>
            {createType === "location" && createSettingId && (
              <details>
                <summary>Вложена в (необязательно)</summary>
                <LocationCascadePicker
                  locations={createLocations}
                  value={createParentLocationId}
                  onChange={setCreateParentLocationId}
                />
              </details>
            )}
            {createType === "being" && createSettingId && (
              <>
                <label>
                  Категория
                  <select
                    value={createBeingCategory}
                    onChange={(e) => setCreateBeingCategory(e.target.value as BeingCategory)}
                  >
                    {CREATABLE_BEING_CATEGORIES.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </label>
                <details>
                  <summary>Место обитания (необязательно)</summary>
                  <LocationCascadePicker
                    locations={createLocations}
                    value={createBeingLocationId}
                    onChange={setCreateBeingLocationId}
                  />
                </details>
                <details>
                  <summary>Фракция / сообщество (необязательно)</summary>
                  {createCommunities.length === 0 ? (
                    <span className="muted">В сеттинге ещё нет сообществ.</span>
                  ) : (
                    <table className="mention-picker-community-table">
                      <tbody>
                        {chunkPairs(createCommunities).map((pair, i) => (
                          <tr key={i}>
                            {pair.map((c) => (
                              <td key={c.id}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={createBeingCommunityIds.includes(c.id)}
                                    onChange={() => toggleBeingCommunity(c.id)}
                                  />
                                  {c.name}
                                </label>
                              </td>
                            ))}
                            {pair.length === 1 && <td />}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </details>
              </>
            )}
            <div className="row">
              <button
                type="button"
                className="primary"
                onClick={createEntity}
                disabled={createBusy || !createSettingId || !createName.trim()}
              >
                {createBusy ? "Создаю…" : "Создать"}
              </button>
              <button type="button" onClick={() => setCreating(false)}>
                Отмена
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
