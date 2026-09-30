// Path mutations tests: add/remove/replace/create, pathId identity,
// empty-removes-path, spline rejection, validity.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { MapDocumentV5, PathLayer } from "../types";
import { validateMapDocument } from "../validate";
import { serializeMapDocument } from "../serialize";
import type { MutationResult } from "./types";
import {
  addPathCells,
  createCellNetworkPath,
  createSplinePath,
  deletePath,
  removePathCells,
  replacePathCells,
  updateSplinePath,
} from "./paths";

const ROAD = "legacy-path-road";
const RIVER = "legacy-path-river";
const ROAD_STYLE = { type: "builtin" as const, key: "road" };

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

function roadLayer(doc: MapDocumentV5): PathLayer {
  const l = doc.layers.find((x) => x.id === "lyr-road");
  if (!l || l.kind !== "path") throw new Error("no road layer");
  return l;
}

function roadCells(doc: MapDocumentV5): string[] {
  const p = roadLayer(doc).paths.find((x) => x.id === ROAD);
  if (!p || p.geometry.type !== "cell-network") throw new Error("no road path");
  return p.geometry.cells.map((c) => `${c.x},${c.y}`);
}

function expectOk(r: MutationResult): MapDocumentV5 {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("mutation failed: " + JSON.stringify(r.issues));
  expect(validateMapDocument(r.document)).toEqual([]);
  return r.document;
}

function expectErr(r: MutationResult, codePart: string): void {
  expect(r.ok).toBe(false);
  if (r.ok) throw new Error("expected error");
  expect(r.issues.some((i) => i.code.includes(codePart))).toBe(true);
}

describe("path cells add/remove/replace", () => {
  it("creates and deletes a free road without changing legacy cells", () => {
    const doc = squareDoc();
    const before = roadCells(doc);
    const created = expectOk(createSplinePath(doc, "lyr-road", {
      id: "free-road", kind: "road", styleRef: ROAD_STYLE, width: 0.22,
      nodes: [{ position: { x: 1.2, y: 1.3 } }, { position: { x: 2.8, y: 2.7 } }],
    }));
    expect(roadLayer(created).paths.find((path) => path.id === "free-road")?.geometry.type).toBe("spline");
    expect(roadCells(created)).toEqual(before);
    const deleted = expectOk(deletePath(created, "free-road"));
    expect(roadLayer(deleted).paths.find((path) => path.id === "free-road")).toBeUndefined();
    expect(roadCells(deleted)).toEqual(before);
  });
  it("updates a free line in place without touching cell roads", () => {
    const base = squareDoc();
    const created = expectOk(createSplinePath(base, "lyr-road", {
      id: "editable-road", kind: "road", styleRef: ROAD_STYLE, width: 0.22,
      nodes: [{ position: { x: 1.2, y: 1.3 } }, { position: { x: 2.8, y: 2.7 } }],
    }));
    const updated = expectOk(updateSplinePath(created, "editable-road", {
      width: 0.42, nodes: [{ position: { x: 1.2, y: 1.3 } }, { position: { x: 3.1, y: 2.4 } }],
    }));
    const path = roadLayer(updated).paths.find((item) => item.id === "editable-road")!;
    expect(path.width).toBe(0.42);
    expect(path.geometry.type === "spline" ? path.geometry.nodes[1].position : null).toEqual({ x: 3.1, y: 2.4 });
    expect(roadCells(updated)).toEqual(roadCells(base));
    const unchanged = updateSplinePath(updated, "editable-road", { width: 0.42 });
    expect(unchanged.ok && unchanged.changed).toBe(false);
    expectErr(updateSplinePath(updated, ROAD, { width: 0.5 }), "not-editable");
  });
  it("stores and updates Bézier handles without losing curve geometry", () => {
    const base = squareDoc();
    const nodes = [
      { position: { x: 1, y: 1 }, out: { x: 1.5, y: 1 }, width: 0.2 },
      { position: { x: 2, y: 2 }, in: { x: 1.5, y: 2 }, width: 0.6 },
    ];
    const created = expectOk(createSplinePath(base, "lyr-road", {
      id: "curve", kind: "road", styleRef: ROAD_STYLE, width: 0.22, nodes,
    }));
    nodes[0].out!.x = 9;
    const stored = roadLayer(created).paths.find((path) => path.id === "curve")!;
    expect(stored.geometry.type === "spline" ? stored.geometry.nodes[0].out?.x : null).toBe(1.5);
    const updated = expectOk(updateSplinePath(created, "curve", { width: 0.4 }));
    const result = roadLayer(updated).paths.find((path) => path.id === "curve")!;
    expect(result.geometry.type === "spline" ? result.geometry.nodes[0].out?.x : null).toBe(1.5);
    expect(result.geometry.type === "spline" ? result.geometry.nodes[1].width : null).toBe(0.6);
    expectErr(updateSplinePath(updated, "curve", { nodes: [
      { position: { x: 1, y: 1 }, width: 0 },
      { position: { x: 2, y: 2 } },
    ] }), "bad-nodes");
  });
  it("keeps a branch joined when the parent point moves or gains points at its start", () => {
    const parent = expectOk(createSplinePath(squareDoc(), "lyr-road", {
      id: "parent", kind: "road", styleRef: ROAD_STYLE, width: 0.2,
      nodes: [{ position: { x: 1, y: 1 }, width: 0.2 },
        { position: { x: 3, y: 1 }, width: 0.4 }],
    }));
    const branched = expectOk(createSplinePath(parent, "lyr-road", {
      id: "branch", kind: "road", styleRef: ROAD_STYLE, width: 0.2,
      branchFrom: { pathId: "parent", nodeIndex: 1 },
      nodes: [{ position: { x: 3, y: 1 }, out: { x: 3, y: 1.4 }, width: 0.4 },
        { position: { x: 3, y: 3 }, in: { x: 3, y: 2.6 }, width: 0.4 }],
    }));
    expect(serializeMapDocument(branched)).toContain('"branchFrom":{"pathId":"parent","nodeIndex":1}');
    const nested = expectOk(createSplinePath(branched, "lyr-road", {
      id: "nested-branch", kind: "road", styleRef: ROAD_STYLE, width: 0.2,
      branchFrom: { pathId: "branch", nodeIndex: 0 },
      nodes: [{ position: { x: 3, y: 1 }, width: 0.4 },
        { position: { x: 4, y: 2 }, width: 0.4 }],
    }));
    expectErr(createSplinePath(parent, "lyr-road", {
      id: "bad-branch", kind: "road", styleRef: ROAD_STYLE, width: 0.2,
      branchFrom: { pathId: "parent", nodeIndex: 1 },
      nodes: [{ position: { x: 2, y: 1 } }, { position: { x: 3, y: 3 } }],
    }), "bad-branch");
    const moved = expectOk(updateSplinePath(nested, "parent", { nodes: [
      { position: { x: 1, y: 1 }, width: 0.2 },
      { position: { x: 4, y: 2 }, width: 0.6 },
    ] }));
    let child = roadLayer(moved).paths.find((path) => path.id === "branch")!;
    if (child.geometry.type !== "spline") throw new Error("expected spline");
    expect(child.geometry.nodes[0]).toMatchObject({
      position: { x: 4, y: 2 }, out: { x: 4, y: 2.4 }, width: 0.6,
    });
    const grandchild = roadLayer(moved).paths.find((path) => path.id === "nested-branch")!;
    expect(grandchild.geometry.type === "spline" ? grandchild.geometry.nodes[0].position : null)
      .toEqual({ x: 4, y: 2 });
    const prepended = expectOk(updateSplinePath(moved, "parent", {
      prependCount: 1, nodes: [{ position: { x: 0.5, y: 0.5 }, width: 0.2 },
        { position: { x: 1, y: 1 }, width: 0.2 },
        { position: { x: 4, y: 2 }, width: 0.6 }],
    }));
    child = roadLayer(prepended).paths.find((path) => path.id === "branch")!;
    expect(child.branchFrom).toEqual({ pathId: "parent", nodeIndex: 2 });
    const inserted = expectOk(updateSplinePath(prepended, "parent", {
      insertedAt: { index: 1, count: 1 },
      nodes: [{ position: { x: 0.5, y: 0.5 }, width: 0.2 },
        { position: { x: 0.75, y: 0.75 }, width: 0.2 },
        { position: { x: 1, y: 1 }, width: 0.2 },
        { position: { x: 4, y: 2 }, width: 0.6 }],
    }));
    expect(roadLayer(inserted).paths.find((path) => path.id === "branch")?.branchFrom)
      .toEqual({ pathId: "parent", nodeIndex: 3 });
    const detached = expectOk(deletePath(inserted, "parent"));
    expect(roadLayer(detached).paths.find((path) => path.id === "branch")?.branchFrom)
      .toBeUndefined();
    expect(roadLayer(detached).paths.find((path) => path.id === "nested-branch")?.branchFrom)
      .toEqual({ pathId: "branch", nodeIndex: 0 });
  });
  it("add road cell (sorted, valid)", () => {
    const doc = squareDoc();
    const next = expectOk(addPathCells(doc, ROAD, [{ x: 3, y: 2 }]));
    expect(roadCells(next)).toEqual(["0,2", "1,2", "2,2", "3,2"]);
    expect(roadCells(doc)).toEqual(["0,2", "1,2", "2,2"]);
  });

  it("duplicate add = no-op same ref", () => {
    const doc = squareDoc();
    const r = addPathCells(doc, ROAD, [{ x: 1, y: 2 }]);
    expect(r.ok && !r.changed && r.document === doc).toBe(true);
  });

  it("batch add/remove", () => {
    const doc = squareDoc();
    const added = expectOk(
      addPathCells(doc, ROAD, [
        { x: 3, y: 2 },
        { x: 4, y: 2 },
      ]),
    );
    expect(roadCells(added)).toHaveLength(5);
    const removed = expectOk(removePathCells(added, ROAD, [{ x: 0, y: 2 }]));
    expect(roadCells(removed)).toEqual(["1,2", "2,2", "3,2", "4,2"]);
  });

  it("remove absent = no-op", () => {
    const doc = squareDoc();
    const r = removePathCells(doc, ROAD, [{ x: 7, y: 7 }]);
    expect(r.ok && !r.changed && r.document === doc).toBe(true);
  });

  it("remove final cell → path removed", () => {
    const doc = squareDoc();
    // Rivers: (4,0),(4,1),(4,2) — удаляем все три.
    const next = expectOk(
      removePathCells(doc, RIVER, [
        { x: 4, y: 0 },
        { x: 4, y: 1 },
        { x: 4, y: 2 },
      ]),
    );
    const river = next.layers.find((l) => l.id === "lyr-river");
    expect(river && river.kind === "path" && river.paths).toEqual([]);
  });

  it("replace set; same set → no-op; empty → path removed", () => {
    const doc = squareDoc();
    const next = expectOk(
      replacePathCells(doc, ROAD, [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
      ]),
    );
    expect(roadCells(next)).toEqual(["5,5", "5,6"]);
    const same = replacePathCells(next, ROAD, [
      { x: 5, y: 6 },
      { x: 5, y: 5 },
    ]);
    expect(same.ok && !same.changed).toBe(true);
    const emptied = expectOk(replacePathCells(next, ROAD, []));
    expect(roadLayer(emptied).paths).toEqual([]);
  });

  it("multiple road paths не смешиваются (identity по pathId)", () => {
    const doc = squareDoc();
    const withSecond = expectOk(
      createCellNetworkPath(doc, "lyr-road", {
        id: "road-second",
        kind: "road",
        styleRef: ROAD_STYLE,
        width: 2,
        cells: [{ x: 0, y: 0 }],
      }),
    );
    const next = expectOk(addPathCells(withSecond, ROAD, [{ x: 3, y: 2 }]));
    const paths = roadLayer(next).paths;
    expect(paths).toHaveLength(2);
    expect(paths.find((p) => p.id === "road-second")?.geometry).toEqual({
      type: "cell-network",
      cells: [{ x: 0, y: 0 }],
    });
    expect(roadCells(next)).toContain("3,2");
  });

  it("wrong path ID → error; OOB → error атомарно", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    expectErr(addPathCells(doc, "nope", [{ x: 0, y: 0 }]), "unknown-id");
    expectErr(removePathCells(doc, "nope", [{ x: 0, y: 0 }]), "unknown-id");
    expectErr(addPathCells(doc, ROAD, [{ x: 0, y: 0 }, { x: 99, y: 0 }]), "cell-out-of-grid");
    expect(doc).toEqual(before);
  });

  it("spline path rejected", () => {
    const doc = squareDoc();
    const layer = roadLayer(doc);
    const li = doc.layers.findIndex((l) => l.id === "lyr-road");
    const splineDoc: MapDocumentV5 = {
      ...doc,
      layers: doc.layers.map((l, i) =>
        i === li
          ? {
              ...layer,
              paths: [
                ...layer.paths,
                {
                  id: "spline-1",
                  kind: "route",
                  geometry: {
                    type: "spline",
                    nodes: [{ position: { x: 0, y: 0 } }, { position: { x: 1, y: 1 } }],
                  },
                  width: 1,
                  styleRef: ROAD_STYLE,
                },
              ],
            }
          : l,
      ),
    };
    expectErr(addPathCells(splineDoc, "spline-1", [{ x: 0, y: 0 }]), "unsupported-spline");
    expectErr(removePathCells(splineDoc, "spline-1", [{ x: 0, y: 0 }]), "unsupported-spline");
  });

  it("hex valid", () => {
    const hexDoc = migrateLegacyMap({
      grid: "hex",
      width: 6,
      height: 6,
      cells: parseFixture(FIXTURES.fullV4Hex),
    }).document;
    const next = expectOk(addPathCells(hexDoc, ROAD, [{ x: 2, y: 0 }]));
    const p = next.layers.find((l) => l.id === "lyr-road");
    expect(p && p.kind === "path" && p.paths[0].geometry.type === "cell-network").toBe(true);
  });
});

describe("create cell-network path", () => {
  it("ok + entityId; ошибки: duplicate/width/empty/wrong layer/OOB", () => {
    const doc = squareDoc();
    const r = createCellNetworkPath(doc, "lyr-road", {
      id: "road-new",
      kind: "road",
      styleRef: ROAD_STYLE,
      width: 1,
      cells: [
        { x: 7, y: 7 },
        { x: 6, y: 7 },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.changed).toBe(true);
    expect(r.entityId).toBe("road-new");
    expect(validateMapDocument(r.document)).toEqual([]);
    const p = roadLayer(r.document).paths.find((x) => x.id === "road-new");
    expect(p?.geometry).toEqual({
      type: "cell-network",
      cells: [
        { x: 6, y: 7 },
        { x: 7, y: 7 },
      ],
    });

    expectErr(
      createCellNetworkPath(doc, "lyr-road", { id: ROAD, kind: "road", styleRef: ROAD_STYLE, width: 1, cells: [{ x: 0, y: 0 }] }),
      "duplicate-id",
    );
    expectErr(
      createCellNetworkPath(doc, "lyr-road", { id: "x", kind: "road", styleRef: ROAD_STYLE, width: 0, cells: [{ x: 0, y: 0 }] }),
      "bad-width",
    );
    expectErr(
      createCellNetworkPath(doc, "lyr-road", { id: "x", kind: "road", styleRef: ROAD_STYLE, width: 1, cells: [] }),
      "empty-cells",
    );
    expectErr(
      createCellNetworkPath(doc, "lyr-gameplay", { id: "x", kind: "road", styleRef: ROAD_STYLE, width: 1, cells: [{ x: 0, y: 0 }] }),
      "wrong-layer-kind",
    );
    expectErr(
      createCellNetworkPath(doc, "lyr-road", { id: "x", kind: "road", styleRef: ROAD_STYLE, width: 1, cells: [{ x: 99, y: 0 }] }),
      "cell-out-of-grid",
    );
  });
});
