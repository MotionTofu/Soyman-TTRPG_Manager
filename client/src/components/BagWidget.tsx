import { useState, type DragEvent } from "react";
import { useLocation } from "react-router-dom";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { Modal } from "./Modal";
import { useBag, addToBag, removeFromBag, removeItemsFromBag } from "../bag";
import { detectCurrentEntity, resolveCurrentEntityDetails } from "../currentEntity";
import { useUnloadTargets, type UnloadTarget } from "../unloadTargets";
import type { SearchResult } from "../types";

// A small grid of slots between search and pinned pages. Empty slots show a
// "+" that grabs whatever entity the current page is about (see
// currentEntity.ts) and drops it into the bag; filled slots are draggable
// with the same SEARCH_DRAG_MIME payload a search result carries, so they
// work on every existing drop target (session Локации/Противники,
// LinkDropZone, playlists, …) with no changes needed there. Класть в мешок
// можно и перетаскиванием — сетка принимает тот же payload.
export function BagWidget() {
  const location = useLocation();
  const { items, size } = useBag();
  const targets = useUnloadTargets();
  const [dragOver, setDragOver] = useState(false);
  const [unloading, setUnloading] = useState(false);

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
    addToBag(JSON.parse(raw) as SearchResult);
  }

  // Куда именно можно положить каждую вещь на этой странице.
  const targetsFor = (item: SearchResult) => targets.filter((t) => t.accepts(item));
  const unloadable = items.filter((i) => targetsFor(i).length > 0);
  const distinctTargets = new Set(unloadable.flatMap((i) => targetsFor(i).map((t) => t.id)));

  async function unloadAll() {
    // Одна цель на всю страницу — спрашивать не о чем.
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
        // Одна неудачная вещь не должна отменять остальные; она просто
        // остаётся в мешке.
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
    </div>
  );
}

// Выбор «что и куда» — показывается, когда на странице больше одной цели.
// По умолчанию каждая вещь идёт в первую подходящую; «не выгружать» оставляет
// её в мешке.
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
