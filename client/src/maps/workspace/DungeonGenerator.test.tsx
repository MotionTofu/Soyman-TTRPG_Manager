// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DungeonGenerator } from "./DungeonGenerator";
import { buildDungeonDocument, DUNGEON_PRESETS } from "./dungeonGeneration";

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const current = () => buildDungeonDocument({ ...DUNGEON_PRESETS[0], seed: 1 }, "paper-ink");
describe("dungeon dialog", () => {
  it("preview, presets and cancellation do not apply; default creates a new map", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined), onClose = vi.fn();
    render(<DungeonGenerator open current={current()} onApply={onApply} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Среднее" }));
    fireEvent.change(screen.getByRole("spinbutton", { name: "Seed — номер варианта" }), { target: { value: "700" } });
    expect(onApply).not.toHaveBeenCalled();
    expect(screen.getByRole("combobox", { name: "Куда применить" })).toHaveProperty("value", "new");
    fireEvent.click(screen.getByRole("button", { name: "Создать карту" }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ v: 6, grid: expect.objectContaining({ columns: 48 }) }), expect.objectContaining({ seed: 700, rooms: 12 }), "new", "Подземелье");
  });
  it("replacement keeps the current size and needs explicit acknowledgment", async () => {
    const onApply = vi.fn().mockResolvedValue(undefined);
    render(<DungeonGenerator open current={current()} onApply={onApply} onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Куда применить" }), { target: { value: "replace" } });
    fireEvent.click(screen.getByRole("button", { name: "Запутанное" }));
    expect(screen.getByRole("spinbutton", { name: "Ширина" })).toHaveProperty("value", "32");
    expect(screen.getByRole("button", { name: "Заменить содержимое" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("checkbox", { name: /Заменить поверхности/ }));
    fireEvent.click(screen.getByRole("button", { name: "Заменить содержимое" }));
    await waitFor(() => expect(onApply).toHaveBeenCalledOnce());
    expect(onApply.mock.calls[0][2]).toBe("replace");
  });
  it("failure retains the dialog and preview for retry; invalid settings cannot apply", async () => {
    const onApply = vi.fn().mockRejectedValue(new Error("Тестовая ошибка создания")), onClose = vi.fn();
    render(<DungeonGenerator open onApply={onApply} onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: "Создать карту" }));
    expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Тестовая ошибка создания");
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("spinbutton", { name: "Ширина" }), { target: { value: "0" } });
    expect(screen.getByRole("button", { name: "Создать карту" })).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Отмена" }));
    expect(onApply).toHaveBeenCalledOnce(); expect(onClose).toHaveBeenCalledOnce();
  });
});
