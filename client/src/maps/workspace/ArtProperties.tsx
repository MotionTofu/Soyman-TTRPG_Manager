import { useState } from "react";
import type { MapDocumentV6 } from "@shared/maps/core";
import { updateSplinePath } from "../core/mutations/paths";
import { splineFromAnchors } from "../core/spline";
import { SCATTER_PROFILES } from "../scatter";
import { editGeometry } from "./editDocument";
import { selectedPath, putScatter } from "./artisticCommands";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";

export function ArtProperties({ document, selection, commit, onClose, onDelete }: {
  document: MapDocumentV6; selection: WorkspaceSelection; commit: (edit: (doc: MapDocumentV6) => MapDocumentV6) => void;
  onClose: () => void; onDelete: () => void;
}) {
  const [nodeIndex, setNodeIndex] = useState(0);
  const layer = document.layers.find(l => l.id === selection.layerId), path = selectedPath(document, selection);
  const area = layer?.kind === "scatter" ? layer.areas.find(a => a.id === selection.id) : undefined;
  if (!path && !area) return null;
  const locked = !layer?.visible || layer.locked;
  const nodes = path?.geometry.type === "spline" ? path.geometry.nodes : [];
  const index = Math.min(nodeIndex, nodes.length - 1);
  const update = (patch: Parameters<typeof updateSplinePath>[2]) => commit(doc => { requireEditableLayer(doc, selection.layerId, "path"); return editGeometry(doc, view => updateSplinePath(view, selection.id, patch)); });
  const scatter = (patch: Partial<NonNullable<typeof area>>) => commit(doc => putScatter(doc, selection.layerId, { ...area!, ...patch }));
  return <aside className="workspace-editor-properties" aria-label="Свойства объекта">
    <button aria-label="Закрыть свойства" onClick={onClose}>×</button><strong>{path ? "Линия" : "Россыпь"}</strong>
    {path && <>
      <p>Точки и круглые ручки изгиба можно перетаскивать. За линию — двигать целиком.</p>
      <label>Ширина<input aria-label="Ширина выбранной линии" type="number" min={0.05} max={4} step={0.05} value={path.width} disabled={locked} onChange={e => update({ width: Math.max(0.05, Math.min(4, Number(e.target.value))) })} /></label>
      <label>Точка<select aria-label="Опорная точка" value={index} onChange={e => setNodeIndex(Number(e.target.value))}>{nodes.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
      <button disabled={locked} onClick={() => update({ nodes: splineFromAnchors(nodes.map(n => n.position)) })}>Сгладить линию</button>
      <button disabled={locked} onClick={() => update({ nodes: nodes.map(n => ({ position: n.position, ...(n.width === undefined ? {} : { width: n.width }) })) })}>Выпрямить сегменты</button>
      <button disabled={locked || nodes.length >= 256} onClick={() => {
        const i = Math.min(index, nodes.length - 2), a = nodes[i].position, b = nodes[i + 1].position;
        const next = [...nodes]; next.splice(i + 1, 0, { position: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } });
        update({ nodes: next, insertedAt: { index: i + 1, count: 1 } }); setNodeIndex(i + 1);
      }}>Добавить точку</button>
      <button title="Для связанной линии удаление точек пока недоступно" disabled={locked || nodes.length <= 2 || document.layers.some(l => l.kind === "path" && l.paths.some(p => p.branchFrom?.pathId === path.id))} onClick={() => { update({ nodes: nodes.filter((_, i) => i !== index) }); setNodeIndex(Math.max(0, index - 1)); }}>Удалить точку</button>
    </>}
    {area && <>
      <p>Перетащите область целиком. Вариант сохраняет расположение символов.</p>
      <label>Профиль<select value={area.profileRef.type === "builtin" ? area.profileRef.key : ""} disabled={locked} onChange={e => scatter({ profileRef: { type: "builtin", key: e.target.value } })}>{SCATTER_PROFILES.map(p => <option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
      <label>Плотность<input aria-label="Плотность выбранной россыпи" type="number" min={0.1} max={3} step={0.1} value={area.density} disabled={locked} onChange={e => scatter({ density: Math.max(0.1, Math.min(3, Number(e.target.value))) })} /></label>
      <label>Размер символов<input type="number" min={0.25} max={8} step={0.25} value={Number(area.overrides?.size ?? 1)} disabled={locked} onChange={e => scatter({ overrides: { size: Math.max(0.25, Math.min(8, Number(e.target.value))) } })} /></label>
      <label>Вариант<input aria-label="Вариант выбранной россыпи" type="number" min={0} max={2147483647} value={area.seed} disabled={locked} onChange={e => scatter({ seed: Math.max(0, Math.min(2147483647, Math.round(Number(e.target.value)))) })} /></label>
    </>}
    <button disabled={locked} onClick={onDelete}>Удалить с карты</button>
  </aside>;
}
