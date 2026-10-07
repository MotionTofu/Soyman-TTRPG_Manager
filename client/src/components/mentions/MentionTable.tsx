import { useEffect, useRef, type KeyboardEvent } from "react";
import { tableCellStyle, type TextTable } from "./tableDocument";
import { scheduleAutoResize, cancelAutoResize } from "./textareaAutoResize";
import { MAX_TABLE_CELLS } from "@shared/textTables";

export interface TableSelection { id: string; row: number; column: number }

interface Props {
  table: TextTable;
  selection: TableSelection | null;
  onSelect: (selection: TableSelection, element: HTMLTextAreaElement) => void;
  onChange: (table: TextTable) => void;
  onDelete: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCellChange: (text: string, element: HTMLTextAreaElement) => void;
  onCellDrop: (event: React.DragEvent<HTMLTextAreaElement>) => void;
}

export function MentionTable({ table, selection, onSelect, onChange, onDelete, onKeyDown, onCellChange, onCellDrop }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const selected = selection?.id === table.id;
  const row = selected ? Math.min(selection.row, table.cells.length - 1) : 0;
  const column = selected ? Math.min(selection.column, table.cells[0].length - 1) : 0;
  const canAddRow = (table.cells.length + 1) * table.cells[0].length <= MAX_TABLE_CELLS;
  const canAddColumn = table.cells.length * (table.cells[0].length + 1) <= MAX_TABLE_CELLS;

  useEffect(() => {
    if (typeof CSS !== "undefined" && CSS.supports?.("field-sizing", "content")) return;
    const inputs = Array.from(host.current?.querySelectorAll<HTMLTextAreaElement>(".rt-table-cell-input") ?? []);
    inputs.forEach(scheduleAutoResize);
    return () => inputs.forEach(cancelAutoResize);
  }, [table]);

  function focus(r: number, c: number) {
    requestAnimationFrame(() => {
      const input = host.current?.querySelector<HTMLTextAreaElement>(`[data-row="${r}"][data-column="${c}"]`);
      input?.focus();
      if (input) onSelect({ id: table.id, row: r, column: c }, input);
    });
  }
  function changeStructure(action: "row+" | "column+" | "row-" | "column-") {
    if (action === "row+" && !canAddRow || action === "column+" && !canAddColumn) return;
    const cells = table.cells.map(line => [...line]);
    let r = row, c = column;
    if (action === "row+") { cells.splice(row + 1, 0, Array.from({ length: cells[0].length }, () => ({ text: "" }))); r++; }
    if (action === "column+") { cells.forEach(line => line.splice(column + 1, 0, { text: "" })); c++; }
    if (action === "row-" && cells.length > 1) { cells.splice(row, 1); r = Math.min(r, cells.length - 1); }
    if (action === "column-" && cells[0].length > 1) { cells.forEach(line => line.splice(column, 1)); c = Math.min(c, cells[0].length - 1); }
    onChange({ ...table, cells });
    host.current?.querySelectorAll("details").forEach(menu => menu.open = false);
    focus(r, c);
  }
  function cellKey(event: KeyboardEvent<HTMLTextAreaElement>, r: number, c: number) {
    onKeyDown(event);
    if (event.defaultPrevented || event.key !== "Tab") return;
    const width = table.cells[0].length;
    const next = r * width + c + (event.shiftKey ? -1 : 1);
    if (next < 0) return;
    if (next >= table.cells.length * width && !canAddRow) return;
    event.preventDefault();
    if (next >= table.cells.length * width) onChange({ ...table, cells: [...table.cells, Array.from({ length: width }, () => ({ text: "" }))] });
    focus(Math.floor(next / width), next % width);
  }
  const keepSelection = (event: React.MouseEvent) => event.preventDefault();

  return <div ref={host} className={`rt-edit-table${selected ? " is-active" : ""}`}>
    <div className="rt-table-controls">
      <span className="rt-table-dimensions">Таблица · {table.cells.length} × {table.cells[0].length}</span>
      <div className="rt-table-actions" aria-hidden={!selected}>
        <button type="button" className="rt-btn" disabled={!canAddRow} onMouseDown={keepSelection} onClick={() => changeStructure("row+")}>+ Строка</button>
        <button type="button" className="rt-btn" disabled={!canAddColumn} onMouseDown={keepSelection} onClick={() => changeStructure("column+")}>+ Столбец</button>
        <details className="rt-table-more"><summary>Ещё</summary><div className="rt-table-more-menu">
          <label><input type="checkbox" checked={table.header} onChange={event => onChange({ ...table, header: event.target.checked })} /> Строка заголовков</label>
          <button type="button" onMouseDown={keepSelection} disabled={table.cells.length <= 1} onClick={() => changeStructure("row-")}>Удалить строку</button>
          <button type="button" onMouseDown={keepSelection} disabled={table.cells[0].length <= 1} onClick={() => changeStructure("column-")}>Удалить столбец</button>
          <button type="button" onMouseDown={keepSelection} onClick={onDelete}>Удалить таблицу</button>
        </div></details>
      </div>
    </div>
    <div className="rt-table-wrap"><table className="rt-table rt-table-editable" aria-label="Редактируемая таблица">
      <tbody>{table.cells.map((line, r) => <tr key={r}>{line.map((cell, c) => {
        const Cell = table.header && r === 0 ? "th" : "td";
        return <Cell key={c} className={selected && row === r && column === c ? "is-selected" : undefined}>
          <textarea className="rt-table-cell-input" rows={1} data-row={r} data-column={c} style={tableCellStyle(cell)}
            value={cell.text} aria-label={`Ячейка ${String.fromCharCode(65 + c)}${r + 1}`}
            onFocus={event => onSelect({ id: table.id, row: r, column: c }, event.currentTarget)}
            onSelect={event => onSelect({ id: table.id, row: r, column: c }, event.currentTarget)}
            onChange={event => onCellChange(event.target.value, event.currentTarget)}
            onKeyDown={event => cellKey(event, r, c)} onDragOver={event => event.preventDefault()} onDrop={onCellDrop} />
        </Cell>;
      })}</tr>)}</tbody>
    </table></div>
  </div>;
}
