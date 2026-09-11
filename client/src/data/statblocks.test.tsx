// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import type { Statblock } from "../types";

const server = vi.hoisted(() => ({
  puts: [] as { path: string; body: unknown; options: unknown }[],
  failures: [] as string[],
  version: 0,
}));

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(),
    put: vi.fn(async (path: string, body: unknown, options: unknown) => {
      server.puts.push({ path, body, options });
      const failure = server.failures.shift();
      if (failure) throw new Error(failure);
      server.version += 1;
      return { id: 5, owner_type: "character", owner_id: 7, content: "склеено сервером", updated_at: `v${server.version}` };
    }),
    post: vi.fn(),
    del: vi.fn(),
  },
}));

const broadcasts = vi.hoisted(() => [] as unknown[]);
vi.mock("../dataSync", () => ({
  notifyDataChanged: (affects: unknown) => broadcasts.push(affects),
  onDataChangedElsewhere: () => () => {},
}));

import { useStatblockQueue, statblockListPath, archivedStatblockListPath } from "./statblocks";
import { dataKeys } from "./entities";
import { getSaveNotices, resetNoticesForTests, retryNotice } from "./notices";

const LIST = statblockListPath("character", 7);
const ARCHIVED = archivedStatblockListPath("character", 7);

function sheet(content: string, updatedAt = "v0"): Statblock {
  return { id: 5, owner_type: "character", owner_id: 7, format: "dnd_character", kind: "full", content, note: "", updated_at: updatedAt } as Statblock;
}

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  client.setQueryData(dataKeys.resource(LIST), [sheet('{"hp":10,"name":"Арья"}')]);
  client.setQueryData(dataKeys.resource(ARCHIVED), [sheet('{"hp":1,"name":"в корзине"}')]);
  server.puts.length = 0;
  server.failures.length = 0;
  server.version = 0;
  broadcasts.length = 0;
  resetNoticesForTests();
});

function useQueue() {
  return useStatblockQueue(sheet('{"hp":10,"name":"Арья"}'), true, 0);
}

describe("очередь быстрых правок статблока", () => {
  it("уходит патчем изменённых полей мимо широковещания и кладётся в кэш списка", async () => {
    const { result } = renderHook(useQueue, { wrapper });
    act(() => result.current.schedule('{"hp":7,"name":"Арья"}'));
    await waitFor(() => expect(result.current.status).toBe("idle"));

    expect(server.puts).toEqual([
      { path: "/statblocks/5", body: { contentPatch: { hp: 7 } }, options: { broadcast: false } },
    ]);
    const list = client.getQueryData<Statblock[]>(dataKeys.resource(LIST))!;
    // Набранное, а не склеенное сервером, и свежая версия из ответа.
    expect(list[0].content).toBe('{"hp":7,"name":"Арья"}');
    expect(list[0].updated_at).toBe("v1");
    // Корзину сохранение не трогает.
    expect(client.getQueryData<Statblock[]>(dataKeys.resource(ARCHIVED))![0].content).toBe('{"hp":1,"name":"в корзине"}');
    expect(broadcasts).toEqual([[{ path: LIST }, { path: "/player/characters/7" }]]);
  });

  it("следующий патч считается от сохранённого, а не от исходного", async () => {
    const { result } = renderHook(useQueue, { wrapper });
    act(() => result.current.schedule('{"hp":7,"name":"Арья"}'));
    await waitFor(() => expect(server.puts.length).toBe(1));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    act(() => result.current.schedule('{"hp":7,"name":"Арья Старк"}'));
    await waitFor(() => expect(server.puts.length).toBe(2));
    expect(server.puts[1].body).toEqual({ contentPatch: { name: "Арья Старк" } });
  });

  it("серия сбоев держит одну плашку, «Повторить» досохраняет и снимает её", async () => {
    const { result } = renderHook(useQueue, { wrapper });
    server.failures.push("Сервер не отвечает (таймаут 10с) — попробуйте ещё раз", "Сервер не отвечает (таймаут 10с) — попробуйте ещё раз");

    act(() => result.current.schedule('{"hp":6,"name":"Арья"}'));
    await waitFor(() => expect(result.current.status).toBe("error"));
    act(() => result.current.schedule('{"hp":5,"name":"Арья"}'));
    await waitFor(() => expect(server.puts.length).toBe(2));
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(getSaveNotices()).toHaveLength(1);

    await act(async () => {
      await retryNotice(getSaveNotices()[0].id);
    });
    expect(getSaveNotices()).toEqual([]);
    expect(result.current.status).toBe("idle");
    expect(server.puts[2].body).toEqual({ contentPatch: { hp: 5 } });
  });

  it("сбой с другим текстом заменяет прежнюю плашку, удачная отправка снимает её сама", async () => {
    const { result } = renderHook(useQueue, { wrapper });
    server.failures.push("таймаут", "Статблок не найден — возможно, он удалён");

    act(() => result.current.schedule('{"hp":6,"name":"Арья"}'));
    await waitFor(() => expect(getSaveNotices()).toHaveLength(1));
    act(() => result.current.schedule('{"hp":5,"name":"Арья"}'));
    await waitFor(() => expect(getSaveNotices()[0]?.message).toBe("Статблок не найден — возможно, он удалён"));
    expect(getSaveNotices()).toHaveLength(1);

    act(() => result.current.schedule('{"hp":4,"name":"Арья"}'));
    await waitFor(() => expect(result.current.status).toBe("idle"));
    expect(getSaveNotices()).toEqual([]);
  });
});
