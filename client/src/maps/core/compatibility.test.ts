// Compatibility profile tests (Фаза 2G, §4–6).

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "./fixtures";
import { migrateLegacyMap } from "./migrateLegacy";
import type { MapDocumentV5 } from "./types";
import { assessCurrentEditorCompatibility } from "./compatibility";
import { createTerrainMaskLayer } from "./mutations/layers";
import { createSplinePath } from "./mutations/paths";
import { setExplorationEnabled } from "./mutations/exploration";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

describe("assessCurrentEditorCompatibility", () => {
  it("migrated legacy → compatible", () => {
    const c = assessCurrentEditorCompatibility(squareDoc());
    expect(c.compatible).toBe(true);
    expect(c.reasons).toEqual([]);
  });

  it("accepts free roads alongside existing cell roads", () => {
    const created = createSplinePath(squareDoc(), "lyr-road", {
      id: "free-road", kind: "road", width: 0.22,
      styleRef: { type: "builtin", key: "road" },
      nodes: [{ position: { x: 1.2, y: 1.3 } }, { position: { x: 2.8, y: 2.7 } }],
    });
    if (!created.ok) throw new Error("fixture failed");
    expect(assessCurrentEditorCompatibility(created.document)).toEqual({ compatible: true, reasons: [] });
  });

  it("allows fog together with detailed terrain", () => {
    const created = createTerrainMaskLayer(squareDoc(), { id: "mask-fog", name: "Детальный рельеф" });
    if (!created.ok) throw new Error("fixture failed");
    const fog = setExplorationEnabled(created.document, true);
    if (!fog.ok) throw new Error("fixture failed");
    expect(assessCurrentEditorCompatibility(fog.document)).toEqual({ compatible: true, reasons: [] });
    const exotic = { ...fog.document, layers: fog.document.layers.map((layer) =>
      layer.id === "mask-fog" && layer.kind === "terrain"
        ? { ...layer, defaultMaterial: { type: "builtin" as const, key: "terrain/forest" } }
        : layer) };
    expect(assessCurrentEditorCompatibility(exotic).reasons.map((reason) => reason.code)).toContain("exploration-mask-default");
  });

  it("rejects V5 grid geometry that the current canvas cannot position", () => {
    const doc = squareDoc();
    if (!doc.grid) throw new Error("fixture must have grid");
    const scaled = { ...doc, grid: { ...doc.grid, cellSize: 2 } };
    const shifted = { ...doc, grid: { ...doc.grid, origin: { x: 3, y: 0 } } };
    expect(assessCurrentEditorCompatibility(scaled).reasons.map((r) => r.code)).toContain("grid-geometry");
    expect(assessCurrentEditorCompatibility(shifted).reasons.map((r) => r.code)).toContain("grid-geometry");
  });

  it("supports an empty mask but preserves the gate for unknown encodings", () => {
    const doc = squareDoc();
    const li = doc.layers.findIndex((l) => l.id === "lyr-terrain");
    const masked: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l, i) =>
        i === li && l.kind === "terrain"
          ? {
              ...l,
              representation: "mask" as const,
              mask: {
                origin: { x: 0, y: 0 },
                sampleSize: 0.125,
                materials: [{ type: "builtin" as const, key: "terrain/plain" }],
                chunks: [],
              },
              cells: undefined as never,
            }
          : l,
      ),
    };
    const c = assessCurrentEditorCompatibility(masked);
    expect(c.compatible).toBe(true);
    const unknown: MapDocumentV5 = {
      ...masked,
      layers: masked.layers.map((layer) => layer.kind === "terrain" && layer.representation === "mask"
        ? { ...layer, mask: { ...layer.mask, chunks: [{ id: "unknown-mask-chunk", cx: 0, cy: 0, payload: { encoding: "future-v2" } }] } }
        : layer),
    };
    expect(assessCurrentEditorCompatibility(unknown).reasons.map((r) => r.code)).toContain("unsupported-terrain-mask");
  });

  it("unknown spline kind / objects / scatter → incompatible", () => {
    const doc = squareDoc();
    const layers = doc.layers.map((l) => {
      if (l.id === "lyr-road" && l.kind === "path") {
        return {
          ...l,
          paths: [
            ...l.paths,
            {
              id: "spline-1",
              kind: "route",
              geometry: {
                type: "spline" as const,
                nodes: [{ position: { x: 0, y: 0 } }, { position: { x: 1, y: 1 } }],
              },
              width: 1,
              styleRef: { type: "builtin" as const, key: "route" },
            },
          ],
        };
      }
      if (l.id === "lyr-objects" && l.kind === "object") {
        return {
          ...l,
          items: [
            {
              id: "obj-1",
              transform: { position: { x: 1, y: 1 }, rotation: 0, scale: { x: 1, y: 1 } },
              visual: { type: "builtin" as const, key: "chest" },
            },
          ],
        };
      }
      if (l.id === "lyr-scatter" && l.kind === "scatter") {
        return {
          ...l,
          areas: [
            {
              id: "sc-1",
              shape: { type: "ellipse" as const, center: { x: 1, y: 1 }, rx: 1, ry: 1 },
              profileRef: { type: "builtin" as const, key: "p" },
              seed: 1,
              density: 1,
            },
          ],
        };
      }
      return l;
    });
    const c = assessCurrentEditorCompatibility({ ...doc, layers });
    expect(c.compatible).toBe(false);
    const codes = c.reasons.map((r) => r.code);
    expect(codes).toContain("unsupported-path-kind");
    expect(codes).toContain("unsupported-object-layer");
    expect(codes).toContain("unsupported-scatter-layer");
  });

  it("два road paths в одном слое → path-count", () => {
    const doc = squareDoc();
    const layers = doc.layers.map((l) => {
      if (l.id !== "lyr-road" || l.kind !== "path") return l;
      return {
        ...l,
        paths: [
          ...l.paths,
          {
            id: "road-2",
            kind: "road",
            geometry: { type: "cell-network" as const, cells: [{ x: 7, y: 7 }] },
            width: 1,
            styleRef: { type: "builtin" as const, key: "road" },
          },
        ],
      };
    });
    const c = assessCurrentEditorCompatibility({ ...doc, layers });
    expect(c.compatible).toBe(false);
    expect(c.reasons.some((r) => r.code === "path-count")).toBe(true);
  });

  it("gridless / dims вне профиля / non-rect room / non-cardinal door / чужой default", () => {
    const doc = squareDoc();
    expect(
      assessCurrentEditorCompatibility({ ...doc, grid: null }).reasons.some((r) => r.code === "grid-missing"),
    ).toBe(true);
    const bigGrid = doc.grid && { ...doc.grid, columns: 200, rows: 200 };
    expect(
      assessCurrentEditorCompatibility({ ...doc, grid: bigGrid }).reasons.some((r) => r.code === "grid-dims"),
    ).toBe(true);

    const gameplay = doc.layers.find((l) => l.id === "lyr-gameplay");
    if (gameplay && gameplay.kind === "gameplay") {
      const withPoly = {
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === "lyr-gameplay" && l.kind === "gameplay"
            ? {
                ...l,
                items: [
                  ...l.items,
                  {
                    id: "poly",
                    kind: "room" as const,
                    geometry: {
                      type: "polygon" as const,
                      points: [
                        { x: 0, y: 0 },
                        { x: 1, y: 0 },
                        { x: 0, y: 1 },
                      ],
                    },
                    roomType: "lab" as const,
                    name: "",
                  },
                ],
              }
            : l,
        ),
      };
      expect(
        assessCurrentEditorCompatibility(withPoly).reasons.some((r) => r.code === "unsupported-room-geometry"),
      ).toBe(true);

      const tilted = {
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === "lyr-gameplay" && l.kind === "gameplay"
            ? {
                ...l,
                items: l.items.map((e) => (e.kind === "door" ? { ...e, orientation: 45 } : e)),
              }
            : l,
        ),
      };
      expect(
        assessCurrentEditorCompatibility(tilted).reasons.some((r) => r.code === "unsupported-door-orientation"),
      ).toBe(true);
    }

    const terrain = doc.layers.find((l) => l.id === "lyr-terrain");
    if (terrain && terrain.kind === "terrain") {
      const oddDefault = {
        ...doc,
        layers: doc.layers.map((l) =>
          l.id === "lyr-terrain" && l.kind === "terrain"
            ? { ...l, defaultMaterial: { type: "asset" as const, assetId: "pack:grass" } }
            : l,
        ),
      };
      expect(
        assessCurrentEditorCompatibility(oddDefault).reasons.some((r) => r.code === "terrain-default-material"),
      ).toBe(true);
    }
  });

  it("3A §77: hidden nonempty object layer — всё ещё unsupported", () => {
    const doc = squareDoc();
    const layers = doc.layers.map((l) => {
      if (l.id === "lyr-objects" && l.kind === "object") {
        return {
          ...l,
          visible: false,
          items: [
            {
              id: "obj-1",
              transform: { position: { x: 1, y: 1 }, rotation: 0, scale: { x: 1, y: 1 } },
              visual: { type: "builtin" as const, key: "chest" },
            },
          ],
        };
      }
      return l;
    });
    const c = assessCurrentEditorCompatibility({ ...doc, layers });
    expect(c.compatible).toBe(false);
    expect(c.reasons.some((r) => r.code === "unsupported-object-layer")).toBe(true);
  });

  it("3A §78–79: multi-layer документы compatible, per-layer ambiguity — нет", () => {
    const doc = squareDoc();
    // Второй road path в ОТДЕЛЬНОМ path-слое — теперь supported.
    const withSecondRoadLayer: MapDocumentV5 = {
      ...doc,
      layers: [
        ...doc.layers,
        {
          id: "lyr-road-2",
          name: "Roads Secret",
          visible: true,
          locked: false,
          opacity: 1,
          kind: "path" as const,
          paths: [
            {
              id: "road-secret",
              kind: "road",
              geometry: { type: "cell-network" as const, cells: [{ x: 7, y: 7 }] },
              width: 1,
              styleRef: { type: "builtin" as const, key: "road" },
            },
          ],
        },
      ],
    };
    expect(assessCurrentEditorCompatibility(withSecondRoadLayer).compatible).toBe(true);

    // + второй terrain/gameplay/label слои, hidden+locked+opacity, arbitrary order.
    const terrain = doc.layers.find((l) => l.kind === "terrain");
    const gameplay = doc.layers.find((l) => l.kind === "gameplay");
    const labelLayer = doc.layers.find((l) => l.kind === "label");
    const multi: MapDocumentV5 = {
      ...doc,
      layers: [
        ...(labelLayer ? [{ ...labelLayer, id: "lbl-top", name: "L-top" }] : []),
        ...(terrain && terrain.kind === "terrain"
          ? [{ ...terrain, id: "t2", name: "T2", visible: false, opacity: 0.5 }]
          : []),
        ...(gameplay && gameplay.kind === "gameplay"
          ? [{ ...gameplay, id: "g2", name: "G2", locked: true, items: [] }]
          : []),
        ...doc.layers,
      ],
    };
    expect(assessCurrentEditorCompatibility(multi).compatible).toBe(true);
  });
});
