import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { CREATURE_SIZES, kindLabel, searchableText, VEHICLE_CATEGORIES } from "../compendium";
import { VehicleTileGrid, saveFavourite, type VehicleGrouping } from "./VehicleTileGrid";
import { NavIcon } from "./NavIcons";
import { EmptyState } from "./EmptyState";
import { useCurrentUser } from "../api/currentUser";
import { useCompendiumViewMode } from "../hooks/useCompendiumViewMode";
import { addToBag } from "../bag";
import { Link } from "react-router-dom";
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
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const sortKey = `compendium-sort-${user?.id ?? "anon"}-${section.id}`;
  const [viewMode, setViewMode] = useCompendiumViewMode(section.id, "grid");
  const [entries, setEntries] = useState<CompendiumEntry[]>([]);
  const [filterCategory, setFilterCategory] = useState("");
  const [filterSize, setFilterSize] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const raw = localStorage.getItem(`compendium-sort-${"anon"}-${section.id}`) ?? localStorage.getItem(`compendium-sort-${section.id}`);
    const stored = raw?.split(":")[0] as SortMode | null;
    const valid: SortMode[] = ["alpha", "category", "size"];
    return stored && valid.includes(stored) ? stored : "alpha";
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    const raw = localStorage.getItem(`compendium-sort-${"anon"}-${section.id}`) ?? localStorage.getItem(`compendium-sort-${section.id}`);
    const dir = raw?.split(":")[1] as SortDir | undefined;
    return dir === "desc" ? "desc" : "asc";
  });

  // Миграция и подхват ключа с userId после загрузки пользователя (R2)
  useEffect(() => {
    if (!user) return;
    const legacy = localStorage.getItem(`compendium-sort-${section.id}`);
    if (legacy && !localStorage.getItem(sortKey)) {
      try { localStorage.setItem(sortKey, legacy); } catch {}
    }
    const raw = localStorage.getItem(sortKey);
    if (!raw) return;
    const [m, d] = raw.split(":");
    const valid: SortMode[] = ["alpha", "category", "size"];
    if (valid.includes(m as SortMode)) setSortMode(m as SortMode);
    setSortDir(d === "desc" ? "desc" : "asc");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  function changeSortMode(mode: SortMode) {
    if (mode === sortMode) {
      setSortDir((prev) => {
        const next = prev === "asc" ? "desc" : "asc";
        localStorage.setItem(sortKey, `${mode}:${next}`);
        return next;
      });
    } else {
      setSortMode(mode);
      setSortDir("asc");
      localStorage.setItem(sortKey, `${mode}:asc`);
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
    filterCategory !== "" || filterSize !== "" || searchQuery.trim() !== "" || showFavOnly;

  // Сортировку не трогает: её выбирают осознанно и надолго, а фильтры с
  // поиском — на один заход.
  function resetVehicleFilters() {
    setFilterCategory("");
    setFilterSize("");
    setSearchQuery("");
    setShowFavOnly(false);
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
      if (showFavOnly && !e.favourite) return false;
      if (filterCategory !== "" && (e.data?.category as string | undefined) !== filterCategory)
        return false;
      if (filterSize !== "" && (e.data?.size as string | undefined) !== filterSize) return false;
      if (q && !searchableText(e).includes(q)) return false;
      return true;
    });
  }, [topLevel, searchQuery, filterCategory, filterSize, showFavOnly]);

  // Плитки не редактируются в линии (правка на странице судна) — после
  // создания сразу ведём в профиль, иначе в сетке остаётся сирота «Без названия».
  async function addVehicle() {
    const created = await api.post<CompendiumEntry>(`/systems/${systemId}/entries`, {
      section_id: section.id,
      parent_id: null,
      kind: "vehicle",
      name: "",
      level: null,
      data: {},
      description: "",
    });
    navigate(`/compendium/${created.id}`);
  }

  return (
    <div className="card stack">
      <div className="row sort-toggle" style={{ gap: 4, justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className="row" style={{ gap: 4, alignItems: "center" }}>
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
        </span>
        <span className="row" style={{ gap: 6, alignItems: "center" }}>
          <button type="button" className={viewMode === "grid" ? "active-sort" : ""} onClick={() => setViewMode("grid")} title="Плитками">▦ Плитки</button>
          <button type="button" className={viewMode === "list" ? "active-sort" : ""} onClick={() => setViewMode("list")} title="Списком">☰ Список</button>
        </span>
      </div>
      <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
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
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
          {filteredTopLevel.length} / {topLevel.length}
        </span>
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
        <button
          type="button"
          className={showFavOnly ? "active-sort" : ""}
          onClick={() => setShowFavOnly((v) => !v)}
          title={showFavOnly ? "Показать всех" : "Только избранное"}
        >
          <NavIcon name="star" filled={showFavOnly} /> {showFavOnly ? "Только избранное" : "Избранное"}
        </button>
        {/* Кнопки нет, пока сбрасывать нечего (§1.11). */}
        {vehicleFiltersActive && (
          <button type="button" onClick={resetVehicleFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>
      <div className="comp-list">
        {viewMode === "grid" ? (
          <VehicleTileGrid
            entries={filteredTopLevel}
            grouping={sortMode as VehicleGrouping}
            sortDir={sortDir}
            sectionId={section.id}
            searchActive={searchQuery.trim() !== ""}
            onToggleFavourite={toggleFavourite}
          />
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {filteredTopLevel.map((e) => (
              <VehicleListRow key={e.id} entry={e} onToggleFavourite={toggleFavourite} />
            ))}
          </div>
        )}
        {topLevel.length === 0 && (
          <EmptyState kind={searchQuery.trim() ? "search" : "primary"}
            title={searchQuery.trim() ? `Ничего по «${searchQuery.trim()}»` : "Транспорт пуст"}
            hint={searchQuery.trim() ? "Попробуйте другой запрос." : "Добавьте первое судно — оно появится здесь плитками."}
            action={<button className="primary" onClick={addVehicle}>+ Добавить транспорт</button>}
          />
        )}
        {topLevel.length > 0 && filteredTopLevel.length === 0 && (
          <EmptyState kind="search"
            title="Ничего не нашлось"
            hint="Попробуйте сбросить фильтры или поискать иначе."
            action={<button onClick={resetVehicleFilters}>Сбросить фильтры</button>}
          />
        )}
      </div>
      <button style={{ alignSelf: "flex-start" }} onClick={addVehicle}>
        + Добавить {kindLabel("vehicle").toLowerCase()}
      </button>
    </div>
  );
}

function VehicleListRow({ entry, onToggleFavourite }: { entry: CompendiumEntry; onToggleFavourite: (e: CompendiumEntry, f: boolean) => void }) {
  const favourite = !!entry.favourite;
  const cat = typeof entry.data?.category === "string" ? entry.data.category : "";
  const size = typeof entry.data?.size === "string" ? entry.data.size : "";
  const ac = (entry.data as Record<string, unknown>)?.ac != null ? String((entry.data as Record<string, unknown>).ac) : "";
  const hp = (entry.data as Record<string, unknown>)?.hp != null ? String((entry.data as Record<string, unknown>).hp) : "";
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", padding: "6px 8px", border: "1.5px solid var(--line)", background: "var(--paper)" }}>
      <button type="button" className={`monster-tile__star${favourite ? " is-on" : ""}`} title={favourite ? "Убрать из избранного" : "В избранное"} onClick={() => onToggleFavourite(entry, !favourite)}><NavIcon name="star" filled={favourite} /></button>
      <Link to={`/compendium/${entry.id}`} style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name || "Без названия"}</Link>
      <span className="muted" style={{ fontSize: "var(--fs-meta)", whiteSpace: "nowrap" }}>{[cat, size, ac ? `КД ${ac}` : null, hp ? `${hp} хитов` : null].filter(Boolean).join(" · ") || "—"}</span>
      <button type="button" className="monster-tile__bag" title="В мешок" onClick={() => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id })}><NavIcon name="bag" /></button>
      <Link to={`/compendium/${entry.id}`} className="comp-mini">Профиль</Link>
    </div>
  );
}