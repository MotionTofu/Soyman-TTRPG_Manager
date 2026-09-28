// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MapEditorPage } from "./MapEditorPage";
import type { MapFull } from "../maps/mapTypes";

const readOnceMock = vi.hoisted(() => vi.fn());

vi.mock("../api/currentUser", () => ({ useCurrentUser: () => ({ user: { role: "gm" } }) }));
vi.mock("../data/hooks", () => ({
  useAfterWrite: () => () => {},
  useResource: () => ({ data: null, error: null }),
  write: {},
}));
vi.mock("../data/imperative", () => ({ readOnce: readOnceMock }));
vi.mock("../maps/editor/components/MapViewport", () => ({
  MapViewport: ({ view }: { view: { canEdit: boolean } }) =>
    <div data-testid="map-viewport" data-can-edit={String(view.canEdit)}>Холст карты</div>,
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  readOnceMock.mockImplementation(() => new Promise(() => {}));
});

function mockMap(grid: MapFull["grid"]) {
  const map: MapFull = {
    id: 1, name: "Пробная карта", grid, scale: "region", width: 8, height: 8,
    cell_lore: "2 км", seed: 1, sea: 55, mountains: 12, forest: 30,
    thumbnail: null, player_visible: 0, parent_map_id: null,
    created_at: "2026-09-28", updated_at: "2026-09-28",
    cells: JSON.stringify({ v: 1, cells: {}, roads: [] }),
  };
  readOnceMock.mockImplementation((path: string) => Promise.resolve(path === "/maps/1" ? map : []));
}

function renderEditor() {
  render(
    <MemoryRouter initialEntries={["/maps/1"]}>
      <Routes>
        <Route path="/maps/:id" element={<MapEditorPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("MapEditorPage", () => {
  it("открывает страницу карты без ошибки во время первого render", () => {
    renderEditor();
    expect(screen.getByText("Загрузка карты…")).toBeTruthy();
  });

  it("меняет набор инструментов, сохраняя сетку и независимую вкладку материалов", async () => {
    mockMap("hex");
    renderEditor();
    const localMode = await screen.findByRole("tab", { name: "Местность" });
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    expect(modeTools.getByRole("button", { name: "Маркер" })).toBeTruthy();
    fireEvent.click(localMode);
    expect(localMode.getAttribute("aria-selected")).toBe("true");
    expect(modeTools.getByRole("button", { name: "Стена" })).toBeTruthy();
    expect(modeTools.queryByRole("button", { name: "Маркер" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Поверхность" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Каменный пол" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Деревянный пол" }));
    fireEvent.click(screen.getByRole("tab", { name: "Биомы" }));
    expect(localMode.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Лес" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Поверхность" }));
    expect(screen.getByRole("button", { name: "Деревянный пол" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(modeTools.getByRole("button", { name: "Стена" }));
    expect(screen.getByRole("toolbar", { name: "Параметры стены" })).toBeTruthy();
    expect(screen.getByText("Гексы")).toBeTruthy();
    expect(screen.getByText("Холст карты")).toBeTruthy();
  });

  it("показывает инструменты подземелья, блокирует двери на гексах и сохраняет горячие клавиши", async () => {
    mockMap("hex");
    renderEditor();
    fireEvent.click(await screen.findByRole("tab", { name: "Подземелье" }));
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    expect(modeTools.getByRole("button", { name: "Ловушка" })).toBeTruthy();
    const door = modeTools.getByRole("button", { name: "Дверь" }) as HTMLButtonElement;
    expect(door.disabled).toBe(true);
    expect(door.title).toContain("квадратной сетке");
    expect(modeTools.getByRole("button", { name: "Прямоугольник" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { code: "KeyD" });
    expect(modeTools.getByRole("button", { name: "Прямоугольник" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(window, { code: "KeyR" });
    expect(screen.getByRole("button", { name: "Скрыть остальные инструменты" }).getAttribute("aria-expanded")).toBe("true");
    expect(within(screen.getByRole("toolbar", { name: "Остальные инструменты" })).getByRole("button", { name: "Дорога" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("tab", { name: "Регион" }));
    fireEvent.click(screen.getByRole("tab", { name: "Подземелье" }));
    expect(modeTools.getByRole("button", { name: "Прямоугольник" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("позволяет поставить дверь на квадратной сетке", async () => {
    mockMap("square");
    renderEditor();
    fireEvent.click(await screen.findByRole("tab", { name: "Подземелье" }));
    const door = within(screen.getByRole("toolbar", { name: "Инструменты режима" })).getByRole("button", { name: "Дверь" }) as HTMLButtonElement;
    expect(door.disabled).toBe(false);
    fireEvent.click(door);
    expect(door.getAttribute("aria-pressed")).toBe("true");
  });

  it("включает туман и управляет раскрытием всей карты с панели", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("tab", { name: "Регион" });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Основные инструменты" })).getByRole("button", { name: "Туман" }));
    fireEvent.click(screen.getByRole("button", { name: "Включить туман · скрыть всё" }));
    expect(screen.getByText("Открыто 0 из 64 клеток")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Показать всё" }));
    expect(screen.getByText("Открыто 64 из 64 клеток")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть всё" }));
    expect(screen.getByText("Открыто 0 из 64 клеток")).toBeTruthy();
    expect(screen.getByRole("button", { name: "←" }).hasAttribute("disabled")).toBe(false);
  });

  it("в просмотре игрока скрывает правки и оставляет камеру; история не меняется", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("tab", { name: "Регион" });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Основные инструменты" })).getByRole("button", { name: "Туман" }));
    fireEvent.click(screen.getByRole("button", { name: "Включить туман · скрыть всё" }));
    fireEvent.click(screen.getByRole("button", { name: "Показать всё" }));
    expect(screen.getByText("Открыто 64 из 64 клеток")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Глазами игрока" }));
    expect(screen.getByRole("status").textContent).toContain("редактирование отключено");
    expect(screen.getByTestId("map-viewport").getAttribute("data-can-edit")).toBe("false");
    expect(screen.queryByRole("toolbar", { name: "Команды карты" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Скрыть всё" })).toBeNull();
    expect(screen.getByRole("button", { name: "Приблизить" })).toBeTruthy();
    fireEvent.keyDown(window, { code: "KeyZ", ctrlKey: true });

    fireEvent.click(screen.getByRole("button", { name: "Глазами игрока" }));
    expect(screen.getByTestId("map-viewport").getAttribute("data-can-edit")).toBe("true");
    expect(screen.getByText("Открыто 64 из 64 клеток")).toBeTruthy();
  });
});
