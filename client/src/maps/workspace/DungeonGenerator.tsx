import { prepareCartographyStyle, subscribeMapImageAssets } from "../assets/registry";
import { useEffect, useMemo, useRef, useState } from "react";
import { tokensOf, type MapDocumentV6, type MapDrawingStyle } from "@shared/maps/core";
import { Modal } from "../../components/Modal";
import { renderMap } from "../render";
import { createWorkspaceRenderModel } from "./renderV6";
import { workspaceDrawingStyle } from "./drawingStyle";
import { buildDungeonDocument, DUNGEON_PRESETS, type DungeonSettings } from "./dungeonGeneration";
import "./workspace-editor.css";

export function DungeonGenerator({ open, current, seed, disabled = false, onClose, onApply }: {
  open: boolean; current?: MapDocumentV6; seed?: number; disabled?: boolean;
  onClose: () => void;
  onApply: (document: MapDocumentV6, settings: DungeonSettings, target: "new" | "replace", name: string) => Promise<void>;
}) {
  const [settings, setSettings] = useState<DungeonSettings>(() => ({ ...DUNGEON_PRESETS[0], seed: Math.max(0, seed ?? 1) }));
  const [style, setStyle] = useState<MapDrawingStyle>("paper-ink");
  const [target, setTarget] = useState<"new" | "replace">("new");
  const [name, setName] = useState("Подземелье"), [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const canReplace = !!current?.grid && current.grid.type === "square" && current.grid.cellSize === 1 && current.grid.origin.x === 0 && current.grid.origin.y === 0;
  const effective = useMemo(() => target === "replace" && current?.grid
    ? { ...settings, width: current.grid.columns, height: current.grid.rows } : settings, [settings, target, current?.grid]);
  const generated = useMemo(() => {
    try { return { document: buildDungeonDocument(effective, style), error: null }; }
    catch (failure) { return { document: null, error: failure instanceof Error ? failure.message : "Не удалось создать превью" }; }
  }, [effective, style]);
  useEffect(() => { if (open) { setTarget("new"); setConfirmed(false); setError(null); } }, [open]);
  useEffect(() => {
    if (!open || !generated.document || !canvas.current) return;
    const draw = () => {
      const el = canvas.current, doc = generated.document;
      if (!el || !doc?.grid) return;
      const rect = el.getBoundingClientRect(), dpr = window.devicePixelRatio || 1;
      el.width = Math.round(rect.width * dpr); el.height = Math.round(rect.height * dpr);
      const ctx = el.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = doc.grid.columns, height = doc.grid.rows;
      const scale = Math.min((rect.width - 24) / width, (rect.height - 24) / height);
      renderMap(ctx, rect.width, rect.height, { grid: "square", width, height, model: createWorkspaceRenderModel(doc).model,
        scale, ox: (rect.width - width * scale) / 2, oy: (rect.height - height * scale) / 2,
        showGrid: true, showCoords: false, hover: null, playerView: false, selectedId: null, ...workspaceDrawingStyle(doc) });
    };
    const observer = new ResizeObserver(draw); observer.observe(canvas.current); draw();
    const unsubscribe = subscribeMapImageAssets(draw);
    if (generated.document.appearance?.style === "paper-ink") void prepareCartographyStyle();
    return () => { observer.disconnect(); unsubscribe(); };
  }, [open, generated.document]);
  if (!open) return null;
  const tokenCount = current ? tokensOf(current).length : 0;
  const items = generated.document?.layers.flatMap((layer) => layer.kind === "gameplay" ? layer.items : []) ?? [];
  const update = (patch: Partial<DungeonSettings>) => { setSettings((before) => ({ ...before, ...patch })); setError(null); setConfirmed(false); };
  async function apply() {
    if (busy || disabled || !generated.document || (target === "replace" && (!canReplace || !confirmed)) || !name.trim()) return;
    setBusy(true); setError(null);
    try { await onApply(generated.document, effective, target, name.trim()); onClose(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Не удалось применить подземелье. Попробуйте ещё раз"); }
    finally { setBusy(false); }
  }
  return <Modal ariaLabel="Быстрое подземелье" className="workspace-editor-label-dialog workspace-generator" wide
    closeOnBackdropClick={false} onClose={() => { if (!busy) onClose(); }}>
    <div className="workspace-editor-panel-heading"><h2>Быстрое подземелье</h2><button disabled={busy} aria-label="Закрыть генератор" onClick={onClose}>×</button></div>
    <div className="workspace-generator-body">
      <fieldset disabled={busy || disabled} className="workspace-generator-settings"><legend>Параметры</legend>
        <div className="workspace-generator-presets">{DUNGEON_PRESETS.map((preset) => <button type="button" key={preset.name} onClick={() => update(preset)}>{preset.name}</button>)}</div>
        <label>Куда применить<select value={target} onChange={(event) => { setTarget(event.target.value as typeof target); setConfirmed(false); }}><option value="new">Новая карта</option><option value="replace" disabled={!canReplace}>Заменить текущую карту</option></select></label>
        {target === "new" && <label>Название карты<input value={name} maxLength={200} onChange={(event) => setName(event.target.value)} /></label>}
        <div className="workspace-generator-pair"><label>Ширина<input type="number" min={8} max={100} disabled={target === "replace"} value={effective.width} onChange={(event) => update({ width: Number(event.target.value) })} /></label><label>Высота<input type="number" min={8} max={100} disabled={target === "replace"} value={effective.height} onChange={(event) => update({ height: Number(event.target.value) })} /></label></div>
        <label>Комнаты<input type="number" min={3} max={30} value={settings.rooms} onChange={(event) => update({ rooms: Number(event.target.value) })} /></label>
        <div className="workspace-generator-pair"><label>Коридоры<select value={settings.corrWidth} onChange={(event) => update({ corrWidth: event.target.value === "mixed" ? "mixed" : Number(event.target.value) as 1 | 2 })}><option value="1">1 клетка</option><option value="2">2 клетки</option><option value="mixed">Разная ширина</option></select></label><label>Петли, %<input type="number" min={0} max={100} value={settings.loops} onChange={(event) => update({ loops: Number(event.target.value) })} /></label></div>
        <div className="workspace-generator-pair"><label>Ловушки<select value={settings.traps} onChange={(event) => update({ traps: event.target.value as DungeonSettings["traps"] })}><option value="none">Нет</option><option value="some">Немного</option><option value="many">Много</option></select></label><label className="workspace-generator-check"><input type="checkbox" checked={settings.secrets} onChange={(event) => update({ secrets: event.target.checked })} />Секретные двери</label></div>
        <label>Seed — номер варианта<input type="number" min={0} max={2147483647} value={settings.seed} onChange={(event) => update({ seed: Number(event.target.value) })} /></label>
        <button type="button" onClick={() => { const random = crypto.getRandomValues(new Uint32Array(1))[0] % 2147483648; update({ seed: random === settings.seed ? (random + 1) % 2147483648 : random }); }}>Новый вариант</button>
        <label>Оформление<select value={style} onChange={(event) => setStyle(event.target.value as MapDrawingStyle)}><option value="blueprint">Чистый чертёж</option><option value="paper-ink">Бумага и чернила</option></select></label>
      </fieldset>
      <div className="workspace-generator-preview"><canvas ref={canvas} aria-label="Предпросмотр подземелья" />
        <p aria-live="polite">{generated.error ?? `${items.filter((item) => item.kind === "room").length} из ${effective.rooms} комнат · ${items.filter((item) => item.kind === "door").length} дверей · ${items.filter((item) => item.kind === "trap").length} ловушек`}</p>
        <p>Превью не меняет открытую карту. После применения комнаты, стены и двери можно редактировать.</p>
        {current && !canReplace && <p>Этот данж создаётся на квадратной сетке. Текущую карту можно сохранить отдельно.</p>}
        {target === "replace" && <label className="workspace-generator-warning"><input type="checkbox" checked={confirmed} disabled={busy || disabled} onChange={(event) => setConfirmed(event.target.checked)} />Заменить поверхности, комнаты, двери, подписи и объекты. {tokenCount} токенов останутся на своих местах. Открытые клетки будут сброшены. Всё действие можно отменить.</label>}
      </div>
    </div>
    {error && <p role="alert">{error}</p>}
    <div className="workspace-generator-actions"><button disabled={busy} onClick={onClose}>Отмена</button><button className="primary" disabled={busy || disabled || !generated.document || !name.trim() || (target === "replace" && !confirmed)} onClick={() => void apply()}>{busy ? "Применяем…" : target === "new" ? "Создать карту" : "Заменить содержимое"}</button></div>
  </Modal>;
}
