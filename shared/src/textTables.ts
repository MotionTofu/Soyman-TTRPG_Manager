/** Versioned table blocks shared by rendering, editing and mention rewrites. */
export interface TableCell {
  text: string;
  bold?: boolean;
  italic?: boolean;
  color?: string;
  size?: number;
  font?: string;
  align?: "left" | "center" | "right";
}
export interface TextTable { version: 1; id: string; header: boolean; cells: TableCell[][] }
export interface StoredTableBlock { from: number; to: number; table: TextTable }
export const MAX_TABLE_CELLS = 10000;

export function serializeTextTable(table: TextTable): string {
  return `{table}\n${JSON.stringify(table).replaceAll("{/table}", "\\u007b/table}")}\n{/table}`;
}
export function parseTextTable(json: string): TextTable | null {
  try {
    const data: unknown = JSON.parse(json);
    if (!data || typeof data !== "object") return null;
    const obj = data as Record<string, unknown>;
    if (obj.version !== 1 || typeof obj.id !== "string" || !/^[\w-]{1,80}$/.test(obj.id) || typeof obj.header !== "boolean" || !Array.isArray(obj.cells) || !obj.cells.length) return null;
    const width = Array.isArray(obj.cells[0]) ? obj.cells[0].length : 0;
    if (!width || obj.cells.length * width > MAX_TABLE_CELLS) return null;
    const cells: TableCell[][] = [];
    for (const row of obj.cells) {
      if (!Array.isArray(row) || row.length !== width) return null;
      const next: TableCell[] = [];
      for (const cell of row) {
        if (!cell || typeof cell !== "object" || typeof cell.text !== "string") return null;
        const safe: TableCell = { text: cell.text };
        if (cell.bold === true) safe.bold = true;
        if (cell.italic === true) safe.italic = true;
        if (typeof cell.color === "string" && /^#[\da-f]{3,8}$/i.test(cell.color)) safe.color = cell.color;
        if (typeof cell.size === "number" && Number.isFinite(cell.size) && cell.size >= 8 && cell.size <= 72) safe.size = cell.size;
        if (typeof cell.font === "string" && cell.font.length <= 200) safe.font = cell.font;
        if (cell.align === "left" || cell.align === "center" || cell.align === "right") safe.align = cell.align;
        next.push(safe);
      }
      cells.push(next);
    }
    return { version: 1, id: obj.id, header: obj.header, cells };
  } catch { return null; }
}

export function findStoredTableBlocks(source: string): StoredTableBlock[] {
  if (!source.includes("{table}")) return [];
  const blocks: StoredTableBlock[] = [];
  for (const match of source.matchAll(/^\{table\}\r?\n([\s\S]*?)\r?\n\{\/table\}(?=\r?\n|$)/gm)) {
    const table = parseTextTable(match[1]);
    if (table) blocks.push({ from: match.index, to: match.index + match[0].length, table });
  }
  return blocks;
}

/** Rewrite decoded cell text and JSON-escape it again, leaving untouched blocks byte-identical. */
export function mapTextTableContent(source: string, transform: (text: string) => string): string {
  const blocks = findStoredTableBlocks(source);
  if (!blocks.length) return transform(source);
  let from = 0, out = "";
  for (const block of blocks) {
    out += transform(source.slice(from, block.from));
    let changed = false;
    const cells = block.table.cells.map(row => row.map(cell => {
      const text = transform(cell.text);
      changed ||= text !== cell.text;
      return { ...cell, text };
    }));
    out += changed ? serializeTextTable({ ...block.table, cells }) : source.slice(block.from, block.to);
    from = block.to;
  }
  return out + transform(source.slice(from));
}

export function decodeTableJsonText(value: string): string {
  try { return JSON.parse(`"${value}"`) as string; } catch { return value; }
}
