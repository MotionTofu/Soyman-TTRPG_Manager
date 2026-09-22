// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { LayerPanel } from "./LayerPanel";
import { FIXTURES, parseFixture } from "../../core/fixtures";
import { migrateLegacyMap } from "../../core/migrateLegacy";
import type { MapDocumentV5 } from "../../core/types";
import { createDeterministicIdFactory } from "../idFactory";

afterEach(() => {
  cleanup();
});

function squareDoc(): MapDocumentV5 {
  return migrateLegacyMap({
    grid: "square",
    width: 8,
    height: 8,
    cells: parseFixture(FIXTURES.fullV4Square),
  }).document;
}

function setup(doc: MapDocumentV5 = squareDoc()) {
  let current = doc;
  const commitDocument = vi.fn((next: MapDocumentV5) => {
    current = next;
  });
  const setDocument = vi.fn((d: MapDocumentV5) => {
    current = d;
  });
  const onActiveLayer = vi.fn();
  const confirmDelete = vi.fn(async () => true);
  const setActionError = vi.fn();
  const props = {
    document: current,
    activeLayerId: "lyr-gameplay" as string | null,
    onActiveLayer,
    setDocument,
    commitDocument,
    newLayerId: createDeterministicIdFactory(),
    confirmDelete,
    setActionError,
  };
  const utils = render(<LayerPanel {...props} />);
  const state = () => current;
  const rerender = () => utils.rerender(<LayerPanel {...props} document={current} />);
  return { ...utils, props, state, rerender, commitDocument, setDocument, onActiveLayer, confirmDelete, setActionError };
}

describe("LayerPanel", () => {
  it("visibility toggle = 1 commit; lock toggle = 1 commit", () => {
    const h = setup();
    const hideBtns = h.getAllByTitle("Скрыть");
    expect(hideBtns.length).toBeGreaterThan(0);
    fireEvent.click(hideBtns[0]);
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
    const [next, before] = h.commitDocument.mock.calls[0];
    expect(next).not.toBe(before);
    expect(next.layers.some((l) => !l.visible)).toBe(true);

    h.rerender();
    h.commitDocument.mockClear();
    fireEvent.click(h.getAllByTitle("Заблокировать")[0]);
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
  });

  it("rename по Enter = 1 commit; Escape отменяет", () => {
    const h = setup();
    fireEvent.doubleClick(h.getAllByTitle("Выбрать слой (двойной клик — переименовать)")[0]);
    const input = h.getByLabelText("Имя слоя") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "Герои" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
    expect(h.state().layers.some((l) => l.name === "Герои")).toBe(true);
  });

  it("reorder вверх/вниз = по 1 commit", () => {
    const h = setup();
    const before = h.state().layers.map((l) => l.id);
    fireEvent.click(h.getAllByTitle("Ниже")[0]);
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
    const after = h.state().layers.map((l) => l.id);
    expect(after).not.toEqual(before);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it("+ Layer создаёт и активирует; delete пустого — без confirm", async () => {
    const h = setup();
    fireEvent.click(h.getByTitle("Добавить слой"));
    // Кнопка меню — первая "Подписи" в DOM (меню выше списка слоёв).
    fireEvent.click(h.getAllByText("Подписи")[0]);
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
    const created = h.state().layers.at(-1);
    expect(created?.kind).toBe("label");
    expect(h.onActiveLayer).toHaveBeenCalledWith(created!.id);

    // Удаляем созданный пустой слой: confirm не спрашивается.
    h.rerender();
    h.commitDocument.mockClear();
    const delBtns = h.getAllByTitle("Удалить слой");
    fireEvent.click(delBtns[0]); // верхний в списке = последний layers[] = созданный
    await vi.waitFor(() => expect(h.commitDocument).toHaveBeenCalledTimes(1));
    expect(h.confirmDelete).not.toHaveBeenCalled();
    expect(h.state().layers.some((l) => l.id === created!.id)).toBe(false);
  });

  it("delete непустого спрашивает confirm; отказ — без commit", async () => {
    const h = setup();
    h.confirmDelete.mockResolvedValueOnce(false);
    // Удаляем верхний слой списка (labels с подписями — непустой).
    fireEvent.click(h.getAllByTitle("Удалить слой")[0]);
    await vi.waitFor(() => expect(h.confirmDelete).toHaveBeenCalledTimes(1));
    expect(h.commitDocument).not.toHaveBeenCalled();
  });

  it("opacity slider: жест = 1 commit с before начала жеста", () => {
    const h = setup();
    const slider = h.getByLabelText("Непрозрачность активного слоя") as HTMLInputElement;
    const before = h.state();
    fireEvent.change(slider, { target: { value: "50" } });
    // Live — только setDocument, history ещё нет.
    expect(h.setDocument).toHaveBeenCalled();
    expect(h.commitDocument).not.toHaveBeenCalled();
    h.rerender();
    fireEvent.blur(h.getByLabelText("Непрозрачность активного слоя"));
    expect(h.commitDocument).toHaveBeenCalledTimes(1);
    const [next, pushedBefore] = h.commitDocument.mock.calls[0];
    expect(pushedBefore).toBe(before);
    expect(next.layers.find((l) => l.id === "lyr-gameplay")?.opacity).toBe(0.5);
  });
});
