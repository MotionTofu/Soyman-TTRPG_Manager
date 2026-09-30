import { useEffect, useState } from "react";
import { detachGameplayToken, type GameplayToken, type MapDocumentV6 } from "@shared/maps/core";
import { updateToken, type WorkspaceSelection } from "./editorCommands";
import type { TokenDisplay } from "./useTokenPresentations";

export function TokenProperties({ token, selection, display, protectedLayer, commit, onPreview }: {
  token: GameplayToken; selection: WorkspaceSelection; display?: TokenDisplay; protectedLayer: boolean;
  commit: (operation: (before: MapDocumentV6) => MapDocumentV6) => void; onPreview: () => void;
}) {
  const original = token.label.mode === "custom" ? token.label.text : display?.name ?? "";
  const [text, setText] = useState(original);
  useEffect(() => setText(original), [token.id, original]);
  const edit = (change: (token: GameplayToken) => GameplayToken) => commit((before) => updateToken(before, selection, change));
  return <>
    <p>{token.sourceRef ? display?.name ?? "Загрузка источника…" : "Визуальная копия без связи"}</p>
    {display?.state === "missing" && <p role="status">Источник удалён, архивирован или недоступен. Токен остаётся на карте.</p>}
    {token.sourceRef && <button disabled={display?.state !== "active" || !display.id} onClick={onPreview}>Карточка источника</button>}
    <label>Подпись<select disabled={protectedLayer} value={token.label.mode} onChange={(event) => edit((entry) => ({ ...entry,
      label: event.target.value === "source" ? { mode: "source" } : { mode: "custom", text: (display?.name ?? "Токен").slice(0, 200) } }))}>
      {token.sourceRef && <option value="source">Имя источника</option>}<option value="custom">Своя подпись</option>
    </select></label>
    {token.label.mode === "custom" && <label>Текст подписи<input disabled={protectedLayer} maxLength={200} value={text}
      onChange={(event) => setText(event.target.value)} onBlur={() => { if (text !== original) edit((entry) => ({ ...entry, label: { mode: "custom", text } })); }} /></label>}
    <label>Размер токена<input type="number" disabled={protectedLayer} value={token.size} min={0.25} max={8} step={0.25}
      onChange={(event) => { const size = Number(event.target.value); if (Number.isFinite(size) && size >= 0.25 && size <= 8) edit((entry) => ({ ...entry, size })); }} /></label>
    <label>Поворот токена<input type="number" disabled={protectedLayer} value={token.rotation} step={15}
      onChange={(event) => { const rotation = Number(event.target.value); if (Number.isFinite(rotation)) edit((entry) => ({ ...entry, rotation })); }} /></label>
    <label>Форма<select disabled={protectedLayer} value={token.appearance.shape} onChange={(event) => edit((entry) => ({ ...entry, appearance: { ...entry.appearance, shape: event.target.value === "diamond" ? "diamond" : "circle" } }))}>
      <option value="circle">Круг</option><option value="diamond">Ромб</option>
    </select></label>
    {token.sourceRef && <label>Изображение<select disabled={protectedLayer} value={token.appearance.visual.type === "entity-avatar" ? "avatar" : "builtin"}
      onChange={(event) => edit((entry) => ({ ...entry, appearance: { ...entry.appearance, visual: event.target.value === "avatar" && entry.sourceRef
        ? { type: "entity-avatar", source: entry.sourceRef } : { type: "builtin", key: entry.sourceRef?.kind === "location" ? "location" : "being" } } }))}>
      <option value="builtin">Силуэт</option><option value="avatar">Портрет источника</option>
    </select></label>}
    <label>Видимость токена<select disabled={protectedLayer} value={token.playerVisibility} onChange={(event) => edit((entry) => ({ ...entry, playerVisibility: event.target.value === "public" ? "public" : "private" }))}>
      <option value="private">Только мастер</option><option value="public">Виден при показе</option>
    </select></label>
    <p>Показ этой карты игрокам пока недоступен.</p>
    {token.sourceRef && <button disabled={protectedLayer} onClick={() => edit((entry) => detachGameplayToken(entry, (original || "Источник недоступен").slice(0, 200)))}>Отвязать от источника</button>}
  </>;
}
