import { useEffect, useRef, useState, type DragEvent, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { SEARCH_DRAG_MIME } from "./LinkDropZone";
import { Modal } from "./Modal";
import { onBagToast, useBag, addToBag, bagItemKey, removeFromBag, removeItemsFromBag, type BagItem } from "../bag";
import { detectCurrentEntity, resolveCurrentEntityDetails } from "../currentEntity";
import { useUnloadTargets, type UnloadTarget } from "../unloadTargets";
import { useAfterWrite } from "../data/hooks";
import { attemptWithNotice } from "../data/notices";
import type { SearchResult } from "../types";
import { useMapWorkspace } from "../maps/workspace/workspaceContext";
import { placementSource } from "../maps/workspace/tokenPlacement";
import { useCurrentUser } from "../api/currentUser";
import { safeGetItem, safeSetItem } from "../utils/safeStorage";
import { WebInbox, useWebInbox } from "./WebInbox";
import { RuleArticleModal } from "./RuleArticleModal";
import { WORKBENCH_AFFECTS, addCardsToWorkbench, useWorkbench } from "../workbench";

// title — заголовок снаружи: в правой панели это кнопка, сворачивающая модуль.
export function BagWidget({ title, onMapPlace }: { title?: ReactNode; onMapPlace?: () => void } = {}) {
  const location = useLocation();
  const mapPlacement = useMapWorkspace()?.placement;
  const { items, size } = useBag();
  const targets = useUnloadTargets();
  const [dragOver, setDragOver] = useState(false);
  const [unloading, setUnloading] = useState(false);
  const [toast, setToast] = useState<{ message: string; kind: "info" | "error" } | null>(null);
  const [article, setArticle] = useState<BagItem | null>(null);
  const articleTrigger = useRef<HTMLButtonElement | null>(null);
  // Входящие (захват с сайтов) — вкладка Мешка у Мастера; на карте их нет.
  const isPlayer = useCurrentUser().user?.role === "player";
  const showInbox = !isPlayer && !mapPlacement;
  const inbox = useWebInbox(showInbox).data ?? [];
  const [tab, setTab] = useState<"bag" | "inbox">(() => (safeGetItem("bagTab") === "inbox" ? "inbox" : "bag"));
  const onInbox = showInbox && tab === "inbox";
  // Верстак — постоянный черновик (В9, В10): кнопка работает и при пустом
  // Мешке, на ней счётчик блоков; карточки Мешка добавляются, Мешок остаётся.
  const navigate = useNavigate();
  const afterWrite = useAfterWrite();
  const benchCount = useWorkbench({ enabled: !isPlayer }).data?.length ?? 0;
  async function toWorkbench() {
    const ids = items.filter((i) => i.type === "compendium_entry").map((i) => i.id);
    if (ids.length && !(await attemptWithNotice("Не добавлено на верстак", () => addCardsToWorkbench(ids)))) return;
    if (ids.length) afterWrite(WORKBENCH_AFFECTS);
    navigate("/workbench");
  }
  function pickTab(next: "bag" | "inbox") {
    setTab(next);
    safeSetItem("bagTab", next);
  }

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

  function handleDragStart(e: DragEvent<HTMLDivElement>, item: BagItem) {
    if (item.pdfQuote) {
      e.dataTransfer.setData("text/plain", item.pdfQuote.text);
      e.dataTransfer.effectAllowed = "copy";
      return;
    }
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
  const staging = items.filter((item) => !item.pdfQuote && !item.rule?.pinned);
  const unloadable = staging.filter((item) => targetsFor(item).length > 0);
  const distinctTargets = new Set(unloadable.flatMap((i) => targetsFor(i).map((t) => t.id)));

  async function unloadAll() {
    const plan = unloadable.map((item) => ({ item, target: targetsFor(item)[0] }));
    await runUnload(plan);
  }

  async function runUnload(plan: { item: BagItem; target: UnloadTarget }[]) {
    const done: BagItem[] = [];
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

  const ordered = [...items].sort((a, b) => Number(!!b.rule?.pinned) - Number(!!a.rule?.pinned));
  const cells = Array.from({ length: size }, (_, i) => ordered[i] ?? null);

  const unloadTitle =
    items.length === 0
      ? "Мешок пуст"
      : unloadable.length === 0
        ? "На этой странице некуда выгружать содержимое мешка"
        : "Выгрузить содержимое мешка на эту страницу";

  return (
    <div className="bag-widget">
      <div className="search-heading bag-heading">
        {title ?? <strong>Мешок</strong>}
        {!onInbox && <div className="row" style={{ gap: 4 }}>
          {!isPlayer && <button
            type="button"
            className="bag-unload"
            title={items.some((i) => i.type === "compendium_entry") ? "Добавить карточки из мешка на верстак и открыть его" : "Открыть верстак"}
            onClick={() => void toWorkbench()}
          >
            На верстак{benchCount > 0 ? ` · ${benchCount}` : ""}
          </button>}
          <button
            type="button"
            className="bag-unload"
            disabled={unloadable.length === 0}
            title={unloadTitle}
            onClick={() => (distinctTargets.size > 1 ? setUnloading(true) : unloadAll())}
          >
            Выгрузить
          </button>
        </div>}
      </div>
      {showInbox && (
        <div className="d-seg bag-tabs" role="tablist" aria-label="Мешок">
          <button type="button" role="tab" aria-selected={!onInbox} className={onInbox ? "" : "active"} onClick={() => pickTab("bag")}>
            Мешок<b>{items.length}</b>
          </button>
          <button type="button" role="tab" aria-selected={onInbox} className={onInbox ? "active" : ""} onClick={() => pickTab("inbox")}>
            Входящие<b>{inbox.length}</b>
          </button>
        </div>
      )}
      {onInbox && <WebInbox items={inbox} />}
      {toast && (
        <div className={`bag-toast bag-toast-${toast.kind}`} role="status" aria-live="polite">
          {toast.message}
        </div>
      )}
      {!onInbox && <div
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
              key={bagItemKey(item)}
              className={`bag-cell bag-cell-filled${item.rule?.pinned ? " bag-cell-pinned" : ""}`}
              draggable
              onDragStart={(e) => handleDragStart(e, item)}
              title={item.pdfQuote ? `${item.title} · Стр. ${item.pdfQuote.page}\n${item.pdfQuote.text}` : item.title}
            >
              {item.pdfQuote
                ? <Link className="bag-cell-label" draggable={false} to={`/resources/${item.id}/read?page=${item.pdfQuote.page}`}>{item.pdfQuote.text}</Link>
                : item.type === "compendium_entry" && (item.rule || item.kind === "mechanic_item")
                  ? <button type="button" className="bag-article-button" draggable={false}
                      aria-label={item.rule?.pinned ? `${item.title}, закреплено` : undefined}
                      onClick={(e) => { articleTrigger.current = e.currentTarget; setArticle(item); }}>
                      <span className="bag-cell-label">{item.title}</span>
                    </button>
                  : <span className="bag-cell-label">{item.title}</span>}
              {mapPlacement && placementSource(item) && <button type="button" className="bag-cell-place" title="Разместить на карте" aria-label={`Разместить из мешка: ${item.title}`}
                onClick={() => { mapPlacement.place(placementSource(item)!); onMapPlace?.(); }}>На карту</button>}
              <button
                type="button"
                className="bag-cell-remove"
                onClick={() => removeFromBag(item)}
                title="Убрать из мешка"
              >
                ✕
              </button>
            </div>
          ) : (
            <button
              key={`empty-${i}`}
              type="button"
              className="bag-cell bag-cell-empty"
              onClick={handleAddCurrent}
              title="Добавить текущую страницу в мешок (или перетащите сюда сущность)"
            >
              +
            </button>
          )
        )}
      </div>}
      {unloading && (
        <UnloadModal
          items={staging}
          targetsFor={targetsFor}
          onCancel={() => setUnloading(false)}
          onConfirm={runUnload}
        />
      )}
      {article && <RuleArticleModal source={{ item: article }} returnFocusTo={articleTrigger} onClose={() => setArticle(null)} />}
    </div>
  );
}

function UnloadModal({
  items,
  targetsFor,
  onCancel,
  onConfirm,
}: {
  items: BagItem[];
  targetsFor: (item: SearchResult) => UnloadTarget[];
  onCancel: () => void;
  onConfirm: (plan: { item: BagItem; target: UnloadTarget }[]) => void;
}) {
  const [choice, setChoice] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      items.map((item) => [`${item.type}:${item.id}`, targetsFor(item)[0]?.id ?? ""])
    )
  );

  function confirm() {
    const plan: { item: BagItem; target: UnloadTarget }[] = [];
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

