import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import { CHALLENGE_RATINGS, CREATURE_SIZES, kindLabel, normaliseCr, searchableText } from "../compendium";
import { loadMechanicsOptions, type MechanicsOption } from "../compendiumMechanics";
import { MonsterTileGrid, saveFavourite, type MonsterGrouping } from "./MonsterTileGrid";
import { NavIcon } from "./NavIcons";
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
  const [sortMode, setSortMode] = useState<SortMode>(() => {
    const raw = localStorage.getItem(`compendium-sort-${section.id}`);
    // Поддержка старого формата «alpha» и нового «alpha:desc».
    const stored = raw?.split(":")[0] as SortMode | null;
    const valid: SortMode[] = ["alpha", "creature_type", "cr", "size"];
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

  useEffect(() => {
    loadMechanicsOptions(systemId).then((opts) => setCreatureTypes(opts.creatureTypes));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemId]);

  const monsterFiltersActive =
    filterCreatureType !== "" || filterCR !== "" || filterSize !== "" || searchQuery !== "";

  // Сортировку не трогает: её выбирают осознанно и надолго, а фильтры с
  // поиском — на один заход.
  function resetMonsterFilters() {
    setFilterCreatureType("");
    setFilterCR("");
    setFilterSize("");
    setSearchQuery("");
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
  }, [topLevel, searchQuery, filterCreatureType, creatureTypeFilterName, filterCR, filterSize]);

  // Плитки не редактируются в линии (правка на странице профиля), поэтому
  // кнопка «Добавить» создаёт пустую запись — как и до выноса из дерева.
  async function addMonster() {
    await api.post<CompendiumEntry>(`/systems/${systemId}/entries`, {
      section_id: section.id,
      parent_id: null,
      kind: "monster",
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
        {/* Кнопки нет, пока сбрасывать нечего (§1.11): пустая кнопка в
            ряду фильтров — это лишний орган управления за столом. */}
        {monsterFiltersActive && (
          <button type="button" onClick={resetMonsterFilters}>
            Сбросить фильтры
          </button>
        )}
      </div>
      <div className="comp-list">
        <MonsterTileGrid
          entries={filteredTopLevel}
          grouping={sortMode as MonsterGrouping}
          sortDir={sortDir}
          sectionId={section.id}
          searchActive={searchQuery.trim() !== ""}
          onToggleFavourite={toggleFavourite}
          systemCode={systemCode}
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
      <button style={{ alignSelf: "flex-start" }} onClick={addMonster}>
        + Добавить {kindLabel("monster").toLowerCase()}
      </button>
    </div>
  );
}