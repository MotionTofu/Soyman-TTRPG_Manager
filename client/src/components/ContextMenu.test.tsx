// @vitest-environment jsdom
import { StrictMode, useState } from "react";
import { afterEach, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";

afterEach(cleanup);

function Example() {
  const [open, setOpen] = useState(false);
  return <>
    <button onClick={() => setOpen(true)}>Действия</button>
    <button>Снаружи</button>
    {open && <ContextMenu x={0} y={0} ariaLabel="Действия" onClose={() => setOpen(false)}
      items={[{ label: "Первое" }, { label: "Второе" }]} />}
  </>;
}

it("стрелки меняют пункт, Escape возвращает фокус на кнопку входа", () => {
  render(<StrictMode><Example /></StrictMode>);
  const trigger = screen.getByRole("button", { name: "Действия" });
  trigger.focus();
  fireEvent.click(trigger);
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Первое" }));
  fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
  expect(document.activeElement).toBe(screen.getByRole("menuitem", { name: "Второе" }));
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(trigger);
});

it("щелчок снаружи закрывает меню и сохраняет фокус выбранного элемента", () => {
  render(<StrictMode><Example /></StrictMode>);
  fireEvent.click(screen.getByRole("button", { name: "Действия" }));
  const outside = screen.getByRole("button", { name: "Снаружи" });
  outside.focus();
  fireEvent.mouseDown(outside);
  expect(screen.queryByRole("menu")).toBeNull();
  expect(document.activeElement).toBe(outside);
});
