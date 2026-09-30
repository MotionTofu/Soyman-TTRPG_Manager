// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { MapEditorPage } from "./MapEditorPage";
import type { MapFull } from "../maps/mapTypes";
import { migrateLegacyMap } from "../maps/core/migrateLegacy";
import { parseCellsBlob } from "../maps/render";
import { createSplinePath } from "../maps/core/mutations/paths";
import { serializeMapDocument } from "../maps/core/serialize";
import { useState } from "react";
import { MapWorkspaceContext } from "../maps/workspace/workspaceContext";

function WorkspaceEditor() {
  const [rail, setRail] = useState<HTMLDivElement | null>(null);
  return <MapWorkspaceContext.Provider value={{ rail }}><div data-testid="rail" ref={setRail} /><MapEditorPage /></MapWorkspaceContext.Provider>;
}

const readOnceMock = vi.hoisted(() => vi.fn());
const writePutMock = vi.hoisted(() => vi.fn());

vi.mock("../api/currentUser", () => ({ useCurrentUser: () => ({ user: { role: "gm" } }) }));
vi.mock("../data/hooks", () => ({
  useAfterWrite: () => () => {},
  useResource: () => ({ data: null, error: null }),
  write: { put: writePutMock },
}));
vi.mock("../data/imperative", () => ({ readOnce: readOnceMock }));
vi.mock("../maps/editor/components/MapViewport", () => ({
  MapViewport: ({ view }: { view: { canEdit: boolean } }) =>
    <div data-testid="map-viewport" data-can-edit={String(view.canEdit)}>Холст карты</div>,
}));

afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  globalThis.document.body.classList.remove("live-hide-dock", "live-hide-search");
  readOnceMock.mockImplementation(() => new Promise(() => {}));
  writePutMock.mockReset().mockResolvedValue({});
});

function mockMap(grid: MapFull["grid"], cells = JSON.stringify({ v: 1, cells: {}, roads: [] })) {
  const map: MapFull = {
    id: 1, name: "Пробная карта", grid, scale: "region", width: 8, height: 8,
    cell_lore: "2 км", seed: 1, sea: 55, mountains: 12, forest: 30,
    thumbnail: null, player_visible: 0, parent_map_id: null,
    created_at: "2026-09-28", updated_at: "2026-09-28",
    cells,
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

function openModeMenu() {
  const trigger = screen.getByRole("button", { name: "Режим инструментов" });
  if (trigger.getAttribute("aria-expanded") !== "true") fireEvent.click(trigger);
}

function chooseMode(name: string) {
  openModeMenu();
  fireEvent.click(screen.getByRole("tab", { name }));
}

describe("MapEditorPage", () => {
  it("размещает инструменты в rail, настройки и слои открывает поверх карты", async () => {
    mockMap("square");
    render(<MemoryRouter initialEntries={["/maps/1"]}><Routes><Route path="/maps/:id" element={<WorkspaceEditor />} /></Routes></MemoryRouter>);
    await screen.findByRole("button", { name: "Материалы и параметры" });
    expect(within(screen.getByTestId("rail")).getByRole("button", { name: "Кисть" })).toBeTruthy();
    expect(screen.queryByRole("complementary", { name: "Инструменты карты" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Слои и свойства карты" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Материалы и параметры" }));
    expect(screen.getByRole("complementary", { name: "Инструменты карты" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Слои и свойства" }));
    expect(screen.queryByRole("complementary", { name: "Инструменты карты" })).toBeNull();
    expect(screen.getByRole("complementary", { name: "Слои и свойства карты" })).toBeTruthy();
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("complementary", { name: "Слои и свойства карты" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Вид" }));
    expect(screen.queryByRole("checkbox", { name: "Скрыть боковые панели" })).toBeNull();
  });
  it("открывает страницу карты без ошибки во время первого render", () => {
    renderEditor();
    expect(screen.getByText("Загрузка карты…")).toBeTruthy();
  });

  it("переносит команды карты и переключатели вида в верхние меню", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("button", { name: "Карта" });
    expect(screen.getByText(/Пробная карта/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Карта" }));
    for (const label of ["Настройки карты", "Привязки карты", "Дублировать", "Создать новую", "Удалить", "Экспорт PNG", "Экспорт JSON"]) {
      expect(screen.getByRole("button", { name: label })).toBeTruthy();
    }
    fireEvent.click(screen.getByRole("button", { name: "Вид" }));
    const hidden = screen.getByRole("checkbox", { name: "Скрыть боковые панели" });
    expect(hidden).toBeTruthy();
    fireEvent.click(hidden);
    expect(globalThis.document.body.classList.contains("live-hide-dock")).toBe(true);
    expect(globalThis.document.body.classList.contains("live-hide-search")).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Показать игрокам" }));
    expect(writePutMock).toHaveBeenCalledWith("/maps/1", { player_visible: 1 });
    fireEvent.click(screen.getByRole("checkbox", { name: "Сетка" }));
    expect(localStorage.getItem("maps.showGrid")).toBe("0");
    fireEvent.click(screen.getByRole("checkbox", { name: "Координаты" }));
    expect(localStorage.getItem("maps.showCoords")).toBe("1");
    fireEvent.click(screen.getByRole("button", { name: "Инструменты" }));
    expect(screen.getByRole("button", { name: "Генератор" })).toBeTruthy();
    expect(within(screen.getByRole("toolbar", { name: "Команды карты" })).queryByRole("button", { name: "Генератор" })).toBeNull();
  });

  it("меняет набор инструментов, сохраняя сетку и независимую вкладку материалов", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    expect(modeTools.getByRole("button", { name: "Маркер" })).toBeTruthy();
    chooseMode("Местность");
    openModeMenu();
    expect(screen.getByRole("tab", { name: "Местность" }).getAttribute("aria-selected")).toBe("true");
    expect(modeTools.getByRole("button", { name: "Стена" })).toBeTruthy();
    expect(modeTools.queryByRole("button", { name: "Маркер" })).toBeNull();
    expect(screen.getByRole("tab", { name: "Поверхность" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Каменный пол" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Деревянный пол" }));
    fireEvent.click(screen.getByRole("tab", { name: "Биомы" }));
    expect(screen.getByRole("tab", { name: "Местность" }).getAttribute("aria-selected")).toBe("true");
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
    await screen.findByRole("button", { name: "Режим инструментов" });
    chooseMode("Подземелье");
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
    chooseMode("Регион");
    chooseMode("Подземелье");
    expect(modeTools.getByRole("button", { name: "Прямоугольник" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("позволяет поставить дверь на квадратной сетке", async () => {
    mockMap("square");
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
    chooseMode("Подземелье");
    const door = within(screen.getByRole("toolbar", { name: "Инструменты режима" })).getByRole("button", { name: "Дверь" }) as HTMLButtonElement;
    expect(door.disabled).toBe(false);
    fireEvent.click(door);
    expect(door.getAttribute("aria-pressed")).toBe("true");
  });

  it("включает туман и управляет раскрытием всей карты с панели", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Основные инструменты" })).getByRole("button", { name: "Туман" }));
    fireEvent.click(screen.getByRole("button", { name: "Включить туман · скрыть всё" }));
    expect(screen.getByText("Открыто 0 из 64 клеток")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Показать всё" }));
    expect(screen.getByText("Открыто 64 из 64 клеток")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть всё" }));
    expect(screen.getByText("Открыто 0 из 64 клеток")).toBeTruthy();
    expect(screen.getByRole("button", { name: "←" }).hasAttribute("disabled")).toBe(false);
  });

  it("показывает свободную кисть и позволяет раскрывать клетки поверх детального рельефа", async () => {
    mockMap("square");
    renderEditor();
    await screen.findByRole("group", { name: "Способ рисования рельефа" });
    const surface = within(screen.getByRole("group", { name: "Способ рисования рельефа" }));
    expect(surface.getByRole("button", { name: "По клеткам" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(surface.getByRole("button", { name: "Свободная кисть" }));
    expect(surface.getByRole("button", { name: "Свободная кисть" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("Маска")).toBeTruthy();
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    fireEvent.click(modeTools.getByRole("button", { name: "Дорога" }));
    fireEvent.click(modeTools.getByRole("button", { name: "Кисть" }));
    expect(surface.getByRole("button", { name: "Свободная кисть" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(within(screen.getByRole("toolbar", { name: "Основные инструменты" })).getByRole("button", { name: "Туман" }));
    fireEvent.click(screen.getByRole("button", { name: "Включить туман · скрыть всё" }));
    expect(screen.getByText("Открыто 0 из 64 клеток")).toBeTruthy();
    fireEvent.click(surface.getByRole("button", { name: "По клеткам" }));
    expect(surface.getByRole("button", { name: "По клеткам" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("переключает дороги и реки между клетками и сплайнами", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    fireEvent.click(modeTools.getByRole("button", { name: "Дорога" }));
    const drawing = within(screen.getByRole("group", { name: "Способ рисования пути" }));
    expect(drawing.getByRole("button", { name: "По клеткам" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(drawing.getByRole("button", { name: "Сплайн" }));
    expect(drawing.getByRole("button", { name: "Сплайн" }).getAttribute("aria-pressed")).toBe("true");
    const action = within(screen.getByRole("group", { name: "Действие со свободной линией" }));
    fireEvent.click(action.getByRole("button", { name: "Править" }));
    expect(action.getByRole("button", { name: "Править" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText(/Выберите линию, затем точку/)).toBeTruthy();
    fireEvent.click(modeTools.getByRole("button", { name: "Река" }));
    expect(drawing.getByRole("button", { name: "Сплайн" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(drawing.getByRole("button", { name: "По клеткам" }));
    expect(drawing.getByRole("button", { name: "По клеткам" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("сохраняет вручную выбранный слой при смене его видимости", async () => {
    mockMap("square");
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    fireEvent.click(modeTools.getByRole("button", { name: "Дорога" }));
    const layers = within(screen.getByLabelText("Слои карты"));
    const terrain = layers.getByRole("button", { name: "Terrain" });
    fireEvent.click(terrain);
    const row = terrain.closest(".map-layer-row")!;
    expect(row.getAttribute("style")).toContain("outline: 2px solid");
    fireEvent.click(within(row as HTMLElement).getByTitle("Скрыть"));
    expect(row.getAttribute("style")).toContain("outline: 2px solid");
    fireEvent.click(within(row as HTMLElement).getByTitle("Показать"));
    expect(row.getAttribute("style")).toContain("outline: 2px solid");
  });

  it("offers continuation and branching from a selected spline point", async () => {
    const base = migrateLegacyMap({ grid: "square", width: 8, height: 8,
      cells: parseCellsBlob(JSON.stringify({ v: 1, cells: {}, roads: [] })) }).document;
    const created = createSplinePath(base, "lyr-road", {
      id: "editable-spline", kind: "road", width: 0.22,
      styleRef: { type: "builtin", key: "road" },
      nodes: [{ position: { x: 1, y: 1 } }, { position: { x: 2, y: 2 } }],
    });
    if (!created.ok) throw new Error("fixture failed");
    mockMap("square", serializeMapDocument(created.document));
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
    const modeTools = within(screen.getByRole("toolbar", { name: "Инструменты режима" }));
    fireEvent.click(modeTools.getByRole("button", { name: "Дорога" }));
    const drawing = within(screen.getByRole("group", { name: "Способ рисования пути" }));
    fireEvent.click(drawing.getByRole("button", { name: "Сплайн" }));
    fireEvent.click(screen.getByRole("button", { name: "Линия 1" }));
    const actions = within(screen.getByRole("group", { name: "Продолжение и ответвление" }));
    expect(actions.getByRole("button", { name: "Продолжить от точки" })).toBeTruthy();
    fireEvent.click(actions.getByRole("button", { name: "Ответвить от точки" }));
    expect(screen.getByText("Опорных точек: 1")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Отменить" }));
    fireEvent.click(screen.getByRole("button", { name: "Линия 1" }));
    fireEvent.click(within(screen.getByRole("group", { name: "Продолжение и ответвление" }))
      .getByRole("button", { name: "Продолжить от точки" }));
    expect(screen.getByText("Опорных точек: 1")).toBeTruthy();
  });

  it("в просмотре игрока скрывает правки и оставляет камеру; история не меняется", async () => {
    mockMap("hex");
    renderEditor();
    await screen.findByRole("button", { name: "Режим инструментов" });
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
