/**
 * Точка входа пакета. Сервер импортирует отсюда (`require("@soyman/shared")`),
 * клиент — через алиас `@shared`, но обычно адресно: `@shared/dnd/derive`.
 */
export * from "./dnd/types";
export * from "./dnd/abilities";
export * from "./dnd/skillCatalog";
export * from "./dnd/effects";
export * from "./dnd/creature";
export * from "./dnd/creatureConvert";
export * from "./dnd/creatureMeta";
export * from "./dnd/inflicts";
export * from "./dnd/equipment";
export * from "./dnd/armorClass";
export * from "./dnd/derive";
export * from "./dnd/normalize";
export * from "./portable/index";
export * from "./workbooks";
export * from "./workbookMarkdown";
export * from "./maps/core/index";
export * from "./practicalWorkbooks";
export * from "./workbookActivity";
export * from "./textTables";
export * from "./battleLog";
