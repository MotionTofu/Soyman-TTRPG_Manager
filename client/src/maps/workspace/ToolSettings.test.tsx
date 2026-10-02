// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ToolSettings, type BrushSettings } from "./ToolSettings";
afterEach(cleanup);
const settings: BrushSettings = { material: "stone", symbol: "soyman-symbols:tree", orientation: 0, radius: 2, lineWidth: 0.3, scatterProfile: "scatter/forest", density: 1, scatterSize: 1, scatterSeed: 1 };
describe("cell brush controls", () => {
  it.each(["road", "river"] as const)("offers freehand and manual-point modes for %s", tool => {
    const onChange = vi.fn();
    render(<ToolSettings tool={tool} settings={settings} maskEraser={false} onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Режим рисования линии" }), { target: { value: "points" } });
    expect(onChange).toHaveBeenCalledWith({ pathMode: "points" });
  });

  it.each(["brush", "eraser"] as const)("offers cell sizes and rectangle mode for %s", tool => {
    const onChange = vi.fn();
    render(<ToolSettings tool={tool} settings={settings} maskEraser={false} onChange={onChange} />);
    fireEvent.change(screen.getByRole("slider", { name: "Размер кисти (клетки)" }), { target: { value: "4" } });
    expect(onChange).toHaveBeenCalledWith({ cellSize: 4 });
    fireEvent.change(screen.getByRole("combobox", { name: "Режим клеточной кисти" }), { target: { value: "area" } });
    expect(onChange).toHaveBeenCalledWith({ cellMode: "area" });
  });
  it("offers both fill and erase for selected rooms and contours", () => {
    const onPaintRooms = vi.fn(), onClearRooms = vi.fn();
    render(<ToolSettings tool="brush" settings={settings} maskEraser={false} onChange={vi.fn()} selectedRoomCount={2} onPaintRooms={onPaintRooms} onClearRooms={onClearRooms} />);
    fireEvent.click(screen.getByRole("button", { name: "Залить выделенное" }));
    fireEvent.click(screen.getByRole("button", { name: "Стереть выделенное" }));
    expect(onPaintRooms).toHaveBeenCalledOnce(); expect(onClearRooms).toHaveBeenCalledOnce();
  });
  it("keeps a mask eraser on its existing radius controls", () => {
    render(<ToolSettings tool="eraser" settings={settings} maskEraser onChange={vi.fn()} />);
    expect(screen.getByRole("slider", { name: "Размер кисти" })).toBeTruthy();
    expect(screen.queryByRole("combobox", { name: "Режим клеточной кисти" })).toBeNull();
  });
});
