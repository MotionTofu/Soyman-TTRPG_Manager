// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const gets = vi.hoisted(() => [] as string[]);
vi.mock("../api/client", () => ({
  api: {
    get: vi.fn(async (path: string) => {
      gets.push(path);
      return [{ type: "being", id: 1, title: decodeURIComponent(path.split("q=")[1] ?? "") }];
    }),
  },
}));

import { useSearch } from "./search";

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.useFakeTimers();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  gets.length = 0;
});

async function tick(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  // Ответ «сервера» и отрисовка после него.
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

describe("поиск по мере набора", () => {
  it("запрос уходит после паузы в наборе, а промежуточные буквы не ищутся", async () => {
    const { result, rerender } = renderHook(({ path }) => useSearch(path), {
      wrapper,
      initialProps: { path: "/search?q=О" as string | null },
    });
    await tick(100);
    rerender({ path: "/search?q=Оп" });
    await tick(100);
    rerender({ path: "/search?q=Опу" });
    expect(result.current.searching).toBe(true);
    await tick(250);
    expect(gets).toEqual(["/search?q=Опу"]);
    expect(result.current.results.map((r) => r.title)).toEqual(["Опу"]);
    expect(result.current.searching).toBe(false);
  });

  it("стёртое поле — пусто сразу, без запроса и без прежних результатов", async () => {
    const { result, rerender } = renderHook(({ path }) => useSearch(path), {
      wrapper,
      initialProps: { path: "/search?q=Мирт" as string | null },
    });
    await tick(250);
    expect(result.current.results).toHaveLength(1);
    rerender({ path: null });
    expect(result.current.results).toEqual([]);
    expect(result.current.searching).toBe(false);
    rerender({ path: "/search?q=А" });
    expect(result.current.results).toEqual([]);
  });

  it("тот же запрос снова — свежим: переименованное в другом окне находится под новым именем", async () => {
    const { rerender } = renderHook(({ path }) => useSearch(path), {
      wrapper,
      initialProps: { path: "/search?q=Мирт" as string | null },
    });
    await tick(250);
    rerender({ path: null });
    await tick(250);
    rerender({ path: "/search?q=Мирт" });
    await tick(250);
    expect(gets).toEqual(["/search?q=Мирт", "/search?q=Мирт"]);
  });
});
