import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { CREATURE_SIZES, kindLabel, searchableText, VEHICLE_CATEGORIES } from "../compendium";
import { VehicleTileGrid, saveFavourite, type VehicleGrouping } from "./VehicleTileGrid";
import { NavIcon } from "./NavIcons";
import type { CompendiumEntry, SystemSection } from "../types";

type SortMode = "alpha" | "category" | "size";
type SortDir = "asc" | "desc";

interface Props {
  systemId: number;
  section: SystemSection;
}

// Транспорт вынесен из CompendiumSection плиткой (реструктуризация E1):
// своя форма — плитки вместо дерева записей, сортировки по категории/размеру
// и фильтры. Правка и посты экипажа живут на странице судна; из раздела —
// только «взять в бой».
export function VehicleSection({ systemId, section }: Props) {
  const [entries, setEntries] = useState<CompendiumEntry[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSize, setFilterSize] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const raw = localStorage.getItem(`compendium-sort-${section.id}`);
    const stored = raw?.split(":")[0] as SortMode | null;
    const valid: SortMode[] = ["alpha", "category", "size"];
    return stored && valid.includes(stored) ? stored : "alpha";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const raw = localStorage.getItem(`compendium-sort-${section.id}`);
    const dir = raw?.split(":")[1] as SortDir | undefined;
    return dir === "desc" ? "desc" : "asc";
  });

  function changeSortMode(mode: SortMode) {
    if (mode === sortMode) {
      setSortDir((prev) => {
        const next = prev === "asc" ? "desc" : "asc";
        localStorage.setItem(`compendium-sort-${section.id}`, `${mode}:${next}`);
        return next;
      });
    } else {
      setSortMode(mode);
      setSortDir("asc");
      localStorage.setItem(`compendium-sort-${section.id}`, `${mode}:asc`);
    }
  }

  function refresh() {
    api
      .get<CompendiumEntry[]>(`/systems/${systemId}/entries?section_id=${section.id}`)
      .then(setEntries);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(refresh, [systemId, section.id]);

  const vehicleFiltersActive =
    filterCategory !== "" || filterSize !== "" || searchQuery.trim() !== "";

  // Сортировку не трогает: её выбирают осознанно и надолго, а фильтры с
  // поиском — на один заход.
  function resetVehicleFilters() {
    setFilterCategory("");
    setFilterSize("");
    setSearchQuery("");
  }

  // Звезда пишется точечно и правит одну запись в состоянии. Колбэк обязан
  // быть стабильным — на нём держится memo плитки (находка 10.6: запросы на
  // одну плитку сериализуются цепочкой промисов).
  const favouriteChains = useRef(new Map<number, Promise<void>>());
  const toggleFavourite = useCallback(async (entry: CompendiumEntry, favourite: boolean) => {
    const prev = favouriteChains.current.get(entry.id) ?? Promise.resolve();
    const next = prev.then(async () => {
      setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, favourite } : e)));
      try {
        await saveFavourite(entry.id, favourite);
      } catch {
        // Откат только если пользователь не успел переключить снова.
        setEntries((cur) =>
          cur.map((e) =>
            e.id === entry.id && e.favourite === favourite ? { ...e, favourite: !favourite } : e
          )
        );
      }
    });
    favouriteChains.current.set(entry.id, next);
    try {
      await next;
    } finally {
      if (favouriteChains.current.get(entry.id) === next) favouriteChains.current.delete(entry.id);
    }
  }, []);

  const topLevel = useMemo(() => entries.filter((e) => e.parent_id == null), [entries]);

  // Результат обязан быть стабильным по ссылке: грид кэширует группы через
  // useMemo, и новый массив на каждый рендер сводил бы кэш к нулю.
  const filteredTopLevel = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return topLevel.filter((e) => {
      if (filterCategory !== "" && (e.data?.category as string | undefined) !== filterCategory)
        return false;
      if (filterSize !== "" && (e.data?.size as string | undefined) !== filterSize) return false;
      if (q && !searchableText(e).includes(q)) return false;
      return true;
    });
  }, [topLevel, searchQuery, filterCategory, filterSize]);

  // Плитки не редактируются в линии (правка на странице судна), поэтому
  // кнопка «Добавить» создаёт пустую запись.
  async function addVehicle() {
    await api.post<CompendiumEntry>(`/systems/${systemId}/entries`, {
      section_id: section.id,
      parent_id: null,
      kind: "vehicle",
      name: "",
      level: null,
      data: {},
      description: "",
    });
    refresh();
  }

  return (
    <div className="card stack">
      <div className="row sort-toggle" style={{ gap: 4 }}>
        <span className="muted">Сортировка:</span>
        <button
          className={sortMode === "alpha" ? "active-sort" : ""}
          onClick={() => changeSortMode("alpha")}
          title={sortMode === "alpha" ? (sortDir === "asc" ? "А-Я (повтор — Я-А)" : "Я-А (повтор — А-Я)") : "А-Я"}
        >
          {sortMode === "alpha" ? (sortDir === "asc" ? "А-Я ↑" : "Я-А ↓") : "А-Я"}
        </button>
        <button
          className={sortMode === "category" ? "active-sort" : ""}
          onClick={() => changeSortMode("category")}
        >
          По категории{sortMode === "category" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
        <button
          className={sortMode === "size" ? "active-sort" : ""}
          onClick={() => changeSortMode("size")}
        >
          По размеру{sortMode === "size" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
        </button>
      </div>
      <div className="row" style={{ gap: 4 }}>
        <input
          type="text"
          placeholder="Поиск по названию…"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          style={{ maxWidth: 260 }}
        />
        {searchQuery !== "" && (
          <button type="button" className="comp-mini" title="Очистить поиск" onClick={() => setSearchQuery("")}>
            <NavIcon name="close" />
          </button>
        )}
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <select value={filterCategory} onChange={(e) => setFilterCategory(e.target.value)}>
          <option value="">Все категории</option>
          {VEHICLE_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select value={filterSize} onChange={(e) => setFilterSize(e.target.value)}>
          <option value="">Все размеры</option>
          {CREATURE_SIZES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        {/* Кнопки нет, пока сбрасывать нечего (§1.11). */}
        {vehicleFiltersActive && (
          <button type="button" onClick={resetVehicleFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>
      <div className="comp-list">
        <VehicleTileGrid
          entries={filteredTopLevel}
          grouping={sortMode as VehicleGrouping}
          sortDir={sortDir}
          sectionId={section.id}
          searchActive={searchQuery.trim() !== ""}
          onToggleFavourite={toggleFavourite}
        />
        {topLevel.length === 0 && (
          <p className="muted">
            {searchQuery.trim() ? `Ничего не найдено по «${searchQuery.trim()}».` : "Пока пусто."}
          </p>
        )}
        {topLevel.length > 0 && filteredTopLevel.length === 0 && (
          <p className="muted">Ничего не найдено по фильтрам.</p>
        )}
      </div>
      <button style={{ alignSelf: "flex-start" }} onClick={addVehicle}>
        + Добавить {kindLabel("vehicle").toLowerCase()}
      </button>
    </div>
  );
}