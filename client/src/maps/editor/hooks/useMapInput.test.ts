// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapInput } from "./useMapInput";

// Vitest без globals: авто-cleanup RTL не срабатывает — размонтируем явно,
// иначе слушатели Space текли бы между тестами.
afterEach(() => {
  cleanup();
});

// Фаза 2G: input работает с geometry + documentRef (без MapCells/clone).
const GEOM = { grid: "square", width: 20, height: 20 } as const;

interface FakeCam {
  scale: number;
  ox: number;
  oy: number;
}

function setup(overrides: Record<string, unknown> = {}) {
  const cam: FakeCam = { scale: 10, ox: 0, oy: 0 };
  const camRef = { current: { ...cam } };
  const setCam = vi.fn((updater: (c: FakeCam) => FakeCam) => {
    camRef.current = updater(camRef.current);
  });
  const toWorld = vi.fn((e: { clientX: number; clientY: number }) => ({
    wx: e.clientX,
    wy: e.clientY,
    rx: e.clientX,
    ry: e.clientY,
  }));
  const touchToWorld = vi.fn((x: number, y: number) => ({ wx: x, wy: y }));
  let painting = false;
  const history = {
    beginStroke: vi.fn(() => {
      painting = true;
    }),
    markStrokeChanged: vi.fn(),
    commitStroke: vi.fn(() => {
      painting = false;
    }),
    isPainting: vi.fn(() => painting),
    push: vi.fn(),
  };
  const selection = {
    hitAt: vi.fn(
      (_x: number, _y: number): { sel: { kind: "trap"; entityId: string } } | null => null
    ),
    select: vi.fn(),
    moveSelectedTo: vi.fn(),
  };
  const tools = {
    paint: {
      paintAt: vi.fn((_x: number, _y: number) => true),
      singleAction: vi.fn(),
      altPick: vi.fn(),
      placeObject: vi.fn(),
    },
    ruler: { tap: vi.fn(), hover: vi.fn() },
    wall: { tapVertex: vi.fn(), hoverLive: vi.fn(), finishWallLine: vi.fn() },
    shape: { startDrag: vi.fn(), moveDrag: vi.fn(), apply: vi.fn(), tap: vi.fn() },
    label: { open: vi.fn() },
    objects: {
      openPanel: vi.fn(),
      create: vi.fn(),
      roomRect: vi.fn(),
      cancelDrag: vi.fn(),
    },
  };
  const props = {
    canvasRef: {
      current: { getBoundingClientRect: () => ({ left: 0, top: 0 }) },
    },
    // Production-инвариант: hit возможен только при загруженном документе
    // (selection.hitAt без документа возвращает null).
    documentRef: { current: { layers: [] } },
    camera: { setCam, camRef, toWorld, touchToWorld },
    history,
    selection,
    geom: { ...GEOM },
    tool: "brush",
    freePathMode: false,
    freePathEditMode: false,
    selectedFreePathId: null as string | null,
    canEdit: true,
    wallMode: false,
    wallDraft: null,
    ruler: null,
    setHover: vi.fn(),
    setRectPreview: vi.fn(),
    onFogCell: vi.fn(() => true),
    onFreePathPreview: vi.fn(),
    onFreePathBegin: vi.fn(() => true),
    onFreePathCommit: vi.fn(),
    onFreePathSelect: vi.fn(),
    onFreePathEditPreview: vi.fn(),
    onFreePathEditCommit: vi.fn(),
    tools,
    ...overrides,
  };
  const utils = renderHook((p: typeof props) => useMapInput(p as never), {
    initialProps: props,
  });
  const rerender = (patch: Record<string, unknown>) =>
    utils.rerender({ ...utils.result.current && props, ...patch } as never);
  return { ...utils, props, rerender, camRef, setCam, history, selection, tools };
}

function pointer(patch: Record<string, unknown> = {}) {
  return {
    pointerType: "mouse",
    pointerId: 1,
    button: 0,
    buttons: 1,
    clientX: 0,
    clientY: 0,
    altKey: false,
    target: { setPointerCapture: vi.fn() },
    preventDefault: vi.fn(),
    ...patch,
  };
}

function touchList(...ids: Array<[number, number, number]>) {
  return ids.map(([identifier, clientX, clientY]) => ({ identifier, clientX, clientY }));
}

let rafQ: Array<(t: number) => void> = [];

beforeEach(() => {
  rafQ = [];
  vi.stubGlobal("requestAnimationFrame", (cb: (t: number) => void) => {
    rafQ.push(cb);
    return rafQ.length;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {
    rafQ = [];
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function flushRaf() {
  act(() => {
    const q = rafQ;
    rafQ = [];
    q.forEach((cb) => cb(0));
  });
}

function down(h: ReturnType<typeof setup>, patch: Record<string, unknown> = {}) {
  act(() => {
    h.result.current.onPointerDown(pointer(patch) as never);
  });
}

function move(h: ReturnType<typeof setup>, patch: Record<string, unknown> = {}) {
  act(() => {
    h.result.current.onPointerMove(pointer(patch) as never);
  });
}

function up(h: ReturnType<typeof setup>, patch: Record<string, unknown> = {}) {
  act(() => {
    h.result.current.onPointerUp(pointer(patch) as never);
  });
}

describe("useMapInput: mouse", () => {
  it("selects a free road, drags its handle and commits one edit", () => {
    const nodes = [1, 2, 3].map((x) => ({ position: { x, y: 2 } }));
    const documentRef = { current: { layers: [{ kind: "path", visible: true, locked: false,
      paths: [{ id: "free-road", kind: "road", width: 0.22, geometry: { type: "spline", nodes } }] }] } };
    const h = setup({ tool: "road", freePathMode: true, freePathEditMode: true, documentRef });
    down(h, { clientX: 1.5, clientY: 2 });
    expect(h.props.onFreePathSelect).toHaveBeenLastCalledWith("free-road", null,
      expect.objectContaining({ segmentIndex: 0, point: { x: 1.5, y: 2 } }));
    expect(h.props.onFreePathEditCommit).not.toHaveBeenCalled();
    h.rerender({ selectedFreePathId: "free-road" });
    down(h, { clientX: 2, clientY: 2 });
    move(h, { clientX: 2, clientY: 2.5 });
    expect(h.props.onFreePathEditPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      pathId: "free-road", nodes: expect.arrayContaining([{ position: { x: 2, y: 2.5 } }]),
    }));
    up(h, { clientX: 2, clientY: 2.5 });
    expect(h.props.onFreePathEditCommit).toHaveBeenCalledTimes(1);
    expect(h.history.beginStroke).not.toHaveBeenCalled();
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
  });

  it("drags a spline whisker and mirrors the opposite whisker", () => {
    const nodes = [
      { position: { x: 1, y: 2 }, out: { x: 1.3, y: 2 } },
      { position: { x: 2, y: 2 }, in: { x: 1.5, y: 2 }, out: { x: 2.5, y: 2 } },
      { position: { x: 3, y: 2 }, in: { x: 2.7, y: 2 } },
    ];
    const documentRef = { current: { layers: [{ kind: "path", visible: true, locked: false,
      paths: [{ id: "free-road", kind: "road", width: 0.22, geometry: { type: "spline", nodes } }] }] } };
    const h = setup({ tool: "road", freePathMode: true, freePathEditMode: true,
      selectedFreePathId: "free-road", documentRef });
    down(h, { clientX: 2.5, clientY: 2 });
    expect(h.props.onFreePathSelect).toHaveBeenLastCalledWith("free-road", 1);
    move(h, { clientX: 2.5, clientY: 2.4 });
    expect(h.props.onFreePathEditPreview).toHaveBeenLastCalledWith(expect.objectContaining({
      nodes: expect.arrayContaining([expect.objectContaining({
        position: { x: 2, y: 2 }, out: { x: 2.5, y: 2.4 }, in: { x: 1.5, y: 1.6 },
      })]),
    }));
    up(h, { clientX: 2.5, clientY: 2.4 });
    expect(h.props.onFreePathEditCommit).toHaveBeenCalledTimes(1);
  });

  it("cancels a dragged free line without committing it", () => {
    const nodes = [1, 2, 3].map((x) => ({ position: { x, y: 2 } }));
    const documentRef = { current: { layers: [{ kind: "path", visible: true, locked: false,
      paths: [{ id: "free-road", kind: "road", width: 0.22, geometry: { type: "spline", nodes } }] }] } };
    const h = setup({ tool: "road", freePathMode: true, freePathEditMode: true,
      selectedFreePathId: "free-road", documentRef });
    down(h, { clientX: 2, clientY: 2 });
    move(h, { clientX: 2, clientY: 2.5 });
    act(() => h.result.current.onPointerCancel());
    expect(h.props.onFreePathEditPreview).toHaveBeenLastCalledWith(null);
    expect(h.props.onFreePathEditCommit).not.toHaveBeenCalled();
  });

  it("строит дорогу опорными точками и завершает отдельной командой", () => {
    const h = setup({ tool: "road", freePathMode: true });
    down(h, { clientX: 1.2, clientY: 1.3 });
    expect(h.props.onFreePathBegin).toHaveBeenCalledTimes(1);
    expect(h.props.onFreePathBegin).toHaveBeenCalledWith("road");
    move(h, { clientX: 1.6, clientY: 1.5 });
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith({
      anchors: [{ x: 1.2, y: 1.3 }], hover: { x: 1.6, y: 1.5 },
    });
    up(h, { clientX: 1.6, clientY: 1.5 });
    expect(h.props.onFreePathCommit).not.toHaveBeenCalled();
    down(h, { clientX: 2.1, clientY: 1.8 });
    down(h, { clientX: 3.1, clientY: 2.2 });
    down(h, { clientX: 3.2, clientY: 2.2, detail: 2 });
    act(() => h.result.current.finishFreePath());
    expect(h.props.onFreePathCommit).toHaveBeenCalledWith([
      { x: 1.2, y: 1.3 }, { x: 2.1, y: 1.8 }, { x: 3.1, y: 2.2 },
    ], "road");
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith(null);
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
    expect(h.history.beginStroke).not.toHaveBeenCalled();
  });

  it("continues a selected spline from its endpoint", () => {
    const h = setup({ tool: "road", freePathMode: true, freePathEditMode: true });
    const origin = { action: "extend" as const, pathId: "road-1", nodeIndex: 2 };
    act(() => expect(h.result.current.startFreePathFrom({ x: 2, y: 2 }, "road", origin)).toBe(true));
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith({
      anchors: [{ x: 2, y: 2 }], hover: null,
    });
    h.rerender({ freePathEditMode: false });
    down(h, { clientX: 3, clientY: 3 });
    act(() => h.result.current.finishFreePath());
    expect(h.props.onFreePathBegin).not.toHaveBeenCalled();
    expect(h.props.onFreePathCommit).toHaveBeenCalledWith([
      { x: 2, y: 2 }, { x: 3, y: 3 },
    ], "road", origin);
  });

  it("cancels a branch without modifying its parent", () => {
    const h = setup({ tool: "river", freePathMode: true, freePathEditMode: true });
    act(() => h.result.current.startFreePathFrom({ x: 2, y: 2 }, "river",
      { action: "branch", pathId: "river-1", nodeIndex: 1 }));
    h.rerender({ freePathEditMode: false });
    down(h, { clientX: 3, clientY: 3 });
    act(() => h.result.current.cancelFreePath());
    expect(h.props.onFreePathCommit).not.toHaveBeenCalled();
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith(null);
  });

  it("starts a branch from a point between existing spline nodes", () => {
    const h = setup({ tool: "road", freePathMode: true, freePathEditMode: true });
    const origin = { action: "branch-segment" as const, pathId: "road-1",
      segmentIndex: 1, t: 0.4 };
    act(() => h.result.current.startFreePathFrom({ x: 2.4, y: 2 }, "road", origin));
    h.rerender({ freePathEditMode: false });
    down(h, { clientX: 3, clientY: 3 });
    act(() => h.result.current.finishFreePath());
    expect(h.props.onFreePathCommit).toHaveBeenCalledWith([
      { x: 2.4, y: 2 }, { x: 3, y: 3 },
    ], "road", origin);
  });

  it("отменяет незавершённый сплайн без сохранения", () => {
    const h = setup({ tool: "river", freePathMode: true });
    down(h, { clientX: 1.2, clientY: 1.3 });
    down(h, { clientX: 2.2, clientY: 1.3 });
    act(() => h.result.current.cancelFreePath());
    expect(h.props.onFreePathCommit).not.toHaveBeenCalled();
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith(null);
  });

  it("не начинает линию, если создать или выбрать слой пути не удалось", () => {
    const onFreePathBegin = vi.fn(() => false);
    const h = setup({ tool: "road", freePathMode: true, onFreePathBegin });
    down(h, { clientX: 1.2, clientY: 1.3 });
    expect(onFreePathBegin).toHaveBeenCalledTimes(1);
    expect(onFreePathBegin).toHaveBeenCalledWith("road");
    expect(h.props.onFreePathPreview).not.toHaveBeenCalled();
    act(() => h.result.current.finishFreePath());
    expect(h.props.onFreePathCommit).not.toHaveBeenCalled();
  });

  it("завершает сплайн Enter и отменяет следующий Esc", () => {
    const h = setup({ tool: "road", freePathMode: true });
    down(h, { clientX: 1, clientY: 1 });
    down(h, { clientX: 2, clientY: 2 });
    down(h, { clientX: 3, clientY: 2 });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Backspace" })));
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith({
      anchors: [{ x: 1, y: 1 }, { x: 2, y: 2 }], hover: null,
    });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Enter" })));
    expect(h.props.onFreePathCommit).toHaveBeenCalledTimes(1);
    down(h, { clientX: 1, clientY: 1 });
    down(h, { clientX: 2, clientY: 2 });
    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { code: "Escape" })));
    expect(h.props.onFreePathCommit).toHaveBeenCalledTimes(1);
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith(null);
  });

  it("fog рисует клетки мазком и правая кнопка вызывает обратное действие", () => {
    const h = setup({ tool: "fog" });
    down(h, { clientX: 2.5, clientY: 3.5 });
    move(h, { clientX: 4.5, clientY: 3.5 });
    flushRaf();
    up(h, { clientX: 4.5, clientY: 3.5 });
    expect(h.props.onFogCell).toHaveBeenCalledWith(2, 3, false);
    expect(h.props.onFogCell).toHaveBeenCalledWith(4, 3, false);
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
    down(h, { button: 2, buttons: 2, clientX: 2.5, clientY: 3.5 });
    expect(h.props.onFogCell).toHaveBeenLastCalledWith(2, 3, true);
  });

  it("1. LMB → активный инструмент (stroke + paint)", () => {
    const h = setup();
    down(h, { clientX: 5, clientY: 5 });
    expect(h.history.beginStroke).toHaveBeenCalledTimes(1);
    expect(h.tools.paint.paintAt).toHaveBeenCalledWith(5, 5, { eraseOverride: false });
  });

  it("2. middle mouse → pan, инструмент молчит", () => {
    const h = setup();
    down(h, { button: 1, buttons: 4, clientX: 50, clientY: 50 });
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
    expect(h.history.beginStroke).not.toHaveBeenCalled();
    move(h, { button: 1, buttons: 4, clientX: 60, clientY: 55 });
    expect(h.camRef.current).toMatchObject({ ox: 10, oy: 5 });
  });

  it("3. Space+LMB → pan", () => {
    const h = setup();
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keydown", { code: "Space" }));
    });
    expect(h.result.current.spaceDown).toBe(true);
    down(h, { clientX: 50, clientY: 50 });
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
    move(h, { clientX: 70, clientY: 50 });
    expect(h.camRef.current).toMatchObject({ ox: 20, oy: 0 });
    act(() => {
      window.dispatchEvent(new window.KeyboardEvent("keyup", { code: "Space" }));
    });
    expect(h.result.current.spaceDown).toBe(false);
  });

  it("4-5. RMB → временный eraser override; release снимает", () => {
    const h = setup();
    down(h, { button: 2, buttons: 2, clientX: 5, clientY: 5 });
    expect(h.history.beginStroke).toHaveBeenCalledTimes(1);
    expect(h.tools.paint.paintAt).toHaveBeenCalledWith(5, 5, { eraseOverride: true });
    up(h, { button: 2, clientX: 5, clientY: 5 });
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
    // После release override снят: обычный мазок идёт без него.
    down(h, { clientX: 5, clientY: 5 });
    expect(h.tools.paint.paintAt).toHaveBeenLastCalledWith(5, 5, { eraseOverride: false });
  });

  it("6. paint move коалесцируется через rAF (последняя точка)", () => {
    const h = setup();
    down(h, { clientX: 5, clientY: 5 });
    expect(h.tools.paint.paintAt).toHaveBeenCalledTimes(1);
    move(h, { clientX: 6, clientY: 6 });
    move(h, { clientX: 7, clientY: 7 });
    move(h, { clientX: 8, clientY: 8 });
    expect(h.tools.paint.paintAt).toHaveBeenCalledTimes(1);
    flushRaf();
    expect(h.tools.paint.paintAt).toHaveBeenCalledTimes(2);
    expect(h.tools.paint.paintAt).toHaveBeenLastCalledWith(8, 8, { eraseOverride: false });
  });

  it("7. несколько move → один stroke/history", () => {
    const h = setup();
    down(h, { clientX: 5, clientY: 5 });
    move(h, { clientX: 6, clientY: 6 });
    move(h, { clientX: 7, clientY: 7 });
    flushRaf();
    up(h, { clientX: 7, clientY: 7 });
    expect(h.history.beginStroke).toHaveBeenCalledTimes(1);
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
    expect(h.history.push).not.toHaveBeenCalled();
    expect(h.history.markStrokeChanged).toHaveBeenCalled();
  });

  it("8. pointer cancel завершает stroke", () => {
    const h = setup();
    down(h, { clientX: 5, clientY: 5 });
    move(h, { clientX: 6, clientY: 6 });
    act(() => {
      h.result.current.onPointerCancel();
    });
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
  });
});

describe("useMapInput: selection drag", () => {
  const SEL = { kind: "trap", entityId: "t-1" } as const;

  it("9. click без 6px → панель, без history", () => {
    const h = setup();
    h.selection.hitAt.mockReturnValue({ sel: SEL });
    h.rerender({ tool: "select" });
    down(h, { clientX: 10, clientY: 10 });
    up(h, { clientX: 10, clientY: 10 });
    expect(h.selection.select).toHaveBeenCalledWith(SEL);
    expect(h.tools.objects.openPanel).toHaveBeenCalledWith(SEL);
    expect(h.history.push).not.toHaveBeenCalled();
  });

  it("10-11. движение >6px → drag; up: history + восстановление selection", () => {
    const h = setup();
    h.selection.hitAt.mockReturnValue({ sel: SEL });
    h.rerender({ tool: "select" });
    down(h, { clientX: 10, clientY: 10 });
    move(h, { clientX: 13, clientY: 10 });
    expect(h.selection.moveSelectedTo).not.toHaveBeenCalled();
    move(h, { clientX: 18, clientY: 10 });
    expect(h.selection.moveSelectedTo).toHaveBeenCalledTimes(1);
    up(h, { clientX: 18, clientY: 10 });
    expect(h.history.push).toHaveBeenCalledTimes(1);
    expect(h.selection.select).toHaveBeenCalledWith(SEL);
    expect(h.tools.objects.openPanel).not.toHaveBeenCalled();
  });

  it("12. rect drag: preview → roomRect + черновик комнаты", () => {
    const h = setup();
    h.selection.hitAt.mockReturnValue(null);
    h.rerender({ tool: "select" });
    down(h, { clientX: 10, clientY: 10 });
    move(h, { clientX: 15, clientY: 16 });
    expect(h.props.setRectPreview).toHaveBeenCalledWith({ x: 10, y: 10, w: 6, h: 7 });
    up(h, { clientX: 15, clientY: 16 });
    expect(h.result.current.roomRectRef.current).toEqual({ x: 10, y: 10, w: 6, h: 7 });
    expect(h.tools.objects.roomRect).toHaveBeenCalledWith({ x: 10, y: 10, w: 6, h: 7 });
  });
});

describe("useMapInput: touch", () => {
  function tstart(h: ReturnType<typeof setup>, ids: Array<[number, number, number]>) {
    act(() => {
      h.result.current.onTouchStart({ changedTouches: touchList(...ids) } as never);
    });
  }

  function tmove(h: ReturnType<typeof setup>, ids: Array<[number, number, number]>) {
    act(() => {
      h.result.current.onTouchMove({ changedTouches: touchList(...ids) } as never);
    });
  }

  function tend(h: ReturnType<typeof setup>, ids: Array<[number, number, number]>) {
    act(() => {
      h.result.current.onTouchEnd({ changedTouches: touchList(...ids) } as never);
    });
  }

  it("drags a selected free-line point by touch and cancels on a second finger", () => {
    const nodes = [1, 2, 3].map((x) => ({ position: { x, y: 2 } }));
    const documentRef = { current: { layers: [{ kind: "path", visible: true, locked: false,
      paths: [{ id: "free-road", kind: "road", width: 0.22, geometry: { type: "spline", nodes } }] }] } };
    const h = setup({ tool: "road", freePathMode: true, freePathEditMode: true,
      selectedFreePathId: "free-road", documentRef });
    tstart(h, [[1, 2, 2]]);
    tmove(h, [[1, 2, 2.4]]);
    tend(h, [[1, 2, 2.4]]);
    expect(h.props.onFreePathEditCommit).toHaveBeenCalledTimes(1);
    tstart(h, [[2, 2, 2]]);
    tmove(h, [[2, 2, 2.3]]);
    tstart(h, [[3, 3, 3]]);
    expect(h.props.onFreePathEditCommit).toHaveBeenCalledTimes(1);
    expect(h.props.onFreePathEditPreview).toHaveBeenLastCalledWith(null);
  });

  it("ставит точки реки касаниями и сохраняет черновик при зуме двумя пальцами", () => {
    const h = setup({ tool: "river", freePathMode: true });
    tstart(h, [[1, 1.2, 1.3]]);
    tmove(h, [[1, 1.8, 1.6]]);
    tend(h, [[1, 1.8, 1.6]]);
    tstart(h, [[2, 2.3, 1.9]]);
    tend(h, [[2, 2.3, 1.9]]);
    tstart(h, [[3, 2.8, 2.1]]);
    tstart(h, [[4, 3.2, 2.1]]);
    expect(h.props.onFreePathCommit).not.toHaveBeenCalled();
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith({
      anchors: [{ x: 1.2, y: 1.3 }, { x: 2.3, y: 1.9 }, { x: 2.8, y: 2.1 }], hover: null,
    });
    act(() => h.result.current.finishFreePath());
    expect(h.props.onFreePathCommit).toHaveBeenCalledWith([
      { x: 1.2, y: 1.3 }, { x: 2.3, y: 1.9 }, { x: 2.8, y: 2.1 },
    ], "river");
    expect(h.props.onFreePathPreview).toHaveBeenLastCalledWith(null);
  });

  it("13. один палец с кистью РИСУЕТ (факт кода, не pan)", () => {
    const h = setup();
    tstart(h, [[1, 50, 60]]);
    expect(h.history.beginStroke).toHaveBeenCalledTimes(1);
    expect(h.tools.paint.paintAt).toHaveBeenCalledWith(50, 60, { eraseOverride: false });
    tmove(h, [[1, 55, 65]]);
    expect(h.tools.paint.paintAt).toHaveBeenCalledWith(55, 65, { eraseOverride: false });
    expect(h.setCam).not.toHaveBeenCalled();
  });

  it("14-15. pinch зумит с clamp 4..240 и не красит", () => {
    const h = setup();
    tstart(h, [
      [1, 100, 100],
      [2, 200, 100],
    ]);
    const paints = h.tools.paint.paintAt.mock.calls.length;
    tmove(h, [
      [1, 100, 100],
      [2, 10000, 100],
    ]);
    expect(h.camRef.current.scale).toBe(240);
    tmove(h, [
      [1, 100, 100],
      [2, 101, 100],
    ]);
    expect(h.camRef.current.scale).toBe(4);
    expect(h.tools.paint.paintAt.mock.calls.length).toBe(paints);
  });

  it("16. переход 1→2 закрывает мазок и начинает pinch", () => {
    const h = setup();
    tstart(h, [[1, 50, 60]]);
    const paints = h.tools.paint.paintAt.mock.calls.length;
    tstart(h, [[2, 200, 100]]);
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
    tmove(h, [
      [1, 50, 60],
      [2, 300, 100],
    ]);
    expect(h.setCam).toHaveBeenCalled();
    expect(h.tools.paint.paintAt.mock.calls.length).toBe(paints);
  });

  it("17. переход 2→1: остаток не красит и не панорамит", () => {
    const h = setup();
    tstart(h, [
      [1, 100, 100],
      [2, 200, 100],
    ]);
    tend(h, [[2, 200, 100]]);
    const cams = h.setCam.mock.calls.length;
    const begins = h.history.beginStroke.mock.calls.length;
    tmove(h, [[1, 150, 100]]);
    expect(h.setCam.mock.calls.length).toBe(cams);
    expect(h.history.beginStroke.mock.calls.length).toBe(begins);
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
  });

  it("18. touch end чистит touches: новый тап начинает свежий stroke", () => {
    const h = setup();
    tstart(h, [[1, 50, 60]]);
    tend(h, [[1, 50, 60]]);
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
    tstart(h, [[3, 70, 70]]);
    expect(h.history.beginStroke).toHaveBeenCalledTimes(2);
  });
});

describe("useMapInput: read-only", () => {
  it("20. edit закрыт, camera-навигация жива", () => {
    const h = setup();
    h.rerender({ canEdit: false });
    down(h, { clientX: 50, clientY: 50 });
    expect(h.history.beginStroke).not.toHaveBeenCalled();
    expect(h.tools.paint.paintAt).not.toHaveBeenCalled();
    down(h, { button: 1, buttons: 4, clientX: 50, clientY: 50 });
    move(h, { button: 1, buttons: 4, clientX: 60, clientY: 50 });
    expect(h.camRef.current).toMatchObject({ ox: 10, oy: 0 });
  });

  it("не раскрывает клетки тумана в режиме просмотра", () => {
    const h = setup({ tool: "fog", canEdit: false });
    down(h, { clientX: 25, clientY: 35 });
    expect(h.props.onFogCell).not.toHaveBeenCalled();
    expect(h.history.beginStroke).not.toHaveBeenCalled();
  });

  it("закрывает активный мазок при переходе в просмотр и не красит отложенный кадр", () => {
    const h = setup({ tool: "fog" });
    down(h, { clientX: 2.5, clientY: 3.5 });
    move(h, { clientX: 4.5, clientY: 3.5 });
    h.rerender({ canEdit: false });
    flushRaf();
    move(h, { clientX: 5.5, clientY: 3.5 });
    expect(h.props.onFogCell).toHaveBeenCalledTimes(1);
    expect(h.history.commitStroke).toHaveBeenCalledTimes(1);
  });
});
