import { expect, it } from "vitest";
import { rasterAsset } from "../../rasterAssets";
import { packOfAsset } from "./packs";
import { WORLD_OBJECT_KEYS, WORLD_PACK, WORLD_SURFACES, pickVariant, worldId, worldSignLabel, worldSurfaceCode, worldSurfaceKey } from "./world";
import { setMapObjectSign } from "../core/mutations/mapObjects";
import { projectMapDocumentForPlayer } from "../core/playerProjection";
import type { MapDocumentV5 } from "../core/types";

it("«Мир»: у каждой вещи и поверхности есть картинка, вариант выбирается из семейства, вещь числится за набором", () => {
  for (const key of [...WORLD_OBJECT_KEYS, ...WORLD_SURFACES.map((item) => item.key)]) expect(rasterAsset("world", key), key).toBeTruthy();
  expect(pickVariant(`${worldId("mountains")}*`, () => 0.99)).toBe(worldId("mountains-3"));
  expect(pickVariant(`${worldId("capital")}*`, () => 0.99)).toBe(worldId("capital"));
  expect(pickVariant("soyman-village:well*", () => 0.99)).toBe("soyman-village:well-2");
  expect(worldSurfaceKey(worldSurfaceCode("forest-floor"))).toBe("forest-floor");
  expect(worldSurfaceKey("world-lava")).toBeNull();
  expect(packOfAsset(worldId("tower"))).toBe("world");
});

it("знак «Мира»: название и локация в свойствах, пустое снимается, игрок видит название без связи с локацией", () => {
  const sign = { id: "s", transform: { position: { x: 2, y: 2 }, rotation: 0, scale: { x: 2, y: 2 } }, visual: { type: "asset" as const, assetId: worldId("capital") } };
  const doc: MapDocumentV5 = { v: 5, world: { bounds: { minX: 0, minY: 0, maxX: 8, maxY: 8 } }, grid: { type: "square", cellSize: 1, columns: 8, rows: 8, origin: { x: 0, y: 0 } },
    assetPacks: [WORLD_PACK], layers: [{ id: "o", name: "Знаки", kind: "object", visible: true, locked: false, opacity: 1, items: [sign] }] };
  const named = setMapObjectSign(doc, "s", { name: "Аркхейм", location: "0123456789abcdef0123456789abcdef" });
  expect(named.ok).toBe(true);
  if (!named.ok) return;
  const shown = projectMapDocumentForPlayer(named.document).layers[0];
  expect(shown.kind === "object" && shown.items[0].properties).toEqual({ name: "Аркхейм" });
  const cleared = setMapObjectSign(named.document, "s", { name: undefined, location: "" });
  expect(cleared.ok && cleared.document.layers[0].kind === "object" && "properties" in cleared.document.layers[0].items[0]).toBe(false);
  expect(worldSignLabel(worldId("capital"))).toBeGreaterThan(worldSignLabel(worldId("hamlet"))!);
  expect(worldSignLabel(worldId("mountains-2"))).toBeNull();
});
