// @vitest-environment jsdom
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MapViewport } from "./MapViewport";
import { renderMap } from "../../render";
import type { MapRenderModel } from "../../renderModel";
import type { MapFull } from "../../mapTypes";

vi.mock("../../render", () => ({
  readChrome: () => ({ ink: "#111", paper: "#fff" }),
  renderMap: vi.fn(),
}));

// Vitest без globals: авто-cleanup RTL не срабатывает — размонтируем явно.
afterEach(() => {
  cleanup();
});

const renderMapMock = vi.mocked(renderMap);

const MAP = {
  id: 1,
  name: "T",
  grid: "square",
  width: 20,
  height: 20,
  cell_lore: "1 км",
} as unknown as MapFull;

const CELLS_MODEL: MapRenderModel = {
  layers: [
    {
      id: "legacy-terrain",
      name: "Terrain",
      visible: true,
      locked: false,
      opacity: 1,
      kind: "terrain",
      terrain: { defaultCode: "plain", entries: new Map() },
    },
    {
      id: "legacy-gameplay",
      name: "Gameplay",
      visible: true,
      locked: false,
      opacity: 1,
      kind: "gameplay",
      items: [{ kind: "trap", trap: { id: "t-1", position: { x: 1.5, y: 1.5 }, kind: "pit" } }],
    },
  ],
};

function makeCtx() {
  return {
    setTransform: vi.fn(),
    save: vi.fn(),
    restore: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    setLineDash: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    fillRect: vi.fn(),
    strokeRect: vi.fn(),
    fillText: vi.fn(),
    measureText: () => ({ width: 42 }),
  };
}

type ViewportProps = Parameters<typeof MapViewport>[0];

function baseProps(input?: Partial<ViewportProps["input"]>): ViewportProps {
  return {
    wrapRef: { current: null },
    canvasRef: { current: null },
    map: MAP,
    model: CELLS_MODEL,
    cam: { scale: 10, ox: 0, oy: 0 },
    view: { showGrid: true, showCoords: false, previewAsPlayer: false, canEdit: true },
    tool: { tool: "brush", brushSize: 1, wallLineMode: false },
    overlays: {
      hover: null,
      selectedId: null,
      ruler: null,
      wallDraft: null,
      wallLive: null,
      rectPreview: null,
    },
    input: {
      onPointerDown: vi.fn(),
      onPointerMove: vi.fn(),
      onPointerUp: vi.fn(),
      onPointerCancel: vi.fn(),
      onTouchStart: vi.fn(),
      onTouchMove: vi.fn(),
      onTouchEnd: vi.fn(),
      onDoubleClick: vi.fn(),
      spaceDown: false,
      ...input,
    },
  };
}

function setup(patch: Partial<ViewportProps> = {}) {
  const ctx = makeCtx();
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    value: vi.fn(() => ctx),
    configurable: true,
    writable: true,
  });
  const wrapRef = { current: null as HTMLDivElement | null };
  const canvasRef = { current: null as HTMLCanvasElement | null };
  const props = { ...baseProps(), ...patch, wrapRef, canvasRef };
  const utils = render(
    <div ref={wrapRef as never}>
      <MapViewport {...props} />
    </div>
  );
  const canvas = utils.container.querySelector("canvas") as HTMLCanvasElement;
  const wrap = canvas.parentElement as HTMLDivElement;
  // jsdom отдаёт нулевой rect — подменяем размер враппера как в браузере.
  wrap.getBoundingClientRect = () =>
    ({ width: 800, height: 600, left: 0, top: 0, right: 800, bottom: 600 }) as DOMRect;
  const show = (next: Partial<ViewportProps>) => {
    Object.assign(props, next);
    utils.rerender(
      <div ref={wrapRef as never}>
        <MapViewport {...props} />
      </div>
    );
  };
  return { ...utils, canvas, wrap, ctx, props, show };
}

function lastOpts() {
  return renderMapMock.mock.calls[renderMapMock.mock.calls.length - 1][3] as Record<string, unknown>;
}

function calls() {
  return renderMapMock.mock.calls.length;
}

beforeEach(() => {
  renderMapMock.mockClear();
});

describe("MapViewport", () => {
  it("1-2. pointer и touch хендлеры подключены к canvas", () => {
    const h = setup();
    act(() => {
      h.canvas.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
      h.canvas.dispatchEvent(new window.Event("pointermove", { bubbles: true }));
      h.canvas.dispatchEvent(new window.Event("pointerup", { bubbles: true }));
      h.canvas.dispatchEvent(new window.Event("pointercancel", { bubbles: true }));
      h.canvas.dispatchEvent(new window.Event("touchstart", { bubbles: true }));
      h.canvas.dispatchEvent(new window.Event("touchmove", { bubbles: true }));
      h.canvas.dispatchEvent(new window.Event("touchend", { bubbles: true }));
    });
    const input = h.props.input;
    expect(input.onPointerDown).toHaveBeenCalledTimes(1);
    expect(input.onPointerMove).toHaveBeenCalledTimes(1);
    expect(input.onPointerUp).toHaveBeenCalledTimes(1);
    expect(input.onPointerCancel).toHaveBeenCalledTimes(1);
    expect(input.onTouchStart).toHaveBeenCalledTimes(1);
    expect(input.onTouchMove).toHaveBeenCalledTimes(1);
    expect(input.onTouchEnd).toHaveBeenCalledTimes(1);
  });

  it("3. dblclick callback подключён", () => {
    const h = setup();
    act(() => {
      h.canvas.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true }));
    });
    expect(h.props.input.onDoubleClick).toHaveBeenCalledTimes(1);
  });

  it("4. cursor по тем же условиям", () => {
    const h = setup();
    expect(h.canvas.style.cursor).toBe("crosshair");
    act(() => {
      h.show({ tool: { tool: "picker", brushSize: 1, wallLineMode: false } });
    });
    expect(h.canvas.style.cursor).toBe("copy");
    act(() => {
      h.show({ tool: { tool: "select", brushSize: 1, wallLineMode: false } });
    });
    expect(h.canvas.style.cursor).toBe("default");
    act(() => {
      h.show({
        tool: { tool: "brush", brushSize: 1, wallLineMode: false },
        input: { ...h.props.input, spaceDown: true },
      });
    });
    expect(h.canvas.style.cursor).toBe("grab");
    act(() => {
      h.show({
        tool: { tool: "brush", brushSize: 1, wallLineMode: false },
        input: { ...h.props.input, spaceDown: false },
        view: { showGrid: true, showCoords: false, previewAsPlayer: false, canEdit: false },
      });
    });
    expect(h.canvas.style.cursor).toBe("default");
  });

  it("5-9. изменения model/cam/hover/selection/ruler/wall/rect вызывают render", () => {
    const h = setup();
    const n0 = calls();
    expect(n0).toBeGreaterThan(0);
    act(() => {
      h.show({ model: { ...CELLS_MODEL } });
    });
    act(() => {
      h.show({ cam: { scale: 11, ox: 0, oy: 0 } });
    });
    act(() => {
      h.show({ overlays: { ...h.props.overlays, hover: "1,1" } });
    });
    act(() => {
      h.show({ overlays: { ...h.props.overlays, selectedId: "t-1" } });
    });
    act(() => {
      h.show({
        overlays: {
          ...h.props.overlays,
          ruler: { a: { x: 1, y: 1 }, b: null, locked: false },
          wallDraft: [{ x: 1, y: 1 }],
          rectPreview: { x: 1, y: 1, w: 2, h: 2 },
        },
      });
    });
    expect(calls()).toBe(n0 + 5);
  });

  it("тот же state — нового render нет (нет лишних перерисовок)", () => {
    const h = setup();
    const n0 = calls();
    act(() => {
      h.show({});
    });
    expect(calls()).toBe(n0);
  });

  it("10. showGrid/showCoords/playerPreview доходят до renderMap", () => {
    const h = setup();
    expect(lastOpts()).toMatchObject({ showGrid: true, showCoords: false, playerView: false });
    act(() => {
      h.show({
        view: { showGrid: false, showCoords: true, previewAsPlayer: true, canEdit: true },
      });
    });
    expect(lastOpts()).toMatchObject({ showGrid: false, showCoords: true, playerView: true });
    act(() => {
      h.show({
        view: { showGrid: false, showCoords: true, previewAsPlayer: false, canEdit: false },
      });
    });
    expect(lastOpts()).toMatchObject({ playerView: true });
  });

  it("11. unmount: слушатели сняты, ошибок нет", () => {
    const h = setup();
    const input = h.props.input;
    h.unmount();
    act(() => {
      document.body.dispatchEvent(new window.Event("pointerdown", { bubbles: true }));
    });
    expect(input.onPointerDown).not.toHaveBeenCalled();
  });

  it("12. DPR: размер canvas и setTransform как раньше", () => {
    const dpr = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
    Object.defineProperty(window, "devicePixelRatio", { value: 2, configurable: true });
    try {
      const h = setup();
      act(() => {
        h.show({ model: { ...CELLS_MODEL } });
      });
      expect(h.canvas.width).toBe(1600);
      expect(h.canvas.height).toBe(1200);
      expect(h.canvas.style.width).toBe("800px");
      expect(h.ctx.setTransform).toHaveBeenCalledWith(2, 0, 0, 2, 0, 0);
    } finally {
      if (dpr) Object.defineProperty(window, "devicePixelRatio", dpr);
    }
  });

  it("13 (2G/3A). viewport передаёт renderMap layered model + selectedId", () => {
    setup();
    const opts = lastOpts();
    expect("model" in opts).toBe(true);
    expect("cells" in opts).toBe(false);
    expect(opts).toMatchObject({ selectedId: null });
    const layers = (opts.model as MapRenderModel).layers;
    expect(layers.map((l) => l.kind)).toEqual(["terrain", "gameplay"]);
  });
});
