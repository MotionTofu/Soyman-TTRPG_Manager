import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { useAction, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { Modal } from "../components/Modal";
import type { OwnPack } from "../maps/assets/ownPacks";
import { cutPiece, evenGuides, findPieces, guideCells, readingOrder, rectKey, sheetBackground, trimRect, unionRect, type Pixels, type Rect } from "../maps/assets/sheet";

const AFFECTS = [{ path: "/map-packs" }];
const IMAGES = "image/png,image/jpeg,image/webp,image/avif,image/gif";
const cellsOf = (value: number) => Math.max(0.5, Math.min(16, Math.round(value * 2) / 2)) || 1;
/** Во что превращаются куски листа: каждый — свой объект, либо все — картинки одной вещи. */
const TARGETS = [["object", "Объекты — каждый кусок отдельно"], ["variants", "Варианты одного объекта"], ["scatter", "Картинки одной россыпи"]] as const;
type Target = typeof TARGETS[number][0];
interface Piece { key: string; rect: Rect; /** Куски между линиями, из которых он собран. */ parts: string[] }
interface Meta { name?: string; w?: number; h?: number; checked?: boolean }

/** Нарезка листа в два шага: «Нарезка» — линии и куски, «Разбор» — имена и размеры на сетке карты. */
export function MapSheetDialog({ pack, reference, sizeGrid, onClose }: {
  pack: OwnPack; reference: string; onClose: () => void;
  /** Объект на сетке рядом с меркой — тот же рисунок, что в окне объекта. */ sizeGrid: (src: string | null, w: number, h: number, reference: string) => ReactNode;
}) {
  const run = useAction();
  const [sheet, setSheet] = useState<{ url: string; pixels: Pixels } | null>(null);
  const [xs, setXs] = useState<number[]>([]), [ys, setYs] = useState<number[]>([]), [found, setFound] = useState<Rect[] | null>(null);
  const [tolerance, setTolerance] = useState(24), [cols, setCols] = useState(4), [rows, setRows] = useState(4);
  const [off, setOff] = useState<string[]>([]), [glued, setGlued] = useState<string[][]>([]), [picked, setPicked] = useState<string[]>([]);
  const [step, setStep] = useState<1 | 2>(1), [meta, setMeta] = useState<Record<string, Meta>>({});
  const [target, setTarget] = useState<Target>("object"), [title, setTitle] = useState(""), [section, setSection] = useState(""), [tags, setTags] = useState("");
  const [bulkW, setBulkW] = useState(1), [bulkH, setBulkH] = useState(1), [size, setSize] = useState(1), [density, setDensity] = useState(0.8);
  const [progress, setProgress] = useState<string | null>(null);
  /** Что уже ушло в набор: повтор после сбоя не добавляет то же второй раз. */
  const sent = useRef<{ keys: Set<string>; itemId: number | null }>({ keys: new Set(), itemId: null });
  const board = useRef<HTMLDivElement>(null);

  const background = useMemo(() => sheet ? sheetBackground(sheet.pixels) : null, [sheet]);
  const pieces = useMemo((): Piece[] => {
    if (!sheet) return [];
    const { pixels } = sheet, base = found ?? guideCells(xs, ys, pixels.width, pixels.height);
    const trimmed = new Map(base.flatMap((cell) => { const rect = found ? cell : trimRect(pixels, cell, background, tolerance); return rect ? [[rectKey(cell), rect] as const] : []; }));
    const groups = glued.map((group) => group.filter((key) => trimmed.has(key))).filter((group) => group.length > 1), inGroup = new Set(groups.flat());
    return readingOrder([...groups.map((group) => ({ rect: unionRect(group.map((key) => trimmed.get(key)!)), parts: group })),
      ...[...trimmed].filter(([key]) => !inGroup.has(key)).map(([key, rect]) => ({ rect, parts: [key] }))]
      .map((piece) => ({ ...piece, key: rectKey(piece.rect) })), (piece) => piece.rect);
  }, [sheet, xs, ys, found, glued, background, tolerance]);
  const kept = pieces.filter((piece) => !off.includes(piece.key));
  const thumbs = useMemo(() => {
    const urls = new Map<string, string>();
    if (sheet && step === 2) for (const piece of kept) urls.set(piece.key, pieceCanvas(sheet.pixels, piece.rect, background, tolerance).toDataURL("image/png"));
    return urls;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, step, pieces, off, background, tolerance]);

  function choose(file: File | null) {
    if (!file) return;
    if (!title) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 60));
    const image = new Image(), url = URL.createObjectURL(file);
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
      const pen = canvas.getContext("2d", { willReadFrequently: true })!; pen.drawImage(image, 0, 0);
      const data = pen.getImageData(0, 0, canvas.width, canvas.height);
      setSheet({ url, pixels: { data: data.data, width: data.width, height: data.height } });
      setXs([]); setYs([]); setFound(null); setOff([]); setGlued([]); setPicked([]); setMeta({}); sent.current = { keys: new Set(), itemId: null };
    };
    image.src = url;
  }
  const lines = (next: { xs?: number[]; ys?: number[] }) => { setFound(null); setGlued([]); setPicked([]); if (next.xs) setXs(next.xs); if (next.ys) setYs(next.ys); };
  /** Точка листа под указателем. */
  const at = (event: { clientX: number; clientY: number }) => {
    const box = board.current!.getBoundingClientRect(), { width, height } = sheet!.pixels;
    return { x: Math.max(0, Math.min(width, (event.clientX - box.left) / box.width * width)), y: Math.max(0, Math.min(height, (event.clientY - box.top) / box.height * height)) };
  };
  const drag = (vertical: boolean, index: number) => (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault(); event.stopPropagation();
    const target = event.currentTarget;
    try { target.setPointerCapture(event.pointerId); } catch { /* указатель уже отпущен: линия просто не поедет */ }
    const move = (next: PointerEvent) => { const point = at(next); if (vertical) setXs((list) => list.map((value, i) => i === index ? point.x : value)); else setYs((list) => list.map((value, i) => i === index ? point.y : value)); };
    const up = () => { target.removeEventListener("pointermove", move); target.removeEventListener("pointerup", up); };
    target.addEventListener("pointermove", move); target.addEventListener("pointerup", up);
    setFound(null);
  };
  function click(piece: Piece, shift: boolean) {
    if (shift) setPicked((list) => list.includes(piece.key) ? list.filter((key) => key !== piece.key) : [...list, piece.key]);
    else setOff((list) => list.includes(piece.key) ? list.filter((key) => key !== piece.key) : [...list, piece.key]);
  }
  function glue() {
    const parts = pieces.filter((piece) => picked.includes(piece.key)).flatMap((piece) => piece.parts);
    setGlued((groups) => [...groups.filter((group) => !group.some((key) => parts.includes(key))), parts]); setPicked([]);
  }
  const patch = (key: string, next: Meta) => setMeta((all) => ({ ...all, [key]: { ...all[key], ...next } }));
  const nameOf = (piece: Piece, index: number) => meta[piece.key]?.name ?? `${title || "Вещь"} ${index + 1}`;

  async function save() {
    if (!sheet) return;
    const blob = (piece: Piece) => new Promise<Blob>((resolve) => pieceCanvas(sheet.pixels, piece.rect, background, tolerance).toBlob((made) => resolve(made!), "image/png"));
    const form = async (piece: Piece, fields: Record<string, string>) => { const body = new FormData(); body.append("file", await blob(piece), "piece.png"); for (const [key, value] of Object.entries(fields)) body.append(key, value); return body; };
    const done = await run(labelled("Лист добавлен не целиком — нажмите «Добавить» ещё раз, готовое не повторится", async () => {
      for (const [index, piece] of kept.entries()) {
        if (sent.current.keys.has(piece.key)) continue;
        setProgress(`Добавляю ${index + 1} из ${kept.length}…`);
        if (target === "object") {
          const own = meta[piece.key] ?? {};
          await write.post(`/map-packs/${pack.id}/items`, await form(piece, { name: nameOf(piece, index), section, tags, w: String(own.w ?? 1), h: String(own.h ?? 1) }));
        } else if (sent.current.itemId === null) {
          const before = new Set(pack.items.map((item) => item.id));
          const made = await write.post<{ pack: OwnPack }>(`/map-packs/${pack.id}/items`, await form(piece, target === "scatter"
            ? { kind: "scatter", name: title, section, tags, size: String(size), density: String(density) } : { name: title, section, tags, w: String(bulkW), h: String(bulkH) }));
          sent.current.itemId = made.pack.items.find((item) => !before.has(item.id))?.id ?? null;
          if (sent.current.itemId === null) throw new Error("Сервер не вернул новую вещь");
        } else await write.post(`/map-packs/items/${sent.current.itemId}/images`, await form(piece, {}));
        sent.current.keys.add(piece.key);
      }
      return true;
    }), { affects: AFFECTS });
    setProgress(null);
    if (done) onClose();
  }

  const single = target !== "object", tooMany = single && kept.length > 12;
  const percent = (value: number, side: number) => `${value / side * 100}%`;
  return <Modal onClose={onClose} wide className="map-sheet-modal" closeOnBackdropClick={false} ariaLabel="Нарезка листа">
    <style>{".modal.modal-wide.map-sheet-modal{width:min(1500px,96vw);max-width:96vw}"}</style>
    <h2>Лист ассетов · {step === 1 ? "шаг 1: нарезка" : "шаг 2: разбор"}</h2>
    {step === 1 ? <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="stack" style={{ flex: "3 1 520px", minWidth: 300 }}>
        {sheet ? <div style={{ display: "grid", gridTemplateColumns: "18px 1fr", gridTemplateRows: "18px auto" }}>
          <span />
          <div role="button" aria-label="Поставить вертикальную линию" title="Щелчок — поставить вертикальную линию" style={{ background: "rgba(0,0,0,.15)", cursor: "col-resize" }}
            onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); lines({ xs: [...xs, (event.clientX - box.left) / box.width * sheet.pixels.width] }); }} />
          <div role="button" aria-label="Поставить горизонтальную линию" title="Щелчок — поставить горизонтальную линию" style={{ background: "rgba(0,0,0,.15)", cursor: "row-resize" }}
            onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); lines({ ys: [...ys, (event.clientY - box.top) / box.height * sheet.pixels.height] }); }} />
          <div ref={board} style={{ position: "relative", userSelect: "none", background: "repeating-conic-gradient(#bbb 0 25%, #ddd 0 50%) 0 0 / 16px 16px" }}>
            <img src={sheet.url} alt="Лист" draggable={false} style={{ display: "block", width: "100%" }} />
            {pieces.map((piece, index) => { const dim = off.includes(piece.key), chosen = picked.includes(piece.key); return <button key={piece.key} type="button"
              aria-label={`Кусок ${index + 1}${dim ? ", выключен" : ""}`} aria-pressed={!dim} title="Щелчок — выключить или вернуть. Shift+щелчок — отметить для склейки"
              onClick={(event) => click(piece, event.shiftKey)}
              style={{ position: "absolute", left: percent(piece.rect.x, sheet.pixels.width), top: percent(piece.rect.y, sheet.pixels.height), width: percent(piece.rect.w, sheet.pixels.width), height: percent(piece.rect.h, sheet.pixels.height),
                padding: 0, minWidth: 0, minHeight: 0, borderRadius: 0, boxShadow: "none", background: dim ? "rgba(0,0,0,.55)" : chosen ? "rgba(255,62,145,.3)" : "transparent",
                border: `2px ${dim ? "dashed #666" : chosen ? "solid #ff3e91" : "solid #1c9c4c"}`, cursor: "pointer" }} />; })}
            {xs.map((x, i) => <div key={`x${i}`} role="separator" aria-orientation="vertical" aria-label={`Вертикальная линия ${i + 1}`} title="Тяните. Двойной щелчок — убрать"
              onPointerDown={drag(true, i)} onDoubleClick={() => lines({ xs: xs.filter((_, at) => at !== i) })}
              style={{ position: "absolute", top: 0, bottom: 0, left: percent(x, sheet.pixels.width), width: 9, marginLeft: -4, cursor: "col-resize", background: "linear-gradient(to right, transparent 4px, #ff3e91 4px 5px, transparent 5px)" }} />)}
            {ys.map((y, i) => <div key={`y${i}`} role="separator" aria-orientation="horizontal" aria-label={`Горизонтальная линия ${i + 1}`} title="Тяните. Двойной щелчок — убрать"
              onPointerDown={drag(false, i)} onDoubleClick={() => lines({ ys: ys.filter((_, at) => at !== i) })}
              style={{ position: "absolute", left: 0, right: 0, top: percent(y, sheet.pixels.height), height: 9, marginTop: -4, cursor: "row-resize", background: "linear-gradient(to bottom, transparent 4px, #ff3e91 4px 5px, transparent 5px)" }} />)}
          </div>
        </div> : <p className="muted">Выберите картинку листа: несколько вещей на одном фоне. Фон может быть прозрачным или одноцветным.</p>}
      </div>
      <div className="stack" style={{ flex: "1 1 260px", minWidth: 240 }}>
        <label>Картинка листа<input type="file" aria-label="Картинка листа" accept={IMAGES} onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
        {sheet && <>
          <small className="muted">Линии ставятся щелчком по серой полосе сверху и слева, двигаются мышью, убираются двойным щелчком. Куски обрезаются по рисунку сами; пустые отбрасываются.</small>
          <div className="row" style={{ gap: 8, alignItems: "flex-end" }}>
            <label>Столбцов<input type="number" aria-label="Столбцов" min={1} max={40} value={cols} onChange={(event) => setCols(Math.max(1, Math.min(40, Math.round(Number(event.target.value)) || 1)))} /></label>
            <label>Строк<input type="number" aria-label="Строк" min={1} max={40} value={rows} onChange={(event) => setRows(Math.max(1, Math.min(40, Math.round(Number(event.target.value)) || 1)))} /></label>
          </div>
          <button type="button" onClick={() => lines({ xs: evenGuides(cols, sheet.pixels.width), ys: evenGuides(rows, sheet.pixels.height) })}>Разложить линии поровну</button>
          <button type="button" onClick={() => { setXs([]); setYs([]); setGlued([]); setPicked([]); setFound(findPieces(sheet.pixels, background, tolerance)); }}>Найти рисунки сами</button>
          <button type="button" disabled={!xs.length && !ys.length && !found} onClick={() => { lines({ xs: [], ys: [] }); setOff([]); }}>Убрать все линии</button>
          <label>Допуск фона: {tolerance}<input type="range" aria-label="Допуск фона" min={0} max={96} step={2} value={tolerance} onChange={(event) => { setTolerance(Number(event.target.value)); setFound(null); }} />
            <small className="muted">{background ? "Фон — цвет углов листа. Больше допуск — смелее убирается фон вокруг рисунка." : "У листа прозрачный фон: убирать нечего."}</small></label>
          <button type="button" disabled={picked.length < 2} onClick={glue}>Склеить отмеченные ({picked.length})</button>
          {glued.length > 0 && <button type="button" onClick={() => setGlued([])}>Расклеить всё</button>}
          <small className="muted">Щелчок по куску выключает его. Shift+щелчок отмечает куски для склейки — для предмета, который линия разрезала.</small>
          <p role="status">Кусков: {kept.length}{pieces.length > kept.length ? `, выключено ${pieces.length - kept.length}` : ""}</p>
        </>}
      </div>
    </div> : <div className="stack">
      <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label>Во что превратить<select aria-label="Во что превратить куски" value={target} onChange={(event) => setTarget(event.target.value as Target)}>{TARGETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <label>{single ? "Название вещи" : "Имя листа"}<input aria-label="Имя листа" value={title} maxLength={60} onChange={(event) => setTitle(event.target.value)} /></label>
        <label>Раздел<input aria-label="Раздел" value={section} maxLength={40} onChange={(event) => setSection(event.target.value)} /></label>
        <label>Теги через запятую<input aria-label="Теги" value={tags} maxLength={200} onChange={(event) => setTags(event.target.value)} /></label>
      </div>
      {target === "scatter" ? <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label>Размер знака, клеток<input type="number" min={0.25} max={8} step={0.25} value={size} onChange={(event) => setSize(Math.max(0.25, Math.min(8, Number(event.target.value) || 1)))} /></label>
        <label>Густота, знаков на клетку<input type="number" min={0.05} max={4} step={0.05} value={density} onChange={(event) => setDensity(Math.max(0.05, Math.min(4, Number(event.target.value) || 0.8)))} /></label>
      </div> : <div className="row" style={{ gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
        <label>Ширина, клеток<input type="number" aria-label="Ширина для всех" min={0.5} max={16} step={0.5} value={bulkW} onChange={(event) => setBulkW(cellsOf(Number(event.target.value)))} /></label>
        <label>Высота, клеток<input type="number" aria-label="Высота для всех" min={0.5} max={16} step={0.5} value={bulkH} onChange={(event) => setBulkH(cellsOf(Number(event.target.value)))} /></label>
        {!single && <>
          <button type="button" disabled={!kept.some((piece) => meta[piece.key]?.checked)} onClick={() => setMeta((all) => Object.fromEntries(kept.map((piece) => [piece.key, all[piece.key]?.checked ? { ...all[piece.key], w: bulkW, h: bulkH } : all[piece.key] ?? {}])))}>Задать размер отмеченным</button>
          <button type="button" onClick={() => { const all = kept.every((piece) => meta[piece.key]?.checked); setMeta((old) => Object.fromEntries(kept.map((piece) => [piece.key, { ...old[piece.key], checked: !all }]))); }}>Отметить все или снять</button>
        </>}
      </div>}
      {tooMany && <p role="alert">У одной вещи не больше 12 картинок, а кусков {kept.length}. Вернитесь к нарезке и выключите лишние.</p>}
      <div className="row" style={{ gap: 10, flexWrap: "wrap", alignItems: "flex-start", maxHeight: "58vh", overflow: "auto" }}>
        {kept.map((piece, index) => { const own = meta[piece.key] ?? {}, src = thumbs.get(piece.key) ?? null; return <div key={piece.key} className="stack" style={{ width: single ? 96 : 200, gap: 4, padding: 6, border: "1px solid var(--line, currentColor)" }}>
          {single ? <div style={{ height: 84, background: "var(--paper, #f4efe2)" }}>{src && <img src={src} alt={`Кусок ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}</div> : <>
            {sizeGrid(src, own.w ?? 1, own.h ?? 1, reference)}
            <label className="row" style={{ gap: 6 }}><input type="checkbox" aria-label={`Отметить кусок ${index + 1}`} checked={!!own.checked} onChange={(event) => patch(piece.key, { checked: event.target.checked })} />
              <input aria-label={`Имя куска ${index + 1}`} value={nameOf(piece, index)} maxLength={80} style={{ minWidth: 0, flex: 1 }} onChange={(event) => patch(piece.key, { name: event.target.value })} /></label>
            <div className="row" style={{ gap: 6 }}>
              <input type="number" aria-label={`Ширина куска ${index + 1}, клеток`} title="Ширина, клеток" min={0.5} max={16} step={0.5} value={own.w ?? 1} style={{ minWidth: 0, flex: 1 }} onChange={(event) => patch(piece.key, { w: cellsOf(Number(event.target.value)) })} />
              <span aria-hidden>×</span>
              <input type="number" aria-label={`Высота куска ${index + 1}, клеток`} title="Высота, клеток" min={0.5} max={16} step={0.5} value={own.h ?? 1} style={{ minWidth: 0, flex: 1 }} onChange={(event) => patch(piece.key, { h: cellsOf(Number(event.target.value)) })} />
            </div>
          </>}
        </div>; })}
      </div>
    </div>}
    <div className="modal-footer row">
      {progress && <span role="status" className="muted">{progress}</span>}
      <button onClick={onClose}>Отмена</button>
      {step === 2 && <button onClick={() => setStep(1)}>← К нарезке</button>}
      {step === 1 ? <button className="primary" disabled={!kept.length} onClick={() => setStep(2)}>Дальше: разбор ({kept.length})</button>
        : <button className="primary" disabled={!kept.length || tooMany || !!progress || single && !title.trim() || !single && kept.some((piece, index) => !nameOf(piece, index).trim())} onClick={() => void save()}>Добавить в набор ({kept.length})</button>}
    </div>
  </Modal>;
}

function pieceCanvas(pixels: Pixels, rect: Rect, background: ReturnType<typeof sheetBackground>, tolerance: number) {
  const piece = cutPiece(pixels, rect, background, tolerance), canvas = document.createElement("canvas");
  canvas.width = piece.width; canvas.height = piece.height;
  canvas.getContext("2d")!.putImageData(new ImageData(new Uint8ClampedArray(piece.data), piece.width, piece.height), 0, 0);
  return canvas;
}
