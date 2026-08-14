import { memo, useState } from "react";
import {
  PROGRESSION_ROLE_LABELS,
  PROGRESSION_ROLE_ORDER,
  parseProgressionTable,
  type ClassProgression,
  type ProgressionColumn,
  type ProgressionRole,
} from "./progression";
import { NavIcon } from "../NavIcons";

// Редактор таблицы развития класса. Сетка, а не набор полей: именно так
// прогрессия выглядит в книге правил, и переносить её сюда глазами куда
// проще, когда форма совпадает с источником.
//
// Роль колонки («Ячейки 3 круга», «Ресурс класса») выбирается прямо в шапке
// и решает, умеет ли приложение по ней считать. Колонки без роли остаются
// просто колонками — их видно, но лист по ним ничего не выводит.

let columnCounter = 0;
function newColumnKey(existing: ProgressionColumn[]): string {
  // Ключи должны переживать удаление соседей, поэтому не индекс.
  let key: string;
  do {
    columnCounter += 1;
    key = `c${columnCounter}`;
  } while (existing.some((c) => c.key === key));
  return key;
}

function RoleSelect({
  value,
  used,
  onChange,
}: {
  value: ProgressionRole;
  // Роли, кроме «ресурса» и «просто колонки», уникальны: две колонки уровня
  // или двое ячеек третьего круга — всегда ошибка ввода.
  used: Set<ProgressionRole>;
  onChange: (v: ProgressionRole) => void;
}) {
  return (
    <select
      className="prog-role"
      value={value}
      onChange={(e) => onChange(e.target.value as ProgressionRole)}
      title="Что приложение должно понимать под этой колонкой"
    >
      {PROGRESSION_ROLE_ORDER.filter((r) => r === value || r === "" || r === "resource" || !used.has(r)).map((r) => (
        <option key={r} value={r}>
          {PROGRESSION_ROLE_LABELS[r]}
        </option>
      ))}
    </select>
  );
}

export const ProgressionEditor = memo(function ProgressionEditor({
  value,
  markdown,
  onChange,
}: {
  value: ClassProgression;
  // Исходная markdown-таблица, если она ещё есть: даёт кнопку «разобрать
  // заново», чтобы не переносить два десятка строк руками.
  markdown?: string;
  onChange: (v: ClassProgression) => void;
}) {
  const [confirmParse, setConfirmParse] = useState(false);
  const columns = value?.columns ?? [];
  const rows = value?.rows ?? [];
  const used = new Set(columns.map((c) => c.role));

  function patchColumn(key: string, patch: Partial<ProgressionColumn>) {
    onChange({ ...value, columns: columns.map((c) => (c.key === key ? { ...c, ...patch } : c)) });
  }
  function addColumn() {
    const key = newColumnKey(columns);
    onChange({
      columns: [...columns, { key, label: "", role: "" }],
      // Новая колонка должна появиться во всех строках, иначе ячейки поедут.
      rows: rows.map((r) => ({ ...r, [key]: "" })),
    });
  }
  function removeColumn(key: string) {
    onChange({
      columns: columns.filter((c) => c.key !== key),
      rows: rows.map((r) => {
        const next = { ...r };
        delete next[key];
        return next;
      }),
    });
  }
  function patchCell(rowIndex: number, key: string, cellValue: string) {
    onChange({
      ...value,
      rows: rows.map((r, i) => (i === rowIndex ? { ...r, [key]: cellValue } : r)),
    });
  }
  function addRow() {
    const empty: Record<string, string> = {};
    for (const c of columns) empty[c.key] = "";
    // Новый уровень — следующий по счёту: 21-я строка в таблице на 20
    // уровней почти всегда означает «дописываю продолжение».
    const levelCol = columns.find((c) => c.role === "level");
    if (levelCol) empty[levelCol.key] = String(rows.length + 1).padStart(2, "0");
    onChange({ ...value, rows: [...rows, empty] });
  }
  function removeRow(index: number) {
    onChange({ ...value, rows: rows.filter((_, i) => i !== index) });
  }
  function parseFromMarkdown() {
    if (!markdown) return;
    onChange(parseProgressionTable(markdown));
    setConfirmParse(false);
  }

  if (columns.length === 0) {
    return (
      <div className="stack prog-empty">
        <span className="muted">Таблица развития не заполнена.</span>
        <div className="row">
          <button type="button" onClick={addColumn}>
            + колонка
          </button>
          {markdown && (
            <button type="button" onClick={parseFromMarkdown}>
              Разобрать из текстовой таблицы
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="stack">
      <div className="prog-wrap">
        <table className="prog-table">
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c.key}>
                  <div className="prog-head">
                    <input
                      value={c.label}
                      placeholder="Заголовок"
                      onChange={(e) => patchColumn(c.key, { label: e.target.value })}
                    />
                    <RoleSelect value={c.role} used={used} onChange={(role) => patchColumn(c.key, { role })} />
                    <button
                      type="button"
                      className="comp-mini danger"
                      title="Удалить колонку"
                      onClick={() => removeColumn(c.key)}
                    >
                      <NavIcon name="close" />
                    </button>
                  </div>
                </th>
              ))}
              <th className="prog-rowactions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {columns.map((c) => (
                  <td key={c.key}>
                    <input value={row[c.key] ?? ""} onChange={(e) => patchCell(i, c.key, e.target.value)} />
                  </td>
                ))}
                <td className="prog-rowactions">
                  <button
                    type="button"
                    className="comp-mini danger"
                    title="Удалить строку"
                    onClick={() => removeRow(i)}
                  >
                    <NavIcon name="close" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <button type="button" onClick={addRow}>
          + уровень
        </button>
        <button type="button" onClick={addColumn}>
          + колонка
        </button>
        {markdown &&
          (confirmParse ? (
            <>
              <span className="muted">Заменить всё разбором текстовой таблицы?</span>
              <button type="button" className="danger" onClick={parseFromMarkdown}>
                Заменить
              </button>
              <button type="button" onClick={() => setConfirmParse(false)}>
                Отмена
              </button>
            </>
          ) : (
            <button type="button" onClick={() => setConfirmParse(true)}>
              Разобрать заново из текста
            </button>
          ))}
      </div>
    </div>
  );
});

// Только чтение — то же самое в режиме просмотра записи класса.
export function ProgressionView({ value }: { value: ClassProgression }) {
  const columns = value?.columns ?? [];
  const rows = value?.rows ?? [];
  if (columns.length === 0 || rows.length === 0) return null;
  return (
    <div className="prog-wrap">
      <table className="prog-table prog-table-view">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i}>
              {columns.map((c) => (
                <td key={c.key}>{row[c.key] ?? ""}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
