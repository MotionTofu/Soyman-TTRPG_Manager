import { useEffect, useState } from "react";
import type { MapDocumentV6 } from "@shared/maps/core";
import { updateGameplayEntity, updateLabelText } from "../core";
import { transformMapObject } from "../core/mutations/mapObjects";
import { editGeometry } from "./editDocument";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";
import { TokenProperties } from "./TokenProperties";
import type { TokenDisplay } from "./useTokenPresentations";

export function WorkspaceProperties({ document, selection, commit, onClose, onDelete, display, onPreview }: {
  document: MapDocumentV6; selection: WorkspaceSelection;
  commit: (operation: (before: MapDocumentV6) => MapDocumentV6) => void;
  onClose: () => void; onDelete: () => void;
  display?: TokenDisplay; onPreview?: () => void;
}) {
  const layer = document.layers.find((entry) => entry.id === selection.layerId);
  const item = layer && "items" in layer ? layer.items.find((entry) => entry.id === selection.id) : null;
  const originalText = item && "text" in item ? item.text : item && "name" in item ? item.name : "";
  const [text, setText] = useState(originalText);
  useEffect(() => setText(originalText), [selection.id, originalText]);
  if (!item) return null;
  const protectedLayer = !!layer?.locked || !layer?.visible;
  function edit(operation: Parameters<typeof editGeometry>[1]) {
    commit((before) => { requireEditableLayer(before, selection.layerId); return editGeometry(before, operation); });
  }
  return <aside className="workspace-editor-properties" aria-label="Свойства объекта">
    <button aria-label="Закрыть свойства" onClick={onClose}>×</button><strong>Свойства</strong>
    <p>Перетащите на карте. Привязка управляется отдельно от сетки.</p>
    {"kind" in item && item.kind === "token" && <TokenProperties token={item} selection={selection} display={display} protectedLayer={protectedLayer} commit={commit} onPreview={() => onPreview?.()} />}
    {("text" in item || "name" in item) && <label>{"text" in item ? "Текст подписи" : "Название комнаты"}
      <input value={text} disabled={protectedLayer} maxLength={200} onChange={(event) => setText(event.target.value)} onBlur={() => {
        if (text === originalText) return;
        if ("text" in item && text.trim()) edit((view) => updateLabelText(view, item.id, text.trim()));
        else if ("text" in item) setText(originalText);
        else if ("name" in item) edit((view) => updateGameplayEntity(view, item.id, (entity) => entity.kind === "room" ? { ...entity, name: text } : entity));
      }} />
    </label>}
    {"kind" in item && item.kind === "door" && <label>Поворот<select value={item.orientation} disabled={protectedLayer} onChange={(event) => edit((view) => updateGameplayEntity(view, item.id, (entity) => entity.kind === "door" ? { ...entity, orientation: Number(event.target.value) } : entity))}>
      <option value={0}>Вдоль стены →</option><option value={90}>Вдоль стены ↓</option><option value={180}>Вдоль стены ←</option><option value={270}>Вдоль стены ↑</option>
    </select></label>}
    {"transform" in item && <>
      <label>Поворот<input type="number" value={item.transform.rotation} step={15} disabled={protectedLayer} onChange={(event) => edit((view) => transformMapObject(view, item.id, Number(event.target.value), item.transform.scale.x))} /></label>
      <label>Размер<input type="number" value={item.transform.scale.x} min={0.25} max={8} step={0.25} disabled={protectedLayer} onChange={(event) => edit((view) => transformMapObject(view, item.id, item.transform.rotation, Number(event.target.value)))} /></label>
    </>}
    <button disabled={protectedLayer} onClick={onDelete}>Удалить с карты</button>
  </aside>;
}
