import { memo } from "react";
import { TOOL_LABELS, type WorkspaceTool } from "./editorCommands";

export type BrushSettings = {
  material: string; /** Код жидкости инструмента «Жидкость»: `village-lava-3`. */ liquid?: string; symbol: string; orientation: number; radius: number; lineWidth: number;
  wallWidth?: number;
  pathMode?: "brush" | "points";
  cellSize?: number;
  cellMode?: "brush" | "area";
  scatterProfile: string; density: number; scatterSize: number; scatterSeed: number;
  /** Id ассета-полосы для дороги; пусто — линия тушью. */
  roadStyle?: string;
  /** Полоса стены (ограда) и заливка реки; пусто — кладка и линия. */
  wallStyle?: string;
  riverStyle?: string;
};

const HINTS: Record<WorkspaceTool, string> = {
  select: "Щёлкните по объекту, чтобы выбрать его и перетащить. Delete — удалить.",
  shape: "Протяните мышью прямоугольник.",
  wall: "Клик — точка стены. Enter или двойной клик — закончить. Клик по первой точке — замкнуть. Esc — отменить.",
  door: "Щёлкните по стене, чтобы поставить дверь.",
  brush: "Рисуйте кистью или протяните рамку в режиме «Область». Материал — в каталоге. Выбранные комнаты можно залить целиком.",
  eraser: "Стирает поверхность в выбранном слое. В клеточном режиме доступны кисть, рамка и очистка выбранных комнат.",
  asset: "Выберите объект в каталоге и щёлкните по карте.",
  label: "Щёлкните по карте, чтобы добавить подпись.",
  surface: "Проведите кистью. Материал — в каталоге.",
  liquid: "Проведите кистью. Жидкость и глубина — в полоске под картой. Ластик открывает землю под жидкостью.",
  scatter: "Проведите кистью — знаки лягут россыпью.",
  road: "Проведите линию мышью. Точки потом двигает «Выбор».",
  river: "Проведите линию мышью. Точки потом двигает «Выбор».",
};

function Slider({ name, value, min, max, step, onChange }: { name: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void }) {
  return <label className="workspace-slider"><span>{name}</span>
    <input type="range" aria-label={name} min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    <output>{Math.round(value * 100) / 100}</output>
  </label>;
}

// memo: страница редактора рендерится на каждое движение мыши и камеры.
export const ToolSettings = memo(function ToolSettings({ tool, settings, maskEraser, onChange, onTool, label, selectedRoomCount = 0, roomActionsDisabled, onPaintRooms, onClearRooms }: {
  tool: WorkspaceTool; settings: BrushSettings; maskEraser: boolean; onChange: (patch: Partial<BrushSettings>) => void;
  /** Сменить способ рисования поверхности: плавная кисть или пол по клеткам. */
  onTool?: (tool: "surface" | "brush") => void;
  /** Имя инструмента на этом виде карты: в городе «Комната» зовётся «Квартал». */
  label?: string;
  selectedRoomCount?: number; roomActionsDisabled?: boolean; onPaintRooms?: () => void; onClearRooms?: () => void;
}) {
  const brushSized = tool === "surface" || tool === "liquid" || tool === "scatter" || (tool === "eraser" && maskEraser);
  return <section className="workspace-tool-settings" aria-label="Параметры инструмента">
    <div className="workspace-panel-heading"><h2 className="workspace-panel-title">Инструмент</h2><strong>{label ?? TOOL_LABELS[tool === "brush" ? "surface" : tool]}</strong></div>
    {(tool === "surface" || tool === "brush") && onTool && <div className="workspace-seg workspace-seg-paper" role="group" aria-label="Способ рисования">
      <button type="button" aria-pressed={tool === "surface"} onClick={() => onTool("surface")}>Свободно</button>
      <button type="button" aria-pressed={tool === "brush"} onClick={() => onTool("brush")}>По клеткам</button>
    </div>}
    {brushSized && <Slider name="Размер кисти" value={settings.radius} min={0.25} max={8} step={0.25} onChange={(radius) => onChange({ radius })} />}
    {(tool === "brush" || tool === "eraser" && !maskEraser) && <>
      <label>Режим<select aria-label="Режим клеточной кисти" value={settings.cellMode ?? "brush"} onChange={event => onChange({ cellMode: event.target.value as "brush" | "area" })}>
        <option value="brush">Кисть</option><option value="area">Область рамкой</option>
      </select></label>
      {(settings.cellMode ?? "brush") === "brush" && <Slider name="Размер кисти (клетки)" value={settings.cellSize ?? 1} min={1} max={16} step={1} onChange={(cellSize) => onChange({ cellSize })} />}
      {selectedRoomCount > 0 && <>
        <p>Выбрано комнат и контуров: {selectedRoomCount}</p>
        <button type="button" disabled={roomActionsDisabled} onClick={onPaintRooms}>Залить выделенное</button>
        <button type="button" disabled={roomActionsDisabled} onClick={onClearRooms}>Стереть выделенное</button>
      </>}
    </>}
    {tool === "scatter" && <>
      <Slider name="Плотность" value={settings.density} min={0.1} max={3} step={0.1} onChange={(density) => onChange({ density })} />
      <Slider name="Размер знаков" value={settings.scatterSize} min={0.25} max={8} step={0.25} onChange={(scatterSize) => onChange({ scatterSize })} />
      <button type="button" onClick={() => onChange({ scatterSeed: Math.floor(Math.random() * 2147483647) })}>Перебросить узор</button>
    </>}
    {(tool === "road" || tool === "river") && <><label>Режим<select aria-label="Режим рисования линии" value={settings.pathMode ?? "brush"} onChange={event => onChange({ pathMode: event.target.value as "brush" | "points" })}><option value="brush">Кистью</option><option value="points">По точкам</option></select></label><Slider name="Ширина" value={settings.lineWidth} min={0.05} max={4} step={0.05} onChange={(lineWidth) => onChange({ lineWidth })} /></>}
    {tool === "wall" && <Slider name="Толщина стены" value={settings.wallWidth ?? 0.36} min={0.1} max={2} step={0.05} onChange={(wallWidth) => onChange({ wallWidth })} />}
    {tool === "door" && <label className="workspace-field">Поворот двери
      <select value={settings.orientation} onChange={(event) => onChange({ orientation: Number(event.target.value) })}>
        <option value={0}>Вдоль стены →</option><option value={90}>Вдоль стены ↓</option>
      </select></label>}
    <p className="workspace-hint">{(tool === "road" || tool === "river") && settings.pathMode === "points" ? "Клик — точка кривой. Enter или двойной клик — закончить. Клик по первой точке — замкнуть. Esc — отменить." : HINTS[tool]}</p>
  </section>;
});
