import { useEffect, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { useUnloadTarget } from "../unloadTargets";
import { resolveEntityLabel } from "../api/resolveEntity";
import { ENTITY_TYPE_SINGULAR } from "../entityTypes";
import type { SearchResult } from "../types";
import { useConfirm } from "../hooks/useConfirm";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
}

interface LinkedItem {
  linkId: number;
  type: string;
  id: number;
  label: string;
}

interface Props {
  entityType: string;
  entityId: number;
  title?: string;
}

export const SEARCH_DRAG_MIME = "application/x-rpg-search-result";

export function LinkDropZone({ entityType, entityId, title = "Связанное" }: Props) {
  const [items, setItems] = useState<LinkedItem[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [confirmDialog, confirm] = useConfirm();

  async function load() {
    const links = await api.get<GenericLink[]>(
      `/links?type=${entityType}&id=${entityId}`
    );
    const resolved = await Promise.all(
      links.map(async (l) => {
        const other =
          l.from_type === entityType && l.from_id === entityId
            ? { type: l.to_type, id: l.to_id }
            : { type: l.from_type, id: l.from_id };
        const label = await resolveEntityLabel(other.type, other.id);
        return { linkId: l.id, type: other.type, id: other.id, label };
      })
    );
    setItems(resolved);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId]);

  async function link(result: SearchResult) {
    await api.post("/links", {
      from_type: entityType,
      from_id: entityId,
      to_type: result.type,
      to_id: result.id,
    });
    load();
  }

  // Та же связь, но из мешка (кнопка «Выгрузить»), а не перетаскиванием.
  useUnloadTarget({ label: title, accepts: () => true, drop: link });

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    await link(JSON.parse(raw) as SearchResult);
  }

  async function removeLink(linkId: number) {
    const ok = await confirm({ message: "Удалить связь?", confirmLabel: "Удалить", danger: true });
    if (!ok) return;
    await api.del(`/links/${linkId}`);
    load();
  }

  return (
    <div className="stack" id={`section-${entityType}-${entityId}-${title.replace(/\s+/g, "-")}`}>
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
            <div key={it.linkId} className="row" style={{ justifyContent: "space-between" }}>
              <span className="row" style={{ alignItems: "center" }}>
                <span className={`entity-type-chip ${it.type}`}>{ENTITY_TYPE_SINGULAR[it.type] ?? it.type}</span>
                {it.label}
              </span>
              <button onClick={() => removeLink(it.linkId)}>✕</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
