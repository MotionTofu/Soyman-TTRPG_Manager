import type { ListViewMode } from "../listViewMode";

const OPTIONS: { value: ListViewMode; label: string }[] = [
  { value: "list", label: "Список" },
  { value: "table", label: "Таблица" },
  { value: "grid", label: "Плитка" },
];

export function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: ListViewMode;
  onChange: (m: ListViewMode) => void;
}) {
  return (
    <div className="tabs view-mode-toggle">
      {OPTIONS.map((o) => (
        <button key={o.value} className={mode === o.value ? "active" : ""} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}
