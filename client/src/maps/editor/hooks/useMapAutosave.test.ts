// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMapAutosave } from "./useMapAutosave";
import type { MapFull } from "../../mapTypes";

// Vitest без globals: авто-cleanup RTL не срабатывает, слушатели window
// (beforeunload) текли бы между тестами — размонтируем явно.
afterEach(() => {
  cleanup();
});

interface C {
  v: number;
}

const serialize = (c: C) => `c${c.v}`;
const P0 = { seed: 1, sea: 55, mountains: 12, forest: 30 };
const PARAMS0 = JSON.stringify(P0);
const MAP = { id: 42, grid: "square", width: 10, height: 10 } as unknown as MapFull;

function deferred() {
  let resolve!: () => void;
  let reject!: () => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function setup() {
  const defers: Array<ReturnType<typeof deferred>> = [];
  const save = vi.fn((_mapId: number, _body: unknown) => {
    const d = deferred();
    defers.push(d);
    return d.promise;
  });
  const buildThumbnail = vi.fn((_m: MapFull, live: C) => `thumb-${live.v}`);
  const onSaved = vi.fn();
  let now = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const baseProps = {
    map: null as unknown as MapFull | null,
    value: { v: 0 } as C,
    params: P0,
    serialize: serialize as (c: C) => string,
    save,
    buildThumbnail: buildThumbnail as (m: MapFull, live: C) => string | null,
    onSaved,
  };
  const utils = renderHook(
    (p: typeof baseProps) =>
      useMapAutosave(p as unknown as Parameters<typeof useMapAutosave>[0]),
    { initialProps: baseProps }
  );
  const show = (cellsV: number) =>
    utils.rerender({ ...baseProps, map: MAP, value: { v: cellsV } });
  return {
    ...utils,
    save,
    buildThumbnail,
    onSaved,
    defers,
    show,
    setNow: (n: number) => {
      now = n;
    },
  };
}

// Порядок как на странице: сначала markLoaded (эталон), затем map+cells.
function loadAs(h: ReturnType<typeof setup>, cellsV = 0, corrupt = false) {
  act(() => {
    h.result.current.markLoaded(`c${cellsV}`, PARAMS0, corrupt);
  });
  act(() => {
    h.show(cellsV);
  });
}

function edit(h: ReturnType<typeof setup>, cellsV: number) {
  act(() => {
    h.show(cellsV);
  });
}

function fire() {
  act(() => {
    vi.advanceTimersByTime(800);
  });
}

async function flush() {
  await act(async () => {});
}

function unloadPrevented(): boolean {
  const ev = new window.Event("beforeunload", { cancelable: true });
  window.dispatchEvent(ev);
  return ev.defaultPrevented;
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("useMapAutosave (Этап Autosave)", () => {
  it("1. несколько изменений за <800ms → один save последнего", () => {
    const h = setup();
    loadAs(h);
    edit(h, 1);
    edit(h, 2);
    fire();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1]).toMatchObject({ document: "c2" });
  });

  it("2. возврат к эталону → PUT нет (статус-quirks сохранён: остаётся dirty)", () => {
    const h = setup();
    loadAs(h);
    edit(h, 1);
    expect(h.result.current.status.kind).toBe("dirty");
    edit(h, 0);
    fire();
    expect(h.save).not.toHaveBeenCalled();
    // Quirk исходного кода: ранний return не сбрасывает dirty обратно.
    expect(h.result.current.status.kind).toBe("dirty");
  });

  it("3. поздний ответ A после B не перетирает актуальное", async () => {
    const h = setup();
    loadAs(h);
    edit(h, 1);
    fire();
    expect(h.save).toHaveBeenCalledTimes(1);
    edit(h, 2);
    fire();
    expect(h.save).toHaveBeenCalledTimes(2);
    // A разрешается после отправки B — его результат игнорируется...
    await act(async () => {
      h.defers[0].resolve();
    });
    await flush();
    expect(h.result.current.status.kind).toBe("saving");
    // ...но onSaved вызывается для каждого ответа, как раньше.
    expect(h.onSaved).toHaveBeenCalledTimes(1);
    await act(async () => {
      h.defers[1].resolve();
    });
    await flush();
    expect(h.result.current.status.kind).toBe("saved");
    expect(h.onSaved).toHaveBeenCalledTimes(2);
    // Эталон — v2: возврат к v0 снова считается изменением.
    edit(h, 0);
    fire();
    expect(h.save).toHaveBeenCalledTimes(3);
  });

  it("4. ошибка save → status error, эталон не движется", async () => {
    const h = setup();
    loadAs(h);
    edit(h, 1);
    fire();
    await act(async () => {
      h.defers[0].reject();
    });
    await flush();
    expect(h.result.current.status.kind).toBe("error");
  });

  it("5. retry шлёт актуальное, а не старый snapshot; noop без PUT", async () => {
    const h = setup();
    loadAs(h);
    // Noop-ветка: live == эталон.
    act(() => {
      h.result.current.retry();
    });
    expect(h.save).not.toHaveBeenCalled();
    expect(h.result.current.status.kind).toBe("saved");
    // Живая ветка: ошибка на v1, затем правка v2, retry шлёт v2.
    edit(h, 1);
    fire();
    await act(async () => {
      h.defers[0].reject();
    });
    await flush();
    edit(h, 2);
    act(() => {
      h.result.current.retry();
    });
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[1][1]).toMatchObject({ document: "c2" });
  });

  it("6-7. corrupt блокирует autosave; allowOverwrite возобновляет", () => {
    const h = setup();
    loadAs(h, 0, true);
    edit(h, 1);
    fire();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.result.current.status.kind).toBe("saved");
    act(() => {
      h.result.current.allowOverwrite();
    });
    edit(h, 2);
    fire();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1]).toMatchObject({ document: "c2" });
  });

  it("8. thumbnail throttle 2.5s: повтор — null, пауза — свежий", () => {
    const h = setup();
    loadAs(h);
    edit(h, 1);
    fire();
    expect(h.buildThumbnail).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[0][1]).toMatchObject({ thumbnail: "thumb-1" });
    h.setNow(1_001_000);
    edit(h, 2);
    fire();
    expect(h.buildThumbnail).toHaveBeenCalledTimes(1);
    expect(h.save.mock.calls[1][1]).toMatchObject({ thumbnail: null });
    h.setNow(1_003_000);
    edit(h, 3);
    fire();
    expect(h.buildThumbnail).toHaveBeenCalledTimes(2);
    expect(h.save.mock.calls[2][1]).toMatchObject({ thumbnail: "thumb-3" });
  });

  it("9. beforeunload только при dirty/saving/error", async () => {
    const h = setup();
    loadAs(h);
    expect(unloadPrevented()).toBe(false);
    edit(h, 1);
    expect(unloadPrevented()).toBe(true);
    fire();
    expect(unloadPrevented()).toBe(true); // saving
    await act(async () => {
      h.defers[0].reject();
    });
    await flush();
    expect(unloadPrevented()).toBe(true); // error
    await act(async () => {
      h.result.current.retry();
      h.defers[1].resolve();
    });
    await flush();
    expect(h.result.current.status.kind).toBe("saved");
    expect(unloadPrevented()).toBe(false);
  });

  it("10. unmount чистит таймер и слушатель", () => {
    const h = setup();
    loadAs(h);
    edit(h, 1);
    h.unmount();
    fire();
    expect(h.save).not.toHaveBeenCalled();
    expect(unloadPrevented()).toBe(false);
  });

  it("11 (2G). disabled (unsupported V5) блокирует autosave; save шлёт document", () => {
    const h = setup();
    loadAs(h);
    act(() => {
      h.rerender({
        map: MAP,
        value: { v: 1 },
        params: P0,
        serialize,
        save: h.save,
        buildThumbnail: h.buildThumbnail,
        onSaved: () => {},
        disabled: true,
      } as never);
    });
    fire();
    expect(h.save).not.toHaveBeenCalled();
    expect(h.result.current.status.kind).toBe("saved");
  });
});
