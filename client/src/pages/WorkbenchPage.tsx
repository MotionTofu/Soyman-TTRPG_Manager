import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type DragEvent } from "react";
import { createPortal } from "react-dom";
import { Navigate } from "react-router-dom";
import { useCurrentUser } from "../api/currentUser";
import { Loading } from "../components/Loading";
import { BlockContent } from "../components/workbench/BlockContent";
import { CONTENT_W, GAP, HALF_W, paginate, type Layout, type LayoutItem, type Piece } from "../components/workbench/layout";
import { measureBlock } from "../components/workbench/measure";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { attemptWithNotice } from "../data/notices";
import { useConfirm } from "../hooks/useConfirm";
import { useIsMobile } from "../hooks/useIsMobile";
import { useUndoDelete } from "../hooks/useUndoDelete";
import type { CompendiumEntry } from "../types";
import { WORKBENCH_AFFECTS, WORKBENCH_PATH, useWorkbench, type WorkbenchBlock } from "../workbench";
import "../components/workbench/workbench.css";

// Верстак (гриллинг 2026-11-11, В1–В18; макет Web-Bench*, холст v100).
// Список блоков слева — порядок и правка; листы справа — как выйдет на бумагу.

const NO_BLOCKS: WorkbenchBlock[] = [];
const NO_ENTRIES: CompendiumEntry[] = [];
const SCALE = 0.54;

export function WorkbenchRoute() {
  const { user, loading } = useCurrentUser();
  if (loading) return <Loading full />;
  return user?.role === "player" ? <Navigate to="/" replace /> : <WorkbenchPage />;
}

function blockName(block: WorkbenchBlock, entry?: CompendiumEntry): string {
  if (block.kind === "card") return entry?.name ?? "Запись удалена";
  if (block.kind === "page_break") return "С новой страницы";
  return block.title.trim() || block.text.trim().split("\n")[0].replace(/[*_#>|`]+/g, "").slice(0, 80) || "Свой текст";
}

function blockMeta(block: WorkbenchBlock, entry: CompendiumEntry | undefined, gone: boolean): string {
  if (block.kind === "card") return gone ? "Запись удалена · убрать" : `Карточка · ${block.card_mode === "description" ? "описание" : "карточка"}`;
  if (block.kind === "text") return "Свой текст";
  if (block.kind === "fragment") {
    let site = "";
    try { site = block.url ? new URL(block.url).hostname.replace(/^www\./, "") : ""; } catch { site = ""; }
    return [site, block.show_source ? "подпись ✓" : ""].filter(Boolean).join(" · ");
  }
  return "";
}

function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  return m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? few : many;
}

export function WorkbenchPage() {
  const isMobile = useIsMobile();
  const afterWrite = useAfterWrite();
  const { offerUndo } = useUndoDelete();
  const [confirmDialog, confirm] = useConfirm();
  const query = useWorkbench({ pollMs: 5000 });
  const serverBlocks = query.data ?? NO_BLOCKS;
  // Перестановка видна сразу, до ответа сервера.
  const [order, setOrder] = useState<string[] | null>(null);
  const blocks = useMemo(() => {
    if (!order) return serverBlocks;
    const byId = new Map(serverBlocks.map((b) => [b.id, b]));
    const sorted = order.map((id) => byId.get(id)).filter(Boolean) as WorkbenchBlock[];
    return [...sorted, ...serverBlocks.filter((b) => !order.includes(b.id))];
  }, [serverBlocks, order]);
  useEffect(() => { setOrder(null); }, [serverBlocks]);

  const entryIds = useMemo(() => [...new Set(blocks.filter((b) => b.kind === "card" && b.entry_id).map((b) => b.entry_id as number))].sort((a, b) => a - b), [blocks]);
  const batch = useResource<CompendiumEntry[]>(entryIds.length ? `/systems/entries/batch?ids=${entryIds.join(",")}` : null, { keepPrevious: true });
  const entries = useMemo(() => new Map((entryIds.length ? batch.data ?? NO_ENTRIES : NO_ENTRIES).map((e) => [e.id, e])), [batch.data, entryIds.length]);
  // Прежний ответ (keepPrevious) не знает только что добавленных карточек —
  // по нему «Запись удалена» не решается.
  const entriesReady = !entryIds.length || (!!batch.data && !batch.loading && !batch.placeholder);
  const isGone = useCallback((b: WorkbenchBlock) => b.kind === "card" && entriesReady && !entries.has(b.entry_id ?? -1), [entries, entriesReady]);

  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);

  // На листы идёт всё, кроме удалённых записей компендиума: те видны в списке (В8).
  const sheetBlocks = useMemo(() => blocks.filter((b) => !isGone(b) && !(b.kind === "card" && !entries.has(b.entry_id ?? -1))), [blocks, entries, isGone]);
  const { layout, layer: measureLayer } = useSheetLayout(sheetBlocks, entries);

  const save = useCallback(async (block: WorkbenchBlock, patch: Partial<Pick<WorkbenchBlock, "width" | "card_mode">> & { show_source?: boolean }) => {
    if (await attemptWithNotice("Не сохранилось", () => write.put(`/workbench/blocks/${block.id}`, patch))) afterWrite(WORKBENCH_AFFECTS);
  }, [afterWrite]);

  const remove = useCallback(async (block: WorkbenchBlock, entry?: CompendiumEntry) => {
    let removed: WorkbenchBlock | null = null;
    const ok = await attemptWithNotice("Не убрано", async () => { removed = await write.del<WorkbenchBlock>(`/workbench/blocks/${block.id}`); });
    if (!ok || !removed) return;
    afterWrite(WORKBENCH_AFFECTS);
    if (editing === block.id) setEditing(null);
    const back = removed;
    offerUndo({
      entityName: blockName(block, entry),
      message: `Убрано: ${blockName(block, entry)}`,
      restoreFn: async () => { await write.post("/workbench/blocks/restore", back); afterWrite(WORKBENCH_AFFECTS); },
    });
  }, [afterWrite, editing, offerUndo]);

  const add = useCallback(async (kind: "text" | "page_break") => {
    let created: WorkbenchBlock | null = null;
    if (await attemptWithNotice("Не добавлено", async () => { created = await write.post<WorkbenchBlock>("/workbench/blocks", { kind }); })) {
      afterWrite(WORKBENCH_AFFECTS);
      const block = created as WorkbenchBlock | null;
      if (block && kind === "text") { setSelected(block.id); setEditing(block.id); }
    }
  }, [afterWrite]);

  const clearAll = useCallback(async () => {
    const ok = await confirm({ title: "Очистить верстак?", message: "Все блоки уйдут с верстака. Вернуть их будет нельзя.", confirmLabel: "Очистить", danger: true });
    if (ok && await attemptWithNotice("Не очищено", () => write.del("/workbench/blocks"))) afterWrite(WORKBENCH_AFFECTS);
  }, [afterWrite, confirm]);

  // «Показать игрокам» — только карточки (В11); показ идёт по системе записи.
  const shownCards = sheetBlocks.filter((b) => b.kind === "card").map((b) => entries.get(b.entry_id as number)).filter(Boolean) as CompendiumEntry[];
  const showToPlayers = useCallback(async () => {
    const bySystem = new Map<number, number[]>();
    for (const e of shownCards) bySystem.set(e.system_id, [...(bySystem.get(e.system_id) ?? []), e.id]);
    for (const [systemId, ids] of bySystem) {
      await attemptWithNotice("Не показано игрокам", () => write.post(`/systems/${systemId}/show-entries`, { entry_ids: ids }));
    }
  }, [shownCards]);

  const reorder = useCallback(async (ids: string[]) => {
    setOrder(ids);
    if (await attemptWithNotice("Порядок не сохранился", () => write.put("/workbench/order", { ids }))) afterWrite(WORKBENCH_AFFECTS);
    else setOrder(null);
  }, [afterWrite]);

  // Печать: те же листы в масштабе 1 — в отдельный слой, остальное прячет @media print.
  useEffect(() => {
    if (!printing) return;
    document.body.classList.add("wb-printing");
    const done = () => { document.body.classList.remove("wb-printing"); setPrinting(false); };
    const timer = window.setTimeout(() => { window.print(); done(); }, 50);
    return () => { window.clearTimeout(timer); document.body.classList.remove("wb-printing"); };
  }, [printing]);

  if (query.loading && !query.data) return <Loading />;
  const pageCount = layout.pages.length;
  const count = blocks.length;
  const countLabel = `${count} ${plural(count, "блок", "блока", "блоков")}`;

  const list = (
    <BlockList
      blocks={blocks} entries={entries} isGone={isGone} selected={selected} editing={editing} forcedFull={layout.forcedFull}
      onSelect={(id) => { setSelected(id); document.querySelector(`[data-wb-block="${id}"]`)?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }}
      onEdit={setEditing} onRemove={remove} onSave={save} onReorder={reorder} readOnly={isMobile}
      head={<><h3 className="d-plate">Блоки</h3><span className="d-mono">{countLabel}{!isMobile && pageCount > 0 && count > 0 ? ` · ${pageCount} ${plural(pageCount, "лист", "листа", "листов")}` : ""}</span></>}
      foot={isMobile ? null : <><button type="button" className="d-btn d-btn--sm" onClick={() => void add("text")}>+ Свой текст</button>
        <button type="button" className="d-btn d-btn--sm" onClick={() => void add("page_break")}>+ С новой страницы</button></>}
    />
  );

  if (isMobile) {
    return (
      <div className="wb wb--phone">
        <header className="d-head"><div><h2>Верстак</h2></div></header>
        <p className="wb-phone-note"><b>Вёрстка и печать — на компьютере</b>Здесь видно, что лежит на верстаке, и можно убрать лишнее.</p>
        {list}
        {count > 0 && <button type="button" className="d-btn d-btn--quiet" onClick={() => void clearAll()}>Очистить верстак</button>}
        {confirmDialog}{measureLayer}
      </div>
    );
  }

  return (
    <div className="wb">
      <header className="d-head">
        <div>
          <h2>Верстак</h2>
          <div className="d-head__sub">Черновик сохраняется сам. Сюда попадают карточки из Мешка и компендиума и фрагменты с сайтов.</div>
        </div>
        <div className="d-head__acts">
          <button type="button" className="d-btn d-btn--quiet" disabled={!count} onClick={() => void clearAll()}>Очистить верстак</button>
          <button type="button" className="d-btn" disabled={!shownCards.length} onClick={() => void showToPlayers()}>Показать игрокам · {shownCards.length}</button>
          <button type="button" className="d-btn d-btn--primary" disabled={!sheetBlocks.length} onClick={() => setPrinting(true)}>Печать</button>
        </div>
      </header>
      <div className="wb-body">
        {list}
        <div className="wb-pages" onClick={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          {!count && <p className="wb-empty">Верстак пуст. Положите сюда карточки из Мешка или компендиума, фрагмент со страницы сайта (ПКМ → SoyMan → «Разобрать сейчас…» → «Верстак») или добавьте свой текст.</p>}
          {layout.pages.map((pieces, index) => (
            <div key={index} className="wb-page-slot">
              <div className="wb-zoom" style={{ width: 794 * SCALE, height: 1122 * SCALE }}>
                <Sheet pieces={pieces} blocks={sheetBlocks} entries={entries} scale={SCALE} selected={selected} pageNo={index + 1} pageCount={pageCount}
                  onSelect={setSelected} toolbar={(block) => (
                    <BlockToolbar block={block} forcedFull={layout.forcedFull.has(block.id)}
                      onEdit={() => setEditing(block.id)} onSave={(patch) => void save(block, patch)}
                      onRemove={() => void remove(block, entries.get(block.entry_id ?? -1))} />
                  )} />
              </div>
              <div className="d-mono wb-page-no">Лист {index + 1}</div>
            </div>
          ))}
        </div>
      </div>
      {printing && createPortal(
        <div className="wb-print">
          {layout.pages.map((pieces, index) => <Sheet key={index} pieces={pieces} blocks={sheetBlocks} entries={entries} scale={1} pageNo={index + 1} pageCount={pageCount} />)}
        </div>,
        document.body,
      )}
      {confirmDialog}{measureLayer}
    </div>
  );
}

// ───────────── Раскладка: замер в скрытом слое, потом арифметика ─────────────

function useSheetLayout(blocks: WorkbenchBlock[], entries: Map<number, CompendiumEntry>): { layout: Layout; layer: React.ReactNode } {
  const [layout, setLayout] = useState<Layout>({ pages: [[]], forcedFull: new Set() });
  const [fontsTick, setFontsTick] = useState(0);
  useEffect(() => { void document.fonts?.ready.then(() => setFontsTick((t) => t + 1)); }, []);
  const host = useMemo(() => {
    const el = document.createElement("div");
    el.className = "wb-measure";
    el.setAttribute("aria-hidden", "true");
    return el;
  }, []);
  // До замера: отрезанный от документа слой меряется нулями.
  useLayoutEffect(() => { document.body.appendChild(host); return () => host.remove(); }, [host]);
  // retry — повтор замера на следующем кадре, если слой ещё не дорисован.
  const [retry, force] = useState(0);
  // Замерный слой рисуется порталом; после его отрисовки — замер.
  useLayoutEffect(() => {
    const items: LayoutItem[] = [];
    for (const block of blocks) {
      if (block.kind === "page_break") { items.push({ id: block.id, kind: "break" }); continue; }
      const own = host.querySelector<HTMLElement>(`[data-measure="${block.id}"]`);
      // Слой ещё не дорисовал этот блок — замер на следующем кадре.
      if (!own) { requestAnimationFrame(() => force((n) => n + 1)); return; }
      const m = measureBlock(own);
      const full = block.width === "half" ? host.querySelector<HTMLElement>(`[data-measure-full="${block.id}"]`) : null;
      items.push({
        id: block.id, kind: "block", width: block.width, height: m.height, breaks: m.breaks,
        // Карточка режется, только если сама выше листа; текст — по строкам.
        splittable: block.kind !== "card" || block.card_mode === "description",
        full: full ? measureBlock(full) : undefined,
      });
    }
    const next = paginate(items);
    setLayout((prev) => JSON.stringify(prev.pages) === JSON.stringify(next.pages) && [...prev.forcedFull].join() === [...next.forcedFull].join() ? prev : next);
  }, [blocks, entries, host, retry, fontsTick]);
  const layer = createPortal(
    <div className="wb-sheet-text">
      {blocks.filter((b) => b.kind !== "page_break").map((b) => (
        <div key={b.id}>
          <div data-measure={b.id} style={{ width: b.width === "half" ? HALF_W : CONTENT_W }}><BlockContent block={b} entry={entries.get(b.entry_id ?? -1)} /></div>
          {b.width === "half" && <div data-measure-full={b.id} style={{ width: CONTENT_W }}><BlockContent block={b} entry={entries.get(b.entry_id ?? -1)} /></div>}
        </div>
      ))}
    </div>,
    host,
  );
  return { layout, layer };
}

// ───────────── Лист ─────────────

function Sheet({ pieces, blocks, entries, scale, selected, pageNo, pageCount, onSelect, toolbar }: {
  pieces: Piece[]; blocks: WorkbenchBlock[]; entries: Map<number, CompendiumEntry>; scale: number; selected?: string | null;
  pageNo: number; pageCount: number; onSelect?: (id: string) => void; toolbar?: (block: WorkbenchBlock) => React.ReactNode;
}) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  const screen = !!onSelect;
  return (
    <div className="wb-sheet wb-sheet-text" style={screen ? { transform: `scale(${scale})`, ["--wb-k" as string]: scale } : undefined}>
      <div className="wb-sheet__flow" style={{ gap: GAP }}>
        {pieces.map((piece) => {
          const parts = piece.ids.map((id) => byId.get(id)).filter(Boolean) as WorkbenchBlock[];
          const height = piece.to - piece.from;
          return (
            <div key={`${piece.ids.join("+")}-${piece.from}`} className={`wb-piece${piece.half ? " wb-piece--row" : ""}`} style={{ height }}>
              {screen && piece.continued && <span className="wb-cont">↳ продолжение · {parts[0] && (parts[0].title || "фрагмент")}</span>}
              {parts.map((block) => {
                const sel = screen && selected === block.id;
                return (
                  <div key={block.id} data-wb-block={block.id} className={`wb-slice${sel ? " is-selected" : ""}${piece.from ? "" : " is-head"}`}
                    style={{ width: piece.half ? HALF_W : CONTENT_W, height }}
                    onClick={screen ? (e) => { e.stopPropagation(); onSelect?.(block.id); } : undefined}>
                    <div className="wb-clip"><div style={{ marginTop: -piece.from }}><BlockContent block={block} entry={entries.get(block.entry_id ?? -1)} /></div></div>
                    {sel && !piece.continued && toolbar?.(block)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="wb-sheet__no">{pageNo} / {pageCount}</div>
    </div>
  );
}

function BlockToolbar({ block, forcedFull, onEdit, onSave, onRemove }: {
  block: WorkbenchBlock; forcedFull: boolean; onEdit: () => void;
  onSave: (patch: { width?: "full" | "half"; show_source?: boolean; card_mode?: "description" | "card" }) => void; onRemove: () => void;
}) {
  const stop = (fn: () => void) => (e: React.MouseEvent) => { e.stopPropagation(); fn(); };
  return (
    <div className="wb-toolbar" role="toolbar" aria-label="Блок">
      {block.kind !== "card" && <button type="button" onClick={stop(onEdit)}>Править</button>}
      {block.kind === "card" && <>
        <button type="button" className={block.card_mode !== "description" ? "on" : ""} onClick={stop(() => onSave({ card_mode: "card" }))}>Карточка</button>
        <button type="button" className={block.card_mode === "description" ? "on" : ""} onClick={stop(() => onSave({ card_mode: "description" }))}>Описание</button>
      </>}
      <button type="button" className={block.width === "full" ? "on" : ""} onClick={stop(() => onSave({ width: "full" }))}>Вся ширина</button>
      <button type="button" className={block.width === "half" ? "on" : ""} title={forcedFull ? "Не влезает в половину листа — стоит во всю ширину" : undefined}
        onClick={stop(() => onSave({ width: "half" }))}>Половина{forcedFull ? " · не влезает" : ""}</button>
      {block.kind === "fragment" && <button type="button" className={block.show_source ? "on" : ""} onClick={stop(() => onSave({ show_source: !block.show_source }))}>
        {block.show_source ? "☑" : "☐"} Подпись</button>}
      <button type="button" onClick={stop(onRemove)}>Убрать</button>
    </div>
  );
}

// ───────────── Список блоков и правка ─────────────

function BlockList({ blocks, entries, isGone, selected, editing, forcedFull, onSelect, onEdit, onRemove, onSave, onReorder, readOnly, head, foot }: {
  blocks: WorkbenchBlock[]; entries: Map<number, CompendiumEntry>; isGone: (b: WorkbenchBlock) => boolean;
  selected: string | null; editing: string | null; forcedFull: Set<string>;
  onSelect: (id: string) => void; onEdit: (id: string | null) => void;
  onRemove: (b: WorkbenchBlock, e?: CompendiumEntry) => void;
  onSave: (b: WorkbenchBlock, patch: { width?: "full" | "half"; show_source?: boolean }) => void;
  onReorder: (ids: string[]) => void; readOnly: boolean; head: React.ReactNode; foot: React.ReactNode;
}) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const drop = (e: DragEvent, targetId: string) => {
    e.preventDefault();
    if (!dragId || dragId === targetId) return;
    const ids = blocks.map((b) => b.id).filter((id) => id !== dragId);
    ids.splice(ids.indexOf(targetId), 0, dragId);
    onReorder(ids);
    setDragId(null); setOverId(null);
  };
  return (
    <section className="wb-list d-sheet" aria-label="Блоки верстака">
      <div className="wb-list__head">{head}</div>
      <div className="wb-list__rows">
        {blocks.map((block) => {
          const entry = entries.get(block.entry_id ?? -1);
          const gone = isGone(block);
          const kindIcon = block.kind === "card" ? "К" : block.kind === "text" ? "Т" : block.kind === "fragment" ? "¶" : "";
          return (
            <div key={block.id}>
              <div className={`wb-row${selected === block.id ? " is-selected" : ""}${gone ? " is-gone" : ""}${block.kind === "page_break" ? " is-break" : ""}${overId === block.id ? " is-over" : ""}`}
                draggable={!readOnly} onDragStart={() => setDragId(block.id)} onDragEnd={() => { setDragId(null); setOverId(null); }}
                onDragOver={(e) => { if (dragId) { e.preventDefault(); setOverId(block.id); } }} onDrop={(e) => drop(e, block.id)}
                onClick={() => onSelect(block.id)}>
                {!readOnly && <span className="wb-row__grip" aria-hidden="true">⋮⋮</span>}
                {block.kind === "page_break"
                  ? <b className="wb-row__break">— С новой страницы —</b>
                  : <>
                    <span className="wb-row__kind" aria-hidden="true">{kindIcon}</span>
                    <span className="wb-row__text"><b>{blockName(block, entry)}</b><small>{blockMeta(block, entry, gone)}</small></span>
                    {!gone && <span className="wb-row__w">{forcedFull.has(block.id) ? "½ → вся" : block.width === "half" ? "½" : "вся"}</span>}
                  </>}
                <button type="button" className="wb-row__x" aria-label="Убрать" title="Убрать" onClick={(e) => { e.stopPropagation(); onRemove(block, entry); }}>✕</button>
              </div>
              {editing === block.id && !readOnly && <BlockEditor block={block} onClose={() => onEdit(null)} onWidth={(width) => onSave(block, { width })}
                onSource={(show) => onSave(block, { show_source: show })} />}
            </div>
          );
        })}
      </div>
      {foot && <div className="wb-list__foot">{foot}</div>}
    </section>
  );
}

function BlockEditor({ block, onClose, onWidth, onSource }: {
  block: WorkbenchBlock; onClose: () => void; onWidth: (w: "full" | "half") => void; onSource: (show: boolean) => void;
}) {
  const afterWrite = useAfterWrite();
  const [title, setTitle] = useState(block.title);
  const [text, setText] = useState(block.text);
  const [base, setBase] = useState(block.revision);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Чужая версия: другое окно сохранило текст, пока здесь шла правка (В12).
  const [theirs, setTheirs] = useState<WorkbenchBlock | null>(null);
  const dirty = title !== block.title || text !== block.text;
  useEffect(() => {
    if (block.revision !== base && (block.title !== title || block.text !== text)) {
      if (!dirty) { setTitle(block.title); setText(block.text); setBase(block.revision); } else setTheirs(block);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.revision]);

  async function save(force = false) {
    setBusy(true); setError("");
    try {
      await write.put(`/workbench/blocks/${block.id}`, { title, text, base_revision: base, force });
      afterWrite([{ path: WORKBENCH_PATH }]);
      onClose();
    } catch (reason) {
      const failure = reason as Error & { status?: number; payload?: { block?: WorkbenchBlock } };
      if (failure.status === 409 && failure.payload?.block) setTheirs(failure.payload.block);
      else setError(failure.message || "Не сохранилось");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="wb-editor" onClick={(e) => e.stopPropagation()}>
      <label className="wb-editor__label">Заголовок{block.kind === "fragment" ? " · из страницы, можно стереть" : ""}
        <input className="d-input" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="wb-editor__label">Текст · Markdown
        <textarea className="wb-editor__md" value={text} rows={12} autoFocus={block.kind === "text"} onChange={(e) => setText(e.target.value)} />
      </label>
      <div className="wb-editor__line">
        {block.kind === "fragment" && <label><input type="checkbox" className="d-check" checked={!!block.show_source} onChange={(e) => onSource(e.target.checked)} /> Подпись источника при печати</label>}
        <div className="d-seg" role="group" aria-label="Ширина">
          <button type="button" className={block.width === "full" ? "active" : ""} onClick={() => onWidth("full")}>Вся</button>
          <button type="button" className={block.width === "half" ? "active" : ""} onClick={() => onWidth("half")}>½</button>
        </div>
      </div>
      {theirs && (
        <div className="wb-conflict" role="alert">
          <b>Текст изменён в другом окне</b>Ваша правка ещё не сохранена.
          <div className="wb-conflict__acts">
            <button type="button" className="d-btn d-btn--sm" onClick={() => { setTitle(theirs.title); setText(theirs.text); setBase(theirs.revision); setTheirs(null); }}>Показать их версию</button>
            <button type="button" className="d-btn d-btn--sm" disabled={busy} onClick={() => void save(true)}>Сохранить мою</button>
          </div>
        </div>
      )}
      {error && <p className="wb-editor__error" role="alert">{error}</p>}
      <div className="wb-editor__foot">
        <button type="button" className="d-btn" onClick={onClose}>Отмена</button>
        <button type="button" className="d-btn d-btn--primary" disabled={busy || !!theirs} onClick={() => void save()}>{busy ? "Сохраняю…" : "Готово"}</button>
      </div>
    </div>
  );
}
