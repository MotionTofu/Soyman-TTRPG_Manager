// Player projection tests (§53 ТЗ).

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import { projectMapDocumentForPlayer } from "./playerProjection";
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
