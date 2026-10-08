import { expect, it } from "vitest";
import { loadStoredWorkspaceDocument } from "../editor/loadDocument";
import { mapWater } from "../workspace/drawingStyle";

it("вид воды хранится в карте: без него вода остаётся картинкой", () => {
  const loaded = loadStoredWorkspaceDocument({ grid: "square", width: 20, height: 10, cells: '{"v":1,"cells":{},"roads":[]}' });
  if (loaded.status !== "supported") throw Error("fixture");
  expect(mapWater(loaded.document)).toBeNull();
  const soft = { ...loaded.document, appearance: { style: "paper-ink" as const, water: "soft" as const } };
  expect(mapWater(soft)).toEqual({ mode: 3, speed: 1, size: 8 });
});
