// Legacy equivalence (§51 ТЗ): миграция сохраняет legacy semantics —
// сравниваем данные до/после (террейн, дороги, реки, подписи, комнаты,
// двери, ловушки, маркеры, старт/финиш). Позиции — через ожидаемую grid math.

import { describe, expect, it } from "vitest";
import { cellCenter } from "../grid";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import type {
  GameplayDoor,
  GameplayLayer,
  GameplayMarker,
  GameplayRoom,
  GameplayTrap,
  LabelLayer,
  MapDocumentV5,
  PathLayer,
  TerrainCellLayer,
} from "./types";

function migrated(raw: string, width = 8, height = 8, grid: "square" | "hex" = "square"): MapDocumentV5 {
  return migrateLegacyMap({ grid, width, height, cells: parseFixture(raw) }).document;
}

function get<T>(doc: MapDocumentV5, id: string): T {
  const l = doc.layers.find((x) => x.id === id);
  if (!l) throw new Error(`no layer ${id}`);
  return l as unknown as T;
}

describe("equivalence square", () => {
  const src = parseFixture(FIXTURES.fullV4Square);
  const doc = migrated(FIXTURES.fullV4Square);

  it("terrain codes (кроме plain)", () => {
    const t = get<TerrainCellLayer>(doc, "lyr-terrain");
    const fromSrc = [...src.terrain.entries()]
      .filter(([, code]) => code !== "plain")
      .map(([k, code]) => `${k}=${code}`)
      .sort();
    const fromDoc = t.cells
      .map((c) => {
        const m = c.material;
        const code = m.type === "builtin" ? m.key.replace("terrain/", "") : m.assetId;
        return `${c.x},${c.y}=${code}`;
      })
      .sort();
    expect(fromDoc).toEqual(fromSrc);
  });

  it("road/river cells lossless", () => {
    const road = get<PathLayer>(doc, "lyr-road").paths[0];
    const river = get<PathLayer>(doc, "lyr-river").paths[0];
    const cellsOf = (p: (typeof road) | undefined) =>
      p && p.geometry.type === "cell-network"
        ? p.geometry.cells.map((c) => `${c.x},${c.y}`).sort()
        : [];
    expect(cellsOf(road)).toEqual([...src.roads].sort());
    expect(cellsOf(river)).toEqual([...src.rivers].sort());
  });

  it("labels: текст + cellCenter", () => {
    const labels = get<LabelLayer>(doc, "lyr-labels").items;
    expect(labels).toHaveLength(src.labels.length);
    src.labels.forEach((l, i) => {
      expect(labels[i].text).toBe(l.text);
      expect(labels[i].position).toEqual({ x: l.x + 0.5, y: l.y + 0.5 });
    });
  });

  it("rooms: геометрия/тип/имя", () => {
    const g = get<GameplayLayer>(doc, "lyr-gameplay");
    const rooms = g.items.filter((e): e is GameplayRoom => e.kind === "room");
    expect(rooms).toHaveLength(src.rooms.length);
    src.rooms.forEach((r, i) => {
      expect(rooms[i].geometry).toEqual({ type: "rect", x: r.x, y: r.y, w: r.w, h: r.h });
      expect(rooms[i].roomType).toBe(r.type);
      expect(rooms[i].name).toBe(r.name);
    });
  });

  it("doors: edge-midpoint, kind, secret", () => {
    const g = get<GameplayLayer>(doc, "lyr-gameplay");
    const doors = g.items.filter((e): e is GameplayDoor => e.kind === "door");
    expect(doors).toHaveLength(src.doors.length);
    const mid: Record<string, [number, number]> = {
      n: [0.5, 0],
      s: [0.5, 1],
      w: [0, 0.5],
      e: [1, 0.5],
    };
    src.doors.forEach((d, i) => {
      const [dx, dy] = mid[d.edge];
      expect(doors[i].position).toEqual({ x: d.x + dx, y: d.y + dy });
      expect(doors[i].doorKind).toBe(d.kind);
      expect(doors[i].secret).toBe(d.secret);
    });
  });

  it("traps/markers/start/finish: cellCenter + kinds", () => {
    const g = get<GameplayLayer>(doc, "lyr-gameplay");
    const traps = g.items.filter((e): e is GameplayTrap => e.kind === "trap");
    src.traps.forEach((t, i) => {
      expect(traps[i].position).toEqual({ x: t.x + 0.5, y: t.y + 0.5 });
      expect(traps[i].trapKind).toBe(t.kind);
    });
    const markers = g.items.filter((e): e is GameplayMarker => e.kind === "marker");
    src.markers.forEach((m, i) => {
      expect(markers[i].position).toEqual({ x: m.x + 0.5, y: m.y + 0.5 });
      expect(markers[i].markerKind).toBe(m.kind);
    });
    const start = g.items.find((e) => e.kind === "start");
    const finish = g.items.find((e) => e.kind === "finish");
    expect(start).toMatchObject({ position: { x: src.start!.x + 0.5, y: src.start!.y + 0.5 } });
    expect(finish).toMatchObject({ position: { x: src.finish!.x + 0.5, y: src.finish!.y + 0.5 } });
  });
});

describe("equivalence hex", () => {
  const src = parseFixture(FIXTURES.fullV4Hex);
  const doc = migrated(FIXTURES.fullV4Hex, 6, 6, "hex");

  it("label/marker/trap/start — hex cellCenter", () => {
    const labels = get<LabelLayer>(doc, "lyr-labels").items;
    src.labels.forEach((l, i) => {
      const c = cellCenter("hex", l.x, l.y);
      expect(labels[i].position).toEqual({ x: c.cx, y: c.cy });
    });
    const g = get<GameplayLayer>(doc, "lyr-gameplay");
    const trap = g.items.find((e) => e.kind === "trap") as GameplayTrap;
    const tc = cellCenter("hex", src.traps[0].x, src.traps[0].y);
    expect(trap.position).toEqual({ x: tc.cx, y: tc.cy });
    const marker = g.items.find((e) => e.kind === "marker") as GameplayMarker;
    const mc = cellCenter("hex", src.markers[0].x, src.markers[0].y);
    expect(marker.position).toEqual({ x: mc.cx, y: mc.cy });
    expect(marker.markerKind).toBe(src.markers[0].kind);
  });

  it("hex roads lossless", () => {
    const road = get<PathLayer>(doc, "lyr-road").paths[0];
    expect(road.geometry).toEqual({
      type: "cell-network",
      cells: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ],
    });
  });
});
