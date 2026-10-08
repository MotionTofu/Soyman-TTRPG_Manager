import { expect, it } from "vitest";
import { parseMapDocumentV6, serializeMapDocumentV6 } from "@shared/maps/core";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { mapWater } from "../workspace/drawingStyle";

it("вид воды хранится в карте: без него вода остаётся картинкой", () => {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 20, height: 10, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  expect(mapWater(loaded.document)).toBeNull();
  const soft = { ...loaded.document, appearance: { style: "paper-ink" as const, water: "soft" as const } };
  expect(mapWater(soft)).toEqual({ mode: 3, speed: 1, size: 8, shoal: 0 });
  const tuned = { ...soft, appearance: { ...soft.appearance, water: "sea" as const, waterSpeed: 0.5, waterPixels: 12, waterShoal: 2.5 } };
  expect(mapWater(tuned)).toEqual({ mode: 2, speed: 0.5, size: 12, shoal: 2.5 });
  const saved = parseMapDocumentV6(serializeMapDocumentV6(tuned));
  expect(saved.ok && saved.value.appearance).toEqual({ style: "paper-ink", water: "sea", waterSpeed: 0.5, waterPixels: 12, waterShoal: 2.5 });
  expect(parseMapDocumentV6(JSON.stringify({ ...JSON.parse(serializeMapDocumentV6(tuned)), appearance: { style: "paper-ink", waterPixels: 99 } })).ok).toBe(false);
});
