import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { NavIcon } from "../NavIcons";
import { stripMentions } from "../../mentions";
import type { CompendiumEntry } from "../../types";

type Mode = "preview" | "print";
type Tool = "cursor" | "text" | "rect" | "circle" | "line";

interface TileLayout {
  id: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

interface TextItem {
  id: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
}

interface ShapeItem {
  id: number;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  kind: "rect" | "circle" | "line";
  color: string;
}

interface Props {
  entries: CompendiumEntry[];
  selectedIds: Set<number>;
  onPrint: () => void;
  onShow: () => void;
  forceOpen?: boolean;
  onClose?: () => void;
  onRemove?: (id: number) => void;
}

const A4_W = 794;
const A4_H = 1123;
const GAP = 12;

function estimateSize(entry: CompendiumEntry): { w: number; h: number } {
  const desc = entry.description || "";
  const dataCount = entry.data ? Object.keys(entry.data).length : 0;
  let w = 96;
  if (desc.length < 120 && dataCount <= 2) w = 46;
  else if (desc.length < 220) w = 68;
  const lines = Math.ceil(desc.length / 72);
  let h = 38 + lines * 14 + (dataCount ? 14 : 0) + 12;
  h = Math.max(74, Math.min(220, h));
  return { w, h };
}

export function Verstak({ entries, selectedIds, onPrint, onShow, forceOpen, onClose, onRemove }: Props) {
  const [mode, setMode] = useState<Mode>("preview");
  const [fullscreen, setFullscreen] = useState(false);
  const isForceOpen = !!forceOpen;
  const [customSizes, setCustomSizes] = useState<Record<number, { w: number; h: number }>>({});
  const [customPos, setCustomPos] = useState<Record<number, { x: number; y: number }>>({});
  const [tilePages, setTilePages] = useState<Record<number, number>>({});
  const [tool, setTool] = useState<Tool>("cursor");
  const [texts, setTexts] = useState<TextItem[]>([]);
  const [shapes, setShapes] = useState<ShapeItem[]>([]);
  const [extraPages, setExtraPages] = useState(0);
  type DisplayMode = "description" | "card" | "statblock";
  const [tileModes, setTileModes] = useState<Record<number, DisplayMode>>({});
  const [tileMenu, setTileMenu] = useState<{ x: number; y: number; id: number } | null>(null);
  const [drawing, setDrawing] = useState<{ kind: "rect" | "circle" | "line"; page: number; x: number; y: number; w: number; h: number; startX: number; startY: number } | null>(null);
  const selected = useMemo(() => entries.filter((e) => selectedIds.has(e.id)), [entries, selectedIds]);
  const hasSelection = selected.length > 0;

  function getAvailableModes(entry: CompendiumEntry): DisplayMode[] {
    const k = entry.kind;
    if (k === "monster") return ["description", "card", "statblock"];
    if (k === "spell") return ["description", "card"];
    if (k === "species" || k === "class" || k === "feat" || k === "background" || k === "equipment" || k === "magic_item") return ["description", "card"];
    return ["description"];
  }
  function getTileMode(id: number, entry: CompendiumEntry): DisplayMode {
    const saved = tileModes[id];
    if (saved && getAvailableModes(entry).includes(saved)) return saved;
    const modes = getAvailableModes(entry);
    return modes.includes("card") ? "card" : "description";
  }
  useEffect(() => {
    if (!tileMenu) return;
    const handler = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest(".verstak-tile-menu")) return;
      setTileMenu(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [tileMenu]);

  // сразу свободные: пакуем рядами с минимальным местом и фиксируем — дальше двигаем без сдвига соседей
  useEffect(() => {
    if (selected.length === 0) return;
    const pageW = A4_W - GAP * 2;
    let maxBottom = GAP;
    for (const idStr of Object.keys(customPos)) {
      const id = Number(idStr);
      if (!selectedIds.has(id)) continue;
      const pos = customPos[id];
      const sz = customSizes[id] ?? estimateSize(entries.find((x) => x.id === id) as CompendiumEntry);
      maxBottom = Math.max(maxBottom, pos.y + sz.h + GAP);
    }
    let curX = GAP;
    let curY = maxBottom;
    let rowH = 0;
    const toAdd: Record<number, { x: number; y: number }> = {};
    const toAddPages: Record<number, number> = {};
    let pageForNew = 0;
    // найдём текущую последнюю страницу по customPos
    for (const idStr of Object.keys(tilePages)) {
      const id = Number(idStr);
      if (!selectedIds.has(id)) continue;
      pageForNew = Math.max(pageForNew, tilePages[id]);
    }
    let curPage = pageForNew;
    for (const e of selected) {
      if (customPos[e.id]) continue;
      const sz = customSizes[e.id] ?? estimateSize(e);
      const wPx = (sz.w / 100) * pageW;
      if (curX + wPx + GAP > pageW && rowH > 0) {
        curX = GAP;
        curY += rowH + GAP;
        rowH = 0;
      }
      if (curY + sz.h + GAP > A4_H) {
        curPage += 1;
        curX = GAP;
        curY = GAP;
        rowH = 0;
      }
      toAdd[e.id] = { x: (curX / pageW) * 100, y: curY };
      toAddPages[e.id] = curPage;
      curX += wPx + GAP;
      rowH = Math.max(rowH, sz.h);
    }
    if (Object.keys(toAdd).length) {
      setCustomPos((prev) => ({ ...prev, ...toAdd }));
      setTilePages((prev) => ({ ...prev, ...toAddPages }));
    }
  }, [selected]);

  // страницы: пакуем автоплитки рядами, свободные — на своих x/y с пагинацией по y
  const pages = useMemo(() => {
    const basePages: { tiles: { entry: CompendiumEntry; layout: TileLayout; isDragged: boolean }[]; texts: TextItem[]; shapes: ShapeItem[] }[] = [{ tiles: [], texts: [], shapes: [] }];
    // добавим extraPages пустых
    for (let i = 0; i < extraPages; i++) basePages.push({ tiles: [], texts: [], shapes: [] });
    let curX = GAP;
    let curY = GAP;
    let rowH = 0;
    let pageIdx = 0;
    const pageW = A4_W - GAP * 2;
    // новые автоплитки начинаем ниже уже свободных
    let maxBottom = GAP;
    for (const e of selected) {
      if (customPos[e.id]) {
        const sz = customSizes[e.id] ?? estimateSize(e);
        const pg = tilePages[e.id] ?? 0;
        while (basePages.length <= pg) basePages.push({ tiles: [], texts: [], shapes: [] });
        maxBottom = Math.max(maxBottom, customPos[e.id]!.y + sz.h + GAP);
      }
    }
    if (Object.keys(customPos).length > 0) {
      curY = maxBottom;
    }
    for (const e of selected) {
      const isDragged = customPos[e.id] != null;
      const est = estimateSize(e);
      const sz = customSizes[e.id] ?? est;
      const w = sz.w;
      const h = sz.h;
      if (!isDragged) {
        const wPx = (w / 100) * pageW;
        if (curX + wPx + GAP > pageW && rowH > 0) {
          curX = GAP;
          curY += rowH + GAP;
          rowH = 0;
        }
        if (curY + h + GAP > A4_H && basePages[pageIdx].tiles.length > 0) {
          basePages.push({ tiles: [], texts: [], shapes: [] });
          pageIdx++;
          curX = GAP;
          curY = GAP;
          rowH = 0;
        }
        const l: TileLayout = { id: e.id, x: (curX / pageW) * 100, y: curY, w, h };
        while (basePages.length <= pageIdx) basePages.push({ tiles: [], texts: [], shapes: [] });
        basePages[pageIdx].tiles.push({ entry: e, layout: l, isDragged: false });
        curX += wPx + GAP;
        rowH = Math.max(rowH, h);
      } else {
        const pos = customPos[e.id]!;
        const pg = tilePages[e.id] ?? 0;
        while (basePages.length <= pg) basePages.push({ tiles: [], texts: [], shapes: [] });
        const pageH = A4_H - GAP * 2;
        let targetPage = pg;
        let relY = pos.y;
        if (relY + h + GAP > A4_H) {
          targetPage += 1;
          relY = GAP;
          while (basePages.length <= targetPage) basePages.push({ tiles: [], texts: [], shapes: [] });
          setTilePages((prev) => ({ ...prev, [e.id]: targetPage }));
        }
        const l: TileLayout = { id: e.id, x: pos.x, y: relY, w, h };
        basePages[targetPage].tiles.push({ entry: e, layout: l, isDragged: true });
        pageIdx = Math.max(pageIdx, targetPage);
      }
    }
    // тексты и фигуры по страницам
    for (const t of texts) {
      while (basePages.length <= t.page) basePages.push({ tiles: [], texts: [], shapes: [] });
      basePages[t.page].texts.push(t);
    }
    for (const s of shapes) {
      while (basePages.length <= s.page) basePages.push({ tiles: [], texts: [], shapes: [] });
      basePages[s.page].shapes.push(s);
    }
    return basePages.length === 0 ? [{ tiles: [], texts: [], shapes: [] }] : basePages;
  }, [selected, customSizes, customPos, tilePages, texts, shapes, extraPages]);

  function handlePrintVerstak() {
    const htmlPages = pages
      .map(
        (page) => `
      <div class="page" style="width:${A4_W}px;height:${A4_H}px;background:#fff;color:#111;border:1.5px solid #111;position:relative;overflow:hidden;margin:0 auto 16px auto;page-break-after:always;">
        <div style="position:absolute;inset:0;padding:${GAP}px;">
          ${page.tiles
            .map(
              ({ entry, layout }) => `
            <div style="position:absolute;left:${layout.x}%;top:${layout.y}px;width:${layout.w}%;height:${layout.h}px;border:1.5px solid #111;background:#fff;padding:8px;display:flex;flex-direction:column;gap:4px;overflow:hidden;box-sizing:border-box;">
              <div style="font-family:Oswald,sans-serif;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:0.06em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${(entry.name || "Без названия").replace(/</g, "&lt;")}</div>
              <div style="font-size:11px;line-height:1.35;white-space:pre-wrap;overflow:hidden;flex:1;">${stripMentions(entry.description || "").slice(0, 800).replace(/</g, "&lt;") || '<span style="color:#666">Без описания</span>'}</div>
              ${entry.data && Object.keys(entry.data).length ? `<div style="color:#666;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${Object.entries(entry.data).slice(0, 3).map(([k, v]) => `${String(k).replace(/</g, "&lt;")}: ${String(v).replace(/</g, "&lt;")}`).join(" · ")}</div>` : ""}
            </div>`
            )
            .join("")}
          ${page.texts.map((t) => `<div style="position:absolute;left:${t.x}px;top:${t.y}px;width:${t.w}px;height:${t.h}px;border:1px dashed #111;padding:4px;font-size:12px;white-space:pre-wrap;overflow:hidden;">${t.text.replace(/</g, "&lt;")}</div>`).join("")}
          ${page.shapes.map((s) => {
            if (s.kind === "rect") return `<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;border:2px solid ${s.color};box-sizing:border-box;"></div>`;
            if (s.kind === "circle") return `<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:${s.w}px;height:${s.h}px;border:2px solid ${s.color};border-radius:50%;box-sizing:border-box;"></div>`;
            if (s.kind === "line") return `<div style="position:absolute;left:${s.x}px;top:${s.y}px;width:${s.w}px;height:2px;background:${s.color};transform-origin:left center;"></div>`;
            return "";
          }).join("")}
        </div>
      </div>`
      )
      .join("");
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Верстак — печать</title><style>body{font-family:Georgia,serif;padding:24px;background:#eee;color:#111} .page{box-shadow:0 2px 8px rgba(0,0,0,0.15)} @media print{body{padding:0;background:#fff} .page{box-shadow:none;border:none;margin:0;page-break-after:always}}</style></head><body>${htmlPages}<script>window.print()</script></body></html>`;
    const w = window.open("", "_blank");
    if (w) {
      w.document.write(html);
      w.document.close();
    }
  }

  const addPage = () => setExtraPages((n) => n + 1);
  const removePage = (idx: number) => {
    if (pages.length <= 1) return;
    // убираем страницу — плитки с неё переносим на предыдущую
    const pageToRemove = pages[idx];
    if (!pageToRemove) return;
    for (const t of pageToRemove.tiles) {
      setTilePages((prev) => {
        const n = { ...prev };
        // переносим на предыдущую страницу, y сбрасываем
        n[t.entry.id] = Math.max(0, idx - 1);
        setCustomPos((pp) => ({ ...pp, [t.entry.id]: { x: t.layout.x, y: GAP } }));
        return n;
      });
    }
    for (const t of pageToRemove.texts) setTexts((prev) => prev.map((x) => (x.page === idx ? { ...x, page: Math.max(0, idx - 1) } : x.page > idx ? { ...x, page: x.page - 1 } : x)));
    for (const s of pageToRemove.shapes) setShapes((prev) => prev.map((x) => (x.page === idx ? { ...x, page: Math.max(0, idx - 1) } : x.page > idx ? { ...x, page: x.page - 1 } : x)));
    setExtraPages((n) => Math.max(0, n - 1));
    // сдвиг страниц у плиток
    setTilePages((prev) => {
      const n: Record<number, number> = {};
      for (const [k, v] of Object.entries(prev)) {
        const id = Number(k);
        if (v > idx) n[id] = v - 1;
        else if (v < idx) n[id] = v;
      }
      return n;
    });
  };

  const handlePageDrop = (pageIdx: number, e: React.DragEvent) => {
    e.preventDefault();
    const raw = e.dataTransfer.getData("text/plain");
    const id = Number(raw);
    if (!Number.isFinite(id)) return;
    setTilePages((prev) => ({ ...prev, [id]: pageIdx }));
    // при перетаскивании между страницами сбрасываем y к GAP, чтобы не улетало за пределы
    setCustomPos((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { x: cur.x, y: GAP } };
    });
  };

  const canvas = (
    <div className="verstak-pages" style={{ display: "grid", gap: 16 }}>
      {pages.map((page, pi) => (
        <div
          key={pi}
          className="verstak-page"
          data-page={pi}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => handlePageDrop(pi, e)}
          onMouseDown={(e) => {
            if ((e.target as HTMLElement).closest(".verstak-tile") || (e.target as HTMLElement).closest("[data-resize]")) return;
            if (tool === "text") {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const x = e.clientX - rect.left - GAP;
              const y = e.clientY - rect.top - GAP;
              const txt = window.prompt("Текст:");
              if (txt) setTexts((prev) => [...prev, { id: Date.now(), page: pi, x, y, w: 120, h: 32, text: txt }]);
              setTool("cursor");
              return;
            }
            if (tool === "rect" || tool === "circle" || tool === "line") {
              const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
              const x = e.clientX - rect.left - GAP;
              const y = e.clientY - rect.top - GAP;
              const kind = tool as "rect" | "circle" | "line";
              setDrawing({ kind, page: pi, x, y, w: 0, h: 0, startX: x, startY: y });
              const onMove = (ev: MouseEvent) => {
                const dx = ev.clientX - rect.left - GAP - x;
                const dy = ev.clientY - rect.top - GAP - y;
                setDrawing((prev) => prev ? { ...prev, w: Math.max(10, dx), h: kind === "line" ? 2 : Math.max(10, dy) } : null);
              };
              const onUp = (ev: MouseEvent) => {
                window.removeEventListener("mousemove", onMove);
                window.removeEventListener("mouseup", onUp);
                setDrawing((prev) => {
                  if (!prev) return null;
                  const finalW = Math.max(20, prev.w);
                  const finalH = kind === "line" ? 2 : Math.max(20, prev.h);
                  if (finalW < 10 || finalH < 10) return null;
                  setShapes((pp) => [...pp, { id: Date.now(), page: pi, x: prev.x, y: prev.y, w: finalW, h: finalH, kind, color: "#111" }]);
                  return null;
                });
                setTool("cursor");
              };
              window.addEventListener("mousemove", onMove);
              window.addEventListener("mouseup", onUp);
            }
          }}
          onClick={undefined}
          style={{
            width: "100%",
            maxWidth: A4_W,
            height: A4_H,
            background: mode === "print" ? "#fff" : "var(--paper)",
            color: mode === "print" ? "#111" : "var(--ink)",
            border: tool !== "cursor" ? "2px dashed var(--accent)" : "1.5px solid var(--line)",
            position: "relative",
            overflow: "hidden",
            filter: mode === "print" ? "grayscale(1)" : undefined,
            margin: "0 auto",
            cursor: tool === "text" ? "text" : tool === "cursor" ? "default" : "crosshair",
          }}
        >
          <div style={{ position: "absolute", inset: 0, padding: GAP }}>
            {page.tiles.map(({ entry, layout, isDragged }) => (
              <Tile
                key={entry.id}
                entry={entry}
                layout={layout}
                mode={mode}
                displayMode={getTileMode(entry.id, entry)}
                isDragged={isDragged}
                pageIndex={pi}
                onMove={(x, y) => setCustomPos((prev) => ({ ...prev, [entry.id]: { x, y } }))}
                onMoveToPage={(id, newPage) => setTilePages((prev) => ({ ...prev, [id]: newPage }))}
                tool={tool}
                onResize={(w, h) => setCustomSizes((prev) => ({ ...prev, [entry.id]: { w, h } }))}
                onResetPos={() => setCustomPos((prev) => { const n = { ...prev }; delete n[entry.id]; return n; })}
                onContextMenu={(x, y) => setTileMenu({ x, y, id: entry.id })}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", String(entry.id));
                  e.dataTransfer.effectAllowed = "move";
                }}
              />
            ))}
            {page.texts.map((t) => (
              <div
                key={t.id}
                style={{ position: "absolute", left: t.x, top: t.y, width: t.w, height: t.h, border: "1px dashed var(--line)", padding: 4, fontSize: "var(--fs-meta)", whiteSpace: "pre-wrap", overflow: "hidden", background: "var(--paper-2)", cursor: tool === "cursor" ? "grab" : "default" }}
                onMouseDown={(e) => {
                  if (tool !== "cursor") return;
                  const startX = e.clientX, startY = e.clientY, sx = t.x, sy = t.y;
                  const onMove = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX, dy = ev.clientY - startY;
                    setTexts((prev) => prev.map((x) => (x.id === t.id ? { ...x, x: Math.max(0, sx + dx), y: Math.max(0, sy + dy) } : x)));
                  };
                  const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                onDoubleClick={() => {
                  const nt = window.prompt("Текст:", t.text);
                  if (nt !== null) setTexts((prev) => prev.map((x) => (x.id === t.id ? { ...x, text: nt } : x)));
                }}
              >
                {t.text}
                <button type="button" onClick={() => setTexts((prev) => prev.filter((x) => x.id !== t.id))} style={{ position: "absolute", right: 2, top: 2, fontSize: "var(--fs-micro)" }}>✕</button>
              </div>
            ))}
            {page.shapes.map((s) => (
              <div
                key={s.id}
                style={{
                  position: "absolute",
                  left: s.x,
                  top: s.y,
                  width: s.w,
                  height: s.h,
                  border: s.kind === "line" ? undefined : `2px solid ${s.color}`,
                  background: s.kind === "line" ? s.color : "transparent",
                  borderRadius: s.kind === "circle" ? "50%" : undefined,
                  height: s.kind === "line" ? 2 : s.h,
                  cursor: tool === "cursor" ? "grab" : "default",
                }}
                onMouseDown={(e) => {
                  if (tool !== "cursor") return;
                  const startX = e.clientX, startY = e.clientY, sx = s.x, sy = s.y;
                  const onMove = (ev: MouseEvent) => {
                    const dx = ev.clientX - startX, dy = ev.clientY - startY;
                    setShapes((prev) => prev.map((x) => (x.id === s.id ? { ...x, x: Math.max(0, sx + dx), y: Math.max(0, sy + dy) } : x)));
                  };
                  const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
                  window.addEventListener("mousemove", onMove);
                  window.addEventListener("mouseup", onUp);
                }}
                onDoubleClick={() => setShapes((prev) => prev.filter((x) => x.id !== s.id))}
              />
            ))}
          </div>
          {drawing && drawing.page === pi && (
            <div
              style={{
                position: "absolute",
                left: drawing.x,
                top: drawing.y,
                width: drawing.w,
                height: drawing.h,
                border: drawing.kind === "line" ? undefined : `2px dashed var(--accent)`,
                background: drawing.kind === "line" ? "var(--accent)" : "color-mix(in oklab, var(--accent) 12%, transparent)",
                borderRadius: drawing.kind === "circle" ? "50%" : undefined,
                height: drawing.kind === "line" ? 2 : drawing.h,
                pointerEvents: "none",
              }}
            />
          )}
          <div style={{ position: "absolute", bottom: 6, right: 10, fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)", opacity: 0.5 }}>
            {pi + 1} / {pages.length}
          </div>
          <button type="button" onClick={() => removePage(pi)} title="Удалить страницу" style={{ position: "absolute", top: 4, right: 4, fontSize: "var(--fs-micro)", opacity: 0.6 }}>✕ стр.</button>
        </div>
      ))}
      <div className="row" style={{ justifyContent: "center" }}>
        <button type="button" onClick={addPage}>+ Добавить страницу</button>
      </div>
    </div>
  );

  const body = (
    <div className="card stack" style={{ position: fullscreen ? undefined : "sticky", top: fullscreen ? undefined : 16 }}>
      <div className="row" style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}>
        <div className="row" style={{ gap: 4 }}>
          <button type="button" className={tool === "cursor" ? "active-sort" : ""} onClick={() => setTool("cursor")} title="Курсор — двигать плитки/фигуры/текст">↖ Курсор</button>
          <button type="button" className={tool === "text" ? "active-sort" : ""} onClick={() => setTool("text")} title="Текст — клик по странице создаёт текстовый блок">Т Текст</button>
          <button type="button" className={tool === "rect" ? "active-sort" : ""} onClick={() => setTool("rect")} title="Прямоугольник">▭ Фигура</button>
          <button type="button" className={tool === "circle" ? "active-sort" : ""} onClick={() => setTool("circle")} title="Круг">○ Круг</button>
          <button type="button" className={tool === "line" ? "active-sort" : ""} onClick={() => setTool("line")} title="Линия">— Линия</button>
        </div>
        {hasSelection && (
          <div className="row" style={{ gap: 4, marginLeft: "auto" }}>
            <button type="button" className={mode === "preview" ? "active-sort" : ""} onClick={() => setMode("preview")}>Превью</button>
            <button type="button" className={mode === "print" ? "active-sort" : ""} onClick={() => setMode("print")}>Печать</button>
            <button type="button" className="comp-mini" onClick={() => setFullscreen((v) => !v)} title={fullscreen ? "Свернуть" : "Во весь экран"}>
              <NavIcon name={fullscreen ? "close" : "expand"} /> {fullscreen ? "Свернуть" : "Во весь экран"}
            </button>
          </div>
        )}
      </div>
      {!hasSelection ? (
        <div className="stack" style={{ alignItems: "center", padding: "12px 0" }}>
          <span className="muted" style={{ fontSize: "var(--fs-meta)" }}>Отметьте статьи слева</span>
          <button type="button" disabled title="Сначала выберите статьи" style={{ width: "100%" }}>
            <NavIcon name="download" /> Распечатать / Показать
          </button>
        </div>
      ) : (
        <>
          <div style={{ maxHeight: fullscreen ? "70vh" : 520, overflow: "auto", padding: 4, background: "color-mix(in oklab, var(--paper) 96%, var(--ink))", borderRadius: 4 }}>{canvas}</div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {mode === "preview" ? (
              <button type="button" className="primary" onClick={onShow} style={{ flex: 1 }}><NavIcon name="eye" /> Показать игрокам ({selected.length})</button>
            ) : (
              <button type="button" className="primary" onClick={handlePrintVerstak} style={{ flex: 1 }}><NavIcon name="download" /> Распечатать ({selected.length})</button>
            )}
          </div>
        </>
      )}
    </div>
  );

  if (isForceOpen) {
    if (!hasSelection) {
      return createPortal(
        <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", padding: 16, gap: 12, overflow: "auto" }}>
          <div className="card stack" style={{ maxWidth: 520, width: "100%", margin: "0 auto", textAlign: "center", padding: 24 }}>
            <span className="muted">Отметьте статьи слева, чтобы собрать Верстак</span>
            <button type="button" onClick={() => onClose?.()}>Закрыть</button>
          </div>
        </div>,
        document.body
      );
    }
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", padding: 16, gap: 12, overflow: "auto" }}>
        <div className="card stack" style={{ maxWidth: 1100, width: "100%", margin: "0 auto" }}>
          <div className="row" style={{ justifyContent: "space-between" }}><strong>Верстак — {mode === "preview" ? "Превью" : "Печать"}</strong><button type="button" onClick={() => onClose?.()}><NavIcon name="close" /> Закрыть</button></div>
          <div className="row" style={{ gap: 4, flexWrap: "wrap" }}>
            <button type="button" className={tool === "cursor" ? "active-sort" : ""} onClick={() => setTool("cursor")}>↖ Курсор</button>
            <button type="button" className={tool === "text" ? "active-sort" : ""} onClick={() => setTool("text")}>Т Текст</button>
            <button type="button" className={tool === "rect" ? "active-sort" : ""} onClick={() => setTool("rect")}>▭</button>
            <button type="button" className={tool === "circle" ? "active-sort" : ""} onClick={() => setTool("circle")}>○</button>
            <button type="button" className={tool === "line" ? "active-sort" : ""} onClick={() => setTool("line")}>—</button>
            <span style={{ flex: 1 }} />
            <button type="button" className={mode === "preview" ? "active-sort" : ""} onClick={() => setMode("preview")}>Превью</button><button type="button" className={mode === "print" ? "active-sort" : ""} onClick={() => setMode("print")}>Печать</button>
          </div>
          <div style={{ display: "flex", gap: 12, flex: 1, overflow: "hidden" }}>
            <div style={{ flex: 1, overflow: "auto", maxHeight: "75vh" }}>{canvas}</div>
            <div style={{ width: 180, flexShrink: 0, borderLeft: "1px solid var(--line)", paddingLeft: 8, overflowY: "auto" }}>
              <div className="muted" style={{ fontSize: "var(--fs-meta)", marginBottom: 6 }}>Состав ({selected.length})</div>
              <div className="stack" style={{ gap: 4 }}>
                {selected.map((e) => (
                  <div key={e.id} className="row" style={{ gap: 4, fontSize: "var(--fs-meta)", alignItems: "center" }}>
                    <span style={{ flex: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{e.name || `#${e.id}`}</span>
                    <button type="button" className="comp-mini" onClick={() => onRemove?.(e.id)} title="Убрать">✕</button>
                  </div>
                ))}
                {texts.map((t) => (
                  <div key={`t-${t.id}`} className="row" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                    <span style={{ flex: 1 }}>Т: {t.text.slice(0, 16)}</span>
                    <button type="button" className="comp-mini" onClick={() => setTexts((prev) => prev.filter((x) => x.id !== t.id))}>✕</button>
                  </div>
                ))}
                {shapes.map((s) => (
                  <div key={`s-${s.id}`} className="row" style={{ gap: 4, fontSize: "var(--fs-meta)" }}>
                    <span style={{ flex: 1 }}>{s.kind}</span>
                    <button type="button" className="comp-mini" onClick={() => setShapes((prev) => prev.filter((x) => x.id !== s.id))}>✕</button>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <div className="row">{mode === "preview" ? <button type="button" className="primary" onClick={() => { onShow(); onClose?.(); }} style={{ flex: 1 }}><NavIcon name="eye" /> Показать игрокам</button> : <button type="button" className="primary" onClick={handlePrintVerstak} style={{ flex: 1 }}><NavIcon name="download" /> Распечатать</button>}</div>
        </div>
      </div>,
      document.body
    );
  }
  if (fullscreen && hasSelection) {
    return createPortal(
      <div style={{ position: "fixed", inset: 0, zIndex: 60, background: "rgba(0,0,0,0.55)", display: "flex", flexDirection: "column", padding: 16, gap: 12, overflow: "auto" }}>
        <div className="card stack" style={{ maxWidth: 900, width: "100%", margin: "0 auto" }}>
          <div className="row" style={{ justifyContent: "space-between" }}><strong>Верстак — {mode === "preview" ? "Превью" : "Печать"}</strong><button type="button" onClick={() => setFullscreen(false)}><NavIcon name="close" /> Закрыть</button></div>
          <div className="row" style={{ gap: 4 }}><button type="button" className={mode === "preview" ? "active-sort" : ""} onClick={() => setMode("preview")}>Превью</button><button type="button" className={mode === "print" ? "active-sort" : ""} onClick={() => setMode("print")}>Печать</button></div>
          <div style={{ maxHeight: "75vh", overflow: "auto" }}>{canvas}</div>
          <div className="row">{mode === "preview" ? <button type="button" className="primary" onClick={() => { onShow(); setFullscreen(false); }} style={{ flex: 1 }}><NavIcon name="eye" /> Показать игрокам</button> : <button type="button" className="primary" onClick={handlePrintVerstak} style={{ flex: 1 }}><NavIcon name="download" /> Распечатать</button>}</div>
        </div>
      </div>,
      document.body
    );
  }
  return body;
}

function Tile({ entry, layout, mode, displayMode, isDragged, pageIndex, tool, onMove, onMoveToPage, onResize, onResetPos, onContextMenu }: { entry: CompendiumEntry; layout: TileLayout; mode: Mode; displayMode: "description" | "card" | "statblock"; isDragged: boolean; pageIndex: number; tool: Tool; onMove: (x: number, y: number) => void; onMoveToPage?: (id: number, page: number) => void; onResize: (w: number, h: number) => void; onResetPos: () => void; onContextMenu: (x: number, y: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; lx: number; ly: number } | null>(null);
  const rStart = useRef<{ x: number; y: number; w: number; h: number } | null>(null);
  return (
    <div
      ref={ref}
      style={{
        position: "absolute",
        left: `${layout.x}%`,
        top: layout.y,
        width: `${layout.w}%`,
        height: layout.h,
        border: "1.5px solid var(--line)",
        background: mode === "print" ? "#fff" : "color-mix(in oklab, var(--paper-2) 96%, var(--ink))",
        padding: 8,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        overflow: "hidden",
        cursor: isDragged ? "grab" : "grab",
        userSelect: "none",
        boxShadow: isDragged ? "0 2px 8px rgba(0,0,0,0.15)" : undefined,
      }}
      onDoubleClick={() => isDragged && onResetPos()}
      onContextMenu={(e) => {
        e.preventDefault();
        onContextMenu(e.clientX, e.clientY);
      }}
      onMouseDown={(e) => {
        if (tool !== "cursor") return;
        if ((e.target as HTMLElement).dataset.resize) return;
        if (e.button === 2) return;
        start.current = { x: e.clientX, y: e.clientY, lx: layout.x, ly: layout.y };
        const startPage = pageIndex;
        const onMoveDoc = (ev: MouseEvent) => {
          if (!start.current || !ref.current?.parentElement) return;
          const parent = ref.current.parentElement.getBoundingClientRect();
          const dxPct = ((ev.clientX - start.current.x) / parent.width) * 100;
          const dy = ev.clientY - start.current.y;
          const nx = Math.max(0, Math.min(98, start.current.lx + dxPct));
          const ny = Math.max(0, Math.min(900, start.current.ly + dy));
          onMove(nx, ny);
          // проверка перетаскивания на другую страницу
          const elem = document.elementFromPoint(ev.clientX, ev.clientY);
          const pageEl = elem?.closest?.(".verstak-page") as HTMLElement | null;
          if (pageEl && pageEl.dataset.page) {
            const targetPage = Number(pageEl.dataset.page);
            if (!Number.isNaN(targetPage) && targetPage !== startPage) {
              // при смене страницы сбрасываем y к верху новой страницы
              onMoveToPage?.(entry.id, targetPage);
            }
          }
        };
        const onUp = (ev: MouseEvent) => {
          // финальная проверка страницы при отпускании
          const elem = document.elementFromPoint(ev.clientX, ev.clientY);
          const pageEl = elem?.closest?.(".verstak-page") as HTMLElement | null;
          if (pageEl && pageEl.dataset.page) {
            const targetPage = Number(pageEl.dataset.page);
            if (!Number.isNaN(targetPage) && targetPage !== startPage) {
              onMoveToPage?.(entry.id, targetPage);
              // сбрасываем y к верху новой страницы, x оставляем
              onMove(layout.x, GAP);
            }
          }
          start.current = null;
          window.removeEventListener("mousemove", onMoveDoc);
          window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMoveDoc);
        window.addEventListener("mouseup", onUp);
      }}
      title={isDragged ? "ПКМ — режимы, перетаскивание — наезды разрешены, двойной клик — вернуть в сетку" : "ПКМ — режимы, перетащите чтобы открепить"}
    >
      {displayMode === "card" ? (
        <SpellOrMonsterCard entry={entry} />
      ) : displayMode === "statblock" ? (
        <div style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35, whiteSpace: "pre-wrap", overflow: "hidden", flex: 1, border: "1px dashed var(--line)", padding: 6 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Статблок — {entry.name}</div>
          <div className="muted">Карточка статблока пока в разработке — здесь будет полный статблок существа.</div>
          <div style={{ marginTop: 6, whiteSpace: "pre-wrap" }}>{stripMentions(entry.description || "").slice(0, 320) || "Без описания"}</div>
        </div>
      ) : (
        <>
          <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{entry.name || "Без названия"}</div>
          <div style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35, whiteSpace: "pre-wrap", overflow: "hidden", flex: 1 }}>{stripMentions(entry.description || "").slice(0, 320) || <span className="muted">Без описания</span>}</div>
          {entry.data && Object.keys(entry.data).length > 0 && <div className="muted" style={{ fontSize: "var(--fs-micro)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{Object.entries(entry.data).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(" · ")}</div>}
        </>
      )}
      <div
        data-resize="1"
        onMouseDown={(e) => {
          e.stopPropagation();
          rStart.current = { x: e.clientX, y: e.clientY, w: layout.w, h: layout.h };
          const onMoveDoc = (ev: MouseEvent) => {
            if (!rStart.current || !ref.current?.parentElement) return;
            const parent = ref.current.parentElement.getBoundingClientRect();
            const dwPct = ((ev.clientX - rStart.current.x) / parent.width) * 100;
            const dh = ev.clientY - rStart.current.y;
            onResize(Math.max(20, Math.min(98, rStart.current.w + dwPct)), Math.max(48, rStart.current.h + dh));
          };
          const onUp = () => {
            rStart.current = null;
            window.removeEventListener("mousemove", onMoveDoc);
            window.removeEventListener("mouseup", onUp);
          };
          window.addEventListener("mousemove", onMoveDoc);
          window.addEventListener("mouseup", onUp);
        }}
        style={{ position: "absolute", right: 2, bottom: 2, width: 14, height: 14, cursor: "nwse-resize", display: "grid", placeItems: "center", opacity: 0.6 }}
        title="Тянуть чтобы изменить размер — остаётся в сетке, соседи перегруппируются"
      >◢</div>
    </div>
  );
}

function SpellOrMonsterCard({ entry }: { entry: CompendiumEntry }) {
  const d = entry.data as any;
  const plain = stripMentions(entry.description || "");
  if (entry.kind === "spell") {
    const lvl = entry.level != null ? (entry.level === 0 ? "Заговор" : `${entry.level} уровень`) : "";
    const school = d?.school?.name ? `, ${d.school.name}` : "";
    const ritual = d?.ritual ? " (ритуал)" : "";
    const conc = d?.concentration ? " (концентрация)" : "";
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflow: "hidden" }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{entry.name || "Без названия"}</div>
        <div className="muted" style={{ fontSize: "var(--fs-micro)" }}>{`${lvl}${school}${ritual}${conc}`.trim() || "Заклинание"}</div>
        <div className="muted" style={{ fontSize: "var(--fs-micro)", display: "flex", gap: 6, flexWrap: "wrap" }}>
          {d?.casting_timing && <span>Накладывание: {d.casting_timing}</span>}
          {d?.range && <span>Дистанция: {d.range}</span>}
          {d?.duration && <span>Длительность: {d.duration}</span>}
        </div>
        <div style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35, whiteSpace: "pre-wrap", overflow: "hidden", flex: 1, borderTop: "1px solid var(--line)", paddingTop: 4 }}>{plain.slice(0, 400) || "Без описания"}</div>
      </div>
    );
  }
  if (entry.kind === "monster") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflow: "hidden" }}>
        <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 700, textTransform: "uppercase" }}>{entry.name || "Без названия"}</div>
        <div className="muted" style={{ fontSize: "var(--fs-micro)" }}>{[d?.size, d?.creature_type?.name].filter(Boolean).join(" · ") || "Существо"}</div>
        <div style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35, whiteSpace: "pre-wrap", overflow: "hidden", flex: 1, borderTop: "1px solid var(--line)", paddingTop: 4 }}>{plain.slice(0, 400) || "Без описания"}</div>
      </div>
    );
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, overflow: "hidden" }}>
      <div style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 700, textTransform: "uppercase" }}>{entry.name || "Без названия"}</div>
      <div style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35, whiteSpace: "pre-wrap", overflow: "hidden", flex: 1 }}>{plain.slice(0, 400) || "Без описания"}</div>
      {d && Object.keys(d).length > 0 && <div className="muted" style={{ fontSize: "var(--fs-micro)" }}>{Object.entries(d).slice(0, 3).map(([k, v]) => `${k}: ${String((v as any)?.name ?? v)}`).join(" · ")}</div>}
    </div>
  );
}
