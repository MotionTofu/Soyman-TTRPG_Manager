import { useState, memo } from "react";
import type { MapDocumentV6 } from "@shared/maps/core";
import { deleteLayer, moveLayer, renameLayer, setLayerLocked, setLayerOpacity, setLayerVisible } from "../core/mutations/layers";
import { editGeometry } from "./editDocument";
import { MapToolIcon } from "./MapToolIcon";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { CITY_ROOMS_NAME, layerName, NEW_LAYERS, newLayerName, type NewLayerKind } from "./layerNames";
import type { MapKind } from "../mapTypes";

type Layer = MapDocumentV6["layers"][number];
type Edit = (operation: (before: MapDocumentV6) => MapDocumentV6) => void;


const GROUPS: Record<Layer["kind"], string> = { terrain: "Поверхности", path: "Реки и дороги", scatter: "Россыпи",
  gameplay: "Комнаты и токены", label: "Подписи", object: "Объекты", reference: "Подложка" };
const ICONS = { terrain: "brush", path: "road", scatter: "scatter", gameplay: "shape", label: "label", object: "asset", reference: "reference" } as const;

function count(layer: Layer): number | null {
  if (layer.kind === "terrain") return layer.representation === "cells" ? layer.cells.length : null;
  if (layer.kind === "path") return layer.paths.length;
  if (layer.kind === "scatter") return layer.areas.length;
  return layer.items.length;
}
const Eye = ({ shut }: { shut: boolean }) => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
  <path d="M2 12c5-9 15-9 20 0-5 9-15 9-20 0M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6" />{shut && <path d="M4 4l16 16" />}</svg>;
const Lock = ({ open }: { open: boolean }) => <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2">
  <path d={open ? "M6 10h12v11H6zM8 10V6a4 4 0 0 1 7.5-2" : "M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4"} /></svg>;

const geometry = (operation: Parameters<typeof editGeometry>[1]): (before: MapDocumentV6) => MapDocumentV6 => (before) => editGeometry(before, operation);
type Confirm = (options: { message: string; confirmLabel: string; danger: boolean }) => Promise<boolean>;

// Строка под memo: мазок кистью меняет один слой, остальные объекты слоёв
// остаются теми же — их строки пропускают перерисовку (замер 2026-10-07:
// панель слоёв была самой дорогой частью шага мазка).
const LayerRow = memo(function LayerRow({ layer, map, group, active, renaming, disabled, canRaise, canLower, index, onActivate, onRenaming, commit, live, settle, confirm }: {
  layer: Layer; map: MapKind; group: boolean; active: boolean; renaming: boolean; disabled: boolean; canRaise: boolean; canLower: boolean;
  /** Position in the document, bottom first. */
  index: number;
  onActivate: (id: string) => void; onRenaming: (id: string | null) => void; commit: Edit; live: Edit; settle: () => void; confirm: Confirm;
}) {
  const name = layerName(layer, map), n = count(layer);
  async function remove() {
    if (!await confirm({ message: `Удалить слой «${name}»${n ? ` и всё, что на нём (${n})` : ""}? Отменить можно через «Отменить».`, confirmLabel: "Удалить слой", danger: true })) return;
    commit(geometry((view) => deleteLayer(view, layer.id)));
    if (active) onActivate("");
  }
  return <div>
    {group && <div className="workspace-layer-group">{map === "city" && layer.kind === "gameplay" ? CITY_ROOMS_NAME : GROUPS[layer.kind]}</div>}
    <div className="workspace-layer" aria-current={active} data-hidden={!layer.visible || undefined}>
      <MapToolIcon tool={layer.kind === "terrain" && layer.representation === "mask" ? "surface" : ICONS[layer.kind]} />
      {renaming
        ? <input autoFocus aria-label={`Имя слоя: ${name}`} defaultValue={name} maxLength={80}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.stopPropagation(); onRenaming(null); } }}
          onBlur={(event) => { const next = event.target.value.trim(); onRenaming(null); if (next && next !== name) commit(geometry((view) => renameLayer(view, layer.id, next))); }} />
        : <button type="button" className="workspace-layer-name" aria-pressed={active} title="Двойной щелчок — переименовать"
          onClick={() => onActivate(layer.id)} onDoubleClick={() => { if (!disabled) onRenaming(layer.id); }}>{name}</button>}
      {n !== null && <span className="workspace-layer-count">{n}</span>}
      <button type="button" className="workspace-icon-button" aria-label={`${layer.visible ? "Скрыть" : "Показать"} слой «${name}»`} aria-pressed={!layer.visible} disabled={disabled}
        onClick={() => commit(geometry((view) => setLayerVisible(view, layer.id, !layer.visible)))}><Eye shut={!layer.visible} /></button>
      <button type="button" className="workspace-icon-button workspace-lock" aria-label={`${layer.locked ? "Разблокировать" : "Заблокировать"} слой «${name}»`} aria-pressed={layer.locked} disabled={disabled}
        onClick={() => commit(geometry((view) => setLayerLocked(view, layer.id, !layer.locked)))}><Lock open={!layer.locked} /></button>
      <WorkspaceMenu label="⋯" title={`Действия со слоем «${name}»`} className="workspace-layer-more">
        <button type="button" data-close disabled={disabled} onClick={() => onRenaming(layer.id)}>Переименовать</button>
        <label>Прозрачность<input type="range" aria-label={`Прозрачность: ${name}`} min={0.1} max={1} step={0.05} value={layer.opacity} disabled={disabled}
          onChange={(event) => live(geometry((view) => setLayerOpacity(view, layer.id, Number(event.target.value))))}
          onPointerUp={settle} onKeyUp={settle} onBlur={settle} /></label>
        <button type="button" disabled={disabled || !canRaise} onClick={() => commit(geometry((view) => moveLayer(view, layer.id, index + 1)))}>Выше</button>
        <button type="button" disabled={disabled || !canLower} onClick={() => commit(geometry((view) => moveLayer(view, layer.id, index - 1)))}>Ниже</button>
        <button type="button" data-close className="danger" disabled={disabled} onClick={() => void remove()}>Удалить слой</button>
      </WorkspaceMenu>
    </div>
  </div>;
});

// memo: страница редактора рендерится на каждое движение мыши и камеры.
export const LayersPanel = memo(function LayersPanel({ document, map, activeLayer, disabled, onActivate, commit, live, settle, onAdd, confirm }: {
  document: MapDocumentV6; map: MapKind; activeLayer: string; disabled: boolean;
  onActivate: (id: string) => void; commit: Edit;
  /** Continuous edits (opacity drag): one history step per gesture. */
  live: Edit; settle: () => void;
  onAdd: (kind: NewLayerKind) => void; confirm: Confirm;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const total = document.layers.length;
  return <section className="workspace-layers" aria-label="Слои карты">
    <div className="workspace-panel-heading">
      <h2 className="workspace-panel-title">Слои</h2>
      <WorkspaceMenu label="+" title="Добавить слой" className="workspace-layers-add">
        {(Object.keys(NEW_LAYERS) as NewLayerKind[]).map((kind) => <button key={kind} type="button" data-close disabled={disabled} onClick={() => onAdd(kind)}>{newLayerName(kind, map)}</button>)}
      </WorkspaceMenu>
    </div>
    <div className="workspace-layer-list">
      {document.layers.map((layer, index) => <LayerRow key={layer.id} layer={layer} map={map} index={index} group={document.layers[index + 1]?.kind !== layer.kind}
        active={activeLayer === layer.id} renaming={renaming === layer.id} disabled={disabled} canRaise={index < total - 1} canLower={index > 0}
        onActivate={onActivate} onRenaming={setRenaming} commit={commit} live={live} settle={settle} confirm={confirm} />).reverse()}
      {!total && <p>Слоёв нет. Добавьте первый кнопкой «+».</p>}
    </div>
  </section>;
});
