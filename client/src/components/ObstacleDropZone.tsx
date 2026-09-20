import { memo, useEffect, useMemo, useState, type DragEvent } from "react";
import { useSearch } from "../data/search";
import { resolveEntityLabel } from "../api/resolveEntity";
import { useAction, useResource, write } from "../data/hooks";
import { readResource } from "../data/imperative";
import { linkAffects, linksPath } from "../data/sessions";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { EntityPreviewModal } from "./EntityPreviewModal";
import { DETAIL_ROUTES } from "../entityTypes";
import type { SearchResult, SessionUnionRow, SettingBeing } from "../types";
import { ToInitiativeButton } from "./ToInitiativeButton";
import { Modal } from "./Modal";

// "Препятствия" — broader than the old "Противники" (enemies-only, beings-only)
// block: any existing entity can represent an obstacle (a creature, an NPC,
// a location, a dangerous artifact, a hostile community), not just bestiary
// creatures. Kept the `section: "enemies"` link key so existing session data
// isn't orphaned by the rename.
// compendium_entry is accepted too, but only for kind "monster" (checked in
// handleDrop) — a system Бестиарий template dropped straight in, without
// needing a per-setting being row.
const ACCEPT_TYPES = ["being", "character", "location", "artifact", "community", "compendium_entry"];

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
  sessionId: number;
  // Passed as "live" when rendered inside the session pult, so drops made
  // during a running session are tagged distinctly from ones planned ahead
  // of time via the session profile page (same drop zone, different caller).
  origin?: string;
  /** Состав всех сцен сессии для этой панели — строками без крестика. */
  unionRows?: SessionUnionRow[];
  /** Показывать ли «в трекер инициативы» у существ. */
  toInitiative?: boolean;
}

// Memoized so an unrelated setState elsewhere on the session page (e.g.
// typing in the Игровая дата fields) doesn't force this drop zone to
// re-render along with everything else.
export const ObstacleDropZone = memo(function ObstacleDropZone({
  sessionId,
  origin,
  unionRows,
  toInitiative,
}: Props) {
  // Связи «Препятствий» — из кэша слоя данных: запуск сцены задевает связи
  // сессии (data/sessions.ts), и зона перечитывается сама. Тот же ключ читают
  // шпаргалки сессии.
  const links = useResource<GenericLink[]>(linksPath("session", sessionId, "enemies")).data;
  const run = useAction();
  const [rows, setRows] = useState<Entry[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [preview, setPreview] = useState<{ type: string; id: number } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (!links) return;
    let cancelled = false;
    void Promise.all(
      links.map(async (l): Promise<Entry | null> => {
        const other =
          l.from_type === "session" && l.from_id === sessionId
            ? { type: l.to_type, id: l.to_id }
            : { type: l.from_type, id: l.from_id };
        try {
          if (other.type === "being") {
            const being = await readResource<SettingBeing>(`/setting-beings/${other.id}`);
            return {
              linkId: l.id,
              type: other.type,
              id: other.id,
              label: being.name,
              origin: l.origin,
              qty: l.qty ?? null,
            };
          }
          const label = await resolveEntityLabel(other.type, other.id);
          return { linkId: l.id, type: other.type, id: other.id, label, origin: l.origin, qty: l.qty ?? null };
        } catch {
          return null;
        }
      })
    ).then((resolved) => {
      if (!cancelled) setRows(resolved.filter((e): e is Entry => e !== null));
    });
    return () => {
      cancelled = true;
    };
  }, [links, sessionId]);

  const entries = useMemo(() => {
    const keys = new Set(rows.map((e) => `${e.type}:${e.id}`));
    // Связь Мастера бьёт объединение: рука точнее заготовки.
    const union: Entry[] = (unionRows ?? [])
      .filter((u) => !keys.has(`${u.to_type}:${u.to_id}`))
      .map((u) => ({
        linkId: null,
        type: u.to_type,
        id: u.to_id,
        label: u.name,
        origin: "planned",
        qty: u.qty || null,
        fromScenes: u.scenes,
        inScene: u.inScene,
      }));
    return [...rows, ...union];
  }, [rows, unionRows]);

  // Добавить препятствие. Без повтора на плашке: ответ мог потеряться после
  // того, как связь уже легла, и повтор завёл бы вторую.
  async function addLink(result: SearchResult): Promise<boolean> {
    const done = await run(
      async () => {
        await write.post("/links", {
          from_type: "session",
          from_id: sessionId,
          to_type: result.type,
          to_id: result.id,
          section: "enemies",
          origin: origin === "live" ? "live" : "planned",
        });
        return true;
      },
      { affects: linkAffects("session", sessionId), retry: false }
    );
    return done === true;
  }

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
    if (!ACCEPT_TYPES.includes(result.type)) return;
    if (result.type === "compendium_entry" && result.kind !== "monster") return;
    await addLink(result);
  }

  const [pendingDelete, setPendingDelete] = useState<number | null>(null);
  const [filter, setFilter] = useState("");

  async function remove(relationId: number) {
    setPendingDelete(null);
    await run(() => write.del(`/links/${relationId}`), { affects: linkAffects("session", sessionId) });
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
      {entries.length === 0 && (
        <span className="muted">
          Перетащите сюда из поиска — существо, персонажа, локацию, артефакт, сообщество…
        </span>
      )}
      {entries.length > 0 && filteredEntries.length === 0 && <span className="muted">Ничего не найдено по фильтру.</span>}
      <div className="stack" style={{ gap: 0 }}>
        {filteredEntries.map((entry) => (
          <div
            key={`${entry.type}:${entry.id}:${entry.linkId ?? "union"}`}
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
              e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify({ type: entry.type, id: entry.id, title: entry.label }));
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
              {/* Количество приехало вместе с составом сцены. Это напоминание,
                  а не счётчик: «1к6» Мастер кинет настоящим кубиком за столом,
                  и приложение за него этого не делает. */}
              {entry.qty && <span className="muted qty-chip">{entry.qty}</span>}
              {entry.inScene && <span className="in-scene-chip">в сцене</span>}
              {entry.fromScenes && !entry.inScene && (
                <span className="muted" style={{ opacity: 0.5, fontSize: "var(--fs-micro)" }} title={entry.fromScenes.join(", ")}>
                  {entry.fromScenes.length === 1 ? entry.fromScenes[0] : `сцен: ${entry.fromScenes.length}`}
                </span>
              )}
            </div>
            {toInitiative && (
              <ToInitiativeButton item={{ type: entry.type, id: entry.id, title: entry.label } as SearchResult} />
            )}
            {/* Строку объединения удалить нельзя: она не связь сессии, а состав
                сцены — правится в приключении, а не на пульте. */}
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
            <p className="muted" style={{ margin: 0 }}>Связь будет удалена.</p>
            <div className="row">
              <button className="danger" onClick={() => remove(pendingDelete)}>Удалить</button>
              <button onClick={() => setPendingDelete(null)}>Отмена</button>
            </div>
          </div>
        </Modal>
      )}
      {pickerOpen && (
        <ObstaclePicker
          onPick={async (result) => {
            if (await addLink(result)) setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
      {preview && <EntityPreviewModal type={preview.type} id={preview.id} onClose={() => setPreview(null)} />}
    </div>
  );
});

function ObstaclePicker({ onPick, onClose }: { onPick: (r: SearchResult) => void; onClose: () => void }) {
  const [q, setQ] = useState("");
  const search = useSearch(
    q.trim().length >= 2 ? `/search?q=${encodeURIComponent(q.trim())}&types=${ACCEPT_TYPES.join(",")}` : null,
    250
  );
  const items = search.results
    .filter((r) => ACCEPT_TYPES.includes(r.type) && !(r.type === "compendium_entry" && r.kind !== "monster"))
    .slice(0, 20);
  const loading = search.searching;
  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Добавить препятствие</h3>
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
