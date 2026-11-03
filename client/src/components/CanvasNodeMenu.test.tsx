// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Node, NodeProps } from "@xyflow/react";
import { CanvasNodeMenuContext, withCanvasNodeMenu } from "./CanvasNodeMenu";
import { PageContextMenu } from "./PageContextMenu";
import { canvasEntity } from "../canvasRoutes";
import { openEntityMenu, openPageMenu } from "../pageMenu";

vi.mock("../data/hooks", () => ({ useAfterWrite: () => vi.fn() }));
vi.mock("../api/currentUser", () => ({ getCachedUser: () => ({ role: "gm" }) }));
vi.mock("../mentions", () => ({ buildMentionToken: vi.fn(async () => null) }));
Object.defineProperty(navigator, "clipboard", { value: { writeText: vi.fn() }, configurable: true });
afterEach(cleanup);

const View = withCanvasNodeMenu(({ data }: NodeProps<Node<{ name: string }>>) => <div>{data.name}</div>);
const props = { id: "being:7", data: { name: "Мирт" }, type: "entity", selected: false, dragging: false, zIndex: 0,
  isConnectable: true, selectable: true, deletable: true, draggable: true, positionAbsoluteX: 0, positionAbsoluteY: 0 };

function setup() {
  const clicked = vi.fn();
  const open = (id: string, x: number, y: number) => {
    const entity = canvasEntity(id, "Мирт");
    if (entity) openEntityMenu(entity, x, y, [
      { label: "Местное действие", onClick: vi.fn() },
      { label: "Снять с доски", danger: true, onClick: vi.fn() },
    ]);
  };
  render(<MemoryRouter><CanvasNodeMenuContext.Provider value={open}>
    <div data-testid="node" onClick={clicked} onContextMenu={(event) => {
      if (event.shiftKey) return;
      event.preventDefault(); open(props.id, event.clientX, event.clientY);
    }}><View {...props} /></div>
  </CanvasNodeMenuContext.Provider><PageContextMenu /></MemoryRouter>);
  return clicked;
}
const labels = () => Array.from(document.querySelectorAll('.context-menu button')).map((item) => item.textContent);

describe("общие действия узла", () => {
  it("⋯ и ПКМ открывают одно меню с разными действиями снятия и архивации", () => {
    const clicked = setup();
    fireEvent.click(screen.getByRole("button", { name: "Действия: Мирт" }));
    expect(clicked).not.toHaveBeenCalled();
    const first = labels();
    expect(first[0]).toBe("Местное действие");
    expect(first.slice(-2)).toEqual(["Снять с доски", "В архив"]);
    fireEvent.keyDown(document, { key: "Escape" });
    fireEvent.contextMenu(screen.getByTestId("node"));
    expect(labels()).toEqual(first);
  });
  it("Shift+ПКМ остаётся системным, Shift+F10 открывает действия узла", () => {
    setup();
    const target = screen.getByRole("button", { name: "Действия: Мирт" });
    expect(fireEvent.contextMenu(target, { shiftKey: true })).toBe(true);
    expect(document.querySelector('.context-menu')).toBeNull();
    target.focus();
    fireEvent.keyDown(target, { key: "F10", shiftKey: true });
    expect(screen.getByRole("menu", { name: "Мирт" })).toBeTruthy();
    expect(labels()).toContain("Снять с доски");
  });
  it("местные действия фона дополняются общими действиями страницы", () => {
    setup();
    act(() => openPageMenu(20, 30, [{ label: "Создать стикер", onClick: vi.fn() }]));
    expect(labels()).toContain("Создать стикер");
    expect(labels()).toContain("Закрепить страницу");
  });
});
