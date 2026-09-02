import { memo, useEffect, useState, type DragEvent } from "react";
import { api } from "../api/client";
import { resolveEntityLabel } from "../api/resolveEntity";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { DETAIL_ROUTES } from "../entityTypes";
import { parseMentions, resolveMention } from "../mentions";
import type { SearchResult, SessionUnionRow } from "../types";
import { ToInitiativeButton } from "./ToInitiativeButton";
import { Modal } from "./Modal";

interface GenericLink {
  id: number;
  from_type: string;
  from_id: number;
  to_type: string;
  to_id: number;
  origin: string;
  qty: string | null;
}

interface Entry {
  linkId: number | null;
  type: string;
  id: number;
  label: string;
  origin: string;
  qty: string | null;
  /** Пришёл объединением по сценам сессии, а не связью. */
  fromScenes?: string[];
  inScene?: boolean;
}

interface Props {
  entityType: string;
  entityId: number;
  section: string;
  acceptTypes: string[];
  placeholder: string;
  // Optional: also surface entities @-mentioned in this text (filtered to
  // mentionTypes) as read-only rows alongside the real drag-drop links — e.g.
  // a being mentioned in a session's "Задумка" shows up in Сюжетные персонажи
  // without the GM having to drag it in separately. Mention-derived rows have
  // linkId: null and can't be removed here (edit the text instead).
  mentionText?: string;
  mentionTypes?: string[];
  // Passed as "live" by the session pult's panels so drops made during a
  // running session are tagged distinctly from ones planned ahead of time
  // via the session profile page (same drop zone, different call site).
  origin?: string;
  // When "compendium_entry" is in acceptTypes, further restricts drops to
  // entries whose own kind (equipment/magic_item/spell/…) is in this list —
  // e.g. Потенциальный лут accepts compendium items but not spells/monsters.
  // Ignored for other accepted types.
  acceptCompendiumKinds?: string[];
  // Счётчик запусков сцен на пульте. Запуск подменяет состав панели на
  // сервере, а зона о нём не знает — без этого Мастер увидит прошлую сцену до
  // перезагрузки страницы, то есть ровно тогда, когда смотреть некогда.
  version?: number;
  // Состав всех сцен сессии для этой панели. Показывается строками без
  // крестика: удалить участника отсюда значило бы удалить его из сцены, а это
  // правка приключения, а не пульта.
  unionRows?: SessionUnionRow[];
  // Показывать ли кнопку «в трекер инициативы» у существ. Только на пульте:
  // на странице сессии до игры трекера ещё нет.
  toInitiative?: boolean;
}

// Memoized — see ObstacleDropZone's comment. acceptTypes/mentionTypes are
// arrays, so callers must pass stable (module-level or memoized) references
// for this to actually skip re-rendering; a fresh literal each render would
// still break the memo.
export const SectionDropZone = memo(function SectionDropZone({
  entityType,
  entityId,
  section,
  acceptTypes,
  placeholder,
  mentionText,
  mentionTypes,
  origin,
  acceptCompendiumKinds,
  version,
  unionRows,
  toInitiative,
}: Props) {
  const [linkEntries, setLinkEntries] = useState<Entry[]>([]);
  const [mentionEntries, setMentionEntries] = useState<Entry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  async function load() {
    const links = await api.get<GenericLink[]>(
      `/links?type=${entityType}&id=${entityId}&section=${section}`
    );
    const settled = await Promise.allSettled(
      links.map(async (l) => {
        const other =
          l.from_type === entityType && l.from_id === entityId
            ? { type: l.to_type, id: l.to_id }
            : { type: l.from_type, id: l.from_id };
        try {
          const label = await resolveEntityLabel(other.type, other.id);
          return { linkId: l.id, type: other.type, id: other.id, label, origin: l.origin, qty: l.qty ?? null } as Entry;
        } catch {
          return null;
        }
      })
    );
    const resolved = settled
      .map((r) => (r.status === "fulfilled" ? r.value : null))
      .filter((e): e is Entry => e !== null);
    setLinkEntries(resolved);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityType, entityId, section, version]);

  useEffect(() => {
    if (!mentionText || !mentionTypes || mentionTypes.length === 0) {
      setMentionEntries([]);
      return;
    }
    let cancelled = false;
    // Упоминание, чья цель на этом устройстве не установлена, сюда не попадает:
    // показывать в списке связей строку, за которой ничего нет, незачем.
    const tokens = parseMentions(mentionText)
      .filter((m) => mentionTypes.includes(m.type))
      .map((m) => ({ type: m.type, id: resolveMention(m.type, m.uid) }))
      .filter((m): m is { type: string; id: number } => m.id != null);
    Promise.all(
      tokens.map(async (m) => ({
        linkId: null as number | null,
        type: m.type,
        id: m.id,
        label: await resolveEntityLabel(m.type, m.id),
        origin: "planned",
        qty: null,
      }))
    ).then((rows) => {
      if (!cancelled) setMentionEntries(rows);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mentionText, mentionTypes?.join(",")]);

  const linkKeys = new Set(linkEntries.map((e) => `${e.type}:${e.id}`));
  const unionEntries: Entry[] = (unionRows ?? []).map((u) => ({
    linkId: null,
    type: u.to_type,
    id: u.to_id,
    label: u.name,
    origin: "planned",
    qty: u.qty || null,
    fromScenes: u.scenes,
    inScene: u.inScene,
  }));
  // Связь Мастера бьёт объединение: он положил её рукой, и его количество
  // точнее заготовки. Две одинаковых карточки за столом читаются как «их
  // двое», а это прямая ошибка в бою.
  const shown = [...linkEntries, ...unionEntries.filter((e) => !linkKeys.has(`${e.type}:${e.id}`))];
  const shownKeys = new Set(shown.map((e) => `${e.type}:${e.id}`));
  const entries = [...shown, ...mentionEntries.filter((e) => !shownKeys.has(`${e.type}:${e.id}`))];

  async function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    let result: SearchResult;
    try {
      result = JSON.parse(raw);
    } catch {
      return;
    }
    if (!acceptTypes.includes(result.type)) return;
    if (
      result.type === "compendium_entry" &&
      acceptCompendiumKinds &&
      !acceptCompendiumKinds.includes(result.kind ?? "")
    )
      return;
    if (entityType === "session") {
      await api.post("/links", {
        from_type: entityType,
        from_id: entityId,
        to_type: result.type,
        to_id: result.id,
        section,
        origin: origin === "live" ? "live" : "planned",
      });
    } else {
      await api.post("/entity-relations", {
        from_type: entityType,
        from_id: entityId,
        to_type: result.type,
        to_id: result.id,
        section,
        origin,
        tone: "neutral",
        label: "",
        description: "",
      });
    }
    load();
  }

  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  async function remove(relationId: number) {
    if (entityType === "session") await api.del(`/links/${relationId}`);
    else await api.del(`/entity-relations/${relationId}`);
    setPendingDelete(null);
    load();
  }

  const filteredEntries = filter.trim()
    ? entries.filter((e) => e.label.toLowerCase().includes(filter.trim().toLowerCase()))
    : entries;

  return (
    <div
      className={`drop-zone${dragOver ? " drag-over" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {entries.length > 5 && (
        <input placeholder="Фильтр…" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ marginBottom: 8, width: "100%" }} />
      )}
      {entries.length === 0 && <span className="muted">{placeholder}</span>}
      {entries.length > 0 && filteredEntries.length === 0 && <span className="muted">Ничего не найдено по фильтру.</span>}
      <div className="stack" style={{ gap: 0 }}>
        {filteredEntries.map((entry) => (
          <div
            key={`${entry.type}-${entry.id}`}
            className="resource-row row"
            style={{
              justifyContent: "space-between",
              background: entry.origin === "live" ? "color-mix(in srgb, #c0392b 12%, transparent)" : undefined,
            }}
            title={
              entry.origin === "live"
                ? "Добавлено на ходу во время сессии"
                : entry.origin === "scene"
                  ? "Принесла запущенная сцена — уйдёт со следующей"
                  : undefined
            }
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(
                SEARCH_DRAG_MIME,
                JSON.stringify({ type: entry.type, id: entry.id, title: entry.label })
              );
              e.dataTransfer.effectAllowed = "link";
            }}
          >
            <div className="row" style={{ minWidth: 0, flex: 1 }}>
              {DETAIL_ROUTES[entry.type] ? (
                <button
                  type="button"
                  onClick={() => setPreview({ type: entry.type, id: entry.id })}
                  style={{
                    fontWeight: 600,
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--accent)",
                    cursor: "pointer",
                    textAlign: "left",
                  }}
                >
                  {entry.label}
                </button>
              ) : (
                <span style={{ fontWeight: 600 }}>{entry.label}</span>
              )}
              {/* Количество приехало вместе с составом сцены: напоминание
                  нужно там, куда Мастер смотрит в бою. */}
              {entry.qty && <span className="muted qty-chip">{entry.qty}</span>}
              {/* Кто в запущенной сцене — плашкой: среди двадцати имён глаз
                  иначе не найдёт нужного. */}
              {entry.inScene && <span className="in-scene-chip">в сцене</span>}
              {entry.linkId === null && !entry.fromScenes && <span className="muted">из задумки</span>}
              {entry.fromScenes && !entry.inScene && (
                <span className="muted" title={entry.fromScenes.join(", ")}>
                  {entry.fromScenes.length === 1 ? entry.fromScenes[0] : `сцен: ${entry.fromScenes.length}`}
                </span>
              )}
              {toInitiative && (
                <ToInitiativeButton item={{ type: entry.type, id: entry.id, title: entry.label } as SearchResult} />
              )}
            </div>
            {entry.linkId !== null && (
              <button className="comp-mini" onClick={() => setPendingDelete(entry.linkId!)}>
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
      <button type="button" className="comp-mini" style={{ marginTop: 8 }} onClick={() => setPickerOpen(true)}>
        + Добавить
      </button>
      {pendingDelete !== null && (
        <Modal onClose={() => setPendingDelete(null)}>
          <div className="stack">
            <h3 style={{ margin: 0 }}>Удалить связь?</h3>
            <p className="muted" style={{ margin: 0 }}>Связь будет удалена. Это можно вернуть только повторным добавлением.</p>
            <div className="row">
              <button className="danger" onClick={() => remove(pendingDelete)}>Удалить</button>
              <button onClick={() => setPendingDelete(null)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
      {pickerOpen && (
        <DropZonePicker
          acceptTypes={acceptTypes}
          acceptCompendiumKinds={acceptCompendiumKinds}
          onPick={async (result) => {
            if (entityType === "session") {
              await api.post("/links", {
                from_type: entityType,
                from_id: entityId,
                to_type: result.type,
                to_id: result.id,
                section,
                origin: origin === "live" ? "live" : "planned",
              });
            } else {
              await api.post("/entity-relations", {
                from_type: entityType,
                from_id: entityId,
                to_type: result.type,
                to_id: result.id,
                section,
                origin,
                tone: "neutral",
                label: "",
                description: "",
              });
            }
            setPickerOpen(false);
            load();
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
    </div>
  );
});

function DropZonePicker({
  acceptTypes,
  acceptCompendiumKinds,
  onPick,
  onClose,
}: {
  acceptTypes: string[];
  acceptCompendiumKinds?: string[];
  onPick: (r: SearchResult) => void;
  onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const [items, setItems] = useState<SearchResult[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (q.trim().length < 2) { setItems([]); return; }
    setLoading(true);
    const handle = setTimeout(() => {
      const types = acceptTypes.join(",");
      api.get<SearchResult[]>(`/search?q=${encodeURIComponent(q.trim())}&types=${types}`)
        .then((rows) => {
          const filtered = rows.filter((r) => {
            if (!acceptTypes.includes(r.type)) return false;
            if (r.type === "compendium_entry" && acceptCompendiumKinds && !acceptCompendiumKinds.includes(r.kind ?? "")) return false;
            return true;
          });
          setItems(filtered.slice(0, 20));
        })
        .catch(() => setItems([]))
        .finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(handle);
  }, [q, acceptTypes, acceptCompendiumKinds]);
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Добавить</h3>
        <input autoFocus placeholder="Поиск — 2+ символа" value={q} onChange={(e) => setQ(e.target.value)} />
        {loading && <span className="muted">Поиск…</span>}
        {!loading && q.trim().length >= 2 && items.length === 0 && <span className="muted">Ничего не найдено.</span>}
        <div className="stack" style={{ maxHeight: 320, overflowY: "auto", gap: 4 }}>
          {items.map((r) => (
            <button key={`${r.type}:${r.id}`} type="button" className="row" style={{ justifyContent: "space-between", textAlign: "left" }} onClick={() => onPick(r)}>
              <span><strong>{r.title}</strong>{r.context && <span className="muted"> — {r.context}</span>}</span>
              <span className="muted" style={{ fontSize: "var(--fs-micro)" }}>{r.type}</span>
            </button>
          ))}
        </div>
        <div className="row"><button type="button" onClick={onClose}>Закрыть</button></div>
      </div>
    </Modal>
  );
}
