// Label CRUD tests: create/move/rename/delete/stable ID/collisions/validity.

import { describe, expect, it } from "vitest";
import { FIXTURES, parseFixture } from "../fixtures";
import { migrateLegacyMap } from "../migrateLegacy";
import type { LabelLayer, MapDocumentV5 } from "../types";
import { validateMapDocument } from "../validate";
import type { MutationResult } from "./types";
import { createLabel, deleteLabel, moveLabel, updateLabelText } from "./labels";

const LAYER = "lyr-labels";

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

function labels(doc: MapDocumentV5): LabelLayer {
  const l = doc.layers.find((x) => x.id === LAYER);
  if (!l || l.kind !== "label") throw new Error("no labels");
  return l;
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

describe("labels CRUD", () => {
  it("create + entityId + stable ID", () => {
    const doc = squareDoc();
    const r = createLabel(doc, LAYER, { id: "lbl-new", position: { x: 4.25, y: 4.75 }, text: "Новое" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entityId).toBe("lbl-new");
    const next = expectOk(r);
    expect(labels(next).items.find((l) => l.id === "lbl-new")).toEqual({
      id: "lbl-new",
      position: { x: 4.25, y: 4.75 },
      text: "Новое",
    });
  });

  it("duplicate ID (включая gameplay) → error; пустой текст → error", () => {
    const doc = squareDoc();
    expectErr(createLabel(doc, LAYER, { id: "legacy-label-0", position: { x: 0, y: 0 }, text: "x" }), "duplicate-id");
    expectErr(createLabel(doc, LAYER, { id: "legacy-room-0", position: { x: 0, y: 0 }, text: "x" }), "duplicate-id");
    expectErr(createLabel(doc, LAYER, { id: "x", position: { x: 0, y: 0 }, text: "   " }), "bad-text");
    expectErr(createLabel(doc, LAYER, { id: "x", position: { x: NaN, y: 0 }, text: "x" }), "bad-position");
    expectErr(createLabel(doc, "lyr-road", { id: "x", position: { x: 0, y: 0 }, text: "x" }), "wrong-layer-kind");
  });

  it("rename; same → no-op; empty → error; missing → error", () => {
    const doc = squareDoc();
    const next = expectOk(updateLabelText(doc, "legacy-label-0", "Переименовано"));
    expect(labels(next).items[0].text).toBe("Переименовано");
    const same = updateLabelText(next, "legacy-label-0", "Переименовано");
    expect(same.ok && !same.changed).toBe(true);
    expectErr(updateLabelText(doc, "legacy-label-0", ""), "bad-text");
    expectErr(updateLabelText(doc, "nope", "x"), "unknown-id");
  });

  it("move world delta; zero → no-op; bad delta → error", () => {
    const doc = squareDoc();
    const next = expectOk(moveLabel(doc, "legacy-label-0", { x: 0.5, y: -0.25 }));
    expect(labels(next).items[0].position).toEqual({ x: 2, y: 1.25 });
    const same = moveLabel(next, "legacy-label-0", { x: 0, y: 0 });
    expect(same.ok && !same.changed).toBe(true);
    expectErr(moveLabel(doc, "legacy-label-0", { x: Infinity, y: 0 }), "bad-delta");
    expectErr(moveLabel(doc, "nope", { x: 1, y: 0 }), "unknown-id");
  });

  it("delete; missing → no-op same ref; вход цел при ошибке", () => {
    const doc = squareDoc();
    const before = structuredClone(doc);
    const next = expectOk(deleteLabel(doc, "legacy-label-0"));
    expect(labels(next).items).toEqual([]);
    const r = deleteLabel(next, "legacy-label-0");
    expect(r.ok && !r.changed && r.document === next).toBe(true);
    expectErr(createLabel(doc, LAYER, { id: "fresh-id", position: { x: 0, y: 0 }, text: "" }), "bad-text");
    expect(doc).toEqual(before);
  });
});
