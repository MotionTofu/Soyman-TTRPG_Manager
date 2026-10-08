import { expect, it } from "vitest";
import { MAP_PACKS, connectedPacks, packsFor } from "./packs";

it("у карты без списка подключено всё подходящее её виду, чужое виду отбрасывается", () => {
  expect(connectedPacks(undefined, "tactical")).toEqual(MAP_PACKS.map((pack) => pack.id));
  expect(packsFor("overview").map((pack) => pack.id)).not.toContain("crypt");
  expect(connectedPacks(["crypt", "ink"], "overview")).toEqual(["ink"]);
  expect(connectedPacks(["crypt"], "tactical")).toEqual(["crypt"]);
  // Пустой или целиком чужой список не оставляет каталог пустым.
  expect(connectedPacks(["crypt"], "overview")).toEqual(packsFor("overview").map((pack) => pack.id));
});
