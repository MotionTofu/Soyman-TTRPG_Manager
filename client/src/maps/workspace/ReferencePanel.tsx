import { useRef } from "react";
import type { MapDocumentV6, ReferenceImage } from "@shared/maps/core";
import { deleteReferenceImage, shiftReferenceImage, updateReferenceImage, type ReferencePatch } from "../core/mutations/references";
import { editGeometry } from "./editDocument";
import { cellsAcross, fitReference, pixelsPerCell, widthForCells, widthForPixels } from "./referenceImages";

type Edit = (operation: (before: MapDocumentV6) => MapDocumentV6) => void;
const IMAGES = "image/png,image/jpeg,image/webp,image/avif,image/gif";
const round = (value: number, step = 100) => Math.round(value * step) / step;

/** Подложка для обрисовки (П6–П8, П11, П13–П16): картинки слоя и настройка выбранной. Открыта — картинку можно двигать на карте. */
export function ReferencePanel({ document, layerId, selectedId, onSelect, cropping, onCropping, commit, live, settle, onUpload, uploading, cell, bounds, screenScale, disabled }: {
  document: MapDocumentV6; layerId: string; selectedId: string | null; onSelect: (id: string | null) => void;
  cropping: boolean; onCropping: (value: boolean) => void;
  commit: Edit; live: Edit; settle: () => void;
  onUpload: (file: File) => void; uploading: boolean;
  /** Ширина клетки, мир; рамка карты; точек экрана на единицу мира. */
  cell: number; bounds: { minX: number; minY: number; maxX: number; maxY: number }; screenScale: number; disabled: boolean;
}) {
  const file = useRef<HTMLInputElement>(null);
  const layer = document.layers.find((entry) => entry.id === layerId);
  if (layer?.kind !== "reference") return null;
  const item = layer.items.find((entry) => entry.id === selectedId) ?? null;
  const locked = disabled || layer.locked || !layer.visible;
  const patch = (target: ReferenceImage, next: ReferencePatch, how: Edit = commit) => how((before) => editGeometry(before, (view) => updateReferenceImage(view, target.id, next)));
  return <section className="workspace-tool-settings workspace-reference" aria-label="Подложка">
    <div className="workspace-panel-heading"><h2 className="workspace-panel-title">Подложка</h2><strong>{layer.name}</strong></div>
    <p>Картинки для обрисовки. Видите только вы: игрокам и в картинку карты подложка не попадает. Держите H — подложка пропадёт.</p>
    <button type="button" disabled={locked || uploading} onClick={() => file.current?.click()}>{uploading ? "Загружаем…" : "+ Картинка"}</button>
    <input ref={file} type="file" hidden accept={IMAGES} aria-label="Картинка подложки" onChange={(event) => { const picked = event.target.files?.[0]; event.target.value = ""; if (picked) onUpload(picked); }} />
    {layer.locked && <p>Слой заперт — откройте замок в списке слоёв, чтобы двигать картинки.</p>}
    {layer.items.length > 0 && <ol className="workspace-reference-list" aria-label="Картинки подложки">
      {[...layer.items].reverse().map((entry) => <li key={entry.id}>
        <button type="button" aria-pressed={entry.id === selectedId} onClick={() => onSelect(entry.id === selectedId ? null : entry.id)}>
          Картинка {layer.items.indexOf(entry) + 1}<small>{entry.pixels.w} × {entry.pixels.h}</small></button>
      </li>)}
    </ol>}
    {item && <div className="workspace-reference-item">
      <label className="workspace-slider"><span>Прозрачность</span>
        <input type="range" aria-label="Прозрачность картинки" min={0.05} max={1} step={0.05} value={item.opacity} disabled={locked}
          onChange={(event) => patch(item, { opacity: Number(event.target.value) }, live)} onPointerUp={settle} onKeyUp={settle} onBlur={settle} />
        <output>{Math.round(item.opacity * 100)}%</output></label>
      <div className="workspace-reference-fit" role="group" aria-label="Размер по карте">
        <button type="button" disabled={locked} onClick={() => patch(item, fitReference(item, bounds, "width"))}>По ширине карты</button>
        <button type="button" disabled={locked} onClick={() => patch(item, fitReference(item, bounds, "height"))}>По высоте карты</button>
        <button type="button" disabled={locked} onClick={() => patch(item, fitReference(item, bounds, "whole"))}>Вписать целиком</button>
        <button type="button" disabled={locked} title="Точка картинки — точка экрана при нынешнем приближении"
          onClick={() => patch(item, { width: item.pixels.w / screenScale })}>Исходный размер</button>
      </div>
      <label>Ширина, клеток<input type="number" min={0.25} step={0.25} disabled={locked} value={round(cellsAcross(item, cell))}
        onChange={(event) => { const cells = Number(event.target.value); if (cells > 0) patch(item, { width: widthForCells(item, cells, cell) }); }} /></label>
      <label title="Сколько точек картинки приходится на клетку: для карт с сеткой — размер её клетки в точках">Точек на клетку
        <input type="number" min={1} step={1} disabled={locked} value={round(pixelsPerCell(item, cell), 10)}
          onChange={(event) => { const ppc = Number(event.target.value); if (ppc >= 1) patch(item, { width: widthForPixels(item, ppc, cell) }); }} /></label>
      <label>Поворот, °<input type="number" min={-180} max={180} step={15} disabled={locked} value={item.rotation}
        onChange={(event) => { const rotation = Number(event.target.value); if (Number.isFinite(rotation)) patch(item, { rotation: ((rotation % 360) + 540) % 360 - 180 }); }} /></label>
      <div className="workspace-reference-fit" role="group" aria-label="Обрезка">
        <button type="button" aria-pressed={cropping} disabled={locked} onClick={() => onCropping(!cropping)}>{cropping ? "Готово" : "Обрезать края"}</button>
        <button type="button" disabled={locked || !item.crop} onClick={() => patch(item, { crop: null })}>Снять обрезку</button>
      </div>
      <div className="workspace-reference-fit" role="group" aria-label="Порядок">
        <button type="button" disabled={locked || layer.items.at(-1) === item} onClick={() => commit((before) => editGeometry(before, (view) => shiftReferenceImage(view, item.id, 1)))}>Выше</button>
        <button type="button" disabled={locked || layer.items[0] === item} onClick={() => commit((before) => editGeometry(before, (view) => shiftReferenceImage(view, item.id, -1)))}>Ниже</button>
        <button type="button" className="danger" disabled={locked} onClick={() => { commit((before) => editGeometry(before, (view) => deleteReferenceImage(view, item.id))); onSelect(null); }}>Убрать</button>
      </div>
      <p>Тяните картинку мышью, углы — размер, кружок сверху — поворот (Shift — шаг 15°). Стрелки — сдвиг на ¼ клетки, с Shift — на клетку.</p>
    </div>}
    {!item && layer.items.length > 0 && <p>Выберите картинку в списке или щёлкните по ней на карте.</p>}
    {!layer.items.length && <p>Добавьте картинку кнопкой или перетащите файл прямо на карту.</p>}
  </section>;
}
