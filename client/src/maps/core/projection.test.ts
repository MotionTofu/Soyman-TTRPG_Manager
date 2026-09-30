// Player projection tests (§53 ТЗ).

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import { projectMapDocumentForPlayer } from "./playerProjection";
import { createTerrainMaskLayer } from "./mutations/layers";
import { createSplinePath } from "./mutations/paths";
import { splineFromAnchors } from "./spline";
import { paintTerrainMask, readTerrainMaskAt } from "./mutations/terrainMask";
import { serializeMapDocument } from "./serialize";
import type { GameplayDoor, GameplayLayer, GameplayRoom, MapDocumentV5 } from "./types";
import { validateMapDocument } from "./validate";

function gmDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

function gameplay(doc: MapDocumentV5): GameplayLayer {
  const g = doc.layers.find((l) => l.id === "lyr-gameplay");
  if (!g || g.kind !== "gameplay") throw new Error("no gameplay");
  return g;
}

describe("projectMapDocumentForPlayer", () => {
  it("shows spline branches without sending their editor attachment metadata", () => {
    const parent = createSplinePath(gmDoc(), "lyr-road", {
      id: "parent-visible", kind: "road", width: 0.22,
      styleRef: { type: "builtin", key: "road" },
      nodes: [{ position: { x: 1.2, y: 1.4 } }, { position: { x: 2.2, y: 1.4 } }],
    });
    if (!parent.ok) throw new Error("fixture failed");
    const child = createSplinePath(parent.document, "lyr-road", {
      id: "branch-visible", kind: "road", width: 0.22,
      styleRef: { type: "builtin", key: "road" },
      branchFrom: { pathId: "parent-visible", nodeIndex: 0 },
      nodes: [{ position: { x: 1.2, y: 1.4 } }, { position: { x: 1.2, y: 2.4 } }],
    });
    if (!child.ok) throw new Error("fixture failed");
    const master = child.document.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .find((path) => path.id === "branch-visible");
    expect(master?.branchFrom).toEqual({ pathId: "parent-visible", nodeIndex: 0 });
    const player = projectMapDocumentForPlayer(child.document);
    const branch = player.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .find((path) => path.id === "branch-visible");
    expect(branch?.branchFrom).toBeUndefined();
    expect(branch?.geometry).toEqual(master?.geometry);
  });

  it("clips a curved road to explored cells without exposing its hidden bend", () => {
    const created = createSplinePath(gmDoc(), "lyr-road", {
      id: "curved-road", kind: "road", width: 0.22,
      styleRef: { type: "builtin", key: "road" },
      nodes: splineFromAnchors([{ x: 1.2, y: 1.4 }, { x: 2.5, y: 2.4 }, { x: 3.8, y: 1.4 }])
        .map((node, index) => ({ ...node, width: 0.2 + index * 0.2 })),
    });
    if (!created.ok) throw new Error("fixture failed");
    const player = projectMapDocumentForPlayer({ ...created.document,
      exploration: { enabled: true, revealedCells: [{ x: 1, y: 1 }] } });
    const fragments = player.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .filter((path) => path.id.startsWith("curved-road:player:"));
    expect(fragments.length).toBeGreaterThan(0);
    expect(fragments.every((path) => path.geometry.type === "spline" &&
      path.geometry.nodes.every((node) => node.position.x <= 2.001 && node.position.y <= 2.001)))
      .toBe(true);
    expect(fragments.some((path) => path.geometry.type === "spline" &&
      path.geometry.nodes.some((node) => (node.width ?? 0) > 0.2))).toBe(true);
    expect(validateMapDocument(player)).toEqual([]);
  });

  it("передаёт только раскрытые участки свободной дороги на квадратной карте", () => {
    const created = createSplinePath(gmDoc(), "lyr-road", {
      id: "free-road-projection", kind: "road", width: 0.22,
      styleRef: { type: "builtin", key: "road" },
      nodes: [{ position: { x: 1.2, y: 1.4 } }, { position: { x: 3.8, y: 1.4 } }],
    });
    if (!created.ok) throw new Error("fixture failed");
    const doc: MapDocumentV5 = { ...created.document,
      exploration: { enabled: true, revealedCells: [{ x: 1, y: 1 }] } };
    const player = projectMapDocumentForPlayer(doc);
    const roads = player.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .filter((path) => path.id.startsWith("free-road-projection:"));
    expect(roads).toHaveLength(1);
    expect(roads[0].geometry.type).toBe("spline");
    if (roads[0].geometry.type !== "spline") throw new Error("expected spline");
    expect(roads[0].geometry.nodes.every((node) =>
      node.position.x >= 1 && node.position.x < 2 && node.position.y === 1.4)).toBe(true);
    expect(roads[0].geometry.nodes.at(-1)!.position.x).toBeGreaterThan(1.999);
    expect(validateMapDocument(player)).toEqual([]);
    const adjacent = projectMapDocumentForPlayer({ ...created.document,
      exploration: { enabled: true, revealedCells: [{ x: 1, y: 1 }, { x: 2, y: 1 }] } });
    const fragments = adjacent.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .filter((path) => path.id.startsWith("free-road-projection:"));
    expect(fragments).toHaveLength(2);
    if (fragments[0].geometry.type !== "spline" || fragments[1].geometry.type !== "spline")
      throw new Error("expected splines");
    const leftEnd = fragments[0].geometry.nodes.at(-1)!.position.x;
    const rightStart = fragments[1].geometry.nodes[0].position.x;
    expect(Math.abs(leftEnd - rightStart)).toBeLessThan(0.00001);
    const fullyVisible = projectMapDocumentForPlayer({ ...created.document, exploration: { enabled: false, revealedCells: [] } });
    expect(fullyVisible.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
      .find((path) => path.id === "free-road-projection")?.geometry).toEqual(
        created.document.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : [])
          .find((path) => path.id === "free-road-projection")?.geometry);
  });

  it("скрывает закрытый участок свободной реки на гексах", () => {
    const base: MapDocumentV5 = {
      v: 5, world: { bounds: { minX: -1, minY: -1, maxX: 20, maxY: 20 } },
      grid: { type: "hex", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
      assetPacks: [], layers: [{ id: "rivers", name: "Rivers", kind: "path",
        visible: true, locked: false, opacity: 1, paths: [] }],
    };
    const created = createSplinePath(base, "rivers", {
      id: "free-river", kind: "river", width: 0.22,
      styleRef: { type: "builtin", key: "river" },
      nodes: [{ position: { x: 0.1, y: 0.1 } }, { position: { x: 3.2, y: 0.1 } }],
    });
    if (!created.ok) throw new Error("fixture failed");
    const player = projectMapDocumentForPlayer({ ...created.document,
      exploration: { enabled: true, revealedCells: [{ x: 0, y: 0 }] } });
    const rivers = player.layers.flatMap((layer) => layer.kind === "path" ? layer.paths : []);
    expect(rivers).toHaveLength(1);
    if (rivers[0].geometry.type !== "spline") throw new Error("expected spline");
    expect(rivers[0].geometry.nodes.every((node) => node.position.x < Math.sqrt(3) / 2)).toBe(true);
    expect(rivers[0].geometry.nodes.at(-1)!.position.x).toBeGreaterThan(0.865);
    expect(validateMapDocument(player)).toEqual([]);
  });

  it("передаёт игроку детальный рельеф только раскрытых клеток", () => {
    const created = createTerrainMaskLayer(gmDoc(), { id: "mask-projection", name: "Детальный рельеф" });
    if (!created.ok) throw new Error("fixture failed");
    const forest = { type: "builtin" as const, key: "terrain/forest" };
    const mountains = { type: "builtin" as const, key: "terrain/mountains" };
    const first = paintTerrainMask(created.document, "mask-projection", 1.25, 1.25, 0.2, forest, () => "chunk-a");
    if (!first.ok) throw new Error("fixture failed");
    const second = paintTerrainMask(first.document, "mask-projection", 2.25, 2.25, 0.2, mountains, () => "chunk-b");
    if (!second.ok) throw new Error("fixture failed");
    const projected = projectMapDocumentForPlayer({
      ...second.document, exploration: { enabled: true, revealedCells: [{ x: 1, y: 1 }] },
    });
    expect(readTerrainMaskAt(projected, "mask-projection", 1.25, 1.25)).toEqual(forest);
    expect(readTerrainMaskAt(projected, "mask-projection", 2.25, 2.25)).toEqual({ type: "builtin", key: "terrain/plain" });
    const layer = projected.layers.find((item) => item.id === "mask-projection");
    expect(layer?.kind === "terrain" && layer.representation === "mask" ? layer.mask.materials : null).not.toContainEqual(mountains);
    expect(validateMapDocument(projected)).toEqual([]);
  });

  it("не передаёт образец маски, пересекающий границу закрытой клетки", () => {
    const created = createTerrainMaskLayer(gmDoc(), { id: "crossing-mask", name: "Маска" });
    if (!created.ok) throw new Error("fixture failed");
    const doc = { ...created.document, layers: created.document.layers.map((layer) =>
      layer.id === "crossing-mask" && layer.kind === "terrain" && layer.representation === "mask"
        ? { ...layer, mask: { ...layer.mask, sampleSize: 0.75 } } : layer) };
    const forest = { type: "builtin" as const, key: "terrain/forest" };
    const painted = paintTerrainMask(doc, "crossing-mask", 1.125, 0.375, 0, forest, () => "crossing-chunk");
    if (!painted.ok) throw new Error("fixture failed");
    const projected = projectMapDocumentForPlayer({
      ...painted.document, exploration: { enabled: true, revealedCells: [{ x: 0, y: 0 }] },
    });
    expect(readTerrainMaskAt(projected, "crossing-mask", 1.125, 0.375)).toEqual({ type: "builtin", key: "terrain/plain" });
    const layer = projected.layers.find((item) => item.id === "crossing-mask");
    expect(layer?.kind === "terrain" && layer.representation === "mask" ? layer.mask.chunks : null).toEqual([]);
  });

  it("secret kind и secret flag удаляются", () => {
    const p = projectMapDocumentForPlayer(gmDoc());
    const doors = gameplay(p).items.filter((e): e is GameplayDoor => e.kind === "door");
    expect(doors.some((d) => d.doorKind === "secret")).toBe(false);
    expect(doors.some((d) => d.secret)).toBe(false);
    // В GM было 5 дверей (door, locked×2, secret, trapped) → осталось 4.
    expect(doors).toHaveLength(4);
  });

  it("trapped → door, остальные поля как есть", () => {
    const gm = gmDoc();
    const trappedGm = gameplay(gm).items.find(
      (e): e is GameplayDoor => e.kind === "door" && e.doorKind === "trapped",
    )!;
    const p = projectMapDocumentForPlayer(gm);
    const conv = gameplay(p).items.find((e) => e.id === trappedGm.id) as GameplayDoor;
    expect(conv.doorKind).toBe("door");
    expect(conv.position).toEqual(trappedGm.position);
    expect(conv.orientation).toBe(trappedGm.orientation);
  });

  it("traps удалены, rooms → empty с сохранением имён", () => {
    const p = projectMapDocumentForPlayer(gmDoc());
    const items = gameplay(p).items;
    expect(items.some((e) => e.kind === "trap")).toBe(false);
    const rooms = items.filter((e): e is GameplayRoom => e.kind === "room");
    expect(rooms).toHaveLength(2);
    expect(rooms.map((r) => r.roomType)).toEqual(["empty", "empty"]);
    expect(rooms[0].name).toBe("Кладовая");
  });

  it("обычные двери, маркеры, labels, start/finish — как есть", () => {
    const gm = gmDoc();
    const p = projectMapDocumentForPlayer(gm);
    const items = gameplay(p).items;
    expect(items.filter((e) => e.kind === "marker")).toHaveLength(2);
    expect(items.some((e) => e.kind === "start")).toBe(true);
    expect(items.some((e) => e.kind === "finish")).toBe(true);
    const labels = p.layers.find((l) => l.id === "lyr-labels");
    const labelsGm = gm.layers.find((l) => l.id === "lyr-labels");
    expect(labels).toEqual(labelsGm);
    // terrain/paths untouched
    expect(p.layers.find((l) => l.id === "lyr-terrain")).toEqual(gm.layers.find((l) => l.id === "lyr-terrain"));
  });

  it("висячий pairedDoorId после удаления secret-партнёра → null", () => {
    const gm = gmDoc();
    // Привязываем обычную дверь к secret-двери вручную.
    const g = gameplay(gm);
    const normal = g.items.find((e): e is GameplayDoor => e.kind === "door" && e.id === "legacy-door-0")!;
    const secret = g.items.find((e): e is GameplayDoor => e.kind === "door" && e.doorKind === "secret")!;
    normal.pairedDoorId = secret.id;
    secret.pairedDoorId = normal.id;
    const p = projectMapDocumentForPlayer(gm);
    const survivor = gameplay(p).items.find((e) => e.id === normal.id) as GameplayDoor;
    expect(survivor.pairedDoorId).toBeNull();
  });

  it("projected doc валиден", () => {
    expect(validateMapDocument(projectMapDocumentForPlayer(gmDoc()))).toEqual([]);
  });

  it("вход не мутируется", () => {
    const gm = gmDoc();
    const before = serializeMapDocument(gm);
    projectMapDocumentForPlayer(gm);
    expect(serializeMapDocument(gm)).toBe(before);
  });
});
