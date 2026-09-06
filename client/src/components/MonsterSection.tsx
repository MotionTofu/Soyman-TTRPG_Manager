import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { addToBag } from "../bag";
import { CHALLENGE_RATINGS, CREATURE_SIZES, kindLabel, normaliseCr, searchableText } from "../compendium";
import { loadMechanicsOptions, type MechanicsOption } from "../compendiumMechanics";
import { MonsterTileGrid, saveFavourite, type MonsterGrouping } from "./MonsterTileGrid";
import { COMBAT_ROLES } from "./CreatureCard";
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
  // Чипсы ролей (мультивыбор) и пределы УВР.
  const [filterRoles, setFilterRoles] = useState<string[]>([]);
  // Логика мультивыбора: or — любой из тегов, and — все сразу, not — ни одного.
  const [filterLogic, setFilterLogic] = useState<"or" | "and" | "not">("or");
  const [filterDprMin, setFilterDprMin] = useState("");
  const [filterDprMax, setFilterDprMax] = useState("");

  function toggleFilterRole(role: string) {
    setFilterRoles((cur) => (cur.includes(role) ? cur.filter((r) => r !== role) : [...cur, role]));
  }

  function cycleFilterLogic() {
    setFilterLogic((cur) => (cur === "or" ? "and" : cur === "and" ? "not" : "or"));
  }

  const FILTER_LOGIC_LABEL = { or: "ИЛИ", and: "И", not: "НЕ" } as const;
  const FILTER_LOGIC_HINT = {
    or: "Любой из выбранных тегов. Клик — переключить на И.",
    and: "Все выбранные теги сразу. Клик — переключить на НЕ.",
    not: "Без выбранных тегов. Клик — переключить на ИЛИ.",
  } as const;
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
    filterCreatureType !== "" || filterCR !== "" || filterSize !== "" || searchQuery !== "" || showFavOnly ||
    filterRoles.length > 0 || filterDprMin !== "" || filterDprMax !== "";

  // Сортировку не трогает: её выбирают осознанно и надолго, а фильтры с
  // поиском — на один заход.
  function resetMonsterFilters() {
    setFilterCreatureType("");
    setFilterCR("");
    setFilterSize("");
    setSearchQuery("");
    setShowFavOnly(false);
    setFilterRoles([]);
    setFilterDprMin("");
    setFilterDprMax("");
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

  // Границы слайдера УВР — по загруженному разделу: от 0 до максимума.
  const dprValues = useMemo(
    () => topLevel.map((e) => e.dpr).filter((d): d is number => typeof d === "number"),
    [topLevel]
  );
  const dprBoundMax = dprValues.length ? Math.max(...dprValues) : 0;
  const dprBoundMin = dprValues.length ? Math.min(...dprValues) : 0;
  const clampBound = (v: number) => Math.max(0, Math.min(dprBoundMax, v));
  // Пустое поле = граница: слайдер на краю фильтр снимает, а не держит.
  const dprLo = filterDprMin !== "" ? clampBound(Number(filterDprMin)) : 0;
  const dprHi = filterDprMax !== "" ? clampBound(Number(filterDprMax)) : dprBoundMax;

  function changeDprLo(v: number) {
    const lo = Math.max(0, Math.min(Number.isFinite(v) ? v : 0, dprHi));
    setFilterDprMin(lo <= 0 ? "" : String(lo));
  }

  function changeDprHi(v: number) {
    const hi = Math.min(dprBoundMax, Math.max(Number.isFinite(v) ? v : dprBoundMax, dprLo));
    setFilterDprMax(hi >= dprBoundMax ? "" : String(hi));
  }

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
      if (filterRoles.length > 0) {
        const roles = Array.isArray(e.combat_roles) ? e.combat_roles.filter((r) => r) : [];
        if (filterLogic === "and" && !filterRoles.every((r) => roles.includes(r))) return false;
        if (filterLogic === "not" && filterRoles.some((r) => roles.includes(r))) return false;
        if (filterLogic === "or" && !filterRoles.some((r) => roles.includes(r))) return false;
      }
      // Пределы УВР: без посчитанного урона в диапазон не попадает.
      if (filterDprMin !== "" || filterDprMax !== "") {
        const dpr = typeof e.dpr === "number" ? e.dpr : null;
        if (dpr === null) return false;
        if (filterDprMin !== "" && dpr < Number(filterDprMin)) return false;
        if (filterDprMax !== "" && dpr > Number(filterDprMax)) return false;
      }
      if (q && !searchableText(e).includes(q)) return false;
      return true;
    });
  }, [topLevel, searchQuery, filterCreatureType, creatureTypeFilterName, filterCR, filterSize, showFavOnly, filterRoles, filterLogic, filterDprMin, filterDprMax]);

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
      </div>
      <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <span className="muted">Роли:</span>
        <button
          type="button"
          className="role-chip is-on"
          onClick={cycleFilterLogic}
          title={FILTER_LOGIC_HINT[filterLogic]}
        >
          {FILTER_LOGIC_LABEL[filterLogic]}
        </button>
        {COMBAT_ROLES.map((r) => (
          <button
            key={r}
            type="button"
            className={`role-chip${filterRoles.includes(r) ? " is-on" : ""}`}
            onClick={() => toggleFilterRole(r)}
            title={filterRoles.includes(r) ? `Убрать роль «${r}»` : `Только роль «${r}»`}
          >
            {r}
          </button>
        ))}
        <span className="muted" style={{ marginLeft: 8 }}>УВР:</span>
        {dprBoundMax > 0 && (
          <DprRangeSlider
            boundMax={dprBoundMax}
            lower={dprLo}
            upper={dprHi}
            onLower={changeDprLo}
            onUpper={changeDprHi}
          />
        )}
        <input
          type="number"
          min={0}
          step={1}
          placeholder={String(dprBoundMin)}
          aria-label="УВР от"
          value={filterDprMin}
          onChange={(e) => setFilterDprMin(e.target.value)}
          style={{ width: 70 }}
        />
        <span className="muted">–</span>
        <input
          type="number"
          min={0}
          step={1}
          placeholder={dprBoundMax > 0 ? String(dprBoundMax) : "до"}
          aria-label="УВР до"
          value={filterDprMax}
          onChange={(e) => setFilterDprMax(e.target.value)}
          style={{ width: 70 }}
        />
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

function DprRangeSlider({
  boundMax,
  lower,
  upper,
  onLower,
  onUpper,
}: {
  boundMax: number;
  lower: number;
  upper: number;
  onLower: (v: number) => void;
  onUpper: (v: number) => void;
}) {
  // Две точки на одной линейке: ползунки лежат друг на друге, active —
  // верхний по DOM. Пересечение запрещено — точки толкают друг друга.
  return (
    <span className="dpr-range" title={`УВР от ${lower} до ${upper}`}>
      <input
        type="range"
        min={0}
        max={boundMax}
        step={1}
        value={Math.min(lower, upper)}
        aria-label="УВР от"
        onChange={(e) => onLower(Number(e.target.value))}
      />
      <input
        type="range"
        min={0}
        max={boundMax}
        step={1}
        value={Math.max(lower, upper)}
        aria-label="УВР до"
        onChange={(e) => onUpper(Number(e.target.value))}
      />
    </span>
  );
}

function MonsterListRow({ entry, onToggleFavourite }: { entry: CompendiumEntry; onToggleFavourite: (e: CompendiumEntry, f: boolean) => void }) {
  const favourite = !!entry.favourite;
  const type = (entry.data?.creature_type as { name?: string } | undefined)?.name ?? "";
  const size = typeof entry.data?.size === "string" ? entry.data.size : "";
  const cr = typeof entry.data?.cr === "string" ? entry.data.cr : "";
  const acRaw = (entry.data as Record<string, unknown>)?.ac;
  const hpRaw = (entry.data as Record<string, unknown>)?.hp;
  // Ручное поле главнее, пустое добирается из статблока (statblock_ac/hp).
  const ac = (acRaw != null && String(acRaw) !== "" ? String(acRaw) : entry.statblock_ac) || "";
  const hp = (hpRaw != null && String(hpRaw) !== "" ? String(hpRaw) : entry.statblock_hp) || "";
  const roles = Array.isArray(entry.combat_roles) ? entry.combat_roles.filter((r) => r) : [];
  const dpr = typeof entry.dpr === "number" ? `УВР ${entry.dpr_approx ? "~" : ""}${entry.dpr}` : null;
  return (
    <div className="row" style={{ gap: 8, alignItems: "center", padding: "6px 8px", border: "1.5px solid var(--line)", background: "var(--paper)" }}>
      <button type="button" className={`monster-tile__star${favourite ? " is-on" : ""}`} title={favourite ? "Убрать из избранного" : "В избранное"} onClick={() => onToggleFavourite(entry, !favourite)}><NavIcon name="star" filled={favourite} /></button>
      <Link to={`/compendium/${entry.id}`} style={{ flex: 1, minWidth: 0, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.name || "Без названия"}</Link>
      <span className="muted" style={{ fontSize: "var(--fs-meta)", whiteSpace: "nowrap" }}>{[type, size, cr ? `КО ${cr}` : null, ac ? `КЗ ${ac}` : null, hp ? `${hp} хитов` : null, dpr, ...roles.slice(0, 2)].filter(Boolean).join(" · ") || "—"}</span>
      <button type="button" className="monster-tile__bag" title="В мешок" onClick={() => addToBag({ type: "compendium_entry", id: entry.id, title: entry.name, kind: entry.kind, system_id: entry.system_id, section_id: entry.section_id })}><NavIcon name="bag" /></button>
      <Link to={`/compendium/${entry.id}`} className="comp-mini">Профиль</Link>
    </div>
  );
}