import { randomUUID } from "../../utils/uuid";
import { marked, type Tokens } from "marked";
import type { CSSProperties } from "react";
import { parseTextTable, serializeTextTable, type TableCell, type TextTable } from "@shared/textTables";
export { parseTextTable, serializeTextTable, type TableCell, type TextTable } from "@shared/textTables";
export interface TableBlock { kind: "table"; from: number; to: number; table: TextTable; stored: boolean }
export interface ProseBlock { kind: "text"; from: number; to: number; key: string; text: string }
export type EditorBlock = TableBlock | ProseBlock;

export function createTextTable(rows: number, columns: number, values?: string[][]): TextTable {
  return {
    version: 1, id: randomUUID(), header: true,
    cells: Array.from({ length: Math.max(1, rows) }, (_, r) => Array.from({ length: Math.max(1, columns) }, (_, c) => ({
      text: values?.[r]?.[c] ?? (r === 0 ? `Заголовок ${c + 1}` : ""),
    }))),
  };
}

export function tableCellStyle(cell: TableCell): CSSProperties {
  return { fontWeight: cell.bold ? "bold" : undefined, fontStyle: cell.italic ? "italic" : undefined,
    color: cell.color, fontSize: cell.size, fontFamily: cell.font, textAlign: cell.align };
}

/** Top-level tables only: fenced examples, quotations and lists remain prose. */
export function findTextTables(source: string, includeMarkdown = true): TableBlock[] {
  if (!source.includes("{table}") && (!includeMarkdown || !source.includes("|"))) return [];
  // Marked normalizes CRLF. Keep a map back to the untouched persisted string.
  let text = "";
  const offsets = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\r") {
      if (source[i + 1] === "\n") i++;
      text += "\n";
    } else text += source[i];
    offsets.push(i + 1);
  }
  let marker = "\uE100";
  while (text.includes(marker)) marker = String.fromCharCode(marker.charCodeAt(0) + 1);
  // Mention pipes are data, not column delimiters. Mask without shifting offsets.
  const masked = text.replace(/\[\[[^\]\n]+\]\]/g, token => token.replaceAll("|", marker));
  const tokens = marked.lexer(masked, { gfm: true });
  const excluded: { from: number; to: number }[] = [];
  const legacy: TableBlock[] = [];
  let offset = 0;
  for (const token of tokens) {
    const from = offset;
    offset += token.raw.length;
    if (["code", "blockquote", "list", "html"].includes(token.type)) excluded.push({ from, to: offset });
    if (includeMarkdown && token.type === "table") {
      const t = token as Tokens.Table;
      const toCell = (cell: Tokens.TableCell): TableCell => ({ text: cell.text.replaceAll(marker, "|"), align: cell.align ?? undefined });
      legacy.push({ kind: "table", from: offsets[from], to: offsets[offset], stored: false,
        table: { version: 1, id: `legacy-${legacy.length}`, header: true, cells: [t.header.map(toCell), ...t.rows.map(row => row.map(toCell))] } });
    }
  }
  const stored: TableBlock[] = [];
  const pattern = /^\{table\}\n([\s\S]*?)\n\{\/table\}(?=\n|$)/gm;
  for (const match of text.matchAll(pattern)) {
    const from = match.index;
    const to = from + match[0].length;
    if (excluded.some(range => from < range.to && to > range.from)) continue;
    const table = parseTextTable(match[1]);
    if (table) stored.push({ kind: "table", from: offsets[from], to: offsets[to], table, stored: true });
  }
  const result = [...stored, ...legacy.filter(block => !stored.some(other => block.from < other.to && block.to > other.from))].sort((a, b) => a.from - b.from);
  // Duplicate copied IDs must still get independent editing surfaces.
  const ids = new Set<string>();
  return result.map(block => {
    let id = block.table.id;
    let copy = 0;
    while (ids.has(id)) id = `${block.table.id.slice(0, 65)}-copy${++copy}`;
    ids.add(id);
    return id === block.table.id ? block : { ...block, table: { ...block.table, id } };
  });
}

export function splitTableDocument(source: string): EditorBlock[] {
  const blocks: EditorBlock[] = [];
  let from = 0, key = "start";
  for (const table of findTextTables(source)) {
    blocks.push({ kind: "text", from, to: table.from, key, text: source.slice(from, table.from) }, table);
    from = table.to;
    key = table.table.id;
  }
  blocks.push({ kind: "text", from, to: source.length, key, text: source.slice(from) });
  return blocks;
}

export function replaceTableBlock(source: string, block: TableBlock, table: TextTable): string {
  return source.slice(0, block.from) + serializeTextTable(table) + source.slice(block.to);
}
