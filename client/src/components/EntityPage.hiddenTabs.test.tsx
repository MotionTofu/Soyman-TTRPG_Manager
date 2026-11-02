// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityPage } from "./EntityPage";

vi.mock("./Breadcrumbs", () => ({ Breadcrumbs: () => null }));
afterEach(cleanup);

describe("редкие вкладки профиля", () => {
  it("показывает активный раздел, который подгрузился после первого рендера", () => {
    const rectangles = vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      return this.getAttribute("role") === "tablist" ? new DOMRect(0, 0, 100, 20) : new DOMRect(200, 0, 100, 20);
    });
    try {
      const view = render(<EntityPage crumbs={[]} entityType="system" title="Правила" sheet tabs={["Обзор"]} tab="late">Раздел</EntityPage>);
      const nav = screen.getByRole("tablist");
      expect(nav.scrollLeft).toBe(0);
      view.rerender(<EntityPage crumbs={[]} entityType="system" title="Правила" sheet tabs={["Обзор", { id: "late", label: "Испытания", count: 60 }]} tab="late">Раздел</EntityPage>);
      expect(nav.scrollLeft).toBe(200);
    } finally { rectangles.mockRestore(); }
  });

  it("сохраняет прежнюю полосу для остальных профилей", () => {
    render(<EntityPage crumbs={[]} entityType="campaign" title="Дозоры" paper tabs={["Обзор"]} hiddenTabs={["Оплата", "Итоги"]} tab="Оплата"><p>Данные оплаты</p></EntityPage>);
    expect(screen.getByRole("tab", { name: "Оплата" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Ещё ▾" })).toBeTruthy();
  });

  it("открытая редкая вкладка заменяет Ещё и позволяет выбрать другую", () => {
    const onTab=vi.fn();
    const view=render(<EntityPage crumbs={[]} entityType="setting" title="Эстария" paper tabs={["Обзор"]} hiddenTabs={["Сокровищница", "Библиотека"]} promoteHiddenTab hiddenTabCounts={{Сокровищница:27}} tab="Сокровищница" onTab={onTab}><p>Предметы</p></EntityPage>);
    const active=screen.getByRole("tab",{name:"Сокровищница ▾27"});
    expect(active.getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByRole("button",{name:"Ещё ▾"})).toBeNull();
    fireEvent.click(active);
    fireEvent.click(screen.getByRole("button",{name:"Библиотека"}));
    expect(onTab).toHaveBeenCalledWith("Библиотека");
    view.rerender(<EntityPage crumbs={[]} entityType="setting" title="Эстария" paper tabs={["Обзор"]} hiddenTabs={["Сокровищница", "Библиотека"]} promoteHiddenTab hiddenTabCounts={{Библиотека:5}} tab="Библиотека" onTab={onTab}><p>Книги</p></EntityPage>);
    expect(screen.getByRole("tab",{name:"Библиотека ▾5"})).toBeTruthy();
    expect(screen.queryByRole("tab",{name:/Сокровищница/})).toBeNull();
  });
});
