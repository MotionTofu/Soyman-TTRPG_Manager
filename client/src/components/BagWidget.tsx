import { useEffect, useRef, useState, type DragEvent } from "react";
import { useLocation } from "react-router-dom";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { Modal } from "./Modal";
import { NavIcon } from "./NavIcons";
import { Verstak } from "./Verstak/Verstak";
import { onBagToast, useBag, addToBag, removeFromBag, removeItemsFromBag } from "../bag";
import { detectCurrentEntity, resolveCurrentEntityDetails } from "../currentEntity";
import { useUnloadTargets, type UnloadTarget } from "../unloadTargets";
import { api } from "../api/client";
import { stripMentions } from "../mentions";
import type { CompendiumEntry, SearchResult } from "../types";

export function BagWidget() {
  const location = useLocation();
  const { items, size } = useBag();
  const targets = useUnloadTargets();
  const [dragOver, setDragOver] = useState(false);
  const [unloading, setUnloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: "info" | "error" } | null>(null);
  const [verstakOpen, setVerstakOpen] = useState(false);

  useEffect(() => {
    const off = onBagToast((payload) => {
      setToast(payload);
      window.setTimeout(() => setToast((cur) => (cur?.message === payload.message ? null : cur)), 2500);
    });
    return off;
  }, []);

  async function handleAddCurrent() {
    const current = detectCurrentEntity(location.pathname, location.search);
    if (!current) return;
    const details = await resolveCurrentEntityDetails(current.type, current.id);
    if (!details) return;
    const item: SearchResult = { type: current.type, id: current.id, ...details };
    addToBag(item);
  }

  function handleDragStart(e: DragEvent<HTMLDivElement>, item: SearchResult) {
    e.dataTransfer.setData(SEARCH_DRAG_MIME, JSON.stringify(item));
    e.dataTransfer.effectAllowed = "link";
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragOver(false);
    const raw = e.dataTransfer.getData(SEARCH_DRAG_MIME);
    if (!raw) return;
    try {
      addToBag(JSON.parse(raw) as SearchResult);
    } catch {
    }
  }

  const targetsFor = (item: SearchResult) => targets.filter((t) => t.accepts(item));
  const unloadable = items.filter((i) => targetsFor(i).length > 0);
  const distinctTargets = new Set(unloadable.flatMap((i) => targetsFor(i).map((t) => t.id)));

  async function unloadAll() {
    const plan = unloadable.map((item) => ({ item, target: targetsFor(item)[0] }));
    await runUnload(plan);
  }

  async function runUnload(plan: { item: SearchResult; target: UnloadTarget }[]) {
    const done: SearchResult[] = [];
    for (const { item, target } of plan) {
      try {
        await target.drop(item);
        done.push(item);
      } catch (err) {
        console.error("Не удалось выгрузить из мешка:", item, err);
      }
    }
    removeItemsFromBag(done);
    setUnloading(false);
  }

  const cells = Array.from({ length: size }, (_, i) => items[i] ?? null);

  const unloadTitle =
    items.length === 0
      ? "Мешок пуст"
      : unloadable.length === 0
        ? "На этой странице некуда выгружать содержимое мешка"
        : "Выгрузить содержимое мешка на эту страницу";

  return (
    <div className="bag-widget">
      <div className="search-heading bag-heading">
        <strong>Мешок</strong>
        <div className="row" style={{ gap: 4 }}>
          <button
            type="button"
            className="bag-unload"
            disabled={items.length === 0}
            title={items.length === 0 ? "Мешок пуст" : "Открыть все карточки из мешка на верстаке"}
            onClick={() => setVerstakOpen(true)}
          >
            На верстак
          </button>
          <button
            type="button"
            className="bag-unload"
            disabled={unloadable.length === 0}
            title={unloadTitle}
            onClick={() => (distinctTargets.size > 1 ? setUnloading(true) : unloadAll())}
          >
            Выгрузить
          </button>
        </div>
      </div>
      {toast && (
        <div className={`bag-toast bag-toast-${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}
      <div
        className={`bag-grid${dragOver ? " drag-over" : ""}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(SEARCH_DRAG_MIME)) return;
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {cells.map((item, i) =>
          item ? (
            <div
              key={i}
              className="bag-cell bag-cell-filled"
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              title={item.title}
            >
              <span className="bag-cell-label">{item.title}</span>
              <button
                type="button"
                className="bag-cell-remove"
                onClick={() => removeFromBag(i)}
                title="Убрать из мешка"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              key={i}
              type="button"
              className="bag-cell bag-cell-empty"
              onClick={handleAddCurrent}
              title="Добавить текущую страницу в мешок (или перетащите сюда сущность)"
            >
              +
            </button>
          )
        )}
      </div>
      {unloading && (
        <UnloadModal
          items={items}
          targetsFor={targetsFor}
          onCancel={() => setUnloading(false)}
          onConfirm={runUnload}
        />
      )}
      {verstakOpen && (
        <BagVerstakModal
          items={items}
          onClose={() => setVerstakOpen(false)}
          onRemove={removeFromBag}
        />
      )}
    </div>
  );
}

function UnloadModal({
  items,
  targetsFor,
  onCancel,
  onConfirm,
}: {
  items: SearchResult[];
  targetsFor: (item: SearchResult) => UnloadTarget[];
  onCancel: () => void;
  onConfirm: (plan: { item: SearchResult; target: UnloadTarget }[]) => void;
}) {
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [`${item.type}:${item.id}`, targetsFor(item)[0]?.id ?? ""])
    )
  );

  function confirm() {
    const plan: { item: SearchResult; target: UnloadTarget }[] = [];
    for (const item of items) {
      const targetId = choice[`${item.type}:${item.id}`];
      const target = targetsFor(item).find((t) => t.id === targetId);
      if (target) plan.push({ item, target });
    }
    onConfirm(plan);
  }

  return (
    <Modal onClose={onCancel}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Выгрузить из мешка</h3>
        <span className="muted">
          На этой странице несколько мест, куда можно положить. Выберите, что и куда.
        </span>
        <div className="stack unload-plan">
          {items.map((item) => {
            const options = targetsFor(item);
            const key = `${item.type}:${item.id}`;
            return (
              <div key={key} className="unload-plan-row">
                <span>{item.title}</span>
                {options.length === 0 ? (
                  <span className="muted">некуда положить</span>
                ) : (
                  <select
                    value={choice[key] ?? ""}
                    onChange={(e) => setChoice((prev) => ({ ...prev, [key]: e.target.value }))}
                  >
                    {options.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                    <option value="">— не выгружать —</option>
                  </select>
                )}
              </div>
            );
          })}
        </div>
        <div className="row">
          <button className="primary" onClick={confirm}>
            Выгрузить
          </button>
          <button onClick={onCancel}>Отмена</button>
        </div>
      </div>
    </Modal>
  );
}

function BagVerstakModal({
  items,
  onClose,
  onRemove,
}: {
  items: SearchResult[];
  onClose: () => void;
  onRemove: (index: number) => void;
}) {
  const [entries, setEntries] = useState<CompendiumEntry[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const compendiumItems = items.filter((i) => i.type === "compendium_entry");
      if (compendiumItems.length === 0) {
        if (!cancelled) { setEntries([]); setLoading(false); }
        return;
      }
      try {
        const ids = compendiumItems.map((i) => i.id);
        const fetched = await api.get<CompendiumEntry[]>(`/systems/entries/batch?ids=${ids.join(",")}`);
        if (!cancelled) {
          setEntries(fetched);
          setSelectedIds(new Set(fetched.map((e) => e.id)));
        }
      } catch {
        if (!cancelled) { setEntries([]); setSelectedIds(new Set()); }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [items]);

  async function handleShowToPlayers() {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    const systemId = entries[0]?.system_id;
    if (!systemId) return;
    try {
      await api.post(`/systems/${systemId}/show-entries`, { entry_ids: ids });
    } catch (e) {
      console.error("Не удалось показать игрокам:", e);
    }
  }

  if (loading) {
    return <Verstak entries={[]} selectedIds={new Set()} onPrint={() => {}} onShow={() => {}} forceOpen onClose={onClose} />;
  }

  return (
    <Verstak
      entries={entries}
      selectedIds={selectedIds}
      onPrint={() => {}}
      onShow={handleShowToPlayers}
      forceOpen
      onClose={onClose}
      onRemove={(id) => {
        setSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        const idx = items.findIndex((it) => it.type === "compendium_entry" && it.id === id);
        if (idx >= 0) onRemove(idx);
      }}
    />
  );
}
