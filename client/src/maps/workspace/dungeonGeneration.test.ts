import { describe, expect, it } from "vitest";
import { createGameplayToken, parseMapDocumentV6, putGameplayToken, serializeMapDocumentV6, tokensOf, validateMapDocumentV6 } from "@shared/maps/core";
import { dungeonReachable, generateDungeon } from "../dungeon";
import { createDoor, paintSegment } from "./editorCommands";
import { buildDungeonDocument, DUNGEON_PRESETS, floorOutlines, replaceWithDungeon } from "./dungeonGeneration";
import { CRYPT_PACK } from "../assets/crypt";

const settings = { ...DUNGEON_PRESETS[1], seed: 1742 };
describe("workspace dungeon generation", () => {
  it("reproduces geometry and stable IDs; appearance does not change topology", () => {
    const one = buildDungeonDocument(settings, "blueprint"), two = buildDungeonDocument(settings, "paper-ink");
    expect(buildDungeonDocument(settings, "blueprint")).toEqual(one);
    expect({ ...one, appearance: undefined }).toEqual({ ...two, appearance: undefined });
    expect(buildDungeonDocument({ ...settings, seed: settings.seed + 1 }, "blueprint").layers).not.toEqual(one.layers);
    expect(validateMapDocumentV6(two)).toEqual([]);
    expect(parseMapDocumentV6(serializeMapDocumentV6(two))).toEqual({ ok: true, value: two });
  });
  it("keeps the existing connected algorithm across presets and seeds", () => {
    for (const preset of DUNGEON_PRESETS) for (const seed of [0, 1, 1742, 2147483647]) {
      const cells = generateDungeon(preset.width, preset.height, { ...preset, seed });
      const grid = Array.from({ length: preset.height }, (_, y) => Array.from({ length: preset.width }, (_, x) => cells.terrain.has(`${x},${y}`) ? 0 : 1));
      const floors = grid.flat().filter((n) => n === 1).length;
      expect(dungeonReachable(grid, cells.start).size).toBe(floors);
      expect(validateMapDocumentV6(buildDungeonDocument({ ...preset, seed }, "paper-ink"))).toEqual([]);
    }
  });
  it("rejects invalid bounds/parameters and never calls an unbounded generator", () => {
    for (const patch of [{ width: 0 }, { height: 101 }, { width: Infinity }, { seed: NaN }, { seed: -1 }, { seed: 2147483648 }, { rooms: 31 }, { rooms: 2 }, { loops: 101 }, { loops: 1.2 }]) {
      expect(() => buildDungeonDocument({ ...settings, ...patch }, "blueprint")).toThrow(/параметры/);
    }
    expect(validateMapDocumentV6({ ...buildDungeonDocument(settings, "blueprint"), appearance: { style: "future" } })).toEqual(expect.arrayContaining([expect.objectContaining({ code: "appearance.unsupported" })]));
  });
  it("replacement retains complete token layers, source identity, assets and protected state without collisions", () => {
    const generated = buildDungeonDocument(settings, "blueprint");
    const gp = generated.layers.find((layer) => layer.kind === "gameplay")!;
    const existingRoomId = gp.kind === "gameplay" ? gp.items[0].id : "";
    let before = putGameplayToken(generated, gp.id, createGameplayToken("manual", { kind: "being", uid: "11111111-1111-4111-8111-111111111111" }, { x: 4.5, y: 5.5 }));
    before = { ...before, layers: before.layers.map((layer) => layer.id === gp.id && layer.kind === "gameplay"
      ? { ...layer, locked: true, visible: false, opacity: 0.4, items: layer.items.map((item) => item.kind === "token" ? { ...item, id: existingRoomId } : item).filter((item) => item.kind === "token") } : layer),
      assetPacks: [{ id: "test-assets", version: "1" }], exploration: { enabled: true, revealedCells: [{ x: 2, y: 3 }] } };
    const raw = serializeMapDocumentV6(before);
    const next = replaceWithDungeon(before, generated);
    expect(serializeMapDocumentV6(before)).toBe(raw);
    expect(tokensOf(next)).toEqual(tokensOf(before));
    expect(next.layers.at(-1)).toEqual(before.layers.find((layer) => layer.id === gp.id));
    expect(next.exploration).toEqual({ enabled: true, revealedCells: [] });
    expect(next.assetPacks).toEqual([...before.assetPacks, CRYPT_PACK]);
    expect(validateMapDocumentV6(next)).toEqual([]);
    const ids = next.layers.flatMap((layer) => [layer.id, ...(layer.kind === "gameplay" ? layer.items.map((item) => item.id) : [])]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(parseMapDocumentV6(serializeMapDocumentV6(next))).toEqual({ ok: true, value: next });
  });
  it("draws walls as masonry lines around the floor, not as rock cells", () => {
    // Г-образный пол и отдельная клетка, касающаяся его углом: два контура, только углы.
    const cells = new Set(["0,0", "1,0", "0,1", "2,1"]);
    const loops = floorOutlines((x, y) => cells.has(`${x},${y}`), 4, 3);
    expect(loops).toEqual([
      [{ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }, { x: 0, y: 2 }],
      [{ x: 2, y: 1 }, { x: 3, y: 1 }, { x: 3, y: 2 }, { x: 2, y: 2 }],
    ]);
    const doc = buildDungeonDocument(settings, "comic-punk");
    const terrain = doc.layers.find((layer) => layer.kind === "terrain")!, walls = doc.layers.find((layer) => layer.name === "Стены")!;
    const legacy = generateDungeon(settings.width, settings.height, settings);
    if (terrain.kind !== "terrain" || terrain.representation !== "cells" || walls.kind !== "path") throw new Error("unexpected layers");
    expect(terrain.cells.some((cell) => cell.material.type === "builtin" && cell.material.key === "terrain/wall")).toBe(false);
    expect(terrain.cells.length).toBe(settings.width * settings.height - legacy.terrain.size);
    expect(walls.paths.length).toBeGreaterThan(0);
    expect(walls.paths.every((path) => path.kind === "wall" && path.properties?.closed === true)).toBe(true);
    expect(doc.assetPacks).toContainEqual(CRYPT_PACK);
  });
  it("refuses replacement with a different grid or size, and generated rooms/doors remain editable", () => {
    const doc = buildDungeonDocument(settings, "paper-ink"), gp = doc.layers.find((layer) => layer.kind === "gameplay")!;
    expect(() => replaceWithDungeon(doc, buildDungeonDocument({ ...settings, width: 32 }, "blueprint"))).toThrow(/того же размера/);
    expect(() => replaceWithDungeon({ ...doc, grid: { ...doc.grid!, type: "hex" } }, doc)).toThrow(/квадратной/);
    const terrain = doc.layers.find((layer) => layer.kind === "terrain")!;
    let edited = paintSegment(doc, terrain.id, { x: 3.5, y: 3.5 }, { x: 5.5, y: 3.5 }, "stone");
    edited = createDoor(edited, gp.id, "manual-door", { x: 4.5, y: 3 }, true, 0);
    expect(edited.appearance).toEqual(doc.appearance);
    expect(validateMapDocumentV6(edited)).toEqual([]);
  });
});
