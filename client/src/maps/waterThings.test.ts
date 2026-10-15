import { expect, it } from "vitest";
import { ignoresWater } from "./water";
import { setMapObjectDry } from "./core/mutations/mapObjects";
import type { MapDocumentV5, MapObject } from "./core/types";

const object = (assetId: string, properties?: MapObject["properties"]): MapObject => ({ id: assetId, transform: { position: { x: 1, y: 1 }, rotation: 0, scale: { x: 1, y: 1 } },
  visual: { type: "asset", assetId }, ...(properties ? { properties } : {}) });

it("вода не замечает отмеченное и то, что лежит на ней; отметку можно снять и с кувшинки", () => {
  expect([ignoresWater(object("soyman-village:boat")), ignoresWater(object("soyman-village:lilies"))]).toEqual([false, true]);
  const doc = { layers: [{ id: "o", kind: "object", name: "Объекты", visible: true, locked: false, opacity: 1, items: [object("soyman-village:boat"), object("soyman-village:lilies")] }] } as unknown as MapDocumentV5;
  const dry = setMapObjectDry(doc, "soyman-village:boat", true), wet = setMapObjectDry(doc, "soyman-village:lilies", false);
  if (!dry.ok || !wet.ok) throw Error("mutation");
  const items = (result: MapDocumentV5) => (result.layers[0] as unknown as { items: MapObject[] }).items;
  expect(ignoresWater(items(dry.document)[0])).toBe(true);
  expect(ignoresWater(items(wet.document)[1])).toBe(false);
  expect(setMapObjectDry(dry.document, "soyman-village:boat", true)).toMatchObject({ ok: true, changed: false });
});
