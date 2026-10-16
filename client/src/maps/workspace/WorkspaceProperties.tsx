import { cellWidth } from "../grid";
import { useEffect, useState } from "react";
import type { MapDocumentV6 } from "@shared/maps/core";
import { updateGameplayEntity, updateLabelText } from "../core";
import { maxObjectSize, setMapObjectDry, setMapObjectSign, transformMapObject } from "../core/mutations/mapObjects";
import { resolveMapSymbol } from "../assets/registry";
import { worldSignLabel } from "../assets/world";
import { ignoresWater } from "../water";
import { updateLabelStyle } from "../core/mutations/labels";
import { LABEL_FONTS } from "../labelStyle";
import type { GameplayRoom, MapLabelStyle } from "@shared/maps/core";
import { editGeometry } from "./editDocument";
import { requireEditableLayer, type WorkspaceSelection } from "./editorCommands";
import { TokenProperties } from "./TokenProperties";
import type { TokenDisplay } from "./useTokenPresentations";

export function WorkspaceProperties({ document, selection, commit, onClose, onDelete, display, onPreview, onLink, screenScale = 1 }: {
  document: MapDocumentV6; selection: WorkspaceSelection;
  /** Точек экрана на единицу мира: «Исходный размер» картинки. */
  screenScale?: number;
  commit: (operation: (before: MapDocumentV6) => MapDocumentV6) => void;
  onClose: () => void; onDelete: () => void;
  /** Источник фишки или локация комнаты, квартала и знака «Мира»; `onLink` — начать привязку к локации. */
  display?: TokenDisplay; onPreview?: () => void; onLink?: () => void;
}) {
  const layer = document.layers.find((entry) => entry.id === selection.layerId);
  const item = layer && "items" in layer ? layer.items.find((entry) => entry.id === selection.id) : null;
  const sign = item && "transform" in item && item.visual.type === "asset" ? worldSignLabel(item.visual.assetId) : null;
  const signText = (key: string) => item && "transform" in item && typeof item.properties?.[key] === "string" ? item.properties[key] as string : "";
  const originalText = item && "text" in item ? item.text : item && "name" in item ? item.name : signText("name");
  const [text, setText] = useState(originalText);
  useEffect(() => setText(originalText), [selection.id, originalText]);
  if (!item) return null;
  const room = "kind" in item && item.kind === "room" ? item : null;
  const location = room ? room.location : sign !== null ? signText("location") : "";
  const patchSign = (patch: Parameters<typeof setMapObjectSign>[2]) => edit((view) => setMapObjectSign(view, item.id, patch));
  const patchRoom = (patch: Partial<GameplayRoom>) => edit((view) => updateGameplayEntity(view, item.id, (entity) => entity.kind === "room" ? { ...entity, ...patch } : entity));
  const protectedLayer = !!layer?.locked || !layer?.visible;
  const unit = cellWidth(document.grid?.type ?? "square");
  function edit(operation: Parameters<typeof editGeometry>[1]) {
    commit((before) => { requireEditableLayer(before, selection.layerId); return editGeometry(before, operation); });
  }
  return <aside className="workspace-editor-properties" aria-label="Свойства объекта">
    <button aria-label="Закрыть свойства" onClick={onClose}>×</button><strong>Свойства</strong>
    <p>Перетащите на карте. Привязка управляется отдельно от сетки.</p>
    {"kind" in item && item.kind === "token" && <TokenProperties token={item} selection={selection} display={display} protectedLayer={protectedLayer} commit={commit} onPreview={() => onPreview?.()} />}
    {("text" in item || "name" in item || sign !== null) && <label>{"text" in item ? "Текст подписи" : sign !== null ? "Название" : room?.fill ? "Название квартала" : "Название комнаты"}
      <input value={text} disabled={protectedLayer} maxLength={200} onChange={(event) => setText(event.target.value)} onBlur={() => {
        if (text === originalText) return;
        if ("text" in item && text.trim()) edit((view) => updateLabelText(view, item.id, text.trim()));
        else if ("text" in item) setText(originalText);
        else if ("name" in item) edit((view) => updateGameplayEntity(view, item.id, (entity) => entity.kind === "room" ? { ...entity, name: text } : entity));
        else patchSign({ name: text.trim() || undefined });
      }} />
    </label>}
    {sign !== null && "transform" in item && <label>Высота букв, клеток<input aria-label="Высота букв названия" type="number" min={0.1} max={4} step={0.05} placeholder={`по рангу: ${sign}`} disabled={protectedLayer}
      value={typeof item.properties?.labelSize === "number" ? item.properties.labelSize : ""}
      onChange={(event) => patchSign({ labelSize: event.target.value === "" ? undefined : Math.max(0.1, Math.min(4, Number(event.target.value))) })} /></label>}
    {room?.fill && <label>Заливка<input aria-label="Заливка квартала" type="color" value={room.fill} disabled={protectedLayer} onChange={(event) => patchRoom({ fill: event.target.value })} /></label>}
    {(room || sign !== null) && (location ? <>
      <p>Локация: {display?.name ?? "загрузка…"}</p>
      {display?.state === "missing" && <p role="status">Локация удалена, в архиве или недоступна. Связь остаётся.</p>}
      <button disabled={display?.state !== "active" || !display.id} onClick={() => onPreview?.()}>Открыть карточку</button>
      <button disabled={protectedLayer} onClick={() => room ? patchRoom({ location: undefined }) : patchSign({ location: undefined })}>Отвязать от локации</button>
    </> : <button disabled={protectedLayer || !onLink} onClick={() => onLink?.()}>Привязать к локации</button>)}
    {"text" in item && (() => {
      const look = item.style ?? {}, put = (patch: MapLabelStyle) => edit((view) => updateLabelStyle(view, item.id, { ...look, ...patch }));
      return <>
        <label>Шрифт<select aria-label="Шрифт подписи" value={look.font ?? ""} disabled={protectedLayer} onChange={(event) => put({ font: event.target.value || undefined })}>
          <option value="">Обычный</option>{Object.entries(LABEL_FONTS).map(([key, font]) => <option key={key} value={key}>{font.name}</option>)}
        </select></label>
        <label>Высота букв, клеток<input aria-label="Высота букв подписи" type="number" min={0.1} max={20} step={0.1} value={look.size ?? ""} placeholder="как на экране" disabled={protectedLayer}
          onChange={(event) => put({ size: event.target.value === "" ? undefined : Math.max(0.1, Math.min(20, Number(event.target.value))) })} /></label>
        <label><input type="checkbox" checked={!!look.bold} disabled={protectedLayer} onChange={(event) => put({ bold: event.target.checked || undefined })} />Жирный</label>
        <label><input type="checkbox" checked={!!look.italic} disabled={protectedLayer} onChange={(event) => put({ italic: event.target.checked || undefined })} />Курсив</label>
        <label>Цвет<input aria-label="Цвет подписи" type="color" value={look.color ?? "#171717"} disabled={protectedLayer} onChange={(event) => put({ color: event.target.value })} /></label>
        <button disabled={protectedLayer || !look.color} onClick={() => put({ color: undefined })}>Цвет как у туши</button>
        <label><input type="checkbox" checked={look.dot !== false} disabled={protectedLayer} onChange={(event) => put({ dot: event.target.checked ? undefined : false })} />Точка-метка</label>
        <label>Изгиб · {Math.round((look.bend ?? 0) * 100)}<input aria-label="Изгиб подписи" type="range" min={-100} max={100} step={5} value={Math.round((look.bend ?? 0) * 100)} disabled={protectedLayer}
          onChange={(event) => put({ bend: Number(event.target.value) / 100 || undefined })} /></label>
        <label>Поворот, °<input aria-label="Поворот подписи" type="number" min={-180} max={180} step={5} value={look.rotation ?? 0} disabled={protectedLayer}
          onChange={(event) => put({ rotation: Math.max(-180, Math.min(180, Number(event.target.value))) || undefined })} /></label>
        <label>Разрядка · {Math.round((look.spacing ?? 0) * 100)}%<input aria-label="Разрядка подписи" type="range" min={0} max={100} step={5} value={Math.round((look.spacing ?? 0) * 100)} disabled={protectedLayer}
          onChange={(event) => put({ spacing: Number(event.target.value) / 100 || undefined })} /></label>
      </>;
    })()}
    {"kind" in item && item.kind === "door" && <label>Поворот<select value={item.orientation} disabled={protectedLayer} onChange={(event) => edit((view) => updateGameplayEntity(view, item.id, (entity) => entity.kind === "door" ? { ...entity, orientation: Number(event.target.value) } : entity))}>
      <option value={0}>Вдоль стены →</option><option value={90}>Вдоль стены ↓</option><option value={180}>Вдоль стены ←</option><option value={270}>Вдоль стены ↑</option>
    </select></label>}
    {"transform" in item && (() => {
      // Своя картинка (П15): размер можно задать её точками — сколько их на клетку или точка в точку экрана.
      const asset = item.visual.type === "asset" ? resolveMapSymbol(item.visual) : null, picture = asset && "image" in asset ? asset.image : null;
      const long = picture ? Math.max(picture.naturalWidth, picture.naturalHeight) : 0, size = Math.abs(item.transform.scale.x), limit = maxObjectSize(document);
      const resize = (next: number) => { if (next > 0) edit((view) => transformMapObject(view, item.id, item.transform.rotation, Math.max(0.25, Math.min(limit, next)))); };
      return <>
        <label>Поворот<input type="number" value={item.transform.rotation} step={15} disabled={protectedLayer} onChange={(event) => edit((view) => transformMapObject(view, item.id, Number(event.target.value), size))} /></label>
        <label>Размер, клеток<input type="number" value={Math.round(size / unit * 100) / 100} min={0.25} max={Math.floor(limit / unit * 4) / 4} step={0.25} disabled={protectedLayer} onChange={(event) => resize(Number(event.target.value) * unit)} /></label>
        {long > 0 && <label title="Сколько точек картинки приходится на клетку">Точек на клетку<input type="number" min={1} step={1} disabled={protectedLayer}
          value={Math.round(long * unit / size * 10) / 10} onChange={(event) => { const ppc = Number(event.target.value); if (ppc >= 1) resize(long * unit / ppc); }} /></label>}
        {long > 0 && <button disabled={protectedLayer} title="Точка картинки — точка экрана при нынешнем приближении" onClick={() => resize(long / screenScale)}>Исходный размер</button>}
      </>;
    })()}
    {"transform" in item && <>
      <label><input aria-label="Отразить по горизонтали" type="checkbox" checked={item.transform.scale.x < 0} disabled={protectedLayer} onChange={e => edit(view => transformMapObject(view, item.id, item.transform.rotation, Math.abs(item.transform.scale.x), e.target.checked))} />Отразить по горизонтали</label>
      <label title="Вода не рисует вокруг объекта пену и след — для навеса или моста-объекта"><input type="checkbox" checked={ignoresWater(item)} disabled={protectedLayer} onChange={e => edit(view => setMapObjectDry(view, item.id, e.target.checked))} />Не трогать воду</label>
      <label><input aria-label="Отразить по вертикали" type="checkbox" checked={item.transform.scale.y < 0} disabled={protectedLayer} onChange={e => edit(view => transformMapObject(view, item.id, item.transform.rotation, Math.abs(item.transform.scale.x), undefined, e.target.checked))} />Отразить по вертикали</label>
    </>}
    <button disabled={protectedLayer} onClick={onDelete}>Удалить с карты</button>
  </aside>;
}
