// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMapHistory } from "./useMapHistory";

interface Doc {
  n: number;
  tags: string[];
}

const cloneDoc = (d: Doc): Doc => ({ n: d.n, tags: [...d.tags] });

function setup(depth = 50) {
  let value: Doc = { n: 0, tags: [] };
  const onChange = (next: Doc) => {
    value = next;
  };
  const utils = renderHook(() =>
    useMapHistory<Doc>({ value, onChange, clone: cloneDoc, depth })
  );
  // value в хук уходит через пропсы рендера; для простоты пробрасываем свежий:
  const rerender = (next: Doc) => {
    value = next;
    utils.rerender();
  };
  return { ...utils, rerender, get: () => value };
}

describe("useMapHistory (Этап 2, smoke)", () => {
  it("push/undo/redo ходят по снапшотам", () => {
    const h = setup();
    const before = cloneDoc(h.get());
    act(() => {
      h.result.current.push(before);
    });
    expect(h.result.current.canUndo).toBe(true);
    act(() => {
      h.result.current.undo();
    });
    expect(h.result.current.canUndo).toBe(false);
    expect(h.result.current.canRedo).toBe(true);
    act(() => {
      h.result.current.redo();
    });
    expect(h.result.current.canRedo).toBe(false);
    expect(h.result.current.canUndo).toBe(true);
  });

  it("новый push после undo очищает redo", () => {
    const h = setup();
    act(() => {
      h.result.current.push(cloneDoc(h.get()));
    });
    act(() => {
      h.result.current.undo();
    });
    expect(h.result.current.canRedo).toBe(true);
    act(() => {
      h.result.current.push(cloneDoc(h.get()));
    });
    expect(h.result.current.canRedo).toBe(false);
  });

  it("stroke из нескольких пометок — ровно один undo-шаг", () => {
    const h = setup();
    act(() => {
      h.result.current.beginStroke();
    });
    act(() => {
      h.result.current.markStrokeChanged();
      h.result.current.markStrokeChanged();
      h.result.current.markStrokeChanged();
    });
    act(() => {
      h.result.current.commitStroke();
    });
    expect(h.result.current.canUndo).toBe(true);
    act(() => {
      h.result.current.undo();
    });
    expect(h.result.current.canUndo).toBe(false);
  });

  it("пустой stroke шага не даёт, mark вне мазка — no-op", () => {
    const h = setup();
    act(() => {
      h.result.current.markStrokeChanged();
    });
    act(() => {
      h.result.current.beginStroke();
      h.result.current.commitStroke();
    });
    expect(h.result.current.canUndo).toBe(false);
  });

  it("глубина обрезает старые шаги", () => {
    const h = setup(3);
    for (let i = 0; i < 4; i++) {
      const snap = cloneDoc(h.get());
      snap.n = i;
      act(() => {
        h.result.current.push(snap);
      });
    }
    let undos = 0;
    while (h.result.current.canUndo) {
      act(() => {
        h.result.current.undo();
      });
      undos++;
    }
    expect(undos).toBe(3);
  });

  it("clear сбрасывает всё", () => {
    const h = setup();
    act(() => {
      h.result.current.push(cloneDoc(h.get()));
      h.result.current.clear();
    });
    expect(h.result.current.canUndo).toBe(false);
    expect(h.result.current.canRedo).toBe(false);
  });
});
