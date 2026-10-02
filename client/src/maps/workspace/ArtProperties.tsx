import { insertPathNodes, setPathNodeWidth, pathNodeIntervals, setPathClosed } from "./pathNodes";
import { pathNodesFromAnchors } from "./pathAnchors";
import type { MapDocumentV6 } from "@shared/maps/core";
import { updateSplinePath } from "../core/mutations/paths";
import { SCATTER_PROFILES } from "../scatter";
import { editGeometry } from "./editDocument";
import { selectedPath, putScatter } from "./artisticCommands";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";

export function ArtProperties({ document, selection, selectedNodes = [], onSelectedNodes, commit, onClose, onDelete }: {
  document: MapDocumentV6; selection: WorkspaceSelection; commit: (edit: (doc: MapDocumentV6) => MapDocumentV6) => void;
  selectedNodes?: readonly number[]; onSelectedNodes?: (indices: number[]) => void;
  onClose: () => void; onDelete: () => void;
}) {
  const layer = document.layers.find(l => l.id === selection.layerId), path = selectedPath(document, selection);
  const area = layer?.kind === "scatter" ? layer.areas.find(a => a.id === selection.id) : undefined;
  if (!path && !area) return null;
  const locked = !layer?.visible || layer.locked;
  const nodes = path?.geometry.type === "spline" ? path.geometry.nodes : [];
  const wall = path?.kind === "wall", closed = path?.properties?.closed === true;
  const index = Math.min(selectedNodes[0] ?? 0, nodes.length - 1);
  const intervals = pathNodeIntervals(nodes.length, selectedNodes, closed);
  const nodeWidths = selectedNodes.map(i => nodes[i]?.width ?? path?.width);
  const commonWidth = nodeWidths.length && nodeWidths.every(width => width === nodeWidths[0]) ? nodeWidths[0] : "";
  const update = (patch: Parameters<typeof updateSplinePath>[2]) => commit(doc => { requireEditableLayer(doc, selection.layerId, "path"); return editGeometry(doc, view => updateSplinePath(view, selection.id, patch)); });
  const scatter = (patch: Partial<NonNullable<typeof area>>) => commit(doc => putScatter(doc, selection.layerId, { ...area!, ...patch }));
  return <aside className="workspace-editor-properties" aria-label="Свойства объекта">
    <button aria-label="Закрыть свойства" onClick={onClose}>×</button><strong>{wall ? "Стена" : path?.kind === "river" ? "Река" : path ? "Дорога" : "Россыпь"}</strong>
    {path && <>
      <p>{wall ? "ЛКМ — выбрать точку, Shift+ЛКМ — добавить или снять выбор. Выбранные точки можно двигать вместе." : "ЛКМ — выбрать точку, Shift+ЛКМ — выбрать несколько. Круглые ручки задают изгиб Безье. Выбранные точки можно двигать вместе."}</p>
      <label><input aria-label={wall ? "Замкнутая стена" : "Замкнутая линия"} type="checkbox" checked={closed} disabled={locked || nodes.length < 3} onChange={e => commit(doc => setPathClosed(doc, selection, e.target.checked))} />{wall ? "Замкнуть стену" : "Замкнуть линию"}</label>
      <label>Ширина<input aria-label="Ширина выбранной линии" type="number" min={0.05} max={4} step={0.05} value={path.width} disabled={locked} onChange={e => update({ width: Math.max(0.05, Math.min(4, Number(e.target.value))) })} /></label>
      <label>Точка<select aria-label="Опорная точка" value={index} onChange={e => onSelectedNodes?.([Number(e.target.value)])}>{nodes.map((_, i) => <option key={i} value={i}>{i + 1}</option>)}</select></label>
      <>
        <p>Выбрано точек: {selectedNodes.length}. Толщина плавно переходит к соседним точкам.</p>
        <label>Толщина выбранных точек<input aria-label={wall ? "Толщина выбранных точек стены" : "Толщина выбранных точек линии"} type="number" min={0.05} max={4} step={0.05} value={commonWidth} placeholder={selectedNodes.length > 1 ? "Разная" : "Выберите точку"} disabled={locked || !selectedNodes.length} onChange={e => { if (e.target.value !== "") commit(doc => setPathNodeWidth(doc, selection, selectedNodes, Number(e.target.value))); }} /></label>
        <button disabled={locked || !selectedNodes.length} onClick={() => commit(doc => setPathNodeWidth(doc, selection, selectedNodes))}>{wall ? "Толщина как у стены" : "Толщина как у линии"}</button>
        <button disabled={locked || !intervals.length || nodes.length + intervals.length > 256} onClick={() => {
          const result = insertPathNodes(document, selection, selectedNodes);
          commit(() => result.document); onSelectedNodes?.(result.indices);
        }}>Добавить точки</button>
        <small>Новые точки появятся посередине сегментов, у которых выбраны оба конца.</small>
      </>
      {!wall && <><button disabled={locked} onClick={() => update({ nodes: pathNodesFromAnchors(nodes.map(n => n.position), closed).map((node, i) => ({ ...node, ...(nodes[i].width === undefined ? {} : { width: nodes[i].width }) })) })}>Сгладить линию</button>
      <button disabled={locked} onClick={() => update({ nodes: nodes.map(n => ({ position: n.position, ...(n.width === undefined ? {} : { width: n.width }) })) })}>Выпрямить сегменты</button></>}
      <button title="Для связанной линии удаление точек пока недоступно" disabled={locked || !selectedNodes.length || nodes.length - selectedNodes.length < (closed ? 3 : 2) || document.layers.some(l => l.kind === "path" && l.paths.some(p => p.branchFrom?.pathId === path.id))} onClick={() => { update({ nodes: nodes.filter((_, i) => !selectedNodes.includes(i)) }); onSelectedNodes?.([]); }}>Удалить точки</button>
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
