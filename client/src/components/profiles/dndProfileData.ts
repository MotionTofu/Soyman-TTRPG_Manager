// Разбор полей класса и вида для профиля ДнД — без компонентов (oxlint only-export-components).
import type { CompendiumEntry } from "../../types";
import type { ClassProgression } from "../dnd/progression";

export type Ref = { id: number; name: string; distance?: string };
export function profileRefs(value: unknown): Ref[] {
  const list = Array.isArray(value) ? value : value ? [value] : [];
  return list.filter((item): item is Ref => !!item && typeof item === "object" && typeof item.id === "number" && typeof item.name === "string");
}
export function profileNames(value: unknown): string {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string").join(" · ") : typeof value === "string" ? value : "";
}
export function profileProgression(entry: CompendiumEntry): ClassProgression | null {
  const value = entry.data.progression as ClassProgression | undefined;
  return value && Array.isArray(value.columns) && value.columns.length && Array.isArray(value.rows) && value.rows.length ? value : null;
}
