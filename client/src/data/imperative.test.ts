// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

const server = vi.hoisted(() => ({ gets: [] as string[] }));

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      server.gets.push(path);
      return { path, n: server.gets.length };
    }),
    put: vi.fn(),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

const broadcasts = vi.hoisted(() => [] as unknown[]);
vi.mock("../dataSync", () => ({
  notifyDataChanged: (affects: unknown) => broadcasts.push(affects),
  onDataChangedElsewhere: () => () => {},
}));

import { readResource, afterWriteAnywhere } from "./imperative";
import { queryClient } from "./queryClient";
import { dataKeys } from "./entities";

beforeEach(() => {
  queryClient.clear();
  server.gets.length = 0;
  broadcasts.length = 0;
});

describe("слой данных вне компонентов", () => {
  it("повторное чтение того же пути берётся из кэша, `fresh` идёт на сервер", async () => {
    await readResource("/systems/entries/5");
    await readResource("/systems/entries/5");
    expect(server.gets).toEqual(["/systems/entries/5"]);

    const fresh = await readResource<{ n: number }>("/systems/entries/5", { fresh: true });
    expect(server.gets.length).toBe(2);
    expect(fresh.n).toBe(2);
  });

  it("прочитанное ложится туда же, откуда его возьмёт useResource", async () => {
    await readResource("/systems/entries/9");
    expect(queryClient.getQueryData(dataKeys.resource("/systems/entries/9"))).toEqual({ path: "/systems/entries/9", n: 1 });
  });

  it("после записи задетое устаревает, а другим окнам уходит адресный сигнал", async () => {
    await readResource("/statblocks?owner_type=character&owner_id=7");
    afterWriteAnywhere([{ path: "/statblocks?owner_type=character&owner_id=7" }]);
    expect(queryClient.getQueryState(dataKeys.resource("/statblocks?owner_type=character&owner_id=7"))?.isInvalidated).toBe(true);
    expect(broadcasts).toEqual([[{ path: "/statblocks?owner_type=character&owner_id=7" }]]);
  });
});
