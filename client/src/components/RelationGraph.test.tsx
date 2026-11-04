// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { Profiler } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { drawGrid, type DrawInput } from "../canvasGraph";
import { applyTheme, BUILTIN_THEMES } from "../themes";
import type { GraphData } from "../graphTypes";
import { autoNodeScales } from "../graphTypes";
import { RelationGraph } from "./RelationGraph";
import { PageContextMenu } from "./PageContextMenu";

vi.mock("../data/hooks", () => ({ useAfterWrite: () => vi.fn() }));
vi.mock("../api/currentUser", () => ({ getCachedUser: () => ({ role: "gm" }) }));
Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });

const mocks = vi.hoisted(() => ({ draw: vi.fn(), simulate: vi.fn(), renders: vi.fn() }));
vi.mock("../canvasGraph", async (original) => ({
  ...await original<typeof import("../canvasGraph")>(), drawGraph: mocks.draw,
}));
vi.mock("../graphTypes", async (original) => ({
  ...await original<typeof import("../graphTypes")>(),
  simulateGraph: mocks.simulate,
}));
vi.mock("./EntityPreviewModal", () => ({ EntityPreviewModal: () => null }));

const data: GraphData = {
  nodes: [
    { key: "being:1", type: "being", id: 1, title: "Первый" },
    { key: "being:2", type: "being", id: 2, title: "Второй" },
  ],
  edges: [{ from: "being:1", to: "being:2", kind: "habitat", tone: null, section: null }],
  isolated: [],
};
const key = "rpgManagerGraphLayout:drag-test";
const rect = { x: 0, y: 0, left: 0, top: 0, right: 900, bottom: 640, width: 900, height: 640, toJSON() {} };
let frames: Map<number, FrameRequestCallback>;
let frameId: number;

function mount(layered = false, graphData = data) {
  const result = render(<MemoryRouter><Profiler id="graph" onRender={mocks.renders}>
    <RelationGraph data={graphData} layoutKey="drag-test" layered={layered}
      view={layered ? "adventures" : "world"} defaultHiddenTypes={layered ? ["campaign"] : []} />
    </Profiler><PageContextMenu /></MemoryRouter>);
  const canvas = result.container.querySelector("canvas")!;
  return { ...result, wrap: canvas.parentElement!, canvas };
}
function setMode(view: ReturnType<typeof render>, mode: "free" | "concentric") {
  fireEvent.click(view.getByRole("button", { name: mode === "free" ? "Свободная" : "Кольца по видам" }));
}
function flushFrame() {
  act(() => {
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(fn => fn(16));
  });
}
function pointer(wrap: HTMLElement, type: "down" | "move" | "up" | "cancel", x: number, y: number) {
  const props = { clientX: x, clientY: y, button: 0, pointerId: 1 };
  const methods = { down: fireEvent.pointerDown, move: fireEvent.pointerMove, up: fireEvent.pointerUp, cancel: fireEvent.pointerCancel };
  methods[type](wrap, props);
}

describe("перетаскивание в графе связей", () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.draw.mockReset(); mocks.simulate.mockReset(); mocks.renders.mockReset();
    mocks.simulate.mockImplementation(() => new Map([
      ["being:1", { x: 100, y: 100, vx: 0, vy: 0 }],
      ["being:2", { x: 400, y: 300, vx: 0, vy: 0 }],
    ]));
    frames = new Map(); frameId = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => { frames.set(++frameId, fn); return frameId; });
    vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
    vi.stubGlobal("PointerEvent", class extends MouseEvent {
      pointerId: number; pointerType: string;
      constructor(type: string, props: PointerEventInit) { super(type, props); this.pointerId = props.pointerId ?? 1; this.pointerType = props.pointerType ?? "mouse"; }
    });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ setTransform() {} } as never);
    HTMLElement.prototype.setPointerCapture = vi.fn();
  });
  afterEach(() => {
    cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  });

  it("показывает движение без React-коммитов и записей, затем сохраняет и восстанавливает финальную позицию", () => {
    const view = mount();
    const writes = vi.spyOn(Storage.prototype, "setItem");
    const layoutRuns = mocks.simulate.mock.calls.length;
    const renderCount = mocks.renders.mock.calls.length;
    pointer(view.wrap, "down", 100, 100);
    for (let i = 1; i <= 5; i++) {
      pointer(view.wrap, "move", 100 + i * 10, 100 + i * 5);
      flushFrame();
    }
    expect(writes).not.toHaveBeenCalled();
    expect(mocks.simulate).toHaveBeenCalledTimes(layoutRuns);
    expect(mocks.renders).toHaveBeenCalledTimes(renderCount);
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject({ x: 150, y: 125 });
    pointer(view.wrap, "up", 165, 140);
    expect(writes.mock.calls.filter(([k]) => k === key)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(key)!)["being:1"]).toEqual({ x: 165, y: 140 });
    view.unmount(); mount();
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject({ x: 165, y: 140 });
  });

  it("сохраняет быстрый перенос до первого кадра и не оставляет отложенных кадров", () => {
    const { wrap } = mount();
    pointer(wrap, "down", 100, 100);
    pointer(wrap, "move", 120, 110);
    pointer(wrap, "up", 180, 150);
    expect(JSON.parse(localStorage.getItem(key)!)["being:1"]).toEqual({ x: 180, y: 150 });
    expect(frames.size).toBe(0);
  });

  it("переносит выделенную группу с одним сохранением и одинаковым смещением", () => {
    const { wrap } = mount();
    fireEvent.click(wrap, { clientX: 100, clientY: 100, shiftKey: true });
    fireEvent.click(wrap, { clientX: 400, clientY: 300, shiftKey: true });
    const writes = vi.spyOn(Storage.prototype, "setItem");
    pointer(wrap, "down", 100, 100);
    pointer(wrap, "move", 130, 150);
    flushFrame();
    expect(writes).not.toHaveBeenCalled();
    pointer(wrap, "up", 130, 150);
    expect(writes.mock.calls.filter(([k]) => k === key)).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual({
      "being:1": { x: 130, y: 150 }, "being:2": { x: 430, y: 350 },
    });
  });

  it("учитывает масштаб камеры и ограничивает координаты краем холста", () => {
    const { wrap } = mount();
    fireEvent(wrap.parentElement!, new CustomEvent("graph-command", { detail: { type: "zoomBy", factor: 2 } }));
    const before = mocks.draw.mock.lastCall![0] as DrawInput;
    const scale = before.zoom * before.fitScale;
    const at = before.positions.get("being:1")!;
    const x = at.x * scale + before.panX, y = at.y * scale + before.panY;
    pointer(wrap, "down", x, y);
    pointer(wrap, "move", x + 40, y + 20);
    pointer(wrap, "up", x + 40, y + 20);
    expect(JSON.parse(localStorage.getItem(key)!)["being:1"]).toEqual({ x: 120, y: 110 });
    pointer(wrap, "down", x + 40, y + 20);
    pointer(wrap, "up", 10000, -10000);
    expect(JSON.parse(localStorage.getItem(key)!)["being:1"]).toEqual({ x: 870, y: 30 });
  });

  it("сохраняет сессию на временной оси и приключение внутри его яруса, включая предпросмотр", () => {
    const graphData: GraphData = {
      nodes: [
        { key: "session:1", type: "session", id: 1, title: "Сессия", date: "2026-10-02", campaign_id: 1 },
        { key: "adventure:1", type: "adventure", id: 1, title: "Приключение" },
      ],
      edges: [{ from: "session:1", to: "adventure:1", kind: "scene", section: "сыграно", tone: null }],
      isolated: [],
    };
    const { wrap } = mount(true, graphData);
    for (const nodeKey of ["session:1", "adventure:1"]) {
      const before = mocks.draw.mock.lastCall![0] as DrawInput;
      const scale = before.zoom * before.fitScale;
      const pos = before.positions.get(nodeKey)!;
      const x = before.panX + pos.x * scale, y = before.panY + pos.y * scale;
      pointer(wrap, "down", x, y);
      pointer(wrap, "move", x + 20, y + 1000);
      flushFrame();
      const preview = (mocks.draw.mock.lastCall![0] as DrawInput).positions.get(nodeKey)!;
      const expectedY = nodeKey === "session:1" ? pos.y : before.bands![1].bottom - 18;
      expect(preview.y).toBe(expectedY);
      pointer(wrap, "up", x + 20, y + 1000);
      expect(JSON.parse(localStorage.getItem(key)!)[nodeKey].y).toBe(expectedY);
    }
  });

  it("отменяет прерванный жест, а обычный клик не закрепляет узел", () => {
    const { wrap } = mount();
    pointer(wrap, "down", 100, 100);
    pointer(wrap, "move", 140, 160);
    flushFrame();
    pointer(wrap, "cancel", 140, 160);
    expect(localStorage.getItem(key)).toBeNull();
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject({ x: 100, y: 100 });
    pointer(wrap, "down", 100, 100);
    pointer(wrap, "up", 100, 100);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("переключает кольца без симуляции, хранит раскладки отдельно и сбрасывает только текущую", () => {
    const free = { "being:1": { x: 120, y: 130 } }, ring = { "being:1": { x: 220, y: 230 } };
    localStorage.setItem(key, JSON.stringify(free));
    localStorage.setItem(key + ":concentric", JSON.stringify(ring));
    const view = mount();
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject(free["being:1"]);
    mocks.simulate.mockClear();
    setMode(view, "concentric");
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect((mocks.draw.mock.lastCall![0] as DrawInput).concentric?.rings).toHaveLength(1);
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject(ring["being:1"]);
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(free);
    fireEvent.click(view.getByRole("button", { name: /^Сбросить$/ }));
    expect(localStorage.getItem(key + ":concentric")).toBeNull();
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(free);
    setMode(view, "free");
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject(free["being:1"]);
    setMode(view, "concentric");
    view.unmount(); mocks.simulate.mockClear(); mount();
    expect(mocks.simulate).not.toHaveBeenCalled();
    expect((mocks.draw.mock.lastCall![0] as DrawInput).concentric?.rings).toHaveLength(1);
  });

  it("сохраняет перенос на кольцах и возвращает его после переключения режима", () => {
    const view = mount();
    setMode(view, "concentric");
    const wrap = view.container.querySelector("canvas")!.parentElement!;
    const before = mocks.draw.mock.lastCall![0] as DrawInput;
    const pos = before.positions.get("being:1")!, s = before.zoom * before.fitScale;
    const x = pos.x * s + before.panX, y = pos.y * s + before.panY;
    pointer(wrap, "down", x, y); pointer(wrap, "up", x + 40, y + 20);
    const stored = JSON.parse(localStorage.getItem(key + ":concentric")!)["being:1"];
    expect(stored.x).toBeCloseTo(pos.x + 40 / s); expect(stored.y).toBeCloseTo(pos.y + 20 / s);
    expect(localStorage.getItem(key)).toBeNull();
    setMode(view, "free");
    setMode(view, "concentric");
    expect((mocks.draw.mock.lastCall![0] as DrawInput).positions.get("being:1")).toMatchObject(stored);
  });

  it("фильтрует виды и сохраняет изоляцию в режиме колец", () => {
    localStorage.setItem("rpgManagerGraphLayoutMode:world", "concentric");
    const view = mount(false, {
      ...data,
      nodes: [...data.nodes, { key: "location:1", type: "location", id: 1, title: "Убежище" }],
      edges: [...data.edges, { from: "being:2", to: "location:1", kind: "habitat", tone: null, section: null }],
    });
    fireEvent.click(view.getByRole("button", { name: /Локации/ }));
    const before = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(before.visibleNodes).toHaveLength(2);
    expect(before.concentric?.rings.map(r => r.type)).toEqual(["being"]);
    const pos = before.positions.get("being:1")!, s = before.zoom * before.fitScale;
    const wrap = view.container.querySelector("canvas")!.parentElement!;
    fireEvent.doubleClick(wrap, { clientX: pos.x * s + before.panX, clientY: pos.y * s + before.panY });
    const isolated = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(view.getByRole("button", { name: "Весь граф" })).toBeTruthy();
    expect(isolated.focusedKey).toBe("being:1");
    expect(isolated.concentric).not.toBeNull();
    expect(mocks.simulate).not.toHaveBeenCalled();
  });

  it("показывает найденную сущность в центре и не двигает камеру при обычном клике", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("rpgManagerGraphLayoutMode:world", "concentric");
      const view = mount();
      const initial = mocks.draw.mock.lastCall![0] as DrawInput;
      fireEvent.change(view.getByPlaceholderText("Найти сущность…"), { target: { value: "Первый" } });
      act(() => vi.advanceTimersByTime(210));
      fireEvent.click(view.getByText("Первый", { selector: "mark" }));
      const found = mocks.draw.mock.lastCall![0] as DrawInput;
      const pos = found.positions.get("being:1")!, s = found.zoom * found.fitScale;
      expect(pos.x * s + found.panX).toBeCloseTo(450);
      expect(pos.y * s + found.panY).toBeCloseTo(320);
      expect(found.zoom).toBeGreaterThanOrEqual(initial.zoom);
      const wrap = view.container.querySelector("canvas")!.parentElement!;
      fireEvent.click(wrap, { clientX: 450, clientY: 320 });
      const clicked = mocks.draw.mock.lastCall![0] as DrawInput;
      expect(clicked.panX).toBe(found.panX); expect(clicked.panY).toBe(found.panY);
    } finally { vi.useRealTimers(); }
  });

  it("оставляет граф приключений в ярусах при сохранённом выборе колец для миров", () => {
    localStorage.setItem("rpgManagerGraphLayoutMode:world", "concentric");
    const view = mount(true);
    expect(view.queryByRole("group", { name: "Раскладка графа миров" })).toBeNull();
    const input = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(input.concentric).toBeNull(); expect(input.bands).not.toBeNull();
  });

  it("удваивает карточки миров и позволяет одним нажатием увидеть все кольца", () => {
    const view = mount();
    const free = mocks.draw.mock.lastCall![0] as DrawInput;
    const scale = autoNodeScales(data.nodes, data.edges, "links").get("being:1")! * 2;
    expect(free.nodeScales.get("being:1")).toBe(scale);
    setMode(view, "concentric");
    const rings = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(rings.nodeScales.get("being:1")).toBe(scale);
    expect(rings.zoom * rings.fitScale).toBeCloseTo(1.2);
    fireEvent.click(view.getByRole("button", { name: "Обзор" }));
    const overview = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(overview.zoom).toBe(1);
    const layout = overview.concentric!, s = overview.fitScale;
    expect(layout.centerX * s + overview.panX).toBeCloseTo(450);
    expect(layout.centerY * s + overview.panY).toBeCloseTo(320);
    view.unmount(); mount(true);
    expect((mocks.draw.mock.lastCall![0] as DrawInput).nodeScales.get("being:1")).toBe(1);
  });

  it("оставляет текст крупным на большом графе и позволяет увеличивать дальше начального масштаба", () => {
    localStorage.setItem("rpgManagerGraphLayoutMode:world", "concentric");
    const large: GraphData = {
      nodes: Array.from({ length: 600 }, (_, id) => ({ key: `being:${id}`, type: "being", id, title: `Существо с названием ${id}` })),
      edges: [],
    };
    const view = mount(false, large);
    const initial = mocks.draw.mock.lastCall![0] as DrawInput;
    const at = initial.concentric!.rings[0].keys[0];
    const pos = initial.positions.get(at)!;
    const screenScale = initial.zoom * initial.fitScale;
    expect(10 * initial.nodeScales.get(at)! * screenScale).toBeGreaterThanOrEqual(20);
    expect(pos.x * screenScale + initial.panX).toBeCloseTo(450);
    expect(pos.y * screenScale + initial.panY).toBeCloseTo(320);
    fireEvent.click(view.getByTitle("Приблизить"));
    const closer = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(closer.zoom).toBeGreaterThan(initial.zoom);
    // Список чтеца добавляет 600 доступных кнопок. Здесь проверяется камера,
    // поэтому не вычисляем accessible name каждой кнопки ради «Обзора».
    fireEvent.click(view.getByTitle("Показать весь граф"));
    const overview = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(overview.zoom).toBe(1);
    expect(overview.nodeScales.get(at)).toBe(initial.nodeScales.get(at));
  });
  it("ищет восемь видимых совпадений после скрытых и закрывает пустой поиск по Escape", () => {
    vi.useFakeTimers();
    try {
      const nodes = Array.from({ length: 18 }, (_, i) => ({
        key: `${i < 8 ? 'being' : 'location'}:${i + 1}`,
        type: i < 8 ? 'being' : 'location', id: i + 1, title: `Мишень ${i + 1}`,
      }));
      const view = render(<MemoryRouter><RelationGraph data={{ nodes, edges: [] }} defaultHiddenTypes={['being']} /></MemoryRouter>);
      const input = view.getByRole('textbox', { name: 'Найти сущность' });
      fireEvent.change(input, { target: { value: 'Мишень' } });
      act(() => vi.advanceTimersByTime(210));
      expect(view.container.querySelectorAll('.entity-search-item')).toHaveLength(8);
      expect(view.container.querySelector('.entity-search-results')?.textContent).toContain('Мишень 9');
      expect(view.container.querySelector('.entity-search-results')?.textContent).not.toContain('Мишень 17');
      fireEvent.change(input, { target: { value: 'несуществующая' } });
      act(() => vi.advanceTimersByTime(210));
      expect(view.getByText('Нет результатов')).toBeTruthy();
      fireEvent.keyDown(input, { key: 'Escape' });
      expect((input as HTMLInputElement).value).toBe('');
      expect(view.queryByText('Нет результатов')).toBeNull();
    } finally { vi.useRealTimers(); }
  });

  it("сбрасывает выделенный результат при смене запроса", () => {
    vi.useFakeTimers();
    try {
      const view = mount();
      const input = view.getByRole('textbox', { name: 'Найти сущность' });
      fireEvent.change(input, { target: { value: 'р' } });
      act(() => vi.advanceTimersByTime(210));
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      expect(view.container.querySelector('.highlighted')?.textContent).toContain('Второй');
      fireEvent.change(input, { target: { value: 'Перв' } });
      act(() => vi.advanceTimersByTime(210));
      expect(view.container.querySelector('.highlighted')).toBeNull();
      fireEvent.keyDown(input, { key: 'ArrowDown' });
      fireEvent.keyDown(input, { key: 'Enter' });
      expect(view.getByRole('region', { name: 'Выбрано: Первый' })).toBeTruthy();
    } finally { vi.useRealTimers(); }
  });

  it("applyTheme перерисовывает уже открытый граф новыми цветами: светлая → тёмная → светлая", () => {
    vi.stubGlobal('DOMMatrix', class {});
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue({ setTransform() {}, fillRect() {} } as never);
    const fills: unknown[] = [];
    const ctx = {
      fillStyle: '' as unknown,
      fillRect() { fills.push(this.fillStyle); }, save() {}, restore() {},
      createPattern: () => ({ setTransform() {} }),
    };
    const view = mount();
    mocks.draw.mockImplementation(() => drawGrid(ctx as unknown as CanvasRenderingContext2D, 900, 640, 0, 0, 1, 1));
    for (const id of ['light', 'dark', 'light']) {
      const theme = BUILTIN_THEMES.find(t => t.id === id)!;
      fills.length = 0;
      act(() => applyTheme(theme));
      expect(fills[0]).toBe(theme.vars['--sheet']);
    }
    view.unmount();
    mocks.draw.mockClear();
    act(() => applyTheme(BUILTIN_THEMES[1]));
    expect(mocks.draw).not.toHaveBeenCalled();
    document.documentElement.removeAttribute('style');
  });

  it("общее меню сохраняет местные действия, шапку и архив последним; ⋯ и клавиши открывают то же меню", () => {
    const view = mount();
    const labels = () => [...document.querySelectorAll('.context-menu-label')].map(e => e.textContent);
    fireEvent.contextMenu(view.wrap, { clientX: 100, clientY: 100 });
    const expected = ['Изолировать узел и связи', 'Изменить размер', 'Карточка сущности', 'Перейти к сущности',
      'Открыть', 'Открыть вторым окном', 'В мешок', 'Закрепить', 'Копировать упоминание', 'В архив'];
    expect(labels()).toEqual(expected);
    expect(view.getByRole('menu', { name: 'Первый' })).toBeTruthy();
    expect(document.querySelector('.context-menu-title')?.querySelector('.type-glyph')).toBeTruthy();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    fireEvent.click(view.wrap, { clientX: 100, clientY: 100 });
    fireEvent.click(view.getByRole('button', { name: 'Действия: Первый' }));
    expect(labels()).toEqual(expected);
    for (const props of [{ key: 'ContextMenu' }, { key: 'F10', shiftKey: true }]) {
      fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
      view.wrap.focus();
      fireEvent.keyDown(view.wrap, props);
      expect(labels()).toEqual(expected);
    }
  });

  it("Shift+ПКМ пропускает системное меню", () => {
    const view = mount();
    expect(fireEvent.contextMenu(view.wrap, { clientX: 100, clientY: 100, shiftKey: true })).toBe(true);
    expect(document.querySelector('.context-menu')).toBeNull();
  });

  it("список чтеца называет только видимые узлы, связи и приближает выбранный как поиск", () => {
    const view = mount();
    const list = view.getByRole('list', { name: 'Видимые узлы графа' });
    expect(list.querySelectorAll('li')).toHaveLength(2);
    const first = view.getByRole('button', { name: 'Существо: Первый · 1 связь' });
    fireEvent.click(first);
    expect(first.getAttribute('aria-pressed')).toBe('true');
    const draw = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(draw.focusedKey).toBe('being:1');
    expect(draw.zoom * draw.fitScale).toBeGreaterThanOrEqual(1.2);
    fireEvent.click(view.getByRole('button', { name: /^Существа\s*2$/ }));
    expect(list.querySelectorAll('li')).toHaveLength(0);
  });

  it("касание пустого поля панорамирует, щипок масштабирует; после отпускания нет скачка и записи узлов", () => {
    const view = mount();
    const touch = (type: 'down' | 'move' | 'up', id: number, x: number, y: number) => {
      ({down:fireEvent.pointerDown, move:fireEvent.pointerMove, up:fireEvent.pointerUp})[type](view.wrap,
        { pointerType:'touch', pointerId:id, clientX:x, clientY:y, button:0 });
      flushFrame();
    };
    const before = mocks.draw.mock.lastCall![0] as DrawInput;
    touch('down',1,600,400); touch('move',1,640,430);
    let draw = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(draw.panX).toBe(before.panX + 40); expect(draw.panY).toBe(before.panY + 30);
    expect(view.container.querySelector<HTMLElement>('.graph-marquee')?.style.display).not.toBe('block');
    touch('down',2,740,430); touch('move',2,840,430);
    draw = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(draw.zoom).toBe(before.zoom * 2);
    touch('up',2,840,430);
    fireEvent.lostPointerCapture(view.wrap, {pointerType:'touch',pointerId:2});
    touch('move',1,650,440);
    const after = mocks.draw.mock.lastCall![0] as DrawInput;
    expect(after.panX).toBe(draw.panX + 10); expect(after.panY).toBe(draw.panY + 10);
    touch('up',1,650,440);
    expect(localStorage.getItem(key)).toBeNull();
  });

  it("карточка показывает короткую фразу и область; без описания строка отсутствует", () => {
    const graphData = {...data, nodes: data.nodes.map((n,i) => ({...n, scopeLabel:'Сеттинг · Эстария', ...(i === 0 ? {blurb:'Живёт у реки.'} : {})}))};
    const view = mount(false, graphData);
    fireEvent.click(view.wrap, {clientX:100,clientY:100});
    expect(view.getByText('Живёт у реки.')).toBeTruthy();
    expect(view.getByText('Сеттинг · Эстария')).toBeTruthy();
    fireEvent.click(view.wrap, {clientX:400,clientY:300});
    expect(view.container.querySelector('.rg-card__blurb')).toBeNull();
    expect(view.getByText('Сеттинг · Эстария')).toBeTruthy();
  });

});
