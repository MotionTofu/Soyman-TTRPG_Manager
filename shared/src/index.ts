/**
 * Точка входа пакета. Сервер импортирует отсюда (`require("@soyman/shared")`),
 * клиент — через алиас `@shared`, но обычно адресно: `@shared/dnd/derive`.
 */
export * from "./dnd/types";
export * from "./dnd/abilities";
export * from "./dnd/skillCatalog";
export * from "./dnd/effects";
export * from "./dnd/creature";
export * from "./dnd/equipment";
export * from "./dnd/normalize";
