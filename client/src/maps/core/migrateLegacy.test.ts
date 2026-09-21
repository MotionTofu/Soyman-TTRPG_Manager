// Миграция MapCells → MapDocumentV5: скелет, террейн, пути, сущности, пары.

import { describe, expect, it } from "vitest";
import { cellCenter } from "../grid";
import type { MapCells } from "../render";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import type {
  GameplayDoor,
  GameplayLayer,
  GameplayRoom,
  LabelLayer,
  MapDocumentV5,
  PathLayer,
  TerrainCellLayer,
} from "./types";
import { validateMapDocument } from "./validate";

const W = 8;
const H = 8;

function migrate(raw: string, width = W, height = H, grid: "square" | "hex" = "square") {
  return migrateLegacyMap({ grid, width, height, cells: parseFixture(raw) });
}

function layer(doc: MapDocumentV5, id: string) {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) throw new Error(`no layer ${id}`);
  return l;
}

describe("migrateLegacyMap: skeleton", () => {
  it("даёт 7 слоёв в точном порядке с фиксированными IDs/флагами", () => {
    const { document } = migrate(FIXTURES.emptyV1);
    expect(document.v).toBe(5);
    expect(document.assetPacks).toEqual([]);
    expect(
      document.layers.map((l) => [l.id, l.kind, l.name, l.visible, l.locked, l.opacity]),
    ).toEqual([
      ["lyr-terrain", "terrain", "Terrain", true, false, 1],
      ["lyr-river", "path", "Rivers", true, false, 1],
      ["lyr-road", "path", "Roads", true, false, 1],
      ["lyr-objects", "object", "Objects", true, false, 1],
      ["lyr-scatter", "scatter", "Scatter", true, false, 1],
      ["lyr-gameplay", "gameplay", "Gameplay", true, false, 1],
      ["lyr-labels", "label", "Labels", true, false, 1],
    ]);
  });

  it("square grid: cellSize 1, bounds [0,W]x[0,H]", () => {
    const { document } = migrate(FIXTURES.emptyV1, 10, 6);
    expect(document.grid).toEqual({
      type: "square",
      cellSize: 1,
      columns: 10,
      rows: 6,
      origin: { x: 0, y: 0 },
    });
    expect(document.world.bounds).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 6 });
  });

  it("пустая карта: пустые cells/paths/items, без warnings", () => {
    const { document, warnings } = migrate(FIXTURES.emptyV1);
    expect(warnings).toEqual([]);
    const terrain = layer(document, "lyr-terrain") as TerrainCellLayer;
    expect(terrain.representation).toBe("cells");
    expect(terrain.defaultMaterial).toEqual({ type: "builtin", key: "terrain/plain" });
    expect(terrain.cells).toEqual([]);
    expect((layer(document, "lyr-road") as PathLayer).paths).toEqual([]);
    expect((layer(document, "lyr-river") as PathLayer).paths).toEqual([]);
  });

  it("мигрированный документ валиден", () => {
    for (const raw of Object.values(FIXTURES)) {
      const { document } = migrate(raw);
      expect(validateMapDocument(document)).toEqual([]);
    }
  });

  it("детерминирована: два вызова дают identical документ", () => {
    const a = migrate(FIXTURES.fullV4Square);
    const b = migrate(FIXTURES.fullV4Square);
    expect(a.document).toEqual(b.document);
    expect(a.warnings).toEqual(b.warnings);
  });
});

describe("migrateLegacyMap: terrain", () => {
  it("plain опускается, остальные — builtin:terrain/<code>, сортировка (y,x)", () => {
    const { document } = migrate(FIXTURES.terrainV1);
    const terrain = layer(document, "lyr-terrain") as TerrainCellLayer;
    expect(terrain.cells).toEqual([
      { x: 0, y: 0, material: { type: "builtin", key: "terrain/forest" } },
      { x: 2, y: 1, material: { type: "builtin", key: "terrain/mountains" } },
    ]);
  });

  it("wall мигрирует как terrain material, не spline", () => {
    const { document } = migrate(FIXTURES.dungeonV3);
    const terrain = layer(document, "lyr-terrain") as TerrainCellLayer;
    expect(terrain.cells.map((c) => [c.x, c.y, c.material])).toEqual([
      [0, 0, { type: "builtin", key: "terrain/wall" }],
      [1, 0, { type: "builtin", key: "terrain/wall" }],
      [2, 0, { type: "builtin", key: "terrain/stone" }],
    ]);
  });
});

describe("migrateLegacyMap: paths", () => {
  it("roads/rivers → один cell-network path на kind, отсортировано", () => {
    const { document } = migrate(FIXTURES.pathsV4);
    const road = layer(document, "lyr-road") as PathLayer;
    const river = layer(document, "lyr-river") as PathLayer;
    expect(road.paths).toEqual([
      {
        id: "legacy-path-road",
        kind: "road",
        geometry: { type: "cell-network", cells: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }] },
        width: 1,
        styleRef: { type: "builtin", key: "road" },
      },
    ]);
    expect(river.paths).toEqual([
      {
        id: "legacy-path-river",
        kind: "river",
        geometry: { type: "cell-network", cells: [{ x: 0, y: 1 }, { x: 1, y: 1 }] },
        width: 1,
        styleRef: { type: "builtin", key: "river" },
      },
    ]);
  });
});

describe("migrateLegacyMap: labels/gameplay", () => {
  it("labels: позиция = cellCenter, IDs legacy-label-N", () => {
    const { document } = migrate(FIXTURES.labelsV2);
    const labels = layer(document, "lyr-labels") as LabelLayer;
    expect(labels.items).toEqual([
      { id: "legacy-label-0", position: { x: 1.5, y: 1.5 }, text: "Тёмный лес" },
      { id: "legacy-label-1", position: { x: 3.5, y: 0.5 }, text: "Брод" },
    ]);
  });

  it("rooms: rect как есть, тип и имя сохранены", () => {
    const { document } = migrate(FIXTURES.dungeonV3);
    const g = layer(document, "lyr-gameplay") as GameplayLayer;
    const room = g.items[0] as GameplayRoom;
    expect(room).toEqual({
      id: "legacy-room-0",
      kind: "room",
      geometry: { type: "rect", x: 2, y: 0, w: 2, h: 2 },
      roomType: "treasury",
      name: "Кладовая",
    });
  });

  it("doors: edge-midpoint + orientation, kind/secret как есть", () => {
    const cells: MapCells = {
      terrain: new Map(),
      roads: new Set(),
      rivers: new Set(),
      labels: [],
      rooms: [],
      doors: [
        { x: 2, y: 3, edge: "n", kind: "door", secret: false, pair: null },
        { x: 2, y: 3, edge: "s", kind: "locked", secret: false, pair: null },
        { x: 2, y: 3, edge: "w", kind: "secret", secret: true, pair: null },
        { x: 2, y: 3, edge: "e", kind: "trapped", secret: false, pair: null },
      ],
      traps: [],
      markers: [],
      start: null,
      finish: null,
    };
    const { document } = migrateLegacyMap({ grid: "square", width: 8, height: 8, cells });
    const g = layer(document, "lyr-gameplay") as GameplayLayer;
    const doors = g.items as GameplayDoor[];
    expect(doors.map((d) => [d.position, d.orientation, d.doorKind, d.secret, d.pairedDoorId])).toEqual([
      [{ x: 2.5, y: 3 }, 0, "door", false, null],
      [{ x: 2.5, y: 4 }, 180, "locked", false, null],
      [{ x: 2, y: 3.5 }, 270, "secret", true, null],
      [{ x: 3, y: 3.5 }, 90, "trapped", false, null],
    ]);
  });

  it("traps/markers/start/finish: cellCenter + stable IDs, порядок gameplay", () => {
    const { document } = migrate(FIXTURES.fullV4Square);
    const g = layer(document, "lyr-gameplay") as GameplayLayer;
    expect(g.items.map((e) => [e.kind, e.id])).toEqual([
      ["room", "legacy-room-0"],
      ["room", "legacy-room-1"],
      ["door", "legacy-door-0"],
      ["door", "legacy-door-1"],
      ["door", "legacy-door-2"],
      ["door", "legacy-door-3"],
      ["door", "legacy-door-4"],
      ["trap", "legacy-trap-0"],
      ["marker", "legacy-marker-0"],
      ["marker", "legacy-marker-1"],
      ["start", "legacy-start"],
      ["finish", "legacy-finish"],
    ]);
    const trap = g.items[7];
    expect(trap).toMatchObject({ position: { x: 3.5, y: 1.5 }, trapKind: "arrow" });
  });
});

describe("migrateLegacyMap: door pairs", () => {
  function doorsOf(raw: string) {
    const { document } = migrate(raw);
    return (layer(document, "lyr-gameplay") as GameplayLayer).items.filter(
      (e): e is GameplayDoor => e.kind === "door",
    );
  }

  it("пара из 2 → взаимные pairedDoorId, без warnings", () => {
    const { warnings } = migrate(FIXTURES.pair);
    const doors = doorsOf(FIXTURES.pair);
    expect(doors[0].pairedDoorId).toBe("legacy-door-1");
    expect(doors[1].pairedDoorId).toBe("legacy-door-0");
    expect(warnings).toEqual([]);
  });

  it("одиночка → null + dangling warning", () => {
    const { warnings } = migrate(FIXTURES.pairSingle);
    const doors = doorsOf(FIXTURES.pairSingle);
    expect(doors[0].pairedDoorId).toBeNull();
    expect(warnings).toEqual([
      {
        code: "dangling-pair-token",
        token: "ghost",
        doorIds: ["legacy-door-0"],
        message: expect.any(String),
      },
    ]);
  });

  it("группа из 5 → последовательные пары + остаток null + oversized warning", () => {
    const { warnings } = migrate(FIXTURES.pairBig);
    const doors = doorsOf(FIXTURES.pairBig);
    expect(doors.map((d) => d.pairedDoorId)).toEqual([
      "legacy-door-1",
      "legacy-door-0",
      "legacy-door-3",
      "legacy-door-2",
      null,
    ]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].code).toBe("oversized-pair-group");
    expect(warnings[0].token).toBe("mob");
  });

  it("обычная карта без пар — без warnings", () => {
    expect(migrate(FIXTURES.fullV4Square).warnings).toEqual([]);
  });
});

describe("migrateLegacyMap: hex", () => {
  it("grid hex pointy/odd-q, bounds = bbox углов клеток", () => {
    const { document } = migrate(FIXTURES.fullV4Hex, 6, 6, "hex");
    expect(document.grid).toMatchObject({
      type: "hex",
      cellSize: 1,
      columns: 6,
      rows: 6,
      hex: { orientation: "pointy", offset: "odd-q" },
    });
    const b = document.world.bounds;
    expect(b.maxX).toBeGreaterThan(b.minX);
    expect(b.maxY).toBeGreaterThan(b.minY);
    // Регрессия: bounds = точный bbox cellCorners поля 6x6 (без запаса
    // worldBounds: углы гекса (0,0) дают minX=-√3/2, minY=-1; правый край
    // нечётных рядов x=5 даёт maxX=√3*6; низ ряда y=5 даёт maxY=8.5).
    const SQRT3 = Math.sqrt(3);
    expect(b.minX).toBeCloseTo(-SQRT3 / 2, 10);
    expect(b.minY).toBeCloseTo(-1, 10);
    expect(b.maxX).toBeCloseTo(SQRT3 * 6, 10);
    expect(b.maxY).toBeCloseTo(8.5, 10);
  });

  it("hex-позиции = cellCenter hex", () => {
    const { document } = migrate(FIXTURES.fullV4Hex, 6, 6, "hex");
    const labels = layer(document, "lyr-labels") as LabelLayer;
    const c = cellCenter("hex", 2, 2);
    expect(labels.items[0].position).toEqual({ x: c.cx, y: c.cy });
  });
});
