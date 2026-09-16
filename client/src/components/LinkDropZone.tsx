import { useEffect, useState, type DragEvent } from "react";
import { useAction, useResource, write } from "../data/hooks";
import { relationAffects, settingPaths } from "../data/settingEntities";
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
  const run = useAction();
  const sectionParam = section ? `&section=${encodeURIComponent(section)}` : "";
  const relations = useResource<{ outgoing: UnifiedRelation[]; incoming: UnifiedRelation[] }>(
    `${settingPaths.relations(entityType, entityId)}${sectionParam}`
  ).data;

  // Подписи другой стороны разрешаются по одной (resolveEntityLabel держит свой
  // кэш), поэтому список собирается отдельно от чтения связей. Устаревший
  // проход — связи успели перечитаться — свой результат не кладёт.
  useEffect(() => {
    if (!relations) return;
    let cancelled = false;
    void (async () => {
      const seen = new Set<number>();
      const all: LinkedItem[] = [];
      for (const r of [...relations.outgoing, ...relations.incoming]) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        const otherType = r.from_type === entityType ? r.to_type : r.from_type;
        const otherId = r.from_type === entityType ? r.to_id : r.from_id;
        const label = await resolveEntityLabel(otherType, otherId);
        all.push({ relationId: r.id, type: otherType, id: otherId, label });
      }
      if (!cancelled) setItems(all);
    })();
    return () => {
      cancelled = true;
    };
  }, [relations, entityType]);

  async function link(result: SearchResult) {
    const body = {
      from_type: entityType,
      from_id: entityId,
      to_type: result.type,
      to_id: result.id,
      tone: "neutral",
      label: "",
      description: "",
      section: section ?? null,
      origin: "planned",
    };
    // Без «Повторить»: повтор после потерянного ответа завёл бы связь дважды.
    await run(() => write.post("/entity-relations", body), { affects: relationAffects(), retry: false });
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
    await run(() => write.del(`/entity-relations/${relationId}`), { affects: relationAffects() });
  }

  return (
    <div className="stack" id={`section-${entityType}-${entityId}-${(title ?? "").replace(/\s+/g, "-")}`}>
      {confirmDialog}
      <strong>{title}</strong>
      <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>
        Перетащите сюда результат поиска (правая панель) или выгрузите из Мешка. Совет: клавиша / — поиск.
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
