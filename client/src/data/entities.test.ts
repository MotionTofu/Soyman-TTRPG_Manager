import { describe, it, expect } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { dataKeys, invalidateAffects, listPath, matchesAffect, pathHasPrefix } from "./entities";
import { affectsForWindowEvent } from "./syncAffects";

describe("граница пути", () => {
  it("префикс совпадает только по границе сегмента или параметра", () => {
    expect(pathHasPrefix("/setting-beings/408", "/setting-beings/408")).toBe(true);
    expect(pathHasPrefix("/setting-beings/408/locations", "/setting-beings/408")).toBe(true);
    expect(pathHasPrefix("/setting-beings/408?x=1", "/setting-beings/408")).toBe(true);
    expect(pathHasPrefix("/setting-beings/4080", "/setting-beings/408")).toBe(false);
    expect(pathHasPrefix("/statblocks?owner_type=character&owner_id=200", "/statblocks?owner_type=character&owner_id=20")).toBe(false);
    expect(pathHasPrefix("/statblocks?owner_type=character&owner_id=20&archived=1", "/statblocks?owner_type=character&owner_id=20")).toBe(true);
  });
});

describe("что задевает правка", () => {
  const being408 = { kind: "being", id: 408 } as const;

  it("сущность задевает свою карточку, свои подресурсы и списки вида — и не трогает соседей", () => {
    expect(matchesAffect(dataKeys.entity("being", 408), being408)).toBe(true);
    expect(matchesAffect(dataKeys.entity("being", 409), being408)).toBe(false);
    expect(matchesAffect(dataKeys.entity("location", 408), being408)).toBe(false);
    expect(matchesAffect(dataKeys.list("being", { setting_id: 1 }), being408)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/setting-beings/408/locations"), being408)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/setting-beings?setting_id=1"), being408)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/setting-beings"), being408)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/setting-beings/4080"), being408)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/setting-beings/409"), being408)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/setting-locations/408"), being408)).toBe(false);
  });

  it("вид целиком задевает все свои карточки и ресурсы", () => {
    expect(matchesAffect(dataKeys.entity("session", 1), { kind: "session" })).toBe(true);
    expect(matchesAffect(dataKeys.resource("/sessions/151/summary"), { kind: "session" })).toBe(true);
    expect(matchesAffect(dataKeys.resource("/campaigns/2/sessions"), { kind: "session" })).toBe(false);
  });

  it("путь задевает только ресурсы, не карточки", () => {
    expect(matchesAffect(dataKeys.resource("/campaigns/2/sessions"), { path: "/campaigns/2" })).toBe(true);
    expect(matchesAffect(dataKeys.entity("campaign", 2), { path: "/campaigns/2" })).toBe(false);
  });

  it("список строится без пустых параметров", () => {
    expect(listPath("being", { setting_id: 1, q: "", archived: undefined })).toBe("/setting-beings?setting_id=1");
    expect(listPath("campaign")).toBe("/campaigns");
  });

  it("обновляются только задетые запросы", async () => {
    const client = new QueryClient();
    const keys = [
      dataKeys.entity("being", 408),
      dataKeys.entity("being", 409),
      dataKeys.resource("/sessions/151"),
    ];
    for (const key of keys) client.setQueryData(key, { v: 1 });
    await invalidateAffects(client, [{ kind: "being", id: 408 }]);
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([true, false, false]);
    await invalidateAffects(client, []);
    expect(keys.map((key) => client.getQueryState(key)?.isInvalidated)).toEqual([true, true, true]);
  });
});

describe("события сокета", () => {
  it("правка персонажа игроком задевает его карточку и его статблоки", () => {
    const affects = affectsForWindowEvent("character-updated", { characterId: 20 }) ?? [];
    expect(matchesAffect(dataKeys.entity("character", 20), affects[0])).toBe(true);
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/statblocks?owner_type=character&owner_id=20"), a))).toBe(true);
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/statblocks?owner_type=character&owner_id=200"), a))).toBe(false);
  });

  it("инициатива задевает очередь только своей сессии", () => {
    const affects = affectsForWindowEvent("initiative-updated", { sessionId: 151 }) ?? [];
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/initiative-entries?session_id=151"), a))).toBe(true);
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/initiative-entries?session_id=15"), a))).toBe(false);
  });

  it("показ картинки — не данные", () => {
    expect(affectsForWindowEvent("show-image", {})).toBeNull();
  });
});
