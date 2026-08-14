import { useState } from "react";
import { TYPE_COLORS, TYPE_LABELS } from "../graphTypes";

// Типы, у которых есть однозначный дом внутри сеттинга: остальные (игроки,
// ресурсы, мастерение, компендиум) сервер всё равно выбрасывает из графа с
// областью, и галочка для них была бы обманом.
export const SETTING_SCOPED_TYPES = [
  "being",
  "community",
  "location",
  "artifact",
  "scene",
  "adventure",
  "character",
  "campaign",
];

interface Props {
  activeTypes: Set<string>;
  setActiveTypes: (next: Set<string>) => void;
  // Какие типы вообще предлагать. По умолчанию — все, что знает граф.
  types?: string[];
}

/**
 * Отбор типов сущностей для графа. Общий для страницы «Граф связей» и вкладки
 * графа в сеттинге: раньше вкладка звала три захардкоженных типа и не давала
 * их менять.
 */
export function GraphTypeFilters({ activeTypes, setActiveTypes, types }: Props) {
  const [open, setOpen] = useState(false);
  const keys = types ?? Object.keys(TYPE_LABELS);

  function toggle(key: string) {
    const next = new Set(activeTypes);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setActiveTypes(next);
  }

  return (
    <>
      <div className="row">
        <button type="button" className={open ? "active-sort" : ""} onClick={() => setOpen((v) => !v)}>
          Фильтры {activeTypes.size < keys.length && `(${activeTypes.size} из ${keys.length})`}
        </button>
      </div>
      {open && (
        <>
          <div className="row">
            <button onClick={() => setActiveTypes(new Set(keys))}>Выбрать всё</button>
            <button onClick={() => setActiveTypes(new Set())}>Снять все</button>
          </div>
          <div className="filters">
            {keys.map((key) => (
              <label key={key}>
                <input type="checkbox" checked={activeTypes.has(key)} onChange={() => toggle(key)} />
                <span style={{ color: TYPE_COLORS[key] }}>●</span> {TYPE_LABELS[key] ?? key}
              </label>
            ))}
          </div>
        </>
      )}
    </>
  );
}
