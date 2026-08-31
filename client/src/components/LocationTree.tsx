import { useEffect, useState, useRef } from "react";
import type { DragEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import { loadThumbnailStyles } from "../thumbnailStyles";
import { NavIcon } from "./NavIcons";
import { EntityWizard } from "./entityWizard/EntityWizard";
import { EmptyState } from "./EmptyState";
import { isSafeImageUrl } from "../utils/safeUrl";
import { useConfirm } from "../hooks/useConfirm";
import { addToBag } from "../bag";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { buildMentionToken } from "../mentions";
import type { SettingLocation } from "../types";

interface Props {
  settingId: number;
}

const KIND_SUGGESTIONS = ["континент", "страна", "область", "город", "деревня", "район", "улица", "здание", "таверна", "храм", "замок", "башня", "подземелье", "лес", "гора", "река"] as const;

export function LocationTree({ settingId }: Props) {
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [creating, setCreating] = useState(false);
  const [wizardParentId, setWizardParentId] = useState<number | null>(null);
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [kindFilter, setKindFilter] = useState<string>("");
  const [sortMode, setSortMode] = useState<"name" | "kind">("name");
  const [lastArchived, setLastArchived] = useState<{ id: number; name: string } | null>(null);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const [mapFilter, setMapFilter] = useState<"" | "with" | "without">("");
  const [descFilter, setDescFilter] = useState<"" | "with" | "without">("");
  const [confirmDialog, confirm] = useConfirm();
  const treeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(`geography-open-${settingId}`);
      if (raw && treeRef.current) {
        const ids = new Set<number>(JSON.parse(raw) as number[]);
        treeRef.current.querySelectorAll("details[data-location-id]").forEach((el) => {
          const id = Number((el as HTMLElement).dataset.locationId);
          if (ids.has(id)) (el as HTMLDetailsElement).open = true;
        });
      }
    } catch {}
  }, [settingId, locations]);

  useEffect(() => {
    const root = treeRef.current;
    if (!root) return;
    const handler = (e: Event) => {
      const target = e.target as HTMLElement;
      if (target.tagName !== "DETAILS") return;
      const id = Number((target as HTMLElement).dataset.locationId);
      if (!Number.isFinite(id)) return;
      try {
        const raw = localStorage.getItem(`geography-open-${settingId}`);
        const set = new Set<number>(raw ? (JSON.parse(raw) as number[]) : []);
        if ((target as HTMLDetailsElement).open) set.add(id);
        else set.delete(id);
        localStorage.setItem(`geography-open-${settingId}`, JSON.stringify([...set]));
      } catch {}
    };
    root.addEventListener("toggle", handler, true);
    return () => root.removeEventListener("toggle", handler, true);
  }, [settingId]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(t);
  }, [rawQuery]);

  function refresh() {
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
  }
  useEffect(() => {
    const cleanup = refresh();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settingId]);

  const uniqueKinds = Array.from(
    new Set(locations.map((l) => (l.kind ?? "").trim().toLowerCase()).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b, "ru"));

  const kindFilterLower = kindFilter.trim().toLowerCase();
  let filteredLocations = kindFilterLower
    ? locations.filter((l) => (l.kind ?? "").trim().toLowerCase() === kindFilterLower)
    : locations;
  if (mapFilter === "with") filteredLocations = filteredLocations.filter((l) => !!(l.map_image_path || l.map_image_url));
  else if (mapFilter === "without") filteredLocations = filteredLocations.filter((l) => !(l.map_image_path || l.map_image_url));
  if (descFilter === "with") filteredLocations = filteredLocations.filter((l) => !!(l.description ?? "").trim());
  else if (descFilter === "without") filteredLocations = filteredLocations.filter((l) => !(l.description ?? "").trim());

  const byParent = new Map<number | null, SettingLocation[]>();
  const byParentAll = new Map<number | null, SettingLocation[]>();
  const byIdAll = new Map<number, SettingLocation>();
  for (const l of locations) {
    byIdAll.set(l.id, l);
    const listAll = byParentAll.get(l.parent_id) ?? [];
    listAll.push(l);
    byParentAll.set(l.parent_id, listAll);
  }
  for (const l of filteredLocations) {
    const list = byParent.get(l.parent_id) ?? [];
    list.push(l);
    byParent.set(l.parent_id, list);
  }
  for (const list of byParent.values()) {
    if (sortMode === "kind") {
      list.sort(
        (a, b) =>
          (a.kind ?? "").toLowerCase().localeCompare((b.kind ?? "").toLowerCase(), "ru") ||
          a.name.localeCompare(b.name, "ru", { numeric: true })
      );
    } else {
      list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    }
  }
  const roots = byParent.get(null) ?? [];

  const stats = (() => {
    const withoutDesc = locations.filter((l) => !(l.description ?? "").trim()).length;
    const withoutMap = locations.filter((l) => !(l.map_image_path || l.map_image_url)).length;
    let maxDepth = 0;
    const queue: Array<{ id: number; d: number }> = roots.map((r) => ({ id: r.id, d: 1 }));
    const visited = new Set<number>();
    while (queue.length) {
      const cur = queue.shift()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      maxDepth = Math.max(maxDepth, cur.d);
      for (const child of byParentAll.get(cur.id) ?? []) queue.push({ id: child.id, d: cur.d + 1 });
    }
    return { total: locations.length, withoutDesc, withoutMap, maxDepth };
  })();

  const minimapItems = (() => {
    const out: Array<{ id: number; name: string; depth: number; hasMap: boolean }> = [];
    const stack: Array<{ id: number; depth: number }> = roots.map((r) => ({ id: r.id, depth: 0 })).reverse();
    const visited = new Set<number>();
    while (stack.length) {
      const cur = stack.pop()!;
      if (visited.has(cur.id)) continue;
      visited.add(cur.id);
      const loc = byIdAll.get(cur.id);
      if (!loc) continue;
      out.push({ id: loc.id, name: loc.name, depth: cur.depth, hasMap: !!(loc.map_image_path || loc.map_image_url) });
      const kids = (byParentAll.get(cur.id) ?? []).slice().sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
      for (let i = kids.length - 1; i >= 0; i--) stack.push({ id: kids[i].id, depth: cur.depth + 1 });
    }
    return out;
  })();

  function breadcrumb(loc: SettingLocation): string {
    const parts: string[] = [];
    let cur: SettingLocation | undefined = loc;
    const visited = new Set<number>();
    while (cur && !visited.has(cur.id)) {
      visited.add(cur.id);
      parts.unshift(cur.name);
      cur = cur.parent_id != null ? byIdAll.get(cur.parent_id) : undefined;
    }
    return parts.join(" → ");
  }

  function highlight(text: string, query: string): React.ReactNode {
    if (!query) return text;
    const idx = text.toLowerCase().indexOf(query.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", padding: "0 1px" }}>
          {text.slice(idx, idx + query.length)}
        </mark>
        {text.slice(idx + query.length)}
      </>
    );
  }

  function isDescendant(ancestorId: number, maybeDescendantId: number): boolean {
    let cur: SettingLocation | undefined = byIdAll.get(maybeDescendantId);
    const visited = new Set<number>();
    while (cur && cur.parent_id != null && !visited.has(cur.id)) {
      if (cur.parent_id === ancestorId) return true;
      visited.add(cur.id);
      cur = byIdAll.get(cur.parent_id);
    }
    return false;
  }

  function expandAll() {
    treeRef.current?.querySelectorAll("details").forEach((el) => {
      (el as HTMLDetailsElement).open = true;
    });
  }
  function collapseAll() {
    treeRef.current?.querySelectorAll("details").forEach((el) => {
      (el as HTMLDetailsElement).open = false;
    });
  }

  async function handleRestoreLastArchived() {
    if (!lastArchived) return;
    try {
      await api.put(`/setting-locations/${lastArchived.id}/restore`);
      setLastArchived(null);
      refresh();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    }
  }

  async function handleDropRoot(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    if (draggedId == null) return;
    try {
      await api.put(`/setting-locations/${draggedId}/parent`, { parent_id: null });
      refresh();
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
    } finally {
      setDraggedId(null);
    }
  }

  function handleTreeKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const target = e.target as HTMLElement;
    if (target.tagName !== "SUMMARY") return;
    const summaries = Array.from(treeRef.current?.querySelectorAll("summary.geography-node-header") ?? []) as HTMLElement[];
    const idx = summaries.indexOf(target);
    if (e.key === "ArrowDown") {
      e.preventDefault();
      summaries[Math.min(idx + 1, summaries.length - 1)]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      summaries[Math.max(idx - 1, 0)]?.focus();
    } else if (e.key === "ArrowRight") {
      const details = target.parentElement as HTMLDetailsElement;
      if (!details.open) details.open = true;
    } else if (e.key === "ArrowLeft") {
      const details = target.parentElement as HTMLDetailsElement;
      if (details.open) details.open = false;
      else {
        const parentDetails = target.closest(".geography-children")?.parentElement as HTMLDetailsElement | null;
        parentDetails?.querySelector<HTMLElement>("summary.geography-node-header")?.focus();
      }
    }
  }

  const q = debouncedQuery.trim().toLowerCase();
  const matches = q
    ? filteredLocations.filter((l) => {
        const hay = [l.name, l.kind ?? "", l.name_original ?? "", ...(l.aliases ?? [])].join(" ").toLowerCase();
        return hay.includes(q);
      })
    : null;
  const flatFiltered = !q && (kindFilterLower || mapFilter || descFilter) ? [...filteredLocations].sort((a, b) => {
    if (sortMode === "kind") return (a.kind ?? "").toLowerCase().localeCompare((b.kind ?? "").toLowerCase(), "ru") || a.name.localeCompare(b.name, "ru", { numeric: true });
    return a.name.localeCompare(b.name, "ru", { numeric: true });
  }) : null;
  const flatList = matches ?? flatFiltered;

  // Auto-expand ancestors of search matches so highlight is visible in tree (when not using flat list)
  useEffect(() => {
    const qq = debouncedQuery.trim().toLowerCase();
    if (!qq || !treeRef.current) return;
    // When flatList is active, tree is hidden — no need to expand
    if (flatList) return;
    const matching = locations.filter((l) => {
      const hay = [l.name, l.kind ?? "", l.name_original ?? "", ...(l.aliases ?? [])].join(" ").toLowerCase();
      return hay.includes(qq);
    });
    const toOpen = new Set<number>();
    for (const m of matching) {
      let cur: SettingLocation | undefined = m;
      const visited = new Set<number>();
      while (cur && cur.parent_id != null && !visited.has(cur.id)) {
        visited.add(cur.id);
        toOpen.add(cur.parent_id);
        cur = byIdAll.get(cur.parent_id);
      }
    }
    treeRef.current.querySelectorAll("details[data-location-id]").forEach((el) => {
      const id = Number((el as HTMLElement).dataset.locationId);
      if (toOpen.has(id)) (el as HTMLDetailsElement).open = true;
    });
  }, [debouncedQuery, locations, flatList]);

  if (loading && locations.length === 0 && !loadError) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка географии">
        <div
          className="card"
          style={{
            height: 80,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
          }}
        />
        <div
          className="card"
          style={{
            height: 120,
            opacity: 0.45,
            background: "var(--bg-elevated)",
            animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate",
            animationDelay: "120ms",
          }}
        />
      </div>
    );
  }

  return (
    <div className="stack">
      {confirmDialog}
      <p className="muted">
        Верхний уровень — континенты, миры, крупнейшие регионы. Разворачивайте узлы, чтобы
        добавлять вложенные локации (страны, города, районы, конкретные места).
      </p>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button className="primary" onClick={() => setCreating(true)}>
          Создать
        </button>
        <button onClick={expandAll} disabled={roots.length === 0}>
          Развернуть все
        </button>
        <button onClick={collapseAll} disabled={roots.length === 0}>
          Свернуть все
        </button>
      </div>
      {stats.total > 0 && (
        <div className="row muted" style={{ flexWrap: "wrap", gap: 12, fontSize: 11, fontFamily: "var(--font-mono)" }}>
          <span>
            Всего: {filteredLocations.length}
            {filteredLocations.length !== stats.total ? ` / ${stats.total}` : ""}
          </span>
          <span>Глубина: {stats.maxDepth}</span>
          <span style={{ color: stats.withoutDesc ? "var(--status-cancelled-fg)" : undefined }}>Без описания: {stats.withoutDesc}</span>
          <span style={{ color: stats.withoutMap ? "var(--status-cancelled-fg)" : undefined }}>Без карты: {stats.withoutMap}</span>
          {(stats.withoutDesc > 0 || stats.withoutMap > 0) && (
            <button
              style={{ fontSize: 11, padding: "2px 6px" }}
              onClick={() => {
                if (stats.withoutDesc > 0) setDescFilter("without");
                else setMapFilter("without");
              }}
            >
              Показать долги
            </button>
          )}
        </div>
      )}
      {lastArchived && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--accent)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Архивировано «{lastArchived.name}» — можно отменить.</span>
          <span className="row">
            <button className="primary" onClick={handleRestoreLastArchived}>
              Восстановить
            </button>
            <button onClick={() => setLastArchived(null)}>✕</button>
          </span>
        </div>
      )}
      {loadError && (
        <div
          className="card"
          style={{
            borderLeft: "3px solid var(--status-cancelled)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
          }}
        >
          <span>Не удалось загрузить географию: {loadError}</span>
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
      <div className="row" style={{ alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 }}>
          <div className="row" style={{ alignItems: "center" }}>
            <input
              placeholder="Поиск по названию, типу, алиасам…"
              value={rawQuery}
              onChange={(e) => setRawQuery(e.target.value)}
              style={{ flex: 1, minWidth: 0 }}
            />
            {rawQuery && <button onClick={() => setRawQuery("")}>✕</button>}
          </div>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {uniqueKinds.length > 0 && (
              <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)}>
                <option value="">Все типы</option>
                {uniqueKinds.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            )}
            <select value={mapFilter} onChange={(e) => setMapFilter(e.target.value as "" | "with" | "without")}>
              <option value="">Все карты</option>
              <option value="with">С картой</option>
              <option value="without">Без карты</option>
            </select>
            <select value={descFilter} onChange={(e) => setDescFilter(e.target.value as "" | "with" | "without")}>
              <option value="">Все описания</option>
              <option value="with">С описанием</option>
              <option value="without">Без описания</option>
            </select>
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as "name" | "kind")} title="Сортировка">
              <option value="name">Сорт: по имени</option>
              <option value="kind">Сорт: по типу</option>
            </select>
            {(kindFilter || mapFilter || descFilter || sortMode !== "name") && (
              <button
                onClick={() => {
                  setKindFilter("");
                  setMapFilter("");
                  setDescFilter("");
                  setSortMode("name");
                }}
              >
                Сбросить
              </button>
            )}
          </div>
          <datalist id="geo-kind-list">
            {KIND_SUGGESTIONS.map((k) => (
              <option key={k} value={k} />
            ))}
          </datalist>
          {flatList ? (
        <div
          className="stack"
          style={{
            gap: 4,
            maxHeight: flatList.length > 80 ? "60vh" : undefined,
            overflowY: flatList.length > 80 ? "auto" : undefined,
            paddingRight: flatList.length > 80 ? 4 : undefined,
          }}
        >
          {flatList.map((l) => (
            <Link
              key={l.id}
              to={`/locations/${l.id}`}
              className="card row"
              style={{ justifyContent: "space-between", contentVisibility: flatList.length > 80 ? ("auto" as const) : undefined, containIntrinsicSize: flatList.length > 80 ? "0 48px" : undefined }}
            >
              <span className="muted">{highlight(breadcrumb(l), debouncedQuery || kindFilter)}</span>
              {l.kind && <span className="muted">{highlight(l.kind, debouncedQuery || kindFilter)}</span>}
            </Link>
          ))}
          {flatList.length === 0 && (
            <EmptyState
              title="Ничего не найдено"
              hint={`По запросу «${(debouncedQuery || kindFilter || mapFilter || descFilter).trim()}» локаций нет.`}
              action={
                <button
                  onClick={() => {
                    setRawQuery("");
                    setKindFilter("");
                    setMapFilter("");
                    setDescFilter("");
                  }}
                >
                  Сбросить фильтры
                </button>
              }
            />
          )}
        </div>
      ) : (
          <div
            className="stack geography-drop-root"
          ref={treeRef}
          onKeyDown={handleTreeKeyDown}
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDropRoot}
          onDragLeave={(e) => {
            const t = e.currentTarget as HTMLElement;
            if (!t.contains(e.relatedTarget as Node)) t.classList.remove("drag-over");
          }}
          onDragEnter={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).classList.add("drag-over");
          }}
          style={{ flex: 1, minWidth: 0, minHeight: roots.length === 0 ? 40 : undefined, border: draggedId != null ? "1px dashed var(--line)" : undefined, padding: draggedId != null ? 8 : undefined }}
        >
          {roots.map((l) => (
            <LocationNode
              key={l.id}
              location={l}
              byParent={byParent}
              byParentAll={byParentAll}
              onChange={() => refresh()}
              onWizardParent={setWizardParentId}
              onArchived={(id, name) => setLastArchived({ id, name })}
              draggedId={draggedId}
              setDraggedId={setDraggedId}
              isDescendant={isDescendant}
              highlightQuery={debouncedQuery}
            />
          ))}
          {roots.length === 0 && !loading && !loadError && (
            <EmptyState
              title="География пока пуста"
              hint="Континенты, страны, города — начните с верхнего уровня. Разворачивайте узлы, чтобы добавлять вложенные."
              action={
                <button className="primary" onClick={() => setCreating(true)}>
                  Создать локацию
                </button>
              }
            />
          )}
          {draggedId != null && roots.length > 0 && (
            <p className="muted" style={{ textAlign: "center", fontSize: 11 }}>
              Перетащите на узел чтобы вложить, или сюда чтобы вернуть на верхний уровень
            </p>
          )}
          </div>
        )}
        </div>
        {minimapItems.length > 10 && (
          <div
            style={{
              position: "sticky",
              top: 12,
              width: 80,
              maxHeight: "60vh",
              overflowY: "auto",
              display: "flex",
              flexDirection: "column",
              gap: 2,
              padding: 4,
              border: "1px solid var(--line)",
              background: "var(--paper-2)",
              flexShrink: 0,
            }}
            title="Мини-карта иерархии — клик скроллит к узлу"
          >
            {minimapItems.map((it) => (
              <div
                key={it.id}
                onClick={() => {
                  const el = treeRef.current?.querySelector(`details[data-location-id="${it.id}"]`) as HTMLElement | null;
                  el?.scrollIntoView({ behavior: "smooth", block: "center" });
                  if (el && !(el as HTMLDetailsElement).open) (el as HTMLDetailsElement).open = true;
                }}
                title={it.name}
                style={{
                  height: 6,
                  marginLeft: it.depth * 6,
                  background: it.hasMap ? "var(--status-held)" : "var(--muted)",
                  opacity: it.hasMap ? 1 : 0.55,
                  borderRadius: 1,
                  cursor: "pointer",
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function LocationNode({
  location,
  byParent,
  byParentAll,
  onChange,
  onWizardParent,
  onArchived,
  draggedId,
  setDraggedId,
  isDescendant,
  highlightQuery,
}: {
  location: SettingLocation;
  byParent: Map<number | null, SettingLocation[]>;
  byParentAll?: Map<number | null, SettingLocation[]>;
  onChange: () => void;
  onWizardParent?: (id: number) => void;
  onArchived?: (id: number, name: string) => void;
  draggedId?: number | null;
  setDraggedId?: (id: number | null) => void;
  isDescendant?: (ancestorId: number, maybeDescendantId: number) => boolean;
  highlightQuery?: string;
}) {
  const [addingChild, setAddingChild] = useState(false);
  const [childName, setChildName] = useState("");
  const [childKind, setChildKind] = useState("");
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editKind, setEditKind] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const detailsRef = useRef<HTMLDetailsElement>(null);
  const navigate = useNavigate();
  useEffect(() => {
    if ((addingChild || editing) && detailsRef.current) detailsRef.current.open = true;
  }, [addingChild, editing]);
  const children = byParent.get(location.id) ?? [];
  const hasMap = !!(location.map_image_path || location.map_image_url);
  const depthCounts = (() => {
    const source = byParentAll ?? byParent;
    const counts: number[] = [];
    let frontier: number[] = [location.id];
    for (let d = 0; d < 4; d++) {
      const next: number[] = [];
      for (const id of frontier) {
        const kids = source.get(id) ?? [];
        for (const k of kids) next.push(k.id);
      }
      if (next.length === 0) break;
      counts.push(next.length);
      frontier = next;
    }
    return counts;
  })();
  const thumbMode = loadThumbnailStyles().locations;
  const thumbUrl = location.thumbnail_image_url || location.avatar_image_url;
  const safeThumb = thumbUrl && isSafeImageUrl(thumbUrl) ? thumbUrl : null;

  function iconForKind(kind: string): "globe" | "map" | "folder" | "book" | "card" {
    const k = (kind || "").toLowerCase();
    if (k.includes("континент") || k.includes("мир") || k.includes("материк")) return "globe";
    if (k.includes("район") || k.includes("квартал") || k.includes("округ")) return "folder";
    if (k.includes("таверна") || k.includes("храм") || k.includes("замок") || k.includes("башня") || k.includes("здание") || k.includes("дом")) return "book";
    if (k.includes("город") || k.includes("деревн") || k.includes("селен") || k.includes("посел")) return "map";
    return "map";
  }

  function hl(text: string): React.ReactNode {
    const q = (highlightQuery ?? "").trim();
    if (!q) return text;
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark style={{ background: "color-mix(in srgb, var(--accent) 22%, transparent)", padding: "0 1px" }}>{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  }

  async function addChild() {
    if (!childName.trim()) return;
    try {
      await api.post("/setting-locations", {
        setting_id: location.setting_id,
        parent_id: location.id,
        name: childName.trim(),
        kind: childKind.trim(),
      });
      setChildName("");
      setChildKind("");
      setAddingChild(false);
      onChange();
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
    }
  }

  const [confirmDialogNode, confirmNode] = useConfirm();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);

  function startEdit(e?: React.MouseEvent) {
    e?.preventDefault();
    e?.stopPropagation();
    setEditName(location.name);
    setEditKind(location.kind ?? "");
    setEditing(true);
  }

  async function duplicate() {
    try {
      await api.post("/setting-locations", {
        setting_id: location.setting_id,
        parent_id: location.parent_id,
        name: `${location.name}_`,
        kind: location.kind,
      });
      onChange();
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
    }
  }

  async function copyMention() {
    let text: string | null = null;
    try {
      text = await buildMentionToken("location", location.id, location.name);
    } catch {}
    if (!text) text = `[[location:${location.id}|${location.name}]]`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt("Скопируйте упоминание:", text);
    }
  }

  async function saveEdit() {
    const name = editName.trim();
    if (!name) {
      alert("Имя не может быть пустым");
      return;
    }
    try {
      await api.put(`/setting-locations/${location.id}`, { name, kind: editKind.trim() });
      setEditing(false);
      onChange();
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
    }
  }

  async function archive() {
    const ok = await confirmNode({
      title: "Архивировать локацию?",
      message: `Отправить «${location.name}» (и вложенные) в архив?`,
      confirmLabel: "Архивировать",
      danger: true,
    });
    if (!ok) return;
    try {
      await api.del(`/setting-locations/${location.id}`);
    } catch (e) {
      alert(String(e instanceof Error ? e.message : e));
      return;
    }
    onArchived?.(location.id, location.name);
    onChange();
  }

  function handleDragStart(e: DragEvent<HTMLElement>) {
    e.stopPropagation();
    setDraggedId?.(location.id);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(location.id));
  }
  function handleDragEnd() {
    setDraggedId?.(null);
    setDragOver(false);
  }
  function handleDragOver(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    if (draggedId == null || draggedId === location.id) return;
    if (isDescendant?.(draggedId, location.id)) return;
    setDragOver(true);
  }
  function handleDragLeave(e: DragEvent<HTMLElement>) {
    e.stopPropagation();
    setDragOver(false);
  }
  async function handleDrop(e: DragEvent<HTMLElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const raw = e.dataTransfer.getData("text/plain");
    const dragged = draggedId ?? (raw ? Number(raw) : null);
    if (dragged == null || dragged === location.id) return;
    if (isDescendant?.(dragged, location.id)) {
      alert("Нельзя вложить локацию в своего же потомка.");
      return;
    }
    try {
      await api.put(`/setting-locations/${dragged}/parent`, { parent_id: location.id });
      onChange();
    } catch (err) {
      alert(String(err instanceof Error ? err.message : err));
    } finally {
      setDraggedId?.(null);
    }
  }

  function openContextMenu(e: React.MouseEvent) {
    e.preventDefault();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: "Редактировать", onClick: () => startEdit() },
        { label: "Дублировать", onClick: () => duplicate() },
        { label: "+ Вложенная", onClick: () => setAddingChild(true) },
        { label: "Визард вложенной", onClick: () => onWizardParent?.(location.id) },
        { label: "Копировать упоминание", onClick: () => copyMention() },
        { label: "В мешок", onClick: () => addToBag({ type: "location", id: location.id, title: location.name }) },
        { label: "Архивировать", danger: true, onClick: () => archive() },
      ],
    });
  }

  return (
    <>
      {confirmDialogNode}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <details ref={detailsRef} className="card" draggable onDragStart={handleDragStart} onDragEnd={handleDragEnd} data-location-id={location.id}>
        <summary
          tabIndex={0}
          className={`geography-node-header${dragOver ? " drag-over" : ""}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          onContextMenu={openContextMenu}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              navigate(`/locations/${location.id}`);
            } else if (e.key === "F2") {
              e.preventDefault();
              startEdit();
            } else if (e.key === "Delete") {
              e.preventDefault();
              archive();
            }
          }}
          style={{ flexDirection: "column", alignItems: "stretch", gap: 4 }}
        >
          <span className="row" style={{ justifyContent: "space-between", alignItems: "center", width: "100%" }}>
            <span className="row" style={{ alignItems: "center" }}>
              {thumbMode === "banner" && safeThumb && <img src={safeThumb} alt="" className="entity-row-thumb" style={{ border: "1px solid var(--line)" }} />}
              <span
                style={{
                  color: hasMap ? "var(--on-surface)" : "color-mix(in srgb, var(--on-surface) 38%, transparent)",
                  display: "inline-flex",
                  opacity: hasMap ? 1 : 0.9,
                }}
                title={hasMap ? "Есть карта" : "Без карты"}
              >
                <NavIcon name={iconForKind(location.kind ?? "")} />
              </span>
              <strong>{hl(location.name)}</strong>
              {location.kind && <span className="geography-kind"> · {hl(location.kind)}</span>}
              {depthCounts.length > 0 && (
                <span className="geography-node-count" style={{ display: "inline-flex", gap: 2, alignItems: "center" }}>
                  ·
                  {depthCounts.map((c, i) => (
                    <span
                      key={i}
                      style={{
                        color:
                          i === 0
                            ? "var(--on-surface)"
                            : i === 1
                              ? "var(--on-surface-muted)"
                              : `color-mix(in srgb, var(--on-surface) ${65 - (i - 2) * 20}%, transparent)`,
                      }}
                    >
                      {i > 0 && " → "}
                      {c}
                    </span>
                  ))}
                </span>
              )}
            </span>
            <span className="row geography-node-actions" style={{ alignItems: "center" }}>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  navigate(`/locations/${location.id}`);
                }}
                title="Открыть профиль"
              >
                Открыть
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  setAddingChild((v) => !v);
                }}
                title="Быстрое создание вложенной (имя+тип)"
              >
                <NavIcon name="plus" /> Вложенная
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  addToBag({ type: "location", id: location.id, title: location.name });
                }}
                title="В мешок"
              >
                <NavIcon name="bag" />
              </button>
              <button onClick={startEdit} title="Редактировать имя и тип">
                <NavIcon name="edit" />
              </button>
              <button
                onClick={(e) => {
                  e.preventDefault();
                  archive();
                }}
              >
                <NavIcon name="delete" />
              </button>
            </span>
          </span>
          {location.description && (
            <span
              style={{
                fontSize: 11,
                lineHeight: 1.25,
                color: "var(--on-surface-muted)",
                fontFamily: "var(--font-body)",
                fontWeight: 400,
                textTransform: "none",
                letterSpacing: 0,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                display: "block",
                maxWidth: "100%",
              }}
            >
              {location.description
                .replace(/\[\[[^\]]+\|([^\]|]+)\]\]/g, "$1")
                .replace(/\*\*([^*]+)\*\*/g, "$1")
                .replace(/\*([^*]+)\*/g, "$1")
                .slice(0, 120)}
            </span>
          )}
        </summary>
        <div className="geography-children">
          {editing && (
            <div className="row">
              <input
                placeholder="Имя локации"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
                autoFocus
              />
              <input
                placeholder="Тип (город/район…)"
                value={editKind}
                onChange={(e) => setEditKind(e.target.value)}
                list="geo-kind-list"
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveEdit();
                  if (e.key === "Escape") setEditing(false);
                }}
              />
              <button className="primary" onClick={saveEdit}>
                Сохранить
              </button>
              <button onClick={() => setEditing(false)}>Отмена</button>
            </div>
          )}
          {addingChild && (
            <div className="row">
              <input
                placeholder="Название"
                value={childName}
                onChange={(e) => setChildName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") addChild();
                  if (e.key === "Escape") setAddingChild(false);
                }}
                autoFocus
              />
              <input
                placeholder="Тип (город/район/место…)"
                value={childKind}
                onChange={(e) => setChildKind(e.target.value)}
                list="geo-kind-list"
                onKeyDown={(e) => {
                  if (e.key === "Enter") addChild();
                  if (e.key === "Escape") setAddingChild(false);
                }}
              />
              <button className="primary" onClick={addChild}>
                Добавить
              </button>
              <button onClick={() => setAddingChild(false)}>Отмена</button>
            </div>
          )}
          {children.map((c) => (
            <LocationNode
              key={c.id}
              location={c}
              byParent={byParent}
              byParentAll={byParentAll}
              onChange={onChange}
              onWizardParent={onWizardParent}
              onArchived={onArchived}
              draggedId={draggedId}
              setDraggedId={setDraggedId}
              isDescendant={isDescendant}
              highlightQuery={highlightQuery}
            />
          ))}
        </div>
      </details>
    </>
  );
}
