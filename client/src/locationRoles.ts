// Вес поведения локации (план «Зоны локаций», этап 1).
//
// В коде стабильны только id; русские подписи лежат здесь и меняются без
// миграции — когда придут идеальные слова, правится этот словарь.
import type { NavIconName } from "./components/NavIcons";

export const LOCATION_ROLES = ["location", "sector", "spot"] as const;

export type LocationRole = (typeof LOCATION_ROLES)[number];

export const LOCATION_ROLE_LABELS: Record<LocationRole, string> = {
  location: "Локация",
  sector: "Сектор",
  spot: "Точка",
};

export function isLocationRole(v: unknown): v is LocationRole {
  return typeof v === "string" && (LOCATION_ROLES as readonly string[]).includes(v);
}

/** Роль с запасным значением для строк, пришедших без role (старый экспорт). */
export function locationRoleOf(loc: { role?: unknown }): LocationRole {
  return isLocationRole(loc.role) ? loc.role : "location";
}

/** Иконка места: корень мира — глобус, дальше по роли. */
export function locationRoleIcon(loc: { role?: unknown; parent_id?: number | null }): NavIconName {
  const role = locationRoleOf(loc);
  if (role === "spot") return "spot";
  if (role === "sector") return "sector";
  return loc.parent_id == null ? "globe" : "pin";
}
