import { useEffect, useState } from "react";
import type { SettingLocation } from "../types";

interface Props {
  locations: SettingLocation[];
  value: number | null;
  onChange: (id: number | null) => void;
  // Что значит «ничего не выбрано» в этом месте. При назначении локации это
  // «Без локации», при фильтрации списка — «Все локации» (там «без локации»
  // это отдельный режим, см. LocationFilter ниже).
  rootLabel?: string;
  clearLabel?: string;
  // Пункт первого списка, который локацией не является (у фильтра — «Без
  // локации»): выбирается там же, где и локации, но наружу уходит не id.
  extraOption?: { label: string; active: boolean; onPick: () => void };
}

// Breadcrumb-style drill-down picker (requirement 9): instead of hunting a
// location by name in one long flat <select>, pick level by level —
// Фобетор → Тонкий Прут → Голубая Цапля — each level narrowed to the
// previous pick's children. Any level can be the final answer, not just
// leaves (e.g. picking "Фобетор" itself, without drilling further).
export function LocationCascadePicker({
  locations,
  value,
  onChange,
  rootLabel = "Без локации",
  clearLabel = "✕ Убрать локацию",
  extraOption,
}: Props) {
  const EXTRA = "__extra__";
  const [path, setPath] = useState<number[]>(() => ancestorChain(locations, value));

  useEffect(() => {
    setPath(ancestorChain(locations, value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  function childrenOf(parentId: number | null): SettingLocation[] {
    return locations
      .filter((l) => l.parent_id === parentId)
      .sort((a, b) => a.name.localeCompare(b.name, "ru"));
  }

  function pick(depth: number, id: number | null) {
    const next = path.slice(0, depth);
    if (id != null) next.push(id);
    setPath(next);
    onChange(next.length > 0 ? next[next.length - 1] : null);
  }

  const levels: SettingLocation[][] = [];
  let parentId: number | null = null;
  for (let depth = 0; ; depth++) {
    const options = childrenOf(parentId);
    if (options.length === 0) break;
    levels.push(options);
    const picked = path[depth];
    if (picked == null) break;
    parentId = picked;
  }

  return (
    <div className="location-cascade">
      {path.length > 0 && (
        <div className="location-cascade-breadcrumb muted">
          {path
            .map((id) => locations.find((l) => l.id === id)?.name)
            .filter(Boolean)
            .join(" → ")}
        </div>
      )}
      <div className="location-cascade-row">
        {levels.map((options, depth) => (
          <select
            key={depth}
            value={depth === 0 && extraOption?.active ? EXTRA : path[depth] ?? ""}
            onChange={(e) => {
              if (e.target.value === EXTRA) return extraOption?.onPick();
              pick(depth, e.target.value ? Number(e.target.value) : null);
            }}
          >
            <option value="">{depth === 0 ? rootLabel : "— не выбрано —"}</option>
            {depth === 0 && extraOption && <option value={EXTRA}>{extraOption.label}</option>}
            {options.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        ))}
        {path.length > 0 && (
          <button type="button" onClick={() => pick(0, null)}>
            {clearLabel}
          </button>
        )}
      </div>
    </div>
  );
}

// Значение фильтра по локации: "" — все, "none" — только те, у кого локации
// нет вовсе, иначе id локации строкой (в таком виде и уезжает в query-параметр
// location_id, который сервер понимает одинаково для существ и сообществ).
export type LocationFilterValue = string;

// Фильтр списка по локации: «Все» / «Без локации» / конкретная локация с
// вложенными. Раньше роль «Все» играл пустой пункт каскадного выбора, из-за
// чего «Без локации» было нечем выразить.
export function LocationFilter({
  locations,
  value,
  onChange,
}: {
  locations: SettingLocation[];
  value: LocationFilterValue;
  onChange: (value: LocationFilterValue) => void;
}) {
  if (locations.length === 0) return null;
  return (
    <LocationCascadePicker
      locations={locations}
      value={value && value !== "none" ? Number(value) : null}
      onChange={(id) => onChange(id ? String(id) : "")}
      rootLabel="Все локации"
      clearLabel="✕ Сбросить фильтр"
      extraOption={{ label: "Без локации", active: value === "none", onPick: () => onChange("none") }}
    />
  );
}

function ancestorChain(locations: SettingLocation[], id: number | null): number[] {
  const chain: number[] = [];
  let current = id;
  while (current != null) {
    chain.unshift(current);
    const loc = locations.find((l) => l.id === current);
    current = loc?.parent_id ?? null;
  }
  return chain;
}
