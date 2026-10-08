import { Fragment, memo } from "react";
import { Link } from "react-router-dom";
import type { MapDocumentV6, MapDrawingStyle } from "@shared/maps/core";
import { MapWorkspaceTools } from "./MapWorkspace";
import { MapToolIcon } from "./MapToolIcon";
import { WorkspaceMenu } from "./WorkspaceMenu";
import { layerName } from "./layerNames";
import { TOOL_LABELS, type WorkspaceTool } from "./editorCommands";
import { TOOL_SETS, TOOL_SET_LABELS, type ToolSet } from "./toolSets";
import { EFFECTS, type EffectState, type MapEffect, type MapEffects } from "../gl/effects";

// Обвязка редактора: рейка, шапка и строка статуса. Вынесены из страницы и
// обёрнуты в memo, потому что страница рендерится на каждое движение мыши и
// камеры, а эти части от них не зависят. Замер 2026-10-07 на карте 40×40:
// шаг наведения 16 мс, из них холст — меньшая часть. Обработчики сюда
// приходят стабильными ссылками (`useEvent` в странице), иначе memo не держит.

export type GridLook = { opacity: number; lineWidth: number; lineStyle: "solid" | "dashed"; color: string };
const GRID_COLORS = [["#000000", "Чёрная"], ["#ffffff", "Белая"], ["#ff3e91", "Розовая"], ["#ffe14a", "Жёлтая"]] as const;
const EFFECT_NAMES = Object.keys(EFFECTS) as MapEffect[];
const STYLES: [MapDrawingStyle, string][] = [["comic-punk", "Комикс-панк"], ["paper-ink", "Бумага и тушь"], ["blueprint", "Чертёж"]];

export const WorkspaceToolRail = memo(function WorkspaceToolRail({ toolSet, tool, locked, onChoose }: {
  toolSet: ToolSet; tool: WorkspaceTool; locked: boolean; onChoose: (tool: WorkspaceTool) => void;
}) {
  return <MapWorkspaceTools><div className="map-workspace-tool-list" role="toolbar" aria-label="Инструменты нового редактора">
    {TOOL_SETS[toolSet].map((group, index) => <Fragment key={index}>
      {index > 0 && <hr className="map-workspace-tool-sep" />}
      {group.map((name) => <button key={name} title={TOOL_LABELS[name]} aria-label={TOOL_LABELS[name]} aria-pressed={tool === name}
        disabled={locked} onClick={() => onChoose(name)}><MapToolIcon tool={name} /><span>{TOOL_LABELS[name]}</span></button>)}
    </Fragment>)}
  </div></MapWorkspaceTools>;
});

export const WorkspaceHeader = memo(function WorkspaceHeader({ mapName, status, toolSet, onToolSet, canUndo, canRedo, onUndo, onRedo, grid, onGrid,
  style, onStyle, styleLocked, generatorLocked, saveLocked, onGenerator, onSave, onBackup, onPicture, gl, onGl, effects, onEffect, onEffectsReset, classicLink }: {
  mapName: string; status: string; toolSet: ToolSet; onToolSet: (set: ToolSet) => void;
  canUndo: boolean; canRedo: boolean; onUndo: () => void; onRedo: () => void;
  grid: GridLook; onGrid: (patch: Partial<GridLook>) => void;
  style: MapDrawingStyle; onStyle: (style: MapDrawingStyle) => void; styleLocked: boolean;
  generatorLocked: boolean; saveLocked: boolean; onGenerator: () => void; onSave: () => void; onBackup: () => void; onPicture: () => void;
  /** Отрисовка плитками через WebGL вместо обычного холста. */
  gl: boolean; onGl: (value: boolean) => void;
  effects: MapEffects; onEffect: (name: MapEffect, next: EffectState) => void; onEffectsReset: () => void;
  /** Старый редактор — только для карт, ещё не переведённых в новый формат. */
  classicLink: string | null;
}) {
  return <header className="workspace-editor-header">
    <Link to="/maps" className="workspace-back">← Все карты</Link>
    <div className="workspace-title"><h1 title={mapName}>{mapName}</h1><span aria-live="polite">{status}</span></div>
    <nav className="workspace-seg" aria-label="Набор инструментов">
      {(Object.keys(TOOL_SET_LABELS) as ToolSet[]).map((set) => <button key={set} type="button" aria-pressed={toolSet === set} onClick={() => onToolSet(set)}>{TOOL_SET_LABELS[set]}</button>)}
    </nav>
    <div className="workspace-header-actions">
      <button type="button" className="workspace-icon-button" aria-label="Отменить" title="Отменить · Ctrl+Z" disabled={!canUndo} onClick={onUndo}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M9 4 3 10l6 6M3 10h11c8 0 8 11 0 11" /></svg></button>
      <button type="button" className="workspace-icon-button" aria-label="Повторить" title="Повторить · Ctrl+Y" disabled={!canRedo} onClick={onRedo}>
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="m15 4 6 6-6 6M21 10H10c-8 0-8 11 0 11" /></svg></button>
      <WorkspaceMenu label="СЕТКА ▾" title="Сетка">
        <label>Видимость · {Math.round(grid.opacity * 100)}%<input aria-label="Видимость сетки" type="range" min="0" max="100" value={Math.round(grid.opacity * 100)} onChange={event => onGrid({ opacity: Number(event.target.value) / 100 })} /></label>
        <label>Толщина · {grid.lineWidth} px<input aria-label="Толщина линий сетки" type="range" min="0.5" max="4" step="0.5" value={grid.lineWidth} onChange={event => onGrid({ lineWidth: Number(event.target.value) })} /></label>
        <fieldset><legend>Линии сетки</legend>
          <label><input type="radio" name="grid-line-style" checked={grid.lineStyle === "solid"} onChange={() => onGrid({ lineStyle: "solid" })} />Сплошная</label>
          <label><input type="radio" name="grid-line-style" checked={grid.lineStyle === "dashed"} onChange={() => onGrid({ lineStyle: "dashed" })} />Пунктирная</label>
        </fieldset>
        <fieldset><legend>Цвет сетки</legend>
          {GRID_COLORS.map(([color, name]) => <label key={color}><input type="radio" name="grid-color" checked={grid.color === color} onChange={() => onGrid({ color })} />{name}</label>)}
        </fieldset>
      </WorkspaceMenu>
      <WorkspaceMenu label="Эффекты ▾" title="Эффекты" className="workspace-effects-menu">
        {!gl && <p>Эффекты работают в новой отрисовке: «Карта ▾ → Новая отрисовка».</p>}
        {["Печать", "Погода"].map((group) => <fieldset key={group} disabled={!gl}><legend>{group}</legend>
          {EFFECT_NAMES.filter((name) => EFFECTS[name].group === group).map((name) => { const state = effects[name]; return <Fragment key={name}>
            <label><input type="checkbox" checked={state.on} onChange={event => onEffect(name, { ...state, on: event.target.checked })} />{EFFECTS[name].label}</label>
            {state.on && EFFECTS[name].params.map((param) => <label key={param.key} className="workspace-effect-knob">{param.label} · {state.values[param.key]}
              <input type="range" aria-label={`${EFFECTS[name].label}: ${param.label}`} min={param.min} max={param.max} step={param.step} value={state.values[param.key]}
                onChange={event => onEffect(name, { ...state, values: { ...state.values, [param.key]: Number(event.target.value) } })} /></label>)}
          </Fragment>; })}
        </fieldset>)}
        <button type="button" disabled={!gl} onClick={onEffectsReset}>Вернуть как было</button>
      </WorkspaceMenu>
      <WorkspaceMenu label="Карта ▾" title="Карта" className="workspace-map-menu">
        <fieldset disabled={styleLocked}><legend>Оформление</legend>
          {STYLES.map(([value, name]) => <label key={value}>
            <input type="radio" name="workspace-style" checked={style === value} onChange={() => onStyle(value)} />{name}</label>)}
        </fieldset>
        <button type="button" data-close disabled={generatorLocked} onClick={onGenerator}>Быстрое подземелье…</button>
        <button type="button" data-close disabled={saveLocked} onClick={onSave}>Сохранить сейчас</button>
        <button type="button" data-close onClick={onBackup}>Скачать копию</button>
        <button type="button" data-close onClick={onPicture}>Скачать картинку</button>
        <label><input type="checkbox" checked={gl} onChange={event => onGl(event.target.checked)} />Новая отрисовка (проба)</label>
        {classicLink && <Link to={classicLink} data-close>Классический редактор</Link>}
      </WorkspaceMenu>
    </div>
  </header>;
});

export const WorkspaceStatus = memo(function WorkspaceStatus({ cellLore, layers, activeLayer, onLayer, cursorCell, showGrid, onShowGrid, snap, onSnap, renderWarning }: {
  cellLore: string | null; layers: MapDocumentV6["layers"]; activeLayer: string; onLayer: (id: string) => void;
  cursorCell: string | null; showGrid: boolean; onShowGrid: (value: boolean) => void; snap: boolean; onSnap: (value: boolean) => void;
  renderWarning: boolean;
}) {
  return <footer className="workspace-editor-status">
    {cellLore && <span>1 клетка = {cellLore}</span>}
    <label className="workspace-status-layer">Слой:
      <select value={activeLayer} onChange={(event) => onLayer(event.target.value)}>
        {!layers.some((layer) => layer.id === activeLayer) && <option value="">не выбран</option>}
        {[...layers].reverse().map((layer) => <option key={layer.id} value={layer.id}>{layerName(layer)}{layer.locked ? " · заблокирован" : ""}</option>)}
      </select></label>
    <span className="workspace-status-cell">{cursorCell ? `Клетка ${cursorCell}` : ""}</span>
    <label><input type="checkbox" checked={showGrid} onChange={event => onShowGrid(event.target.checked)} />Показывать сетку</label>
    <label><input type="checkbox" checked={snap} onChange={event => onSnap(event.target.checked)} />Привязывать к сетке</label>
    <span className="workspace-status-hint">{renderWarning ? "Часть изображения пока недоступна" : "Пробел + мышь — сдвиг · колесо — масштаб · Ctrl+Z — отменить"}</span>
  </footer>;
});
