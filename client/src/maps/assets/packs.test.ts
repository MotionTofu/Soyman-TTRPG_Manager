import { expect, it } from "vitest";
import { MAP_PACKS, connectedPacks, packsFor, rankPacks } from "./packs";

it("подбор по жанрам: больше совпадений выше, мимо жанра не видно, без жанра — в конце", () => {
  const pack = (id: string, ...genres: [string, string?][]) => ({ id, genres: genres.map(([genre, subgenre]) => subgenre ? { genre, subgenre } : { genre }) });
  const all = [pack("any"), pack("horror", ["Хоррор"]), pack("fantasy", ["Фэнтези"]), pack("dark", ["Фэнтези", "Тёмное фэнтези"], ["Хоррор"])];
  expect(rankPacks(all, []).map((entry) => entry.id)).toEqual(["any", "horror", "fantasy", "dark"]);
  expect(rankPacks(all, [{ genre: "Фэнтези", subgenre: "Тёмное фэнтези" }]).map((entry) => entry.id)).toEqual(["dark", "fantasy", "any"]);
  expect(rankPacks(all, [{ genre: "Хоррор" }, { genre: "Фэнтези" }]).map((entry) => entry.id)).toEqual(["dark", "horror", "fantasy", "any"]);
});

it("у карты без списка подключено всё подходящее её виду, чужое виду отбрасывается", () => {
  expect(connectedPacks(undefined, "tactical")).toEqual(MAP_PACKS.filter((pack) => pack.id !== "world").map((pack) => pack.id));
  expect(packsFor("tactical").map((pack) => pack.id)).not.toContain("world");
  expect(packsFor("overview").map((pack) => pack.id)).not.toContain("crypt");
  expect(connectedPacks(["crypt", "ink"], "overview")).toEqual(["ink"]);
  expect(connectedPacks(["crypt"], "tactical")).toEqual(["crypt"]);
  // Пустой или целиком чужой список не оставляет каталог пустым.
  expect(connectedPacks(["crypt"], "overview")).toEqual(packsFor("overview").map((pack) => pack.id));
});
