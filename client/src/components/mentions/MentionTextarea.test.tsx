// @vitest-environment jsdom
import { useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionTextarea } from "./MentionTextarea";
import { MentionText } from "./MentionText";
import { createTextTable, findTextTables, serializeTextTable } from "./tableDocument";
import { plainMentions } from "../../utils/plainMentions";

vi.mock("./MentionPickerModal", () => ({ MentionPickerModal: ({ onPick }: { onPick: (result: unknown) => void }) => <button onClick={() => onPick({ type: "being", id: 42, title: "Подпись" })}>Выбрать сущность</button> }));
vi.mock("../../mentions", () => ({ buildMentionToken: vi.fn(async () => "[[being@12345678|Мир|Подпись]]"), useMentionIndex: () => 0, ANY_MENTION_RE: /\[\[([^\]]+)\]\]/g, isMentionIndexReady: () => true, resolveMention: () => null, mentionTone: () => "being" }));
afterEach(cleanup);

function Harness({ initial = "", rows = 5, keyboard = vi.fn() }: { initial?: string; rows?: number; keyboard?: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void }) {
  const [value, setValue] = useState(initial);
  return <><MentionTextarea value={value} onChange={setValue} rows={rows} onKeyDown={keyboard} /><output data-testid="source">{value}</output></>;
}
function source() { return screen.getByTestId("source").textContent ?? ""; }
function focus(input: HTMLElement) { act(() => input.focus()); }

describe("MentionTextarea panels and visual tables", () => {
  it("shows only @ and link while focused; formatting lives in the right-click menu", () => {
    render(<Harness initial="Текст" rows={8} />);
    expect(screen.queryByRole("button", { name: "Упоминание" })).toBeNull();
    const input = screen.getByRole("textbox");
    focus(input);
    expect(screen.getByRole("button", { name: "Упоминание" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Внешняя ссылка" })).toBeDefined();
    expect(screen.queryByLabelText("Тип абзаца")).toBeNull();
    fireEvent.contextMenu(input);
    expect(screen.getByRole("menuitem", { name: /Жирный/ })).toBeDefined();
    expect(screen.getByText("Shift+ПКМ — меню браузера")).toBeDefined();
  });
  it("Shift+right-click leaves the browser menu alone", () => {
    render(<Harness initial="Текст" />);
    const input = screen.getByRole("textbox");
    focus(input);
    fireEvent.contextMenu(input, { shiftKey: true });
    expect(screen.queryByRole("menu")).toBeNull();
  });
  it("Ctrl+Shift+2 makes a heading and Ctrl+Shift+8 a list", () => {
    render(<Harness initial="Строка" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    focus(input); input.setSelectionRange(2, 2); fireEvent.select(input);
    fireEvent.keyDown(input, { key: "@", code: "Digit2", ctrlKey: true, shiftKey: true });
    expect(source()).toBe("## Строка");
    fireEvent.keyDown(input, { key: "*", code: "Digit8", ctrlKey: true, shiftKey: true });
    expect(source()).toBe("- ## Строка");
  });
  it("keeps selected prose and Cyrillic Ctrl+B shortcuts", async () => {
    render(<Harness initial="Первый второй" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    focus(input); input.setSelectionRange(7, 13); fireEvent.select(input);
    fireEvent.keyDown(input, { key: "и", code: "KeyB", ctrlKey: true });
    expect(source()).toBe("Первый **второй**");
    await waitFor(() => expect(input.selectionStart).toBe(9));
    fireEvent.keyDown(input, { key: "ш", code: "KeyI", ctrlKey: true });
    expect(source()).toBe("Первый ***второй***");
  });
  it("opens existing Markdown tables as cells and preserves surrounding prose on cell edits", () => {
    render(<Harness initial={'До\n\n| A | B |\n| --- | --- |\n| x | y |\n\nПосле'} />);
    const cell = screen.getByRole("textbox", { name: "Ячейка A2" });
    focus(cell); fireEvent.change(cell, { target: { value: "новый\nтекст | ячейки" } });
    const table = findTextTables(source())[0].table;
    expect(table.cells[1][0].text).toBe("новый\nтекст | ячейки");
    expect(table.cells[1][1].text).toBe("y");
    expect(source().startsWith("До\n\n")).toBe(true);
    expect(source().endsWith("\n\nПосле")).toBe(true);
    expect((screen.getByRole("textbox", { name: "Ячейка A2" }) as HTMLTextAreaElement).value).toBe("новый\nтекст | ячейки");
  });
  it("adds and deletes columns, toggles headers and formats a cell with shortcuts", async () => {
    render(<Harness initial={serializeTextTable(createTextTable(2, 2))} />);
    const cell = screen.getByRole("textbox", { name: "Ячейка A2" });
    focus(cell);
    fireEvent.keyDown(cell, { key: "b", code: "KeyB", ctrlKey: true });
    expect(findTextTables(source())[0].table.cells[1][0].bold).toBe(true);
    fireEvent.keyDown(cell, { key: "i", code: "KeyI", ctrlKey: true });
    expect(findTextTables(source())[0].table.cells[1][0].italic).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "+ Столбец" }));
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Ячейка B2"));
    expect(findTextTables(source())[0].table.cells[0]).toHaveLength(3);
    fireEvent.click(screen.getByText("Ещё"));
    fireEvent.click(screen.getByRole("checkbox", { name: "Строка заголовков" }));
    expect(findTextTables(source())[0].table.header).toBe(false);
    fireEvent.click(screen.getByRole("button", { name: "Удалить столбец" }));
    expect(findTextTables(source())[0].table.cells[0]).toHaveLength(2);
  });
  it.each([false, true])("commits color only after native change, including in cells (%s)", (inCell) => {
    render(<Harness initial={inCell ? serializeTextTable(createTextTable(2, 2)) : "Выбранный текст"} />);
    const input = (inCell ? screen.getByRole("textbox", { name: "Ячейка A2" }) : screen.getByRole("textbox")) as HTMLTextAreaElement;
    focus(input);
    if (!inCell) { input.setSelectionRange(0, input.value.length); fireEvent.select(input); }
    fireEvent.contextMenu(input);
    fireEvent.click(screen.getByRole("menuitem", { name: "Стиль…" }));
    const color = screen.getByLabelText("Цвет текста");
    const before = source();
    fireEvent.input(color, { target: { value: "#112233" } });
    fireEvent.input(color, { target: { value: "#445566" } });
    expect(source()).toBe(before);
    expect(screen.getByLabelText("Цвет текста")).toBe(color);
    fireEvent.change(color, { target: { value: "#445566" } });
    expect(screen.queryByLabelText("Цвет текста")).toBeNull();
    if (inCell) expect(findTextTables(source())[0].table.cells[1][0].color).toBe("#445566");
    else expect(source()).toBe('{span color="#445566"}Выбранный текст{/span}');
  });
  it("Tab from the last cell creates a row and moves the caret into it", async () => {
    render(<Harness initial={serializeTextTable(createTextTable(2, 2))} />);
    const input = screen.getByRole("textbox", { name: "Ячейка B2" });
    focus(input); fireEvent.keyDown(input, { key: "Tab" });
    expect(findTextTables(source())[0].table.cells).toHaveLength(3);
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Ячейка A3"));
  });
  it("inserts a table at the selected prose position and leaves it editable", async () => {
    render(<Harness initial="ДоПосле" />);
    const input = screen.getByRole("textbox") as HTMLTextAreaElement;
    focus(input); input.setSelectionRange(2, 2); fireEvent.select(input);
    fireEvent.contextMenu(input);
    fireEvent.click(screen.getByRole("menuitem", { name: "Таблица…" }));
    fireEvent.click(screen.getByRole("button", { name: "Создать" }));
    expect(findTextTables(source())).toHaveLength(1);
    expect(source().startsWith("До\n")).toBe(true);
    expect(source().endsWith("\nПосле")).toBe(true);
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Ячейка A2"));
  });
  it("inserts an @ mention into a cell without touching adjacent cells", async () => {
    render(<Harness initial={serializeTextTable(createTextTable(2, 2))} />);
    const input = screen.getByRole("textbox", { name: "Ячейка A2" });
    focus(input); fireEvent.change(input, { target: { value: "@" } });
    fireEvent.click(screen.getByRole("button", { name: "Выбрать сущность" }));
    await waitFor(() => expect(findTextTables(source())[0].table.cells[1][0].text).toBe("[[being@12345678|Мир|Подпись]]"));
    expect(findTextTables(source())[0].table.cells[1][1].text).toBe("");
  });
  it("preserves prose after a table and inserts links at its selected offset", () => {
    render(<Harness initial={`До\n${serializeTextTable(createTextTable(2, 2))}\nПосле`} />);
    const input = screen.getByRole("textbox", { name: "Продолжение текста" }) as HTMLTextAreaElement;
    focus(input); input.setSelectionRange(1, 6); fireEvent.select(input);
    fireEvent.keyDown(input, { key: "k", code: "KeyK", ctrlKey: true });
    fireEvent.change(screen.getByRole("textbox", { name: "Адрес ссылки" }), { target: { value: "https://example.org" } });
    fireEvent.click(screen.getByRole("button", { name: "Вставить ссылку" }));
    expect(source().endsWith("\n[После](https://example.org)")).toBe(true);
    expect(findTextTables(source())).toHaveLength(1);
  });
  it("renders saved cell styles, mentions and raw HTML safely and extracts readable summaries", () => {
    const table = createTextTable(2, 2);
    table.header = false;
    table.cells[0][0] = { text: "Первый\nвторой", bold: true, color: "#aa3300" };
    table.cells[1][0].text = '<script>alert(1)</script>';
    const stored = serializeTextTable(table);
    const { container } = render(<MentionText text={stored} mentionsAsBold />);
    expect(container.querySelectorAll("td")).toHaveLength(4);
    expect(container.querySelector("thead")).toBeNull();
    expect(container.querySelector("td")?.getAttribute("style")).toContain("font-weight: bold");
    expect(container.querySelector("script")).toBeNull();
    expect(plainMentions(stored)).toContain("Первый\nвторой");
    expect(plainMentions(stored)).not.toContain('"version"');
  });
  it("keeps the host chat's keyboard for prose while letting cells accept newlines", () => {
    const keyboard = vi.fn();
    render(<Harness initial={serializeTextTable(createTextTable(2, 2))} keyboard={keyboard} />);
    const prose = screen.getAllByRole("textbox")[0];
    focus(prose); fireEvent.keyDown(prose, { key: "Enter" });
    expect(keyboard).toHaveBeenCalledTimes(1);
    const cell = screen.getByRole("textbox", { name: "Ячейка A2" });
    focus(cell); fireEvent.keyDown(cell, { key: "Enter" });
    expect(keyboard).toHaveBeenCalledTimes(1);
  });
  it("keeps tables visual when adjacent prose loses its boundary newlines", () => {
    render(<Harness initial={`До\n${serializeTextTable(createTextTable(2, 2))}\nПосле`} />);
    const before = screen.getAllByRole("textbox")[0];
    fireEvent.change(before, { target: { value: "Перед" } });
    expect(source().startsWith("Перед\n{table}")).toBe(true);
    const after = screen.getByRole("textbox", { name: "Продолжение текста" });
    fireEvent.change(after, { target: { value: "Следом" } });
    expect(source().endsWith("{/table}\nСледом")).toBe(true);
    expect(findTextTables(source())).toHaveLength(1);
    expect(screen.getByRole("textbox", { name: "Ячейка A2" })).toBeDefined();
    fireEvent.change(before, { target: { value: "" } });
    fireEvent.change(screen.getByRole("textbox", { name: "Продолжение текста" }), { target: { value: "" } });
    expect(findTextTables(source())).toHaveLength(1);
  });
  it("drops an entity into the hovered cell rather than the previously selected cell", async () => {
    render(<Harness initial={serializeTextTable(createTextTable(2, 2))} />);
    focus(screen.getByRole("textbox", { name: "Ячейка A2" }));
    fireEvent.drop(screen.getByRole("textbox", { name: "Ячейка B2" }), {
      dataTransfer: { getData: () => JSON.stringify({ type: "being", id: 42, title: "Подпись" }) },
    });
    await waitFor(() => expect(findTextTables(source())[0].table.cells[1][1].text).toBe("[[being@12345678|Мир|Подпись]]"));
    expect(findTextTables(source())[0].table.cells[1][0].text).toBe("");
  });
  it("restores a deleted table with undo and reapplies deletion with redo", async () => {
    render(<Harness initial={`До\n${serializeTextTable(createTextTable(2, 2))}\nПосле`} />);
    focus(screen.getByRole("textbox", { name: "Ячейка A2" }));
    fireEvent.click(screen.getByText("Ещё"));
    fireEvent.click(screen.getByRole("button", { name: "Удалить таблицу" }));
    expect(findTextTables(source())).toHaveLength(0);
    const input = screen.getByRole("textbox");
    focus(input); fireEvent.keyDown(input, { ctrlKey: true, code: "KeyZ", key: "z" });
    expect(findTextTables(source())).toHaveLength(1);
    await waitFor(() => expect(document.activeElement?.getAttribute("aria-label")).toBe("Ячейка A2"));
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Ячейка A2" }), { ctrlKey: true, code: "KeyY", key: "y" });
    expect(findTextTables(source())).toHaveLength(0);
    expect(source()).toBe("До\n\nПосле");
  });
});
