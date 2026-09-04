import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { addToBag } from "../bag";
import { CHALLENGE_RATINGS, CREATURE_SIZES, kindLabel, normaliseCr, searchableText } from "../compendium";
import { loadMechanicsOptions, type MechanicsOption } from "../compendiumMechanics";
import { MonsterTileGrid, saveFavourite, type MonsterGrouping } from "./MonsterTileGrid";
import { NavIcon } from "./NavIcons";
import { EmptyState } from "./EmptyState";
import { useCurrentUser } from "../api/currentUser";
import { useCompendiumViewMode } from "../hooks/useCompendiumViewMode";
import type { CompendiumEntry, SystemSection } from "../types";

type SortMode = "alpha" | "creature_type" | "cr" | "size";
type SortDir = "asc" | "desc";

interface Props {
  systemId: number;
  section: SystemSection;
}

// Бестиарий вынесен из CompendiumSection (R1): у него своя форма — плитки
// вместо дерева записей, сортировки по типу/КО/размеру и фильтры. Глубокой
// ссылки на плитку нет (плитки не имеют id компендиумной строки), поэтому
// focusEntryId сюда не передаётся — ровно как было до выноса.
export function MonsterSection({ systemId, section }: Props) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const sortKey = `compendium-sort-${user?.id ?? "anon"}-${section.id}`;
  const [viewMode, setViewMode] = useCompendiumViewMode(section.id, "grid");
  const [entries, setEntries] = useState<CompendiumEntry[]>([]);
  const [creatureTypes, setCreatureTypes] = useState<MechanicsOption[]>([]);
  const [systemCode, setSystemCode] = useState<string | null>(null);
  useEffect(() => {
    api.get<{ code: string | null }>(`/systems/${systemId}`).then((s) => setSystemCode(s.code)).catch(() => setSystemCode(null));
  }, [systemId]);
  const isPhb = systemCode === "phb";
  const [filterCreatureType, setFilterCreatureType] = useState("");
  const [filterCR, setFilterCR] = useState("");
  const [filterSize, setFilterSize] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [showFavOnly, setShowFavOnly] = useState(false);
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const raw = localStorage.getItem(`compendium-sort-${"anon"}-${section.id}`) ?? localStorage.getItem(`compendium-sort-${section.id}`);
    const stored = raw?.split(":")[0] as SortMode | null;
    const valid: SortMode[] = ["alpha", "creature_type", "cr", "size"];
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
    const valid: SortMode[] = ["alpha", "creature_type", "cr", "size"];
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

  useEffect(() => {
    loadMechanicsOptions(systemId).then((opts) => setCreatureTypes(opts.creatureTypes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  const monsterFiltersActive =
    filterCreatureType !== "" || filterCR !== "" || filterSize !== "" || searchQuery !== "" || showFavOnly;

  // Сортировку не трогает: её выбирают осознанно и надолго, а фильтры с
  // поиском — на один заход.
  function resetMonsterFilters() {
    setFilterCreatureType("");
    setFilterCR("");
    setFilterSize("");
    setSearchQuery("");
    setShowFavOnly(false);
  }

  // Звезда пишется точечно и правит одну запись в состоянии: перезагружать
  // 535 записей ради одной отметки — это заметная пауза на пустом месте.
  // Колбэк обязан быть стабильным — на нём держится memo плитки, иначе один
  // щелчок перерисовывает весь раздел (та же ловушка, что была с вехами).
  // Запросы на одну плитку сериализуются цепочкой промисов: два быстрых
  // клика дойдут до сервера по порядку, а не в обратном (находка 10.6).
  const favouriteChains = useRef(new Map<number, Promise<void>>());
  const toggleFavourite = useCallback(async (entry: CompendiumEntry, favourite: boolean) => {
    const prev = favouriteChains.current.get(entry.id) ?? Promise.resolve();
    const next = prev.then(async () => {
      setEntries((cur) => cur.map((e) => (e.id === entry.id ? { ...e, favourite } : e)));
      try {
        await saveFavourite(entry.id, favourite);
      } catch {
        // Откат только если пользователь не успел переключить снова: сверка с
        // текущим состоянием вместо безусловного флипа не затирает новое.
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

  // Имя типа, выбранного в фильтре. Сверка идёт и по id, и по имени: снапшот,
  // снятый до переименования записи справочника, держит старый id (или вовсе
  // строковое поле без id у легаси/странных типов) — по id он выпадал из
  // фильтра молча, по имени остаётся виден.
  const creatureTypeFilterName =
    filterCreatureType === ""
      ? ""
      : creatureTypes.find((o) => o.id === Number(filterCreatureType))?.name ?? "";

  const topLevel = useMemo(() => entries.filter((e) => e.parent_id == null), [entries]);

  // Фильтры одни и те же на каждый ре-рендер, но результат обязан быть
  // стабильным по ссылке: MonsterTileGrid кэширует группы через useMemo, и
  // новый массив на каждый рендер сводил бы этот кэш к нулю (замерено на 535
  // записях, см. отчёт шага 5).
  const filteredTopLevel = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return topLevel.filter((e) => {
      if (showFavOnly && !e.favourite) return false;
      if (filterCreatureType !== "") {
        const type = e.data?.creature_type as MechanicsOption | undefined;
        const byId = type?.id === Number(filterCreatureType);
        const byName = creatureTypeFilterName !== "" && type?.name === creatureTypeFilterName;
        if (!byId && !byName) return false;
      }
      // «0.5» и «1/2» — одно и то же: легаси и часть форматов пишут дробь
      // десятичной, а фильтр сверяется с каноническим списком.
      if (filterCR !== "" && normaliseCr(e.data?.cr) !== filterCR) return false;
      if (filterSize !== "" && (e.data?.size as string | undefined) !== filterSize) return false;
      if (q && !searchableText(e).includes(q)) return false;
      return true;
    });
  }, [topLevel, searchQuery, filterCreatureType, creatureTypeFilterName, filterCR, filterSize, showFavOnly]);

  // Плитки не редактируются в линии (правка на странице профиля) — после
  // создания сразу ведём в профиль, иначе в сетке остаётся сирота «Без названия».
  async function addMonster() {
    const created = await api.post<CompendiumEntry>(`/systems/${systemId}/entries`, {
      section_id: section.id,
      parent_id: null,
      kind: "monster",
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
            className={sortMode === "creature_type" ? "active-sort" : ""}
            onClick={() => changeSortMode("creature_type")}
          >
            По типу{sortMode === "creature_type" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
          </button>
          {isPhb && (
            <button
              className={sortMode === "cr" ? "active-sort" : ""}
              onClick={() => changeSortMode("cr")}
            >
              По КО{sortMode === "cr" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          )}
          {isPhb && (
            <button
              className={sortMode === "size" ? "active-sort" : ""}
              onClick={() => changeSortMode("size")}
            >
              По размеру{sortMode === "size" ? (sortDir === "asc" ? " ↑" : " ↓") : ""}
            </button>
          )}
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
        <select value={filterCreatureType} onChange={(e) => setFilterCreatureType(e.target.value)}>
          <option value="">Все типы существ</option>
          {creatureTypes.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
        {isPhb && (
          <select value={filterCR} onChange={(e) => setFilterCR(e.target.value)}>
            <option value="">Все классы опасности</option>
            {CHALLENGE_RATINGS.map((cr) => (
              <option key={cr} value={cr}>
                {cr}
              </option>
            ))}
          </select>
        )}
        {isPhb && (
          <select value={filterSize} onChange={(e) => setFilterSize(e.target.value)}>
            <option value="">Все размеры</option>
            {CREATURE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          className={showFavOnly ? "active-sort" : ""}
          onClick={() => setShowFavOnly((v) => !v)}
          title={showFavOnly ? "Показать всех" : "Только избранное"}
        >
          <NavIcon name="star" filled={showFavOnly} /> {showFavOnly ? "Только избранное" : "Избранное"}
        </button>
        {/* Кнопки нет, пока сбрасывать нечего (§1.11): пустая кнопка в
             ряду фильтров — это лишний орган управления за столом. */}
        {monsterFiltersActive && (
          <button type="button" onClick={resetMonsterFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>
      <div className="comp-list">
        {viewMode === "grid" ? (
          <MonsterTileGrid
            entries={filteredTopLevel}
            grouping={sortMode as MonsterGrouping}
            sortDir={sortDir}
            sectionId={section.id}
            searchActive={searchQuery.trim() !== ""}
            onToggleFavourite={toggleFavourite}
            systemCode={systemCode}
          />
        ) : (
          <div className="stack" style={{ gap: 4 }}>
            {filteredTopLevel.map((e) => (
              <MonsterListRow key={e.id} entry={e} onToggleFavourite={toggleFavourite} />
            ))}
          </div>
        )}
        {topLevel.length === 0 && (
          <EmptyState kind={searchQuery.trim() ? "search" : "primary"}
            title={searchQuery.trim() ? `Ничего по «${searchQuery.trim()}»` : "Бестиарий пуст"}
            hint={searchQuery.trim() ? "Попробуйте другой запрос." : "Добавьте первое существо — оно появится здесь плитками."}
            action={<button className="primary" onClick={addMonster}>+ Добавить существо</button>}
          />
        )}
        {topLevel.length > 0 && filteredTopLevel.length === 0 && (
          <EmptyState kind="search"
            title="Ничего не нашлось"
            hint="Попробуйте сбросить фильтры или поискать иначе."
            action={<button onClick={resetMonsterFilters}>Сбросить фильтры</button>}
          />
        )}
      </div>
      <button style={{ alignSelf: "flex-start" }} onClick={addMonster}>
        + Добавить {kindLabel("monster").toLowerCase()}
      </button>
    </div>
  );
}

function MonsterListRow({ entry, onToggleFavourite }: { entry: CompendiumEntry; onToggleFavourite: (e: CompendiumEntry, f: boolean) => void }) {
  const favourite = !!entry.favourite;
  const type = (entry.data?.creature_type as { name?: string } | undefined)?.name ?? "";
  const size = typeof entry.data?.size === "string" ? entry.data.size : "";
  const cr = typeof entry.data?.cr === "string" ? entry.data.cr : "";
  const ac = (entry.data as Record<string, unknown>)?.ac != null ? String((entry.data as Record<string, unknown>).ac) : "";
  const hp = (entry.data as Record<string, unknown>)?.hp != null ? String((entry.data as Record<string, unknown>).hp) : "";
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", padding: "6px 8px", border: "1.5px solid var(--line)", background: "var(--paper)" }}>
      <button type="button" className={`monster-tile__star${favourite ? " is-on" : ""}`} title={favourite ? "Убрать из избранного" : "В избранное"} onClick={() => onToggleFavourite(entry, !favourite)}><NavIcon name="star" filled={favourite} /></button>
      <Link to={`/compendium/${entry.id}`} style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name || "Без названия"}</Link>
      <span className="muted" style={{ fontSize: "var(--fs-meta)", whiteSpace: "nowrap" }}>{[type, size, cr ? `КО ${cr}` : null, ac ? `КД ${ac}` : null, hp ? `${hp} хитов` : null].filter(Boolean).join(" · ") || "—"}</span>
      <button type="button" className="monster-tile__bag" title="В мешок" onClick={() => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id })}><NavIcon name="bag" /></button>
      <Link to={`/compendium/${entry.id}`} className="comp-mini">Профиль</Link>
    </div>
  );
}