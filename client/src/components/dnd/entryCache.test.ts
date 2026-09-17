import { describe, it, expect, beforeEach, vi } from "vitest";

// Кэш записей листа на ключах слоя данных (группа «системы», часть 2):
// правка записи где угодно должна дойти до открытого листа одной пачкой.

const server = vi.hoisted(() => ({ gets: [] as string[], names: new Map<number, string>() }));

vi.mock("../../api/client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      server.gets.push(path);
      const ids = new URL(`http://x${path}`).searchParams.get("ids")!.split(",").map(Number);
      return ids.filter((id) => server.names.has(id)).map((id) => ({ id, name: server.names.get(id) }));
    }),
  },
}));

import { deadEntryIds, ensureEntries, getCachedEntry, subscribeEntryCache } from "./entryCache";
import { queryClient } from "../../data/queryClient";
import { invalidateAffects } from "../../data/entities";

beforeEach(() => {
  queryClient.clear();
  server.gets.length = 0;
  server.names = new Map([
    [1, "Огненный шар"],
    [2, "Щит"],
  ]);
});

describe("кэш записей компендиума", () => {
  it("недостающее — одной пачкой, повторно — из кэша", async () => {
    await ensureEntries([1, 2]);
    await ensureEntries([1, 2]);
    expect(server.gets).toEqual(["/systems/entries/batch?ids=1,2"]);
    expect(getCachedEntry(1)?.name).toBe("Огненный шар");
  });

  it("правка записи помечает её, лист просыпается и перечитывает только её", async () => {
    await ensureEntries([1, 2]);
    const woke = vi.fn();
    const unsubscribe = subscribeEntryCache(woke);
    server.names.set(1, "Огненный шар (исправлен)");
    await invalidateAffects(queryClient, [{ kind: "compendium_entry", id: 1 }]);
    await Promise.resolve();
    expect(woke).toHaveBeenCalled();
    // До перечитывания лист видит прежнее — без мигания пустотой.
    expect(getCachedEntry(1)?.name).toBe("Огненный шар");
    await ensureEntries([1, 2]);
    expect(server.gets.at(-1)).toBe("/systems/entries/batch?ids=1");
    expect(getCachedEntry(1)?.name).toBe("Огненный шар (исправлен)");
    unsubscribe();
  });

  it("запись, которой нет на сервере, — мёртвая ссылка, а после пометки проверяется снова", async () => {
    await ensureEntries([3]);
    expect(deadEntryIds()).toContain(3);
    await invalidateAffects(queryClient, [{ kind: "compendium_entry" }]);
    await ensureEntries([3]);
    expect(server.gets.filter((g) => g.endsWith("ids=3")).length).toBe(2);
    expect(getCachedEntry(3)).toBeUndefined();
  });
});
