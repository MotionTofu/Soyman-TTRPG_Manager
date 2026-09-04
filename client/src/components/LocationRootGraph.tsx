import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { RootPos } from "../geographyRootLayout";
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api } from "../api/client";
import { useAlert, useConfirm } from "../hooks/useConfirm";
import { EmptyState } from "./EmptyState";
import { NavIcon } from "./NavIcons";
import { EntityWizard } from "./entityWizard/EntityWizard";
import { LocationRootNode } from "./LocationRootNode";
import { LocationGroupBox } from "./LocationGroupBox";
import { CollectorEdge } from "./LocationCollectorEdge";
import {
  ROOT_NODE_H,
  ROOT_NODE_W,
  collectSubtreeIds,
  isDescendantOf,
  layoutForest,
  layoutNested,
  layoutRadial,
  loadRootDepths,
  loadRootPositions,
  resetRootDepths,
  resetRootPositions,
  saveRootDepths,
  saveRootPositions,
  type RootDirection,
} from "../geographyRootLayout";
import type { SettingLocation } from "../types";

const nodeTypes = { locRoot: LocationRootNode, groupBox: LocationGroupBox };
const edgeTypes = { collector: CollectorEdge };

/** Тумблер вида: состояние читается текстом, а не только заливкой. */
function ViewToggle({
  on,
  onClick,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      aria-pressed={on}
      className={`geography-root__toggle${on ? " is-on" : ""}`}
      title={title}
      onClick={onClick}
    >
      {children}
      <span className="geography-root__toggle-state">{on ? "вкл" : "выкл"}</span>
    </button>
  );
}
const DRAG_SAVE_THRESHOLD = 4;
const UNDO_MS = 8000;

function collapsedKey(settingId: number): string {
  return `geography-rootcollapsed-${settingId}`;
}

function loadCollapsed(settingId: number): Set<number> {
  try {
    const raw = localStorage.getItem(collapsedKey(settingId));
    if (!raw) return new Set();
    const ids = JSON.parse(raw) as number[];
    return new Set(ids.filter((n) => Number.isFinite(n)));
  } catch {
    return new Set();
  }
}

interface Props {
  settingId: number;
}

interface LastMove {
  id: number;
  name: string;
  prevParent: number | null;
  newParentName: string;
}

export function LocationRootGraph({ settingId }: Props) {
  const [locations, setLocations] = useState<SettingLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [direction, setDirection] = useState<RootDirection>(() => {
    const v = localStorage.getItem(`geography-rootdir-${settingId}`);
    return v === "bottom-up" || v === "left-right" ? v : "top-down";
  });
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [mapFilter, setMapFilter] = useState<"" | "with" | "without">("");
  const [descFilter, setDescFilter] = useState<"" | "with" | "without">("");
  const [creating, setCreating] = useState(false);
  const [wizardParentId, setWizardParentId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => loadCollapsed(settingId));
  const [depth, setDepth] = useState<Record<number, number>>(() => loadRootDepths(settingId));
  const [trunk, setTrunk] = useState(() => {
    try {
      return localStorage.getItem(`geography-roottrunk-${settingId}`) === "1";
    } catch {
      return false;
    }
  });
  const [grouped, setGrouped] = useState(() => {
    try {
      return localStorage.getItem(`geography-rootgroups-${settingId}`) === "1";
    } catch {
      return false;
    }
  });
  const [wrap, setWrap] = useState(() => {
    try {
      return localStorage.getItem(`geography-rootwrap-${settingId}`) !== "0";
    } catch {
      return true;
    }
  });
  const [fan, setFan] = useState(() => {
    try {
      return localStorage.getItem(`geography-rootfan-${settingId}`) === "1";
    } catch {
      return false;
    }
  });
  const [autoDepth, setAutoDepth] = useState(() => {
    try {
      return localStorage.getItem(`geography-rootautodepth-${settingId}`) === "1";
    } catch {
      return false;
    }
  });
  const [nest, setNest] = useState(() => {
    try {
      return localStorage.getItem(`geography-rootnest-${settingId}`) === "1";
    } catch {
      return false;
    }
  });
  const [autoLimit, setAutoLimit] = useState<number>(Number.POSITIVE_INFINITY);
  const firstLoadRef = useRef(true);
  const [rev, setRev] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [fitToken, setFitToken] = useState(0);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const dragStartRef = useRef<Record<number, RootPos>>({});
  const rfRef = useRef<ReactFlowInstance | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const undoTimerRef = useRef<number | null>(null);

  const refresh = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    const controller = new AbortController();
    api
      .get<SettingLocation[]>(`/setting-locations?setting_id=${settingId}`, { signal: controller.signal })
      .then((rows) => {
        setLocations(rows);
        setLoading(false);
        if (firstLoadRef.current) {
          firstLoadRef.current = false;
          setFitToken((t) => (t === 0 ? 1 : t));
        }
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
      localStorage.setItem(`geography-rootdir-${settingId}`, direction);
    } catch { /* ignore */ }
  }, [settingId, direction]);

  useEffect(() => {
    try {
      localStorage.setItem(collapsedKey(settingId), JSON.stringify([...collapsed]));
    } catch { /* ignore */ }
  }, [settingId, collapsed]);

  useEffect(() => {
    try {
      localStorage.setItem(`geography-roottrunk-${settingId}`, trunk ? "1" : "0");
      localStorage.setItem(`geography-rootgroups-${settingId}`, grouped ? "1" : "0");
      localStorage.setItem(`geography-rootwrap-${settingId}`, wrap ? "1" : "0");
      localStorage.setItem(`geography-rootfan-${settingId}`, fan ? "1" : "0");
      localStorage.setItem(`geography-rootautodepth-${settingId}`, autoDepth ? "1" : "0");
      localStorage.setItem(`geography-rootnest-${settingId}`, nest ? "1" : "0");
    } catch { /* ignore */ }
  }, [settingId, trunk, grouped, wrap, fan, autoDepth, nest]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery), 150);
    return () => clearTimeout(t);
  }, [rawQuery]);

  useEffect(() => {
    return () => {
      if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    };
  }, []);

  // Нативный mousedown: React-синтетика для средней кнопки дефолт не дожала.
  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    const kill = (e: MouseEvent) => {
      if (e.button === 1) e.preventDefault();
    };
    el.addEventListener("mousedown", kill);
    return () => el.removeEventListener("mousedown", kill);
  });

  function armUndoTimer() {
    if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
    undoTimerRef.current = window.setTimeout(() => setLastMove(null), UNDO_MS);
  }

  async function undoLastMove() {
    if (!lastMove) return;
    try {
      await api.put(`/setting-locations/${lastMove.id}/parent`, { parent_id: lastMove.prevParent });
      setLastMove(null);
      refresh();
    } catch (err) {
      showAlert(String(err instanceof Error ? err.message : err));
    }
  }

  const byIdAll = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);
  const uniqueKinds = useMemo(
    () =>
      Array.from(
        new Set(locations.map((l) => (l.kind ?? "").trim().toLowerCase()).filter(Boolean) as string[])
      ).sort((a, b) => a.localeCompare(b, "ru")),
    [locations]
  );

  const stats = useMemo(() => {
    const total = locations.filter((l) => !l.archived_at).length;
    const withoutDesc = locations.filter((l) => !l.archived_at && !(l.description ?? "").trim()).length;
    const withoutMap = locations.filter((l) => !l.archived_at && !(l.map_image_path || l.map_image_url)).length;
    return { total, withoutDesc, withoutMap };
  }, [locations]);

  const { visible, matchedIds } = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const kf = kindFilter.trim().toLowerCase();
    let rows = locations.filter((l) => !l.archived_at);
    if (kf) rows = rows.filter((l) => (l.kind ?? "").trim().toLowerCase() === kf);
    if (mapFilter === "with") rows = rows.filter((l) => !!(l.map_image_path || l.map_image_url));
    else if (mapFilter === "without") rows = rows.filter((l) => !(l.map_image_path || l.map_image_url));
    if (descFilter === "with") rows = rows.filter((l) => !!(l.description ?? "").trim());
    else if (descFilter === "without") rows = rows.filter((l) => !(l.description ?? "").trim());
    const matched = new Set<number>();
    if (q) {
      const keep = new Set<number>();
      for (const l of rows) {
        const hay = [l.name, l.kind ?? "", l.name_original ?? "", ...(l.aliases ?? [])]
          .join(" ")
          .toLowerCase();
        if (hay.includes(q)) {
          matched.add(l.id);
          keep.add(l.id);
          // тянем предков, чтобы ветка не рвалась
          let cur: SettingLocation | undefined = l;
          const seen = new Set<number>();
          while (cur && cur.parent_id != null && !seen.has(cur.id)) {
            seen.add(cur.id);
            keep.add(cur.parent_id);
            cur = byIdAll.get(cur.parent_id);
          }
        }
      }
      rows = rows.filter((l) => keep.has(l.id));
    }
    return { visible: rows, matchedIds: matched };
  }, [locations, debouncedQuery, kindFilter, mapFilter, descFilter, byIdAll]);

  const toggleCollapse = useCallback((id: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const createNested = useCallback((id: number) => {
    setWizardParentId(id);
  }, []);

  const expandAll = useCallback(() => setCollapsed(new Set()), []);
  const collapseAll = useCallback(() => {
    setCollapsed(new Set(visible.map((l) => l.id)));
  }, [visible]);

  const selected = selectedId != null ? (byIdAll.get(selectedId) ?? null) : null;
  const selectedKids = selectedId != null
    ? locations.filter((l) => l.parent_id === selectedId && !l.archived_at).length
    : 0;

  /** Глубина подветки id среди неархивных (0 — вложенных нет). */
  function subtreeMaxDepth(id: number): number {
    const kids = new Map<number | null, SettingLocation[]>();
    for (const l of locations) {
      if (l.archived_at) continue;
      const list = kids.get(l.parent_id) ?? [];
      list.push(l);
      kids.set(l.parent_id, list);
    }
    let max = 0;
    const stack: Array<{ node: number; d: number }> = [{ node: id, d: 0 }];
    const seen = new Set<number>([id]);
    while (stack.length) {
      const { node, d } = stack.pop()!;
      for (const k of kids.get(node) ?? []) {
        if (seen.has(k.id)) continue;
        seen.add(k.id);
        max = Math.max(max, d + 1);
        stack.push({ node: k.id, d: d + 1 });
      }
    }
    return max;
  }

  /** Шаг вложенности: + открывает следующий уровень вниз, − прячет.
   * Дошли до реальной глубины — запись стирается, снова «видно всё». */
  const changeDepth = useCallback(
    (id: number, delta: 1 | -1) => {
      const maxD = subtreeMaxDepth(id);
      if (maxD === 0) return;
      const cur = depth[id];
      const updated = { ...depth };
      if (delta > 0) {
        if (cur == null) return; // и так видно всё
        if (cur + 1 >= maxD) delete updated[id];
        else updated[id] = cur + 1;
      } else {
        if (cur == null) {
          if (maxD === 1) updated[id] = 0;
          else updated[id] = maxD - 1;
        } else if (cur <= 0) {
          return;
        } else {
          updated[id] = cur - 1;
        }
      }
      setDepth(updated);
      saveRootDepths(settingId, updated);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [depth, locations, settingId]
  );

  // Пересборка графа: фильтры → скрытие схлопнутых → раскладка → ручные позиции поверх.
  useEffect(() => {
    const visibleIds = new Set(visible.map((l) => l.id));
    // Расстояние от корней видимого леса — для автоглубины по зуму.
    const kidsVis = new Map<number, SettingLocation[]>();
    for (const l of visible) {
      if (l.parent_id != null && visibleIds.has(l.parent_id)) {
        const list = kidsVis.get(l.parent_id) ?? [];
        list.push(l);
        kidsVis.set(l.parent_id, list);
      }
    }
    const distMap = new Map<number, number>();
    const distQueue: number[] = [];
    for (const l of visible) {
      if (l.parent_id == null || !visibleIds.has(l.parent_id)) {
        distMap.set(l.id, 0);
        distQueue.push(l.id);
      }
    }
    while (distQueue.length) {
      const id = distQueue.shift()!;
      const d = distMap.get(id) ?? 0;
      for (const k of kidsVis.get(id) ?? []) {
        if (!distMap.has(k.id)) {
          distMap.set(k.id, d + 1);
          distQueue.push(k.id);
        }
      }
    }
    const shown = visible.filter((l) => {
      if ((autoDepth || nest) && (distMap.get(l.id) ?? 0) > autoLimit) return false;
      let cur: SettingLocation | undefined = l;
      const seen = new Set<number>();
      let dist = 0;
      while (cur && cur.parent_id != null && !seen.has(cur.id)) {
        seen.add(cur.id);
        const pid = cur.parent_id;
        if (collapsed.has(pid)) return false;
        dist += 1;
        const limit = depth[pid];
        if (limit != null && dist > limit) return false;
        cur = byIdAll.get(pid);
        if (cur && !visibleIds.has(cur.id)) break;
      }
      return true;
    });
    const shownIds = new Set(shown.map((l) => l.id));
    const byParent = new Map<number | null, SettingLocation[]>();
    for (const l of shown) {
      const key = l.parent_id != null && shownIds.has(l.parent_id) ? l.parent_id : null;
      const list = byParent.get(key) ?? [];
      list.push(l);
      byParent.set(key, list);
    }
    for (const list of byParent.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name, "ru", { numeric: true }));
    }
    // Веер и матрёшка — чистая автораскладка: ручные позиции чужой проекции врут.
    const nested = nest ? layoutNested(shown, byParent) : null;
    const auto = nest
      ? nested!.pos
      : fan
        ? layoutRadial(shown, byParent)
        : layoutForest(shown, byParent, direction, wrap);
    const saved = fan || nest ? {} : loadRootPositions(settingId);
    const childCount = new Map<number, number>();
    for (const l of visible) {
      if (l.parent_id == null || !visibleIds.has(l.parent_id)) continue;
      childCount.set(l.parent_id, (childCount.get(l.parent_id) ?? 0) + 1);
    }
    // Матрёшка: родители — боксы, листья — карточки. Вложенность вместо нитей.
    const nextNodes: Node[] = shown.map((l) => {
      const shownKids = (byParent.get(l.id) ?? []).length;
      if (nest && shownKids > 0) {
        return {
          id: String(l.id),
          type: "groupBox",
          position: auto[l.id] ?? { x: 0, y: 0 },
          style: {
            width: nested!.widths[l.id] ?? ROOT_NODE_W,
            height: nested!.heights[l.id] ?? ROOT_NODE_H,
          },
          selected: selectedId != null && selectedId === l.id,
          data: {
            label: l.name,
            kind: l.kind ?? "",
            count: shownKids,
            branchId: l.id,
            collapsed: collapsed.has(l.id),
            onToggle: toggleCollapse,
          },
        };
      }
      const p = saved[l.id] ?? auto[l.id] ?? { x: 0, y: 0 };
      return {
        id: String(l.id),
        type: "locRoot",
        position: p,
        selected: selectedId != null && selectedId === l.id,
        data: {
          locationId: l.id,
          name: l.name,
          kind: l.kind ?? "",
          childCount: childCount.get(l.id) ?? 0,
          collapsed: collapsed.has(l.id),
          hasMap: !!(l.map_image_path || l.map_image_url),
          match: matchedIds.has(l.id),
          noDesc: !(l.description ?? "").trim(),
          depthSteps: depth[l.id] ?? null,
          onToggle: toggleCollapse,
          onCreateChild: createNested,
        },
      };
    });
    const axis = direction === "left-right" ? "horizontal" : "vertical";
    // В матрёшке связи показывает вложенность — нити не нужны.
    const nextEdges: Edge[] = nest
      ? []
      : shown
          .filter((l) => l.parent_id != null && shownIds.has(l.parent_id))
          .map((l) =>
            trunk && !fan
              ? {
                  id: `e${l.parent_id}-${l.id}`,
                  source: String(l.parent_id),
                  target: String(l.id),
                  type: "collector",
                  data: { axis },
                }
              : {
                  id: `e${l.parent_id}-${l.id}`,
                  source: String(l.parent_id),
                  target: String(l.id),
                  type: "default",
                  style: { stroke: "var(--line)", strokeWidth: 1 },
                }
          );
    // Группы-контейнеры: рамка вокруг ветки узла глубины 1 (2+ ноды).
    // В матрёшке боксы уже есть из раскладки — не дублируем.
    let finalNodes = nextNodes;
    if (grouped && !nest) {
      const depthMap = new Map<number, number>();
      const queue: number[] = [];
      for (const l of shown) {
        if (l.parent_id == null || !shownIds.has(l.parent_id)) {
          depthMap.set(l.id, 0);
          queue.push(l.id);
        }
      }
      while (queue.length) {
        const id = queue.shift()!;
        const d = depthMap.get(id) ?? 0;
        for (const k of byParent.get(id) ?? []) {
          if (!depthMap.has(k.id)) {
            depthMap.set(k.id, d + 1);
            queue.push(k.id);
          }
        }
      }
      const posOf = new Map(nextNodes.map((n) => [Number(n.id), n.position]));
      const boxes: Node[] = [];
      for (const l of shown) {
        if (depthMap.get(l.id) !== 1) continue;
        const branch = [
          l.id,
          ...collectSubtreeIds(l.id, byParent).filter((id) => id !== l.id && shownIds.has(id)),
        ];
        if (branch.length < 2) continue;
        const pts = branch
          .map((id) => posOf.get(id))
          .filter((p): p is RootPos => !!p);
        if (pts.length === 0) continue;
        const minX = Math.min(...pts.map((p) => p.x)) - 16;
        const minY = Math.min(...pts.map((p) => p.y)) - 52;
        const maxX = Math.max(...pts.map((p) => p.x)) + ROOT_NODE_W + 16;
        const maxY = Math.max(...pts.map((p) => p.y)) + ROOT_NODE_H + 16;
        boxes.push({
          id: `grp-${l.id}`,
          type: "groupBox",
          position: { x: minX, y: minY },
          style: { width: maxX - minX, height: maxY - minY },
          data: {
            label: l.name,
            kind: l.kind ?? "",
            count: branch.length,
            branchId: l.id,
            collapsed: collapsed.has(l.id),
            onToggle: toggleCollapse,
          },
          selectable: false,
          draggable: false,
          focusable: false,
        });
      }
      finalNodes = [...boxes, ...nextNodes];
    }
    setNodes(finalNodes);
    setEdges(nextEdges);
    if (selectedId != null && !shownIds.has(selectedId)) setSelectedId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, direction, collapsed, depth, trunk, grouped, wrap, fan, nest, autoDepth, autoLimit, rev, selectedId, settingId]);

  // Камера: только по требованию (первая загрузка, смена ориентации, кнопка Фит).
  // nodes.length из зависимостей убран сознательно: иначе автоглубина входит
  // в цикл «фит → зум → кап → refit».
  useEffect(() => {
    if (fitToken === 0) return;
    rfRef.current?.fitView({ padding: 0.2, duration: 200 });
  }, [fitToken]);

  /** Drag ноды: весь сабтри едет на ту же дельту; drop на чужую ноду = смена родителя. */
  const handleNodeDragStart = useCallback(
    (_e: unknown, dragged: Node) => {
      const snap: Record<number, RootPos> = {};
      for (const n of nodes) snap[Number(n.id)] = { ...n.position };
      // dragged ещё в старой позиции — зафиксируем и её
      snap[Number(dragged.id)] = { ...dragged.position };
      dragStartRef.current = snap;
    },
    [nodes]
  );

  const handleNodeDragStop = useCallback(
    async (_e: unknown, dragged: Node) => {
      const draggedId = Number(dragged.id);
      if (!Number.isFinite(draggedId)) return;
      const start = dragStartRef.current[draggedId] ?? dragged.position;
      const dx = dragged.position.x - start.x;
      const dy = dragged.position.y - start.y;
      // Порог: клик/jitter без движения — ни сохранять, ни репаренить.
      if (Math.hypot(dx, dy) < DRAG_SAVE_THRESHOLD) {
        dragStartRef.current = {};
        return;
      }

      // Кандидат на нового родителя: центр dragged внутри чужой ноды (+ запас).
      const cx = dragged.position.x + ROOT_NODE_W / 2;
      const cy = dragged.position.y + ROOT_NODE_H / 2;
      const target = nodes.find((n) => {
        if (n.id === dragged.id) return false;
        const p = n.position;
        return cx >= p.x - 20 && cx <= p.x + ROOT_NODE_W + 20 && cy >= p.y - 20 && cy <= p.y + ROOT_NODE_H + 34;
      });
      if (target) {
        const newParentId = Number(target.id);
        const moved = byIdAll.get(draggedId);
        const newParent = byIdAll.get(newParentId);
        if (newParentId !== draggedId && moved && newParent && moved.parent_id !== newParentId) {
          if (isDescendantOf(draggedId, newParentId, byIdAll)) {
            showAlert("Нельзя переместить локацию в её же потомка — получится цикл.");
            refresh();
            return;
          }
          const ok = await confirm({
            title: "Сменить родителя?",
            message: `«${moved.name}» → в «${newParent.name}» (вместе с вложенными).`,
            confirmLabel: "Переместить",
          });
          if (!ok) {
            refresh();
            return;
          }
          const prevParent = moved.parent_id ?? null;
          try {
            await api.put(`/setting-locations/${draggedId}/parent`, { parent_id: newParentId });
            // Переехавшая ветка — в автораскладку: старые координаты у старого родителя врут.
            const byParentAll = new Map<number | null, SettingLocation[]>();
            for (const l of locations) {
              const list = byParentAll.get(l.parent_id) ?? [];
              list.push(l);
              byParentAll.set(l.parent_id, list);
            }
            const fresh = loadRootPositions(settingId);
            for (const id of collectSubtreeIds(draggedId, byParentAll)) delete fresh[id];
            saveRootPositions(settingId, fresh);
            setLastMove({ id: draggedId, name: moved.name, prevParent, newParentName: newParent.name });
            armUndoTimer();
            refresh();
          } catch (err) {
            showAlert(String(err instanceof Error ? err.message : err));
            refresh();
          }
          return;
        }
        // Бросок на текущего родителя или на себя — просто вернуть камеру данных.
        refresh();
        return;
      }

      const byParentAll = new Map<number | null, SettingLocation[]>();
      for (const l of locations) {
        const list = byParentAll.get(l.parent_id) ?? [];
        list.push(l);
        byParentAll.set(l.parent_id, list);
      }
      const subtree = new Set(collectSubtreeIds(draggedId, byParentAll));
      const saved = loadRootPositions(settingId);
      const startSnap = dragStartRef.current;
      setNodes((cur) =>
        cur.map((n) => {
          if (!subtree.has(Number(n.id))) return n;
          if (n.id === dragged.id) {
            saved[draggedId] = { ...dragged.position };
            return { ...n, position: { ...dragged.position } };
          }
          const s = startSnap[Number(n.id)] ?? n.position;
          const np = { x: s.x + dx, y: s.y + dy };
          saved[Number(n.id)] = np;
          return { ...n, position: np };
        })
      );
      saveRootPositions(settingId, saved);
      dragStartRef.current = {};
      setRev((r) => r + 1); // рамки групп — вслед за ручной раскладкой
    },
    [nodes, locations, byIdAll, settingId, setNodes, showAlert, confirm, refresh]
  );

  if (loading && locations.length === 0 && !loadError) {
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка древа">
        <div className="search-skeleton-pulse" style={{ height: 34 }} />
        <div className="search-skeleton-pulse" style={{ height: 120 }} />
      </div>
    );
  }

  return (
    <div className="stack geography-root">
      {confirmDialog}
      {alertDialog}
      <div className="row geography-root__toolbar">
        <button className="primary" onClick={() => setCreating(true)}>
          <NavIcon name="plus" /> Создать
        </button>
        <button onClick={expandAll} disabled={visible.length === 0} title="Развернуть все ветки">
          Развернуть всё
        </button>
        <button onClick={collapseAll} disabled={visible.length === 0} title="Свернуть все ветки">
          Свернуть всё
        </button>
      </div>
      {stats.total > 0 && (
        <div className="row muted geography-root__stats">
          <span>
            Всего: {visible.length}
            {visible.length !== stats.total ? ` / ${stats.total}` : ""}
          </span>
          <span className={stats.withoutDesc ? "geography-root__debt" : undefined}>Без описания: {stats.withoutDesc}</span>
          <span className={stats.withoutMap ? "geography-root__debt" : undefined}>Без карты: {stats.withoutMap}</span>
          {(stats.withoutDesc > 0 || stats.withoutMap > 0) && (
            <button
              className="geography-root__debt-btn"
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
      <div className="row geography-root__toolbar">
        <div className="row" role="group" aria-label="Ориентация древа" style={{ gap: 4 }}>
          <button
            className={direction === "top-down" ? "primary" : undefined}
            title="Корни сверху, дети вниз"
            onClick={() => {
              setDirection("top-down");
              setFitToken((t) => t + 1);
            }}
          >
            Сверху-вниз
          </button>
          <button
            className={direction === "bottom-up" ? "primary" : undefined}
            title="Корни снизу, дети вверх"
            onClick={() => {
              setDirection("bottom-up");
              setFitToken((t) => t + 1);
            }}
          >
            Снизу-вверх
          </button>
          <button
            className={direction === "left-right" ? "primary" : undefined}
            title="Корни слева, дети вправо"
            onClick={() => {
              setDirection("left-right");
              setFitToken((t) => t + 1);
            }}
          >
            Слева-направо
          </button>
        </div>
        <input
          placeholder="Поиск по названию, типу, алиасам…"
          aria-label="Поиск локаций"
          value={rawQuery}
          onChange={(e) => setRawQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setRawQuery("");
          }}
          style={{ flex: 1, minWidth: 140 }}
        />
        {uniqueKinds.length > 0 && (
          <select value={kindFilter} onChange={(e) => setKindFilter(e.target.value)} aria-label="Фильтр по типу">
            <option value="">Все типы</option>
            {uniqueKinds.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        )}
        <select value={mapFilter} onChange={(e) => setMapFilter(e.target.value as "" | "with" | "without")} aria-label="Фильтр по карте">
          <option value="">Карта: все</option>
          <option value="with">С картой</option>
          <option value="without">Без карты</option>
        </select>
        <select value={descFilter} onChange={(e) => setDescFilter(e.target.value as "" | "with" | "without")} aria-label="Фильтр по описанию">
          <option value="">Описание: все</option>
          <option value="with">С описанием</option>
          <option value="without">Без описания</option>
        </select>
        <button title="Вписать древо в экран" onClick={() => setFitToken((t) => t + 1)}>
          <NavIcon name="center" /> Фит
        </button>
        <ViewToggle
          on={trunk}
          title="Ствол-коллектор: рёбра идут общей шиной вместо веера"
          onClick={() => setTrunk((v) => !v)}
        >
          Ствол
        </ViewToggle>
        <ViewToggle
          on={grouped}
          title="Группы: ветки второго уровня в рамках-контейнерах"
          onClick={() => setGrouped((v) => !v)}
        >
          Группы
        </ViewToggle>
        <ViewToggle
          on={wrap}
          title="Перенос: длинные ряды детей заворачиваются строками по 4 — дерево уже, но выше"
          onClick={() => setWrap((v) => !v)}
        >
          Перенос
        </ViewToggle>
        <ViewToggle
          on={fan}
          title="Веер: уровни кольцами вокруг центра — ширина превращается в дугу"
          onClick={() => {
            setFan((v) => !v);
            setFitToken((t) => t + 1);
          }}
        >
          Веер
        </ViewToggle>
        <ViewToggle
          on={autoDepth}
          title="Автоглубина: отдалил — видны верхние уровни, приблизил — детали"
          onClick={() => setAutoDepth((v) => !v)}
        >
          Автоглубина
        </ViewToggle>
        <ViewToggle
          on={nest}
          title="Матрёшка: кубы-локации, колесом проваливаешься внутрь — уровни появляются в боксах"
          onClick={() => {
            setNest((v) => !v);
            setFitToken((t) => t + 1);
          }}
        >
          Матрёшка
        </ViewToggle>
        {autoDepth && autoLimit !== Number.POSITIVE_INFINITY && (
          <span className="geography-root__autolimit" role="status">
            глубина ≤ {autoLimit}
          </span>
        )}
        <button
          title="Сбросить ручную раскладку и шаги к автоматической"
          onClick={() => {
            resetRootPositions(settingId);
            resetRootDepths(settingId);
            setDepth({});
            refresh();
          }}
        >
          Сбросить раскладку
        </button>
        {selected && (
          <div className="row geography-root__stepper" role="group" aria-label={`Шаг вложенности под локацией ${selected.name}`}>
            <span className="muted geography-root__stepper-name" title={selected.name}>
              Шаг: {selected.name}
            </span>
            <button
              onClick={() => changeDepth(selected.id, -1)}
              disabled={selectedKids === 0 || (depth[selected.id] != null && depth[selected.id] <= 0)}
              title="Спрятать уровень вниз"
              aria-label="Убрать шаг вложенности"
            >
              −
            </button>
            <span className="geography-root__stepper-val" aria-live="polite">
              {depth[selected.id] ?? "все"}
            </span>
            <button
              onClick={() => changeDepth(selected.id, 1)}
              disabled={selectedKids === 0 || depth[selected.id] == null}
              title={selectedKids === 0 ? "Некуда раскрывать — нет вложенных" : "Показать следующий уровень вниз"}
              aria-label="Добавить шаг вложенности"
            >
              +
            </button>
          </div>
        )}
      </div>
      <p className="muted geography-root__hint">
        Beta: тяните карточки — ветка едет вместе с родителем. Бросок на чужую карточку предложит
        сменить родителя (с подтверждением). Ручные позиции хранятся локально; смена ориентации их
        не двигает — для пересчёта нажмите «Сбросить раскладку».
        {fan && " Веер — чистая автораскладка: ручные позиции в нём не действуют."}
        {nest && " Матрёшка: крути колесо — уровни появляются внутри кубов; таскание выключено."}
      </p>
      {lastMove && (
        <div className="geography-root__undo" role="status" aria-live="polite">
          <span>
            «{lastMove.name}» → «{lastMove.newParentName}»
          </span>
          <button className="primary" onClick={undoLastMove}>
            Отменить
          </button>
          <button onClick={() => setLastMove(null)} aria-label="Закрыть">
            ×
          </button>
        </div>
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
      {nodes.length === 0 && !loadError ? (
        <EmptyState
          title="Древо пусто"
          hint="Создайте первую локацию — она станет корнем."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              Создать локацию
            </button>
          }
        />
      ) : (
        <div
          className="geography-root__canvas"
          ref={canvasRef}
          // Средняя кнопка внутри схемы — пан канваса, а не автоскролл
          // страницы (глушится нативным слушателем выше).
        >
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onInit={(inst) => {
              rfRef.current = inst;
              setFitToken((t) => (t === 0 ? 1 : t));
            }}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onMove={(_, vp) => {
              // Матрёшка стартует с одних кубов: предел на единицу строже.
              const base =
                vp.zoom >= 0.85
                  ? Number.POSITIVE_INFINITY
                  : vp.zoom >= 0.55
                    ? 3
                    : vp.zoom >= 0.35
                      ? 2
                      : 1;
              const lim = nest ? Math.max(0, base === Number.POSITIVE_INFINITY ? base : base - 1) : base;
              setAutoLimit((prev) => (prev === lim ? prev : lim));
            }}
            nodesDraggable={!nest}
            zoomOnScroll
            onSelectionChange={({ nodes: sel }) =>
              setSelectedId(sel.length > 0 ? Number(sel[0].id) : null)
            }
            fitView
            minZoom={0.2}
            maxZoom={1.75}
            nodesConnectable={false}
            edgesFocusable={false}
            proOptions={{ hideAttribution: true }}
          >
            <Background variant={BackgroundVariant.Lines} />
            {nodes.length > 10 && <MiniMap pannable zoomable />}
            <Controls showInteractive={false} />
          </ReactFlow>
        </div>
      )}
    </div>
  );
}
