import { useEffect, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { useUnloadTarget } from "../unloadTargets";
import { resolveEntityLabel } from "../api/resolveEntity";
import { ENTITY_TYPE_SINGULAR } from "../entityTypes";
import type { SearchResult } from "../types";
import { useConfirm } from "../hooks/useConfirm";

interface UnifiedRelation {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  section: string | null;
}

interface LinkedItem {
  relationId: number;
  type: string;
  id: number;
  label: string;
}

interface Props {
  entityType: string;
  entityId: number;
  title?: string;
  /** Namespace for grouping — stored as `section` in entity_relations. */
  section?: string;
}

export const SEARCH_DRAG_MIME = "application/x-rpg-search-result";

export function LinkDropZone({ entityType, entityId, title = "Связанное", section }: Props) {
  const [items, setItems] = useState<LinkedItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDialog, confirm] = useConfirm();

  async function load() {
    const sectionParam = section ? `&section=${encodeURIComponent(section)}` : "";
    const data = await api.get<{ outgoing: UnifiedRelation[]; incoming: UnifiedRelation[] }>(
      `/entity-relations?entity_type=${entityType}&entity_id=${entityId}${sectionParam}`
    );
    // Merge outgoing + incoming, deduplicate by relationId
    const seen = new Set<number>();
    const all: LinkedItem[] = [];
    for (const r of [...data.outgoing, ...data.incoming]) {
      if (seen.has(r.id)) continue;
      seen.add(r.id);
      const otherType = r.from_type === entityType ? r.to_type : r.from_type;
      const otherId = r.from_type === entityType ? r.to_id : r.from_id;
      const label = await resolveEntityLabel(otherType, otherId);
      all.push({ relationId: r.id, type: otherType, id: otherId, label });
    }
    setItems(all);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, section]);

  async function link(result: SearchResult) {
    await api.post("/entity-relations", {
      from_type: entityType,
      from_id: entityId,
      to_type: result.type,
      to_id: result.id,
      tone: "neutral",
      label: "",
      description: "",
      section: section ?? null,
      origin: "planned",
    });
    load();
  }

  useUnloadTarget({ label: title, accepts: () => true, drop: link });

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    await link(JSON.parse(raw) as SearchResult);
  }

  async function removeLink(relationId: number) {
    const ok = await confirm({ message: "Удалить связь?", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    await api.del(`/entity-relations/${relationId}`);
    load();
  }

  return (
    <div className="stack" id={`section-${entityType}-${entityId}-${(title ?? "").replace(/\s+/g, "-")}`}>
      {confirmDialog}
      <strong>{title}</strong>
      <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
        Перетащите сюда результат поиска (правая панель) или выгрузите из Мешка. Совет: Ctrl+K — поиск.
      </span>
      <div
        className={`drop-zone${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {items.length === 0 && (
          <span className="muted">Пока нет связей — перетащите сюда</span>
        )}
        <div className="stack">
          {items.map((it) => (
            <div key={it.relationId} className="row" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ alignItems: "center" }}>
                <span className={`entity-type-chip ${it.type}`}>{ENTITY_TYPE_SINGULAR[it.type] ?? it.type}</span>
                {it.label}
              </span>
              <button onClick={() => removeLink(it.relationId)}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
