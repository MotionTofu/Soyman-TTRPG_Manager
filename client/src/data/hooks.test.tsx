// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const server = vi.hoisted(() => ({
  beings: new Map<number, { id: number; name: string; tags: string[] }>(),
  gets: [] as string[],
  puts: [] as { path: string; body: unknown; options: unknown }[],
  failNextPut: null as string | null,
}));

vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      server.gets.push(path);
      const id = Number(path.split("/").pop());
      const row = server.beings.get(id);
      if (!row) throw new Error("not found");
      return structuredClone(row);
    }),
    put: vi.fn(async (path: string, body: Record<string, unknown>, options: unknown) => {
      server.puts.push({ path, body, options });
      if (server.failNextPut) {
        const message = server.failNextPut;
        server.failNextPut = null;
        throw new Error(message);
      }
      const id = Number(path.split("/").pop());
      const next = { ...server.beings.get(id)!, ...body };
      server.beings.set(id, next as never);
      return next;
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

import { useEntity, useSaveEntity, useAction } from "./hooks";
import { getSaveNotices, resetNoticesForTests, retryNotice } from "./notices";

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  server.beings.clear();
  server.beings.set(408, { id: 408, name: "Адейо", tags: [] });
  server.gets.length = 0;
  server.puts.length = 0;
  server.failNextPut = null;
  broadcasts.length = 0;
  resetNoticesForTests();
});

function useBeing() {
  return { being: useEntity<{ id: number; name: string; tags: string[] }>("being", 408), saver: useSaveEntity<{ name: string; tags: string[] }>("being", 408) };
}

describe("слой данных", () => {
  it("загружает сущность и отдаёт стабильный reload", async () => {
    const { result, rerender } = renderHook(useBeing, { wrapper });
    expect(result.current.being.loading).toBe(true);
    await waitFor(() => expect(result.current.being.data?.name).toBe("Адейо"));
    const reload = result.current.being.reload;
    const save = result.current.saver.save;
    rerender();
    expect(result.current.being.reload).toBe(reload);
    expect(result.current.saver.save).toBe(save);
  });

  it("сохранение видно сразу, пишет мимо широковещания транспорта и шлёт адресный сигнал", async () => {
    const { result } = renderHook(useBeing, { wrapper });
    await waitFor(() => expect(result.current.being.data).toBeDefined());

    let resolved: boolean | undefined;
    await act(async () => {
      const pending = result.current.saver.save({ name: "Адейо Тихий" });
      await waitFor(() => expect(result.current.being.data?.name).toBe("Адейо Тихий"));
      resolved = await pending;
    });
    expect(resolved).toBe(true);
    expect(server.puts[0]).toMatchObject({ path: "/setting-beings/408", body: { name: "Адейо Тихий" }, options: { broadcast: false } });
    expect(broadcasts).toEqual([[{ kind: "being", id: 408 }]]);
    await waitFor(() => expect(server.gets.length).toBeGreaterThanOrEqual(2));
  });

  it("отказ сервера откатывает значение и даёт плашку, «Повторить» досохраняет", async () => {
    const { result } = renderHook(useBeing, { wrapper });
    await waitFor(() => expect(result.current.being.data).toBeDefined());

    server.failNextPut = "Сервер не отвечает (таймаут 10с) — попробуйте ещё раз";
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.saver.save({ name: "Не сохранится" });
    });
    expect(ok).toBe(false);
    await waitFor(() => expect(result.current.being.data?.name).toBe("Адейо"));
    expect(getSaveNotices()).toEqual([expect.objectContaining({ message: server.puts.length ? "Сервер не отвечает (таймаут 10с) — попробуйте ещё раз" : "" })]);

    await act(async () => {
      await retryNotice(getSaveNotices()[0].id);
    });
    expect(getSaveNotices()).toEqual([]);
    await waitFor(() => expect(result.current.being.data?.name).toBe("Не сохранится"));
  });

  it("прочее действие обновляет задетое, а при ошибке без повтора плашка без кнопки", async () => {
    const { result } = renderHook(() => ({ being: useEntity<{ name: string }>("being", 408), run: useAction() }), { wrapper });
    await waitFor(() => expect(result.current.being.data).toBeDefined());
    const getsBefore = server.gets.length;

    await act(async () => {
      const value = await result.current.run(async () => "готово", { affects: [{ kind: "being", id: 408 }] });
      expect(value).toBe("готово");
    });
    await waitFor(() => expect(server.gets.length).toBe(getsBefore + 1));

    await act(async () => {
      const value = await result.current.run(async () => {
        throw new Error("создать не вышло");
      }, { affects: [], retry: false });
      expect(value).toBeUndefined();
    });
    expect(getSaveNotices()).toEqual([expect.objectContaining({ message: "создать не вышло", retry: undefined })]);
  });
});
