// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapCamera } from "./useMapCamera";

// Фаза 2G: камера берёт геометрию из документа (mapId + geom), не MapFull.
const GEOM = { grid: "square", width: 40, height: 30 } as const;
const CAM_ARGS = { mapId: 7, geom: { ...GEOM } };
const WRAP_RECT = { width: 800, height: 600, left: 0, top: 0 };

function makeRefs() {
  const listeners = new Map<string, (e: unknown) => void>();
  const canvas = {
    getBoundingClientRect: () => ({ ...WRAP_RECT }),
    addEventListener: (type: string, fn: (e: unknown) => void) => {
      listeners.set(type, fn);
    },
    removeEventListener: (type: string) => {
      listeners.delete(type);
    },
  };
  const wrapRef = {
    current: {
      getBoundingClientRect: () => ({ ...WRAP_RECT }),
    } as unknown as HTMLDivElement,
  };
  const canvasRef = { current: canvas as unknown as HTMLCanvasElement };
  return { wrapRef, canvasRef, listeners };
}

beforeEach(() => {
  localStorage.clear();
  vi.useRealTimers();
});
afterEach(() => vi.restoreAllMocks());

describe("useMapCamera (Этап 1, smoke)", () => {
  it("восстанавливает камеру из localStorage при монтировании", () => {
    localStorage.setItem("maps.cam.7", JSON.stringify({ scale: 50, ox: 10, oy: 20 }));
    const { wrapRef, canvasRef } = makeRefs();
    const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
    expect(result.current.cam).toEqual({ scale: 50, ox: 10, oy: 20 });
  });

  it("не возвращает камеру к сохранённой позиции после правки документа", () => {
    localStorage.setItem("maps.cam.7", JSON.stringify({ scale: 50, ox: 10, oy: 20 }));
    const { wrapRef, canvasRef } = makeRefs();
    const { result, rerender } = renderHook(
      ({ geom }: { geom: typeof GEOM }) => useMapCamera({ mapId: 7, geom, wrapRef, canvasRef }),
      { initialProps: { geom: { ...GEOM } } },
    );
    act(() => {
      result.current.setCam({ scale: 50, ox: -300, oy: -200 });
    });
    // Рисование меняет документ и может создать новый объект geom с теми же размерами.
    rerender({ geom: { ...GEOM } });
    expect(result.current.cam).toEqual({ scale: 50, ox: -300, oy: -200 });
  });

  it("игнорирует битую память и вписывает карту (fit)", () => {
    localStorage.setItem("maps.cam.7", JSON.stringify({ scale: 500, ox: 0, oy: 0 }));
    const { wrapRef, canvasRef } = makeRefs();
    const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
    expect(Number.isFinite(result.current.cam.scale)).toBe(true);
    expect(result.current.cam.scale).toBeGreaterThanOrEqual(4);
  });

  it("wheel zoom держит точку под курсором и clamp 4..240", async () => {
    const { wrapRef, canvasRef, listeners } = makeRefs();
    const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
    const wheel = listeners.get("wheel")!;
    expect(wheel).toBeDefined();
    const sBefore = result.current.cam.scale;
    const before = result.current.toWorld({ clientX: 200, clientY: 150 });
    await act(async () => {
      wheel({ preventDefault: () => {}, clientX: 200, clientY: 150, deltaY: -500 });
      await new Promise(requestAnimationFrame);
    });
    const after = result.current.toWorld({ clientX: 200, clientY: 150 });
    expect(after.wx).toBeCloseTo(before.wx, 9);
    expect(after.wy).toBeCloseTo(before.wy, 9);
    expect(result.current.cam.scale).toBeGreaterThan(sBefore);
    act(() => {
      result.current.zoomBy(1000);
    });
    expect(result.current.cam.scale).toBe(240);
    act(() => {
      result.current.zoomBy(0.000001);
    });
    expect(result.current.cam.scale).toBe(4);
  });

  it("объединяет wheel за кадр, сохраняя разные якоря и порядок ограничения масштаба", () => {
    let callback: FrameRequestCallback | undefined;
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(cb => { callback = cb; return 17; });
    localStorage.setItem("maps.cam.7", JSON.stringify({ scale: 120, ox: 10, oy: 20 }));
    const { wrapRef, canvasRef, listeners } = makeRefs();
    const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
    const wheel = listeners.get("wheel")!, delta = Math.log(2) / Math.log(1.0015);
    act(() => {
      wheel({ preventDefault: () => {}, clientX: 200, clientY: 150, deltaY: -delta * 2 });
      wheel({ preventDefault: () => {}, clientX: 300, clientY: 250, deltaY: delta });
    });
    expect(raf).toHaveBeenCalledTimes(1);
    expect(result.current.cam).toEqual({ scale: 120, ox: 10, oy: 20 });
    act(() => callback!(0));
    expect(result.current.cam.scale).toBeCloseTo(120, 9);
    expect(result.current.cam.ox).toBeCloseTo(60, 9);
    expect(result.current.cam.oy).toBeCloseTo(70, 9);
  });

  it("отменяет отложенный wheel при переключении карты и размонтировании", () => {
    const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(17);
    const cancel = vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    const { wrapRef, canvasRef, listeners } = makeRefs();
    const { rerender, unmount } = renderHook(({ mapId }) => useMapCamera({ ...CAM_ARGS, mapId, wrapRef, canvasRef }), { initialProps: { mapId: 7 } });
    const wheelEvent = { preventDefault: () => {}, clientX: 200, clientY: 150, deltaY: -500 };
    act(() => listeners.get("wheel")!(wheelEvent));
    rerender({ mapId: 8 });
    expect(cancel).toHaveBeenCalledWith(17);
    act(() => listeners.get("wheel")!(wheelEvent));
    expect(raf).toHaveBeenCalledTimes(2);
    unmount();
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("zoomBy идёт к центру и +/- симметричны", () => {
    const { wrapRef, canvasRef } = makeRefs();
    const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
    const s0 = result.current.cam.scale;
    act(() => {
      result.current.zoomBy(1.25);
    });
    expect(result.current.cam.scale).toBeCloseTo(Math.min(240, s0 * 1.25), 9);
    act(() => {
      result.current.zoomBy(1 / 1.25);
    });
    expect(result.current.cam.scale).toBeCloseTo(s0, 9);
  });

  it("force-fit стирает память, persist пишет с debounce", () => {
    vi.useFakeTimers();
    try {
      localStorage.setItem("maps.cam.7", JSON.stringify({ scale: 60, ox: 1, oy: 2 }));
      const { wrapRef, canvasRef } = makeRefs();
      const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
      act(() => {
        result.current.fitCamera(true);
      });
      expect(localStorage.getItem("maps.cam.7")).toBeNull();
      act(() => {
        vi.advanceTimersByTime(500);
      });
      const saved = JSON.parse(localStorage.getItem("maps.cam.7") as string);
      expect(saved.scale).toBeCloseTo(result.current.cam.scale, 9);
    } finally {
      vi.useRealTimers();
    }
  });

  it("toWorld/touchToWorld/toScreen согласованы", () => {
    const { wrapRef, canvasRef } = makeRefs();
    const { result } = renderHook(() => useMapCamera({ ...CAM_ARGS, wrapRef, canvasRef }));
    const w = result.current.toWorld({ clientX: 100, clientY: 80 });
    const t = result.current.touchToWorld(100, 80);
    expect(t).toEqual({ wx: w.wx, wy: w.wy });
    const s = result.current.toScreen(w.wx, w.wy);
    expect(s.sx).toBeCloseTo(100, 9);
    expect(s.sy).toBeCloseTo(80, 9);
  });
});
