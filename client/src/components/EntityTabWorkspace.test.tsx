// @vitest-environment jsdom
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EntityTabWorkspace } from "./EntityTabWorkspace";

afterEach(cleanup);

describe("section overview navigation", () => {
  it("returns from an article to the selected section overview", () => {
    const onSelect = vi.fn();
    render(<EntityTabWorkspace sectionOverview
      sections={[{ id: "notes", label: "Записки", items: [{ id: "1", label: "Статья" }] }]}
      selection={{ section: "notes", item: "1" }} onSelect={onSelect}>Содержимое</EntityTabWorkspace>);
    fireEvent.click(screen.getByRole("button", { name: /Записки/ }));
    expect(onSelect).toHaveBeenCalledWith({ section: "notes", item: undefined });
  });

  it("preserves category toggling for workspaces without overview mode", () => {
    const onSelect = vi.fn();
    render(<EntityTabWorkspace
      sections={[{ id: "notes", label: "Записки", items: [{ id: "1", label: "Статья" }] }]}
      selection={{ section: "notes", item: "1" }} onSelect={onSelect}>Содержимое</EntityTabWorkspace>);
    fireEvent.click(screen.getByRole("button", { name: /Записки/ }));
    expect(onSelect).not.toHaveBeenCalled();
  });
});
