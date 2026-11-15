// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addToBag, removeFromBag, removeItemsFromBag, setBagRulePinned, useBag, type BagItem } from "./bag";
import { dataKeys } from "./data/entities";
import { queryClient } from "./data/queryClient";

const storage = (activeId: string) => queryClient.setQueryData(dataKeys.resource("/storages"), { activeId });
const rule: BagItem = { type: "compendium_entry", id: 11, kind: "mechanic_item", title: "Укрытие" };

beforeEach(() => {
  localStorage.clear();
  queryClient.clear();
});

afterEach(() => {
  cleanup();
  queryClient.clear();
  localStorage.clear();
});

describe("правила из мешка", () => {
  it("хранит одноимённые ID отдельно и оставляет обычные записи доступными", () => {
    storage("first");
    const { result } = renderHook(useBag);
    act(() => {
      expect(addToBag(rule)).toBe("ok");
      expect(addToBag({ type: "location", id: 6, title: "Доки" })).toBe("ok");
    });
    expect(result.current.items.map((item) => item.title)).toEqual(["Укрытие", "Доки"]);

    act(() => { storage("second"); });
    expect(result.current.items.map((item) => item.title)).toEqual(["Доки"]);
    act(() => { expect(addToBag({ ...rule, title: "Падение" })).toBe("ok"); });
    expect(result.current.items.map((item) => item.title)).toEqual(["Доки", "Падение"]);
    act(() => { storage("first"); });
    expect(result.current.items.map((item) => item.title)).toEqual(["Укрытие", "Доки"]);
  });

  it("привязывает старую запись при повторном добавлении и сохраняет закреплённую при выгрузке", () => {
    localStorage.setItem("rpg-manager-bag-items", JSON.stringify([rule]));
    storage("first");
    const { result } = renderHook(useBag);
    expect(result.current.items[0].rule).toBeUndefined();
    act(() => { expect(addToBag(rule)).toBe("ok"); });
    expect(result.current.items).toHaveLength(1);
    const article = result.current.items[0];
    act(() => {
      expect(setBagRulePinned(article, true)).toBe(true);
      removeItemsFromBag([article]);
    });
    expect(result.current.items[0].rule).toEqual({ storageId: "first", pinned: true });
    act(() => { expect(addToBag(rule)).toBe("duplicate"); });
    act(() => { removeFromBag(article); });
    expect(result.current.items).toEqual([]);
  });
});
