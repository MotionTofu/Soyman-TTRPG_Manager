import "./maps-d.css";
import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { resourceQuery, useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { NavIcon } from "../components/NavIcons";
import { RegArchive, RegMeta, RegRow, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import type { ContextMenuItem } from "../components/ContextMenu";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { ListPage } from "../components/ListPage";
import { MAP_VERSION_HEADER } from "@shared/maps/core";
import { DungeonGenerator } from "../maps/workspace/DungeonGenerator";
import { mapWorkspaceApi } from "../maps/workspace/mapApi";
import {
  MAP_GRID_LABELS,
  MAP_SCALE_PRESETS,
  OVERVIEW_PRESETS,
  TACTICAL_CELL,
  CITY_CELL,
  parseCellLore,
  cellLoreOf,
  mapKind,
  overviewScale,
  MAP_MIN_SIDE,
  MAP_MAX_SIDE,
  translateMapError,
  type MapGrid,
  type MapKind,
  type MapSummary,
} from "../maps/mapTypes";
import { ScalePreview } from "../maps/ScalePreview";
import { packsFor, rankPacks } from "../maps/assets/packs";
import { registerOwnPacks, type OwnPack } from "../maps/assets/ownPacks";
import { GenrePicker } from "../components/GenrePicker";
import type { Setting, SettingGenre } from "../types";

function formatUpdated(value: string): string {
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

const NO_MAPS: MapSummary[] = [];
// Без заголовка версии сервер отвечает на карту v6 отказом 409, а в общем списке /maps помечает её
// «не поддерживается» (для экранов, что не умеют v6): плитки v6 оставались без миниатюры.
const THUMB_HEADERS = { [MAP_VERSION_HEADER]: "6" };
/** Миниатюра карты не меняется, пока не сменилась дата правки — она в пути. */
function thumbPath(map: MapSummary): string {
  return `/maps/${map.id}/thumbnail?v=${encodeURIComponent(map.updated_at)}`;
}

const KIND_PLATE: Record<MapKind, string> = { tactical: "тактическая", city: "город", overview: "обзорная" };
const KIND_TABS: readonly { id: MapKind; label: string }[] = [
  { id: "tactical", label: "Тактические" },
  { id: "city", label: "Город" },
  { id: "overview", label: "Обзорные" },
];

// «Список» (доска Map-List-Rows): Название · Вид · Клетка · Размер · Изменена; на телефоне — вид.
const MAP_COLUMNS: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1.6fr)" },
  { label: "Вид", width: "120px", phone: true },
  { label: "Клетка", width: "minmax(110px, 0.8fr)" },
  { label: "Размер", width: "90px" },
  { label: "Изменена", width: "130px" },
];

/** Местные пункты меню карты: общий блок сущности открыть карту не умеет — у карты нет профиля. */
function useMapMenu(canEdit: boolean) {
  const [dialog, confirm] = useConfirm();
  const run = useAction();
  const navigate = useNavigate();
  async function archive(map: MapSummary) {
    const ok = await confirm({
      title: "Убрать карту в архив?",
      message: `«${map.name}» уйдёт в раздел «Архив» вместе со всеми клетками. Вернуть можно оттуда же.`,
      confirmLabel: "В архив",
      cancelLabel: "Оставить",
      danger: true,
    });
    if (!ok) return;
    // При отказе карта остаётся на месте, плашка предлагает повторить.
    await run(labelled("Карта не убрана в архив", () => write.del(`/maps/${map.id}`, map.document_version === 6 ? { headers: { [MAP_VERSION_HEADER]: "6" } } : undefined)), {
      // Только список: миниатюру удалённой карты перечитывать незачем (404).
      affects: [{ kind: "map", id: map.id, card: true }, { path: "/archive" }],
    });
  }
  const menuFor = (map: MapSummary): ContextMenuItem[] => canEdit ? [
    { label: "Открыть редактор", onClick: () => navigate(`/maps/${map.id}/workspace`) },
    ...(map.document_version !== 6 ? [{ label: "Классический редактор", onClick: () => navigate(`/maps/${map.id}`) }] : []),
    { label: "В архив", danger: true, onClick: () => void archive(map) },
  ] : [];
  return [dialog, menuFor] as const;
}

const gridOf = (map: MapSummary) => MAP_GRID_LABELS[map.grid].toLocaleLowerCase("ru");

export function MapsListPage() {
  const { user } = useCurrentUser();
  const canEdit = user?.role !== "player";
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const createRequested = searchParams.get("create") === "1";

  const afterWrite = useAfterWrite();
  const mapsState = useResource<MapSummary[]>("/maps");
  const listed = mapsState.data ?? NO_MAPS;
  const loading = mapsState.loading;
  const loadError = mapsState.error ? translateMapError(new Error(mapsState.error)) : null;
  const [q, setQ] = useState("");
  const [scaleFilter, setScaleFilter] = useState<"all" | MapKind>("all");
  const [gridFilter, setGridFilter] = useState<"all" | MapGrid>("all");
  const [visFilter, setVisFilter] = useState<"all" | "visible" | "hidden">("all");
  const [sort, setSort] = useState<"recent" | "az">("recent");
  const [view, setView] = useListView("maps");
  const [menuDialog, menuFor] = useMapMenu(canEdit);

  const [creating, setCreating] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [name, setName] = useState("");
  const [grid, setGrid] = useState<MapGrid>("hex");
  const [kind, setKind] = useState<MapKind>("tactical");
  const [km, setKm] = useState(2);
  const [width, setWidth] = useState<number>(MAP_SCALE_PRESETS.locality.width);
  const [height, setHeight] = useState<number>(MAP_SCALE_PRESETS.locality.height);
  const [createError, setCreateError] = useState<string | null>(null);
  // Подбор наборов новой карты (гриллинг Q26, Q32, Q45): сеттинг проставляет жанры, жанры выстраивают наборы по близости.
  const [settingId, setSettingId] = useState<number | null>(null), [genres, setGenres] = useState<SettingGenre[]>([]);
  const [offPacks, setOffPacks] = useState<string[]>([]), [pickingGenres, setPickingGenres] = useState(false);
  const settingList = useResource<Setting[]>(canEdit && creating ? "/settings" : null).data;
  const ownPackList = useResource<OwnPack[]>(canEdit && creating ? "/map-packs" : null).data;
  const offered = useMemo(() => { if (ownPackList) registerOwnPacks(ownPackList); return rankPacks(packsFor(kind), genres); }, [ownPackList, kind, genres]);

  // Миниатюры — отдельными запросами (в списке их нет: тяжёлые), под путём с
  // датой правки: не изменившаяся карта берёт миниатюру из кэша.
  const thumbs = useQueries({
    queries: listed.map((m) => (
      { ...resourceQuery<{ thumbnail: string | null }>(thumbPath(m), { staleMs: Infinity, gcMs: 30 * 60_000, headers: THUMB_HEADERS }), enabled: !m.document_unsupported || m.document_version === 6 }
    )),
  });
  const maps = useMemo(
    () => listed.map((m, i) => ({ ...m, thumbnail: thumbs[i]?.data?.thumbnail ?? null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listed, thumbs]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = maps;
    if (scaleFilter !== "all") list = list.filter((m) => mapKind(m.scale) === scaleFilter);
    if (gridFilter !== "all") list = list.filter((m) => m.grid === gridFilter);
    if (visFilter === "visible") list = list.filter((m) => m.player_visible === 1);
    if (visFilter === "hidden") list = list.filter((m) => m.player_visible !== 1);
    if (qq) list = list.filter((m) => m.name.toLowerCase().includes(qq));
    list = [...list];
    if (sort === "az") list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    else list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return list;
  }, [maps, q, scaleFilter, gridFilter, visFilter, sort]);

  /** Вид карты или заготовка обзорной: размер поля подставляется из неё. */
  function pickKind(next: MapKind, preset = OVERVIEW_PRESETS[0]) {
    const size = MAP_SCALE_PRESETS[next === "tactical" ? "locality" : next === "city" ? "settlement" : preset.scale];
    setKind(next); setKm(preset.km); setWidth(size.width); setHeight(size.height);
  }

  function openCreate() {
    setName("");
    setGrid("hex");
    pickKind("tactical");
    setCreateError(null);
    setCreating(true);
  }

  useEffect(() => {
    if (!canEdit || !createRequested) return;
    openCreate();
    setSearchParams((current) => {
      const next = new URLSearchParams(current);
      next.delete("create");
      return next;
    }, { replace: true });
  }, [canEdit, createRequested, setSearchParams]);

  async function quickDraft() {
    setCreateError(null);
    try {
      // Черновик — тактическая карта: с неё начинают чаще всего.
      const created = await write.post<{ id: number }>("/maps", {
        name: `Карта ${maps.length + 1}`,
        grid: "square",
        scale: "locality",
        cell_lore: TACTICAL_CELL,
        width: 50,
        height: 40,
      });
      // Новая карта — только список: миниатюры остальных не задеты.
      afterWrite([{ kind: "map", card: true }]);
      navigate(`/maps/${created.id}/workspace`);
    } catch (e) {
      setCreateError(translateMapError(e));
    }
  }

  async function create() {
    if (!name.trim()) {
      setCreateError("Название обязательно.");
      return;
    }
    const w = Math.trunc(width);
    const h = Math.trunc(height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w < MAP_MIN_SIDE || w > MAP_MAX_SIDE || h < MAP_MIN_SIDE || h > MAP_MAX_SIDE) {
      setCreateError(`Ширина и высота — целые числа ${MAP_MIN_SIDE}–${MAP_MAX_SIDE}.`);
      return;
    }
    if (kind === "overview" && !(km > 0 && km <= 10000)) {
      setCreateError("В клетке — от нуля до 10 000 км.");
      return;
    }
    setCreateError(null);
    try {
      const created = await write.post<{ id: number }>("/maps", {
        name: name.trim(),
        grid: kind === "overview" ? grid : "square",
        scale: kind === "tactical" ? "locality" : kind === "city" ? "settlement" : overviewScale(km),
        cell_lore: kind === "tactical" ? TACTICAL_CELL : kind === "city" ? CITY_CELL : cellLoreOf(km),
        width: w,
        height: h,
      });
      // Привязка к сеттингу — не повод терять созданную карту: её можно поставить позже.
      // Сбой привязки редактор покажет и подскажет, где поставить сеттинг заново.
      const settingFailed = !!settingId && !await write.post(`/maps/${created.id}/bindings`, { target_type: "setting", target_id: settingId }, { headers: { [MAP_VERSION_HEADER]: "6" } }).then(() => true, () => false);
      // Новая карта — только список: миниатюры остальных не задеты.
      afterWrite([{ kind: "map", card: true }]);
      setCreating(false);
      const packs = offered.filter((pack) => !offPacks.includes(pack.id)).map((pack) => pack.id);
      const chosen = packs.length && packs.length < packsFor(kind).length ? { packs } : {};
      navigate(`/maps/${created.id}/workspace`, { state: settingFailed || "packs" in chosen ? { ...chosen, ...(settingFailed ? { settingFailed } : {}) } : null });
    } catch (e) {
      setCreateError(translateMapError(e));
    }
  }

  const hasActiveFilters = q.trim() !== "" || scaleFilter !== "all" || gridFilter !== "all" || visFilter !== "all";

  const chip = (on: boolean, label: string, onClick: () => void) => (
    <button type="button" className={`maps-gch${on ? " is-on" : ""}`} aria-pressed={on} onClick={onClick}>{label}</button>
  );
  // Строка фильтров (доска Map-List): сетка, видимость игрокам, порядок — чипами вместо выпадающих списков.
  const filterChips = (
    <div className="maps-filters" role="group" aria-label="Фильтры карт">
      <span className="d-mono">сетка</span>
      {chip(gridFilter === "square", "квадраты", () => setGridFilter(gridFilter === "square" ? "all" : "square"))}
      {chip(gridFilter === "hex", "гексы", () => setGridFilter(gridFilter === "hex" ? "all" : "hex"))}
      {canEdit && <>
        <span className="d-mono">игрокам</span>
        {chip(visFilter === "visible", "видят", () => setVisFilter(visFilter === "visible" ? "all" : "visible"))}
        {chip(visFilter === "hidden", "скрыты", () => setVisFilter(visFilter === "hidden" ? "all" : "hidden"))}
      </>}
      <span className="d-mono">порядок</span>
      {chip(sort === "recent", "недавние", () => setSort("recent"))}
      {chip(sort === "az", "а–я", () => setSort("az"))}
    </div>
  );
  const kindCount = (k: MapKind) => maps.filter((m) => mapKind(m.scale) === k).length;

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      {canEdit && <DungeonGenerator open={generatorOpen} onClose={() => setGeneratorOpen(false)} onApply={async (document, settings, _target, name) => {
        const created = await mapWorkspaceApi.createDungeon(name, document, settings.seed);
        afterWrite([{ kind: "map", id: created.id, card: true }]);
        navigate(`/maps/${created.id}/workspace`);
      }} />}
      <ListPage
        ds
        headingSection="map"
        title="Карты"
        groups={[]}
        ungroupedLabel={null}
        extraTabs={KIND_TABS.map((t) => ({ ...t, count: kindCount(t.id) }))}
        activeGroup={scaleFilter === "all" ? null : scaleFilter}
        onGroupChange={(g) => setScaleFilter((g as MapKind | null) ?? "all")}
        createLabel="+ Новая карта"
        onCreate={canEdit ? openCreate : undefined}
        actions={canEdit ? (
          <>
          <Link to="/maps/packs" className="d-btn">Наборы ассетов</Link>
          <button type="button" className="d-btn" onClick={() => setGeneratorOpen(true)}>Быстрое подземелье</button>
          <button type="button" className="d-btn" title="Пустая тактическая карта 50×40. Имя — потом" onClick={quickDraft}>
            + Черновик
          </button>
          </>
        ) : undefined}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по названию…"
        view={view}
        onViewChange={setView}
        filters={filterChips}
        searchLabel="Поиск по картам"
        filteredCount={filtered.length}
        totalCount={maps.length}
        onResetSearch={() => {
          setQ("");
          setScaleFilter("all");
          setGridFilter("all");
          setVisFilter("all");
        }}
        showReset={hasActiveFilters}
        resetTitle="Сбросить поиск и фильтры"
      >
        {createError && !creating && (
          <div className="card" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
            <span>Не удалось создать черновик: {createError}</span>
            <button type="button" onClick={() => setCreateError(null)}>
              Понятно
            </button>
          </div>
        )}

        {loadError && (
          <LoadErrorCard
            message={<>Не удалось загрузить карты: {loadError}</>}
            onRetry={mapsState.reload}
          />
        )}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка карт" />
        ) : view === "tiles" ? (
          filtered.length > 0 && (
            <RegTiles>
              {filtered.map((m) => (
                <RegTile key={m.id} entity={{ type: "map", id: m.id, name: m.name }} to={canEdit ? `/maps/${m.id}/workspace` : `/maps/${m.id}`}
                  image={m.thumbnail} placeholder={<NavIcon name="map" />} plate={KIND_PLATE[mapKind(m.scale)]} menu={menuFor(m)}>
                  <div className="reg-tile__chips">
                    <span className="maps-gch">клетка {m.cell_lore || "—"}</span>
                    <span className="maps-gch">{gridOf(m)}</span>
                    {m.player_visible === 1 && <span className="maps-gch is-on">видят игроки</span>}
                  </div>
                  <RegMeta>{m.width}×{m.height} · {formatUpdated(m.updated_at)}</RegMeta>
                </RegTile>
              ))}
            </RegTiles>
          )
        ) : (
          filtered.length > 0 && (
            <RegTable columns={MAP_COLUMNS} label="Карты">
              {filtered.map((m) => (
                <RegRow key={m.id} entity={{ type: "map", id: m.id, name: m.name }} to={canEdit ? `/maps/${m.id}/workspace` : `/maps/${m.id}`}
                  columns={MAP_COLUMNS} menu={menuFor(m)}
                  cells={[
                    <span key="kind" className="d-mono">{KIND_PLATE[mapKind(m.scale)]}</span>,
                    <span key="cell" className="d-mono">{m.cell_lore || "—"} · {gridOf(m)}</span>,
                    <span key="size" className="d-mono">{m.width}×{m.height}</span>,
                    <span key="date" className="d-mono">{formatUpdated(m.updated_at)}</span>,
                  ]} />
              ))}
            </RegTable>
          )
        )}

        {!loading && !loadError && maps.length > 0 && filtered.length === 0 && (
          <EmptyState kind="search"
            title="Ничего не найдено"
            hint={q.trim() ? `По «${q.trim()}» ничего нет.` : "Под фильтры ничего не попало."}
            action={
              <button
                onClick={() => {
                  setQ("");
                  setScaleFilter("all");
                  setGridFilter("all");
                  setVisFilter("all");
                }}
              >
                Сбросить фильтры
              </button>
            }
          />
        )}

        {!loading && !loadError && maps.length === 0 && (
          <EmptyState
            title="Мир не начерчен"
            hint={
              canEdit
                ? "Ни одной карты пока нет — начертите первую."
                : "Мастер пока не открыл ни одной карты."
            }
            action={
              canEdit ? (
                <button className="primary" onClick={openCreate}>
                  + Новая карта
                </button>
              ) : undefined
            }
          />
        )}
        {canEdit && <RegArchive type="map" basePath="/maps" affects={[{ kind: "map", card: true }]} />}
        {menuDialog}
      </ListPage>

      {creating && pickingGenres && <GenrePicker selected={genres} title="Жанры карты" hint="До трёх жанров: наборы ассетов выстроятся по близости к ним."
        onSave={(next) => { setGenres(next); setPickingGenres(false); }} onClose={() => setPickingGenres(false)} />}
      {creating && !pickingGenres && (
        <Modal onClose={() => setCreating(false)} wide className="maps-win maps-win--wide" ariaLabel="Новая карта">
          <h2>Новая карта</h2>
          {/* Доска Map-Win-New: слева — что за карта и какого размера, справа — сеттинг и наборы. */}
          <div className="maps-win__cols">
            <div className="maps-win__col">
              <label>
                Название
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Подвал таверны" autoFocus />
              </label>
              <fieldset>
                <legend>Вид карты — навсегда</legend>
                {([["tactical", "Тактическая", `подземелье, дом, двор, улица · клетка ${TACTICAL_CELL}`],
                  ["city", "Город", `улицы, кварталы, стены · клетка ${CITY_CELL}, дом равен клетке`],
                  ["overview", "Обзорная", "край, страна, мир · клетку задаёте вы"]] as const).map(([value, title, hint]) => (
                  <label key={value} className={`maps-kind${kind === value ? " is-on" : ""}`}>
                    <input type="radio" name="map-kind" checked={kind === value} onChange={() => pickKind(value)} />
                    <span><b>{title}</b><small>{hint}</small></span>
                  </label>
                ))}
              </fieldset>
              {kind === "overview" && (
                <>
                  <div className="maps-win__presets">
                    {OVERVIEW_PRESETS.map((preset) => (
                      <button key={preset.scale} type="button" className={`maps-gch${km === preset.km ? " is-on" : ""}`} aria-pressed={km === preset.km} onClick={() => pickKind("overview", preset)}>
                        {preset.name} · {cellLoreOf(preset.km)}
                      </button>
                    ))}
                  </div>
                  <div className="maps-win__pair">
                    <label>
                      В клетке, км
                      <input type="number" min={0.001} max={10000} step="any" value={km} onChange={(e) => setKm(Number(e.target.value))} />
                    </label>
                    <fieldset>
                      <legend>Сетка — навсегда</legend>
                      <div className="d-seg maps-win__seg">
                        <button type="button" className={grid === "hex" ? "active" : undefined} aria-pressed={grid === "hex"} onClick={() => setGrid("hex")}>Гексы</button>
                        <button type="button" className={grid === "square" ? "active" : undefined} aria-pressed={grid === "square"} onClick={() => setGrid("square")}>Квадраты</button>
                      </div>
                    </fieldset>
                  </div>
                </>
              )}
              <div className="maps-win__pair">
                <label>
                  Ширина, клеток
                  <input type="number" min={MAP_MIN_SIDE} max={MAP_MAX_SIDE} value={width} onChange={(e) => setWidth(Number(e.target.value))} />
                </label>
                <label>
                  Высота, клеток
                  <input type="number" min={MAP_MIN_SIDE} max={MAP_MAX_SIDE} value={height} onChange={(e) => setHeight(Number(e.target.value))} />
                </label>
              </div>
              <div className="maps-win__scale">
                <span className="maps-lbl">Масштаб</span>
                <ScalePreview metres={kind === "overview" ? km * 1000 : parseCellLore(kind === "city" ? CITY_CELL : TACTICAL_CELL)!} width={width} height={height} />
              </div>
            </div>
            <div className="maps-win__col">
              <label>
                Сеттинг
                <select value={settingId ?? ""} onChange={(e) => { const next = Number(e.target.value) || null; setSettingId(next); setGenres(settingList?.find((entry) => entry.id === next)?.genres ?? []); }}>
                  <option value="">Без сеттинга</option>
                  {settingList?.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
                </select>
              </label>
              <div>
                <span className="maps-lbl">Жанры</span>
                <div className="maps-win__presets">
                  {genres.map((genre) => <span key={`${genre.genre}:${genre.subgenre ?? ""}`} className="maps-gch is-on">{genre.subgenre || genre.genre}</span>)}
                  <button type="button" className="maps-gch maps-gch--add" onClick={() => setPickingGenres(true)}>{genres.length ? "Жанры…" : "+ Жанры — сейчас все наборы"}</button>
                </div>
              </div>
              <fieldset>
                <legend>Наборы ассетов</legend>
                {offered.map((pack) => (
                  <label key={pack.id} className="maps-check maps-check--row">
                    <input type="checkbox" checked={!offPacks.includes(pack.id)} onChange={() => setOffPacks(offPacks.includes(pack.id) ? offPacks.filter((id) => id !== pack.id) : [...offPacks, pack.id])} />
                    <span>{pack.name}<small>{pack.genre} · {pack.place}</small></span>
                  </label>
                ))}
              </fieldset>
              <p className="maps-win__note">Отмеченные наборы попадут в каталог карты. Подключить или отключить набор можно и потом — «＋ Набор» в каталоге.</p>
            </div>
          </div>
          {createError && <p className="maps-win__error" role="alert">{createError}</p>}
          <div className="modal-footer row">
            <button onClick={() => setCreating(false)}>Отмена</button>
            <button className="primary" onClick={create}>
              Создать и открыть
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
