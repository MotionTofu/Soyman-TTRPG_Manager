import { describe, expect, it } from "vitest";
import type { MapDocumentV5, ReferenceImage } from "../types";
import { addReferenceImage, createReferenceLayer, deleteReferenceImage, shiftReferenceImage, updateReferenceImage } from "./references";
import { changedArea } from "../../workspace/changedArea";
import type { MapDocumentV6 } from "@shared/maps/core";

const doc = (): MapDocumentV5 => ({ v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } },
  grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } }, assetPacks: [], layers: [] });
const image = (id: string): ReferenceImage => ({ id, image: "0b7c1d9e-1111-4222-8333-944455556666", pixels: { w: 400, h: 200 }, position: { x: 4, y: 4 }, width: 4, rotation: 0, opacity: 1 });
const ok = (result: ReturnType<typeof createReferenceLayer>) => { if (!result.ok) throw new Error(result.issues[0]?.message); return result.document; };

describe("подложка: операции", () => {
  it("слой наверху, картинки добавляются, меняются, меняются местами и убираются", () => {
    let d = ok(createReferenceLayer(doc(), { id: "under", name: "Подложка" }));
    d = ok(addReferenceImage(d, "under", image("a")));
    d = ok(addReferenceImage(d, "under", image("b")));
    expect(addReferenceImage(d, "under", image("a")).ok).toBe(false);
    d = ok(updateReferenceImage(d, "a", { crop: { x0: 0.1, y0: 0, x1: 1, y1: 1 }, opacity: 0.4 }));
    const items = () => (d.layers[0] as { items: ReferenceImage[] }).items;
    expect(items()[0]).toMatchObject({ opacity: 0.4, crop: { x0: 0.1 } });
    d = ok(updateReferenceImage(d, "a", { crop: null }));
    expect(items()[0].crop).toBeUndefined();
    expect(updateReferenceImage(d, "a", { opacity: 2 }).ok).toBe(false);
    d = ok(shiftReferenceImage(d, "a", 1));
    expect(items().map((item) => item.id)).toEqual(["b", "a"]);
    d = ok(deleteReferenceImage(d, "b"));
    expect(items().map((item) => item.id)).toEqual(["a"]);
  });

  it("сдвиг картинки перерисовывает только её место", () => {
    const before = ok(addReferenceImage(ok(createReferenceLayer(doc(), { id: "under", name: "Подложка" })), "under", image("a")));
    const after = ok(updateReferenceImage(before, "a", { position: { x: 5, y: 4 } }));
    const area = changedArea({ ...before, v: 6 } as unknown as MapDocumentV6, { ...after, v: 6 } as unknown as MapDocumentV6)!;
    expect(area.x).toBeCloseTo(2 - 0.25);
    expect(area.w).toBeCloseTo(5 + 0.5);
  });
});
