import { describe, expect, it } from "vitest";
import { applyTerrainCellEdits } from "../core/mutations/terrain";
import { migrateLegacyMap } from "../core/migrateLegacy";
import type { MapDocumentV5, TerrainCellLayer } from "../core/types";
import { validateMapDocument } from "../core/validate";
import { fixConnectivityV5 } from "./fixConnectivityV5";

function dungeonDoc(): MapDocumentV5 {
  // Две комнаты, разделённые стеной: левая достижима со старта, правая — нет.
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: {
      terrain: new Map([
        ["3,0", "wall"], ["3,1", "wall"], ["3,2", "wall"], ["3,3", "wall"],
        ["3,4", "wall"], ["3,5", "wall"], ["3,6", "wall"], ["3,7", "wall"],
      ]),
      roads: new Set(),
      rivers: new Set(),
      labels: [],
      rooms: [
        { x: 0, y: 0, w: 2, h: 2, type: "empty", name: "" },
        { x: 5, y: 0, w: 2, h: 2, type: "empty", name: "" },
      ],
      doors: [],
      traps: [],
      markers: [],
      start: { x: 0, y: 0 },
      finish: null,
    },
  }).document;
}

function terrainCells(doc: MapDocumentV5): string[] {
  const l = doc.layers.find((x) => x.id === "lyr-terrain");
  if (!l || l.kind !== "terrain" || l.representation !== "cells") throw new Error("no terrain");
  return (l as TerrainCellLayer).cells.map((c) => `${c.x},${c.y}`);
}

describe("fixConnectivityV5", () => {
  it("пробивает коридор и возвращает cleared для erase-batch", () => {
    const doc = dungeonDoc();
    const res = fixConnectivityV5(doc);
    expect(res).not.toBeNull();
    expect(res!.cleared.length).toBeGreaterThan(0);
    expect(res!.fixed).toBeGreaterThan(0);
    // Применяем как erase к default через Core — документ валиден.
    const layer = doc.layers.find((l) => l.id === "lyr-terrain");
    const applied = applyTerrainCellEdits(doc, "lyr-terrain", res!.cleared.map((c) => ({ ...c, material: null })));
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    expect(validateMapDocument(applied.document)).toEqual([]);
    for (const c of res!.cleared) {
      expect(terrainCells(applied.document)).not.toContain(`${c.x},${c.y}`);
    }
    // Повторно чинить нечего.
    expect(fixConnectivityV5(applied.document)).toEqual({ cleared: [], fixed: 0 });
  });

  it("без комнат — null; вход не мутируется", () => {
    const doc = dungeonDoc();
    const noRooms: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l) =>
        l.kind === "gameplay" ? { ...l, items: l.items.filter((e) => e.kind !== "room") } : l,
      ),
    };
    const before = structuredClone(noRooms);
    expect(fixConnectivityV5(noRooms)).toBeNull();
    expect(noRooms).toEqual(before);
  });
});
