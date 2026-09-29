import { useState } from "react";
import { Modal } from "../Modal";

// Окно «Новая таблица»: строки × столбцы с живой сеткой ячеек. Markdown с
// вертикальными чертами собирается один раз, по «Создать». Общее для
// MentionTextarea и редактора листа.

// Пересобирает сетку под новый размер: что влезает — остаётся, новые ячейки
// шапки — «Заголовок N», новые ячейки тела — пустые.
function resizeGrid(prev: string[][], rows: number, cols: number): string[][] {
  return Array.from({ length: rows }, (_, r) =>
    Array.from({ length: cols }, (_, c) => prev[r]?.[c] ?? (r === 0 ? `Заголовок ${c + 1}` : ""))
  );
}

/** Таблица строкой Markdown, с переводом строки в конце. */
function tableMarkdown(cells: string[][], cols: number): string {
  const rowLine = (row: string[]) => `| ${row.map((c) => c || " ").join(" | ")} |\n`;
  const sepLine = `| ${Array(cols).fill("---").join(" | ")} |\n`;
  return rowLine(cells[0] ?? []) + sepLine + cells.slice(1).map(rowLine).join("");
}

export function TableInsertModal({ onInsert, onClose }: { onInsert: (markdown: string) => void; onClose: () => void }) {
  const [rows, setRows] = useState(2);
  const [cols, setCols] = useState(2);
  const [cells, setCells] = useState<string[][]>(() => resizeGrid([], 2, 2));

  function changeSize(nextRows: number, nextCols: number) {
    const r = Math.min(101, Math.max(1, nextRows));
    const c = Math.min(10, Math.max(1, nextCols));
    setRows(r);
    setCols(c);
    setCells((prev) => resizeGrid(prev, r, c));
  }

  function setCell(r: number, c: number, text: string) {
    setCells((prev) => prev.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? text : cell)) : row)));
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Новая таблица</h3>
        <div className="row">
          <label className="row" style={{ gap: 6 }}>
            Строк
            <input type="number" min={1} max={101} value={rows}
              onChange={(e) => changeSize(Number(e.target.value) || 1, cols)} style={{ width: 60 }} />
          </label>
          <label className="row" style={{ gap: 6 }}>
            Столбцов
            <input type="number" min={1} max={10} value={cols}
              onChange={(e) => changeSize(rows, Number(e.target.value) || 1)} style={{ width: 60 }} />
          </label>
        </div>
        <div className="rt-table-editor">
          {cells.map((row, r) => (
            <div key={r} className="row rt-table-editor-row">
              {row.map((cell, c) => (
                <input key={c} value={cell} placeholder={r === 0 ? `Заголовок ${c + 1}` : "ячейка"}
                  onChange={(e) => setCell(r, c, e.target.value)} />
              ))}
            </div>
          ))}
        </div>
        <div className="row">
          <button className="primary" onClick={() => onInsert(tableMarkdown(cells, cols))}>Создать</button>
          <button onClick={onClose}>Отмена</button>
        </div>
      </div>
    </Modal>
  );
}
