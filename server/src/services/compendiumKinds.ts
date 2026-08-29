/**
 * Канонический список видов записей компендиума (compendium_entries.kind).
 *
 * `kind` живёт в TEXT без CHECK — любой путь записи может навести свой мусор
 * (правка «вида» переименовавшего монстра в «anything» оставит data в старом
 * виде, и раздел сломается молча). Здесь один список того, что приложение
 * умеет показывать; маршруты записи и импорт сверяются с ним.
 *
 * Список — объединение источников, никакой вид не должен выпасть:
 * - SYSTEM_KEY_PREFIX_TO_KIND (импорт системы): mechanic_item, spell, class,
 *   subclass, feature, species, background, feat, equipment, magic_item, monster;
 * - KIND_DEFS клиента (compendium.ts): kinds всех разделов, включая вложенные
 *   (class_option, skill, vehicle_post, все mechanic_*_item);
 * - mechanic_group — родительские группы справочника (импорт систем);
 * - виды Legend in the Mist, подтверждённые `SELECT DISTINCT kind`
 *   (magic_way, theme_kit, themebook, treasure, trope).
 */

export const COMPENDIUM_KINDS: ReadonlySet<string> = new Set([
  "wiki",
  "class",
  "subclass",
  "feature",
  "class_option",
  "spell",
  "item",
  "magic_item",
  "species",
  "feat",
  "background",
  "monster",
  "vehicle",
  "vehicle_post",
  "equipment",
  "skill",
  "skill_group",
  "mechanic_group",
  "mechanic_item",
  "mechanic_might_item",
  "mechanic_theme_type_item",
  "mechanic_role_item",
  "mechanic_status_category_item",
  "mechanic_consequence_item",
  "mechanic_backpack_category_item",
  "mechanic_economy_item",
  // Legend in the Mist
  "magic_way",
  "theme_kit",
  "themebook",
  "treasure",
  "trope",
]);

export function isCompendiumKind(kind: string | null | undefined): boolean {
  return typeof kind === "string" && kind !== "" && COMPENDIUM_KINDS.has(kind);
}