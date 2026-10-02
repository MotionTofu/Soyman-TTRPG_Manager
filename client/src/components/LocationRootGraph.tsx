import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
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
import { useAction, useAfterWrite, useResource, write } from "../data/hooks";
import { settingPaths } from "../data/settingEntities";
import { useAlert, useConfirm, usePrompt } from "../hooks/useConfirm";
import { useNavigate } from "react-router-dom";
import { ContextMenu, type ContextMenuItem } from "./ContextMenu";
import { addToBag } from "../bag";
import { copyMentionToClipboard } from "../mentions";
import { EmptyState } from "./EmptyState";
import { LoadErrorCard, SkeletonBlock } from "./Loadable";
import { EntityWizard } from "./entityWizard/EntityWizard";
import { LocationRootNode } from "./LocationRootNode";
import { ROOT_NODE_H, ROOT_NODE_W, isDescendantOf, layoutForest } from "../geographyRootLayout";
import type { SettingLocation } from "../types";

const NO_LOCATIONS: SettingLocation[] = [];

const nodeTypes = { locRoot: LocationRootNode };

const DRAG_THRESHOLD = 4;
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

interface LastMove {
  id: number;
  name: string;
  prevParent: number | null;
  newParentName: string;
}

/** «Дерево» Географии (разбор 2026-10-02, Q7, Q14–Q16): один вид — слева
 * направо с переносом, без переключателей и фильтров. Раскладка всегда
 * автоматическая; перетаскивание — только смена родителя (бросок на чужую
 * карточку), иначе карточка возвращается на место. Ветку сворачивают на
 * самой карточке. */
export function LocationRootGraph({ settingId, lead }: { settingId: number; lead?: ReactNode }) {
  // Список мест — тот же ключ кэша, что у карточек и соседних видов
  // географии (docs/adr/0001): правка в одном виде видна в остальных.
  const locationsState = useResource<SettingLocation[]>(settingPaths.inSetting("location", settingId));
  const locations = locationsState.data ?? NO_LOCATIONS;
  const loading = locationsState.loading;
  const loadError = locationsState.data ? null : locationsState.error;
  const [creating, setCreating] = useState(false);
  const [wizardParentId, setWizardParentId] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(() => loadCollapsed(settingId));
  const [rev, setRev] = useState(0);
  const [lastMove, setLastMove] = useState<LastMove | null>(null);
  const [confirmDialog, confirm] = useConfirm();
  const [alertDialog, showAlert] = useAlert();
  const [promptDialog, promptText] = usePrompt();
  const [menu, setMenu] = useState<{ x: number; y: number; items: ContextMenuItem[] } | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const dragStartRef = useRef<{ x: number; y: number } | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [rf, setRf] = useState<ReactFlowInstance | null>(null);
  const fittedRef = useRef(false);
  const undoTimerRef = useRef<number | null>(null);
  const afterWrite = useAfterWrite();
  const run = useAction();
  const navigate = useNavigate();
  // Вернуть карточки на места по данным: брошенная мимо или отменённая
  // смена родителя не должна оставлять карточку там, где её отпустили.
  const resync = useCallback(() => setRev((r) => r + 1), []);

  useEffect(() => {
    try {
      localStorage.setItem(collapsedKey(settingId), JSON.stringify([...collapsed]));
    } catch { /* ignore */ }
  }, [settingId, collapsed]);

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

  async function undoLastMove() {
    if (!lastMove) return;
    const done = await run(
      () => write.put(`/setting-locations/${lastMove.id}/parent`, { parent_id: lastMove.prevParent }).then(() => true),
      { affects: [{ kind: "location" }] }
    );
    if (done) setLastMove(null);
  }

  const byIdAll = useMemo(() => new Map(locations.map((l) => [l.id, l])), [locations]);

  // Меню узла (ToDo/08 Р16): те же действия, что у строки дерева, плюс
  // переход к карте — жест за столом «открыть карту этого места».
  const handleNodeContextMenu = useCallback(
    (e: React.MouseEvent, node: Node) => {
      const loc = byIdAll.get(Number(node.id));
      if (!loc) return;
      e.preventDefault();
      const items: ContextMenuItem[] = [
        {
          label: "Копировать упоминание",
          onClick: async () => {
            const manual = await copyMentionToClipboard("location", loc.id, loc.name);
            if (manual) await promptText({ title: "Упоминание", message: "Скопируйте упоминание:", defaultValue: manual, readOnly: true });
          },
        },
        { label: "В мешок", onClick: () => addToBag({ type: "location", id: loc.id, title: loc.name }) },
      ];
      if (loc.map_image_url) {
        items.push({ label: "Открыть карту", onClick: () => navigate(`/locations/${loc.id}?tab=${encodeURIComponent("Карта")}`) });
      }
      setMenu({ x: e.clientX, y: e.clientY, items });
    },
    [byIdAll, navigate, promptText]
  );

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

  // Пересборка графа: живые места → скрытие свёрнутых веток → раскладка.
  useEffect(() => {
    const alive = locations.filter((l) => !l.archived_at);
    const aliveIds = new Set(alive.map((l) => l.id));
    const shown = alive.filter((l) => {
      let cur: SettingLocation | undefined = l;
      const seen = new Set<number>();
      while (cur && cur.parent_id != null && !seen.has(cur.id)) {
        seen.add(cur.id);
        if (collapsed.has(cur.parent_id)) return false;
        cur = byIdAll.get(cur.parent_id);
        if (cur && !aliveIds.has(cur.id)) break;
      }
      return true;
    });
    const shownIds = new Set(shown.map((l) => l.id));
    const childCount = new Map<number, number>();
    for (const l of alive) {
      if (l.parent_id != null && aliveIds.has(l.parent_id)) childCount.set(l.parent_id, (childCount.get(l.parent_id) ?? 0) + 1);
    }
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
    const pos = layoutForest(shown, byParent, "left-right", true);
    setNodes(
      shown.map((l) => ({
        id: String(l.id),
        type: "locRoot",
        position: pos[l.id] ?? { x: 0, y: 0 },
        data: {
          locationId: l.id,
          name: l.name,
          kind: l.kind ?? "",
          childCount: childCount.get(l.id) ?? 0,
          collapsed: collapsed.has(l.id),
          hasMap: !!(l.map_image_path || l.map_image_url),
          noDesc: !(l.description ?? "").trim(),
          onToggle: toggleCollapse,
          onCreateChild: createNested,
        },
      }))
    );
    setEdges(
      shown
        .filter((l) => l.parent_id != null && shownIds.has(l.parent_id))
        .map((l) => ({
          id: `e${l.parent_id}-${l.id}`,
          source: String(l.parent_id),
          target: String(l.id),
          type: "default",
          style: { stroke: "var(--line)", strokeWidth: 1 },
        }))
    );
  }, [locations, byIdAll, collapsed, rev, toggleCollapse, createNested, setNodes, setEdges]);

  // Места приходят позже холста — древо вписывается в экран один раз, когда
  // карточки появились; дальше камера Мастера не дёргается.
  useEffect(() => {
    if (fittedRef.current || nodes.length === 0 || !rf) return;
    fittedRef.current = true;
    window.setTimeout(() => void rf.fitView({ padding: 0.2 }), 0);
  }, [nodes.length, rf]);

  const handleNodeDragStart = useCallback((_e: unknown, dragged: Node) => {
    dragStartRef.current = { ...dragged.position };
  }, []);

  /** Бросок на чужую карточку — смена родителя с подтверждением; мимо — назад. */
  const handleNodeDragStop = useCallback(
    async (_e: unknown, dragged: Node) => {
      const draggedId = Number(dragged.id);
      const start = dragStartRef.current ?? dragged.position;
      dragStartRef.current = null;
      if (Math.hypot(dragged.position.x - start.x, dragged.position.y - start.y) < DRAG_THRESHOLD) return;
      const cx = dragged.position.x + ROOT_NODE_W / 2;
      const cy = dragged.position.y + ROOT_NODE_H / 2;
      const target = nodes.find((n) => {
        if (n.id === dragged.id) return false;
        const p = n.position;
        return cx >= p.x - 20 && cx <= p.x + ROOT_NODE_W + 20 && cy >= p.y - 20 && cy <= p.y + ROOT_NODE_H + 34;
      });
      const moved = byIdAll.get(draggedId);
      const newParent = target ? byIdAll.get(Number(target.id)) : undefined;
      if (!moved || !newParent || moved.parent_id === newParent.id) {
        resync();
        return;
      }
      if (isDescendantOf(draggedId, newParent.id, byIdAll)) {
        showAlert("Нельзя переместить локацию в её же потомка — получится цикл.");
        resync();
        return;
      }
      const ok = await confirm({
        title: "Сменить родителя?",
        message: `«${moved.name}» → в «${newParent.name}» (вместе с вложенными).`,
        confirmLabel: "Переместить",
      });
      if (!ok) {
        resync();
        return;
      }
      try {
        await write.put(`/setting-locations/${draggedId}/parent`, { parent_id: newParent.id });
        setLastMove({ id: draggedId, name: moved.name, prevParent: moved.parent_id ?? null, newParentName: newParent.name });
        if (undoTimerRef.current) window.clearTimeout(undoTimerRef.current);
        undoTimerRef.current = window.setTimeout(() => setLastMove(null), UNDO_MS);
        afterWrite([{ kind: "location" }]);
      } catch (err) {
        // Отказ сервера (цикл, архив) — ответ рядом с жестом, карточка на место.
        showAlert(String(err instanceof Error ? err.message : err));
        resync();
      }
    },
    [nodes, byIdAll, showAlert, confirm, resync, afterWrite]
  );

  if (loading && locations.length === 0 && !loadError) {
    // Мелочь панели древа, а не форма списка: точные высоты сохранены.
    return (
      <div className="stack" aria-busy="true" aria-label="Загрузка древа">
        <SkeletonBlock height={34} />
        <SkeletonBlock height={120} />
      </div>
    );
  }

  return (
    <div className="stack geography-root">
      {confirmDialog}
      {alertDialog}
      {promptDialog}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />}
      <div className="population__toolbar">
        {lead}
        <span className="population__spacer" />
        <button type="button" className="population__create" onClick={() => setCreating(true)}>
          + Место
        </button>
      </div>
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
        <LoadErrorCard
          message={<>Не удалось загрузить географию: {loadError}</>}
          onRetry={locationsState.reload}
        />
      )}
      {creating && (
        <EntityWizard
          initialType="location"
          ctx={{ settingId }}
          onClose={() => setCreating(false)}
        />
      )}
      {wizardParentId !== null && (
        <EntityWizard
          initialType="location"
          ctx={{ settingId, defaults: { parentLocationId: wizardParentId } } as unknown as { settingId: number }}
          onClose={() => setWizardParentId(null)}
          onCreated={() => setWizardParentId(null)}
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
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onInit={setRf}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onNodeContextMenu={handleNodeContextMenu}
            zoomOnScroll
            minZoom={0.05}
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
