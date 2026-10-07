import { describe, expect, it, vi } from "vitest";
import { findStoredTableBlocks, serializeTextTable, type TextTable } from "@soyman/shared";
vi.mock("../db/db", () => ({ db: { prepare: () => { throw new Error("This test must never access a database"); } } }));
import { formatRef, rewriteMentions, scanMentions } from "./mentions";

describe("mentions inside visual tables", () => {
  const table: TextTable = { version: 1, id: "test-table", header: false, cells: [[{ text: formatRef("being", "12345678", 'Мир "А"', 'Имя "Б"'), bold: true }]] };
  it("decodes source and label without losing the outer string offsets", () => {
    const text = 'До\n' + serializeTextTable(table) + '\nПосле';
    const mention = scanMentions(text)[0];
    expect(mention.kind).toBe("ref");
    expect(mention.label).toBe('Имя "Б"');
    if (mention.kind === "ref") expect(mention.source).toBe('Мир "А"');
    expect(text.slice(mention.start, mention.end)).toBe(mention.raw);
  });
  it("rewrites labels with quotes, newlines, backslashes and a closing delimiter without corrupting the table", () => {
    const text = 'До [[being@12345678|Мир|Снаружи]]\n' + serializeTextTable(table) + '\nПосле';
    const label = 'Новое "имя"\nвторая \\ строка {/table}';
    const next = rewriteMentions(text, mention => mention.kind === "ref" ? formatRef(mention.type, mention.uid, mention.source, label) : null);
    const updated = findStoredTableBlocks(next)[0];
    expect(updated.table.cells[0][0].text).toBe(formatRef("being", "12345678", 'Мир "А"', label));
    expect(updated.table.cells[0][0].bold).toBe(true);
    expect(next.startsWith('До [[being@12345678|Мир|' + label + ']]\n')).toBe(true);
    expect(next.endsWith('\nПосле')).toBe(true);
  });
  it("leaves an unmodified table byte-identical and removes legacy links safely", () => {
    const source = serializeTextTable({ ...table, cells: [[{ text: '[[being:42|Имя "А"]]' }]] });
    expect(rewriteMentions(source, () => null)).toBe(source);
    const next = rewriteMentions(source, mention => mention.label);
    expect(findStoredTableBlocks(next)[0].table.cells[0][0].text).toBe('Имя "А"');
  });
});
