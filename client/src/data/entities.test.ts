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
  it("правка сессии задевает календарь, деньги и списки кампаний и игроков, а карточная — нет", () => {
    const field = { kind: "session", id: 153 } as const;
    const step = { kind: "session", id: 153, card: true } as const;
    for (const path of ["/calendar", "/finance/summary", "/campaigns", "/players"]) {
      expect(matchesAffect(dataKeys.resource(path), field)).toBe(true);
      expect(matchesAffect(dataKeys.resource(path), step)).toBe(false);
    }
    expect(matchesAffect(dataKeys.resource("/campaigns/4/calendar-events"), field)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/players/3"), field)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/calendar"), { kind: "session" })).toBe(true);
  });

  it("архивная сущность задевает список архива, шаг карточки — нет", () => {
    expect(matchesAffect(dataKeys.resource("/archive"), { kind: "being", id: 12 })).toBe(true);
    expect(matchesAffect(dataKeys.resource("/archive"), { kind: "campaign" })).toBe(true);
    expect(matchesAffect(dataKeys.resource("/archive"), { kind: "session", id: 3, card: true })).toBe(false);
    expect(matchesAffect(dataKeys.resource("/archived-files"), { kind: "being", id: 12 })).toBe(false);
  });

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

  it("сохранение карты задевает список карт, но не её привязки", () => {
    const saved = { kind: "map", id: 5, card: true } as const;
    expect(matchesAffect(dataKeys.resource("/maps"), saved)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/maps/5"), saved)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/maps/5/bindings"), saved)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/maps/5/bindings"), { kind: "map", id: 5 })).toBe(true);
  });

  it("правка полей задевает карточку и списки, но не подресурсы", () => {
    const card = { kind: "campaign", id: 2, card: true } as const;
    expect(matchesAffect(dataKeys.resource("/campaigns/2"), card)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/campaigns"), card)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/campaigns?setting_id=1"), card)).toBe(true);
    expect(matchesAffect(dataKeys.entity("campaign", 2), card)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/campaigns/2/sessions"), card)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/campaigns/20"), card)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/canvas/index"), card)).toBe(true);
  });

  it("отметка сцены доходит до дерева и плана пульта, но не до остальных его панелей", () => {
    const scene = { kind: "scene", id: 114 } as const;
    expect(matchesAffect(dataKeys.resource("/sessions/142/story-tree"), scene)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/sessions/142/story-tree?scope=setting"), scene)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/sessions/142/planned"), scene)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/sessions/142/preview/114"), scene)).toBe(true);
    expect(matchesAffect(dataKeys.resource("/sessions/142/stage"), scene)).toBe(false);
    expect(matchesAffect(dataKeys.resource("/sessions/142/planned-extra"), scene)).toBe(false);
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

  it("сохранение одного листа карточку персонажа не задевает, а его статблоки — да", () => {
    const affects = affectsForWindowEvent("character-updated", { characterId: 20, scope: "sheet" }) ?? [];
    expect(affects.some((a) => matchesAffect(dataKeys.entity("character", 20), a))).toBe(false);
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/characters/20/initiative"), a))).toBe(false);
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/statblocks?owner_type=character&owner_id=20"), a))).toBe(true);
    expect(affects.some((a) => matchesAffect(dataKeys.resource("/player/characters/20"), a))).toBe(true);
  });

  it("персонаж игрока задевает профиль своего игрока у Мастера, но не чужой", () => {
    const affects = affectsForWindowEvent("character-updated", { characterId: 20, playerId: 7 }) ?? [];
    expect(affects.some((a) => matchesAffect(dataKeys.entity("player", 7), a))).toBe(true);
    expect(affects.some((a) => matchesAffect(dataKeys.entity("player", 8), a))).toBe(false);
  });

  it("правка листа профиль игрока не задевает — иначе каждая правка хитов тянула бы запрос", () => {
    const affects = affectsForWindowEvent("character-updated", { characterId: 20, playerId: 7, scope: "sheet" }) ?? [];
    expect(affects.some((a) => matchesAffect(dataKeys.entity("player", 7), a))).toBe(false);
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

describe("сигнал «компендиум системы изменился»", () => {
  it("задевает записи компендиума и всё под своей системой, но не чужую систему", () => {
    const affects = affectsForWindowEvent("system-data-changed", { systemId: 6 }) ?? [];
    const hit = (key: readonly unknown[]) => affects.some((a) => matchesAffect(key, a));
    expect(hit(dataKeys.entity("compendium_entry", 900))).toBe(true);
    expect(hit(dataKeys.resource("/systems/6/sections"))).toBe(true);
    expect(hit(dataKeys.resource("/systems/6/entries?section_id=3"))).toBe(true);
    expect(hit(dataKeys.resource("/systems/60/sections"))).toBe(false);
    expect(hit(dataKeys.resource("/player/campaigns/2/visible"))).toBe(false);
  });
});

describe("сигнал «запись игрока изменилась»", () => {
  it("задевает кабинет и партию игрока, но не листы и не данные Мастера", () => {
    const affects = affectsForWindowEvent("player-data-changed", { playerId: 4 }) ?? [];
    const hit = (path: string) => affects.some((a) => matchesAffect(dataKeys.resource(path), a));
    expect(hit("/player/me")).toBe(true);
    expect(hit("/player/dashboard")).toBe(true);
    expect(hit("/player/campaigns/2/party")).toBe(true);
    expect(hit("/player/characters/7")).toBe(false);
    expect(hit("/players/4")).toBe(false);
  });
});

describe("сигнал «кампания изменилась»", () => {
  const hit = (type: string, detail: unknown, path: string) =>
    (affectsForWindowEvent(type, detail) ?? []).some((a) => matchesAffect(dataKeys.resource(path), a));

  it("у игрока задевает всё выданное своей кампании, но не чужой", () => {
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/player/campaigns/2/visible")).toBe(true);
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/player/campaigns/2/world-entries")).toBe(true);
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/player/characters/5")).toBe(false);
  });

  it("у Мастера задевает записи игроков, но не остальной профиль", () => {
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/campaigns/2/player-journals")).toBe(true);
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/campaign-entries?campaign_id=2&category=quotes")).toBe(true);
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/campaign-entries?campaign_id=20&category=quotes")).toBe(false);
    expect(hit("campaign-data-changed", { campaignId: 2 }, "/campaigns/2/sessions")).toBe(false);
  });

  it("после обрыва связи перечитывается всё открытое", () => {
    expect(affectsForWindowEvent("realtime-reconnected", undefined)).toEqual([]);
  });
});
