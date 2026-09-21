// Roundtrip V5 + canonicalization (§48–49 ТЗ).

import { describe, expect, it } from "vitest";
import { canonicalizeMapDocument } from "./canonicalize";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import { parseMapDocument } from "./parse";
import { serializeMapDocument } from "./serialize";
import type { MapDocumentV5, MapLayer } from "./types";
import { validateMapDocument } from "./validate";

function fullDoc(): MapDocumentV5 {
  const { document } = migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  });
  return document;
}

/** Ручной документ со всеми видами сущностей: terrain, paths (оба), object,
 *  scatter, label, gameplay. */
function richDoc(): MapDocumentV5 {
  const base = fullDoc();
  const layers: MapLayer[] = base.layers.map((l) => {
    if (l.kind === "path" && l.id === "lyr-road") {
      return {
        ...l,
        paths: [
          ...l.paths,
          {
            id: "path-spline-1",
            kind: "route",
            geometry: {
              type: "spline",
              nodes: [
                { position: { x: 1, y: 1 } },
                { position: { x: 3, y: 2 }, in: { x: 2.5, y: 2 }, out: { x: 3.5, y: 2 } },
              ],
            },
            width: 0.5,
            styleRef: { type: "builtin", key: "route-dash" },
            properties: { dashed: true },
          },
        ],
      };
    }
    if (l.kind === "object") {
      return {
        ...l,
        items: [
          {
            id: "obj-1",
            transform: { position: { x: 6.427, y: 4.831 }, rotation: 0, scale: { x: 1, y: 1 } },
            visual: { type: "builtin", key: "tree-oak" },
          },
        ],
      };
    }
    if (l.kind === "scatter") {
      return {
        ...l,
        areas: [
          {
            id: "scatter-1",
            shape: { type: "ellipse", center: { x: 4, y: 4 }, rx: 2, ry: 1.5 },
            profileRef: { type: "builtin", key: "forest-light" },
            seed: 7,
            density: 0.5,
          },
        ],
      };
    }
    return l;
  });
  return { ...base, layers };
}

describe("roundtrip V5", () => {
  it("serialize → parse → serialize: строка A === строке B", () => {
    const a = serializeMapDocument(richDoc());
    const parsed = parseMapDocument(a);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(validateMapDocument(parsed.value)).toEqual([]);
    expect(serializeMapDocument(parsed.value)).toBe(a);
  });

  it("parse принимает уже разобранный объект", () => {
    const doc = richDoc();
    const parsed = parseMapDocument(JSON.parse(serializeMapDocument(doc)));
    expect(parsed.ok).toBe(true);
  });

  it("parse битого JSON возвращает ошибку, не бросает", () => {
    const r = parseMapDocument("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].code).toBe("json.syntax");
  });

  it("parse не-v5 возвращает ошибки валидации", () => {
    const r = parseMapDocument('{"v":4}');
    expect(r.ok).toBe(false);
  });
});

describe("canonicalization", () => {
  it("terrain cells в разном порядке → одинаковый результат", () => {
    const a = fullDoc();
    const b = structuredClone(a);
    const terrainB = b.layers[0];
    if (terrainB.kind !== "terrain" || terrainB.representation !== "cells") throw new Error("bad fixture");
    terrainB.cells.reverse();
    expect(serializeMapDocument(a)).toBe(serializeMapDocument(b));
  });

  it("cell-network в разном порядке → одинаковый результат", () => {
    const a = fullDoc();
    const b = structuredClone(a);
    const road = b.layers.find((l) => l.id === "lyr-road");
    if (!road || road.kind !== "path") throw new Error("bad fixture");
    for (const p of road.paths) {
      if (p.geometry.type === "cell-network") p.geometry.cells.reverse();
    }
    expect(serializeMapDocument(a)).toBe(serializeMapDocument(b));
  });

  it("layers НЕ сортируются: перевёрнутый порядок сохраняется", () => {
    const a = fullDoc();
    const b = structuredClone(a);
    b.layers.reverse();
    const sa = serializeMapDocument(a);
    const sb = serializeMapDocument(b);
    expect(sb).not.toBe(sa);
    const parsed = parseMapDocument(sb);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.layers.map((l) => l.id)).toEqual(b.layers.map((l) => l.id));
  });

  it("object/gameplay items НЕ сортируются, IDs стабильны", () => {
    const doc = richDoc();
    const ids = (d: MapDocumentV5) =>
      d.layers.flatMap((l) =>
        l.kind === "object" || l.kind === "label"
          ? l.items.map((e) => e.id)
          : l.kind === "gameplay"
            ? l.items.map((e) => e.id)
            : [],
      );
    const parsed = parseMapDocument(serializeMapDocument(doc));
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(ids(parsed.value)).toEqual(ids(canonicalizeMapDocument(doc)));
  });

  it("неизвестные ключи отбрасываются, undefined чистится", () => {
    const doc = fullDoc();
    const dirty = {
      ...doc,
      futureField: "drop me",
      layers: doc.layers.map((l) => ({ ...l, unknown: 1 })),
    };
    const canon = canonicalizeMapDocument(dirty as unknown as MapDocumentV5);
    expect("futureField" in canon).toBe(false);
    expect(JSON.stringify(canon)).not.toContain("unknown");
    expect(validateMapDocument(JSON.parse(JSON.stringify(canon)))).toEqual([]);
  });
});
