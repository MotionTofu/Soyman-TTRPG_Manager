// Вес поведения локации (план «Зоны локаций», этап 1).
//
// В коде стабильны только id; русские подписи лежат здесь и меняются без
// миграции — когда придут идеальные слова, правится этот словарь.
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
