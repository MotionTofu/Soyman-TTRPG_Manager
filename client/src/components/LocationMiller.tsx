import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";
import { LocationCascadePicker } from "./LocationCascadePicker";
import { EntityWizard } from "./entityWizard/EntityWizard";
import { useAlert, useConfirm, usePrompt } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { isSafeImageUrl } from "../utils/safeUrl";
import type { SettingLocation } from "../types";

interface LocationDetailLite {
  id: number;
  thumbnail_image_url?: string | null;
  avatar_image_url?: string | null;
  inhabitant_beings: { id: number }[];
  nested_inhabitant_beings: { id: number }[];
  inhabitant_communities: { id: number }[];
  chapters: { id: number }[];
}

function pathKey(settingId: number): string {
  return `geography-millerpath-${settingId}`;
}

function loadPath(settingId: number): number[] {
  try {
    const raw = localStorage.getItem(pathKey(settingId));
    if (!raw) return [];
    const ids = JSON.parse(raw) as number[];
    return ids.filter((n) => Number.isFinite(n));
  } catch {
    return [];
  }
}

const COL_FULL = 240;
const COL_MIN = 52;
const COL_RAIL = 140;

/** Ширины аккордеона водопадом: активная зафиксирована на полной ширине
 * всегда, дальние складываются в минимум по очереди — [[|[||[||||]||]|]. */
function millerWidths(n: number, active: number, capacity: number): number[] {
  const w = new Array<number>(n).fill(COL_FULL);
  if (n <= 0) return w;
  const cap = capacity > 0 ? capacity : n * COL_FULL;
  let over = n * COL_FULL - cap;
  if (over <= 0) return w;
  const a = Math.min(Math.max(active, 0), n - 1);
  const order = [...Array(n).keys()]
    .filter((i) => i !== a)
    .sort((x, y) => Math.abs(y - a) - Math.abs(x - a) || y - x);
  for (const i of order) {
    if (over <= 0) break;
    const cut = Math.min(w[i] - COL_MIN, over);
    w[i] -= cut;
    over -= cut;
  }
  // Остаток не влез даже так — активную не трогаем, будет скролл (предел).
  return w;
}

/** Колонки Миллера: виден один путь — братья | дети | внуки + превью.
 * Аккордеон: места мало — дальние от активной схлопываются первыми. */
export function LocationMiller({ settingId }: { settingId: number }) {
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [path, setPath] = useState<number[]>(() => loadPath(settingId));
  const [activeCol, setActiveCol] = useState(0);
  const [wrapW, setWrapW] = useState(0);
  const [creating, setCreating] = useState(false);
  const [wizardParentId, setWizardParentId] = useState<number | null>(null);
  const [menu, setMenu] = useState<
    { x: number; y: number; id: number } | { x: number; y: number; createParent: number | null } | null
  >(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [moveId, setMoveId] = useState<number | null>(null);
  const [moveParent, setMoveParent] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement>(null);

  // Без массива зависимостей сознательно: колонки монтируются позже скелетона,
  // одноразовый эффект на монтировании рефа бы не нашёл и ширина осталась бы 0.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const w = es[0].contentRect.width;
      setWrapW((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    setWrapW(el.clientWidth);
    return () => ro.disconnect();
  });

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, { signal: controller.signal })
      .then((rows) => {
        setLocations(rows);
        setLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setLoadError(String(e instanceof Error ? e.message : e));
        setLoading(false);
      });
    return () => controller.abort();
  }, [settingId]);
  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
  }, [refresh]);

  useEffect(() => {
    try {
      localStorage.setItem(pathKey(settingId), JSON.stringify(path));
    } catch { /* ignore */ }
  }, [settingId, path]);

  const byId = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const kidsOf = useMemo(() => {
    const m = new Map<number | null, SettingLocation[]>();
    for (const l of locations) {
      if (l.archived_at) continue;
      const list = m.get(l.parent_id) ?? [];
      list.push(l);
      m.set(l.parent_id, list);
    }
    for (const list of m.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    }
    return m;
  }, [locations]);

  // Чиним хвост пути: битые id отваливаются.
  const cleanPath = useMemo(() => {
    const out: number[] = [];
    let parent: number | null = null;
    for (const id of path) {
      const loc = byId.get(id);
      if (!loc || loc.archived_at) break;
      const actualParent = loc.parent_id != null && byId.has(loc.parent_id) ? loc.parent_id : null;
      if (actualParent !== parent) break;
      out.push(id);
      parent = id;
    }
    return out;
  }, [path, byId]);

  // Колонки данных: пустые детские не показываем — их дело берёт превью.
  const columns: { parent: SettingLocation | null; items: SettingLocation[] }[] = useMemo(() => {
    const cols = [{ parent: null as SettingLocation | null, items: kidsOf.get(null) ?? [] }];
    for (const id of cleanPath) {
      const kids = kidsOf.get(id) ?? [];
      if (kids.length > 0) cols.push({ parent: byId.get(id) ?? null, items: kids });
    }
    return cols;
  }, [kidsOf, cleanPath, byId]);

  const focus: SettingLocation | null =
    cleanPath.length > 0 ? (byId.get(cleanPath[cleanPath.length - 1]) ?? null) : null;
  const focusId = focus?.id ?? null;

  // Деталь фокуса для карточки: тамбнейл + счётчики как в Списке.
  const [focusDetail, setFocusDetail] = useState<LocationDetailLite | null>(null);
  const [focusLoading, setFocusLoading] = useState(false);
  useEffect(() => {
    if (focusId == null) return;
    const controller = new AbortController();
    setFocusLoading(true);
    api
      .get<LocationDetailLite>(`/setting-locations/${focusId}?nested=1`, {
        signal: controller.signal,
      })
      .then((d) => {
        if (controller.signal.aborted) return;
        setFocusDetail(d);
        setFocusLoading(false);
      })
      .catch((e: unknown) => {
        if ((e as Error).name === "AbortError") return;
        setFocusLoading(false);
      });
    return () => controller.abort();
  }, [focusId]);

  const focusDescCount = useMemo(() => {
    if (focus == null) return 0;
    let n = 0;
    const stack = (kidsOf.get(focus.id) ?? []).map((l) => l.id);
    const seen = new Set<number>([focus.id]);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      n += 1;
      for (const k of kidsOf.get(id) ?? []) stack.push(k.id);
    }
    return n;
  }, [focus, kidsOf]);

  const shownDetail = focusDetail && focus && focusDetail.id === focus.id ? focusDetail : null;
  const focusThumb = shownDetail
    ? (shownDetail.thumbnail_image_url || shownDetail.avatar_image_url || null)
    : null;
  const focusSafeThumb = focusThumb && isSafeImageUrl(focusThumb) ? focusThumb : null;
  const focusPopulation =
    (shownDetail?.inhabitant_beings.length ?? 0) + (shownDetail?.nested_inhabitant_beings.length ?? 0);

  // Провал — фокус на свежую колонку; клик по шапке — просто посмотреть
  // (фокус ставится прямо в pick, без эффекта).

  const totalCols = columns.length + (focus ? 1 : 0);
  const active = Math.min(Math.max(activeCol, 0), Math.max(totalCols - 1, 0));
  const widths = useMemo(
    // Ёмкость минус щели между колонками (12px каждая) — иначе скрип скролла.
    () => millerWidths(totalCols, active, wrapW - 12 * Math.max(totalCols - 1, 0)),
    [totalCols, active, wrapW]
  );
  // Drill-down: узко — одна активная колонка на всю ширину + «Назад».
  const narrow = wrapW > 0 && wrapW < 560;

  function goBack() {
    if (active >= columns.length && focus) {
      setActiveCol(columns.length - 1);
      return;
    }
    const next = cleanPath.slice(0, -1);
    let cols = 1;
    for (const pid of next) {
      if ((kidsOf.get(pid) ?? []).length > 0) cols += 1;
    }
    setPath(next);
    setActiveCol(cols - 1);
  }

  const backLabel =
    active >= columns.length
      ? "К списку"
      : active > 0
        ? (columns[active].parent ? `‹ ${columns[active].parent!.name}` : "‹ Мир")
        : null;

  // Цепочка предков + сам: путь собирается без подсчёта индексов колонок.
  function chainFor(id: number): number[] {
    const chain: number[] = [id];
    let cur = byId.get(id);
    const seen = new Set<number>([id]);
    while (cur && cur.parent_id != null && !seen.has(cur.parent_id)) {
      const p = byId.get(cur.parent_id);
      if (!p || p.archived_at) break;
      seen.add(p.id);
      chain.unshift(p.id);
      cur = p;
    }
    return chain;
  }

  // Сколько колонок данных даст путь (превью — следующая за ними).
  function dataColsFor(chain: number[]): number {
    let cols = 1;
    for (const pid of chain) {
      if ((kidsOf.get(pid) ?? []).length > 0) cols += 1;
    }
    return cols;
  }

  function isDescendantOf(ancestorId: number, maybeDescendantId: number): boolean {
    let cur = byId.get(maybeDescendantId);
    const seen = new Set<number>();
    while (cur && cur.parent_id != null && !seen.has(cur.id)) {
      if (cur.parent_id === ancestorId) return true;
      seen.add(cur.id);
      cur = byId.get(cur.parent_id);
    }
    return false;
  }

  function pick(id: number) {
    const chain = chainFor(id);
    const cols = dataColsFor(chain);
    const leaf = (kidsOf.get(id) ?? []).length === 0;
    setPath(chain);
    setActiveCol(leaf ? cols : cols - 1);
  }

  function showCard(id: number) {
    const chain = chainFor(id);
    setPath(chain);
    setActiveCol(dataColsFor(chain)); // индекс превью
  }

  async function rename(id: number) {
    const loc = byId.get(id);
    if (!loc) return;
    const name = await promptText({
      title: "Переименовать локацию",
      message: "Новое название",
      defaultValue: loc.name,
    });
    if (name == null) return;
    if (!name.trim()) {
      showAlert("Имя не может быть пустым");
      return;
    }
    try {
      await api.put(`/setting-locations/${id}`, { name: name.trim() });
      refresh();
    } catch (err) {
      showAlert(String(err instanceof Error ? err.message : err));
    }
  }

  async function archive(id: number) {
    const loc = byId.get(id);
    if (!loc) return;
    const kids = (kidsOf.get(id) ?? []).length;
    const ok = await confirm({
      title: "Удалить локацию?",
      message: `Отправить «${loc.name}»${kids > 0 ? ` (и вложенные: ${kids})` : ""} в архив?`,
      confirmLabel: "Удалить",
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteWithUndo({
        entityName: loc.name,
        deleteFn: () => api.del(`/setting-locations/${id}`),
        restoreFn: async () => {
          await api.put(`/setting-locations/${id}/restore`);
          refresh();
        },
      });
    } catch (e) {
      showAlert(String(e instanceof Error ? e.message : e));
      return;
    }
    refresh();
  }

  async function moveTo(dragged: number, targetParent: number | null) {
    const loc = byId.get(dragged);
    if (!loc) return;
    const cur = loc.parent_id != null && byId.has(loc.parent_id) ? loc.parent_id : null;
    if (cur === targetParent) return;
    if (targetParent != null) {
      if (targetParent === dragged || isDescendantOf(dragged, targetParent)) {
        showAlert("Нельзя вложить локацию в саму себя или в своего же потомка.");
        return;
      }
    }
    try {
      await api.put(`/setting-locations/${dragged}/parent`, { parent_id: targetParent });
      // Едем следом за переехавшей.
      setPath(chainFor(dragged));
      refresh();
    } catch (err) {
      showAlert(String(err instanceof Error ? err.message : err));
    } finally {
      setDraggedId(null);
      setDragOverId(null);
    }
  }

  function openMove(id: number) {
    const loc = byId.get(id);
    if (!loc) return;
    setMoveParent(loc.parent_id != null && byId.has(loc.parent_id) ? loc.parent_id : null);
    setMoveId(id);
  }

  async function confirmMove() {
    if (moveId == null) return;
    const target = moveParent;
    setMoveId(null);
    await moveTo(moveId, target);
  }

  function menuItems(id: number): ContextMenuItem[] {
    return [
      { label: "Переименовать", onClick: () => rename(id) },
      { label: "Открыть", onClick: () => navigate(`/locations/${id}`) },
      { label: "Карточка", onClick: () => showCard(id) },
      { label: "Переместить", onClick: () => openMove(id) },
      { label: "Удалить", danger: true, onClick: () => archive(id) },
    ];
  }

  function handleDragStart(e: DragEvent<HTMLElement>, id: number) {
    e.stopPropagation();
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
  }

  function handleItemDrop(e: DragEvent<HTMLElement>, targetId: number) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    const raw = e.dataTransfer.getData("text/plain");
    const dragged = draggedId ?? (raw ? Number(raw) : null);
    if (dragged == null || dragged === targetId) {
      setDraggedId(null);
      return;
    }
    void moveTo(dragged, targetId);
  }

  function handleColDrop(e: DragEvent<HTMLElement>, parentId: number | null) {
    e.preventDefault();
    e.stopPropagation();
    const raw = e.dataTransfer.getData("text/plain");
    const dragged = draggedId ?? (raw ? Number(raw) : null);
    if (dragged == null) {
      setDraggedId(null);
      return;
    }
    void moveTo(dragged, parentId);
  }

  if (loading && locations.length === 0 && !loadError) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка колонок">
        <div className="search-skeleton-pulse" style={{ height: 34 }} />
        <div className="search-skeleton-pulse" style={{ height: 120 }} />
      </div>
    );
  }

  return (
    <div className="stack geography-miller">
      <div className="row geography-miller__toolbar">
        {narrow && backLabel && (
          <button onClick={goBack} aria-label="Назад">
            {backLabel}
          </button>
        )}
        <button className="primary" onClick={() => setCreating(true)}>
          <NavIcon name="plus" /> Создать
        </button>
      </div>
      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)" }}>
          Не удалось загрузить географию: {loadError}{" "}
          <button className="primary" onClick={() => refresh()}>
            Повторить
          </button>
        </div>
      )}
      {creating && (
        <EntityWizard
          initialType="location"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
          onCreated={() => refresh()}
        />
      )}
      {wizardParentId !== null && (
        <EntityWizard
          initialType="location"
          ctx={{ settingId, defaults: { parentLocationId: wizardParentId } } as unknown as { settingId: number }}
          onClose={() => setWizardParentId(null)}
          onCreated={() => {
            setWizardParentId(null);
            refresh();
          }}
        />
      )}
      {confirmDialog}
      {alertDialog}
      {promptDialog}
      {menu && "createParent" in menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={
            menu.createParent != null
              ? (byId.get(menu.createParent)?.name ?? "Локация")
              : "Мир"
          }
          items={[
            {
              label: "Создать локацию",
              onClick: () =>
                menu.createParent != null
                  ? setWizardParentId(menu.createParent)
                  : setCreating(true),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && "id" in menu && byId.get(menu.id) && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title={byId.get(menu.id)!.name}
          items={menuItems(menu.id)}
          onClose={() => setMenu(null)}
        />
      )}
      {moveId !== null && byId.get(moveId) && (
        <Modal onClose={() => setMoveId(null)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Переместить «{byId.get(moveId)!.name}»</h3>
            <p className="muted" style={{ margin: 0 }}>
              Новое место в мире (вложенность сменится):
            </p>
            <LocationCascadePicker
              locations={locations.filter((l) => !l.archived_at)}
              value={moveParent}
              onChange={setMoveParent}
              rootLabel="Верхний уровень"
              clearLabel="✕ В корень"
            />
            <div className="row" style={{ justifyContent: "flex-end", gap: 8 }}>
              <button onClick={() => setMoveId(null)}>Отмена</button>
              <button className="primary" onClick={confirmMove}>
                Переместить
              </button>
            </div>
          </div>
        </Modal>
      )}
      {columns[0].items.length === 0 && !loadError ? (
        <EmptyState
          title="Пока пусто"
          hint="Создайте первую локацию — она станет корнем."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              Создать локацию
            </button>
          }
        />
      ) : (
        <div className="miller-cols" ref={wrapRef} role="list" aria-label="Колонки локаций">
          {columns.map((col, i) => {
            if (narrow && i !== active) return null;
            const parentIdx = col.parent ? cleanPath.indexOf(col.parent.id) : -1;
            const activeId = cleanPath[parentIdx + 1] ?? null;
            const rail = !narrow && (widths[i] ?? COL_FULL) < COL_RAIL;
            return (
              <div
                className={`miller-col${i === active ? " is-active-col" : ""}${rail ? " is-rail" : ""}`}
                style={{ width: narrow ? "100%" : (widths[i] ?? COL_FULL) }}
                key={col.parent ? col.parent.id : "root"}
                role="listitem"
                aria-label={col.parent ? col.parent.name : "Верхний уровень"}
              >
                <button
                  className="miller-col__title"
                  onClick={() => setActiveCol(i)}
                  title={col.parent ? `${col.parent.name} — развернуть колонку` : "Мир — развернуть колонку"}
                >
                  <span>{col.parent ? col.parent.name : "Мир"}</span>
                  <span className="miller-col__count">{col.items.length}</span>
                </button>
                <div
                  className="miller-col__body"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleColDrop(e, col.parent ? col.parent.id : null)}
                  onContextMenu={(e) => {
                    if ((e.target as HTMLElement).closest(".miller-item")) return;
                    e.preventDefault();
                    const pid = col.parent ? col.parent.id : null;
                    setMenu({ x: e.clientX, y: e.clientY, id: pid ?? -1 });
                  }}
                >
                  {col.items.map((l) => {
                    const kids = (kidsOf.get(l.id) ?? []).length;
                    const isActive = l.id === activeId;
                    const isOver = dragOverId === l.id && draggedId !== l.id;
                    return (
                      <button
                        key={l.id}
                        className={`miller-item${isActive ? " is-active" : ""}${isOver ? " drag-over" : ""}`}
                        aria-current={isActive ? "true" : undefined}
                        onClick={() => pick(l.id)}
                        title={l.name}
                        draggable
                        onDragStart={(e) => handleDragStart(e, l.id)}
                        onDragEnd={() => {
                          setDraggedId(null);
                          setDragOverId(null);
                        }}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (draggedId == null || draggedId === l.id) return;
                          if (isDescendantOf(draggedId, l.id)) return;
                          setDragOverId(l.id);
                        }}
                        onDragLeave={() => setDragOverId((prev) => (prev === l.id ? null : prev))}
                        onDrop={(e) => handleItemDrop(e, l.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setMenu({ x: e.clientX, y: e.clientY, id: l.id });
                        }}
                      >
                        <span className="miller-item__name">{l.name}</span>
                        <span className="miller-item__meta">
                          {l.kind && <span className="miller-item__kind">{l.kind}</span>}
                          {(l.map_image_path || l.map_image_url) && (
                            <span title="Есть карта">
                              <NavIcon name="map" />
                            </span>
                          )}
                          {kids > 0 && <span className="miller-item__count">{kids}</span>}
                          {kids > 0 && <NavIcon name="arrowRight" />}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {focus && (!narrow || active === columns.length) && (
            <div
              className={`miller-col miller-preview${active === columns.length ? " is-active-col" : ""}${!narrow && (widths[columns.length] ?? COL_FULL) < COL_RAIL ? " is-rail" : ""}`}
              style={{ width: narrow ? "100%" : (widths[columns.length] ?? COL_FULL) }}
              role="listitem"
              aria-label={`Карточка: ${focus.name}`}
            >
              <button
                className="miller-col__title"
                onClick={() => setActiveCol(columns.length)}
                title="Карточка — развернуть колонку"
              >
                <span>Карточка</span>
              </button>
              <div className="miller-col__body">
                <div className="miller-preview__top">
                  {focusSafeThumb ? (
                    <img src={focusSafeThumb} alt="" className="miller-preview__thumb" />
                  ) : (
                    <div className="miller-preview__nothumb muted">Нет изо</div>
                  )}
                  <div style={{ minWidth: 0 }}>
                    <strong className="miller-preview__name">{focus.name}</strong>
                    {focus.kind && <div className="miller-preview__kind">{focus.kind}</div>}
                  </div>
                </div>
                <dl className="location-sidecard__stats" style={{ marginTop: 8 }}>
                  <div>
                    <dt>Вложенных</dt>
                    <dd>{focusDescCount}</dd>
                  </div>
                  <div>
                    <dt>Население</dt>
                    <dd>{focusLoading && !shownDetail ? "…" : focusPopulation}</dd>
                  </div>
                  <div>
                    <dt>Сообществ</dt>
                    <dd>{focusLoading && !shownDetail ? "…" : (shownDetail?.inhabitant_communities.length ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>Статей</dt>
                    <dd>{focusLoading && !shownDetail ? "…" : (shownDetail?.chapters.length ?? 0)}</dd>
                  </div>
                </dl>
                <div className="muted miller-preview__stats">
                  {(focus.map_image_path || focus.map_image_url) ? "Есть карта" : "Без карты"}
                  {(focus.description ?? "").trim() ? "" : " · без описания"}
                </div>
                {focus.description && (
                  <p className="miller-preview__desc">{focus.description.slice(0, 220)}{focus.description.length > 220 ? "…" : ""}</p>
                )}
                <div className="miller-preview__actions">
                  <Link to={`/locations/${focus.id}`}>Открыть →</Link>
                  <button onClick={() => setWizardParentId(focus.id)}>
                    <NavIcon name="plus" /> Вложенная
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
      <p className="muted geography-root__hint">
        Колонки: клик проваливается внутрь. Активная — самая широкая, дальние схлопываются
        первыми; клик по шапке разворачивает колонку. Справа — карточка выбранного.
      </p>
    </div>
  );
}
