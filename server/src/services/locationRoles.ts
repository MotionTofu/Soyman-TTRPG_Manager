// Вес поведения локации (план «Зоны локаций», этап 1).
//
// Чистый модуль без импорта db — валидацию можно тестировать без открытия
// базы (тот же приём, что maps.test.ts). В коде стабильны только id;
// русские подписи лежат в LOCATION_ROLE_LABELS и меняются без миграции.
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
