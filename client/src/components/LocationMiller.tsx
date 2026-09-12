import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { invalidateAffects } from "../data/entities";
import { useResource } from "../data/hooks";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { Modal } from "./Modal";
import { LocationCascadePicker } from "./LocationCascadePicker";
import { EntityWizard } from "./entityWizard/EntityWizard";
import { PlaceCard } from "./PlaceCard";
import { plainMentions } from "../utils/plainMentions";
import { LOCATION_ROLE_LABELS, locationRoleIcon, locationRoleOf } from "../locationRoles";
import { useAlert, useConfirm, usePrompt } from "../hooks/useConfirm";
import { useUndoDelete } from "../hooks/useUndoDelete";
import { isSafeImageUrl } from "../utils/safeUrl";
import type { SettingLocation } from "../types";

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

function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  const word = m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
  return `${n} ${word}`;
}

const COL_FULL = 240;
const COL_MIN = 52;
const COL_RAIL = 140;
const COL_GAP = 20;
// Карточка справа постоянной ширины и в аккордеон колонок не входит.
const CARD_W = 320;
// Уже этого — одна колонка (или карточка) на всю ширину с «Назад».
const NARROW_MAX = 640;
// Чипов корней в строке; остальные — под «ещё N». Корней на сеттинг обычно
// 1–4 (данные 2026-09-11), предел для плоских импортов.
const ROOT_CHIPS = 6;

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

type MenuState =
  | { x: number; y: number; id: number }
  | { x: number; y: number; createParent: number | null }
  | { x: number; y: number; roots: true };

/** Проводник географии (решения 2026-09-11, §1): корни мира — чипами сверху,
 * колонки Миллера — от детей выбранного корня, справа — карточка места.
 * Аккордеон: места мало — дальние от активной колонки схлопываются первыми. */
export function LocationMiller({ settingId }: { settingId: number }) {
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [path, setPath] = useState<number[]>(() => loadPath(settingId));
  const [activeCol, setActiveCol] = useState(0);
  const [workW, setWorkW] = useState(0);
  const [creating, setCreating] = useState(false);
  const [wizardParentId, setWizardParentId] = useState<number | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [dragOverId, setDragOverId] = useState<number | null>(null);
  const [dragOverRoots, setDragOverRoots] = useState(false);
  const [moveId, setMoveId] = useState<number | null>(null);
  const [moveParent, setMoveParent] = useState<number | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [promptDialog, promptText] = usePrompt();
  const { deleteWithUndo } = useUndoDelete();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const workRef = useRef<HTMLDivElement>(null);
  // Флажки «Партия здесь»: путь до места партии каждой кампании сеттинга
  // (решения 2026-09-11, §3, п. 5).
  const { data: partyPlaces } = useResource<
    { campaign_id: number; campaign_name: string; location_id: number; path_ids: number[] }[]
  >(`/settings/${settingId}/party-places`);
  const partyByPlace = useMemo(() => {
    const m = new Map<number, string[]>();
    for (const p of partyPlaces ?? []) {
      for (const id of p.path_ids) m.set(id, [...(m.get(id) ?? []), p.campaign_name]);
    }
    return m;
  }, [partyPlaces]);

  // Без массива зависимостей сознательно: рабочая область монтируется позже
  // скелетона, одноразовый эффект на монтировании рефа бы не нашёл и ширина
  // осталась бы 0.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    const el = workRef.current;
    if (!el) return;
    const ro = new ResizeObserver((es) => {
      const w = es[0].contentRect.width;
      setWorkW((prev) => (prev === w ? prev : w));
    });
    ro.observe(el);
    setWorkW(el.clientWidth);
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
    // Карточка места читает деталь через слой данных: переименование,
    // перенос и новое вложенное задевают и её.
    void invalidateAffects(queryClient, [{ kind: "location" }]);
    return () => controller.abort();
  }, [settingId, queryClient]);
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
  // Дети, по которым ведут колонки: точки всегда листья и живут в карточке
  // (план «Зоны локаций», этап 3).
  const navKidsOf = useMemo(() => {
    const m = new Map<number | null, SettingLocation[]>();
    for (const [pid, list] of kidsOf) m.set(pid, list.filter((k) => locationRoleOf(k) !== "spot"));
    return m;
  }, [kidsOf]);

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

  const roots = useMemo(() => kidsOf.get(null) ?? [], [kidsOf]);
  // Вход в раздел — последний выбранный корень (он первым лежит в пути),
  // иначе первый по алфавиту.
  const rootId = cleanPath[0] ?? roots[0]?.id ?? null;
  const root = rootId != null ? (byId.get(rootId) ?? null) : null;
  const effPath = useMemo(
    () => (cleanPath.length > 0 ? cleanPath : rootId != null ? [rootId] : []),
    [cleanPath, rootId]
  );

  const columns = useMemo(() => {
    const cols: { parent: SettingLocation; items: SettingLocation[] }[] = [];
    for (const id of effPath) {
      const parent = byId.get(id);
      const items = navKidsOf.get(id) ?? [];
      if (parent && items.length > 0) cols.push({ parent, items });
    }
    return cols;
  }, [effPath, byId, navKidsOf]);

  const focus: SettingLocation | null = effPath.length > 0 ? (byId.get(effPath[effPath.length - 1]) ?? null) : null;

  // Счёт корня: места и точки всей ветки.
  const rootTotals = useMemo(() => {
    const out = { places: 0, spots: 0 };
    if (rootId == null) return out;
    const stack = (kidsOf.get(rootId) ?? []).map((l) => l.id);
    const seen = new Set<number>([rootId]);
    while (stack.length) {
      const id = stack.pop()!;
      if (seen.has(id)) continue;
      seen.add(id);
      const loc = byId.get(id);
      if (loc && !loc.archived_at) {
        if (locationRoleOf(loc) === "spot") out.spots += 1;
        else out.places += 1;
      }
      for (const k of kidsOf.get(id) ?? []) stack.push(k.id);
    }
    return out;
  }, [rootId, kidsOf, byId]);

  const crumbs = useMemo(
    () => effPath.map((id) => byId.get(id)).filter((l): l is SettingLocation => !!l),
    [effPath, byId]
  );

  // Строка чипов одной высоты при любом мире: выбранный корень виден всегда.
  const { shownRoots, hiddenRoots } = useMemo(() => {
    if (roots.length <= ROOT_CHIPS + 1) return { shownRoots: roots, hiddenRoots: [] as SettingLocation[] };
    const shown = roots.slice(0, ROOT_CHIPS);
    if (rootId != null && !shown.some((r) => r.id === rootId)) {
      const picked = roots.find((r) => r.id === rootId);
      if (picked) shown[ROOT_CHIPS - 1] = picked;
    }
    const shownIds = new Set(shown.map((r) => r.id));
    return { shownRoots: shown, hiddenRoots: roots.filter((r) => !shownIds.has(r.id)) };
  }, [roots, rootId]);

  const colCount = columns.length;
  const narrow = workW > 0 && workW < NARROW_MAX;
  // Индекс colCount в узком режиме — экран карточки.
  const active = Math.min(Math.max(activeCol, 0), narrow ? colCount : Math.max(colCount - 1, 0));
  const widths = useMemo(
    () =>
      millerWidths(
        colCount,
        Math.min(active, colCount - 1),
        workW - CARD_W - COL_GAP - COL_GAP * Math.max(colCount - 1, 0)
      ),
    [colCount, active, workW]
  );

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

  // Сколько колонок даст путь: по одной на каждое место с навигационными детьми.
  function colsFor(chain: number[]): number {
    return chain.filter((pid) => (navKidsOf.get(pid) ?? []).length > 0).length;
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
    const cols = colsFor(chain);
    const leaf = (navKidsOf.get(id) ?? []).length === 0;
    setPath(chain);
    setActiveCol(leaf ? cols : Math.max(cols - 1, 0));
  }

  function goBack() {
    if (active >= colCount && colCount > 0) {
      setActiveCol(colCount - 1);
      return;
    }
    if (cleanPath.length <= 1) return;
    const next = cleanPath.slice(0, -1);
    setPath(next);
    setActiveCol(Math.max(colsFor(next) - 1, 0));
  }

  const backLabel =
    active >= colCount && colCount > 0
      ? "К списку"
      : cleanPath.length > 1
        ? `‹ ${byId.get(cleanPath[cleanPath.length - 2])?.name ?? "Назад"}`
        : null;

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
      if (locationRoleOf(byId.get(targetParent) ?? {}) === "spot") {
        showAlert("Точка ничего не содержит — вложить в неё нельзя.");
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
      setDragOverRoots(false);
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
    const items: ContextMenuItem[] = [
      { label: "Переименовать", onClick: () => rename(id) },
      { label: "Открыть", onClick: () => navigate(`/locations/${id}`) },
      { label: "Карточка", onClick: () => pick(id) },
      { label: "Переместить", onClick: () => openMove(id) },
      { label: "Удалить", danger: true, onClick: () => archive(id) },
    ];
    if (locationRoleOf(byId.get(id) ?? {}) !== "spot") {
      items.splice(3, 0, { label: "Создать внутри", onClick: () => setWizardParentId(id) });
    }
    return items;
  }

  function badgeFor(l: SettingLocation): string {
    return l.kind?.trim() || LOCATION_ROLE_LABELS[locationRoleOf(l)];
  }

  function renderMillerRow(l: SettingLocation, activeId: number | null) {
    const kids = kidsOf.get(l.id) ?? [];
    const navKids = (navKidsOf.get(l.id) ?? []).length;
    const spotKids = kids.length - navKids;
    const isActive = l.id === activeId;
    const isOver = dragOverId === l.id && draggedId !== l.id;
    const hasMap = !!(l.map_image_path || l.map_image_url);
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
          setDragOverRoots(false);
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
        <NavIcon name={locationRoleIcon(l)} className="miller-item__icon" />
        <span className="miller-item__body">
          <span className="miller-item__name">{l.name}</span>
          <span className="miller-item__badge">
            {badgeFor(l)}
            {navKids > 0 ? ` · ${navKids}` : spotKids > 0 ? ` · ${plural(spotKids, "точка", "точки", "точек")}` : ""}
            {hasMap ? " · карта" : ""}
          </span>
        </span>
        {partyByPlace.has(l.id) && (
          <span className="miller-item__party" title={`Партия: ${partyByPlace.get(l.id)!.join(", ")}`}>
            <NavIcon name="flag" />
          </span>
        )}
        {navKids > 0 && <NavIcon name="arrowRight" />}
      </button>
    );
  }

  function handleDragStart(e: DragEvent<HTMLElement>, id: number) {
    e.stopPropagation();
    setDraggedId(id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id));
  }

  function droppedId(e: DragEvent<HTMLElement>): number | null {
    const raw = e.dataTransfer.getData("text/plain");
    return draggedId ?? (raw ? Number(raw) : null);
  }

  function handleItemDrop(e: DragEvent<HTMLElement>, targetId: number) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverId(null);
    setDragOverRoots(false);
    const dragged = droppedId(e);
    if (dragged == null || dragged === targetId) {
      setDraggedId(null);
      return;
    }
    void moveTo(dragged, targetId);
  }

  function handleAreaDrop(e: DragEvent<HTMLElement>, parentId: number | null) {
    e.preventDefault();
    e.stopPropagation();
    setDragOverRoots(false);
    const dragged = droppedId(e);
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

  const rootThumb = root ? root.thumbnail_image_url || root.avatar_image_url : null;
  const rootSafeThumb = rootThumb && isSafeImageUrl(rootThumb) ? rootThumb : null;
  const rootSub = root
    ? [root.kind?.trim(), plainMentions(root.description ?? "").replace(/\s+/g, " ").trim()].filter(Boolean).join(" · ")
    : "";

  return (
    <div className="stack geography-miller">
      <div className="row geography-miller__toolbar">
        {narrow && backLabel && (
          <button onClick={goBack} aria-label="Назад">
            {backLabel}
          </button>
        )}
        <span style={{ flex: 1 }} />
        {focus && locationRoleOf(focus) !== "spot" && (
          <span className="muted geography-miller__target" title="Новое место появится внутри выбранного">
            внутрь: {focus.name}
          </span>
        )}
        <button
          className="primary"
          onClick={() =>
            focus && locationRoleOf(focus) !== "spot" ? setWizardParentId(focus.id) : setCreating(true)
          }
        >
          <NavIcon name="plus" /> Создать
        </button>
      </div>

      {roots.length > 0 && !loadError && (
        <>
          <div
            className={`miller-roots${dragOverRoots ? " drag-over" : ""}`}
            role="toolbar"
            aria-label="Корни мира"
            onDragOver={(e) => {
              e.preventDefault();
              if (draggedId != null) setDragOverRoots(true);
            }}
            onDragLeave={(e) => {
              const rt = e.relatedTarget as Node | null;
              if (rt && e.currentTarget.contains(rt)) return;
              setDragOverRoots(false);
            }}
            onDrop={(e) => handleAreaDrop(e, null)}
            onContextMenu={(e) => {
              if ((e.target as HTMLElement).closest(".miller-chip")) return;
              e.preventDefault();
              setMenu({ x: e.clientX, y: e.clientY, createParent: null });
            }}
            title="Бросьте сюда место, чтобы сделать его корнем мира"
          >
            <span className="miller-roots__label">Мир</span>
            {shownRoots.map((k) => {
              const isOver = dragOverId === k.id && draggedId !== k.id;
              return (
                <button
                  key={k.id}
                  className={`miller-chip${k.id === rootId ? " is-active" : ""}${isOver ? " drag-over" : ""}`}
                  aria-pressed={k.id === rootId}
                  onClick={() => pick(k.id)}
                  title={k.name}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (draggedId == null || draggedId === k.id || isDescendantOf(draggedId, k.id)) return;
                    setDragOverRoots(false);
                    setDragOverId(k.id);
                  }}
                  onDragLeave={() => setDragOverId((prev) => (prev === k.id ? null : prev))}
                  onDrop={(e) => handleItemDrop(e, k.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setMenu({ x: e.clientX, y: e.clientY, id: k.id });
                  }}
                >
                  <NavIcon name="globe" /> {k.name}
                </button>
              );
            })}
            {hiddenRoots.length > 0 && (
              <button
                className="miller-chip miller-chip--more"
                onClick={(e) => {
                  const r = e.currentTarget.getBoundingClientRect();
                  setMenu({ x: r.left, y: r.bottom + 4, roots: true });
                }}
              >
                ещё {hiddenRoots.length} ▾
              </button>
            )}
          </div>

          {root && (
            <section className="miller-root" aria-label="Корень мира">
              {rootSafeThumb && <img src={rootSafeThumb} alt="" className="miller-root__thumb" />}
              <div className="miller-root__body">
                <button className="miller-root__title" onClick={() => pick(root.id)} title="Карточка корня">
                  {root.name}
                </button>
                {rootSub && <div className="muted miller-root__sub">{rootSub}</div>}
              </div>
              <div className="muted miller-root__count">
                {plural(rootTotals.places, "локация", "локации", "локаций")}
                {rootTotals.spots > 0 ? ` · ${plural(rootTotals.spots, "точка", "точки", "точек")}` : ""}
              </div>
            </section>
          )}

          {crumbs.length > 1 && (
            <nav className="miller-crumbs" aria-label="Путь в мире">
              {crumbs.map((c, idx) => {
                const last = idx === crumbs.length - 1;
                return (
                  <span key={c.id} className="miller-crumb__seg">
                    {idx > 0 && <span className="miller-crumb__sep" aria-hidden="true"> / </span>}
                    {last ? (
                      <span className="miller-crumb is-current" aria-current="page">{c.name}</span>
                    ) : (
                      <button className="miller-crumb" onClick={() => pick(c.id)} title={`Перейти: ${c.name}`}>
                        {c.name}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
          )}
        </>
      )}

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
          title={menu.createParent != null ? (byId.get(menu.createParent)?.name ?? "Локация") : "Мир"}
          items={[
            {
              label: menu.createParent != null ? "Создать локацию здесь" : "Создать корень мира",
              onClick: () => (menu.createParent != null ? setWizardParentId(menu.createParent) : setCreating(true)),
            },
          ]}
          onClose={() => setMenu(null)}
        />
      )}
      {menu && "roots" in menu && (
        <ContextMenu
          x={menu.x}
          y={menu.y}
          title="Корни мира"
          items={hiddenRoots.map((r) => ({ label: r.name, onClick: () => pick(r.id) }))}
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
      {roots.length === 0 && !loadError ? (
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
        <div className={`miller-work${narrow ? " is-narrow" : ""}`} ref={workRef}>
          {colCount > 0 && (!narrow || active < colCount) && (
            <div className="miller-cols" role="list" aria-label="Колонки локаций">
              {columns.map((col, i) => {
                if (narrow && i !== active) return null;
                const parentIdx = effPath.indexOf(col.parent.id);
                const activeId = effPath[parentIdx + 1] ?? null;
                const rail = !narrow && (widths[i] ?? COL_FULL) < COL_RAIL;
                return (
                  <div
                    className={`miller-col${i === active ? " is-active-col" : ""}${rail ? " is-rail" : ""}`}
                    style={{ width: narrow ? "100%" : (widths[i] ?? COL_FULL) }}
                    key={col.parent.id}
                    role="listitem"
                    aria-label={col.parent.name}
                  >
                    <button
                      className="miller-col__title"
                      onClick={() => setActiveCol(i)}
                      title={`${col.parent.name} — развернуть колонку`}
                    >
                      <span>{col.parent.name}</span>
                      <span className="miller-col__count">{plural(col.items.length, "локация", "локации", "локаций")}</span>
                    </button>
                    <div
                      className="miller-col__body"
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => handleAreaDrop(e, col.parent.id)}
                      onContextMenu={(e) => {
                        if ((e.target as HTMLElement).closest(".miller-item")) return;
                        e.preventDefault();
                        setMenu({ x: e.clientX, y: e.clientY, createParent: col.parent.id });
                      }}
                    >
                      {(() => {
                        // Секторы отдельно от локаций; заголовки — только когда
                        // обе секции непусты, иначе это шум (этап 3).
                        const sectors = col.items.filter((l) => locationRoleOf(l) === "sector");
                        const places = col.items.filter((l) => locationRoleOf(l) !== "sector");
                        const showHeads = sectors.length > 0 && places.length > 0;
                        return (
                          <>
                            {showHeads && <div className="miller-sec">Секторы</div>}
                            {sectors.map((l) => renderMillerRow(l, activeId))}
                            {showHeads && <div className="miller-sec">Локации</div>}
                            {places.map((l) => renderMillerRow(l, activeId))}
                          </>
                        );
                      })()}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {focus && (!narrow || active >= colCount) && (
            <aside className="miller-card" aria-label={`Карточка: ${focus.name}`}>
              <PlaceCard
                key={focus.id}
                locationId={focus.id}
                onPick={pick}
                onAddChild={(id) => setWizardParentId(id)}
                partyCampaigns={(partyPlaces ?? []).filter((p) => p.location_id === focus.id).map((p) => p.campaign_name)}
              />
            </aside>
          )}
        </div>
      )}
    </div>
  );
}
