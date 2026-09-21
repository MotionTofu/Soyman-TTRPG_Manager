// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { useMapHistory } from "./useMapHistory";
import { FIXTURES, parseFixture } from "../../core/fixtures";
import { migrateLegacyMap } from "../../core/migrateLegacy";
import { applyTerrainCellEdits } from "../../core/mutations/terrain";
import type { MapDocumentV5 } from "../../core/types";
import { serializeMapDocument } from "../../core/serialize";

function doc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

describe("useMapHistory with V5 identity clone (§22 ТЗ 2G)", () => {
  it("push/undo/redo снапшотами; мутация не портит history (immutable Core)", () => {
    let value: MapDocumentV5 | null = doc();
    const { result, rerender } = renderHook(() =>
      useMapHistory<MapDocumentV5 | null>({
        value,
        onChange: (d) => {
          value = d;
        },
        clone: (d) => d,
        depth: 50,
      }),
    );
    const sync = () => rerender();
    const before = value!;
    const beforeStr = serializeMapDocument(before);
    // Мутация через Core: новый документ, старый цел.
    const r = applyTerrainCellEdits(before, "lyr-terrain", [
      { x: 0, y: 0, material: { type: "builtin", key: "terrain/forest" } },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    act(() => {
      value = r.document;
      result.current.push(before);
    });
    sync();
    expect(serializeMapDocument(value!)).not.toBe(beforeStr);
    // History хранит before-reference: undo восстанавливает точный документ.
    act(() => {
      result.current.undo();
    });
    sync();
    expect(serializeMapDocument(value!)).toBe(beforeStr);
    // И сам before не был испорчен мутацией (identity clone безопасен).
    expect(serializeMapDocument(before)).toBe(beforeStr);
    act(() => {
      result.current.redo();
    });
    sync();
    expect(serializeMapDocument(value!)).not.toBe(beforeStr);
  });
});
