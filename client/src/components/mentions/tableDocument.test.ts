import { describe, expect, it } from "vitest";
import { createTextTable, findTextTables, parseTextTable, replaceTableBlock, serializeTextTable, splitTableDocument } from "./tableDocument";

describe("editable tables in existing text fields", () => {
  it("keeps cell newlines, pipes, quotes and literal closing delimiters through a save/load", () => {
    const table = createTextTable(2, 2);
    table.cells[1][0] = { text: 'Первый\nвторой | "третий" {/table}', bold: true, color: "#aabbcc" };
    const source = `До\n${serializeTextTable(table)}\nПосле`;
    const blocks = findTextTables(source);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].table).toEqual(table);
    expect(splitTableDocument(source).filter(block => block.kind === "text").map(block => block.text)).toEqual(["До\n", "\nПосле"]);
  });
  it("opens old Markdown tables with mentions and escaped pipes as the correct cells", () => {
    const source = '| Кто | Данные |\n| :--- | ---: |\n| [[being@12345678|Мир|Подпись]] | a\\|b |';
    const block = findTextTables(source)[0];
    expect(block.table.cells[1][0].text).toBe("[[being@12345678|Мир|Подпись]]");
    expect(block.table.cells[1][1].text).toBe("a|b");
    expect(block.table.cells[0][1].align).toBe("right");
  });
  it("edits a table without rewriting surrounding CRLF text or another table", () => {
    const source = 'До\r\n\r\n| A | B |\r\n| --- | --- |\r\n| 1 | 2 |\r\n\r\nПосле\r\n';
    const block = findTextTables(source)[0];
    expect(source.slice(block.from, block.to)).toBe('| A | B |\r\n| --- | --- |\r\n| 1 | 2 |');
    const next = replaceTableBlock(source, block, { ...block.table, header: false });
    expect(next.startsWith("До\r\n\r\n")).toBe(true);
    expect(next.endsWith("\r\n\r\nПосле\r\n")).toBe(true);
    expect(findTextTables(next)[0].table.header).toBe(false);
  });
  it("never promotes code examples or invalid stored data to editable tables", () => {
    const table = serializeTextTable(createTextTable(2, 2));
    expect(findTextTables('```text\n' + table + '\n```')).toEqual([]);
    expect(findTextTables('```text\n| A | B |\n| --- | --- |\n| 1 | 2 |\n```')).toEqual([]);
    expect(findTextTables('{table}\n{"version":1,"cells":[]}\n{/table}')).toEqual([]);
  });
  it("filters styling and rejects ragged or unknown-version data", () => {
    const table = createTextTable(2, 2);
    const malformed = { ...table, cells: [[{ text: "A", color: "url(evil)", size: Infinity, style: "x", bold: true }]] };
    expect(parseTextTable(JSON.stringify(malformed))?.cells).toEqual([[{ text: "A", bold: true }]]);
    expect(parseTextTable(JSON.stringify({ ...table, version: 2 }))).toBeNull();
    expect(parseTextTable(JSON.stringify({ ...table, cells: [[{ text: "A" }], []] }))).toBeNull();
  });
  it("assigns independent editor keys to two copies of the same table", () => {
    const stored = serializeTextTable(createTextTable(2, 2));
    const blocks = findTextTables(`${stored}\n\n${stored}`);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].table.id).not.toBe(blocks[1].table.id);
    const next = replaceTableBlock(`${stored}\n\n${stored}`, blocks[1], { ...blocks[1].table, header: false });
    expect(findTextTables(next).map(block => block.table.header)).toEqual([true, false]);
  });
});
