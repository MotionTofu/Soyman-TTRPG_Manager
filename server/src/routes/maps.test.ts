import { describe, it, expect } from "vitest";
import {
  validateMapCreate,
  validateCellsBlob,
  MAP_SCALE_PRESETS,
  emptyCellsBlob,
} from "./mapsValidation";

// Чистая валидация без импорта роутера/db (у них побочный эффект —
// открытие базы): тот же приём, что storages.test.ts.
const noParents = () => false;

describe("maps create validation", () => {
  it("подставляет дефолты пресета", () => {
    const r = validateMapCreate({ name: "Эстария", grid: "hex", scale: "region" }, noParents);
    expect("value" in r).toBe(true);
    if ("value" in r) {
      expect(r.value.width).toBe(60);
      expect(r.value.height).toBe(44);
      expect(r.value.cell_lore).toBe("2 км");
      expect(r.value.player_visible).toBe(0);
      expect(r.value.parent_map_id).toBe(null);
    }
  });

  it("требует имя", () => {
    expect(validateMapCreate({ name: "  ", grid: "square", scale: "planet" }, noParents)).toMatchObject({
      error: "name is required",
    });
  });

  it("режет сетку и масштаб", () => {
    expect(validateMapCreate({ name: "x", grid: "tri", scale: "planet" }, noParents)).toMatchObject({
      error: "grid must be 'square' or 'hex'",
    });
    expect(validateMapCreate({ name: "x", grid: "hex", scale: "galaxy" }, noParents)).toMatchObject({
      error: expect.stringContaining("scale must be one of"),
    });
  });

  it("режет границы сторон", () => {
    expect(
      validateMapCreate({ name: "x", grid: "hex", scale: "planet", width: 7, height: 18 }, noParents)
    ).toMatchObject({ error: expect.stringContaining("width") });
    expect(
      validateMapCreate({ name: "x", grid: "hex", scale: "planet", width: 24, height: 101 }, noParents)
    ).toMatchObject({ error: expect.stringContaining("height") });
  });

  it("режет ползунки генератора", () => {
    expect(
      validateMapCreate({ name: "x", grid: "hex", scale: "planet", sea: 10 }, noParents)
    ).toMatchObject({ error: expect.stringContaining("sea") });
    expect(
      validateMapCreate({ name: "x", grid: "hex", scale: "planet", mountains: 50 }, noParents)
    ).toMatchObject({ error: expect.stringContaining("mountains") });
    expect(validateMapCreate({ name: "x", grid: "hex", scale: "planet", forest: -1 }, noParents)).toMatchObject({
      error: expect.stringContaining("forest"),
    });
  });

  it("режет несуществующего родителя", () => {
    expect(
      validateMapCreate({ name: "x", grid: "hex", scale: "planet", parent_map_id: 999 }, noParents)
    ).toMatchObject({ error: "parent map not found" });
  });

  it("принимает существующего родителя", () => {
    const r = validateMapCreate(
      { name: "x", grid: "hex", scale: "planet", parent_map_id: 3 },
      (id) => id === 3
    );
    expect("value" in r && r.value.parent_map_id).toBe(3);
  });
});

describe("maps cells blob validation", () => {
  it("пустой blob валиден", () => {
    expect(validateCellsBlob(JSON.stringify(emptyCellsBlob()), 24, 18)).toBe(null);
  });

  it("режет мусор", () => {
    expect(validateCellsBlob("not json", 24, 18)).toBe("cells must be valid JSON");
    expect(validateCellsBlob(JSON.stringify({ v: 99, cells: {}, roads: [] }), 24, 18)).toBe(
      "cells.v must be 1, 2, 3 or 4"
    );
  });

  it("режет неизвестный террейн и выход за границы", () => {
    expect(
      validateCellsBlob(JSON.stringify({ v: 1, cells: { "0,0": "void" }, roads: [] }), 24, 18)
    ).toBe("cell 0,0 has unknown terrain");
    expect(
      validateCellsBlob(JSON.stringify({ v: 1, cells: { "24,0": "forest" }, roads: [] }), 24, 18)
    ).toBe("cell 24,0 out of bounds");
    expect(
      validateCellsBlob(JSON.stringify({ v: 1, cells: {}, roads: ["5,99"] }), 24, 18)
    ).toBe("road 5,99 out of bounds");
  });

  it("принимает террейн и дорогу в границах", () => {
    const blob = JSON.stringify({ v: 1, cells: { "0,0": "forest", "23,17": "swamp" }, roads: ["1,1"] });
    expect(validateCellsBlob(blob, 24, 18)).toBe(null);
  });

  it("принимает опасные воды пакета D", () => {
    const blob = JSON.stringify({ v: 1, cells: { "0,0": "lava", "1,0": "acid", "2,0": "poison" }, roads: [] });
    expect(validateCellsBlob(blob, 24, 18)).toBe(null);
  });

  it("принимает стену данжа пакета C", () => {
    const blob = JSON.stringify({ v: 1, cells: { "0,0": "wall", "1,0": "wall" }, roads: [] });
    expect(validateCellsBlob(blob, 24, 18)).toBe(null);
  });
});

describe("maps cells blob v2 labels (P2-2)", () => {
  it("v1 без подписей валиден как раньше", () => {
    expect(validateCellsBlob(JSON.stringify({ v: 1, cells: {}, roads: [] }), 24, 18)).toBe(null);
  });
  it("принимает подписи в границах", () => {
    const blob = JSON.stringify({
      v: 2,
      cells: {},
      roads: [],
      labels: [{ x: 0, y: 0, text: "Вотердип" }],
    });
    expect(validateCellsBlob(blob, 24, 18)).toBe(null);
  });
  it("режет плохие подписи", () => {
    const bad = (labels: unknown) => validateCellsBlob(JSON.stringify({ v: 2, cells: {}, roads: [], labels }), 24, 18);
    expect(bad("nope")).toBe("cells.labels must be an array");
    expect(bad([{ x: 0, y: 0, text: "   " }])).toBe("label 0 has bad text");
    expect(bad([{ x: 0, y: 0, text: "x".repeat(65) }])).toBe("label 0 has bad text");
    expect(bad([{ x: 99, y: 0, text: "Далеко" }])).toBe("label 0 out of bounds");
    expect(bad([{ x: 0.5, y: 0, text: "Дробь" }])).toBe("label 0 has bad coordinates");
    expect(bad(new Array(201).fill({ x: 0, y: 0, text: "Тесно" }))).toBe("too many labels (max 200)");
  });
});

describe("maps thumbnail validation (P0-6)", () => {
  const base = { name: "x", grid: "hex", scale: "planet" } as const;
  it("принимает PNG data URL", () => {
    const r = validateMapCreate({ ...base, thumbnail: "data:image/png;base64,iVBORw0KGgo=" }, noParents);
    expect("value" in r && r.value.thumbnail).toBe("data:image/png;base64,iVBORw0KGgo=");
  });
  it("режет чужеродные строки и мусор", () => {
    expect(validateMapCreate({ ...base, thumbnail: 'x"); display:none;' }, noParents)).toMatchObject({
      error: "thumbnail must be a PNG data URL",
    });
    expect(validateMapCreate({ ...base, thumbnail: "data:image/svg+xml;base64,PHN2Zz4=" }, noParents)).toMatchObject({
      error: "thumbnail must be a PNG data URL",
    });
    expect(validateMapCreate({ ...base, thumbnail: "data:image/png;base64,!!!" }, noParents)).toMatchObject({
      error: "thumbnail must be a PNG data URL",
    });
    expect(validateMapCreate({ ...base, thumbnail: "data:image/png;base64,AAA" }, noParents)).toMatchObject({
      error: "thumbnail must be a PNG data URL",
    });
  });
});

describe("maps cells blob v3 objects (пакет A)", () => {
  const v3 = (extra: Record<string, unknown>) =>
    validateCellsBlob(JSON.stringify({ v: 3, cells: {}, roads: [], ...extra }), 24, 18);
  it("пустой v3 валиден", () => {
    expect(v3({})).toBe(null);
  });
  it("принимает комнаты/двери/ловушки/старт", () => {
    expect(
      v3({
        rooms: [{ x: 1, y: 1, w: 5, h: 4, type: "temple", name: "Храм" }],
        doors: [{ x: 3, y: 1, edge: "n", kind: "locked", secret: false, pair: null }],
        traps: [{ x: 2, y: 2, kind: "pit" }],
        start: { x: 0, y: 0 },
        finish: { x: 23, y: 17 },
      })
    ).toBe(null);
  });
  it("режет плохие объекты и капы", () => {
    expect(v3({ rooms: "nope" })).toBe("cells.rooms must be an array");
    expect(v3({ rooms: [{ x: 1, y: 1, w: 0, h: 4, type: "temple", name: "" }] })).toBe("room 0 has bad geometry");
    expect(v3({ rooms: [{ x: 20, y: 1, w: 5, h: 4, type: "temple", name: "" }] })).toBe("room 0 out of bounds");
    expect(v3({ rooms: [{ x: 1, y: 1, w: 5, h: 4, type: "spaceport", name: "" }] })).toBe("room 0 has unknown type");
    expect(v3({ doors: [{ x: 1, y: 1, edge: "ne", kind: "door", secret: false, pair: null }] })).toBe("door 0 has bad edge");
    expect(v3({ doors: [{ x: 1, y: 1, edge: "n", kind: "portal", secret: false, pair: null }] })).toBe("door 0 has unknown kind");
    expect(v3({ traps: [{ x: 1, y: 1, kind: "dragon" }] })).toBe("trap 0 has unknown kind");
    expect(v3({ start: { x: 99, y: 0 } })).toBe("start out of bounds");
    expect(v3({ rooms: new Array(101).fill({ x: 0, y: 0, w: 1, h: 1, type: "empty", name: "" }) })).toBe(
      "too many rooms (max 100)"
    );
  });
});

describe("maps cells blob v4 markers+rivers (Этап A)", () => {
  const v4 = (extra: Record<string, unknown>) =>
    validateCellsBlob(JSON.stringify({ v: 4, cells: {}, roads: [], ...extra }), 24, 18);
  const v3 = (extra: Record<string, unknown>) =>
    validateCellsBlob(JSON.stringify({ v: 3, cells: {}, roads: [], ...extra }), 24, 18);
  it("пустой v4 валиден", () => {
    expect(v4({})).toBe(null);
  });
  it("принимает реки и маркеры", () => {
    expect(
      v4({
        rivers: ["0,0", "1,0"],
        markers: [
          { x: 2, y: 2, kind: "chest" },
          { x: 3, y: 3, kind: "altar" },
          { x: 4, y: 4, kind: "city" },
          { x: 5, y: 5, kind: "village" },
          { x: 6, y: 6, kind: "camp" },
          { x: 7, y: 7, kind: "metro" },
          { x: 8, y: 8, kind: "battle" },
          { x: 9, y: 9, kind: "obelisk" },
        ],
      })
    ).toBe(null);
  });
  it("режет плохие реки и маркеры", () => {
    expect(v4({ rivers: "nope" })).toBe("cells.rivers must be an array");
    expect(v4({ rivers: ["99,0"] })).toBe("river 99,0 out of bounds");
    expect(v4({ markers: "nope" })).toBe("cells.markers must be an array");
    expect(v4({ markers: [{ x: 1, y: 1, kind: "dragon" }] })).toBe("marker 0 has unknown kind");
    expect(v4({ markers: [{ x: 99, y: 0, kind: "chest" }] })).toBe("marker 0 out of bounds");
    expect(v4({ markers: [{ x: 1.5, y: 0, kind: "chest" }] })).toBe("marker 0 has bad coordinates");
    expect(v4({ markers: new Array(301).fill({ x: 0, y: 0, kind: "chest" }) })).toBe(
      "too many markers (max 300)"
    );
  });
  it("v3 с реками/маркерами — ошибка версии, а не молчаливый дроп", () => {
    expect(v3({ rivers: ["0,0"] })).toBe("cells.rivers needs v4");
    expect(v3({ markers: [{ x: 0, y: 0, kind: "chest" }] })).toBe("cells.markers needs v4");
  });
  it("новые террейны Этапа B принимаются, мусор — нет", () => {
    const cells: Record<string, string> = {
      "0,0": "stone",
      "1,0": "wood",
      "2,0": "earth",
      "3,0": "darkness",
      "4,0": "necro",
    };
    expect(validateCellsBlob(JSON.stringify({ v: 4, cells, roads: [] }), 24, 18)).toBe(null);
    expect(
      validateCellsBlob(JSON.stringify({ v: 4, cells: { "0,0": "lava_lamp" }, roads: [] }), 24, 18)
    ).toBe("cell 0,0 has unknown terrain");
  });
});

describe("maps scale presets", () => {  it("все шесть масштабов с дефолтами", () => {
    expect(Object.keys(MAP_SCALE_PRESETS).sort()).toEqual(
      ["continent", "country", "locality", "planet", "region", "settlement"].sort()
    );
    expect(MAP_SCALE_PRESETS.planet).toEqual({ width: 24, height: 18, cellLore: "500 км" });
    expect(MAP_SCALE_PRESETS.region).toEqual({ width: 60, height: 44, cellLore: "2 км" });
  });
});
