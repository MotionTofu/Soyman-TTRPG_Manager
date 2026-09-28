/**
 * Shared kernel smoke: один и тот же код parse/validate/serialize/project,
 * который используют client (исходники) и server (dist). Node-окружение —
 * доказательство отсутствия DOM/React-зависимостей (§41 ТЗ 2F).
 */
import { describe, expect, it } from "vitest";
import { canonicalizeMapDocument } from "./canonicalize";
import {
  MAP_DOOR_KINDS,
  MAP_MARKER_KINDS,
  MAP_ROOM_TYPES,
  MAP_TERRAIN_CODES,
  MAP_TRAP_KINDS,
} from "./literals";
import { parseMapDocument } from "./parse";
import { projectMapDocumentForPlayer } from "./playerProjection";
import { serializeMapDocument } from "./serialize";
import { parseStoredMapDocument } from "./storedDocument";
import type { MapDocumentV5 } from "./types";
import { validateMapDocument } from "./validate";

function gmDoc(): MapDocumentV5 {
  return {
    v: 5,
    world: { bounds: { minX: 0, minY: 0, maxX: 4, maxY: 3 } },
    grid: { type: "square", cellSize: 1, columns: 4, rows: 3, origin: { x: 0, y: 0 } },
    assetPacks: [],
    layers: [
      {
        id: "lyr-terrain",
        name: "Terrain",
        kind: "terrain",
        visible: true,
        locked: false,
        opacity: 1,
        representation: "cells",
        defaultMaterial: { type: "builtin", key: "terrain/plain" },
        cells: [{ x: 1, y: 1, material: { type: "builtin", key: "terrain/forest" } }],
      },
      {
        id: "lyr-gameplay",
        name: "Gameplay",
        kind: "gameplay",
        visible: true,
        locked: false,
        opacity: 1,
        items: [
          {
            id: "door-1",
            kind: "door",
            position: { x: 1.5, y: 0 },
            orientation: 0,
            doorKind: "secret",
            secret: true,
            pairedDoorId: null,
          },
          { id: "trap-1", kind: "trap", position: { x: 2, y: 2 }, trapKind: "pit" },
          {
            id: "room-1",
            kind: "room",
            geometry: { type: "rect", x: 0, y: 0, w: 2, h: 2 },
            roomType: "treasury",
            name: "Кладовая",
          },
        ],
      },
    ],
  };
}

describe("shared kernel", () => {
  it("parse → validate → serialize roundtrip", () => {
    const doc = gmDoc();
    const s = serializeMapDocument(doc);
    const parsed = parseMapDocument(s);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateMapDocument(parsed.value)).toEqual([]);
    expect(serializeMapDocument(parsed.value)).toBe(s);
  });

  it("projection shared: secret/trap убраны, комната empty+имя, валидна", () => {
    const projected = projectMapDocumentForPlayer(gmDoc());
    expect(validateMapDocument(projected)).toEqual([]);
    const gameplay = projected.layers.find((l) => l.id === "lyr-gameplay");
    expect(gameplay && gameplay.kind === "gameplay" && gameplay.items.map((e) => e.id)).toEqual([
      "room-1",
    ]);
    const room = gameplay && gameplay.kind === "gameplay" && gameplay.items[0];
    expect(room && room.kind === "room" && room.roomType).toBe("empty");
    expect(room && room.kind === "room" && room.name).toBe("Кладовая");
  });

  it("fog: игрок получает только раскрытые клетки, мастерский документ сохраняется", () => {
    const doc = gmDoc();
    doc.exploration = { enabled: true, revealedCells: [{ x: 1, y: 1 }] };
    const terrain = doc.layers[0];
    if (terrain.kind !== "terrain" || terrain.representation !== "cells") throw new Error("fixture");
    terrain.cells.push({ x: 2, y: 1, material: { type: "builtin", key: "terrain/mountains" } });
    doc.layers.push({ id: "labels", kind: "label", name: "Labels", visible: true, locked: false, opacity: 1,
      items: [{ id: "visible-label", position: { x: 1.5, y: 1.5 }, text: "Тропа" },
        { id: "hidden-label", position: { x: 2.5, y: 1.5 }, text: "Тайник" }] });
    const before = serializeMapDocument(doc);
    const player = projectMapDocumentForPlayer(doc);
    expect(validateMapDocument(player)).toEqual([]);
    const raw = serializeMapDocument(player);
    expect(raw).toContain('"terrain/forest"');
    expect(raw).toContain('"visible-label"');
    expect(raw).not.toContain('"terrain/mountains"');
    expect(raw).not.toContain("Тайник");
    expect(raw).not.toContain("Кладовая");
    expect(serializeMapDocument(doc)).toBe(before);
    expect(parseMapDocument(raw).ok).toBe(true);
  });

  it("fog: гекс попадает в раскрытую клетку по геометрии сетки", () => {
    const doc = gmDoc();
    doc.grid = { type: "hex", cellSize: 1, columns: 4, rows: 3, origin: { x: 0, y: 0 },
      hex: { orientation: "pointy", offset: "odd-q" } };
    doc.exploration = { enabled: true, revealedCells: [{ x: 1, y: 1 }] };
    doc.layers.push({ id: "hex-markers", kind: "gameplay", name: "Markers", visible: true, locked: false, opacity: 1,
      items: [{ id: "revealed-marker", kind: "marker", position: { x: Math.sqrt(3) * 1.5, y: 1.5 }, markerKind: "city" },
        { id: "hidden-marker", kind: "marker", position: { x: Math.sqrt(3) * 2.5, y: 1.5 }, markerKind: "village" }] });
    const projected = projectMapDocumentForPlayer(doc);
    const raw = serializeMapDocument(projected);
    expect(raw).toContain("revealed-marker");
    expect(raw).not.toContain("hidden-marker");
  });

  it("fog: повторные и внекартные клетки отвергаются", () => {
    const doc = gmDoc();
    doc.exploration = { enabled: true, revealedCells: [{ x: 1, y: 1 }, { x: 1, y: 1 }, { x: 9, y: 0 }] };
    const codes = validateMapDocument(doc).map((issue) => issue.code);
    expect(codes).toContain("exploration.duplicate-cell");
    expect(codes).toContain("exploration.bad-cell");
  });

  it("canonical ordering: порядок входа не влияет на выход", () => {
    const a = structuredClone(gmDoc());
    const b = structuredClone(gmDoc());
    const extra = { x: 0, y: 0, material: { type: "builtin", key: "terrain/hills" } } as const;
    const ta = a.layers[0];
    const tb = b.layers[0];
    if (ta.kind === "terrain" && ta.representation === "cells") ta.cells.push({ ...extra });
    if (tb.kind === "terrain" && tb.representation === "cells") {
      tb.cells.unshift({ ...extra });
    }
    expect(serializeMapDocument(a)).toBe(serializeMapDocument(b));
  });

  it("stored format detection: v5 vs legacy vs corrupt", () => {
    expect(parseStoredMapDocument(serializeMapDocument(gmDoc())).format).toBe("v5");
    expect(parseStoredMapDocument(JSON.stringify({ v: 4, cells: {}, roads: [] })).format).toBe("legacy");
    expect(parseStoredMapDocument("garbage{{{").format).toBe("legacy");
    expect(parseStoredMapDocument(JSON.stringify({ v: 6 })).format).toBe("legacy");
  });

  it("literals contract: канонические наборы зафиксированы", () => {
    expect(MAP_TERRAIN_CODES).toHaveLength(18);
    expect([...MAP_TERRAIN_CODES]).toEqual([
      "deep_water", "shallow_water", "plain", "forest", "hills", "mountains",
      "desert", "ice", "swamp", "lava", "acid", "poison", "wall",
      "stone", "wood", "earth", "darkness", "necro",
    ]);
    expect([...MAP_ROOM_TYPES]).toEqual(["empty", "barracks", "temple", "treasury", "prison", "lab"]);
    expect([...MAP_DOOR_KINDS]).toEqual(["arch", "door", "locked", "trapped", "secret", "portc"]);
    expect([...MAP_TRAP_KINDS]).toEqual(["pit", "arrow", "gas", "glyph"]);
    expect([...MAP_MARKER_KINDS]).toEqual([
      "chest", "altar", "city", "village", "camp", "metro", "battle", "obelisk",
    ]);
  });
});
