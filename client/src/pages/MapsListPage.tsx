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
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { ListPage } from "../components/ListPage";
import { MAP_VERSION_HEADER } from "@shared/maps/core";
import { DungeonGenerator } from "../maps/workspace/DungeonGenerator";
import { mapWorkspaceApi } from "../maps/workspace/mapApi";
import {
  MAP_GRID_LABELS,
  MAP_KIND_LABELS,
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

function formatUpdated(value: string): string {
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" });
}

const NO_MAPS: MapSummary[] = [];
/** Миниатюра карты не меняется, пока не сменилась дата правки — она в пути. */
function thumbPath(map: MapSummary): string {
  return `/maps/${map.id}/thumbnail?v=${encodeURIComponent(map.updated_at)}`;
}

function MapTile({ map, canEdit }: { map: MapSummary; canEdit: boolean }) {
  const [dialog, confirm] = useConfirm();
  const run = useAction();

  const thumb =
    map.thumbnail && map.thumbnail.startsWith("data:image/png;base64,") ? map.thumbnail : null;

  async function remove() {
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
      affects: [{ kind: "map", id: map.id, card: true }],
    });
  }

  return (
    <div className="card campaign-tile">
      <Link to={canEdit ? `/maps/${map.id}/workspace` : `/maps/${map.id}`} className="campaign-tile-cover">
        {thumb ? (
          <div
            className="map-tile-art"
            style={{ backgroundImage: `url("${thumb}")` }}
            aria-hidden="true"
          />
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true">
            <span className="group-add-icon">
              <NavIcon name="map" />
            </span>
          </div>
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{map.name}</h3>
      </Link>
      <div className="campaign-tile-meta">
        {canEdit && <Link to={`/maps/${map.id}/workspace`}>Открыть редактор</Link>}
        {canEdit && map.document_version !== 6 && <Link to={`/maps/${map.id}`}>Классический редактор</Link>}
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="badge tag">{MAP_GRID_LABELS[map.grid]}</span>
          <span className="badge tag">{MAP_KIND_LABELS[mapKind(map.scale)]}{map.cell_lore && ` · клетка ${map.cell_lore}`}</span>
          {map.player_visible === 1 && <span className="badge tag">видят игроки</span>}
          {map.document_unsupported && <span className="badge tag">{canEdit && map.document_version === 6 ? "новый редактор" : "формат пока не поддерживается"}</span>}
        </div>
        <div
          className="muted row"
          style={{
            justifyContent: "space-between",
            alignItems: "center",
            fontFamily: "var(--font-mono)",
            fontSize: "var(--fs-micro)",
          }}
        >
          <span>
            {map.width}×{map.height} · {formatUpdated(map.updated_at)}
          </span>
          {canEdit && (
            <button
              type="button"
              onClick={remove}
              title="В архив"
              aria-label={`Убрать карту ${map.name} в архив`}
              style={{ padding: "2px 6px", height: 26 }}
            >
              <NavIcon name="delete" />
            </button>
          )}
        </div>
      </div>
      {dialog}
    </div>
  );
}

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

  const [creating, setCreating] = useState(false);
  const [generatorOpen, setGeneratorOpen] = useState(false);
  const [name, setName] = useState("");
  const [grid, setGrid] = useState<MapGrid>("hex");
  const [kind, setKind] = useState<MapKind>("tactical");
  const [km, setKm] = useState(2);
  const [width, setWidth] = useState<number>(MAP_SCALE_PRESETS.locality.width);
  const [height, setHeight] = useState<number>(MAP_SCALE_PRESETS.locality.height);
  const [createError, setCreateError] = useState<string | null>(null);

  // Миниатюры — отдельными запросами (в списке их нет: тяжёлые), под путём с
  // датой правки: не изменившаяся карта берёт миниатюру из кэша.
  const thumbs = useQueries({
    queries: listed.map((m) => (
      { ...resourceQuery<{ thumbnail: string | null }>(thumbPath(m), { staleMs: Infinity, gcMs: 30 * 60_000 }), enabled: !m.document_unsupported }
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
      // Новая карта — только список: миниатюры остальных не задеты.
      afterWrite([{ kind: "map", card: true }]);
      setCreating(false);
      navigate(`/maps/${created.id}/workspace`);
    } catch (e) {
      setCreateError(translateMapError(e));
    }
  }

  const hasActiveFilters = q.trim() !== "" || scaleFilter !== "all" || gridFilter !== "all" || visFilter !== "all";

  const filterToolbar = (
    <>
      <select
        value={scaleFilter}
        onChange={(e) => setScaleFilter(e.target.value as "all" | MapKind)}
        aria-label="Фильтр по виду карты"
        title="Фильтр по виду карты"
      >
        <option value="all">Любой вид</option>
        <option value="tactical">Тактические</option>
        <option value="city">Города</option>
        <option value="overview">Обзорные</option>
      </select>
      <select
        value={gridFilter}
        onChange={(e) => setGridFilter(e.target.value as "all" | MapGrid)}
        aria-label="Фильтр по сетке"
        title="Фильтр по сетке"
      >
        <option value="all">Любая сетка</option>
        <option value="square">Квадраты</option>
        <option value="hex">Гексы</option>
      </select>
      {canEdit && (
        <select
          value={visFilter}
          onChange={(e) => setVisFilter(e.target.value as "all" | "visible" | "hidden")}
          aria-label="Фильтр по видимости игрокам"
          title='Фильтр по видимости: игроки видят только карты с меткой "видят игроки"'
        >
          <option value="all">Все карты</option>
          <option value="visible">Видят игроки</option>
          <option value="hidden">Скрыты</option>
        </select>
      )}
      <select value={sort} onChange={(e) => setSort(e.target.value as "recent" | "az")} aria-label="Сортировка">
        <option value="recent">Недавние</option>
        <option value="az">А–Я</option>
      </select>
    </>
  );

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      {canEdit && <DungeonGenerator open={generatorOpen} onClose={() => setGeneratorOpen(false)} onApply={async (document, settings, _target, name) => {
        const created = await mapWorkspaceApi.createDungeon(name, document, settings.seed);
        afterWrite([{ kind: "map", id: created.id, card: true }]);
        navigate(`/maps/${created.id}/workspace`);
      }} />}
      <ListPage
        headingSection="map"
        title="Редактор карт"
        groups={[]}
        allLabel={null}
        ungroupedLabel={null}
        activeGroup={null}
        onGroupChange={() => {}}
        createLabel="+ Новая карта"
        onCreate={canEdit ? openCreate : undefined}
        actions={canEdit ? (
          <>
          <button type="button" onClick={() => setGeneratorOpen(true)}>Быстрое подземелье</button>
          <button type="button" title="Пустая карта с дефолтами: гексы, континент 40×30. Имя — потом" onClick={quickDraft}>
            + Черновик
          </button>
          </>
        ) : undefined}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по названию…"
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
        toolbarExtra={filterToolbar}
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
        ) : (
          <div className="grid-cards">
            {filtered.map((m) => (
              <MapTile key={m.id} map={m} canEdit={canEdit} />
            ))}
          </div>
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
      </ListPage>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2>Новая карта</h2>
          <div className="stack">
            <label>
              Название
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Например, Эстария" />
            </label>
            <fieldset style={{ border: "1px solid var(--line)", padding: "8px 10px" }}>
              <legend>Вид карты — навсегда</legend>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" checked={kind === "tactical"} onChange={() => pickKind("tactical")} />
                Тактическая — подземелье, дом, двор, улица; клетка {TACTICAL_CELL}
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" checked={kind === "city"} onChange={() => pickKind("city")} />
                Город — улицы, кварталы, стены; клетка {CITY_CELL}, дом равен клетке
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" checked={kind === "overview"} onChange={() => pickKind("overview")} />
                Обзорная — край, страна, мир; клетку задаёте вы
              </label>
            </fieldset>
            {kind === "overview" && (
              <>
                <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                  {OVERVIEW_PRESETS.map((preset) => (
                    <button key={preset.scale} type="button" aria-pressed={km === preset.km} onClick={() => pickKind("overview", preset)}>
                      {preset.name} · {cellLoreOf(preset.km)}
                    </button>
                  ))}
                </div>
                <label>
                  В одной клетке, км
                  <input type="number" min={0.001} max={10000} step="any" value={km} onChange={(e) => setKm(Number(e.target.value))} />
                </label>
                <fieldset style={{ border: "1px solid var(--line)", padding: "8px 10px" }}>
                  <legend>Сетка — навсегда</legend>
                  <label className="row" style={{ gap: 6 }}>
                    <input type="radio" checked={grid === "hex"} onChange={() => setGrid("hex")} />
                    Гексы
                  </label>
                  <label className="row" style={{ gap: 6 }}>
                    <input type="radio" checked={grid === "square"} onChange={() => setGrid("square")} />
                    Квадраты
                  </label>
                </fieldset>
              </>
            )}
            <ScalePreview metres={kind === "overview" ? km * 1000 : parseCellLore(kind === "city" ? CITY_CELL : TACTICAL_CELL)!} width={width} height={height} />
            <div className="row" style={{ gap: 8 }}>
              <label>
                Ширина
                <input
                  type="number"
                  min={MAP_MIN_SIDE}
                  max={MAP_MAX_SIDE}
                  value={width}
                  onChange={(e) => setWidth(Number(e.target.value))}
                />
              </label>
              <label>
                Высота
                <input
                  type="number"
                  min={MAP_MIN_SIDE}
                  max={MAP_MAX_SIDE}
                  value={height}
                  onChange={(e) => setHeight(Number(e.target.value))}
                />
              </label>
            </div>
            {createError && <p className="muted">{createError}</p>}
            <div className="modal-footer row">
              <button onClick={() => setCreating(false)}>Отмена</button>
              <button className="primary" onClick={create}>
                Создать и открыть
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
