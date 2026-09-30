import { describe, expect, it } from "vitest";
import type { MapDocumentV5, SplineNode } from "../core/types";
import { branchSplineNodes, deformFreePath, extendSplineNodes, freePathHandleIndices,
  hitEditableFreePath, insertSplineNodeAt, moveSplineHandle, setSplineNodeLinear,
  splinePointAt } from "./freePathEditing";
import { flattenSplineNodes, flattenSplineWithWidths, splineFromAnchors } from "../core/spline";

const nodes: SplineNode[] = Array.from({ length: 41 }, (_, index) =>
  ({ position: { x: 1 + index * 0.1, y: 2 } }));

function doc(locked = false): MapDocumentV5 {
  return {
    v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
    grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    assetPacks: [], layers: [{ id: "roads", name: "Roads", kind: "path", visible: true,
      locked, opacity: 1, paths: [{ id: "line", kind: "road", width: 0.22,
        styleRef: { type: "builtin", key: "road" }, geometry: { type: "spline", nodes } }] }],
  };
}

describe("free path editing", () => {
  it("selects a visible line and exposes sparse handles only after selection", () => {
    expect(hitEditableFreePath(doc(), "road", null, { x: 2, y: 2.03 }, 40))
      .toMatchObject({ pathId: "line", handleIndex: null });
    expect(hitEditableFreePath(doc(), "road", "line", { x: 2, y: 2 }, 40))
      .toMatchObject({ pathId: "line", handleIndex: 10 });
    expect(freePathHandleIndices(nodes)).toHaveLength(17);
    expect(hitEditableFreePath(doc(true), "road", null, { x: 2, y: 2 }, 40)).toBeNull();
    expect(hitEditableFreePath(doc(), "river", null, { x: 2, y: 2 }, 40)).toBeNull();
  });

  it("moves an anchor and bends nearby points without moving distant ends", () => {
    const edited = deformFreePath(nodes, 20, 0, 1);
    expect(edited[20].position.y).toBe(3);
    expect(edited[19].position.y).toBeGreaterThan(2);
    expect(edited[0].position).toEqual(nodes[0].position);
    expect(edited[40].position).toEqual(nodes[40].position);
    expect(nodes[20].position.y).toBe(2);
  });

  it("creates a curved spline from click anchors and preserves its handles during editing", () => {
    const curved = splineFromAnchors([{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 1 }]);
    expect(curved[0].out).toBeDefined();
    expect(curved[1].in).toBeDefined();
    expect(curved[1].out).toBeDefined();
    const sampled = flattenSplineNodes(curved, 0.1);
    expect(sampled.length).toBeGreaterThan(curved.length);
    expect(sampled[0]).toEqual({ x: 1, y: 1 });
    expect(sampled.at(-1)).toEqual({ x: 3, y: 1 });
    const curvedDoc = doc();
    if (curvedDoc.layers[0].kind !== "path") throw new Error("expected path layer");
    curvedDoc.layers[0].paths[0].geometry = { type: "spline", nodes: curved };
    expect(hitEditableFreePath(curvedDoc, "road", null, sampled[10], 40)?.pathId).toBe("line");
    const moved = deformFreePath(curved, 1, 0, 0.5);
    expect(moved[1].position.y).toBe(3.5);
    expect(moved[1].in?.y).toBeCloseTo(curved[1].in!.y + 0.5);
    expect(curved[1].position.y).toBe(3);
  });

  it("drags a whisker with its opposite mirrored and switches a node to straight segments", () => {
    const curved = splineFromAnchors([{ x: 1, y: 1 }, { x: 2, y: 3 }, { x: 3, y: 1 }])
      .map((node, index) => ({ ...node, width: 0.2 + index * 0.1 }));
    const selected = doc();
    if (selected.layers[0].kind !== "path") throw new Error("expected path layer");
    selected.layers[0].paths[0].geometry = { type: "spline", nodes: curved };
    expect(hitEditableFreePath(selected, "road", "line", curved[1].out!, 80))
      .toMatchObject({ handleIndex: 1, handleKind: "out" });
    const moved = moveSplineHandle(curved, 1, "out", 0.3, -0.2);
    expect(moved[1].out!.x).toBeCloseTo(curved[1].out!.x + 0.3);
    expect(moved[1].in!.x).toBeCloseTo(2 * curved[1].position.x - moved[1].out!.x);
    const linear = setSplineNodeLinear(moved, 1, true);
    expect(linear[1].in).toBeUndefined();
    expect(linear[1].out).toBeUndefined();
    expect(linear[1].width).toBeCloseTo(0.3);
    expect(flattenSplineNodes(linear, 0.1)).toHaveLength(3);
    expect(setSplineNodeLinear(linear, 1, false)[1].out).toBeDefined();
    const widths = flattenSplineWithWidths(curved, 0.22, 0.1).map((sample) => sample.width);
    expect(widths[0]).toBeCloseTo(0.2);
    expect(widths.at(-1)).toBeCloseTo(0.4);
    expect(widths.some((width) => width > 0.2 && width < 0.3)).toBe(true);
  });

  it("extends either end while preserving the existing shape and point widths", () => {
    const original = splineFromAnchors([{ x: 1, y: 1 }, { x: 2, y: 2 }, { x: 3, y: 1 }])
      .map((node, index) => ({ ...node, width: 0.2 + index * 0.1 }));
    const tail = extendSplineNodes(original, [{ x: 3, y: 1 }, { x: 4, y: 0 }], "end", 0.22);
    expect(tail).toHaveLength(4);
    expect(tail.slice(0, 2)).toEqual(original.slice(0, 2));
    expect(tail[2].in).toEqual(original[2].in);
    expect(tail[2].out!.x).toBeCloseTo(2 * original[2].position.x - original[2].in!.x);
    expect(tail[3].width).toBeCloseTo(0.4);
    const head = extendSplineNodes(original, [{ x: 1, y: 1 }, { x: 0.5, y: 0.5 }], "start", 0.22);
    expect(head).toHaveLength(4);
    expect(head[0].position).toEqual({ x: 0.5, y: 0.5 });
    expect(head[0].width).toBeCloseTo(0.2);
    expect(head.slice(2)).toEqual(original.slice(1));
    expect(original).toHaveLength(3);
  });

  it("starts a separate branch exactly at a chosen point with matching width", () => {
    const parent = { position: { x: 2, y: 2 }, width: 0.48 };
    const branch = branchSplineNodes(parent, [parent.position, { x: 2, y: 3 },
      { x: 3, y: 4 }], 0.22);
    expect(branch.map((node) => node.position)).toEqual([
      { x: 2, y: 2 }, { x: 2, y: 3 }, { x: 3, y: 4 },
    ]);
    expect(branch.every((node) => node.width === 0.48)).toBe(true);
    expect(branch[0].out).toBeDefined();
  });

  it("finds a point on the line and splits a Bézier without changing its shape", () => {
    const original = splineFromAnchors([{ x: 1, y: 1 }, { x: 3, y: 2 }])
      .map((node, index) => ({ ...node, width: index ? 0.6 : 0.2 }));
    const clicked = splinePointAt(original, 0, 0.4);
    const selected = doc();
    if (selected.layers[0].kind !== "path") throw new Error("expected path layer");
    selected.layers[0].paths[0].geometry = { type: "spline", nodes: original };
    const hit = hitEditableFreePath(selected, "road", "line", clicked, 80);
    expect(hit?.join?.segmentIndex).toBe(0);
    expect(hit?.join?.t).toBeCloseTo(0.4, 2);
    const split = insertSplineNodeAt(original, 0, 0.4, 0.22)!;
    expect(split.nodes).toHaveLength(3);
    expect(split.nodes[1].width).toBeCloseTo(0.36);
    for (const u of [0.1, 0.5, 0.9]) {
      const left = splinePointAt(split.nodes, 0, u);
      const oldLeft = splinePointAt(original, 0, u * 0.4);
      expect(left.x).toBeCloseTo(oldLeft.x, 8);
      expect(left.y).toBeCloseTo(oldLeft.y, 8);
      const right = splinePointAt(split.nodes, 1, u);
      const oldRight = splinePointAt(original, 0, 0.4 + u * 0.6);
      expect(right.x).toBeCloseTo(oldRight.x, 8);
      expect(right.y).toBeCloseTo(oldRight.y, 8);
    }
  });
});
