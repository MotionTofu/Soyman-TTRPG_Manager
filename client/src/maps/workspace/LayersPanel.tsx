import { useState } from "react";
import type { MapDocumentV6 } from "@shared/maps/core";
import { deleteLayer, moveLayer, renameLayer, setLayerLocked, setLayerOpacity, setLayerVisible } from "../core/mutations/layers";
import { editGeometry } from "./editDocument";
import { MapToolIcon } from "./MapToolIcon";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { layerName, NEW_LAYERS, type NewLayerKind } from "./layerNames";

type Layer = MapDocumentV6["layers"][number];
type Edit = (operation: (before: MapDocumentV6) => MapDocumentV6) => void;


const GROUPS: Record<Layer["kind"], string> = { terrain: "Поверхности", path: "Реки и дороги", scatter: "Россыпи",
  gameplay: "Комнаты и токены", label: "Подписи", object: "Объекты" };
const ICONS = { terrain: "brush", path: "road", scatter: "scatter", gameplay: "shape", label: "label", object: "asset" } as const;

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

export function LayersPanel({ document, activeLayer, disabled, onActivate, commit, live, settle, onAdd, confirm }: {
  document: MapDocumentV6; activeLayer: string; disabled: boolean;
  onActivate: (id: string) => void; commit: Edit;
  /** Continuous edits (opacity drag): one history step per gesture. */
  live: Edit; settle: () => void;
  onAdd: (kind: NewLayerKind) => void; confirm: (options: { message: string; confirmLabel: string; danger: boolean }) => Promise<boolean>;
}) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const layers = [...document.layers].reverse();
  const geometry = (operation: Parameters<typeof editGeometry>[1]): (before: MapDocumentV6) => MapDocumentV6 => (before) => editGeometry(before, operation);
  async function remove(layer: Layer) {
    const n = count(layer);
    if (!await confirm({ message: `Удалить слой «${layerName(layer)}»${n ? ` и всё, что на нём (${n})` : ""}? Отменить можно через «Отменить».`, confirmLabel: "Удалить слой", danger: true })) return;
    commit(geometry((view) => deleteLayer(view, layer.id)));
    if (activeLayer === layer.id) onActivate("");
  }
  return <section className="workspace-layers" aria-label="Слои карты">
    <div className="workspace-panel-heading">
      <h2 className="workspace-panel-title">Слои</h2>
      <WorkspaceMenu label="+" title="Добавить слой" className="workspace-layers-add">
        {(Object.keys(NEW_LAYERS) as NewLayerKind[]).map((kind) => <button key={kind} type="button" data-close disabled={disabled} onClick={() => onAdd(kind)}>{NEW_LAYERS[kind]}</button>)}
      </WorkspaceMenu>
    </div>
    <div className="workspace-layer-list">
      {layers.map((layer, index) => {
        const name = layerName(layer), n = count(layer);
        const index6 = document.layers.findIndex((entry) => entry.id === layer.id);
        return <div key={layer.id}>
          {layers[index - 1]?.kind !== layer.kind && <div className="workspace-layer-group">{GROUPS[layer.kind]}</div>}
          <div className="workspace-layer" aria-current={activeLayer === layer.id} data-hidden={!layer.visible || undefined}>
            <MapToolIcon tool={layer.kind === "terrain" && layer.representation === "mask" ? "surface" : ICONS[layer.kind]} />
            {renaming === layer.id
              ? <input autoFocus aria-label={`Имя слоя: ${name}`} defaultValue={name} maxLength={80}
                onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); if (event.key === "Escape") { event.stopPropagation(); setRenaming(null); } }}
                onBlur={(event) => { const next = event.target.value.trim(); setRenaming(null); if (next && next !== name) commit(geometry((view) => renameLayer(view, layer.id, next))); }} />
              : <button type="button" className="workspace-layer-name" aria-pressed={activeLayer === layer.id} title="Двойной щелчок — переименовать"
                onClick={() => onActivate(layer.id)} onDoubleClick={() => { if (!disabled) setRenaming(layer.id); }}>{name}</button>}
            {n !== null && <span className="workspace-layer-count">{n}</span>}
            <button type="button" className="workspace-icon-button" aria-label={`${layer.visible ? "Скрыть" : "Показать"} слой «${name}»`} aria-pressed={!layer.visible} disabled={disabled}
              onClick={() => commit(geometry((view) => setLayerVisible(view, layer.id, !layer.visible)))}><Eye shut={!layer.visible} /></button>
            <button type="button" className="workspace-icon-button workspace-lock" aria-label={`${layer.locked ? "Разблокировать" : "Заблокировать"} слой «${name}»`} aria-pressed={layer.locked} disabled={disabled}
              onClick={() => commit(geometry((view) => setLayerLocked(view, layer.id, !layer.locked)))}><Lock open={!layer.locked} /></button>
            <WorkspaceMenu label="⋯" title={`Действия со слоем «${name}»`} className="workspace-layer-more">
              <button type="button" data-close disabled={disabled} onClick={() => setRenaming(layer.id)}>Переименовать</button>
              <label>Прозрачность<input type="range" aria-label={`Прозрачность: ${name}`} min={0.1} max={1} step={0.05} value={layer.opacity} disabled={disabled}
                onChange={(event) => live(geometry((view) => setLayerOpacity(view, layer.id, Number(event.target.value))))}
                onPointerUp={settle} onKeyUp={settle} onBlur={settle} /></label>
              <button type="button" disabled={disabled || index6 === document.layers.length - 1} onClick={() => commit(geometry((view) => moveLayer(view, layer.id, index6 + 1)))}>Выше</button>
              <button type="button" disabled={disabled || index6 === 0} onClick={() => commit(geometry((view) => moveLayer(view, layer.id, index6 - 1)))}>Ниже</button>
              <button type="button" data-close className="danger" disabled={disabled} onClick={() => void remove(layer)}>Удалить слой</button>
            </WorkspaceMenu>
          </div>
        </div>;
      })}
      {!layers.length && <p>Слоёв нет. Добавьте первый кнопкой «+».</p>}
    </div>
  </section>;
}
