import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
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
import {
  MAP_GRID_LABELS,
  MAP_SCALE_LABELS,
  MAP_SCALE_ORDER,
  MAP_SCALE_PRESETS,
  MAP_MIN_SIDE,
  MAP_MAX_SIDE,
  translateMapError,
  type MapGrid,
  type MapScale,
  type MapSummary,
} from "../maps/mapTypes";

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
      title: "Удалить карту?",
      message: `«${map.name}» исчезнет навсегда вместе со всеми клетками. Это нельзя отменить.`,
      confirmLabel: "Удалить",
      cancelLabel: "Оставить",
      danger: true,
    });
    if (!ok) return;
    // При отказе карта остаётся на месте, плашка предлагает повторить.
    await run(labelled("Карта не удалена", () => write.del(`/maps/${map.id}`)), {
      // Только список: миниатюру удалённой карты перечитывать незачем (404).
      affects: [{ kind: "map", id: map.id, card: true }],
    });
  }

  return (
    <div className="card campaign-tile">
      <Link to={`/maps/${map.id}`} className="campaign-tile-cover">
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
        <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="badge tag">{MAP_GRID_LABELS[map.grid]}</span>
          <span className="badge tag">{MAP_SCALE_LABELS[map.scale]}</span>
          {map.player_visible === 1 && <span className="badge tag">видят игроки</span>}
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
              title="Удалить карту"
              aria-label={`Удалить карту ${map.name}`}
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

  const afterWrite = useAfterWrite();
  const mapsState = useResource<MapSummary[]>("/maps");
  const listed = mapsState.data ?? NO_MAPS;
  const loading = mapsState.loading;
  const loadError = mapsState.error ? translateMapError(new Error(mapsState.error)) : null;
  const [q, setQ] = useState("");
  const [scaleFilter, setScaleFilter] = useState<"all" | MapScale>("all");
  const [gridFilter, setGridFilter] = useState<"all" | MapGrid>("all");
  const [visFilter, setVisFilter] = useState<"all" | "visible" | "hidden">("all");
  const [sort, setSort] = useState<"recent" | "az">("recent");

  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [grid, setGrid] = useState<MapGrid>("hex");
  const [scale, setScale] = useState<MapScale>("continent");
  const [width, setWidth] = useState<number>(MAP_SCALE_PRESETS.continent.width);
  const [height, setHeight] = useState<number>(MAP_SCALE_PRESETS.continent.height);
  const [createError, setCreateError] = useState<string | null>(null);

  // Миниатюры — отдельными запросами (в списке их нет: тяжёлые), под путём с
  // датой правки: не изменившаяся карта берёт миниатюру из кэша.
  const thumbs = useQueries({
    queries: listed.map((m) =>
      resourceQuery<{ thumbnail: string | null }>(thumbPath(m), { staleMs: Infinity, gcMs: 30 * 60_000 })
    ),
  });
  const maps = useMemo(
    () => listed.map((m, i) => ({ ...m, thumbnail: thumbs[i]?.data?.thumbnail ?? null })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [listed, ...thumbs.map((t) => t.data)]
  );

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    let list = maps;
    if (scaleFilter !== "all") list = list.filter((m) => m.scale === scaleFilter);
    if (gridFilter !== "all") list = list.filter((m) => m.grid === gridFilter);
    if (visFilter === "visible") list = list.filter((m) => m.player_visible === 1);
    if (visFilter === "hidden") list = list.filter((m) => m.player_visible !== 1);
    if (qq) list = list.filter((m) => m.name.toLowerCase().includes(qq));
    list = [...list];
    if (sort === "az") list.sort((a, b) => a.name.localeCompare(b.name, "ru"));
    else list.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
    return list;
  }, [maps, q, scaleFilter, gridFilter, visFilter, sort]);

  function pickScale(s: MapScale) {
    setScale(s);
    setWidth(MAP_SCALE_PRESETS[s].width);
    setHeight(MAP_SCALE_PRESETS[s].height);
  }

  function openCreate() {
    setName("");
    setGrid("hex");
    pickScale("continent");
    setCreateError(null);
    setCreating(true);
  }

  async function quickDraft() {
    setCreateError(null);
    try {
      const preset = MAP_SCALE_PRESETS.continent;
      const created = await write.post<{ id: number }>("/maps", {
        name: `Карта ${maps.length + 1}`,
        grid: "hex",
        scale: "continent",
        width: preset.width,
        height: preset.height,
      });
      // Новая карта — только список: миниатюры остальных не задеты.
      afterWrite([{ kind: "map", card: true }]);
      navigate(`/maps/${created.id}`);
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
    setCreateError(null);
    try {
      const created = await write.post<{ id: number }>("/maps", {
        name: name.trim(),
        grid,
        scale,
        width: w,
        height: h,
      });
      // Новая карта — только список: миниатюры остальных не задеты.
      afterWrite([{ kind: "map", card: true }]);
      setCreating(false);
      navigate(`/maps/${created.id}`);
    } catch (e) {
      setCreateError(translateMapError(e));
    }
  }

  const hasActiveFilters = q.trim() !== "" || scaleFilter !== "all" || gridFilter !== "all" || visFilter !== "all";

  const filterToolbar = (
    <>
      <select
        value={scaleFilter}
        onChange={(e) => setScaleFilter(e.target.value as "all" | MapScale)}
        aria-label="Фильтр по масштабу"
        title="Фильтр по масштабу"
      >
        <option value="all">Все масштабы</option>
        {MAP_SCALE_ORDER.map((s) => (
          <option key={s} value={s}>
            {MAP_SCALE_LABELS[s]}
          </option>
        ))}
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
      <ListPage
        headingSection="map"
        title="Карты"
        groups={[]}
        allLabel={null}
        ungroupedLabel={null}
        activeGroup={null}
        onGroupChange={() => {}}
        createLabel="+ Новая карта"
        onCreate={canEdit ? openCreate : undefined}
        actions={canEdit ? (
          <button type="button" title="Пустая карта с дефолтами: гексы, континент 40×30. Имя — потом" onClick={quickDraft}>
            + Черновик
          </button>
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
              <legend>Сетка — навсегда</legend>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" checked={grid === "hex"} onChange={() => setGrid("hex")} />
                Гексы — для земель и континентов
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" checked={grid === "square"} onChange={() => setGrid("square")} />
                Квадраты — для данжей и строений
              </label>
            </fieldset>
            <label>
              Масштаб
              <select value={scale} onChange={(e) => pickScale(e.target.value as MapScale)}>
                {MAP_SCALE_ORDER.map((s) => (
                  <option key={s} value={s}>
                    {MAP_SCALE_LABELS[s]} — {MAP_SCALE_PRESETS[s].width}×{MAP_SCALE_PRESETS[s].height},{" "}
                    клетка {MAP_SCALE_PRESETS[s].cellLore}
                  </option>
                ))}
              </select>
            </label>
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
