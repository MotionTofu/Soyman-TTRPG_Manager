import { describe, expect, it } from "vitest";
import { CURSOR_SETS, isCursorSetId, loadCursorSet } from "./cursorSets";

describe("cursorSets", () => {
  it("содержит системный набор и девять мировоззрений", () => {
    expect(CURSOR_SETS).toHaveLength(10);
    expect(CURSOR_SETS[0].id).toBe("system");
    const ids = CURSOR_SETS.map((s) => s.id);
    expect(new Set(ids).size).toBe(10);
  });

  it("превью ведут в /cursors и совпадают с папками", () => {
    for (const s of CURSOR_SETS) {
      if (s.id === "system") {
        expect(s.folder).toBeNull();
        expect(s.preview).toBeNull();
      } else {
        expect(s.folder).toBe(s.id);
        expect(s.preview).toBe(`/cursors/${s.id}-01-arrow.png`);
      }
    }
  });

  it("валидирует сохранённое значение", () => {
    expect(isCursorSetId("chaotic-evil")).toBe(true);
    expect(isCursorSetId("system")).toBe(true);
    expect(isCursorSetId("nope")).toBe(false);
    expect(isCursorSetId(null)).toBe(false);
  });

  it("без сохранённого значения отдаёт системный", () => {
    // В node-окружении localStorage нет — safeStorage ловит и отдаёт fallback.
    expect(loadCursorSet()).toBe("system");
  });
});
