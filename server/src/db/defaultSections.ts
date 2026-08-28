import type { Database } from "better-sqlite3";

/**
 * «Справочник» есть у каждой системы с самого начала — как «Бестиарий» или
 * «Заклинания», его не нужно заводить руками, чтобы было куда положить
 * состояния, типы урона и прочее общее знание системы.
 *
 * Раздел создаётся ПУСТЫМ: фиксированные списки MECHANICS_GROUPS («Школы
 * магии», «Владения доспехами», «Мастерство оружия») — вокабуляр D&D, и в
 * системе вроде Legend in the Mist они были бы мусором, который к тому же
 * нельзя убрать. Их по-прежнему сеет `seedMechanicsGroups` в routes/systems.ts,
 * но только когда раздел вида `mechanics` заводят руками.
 */
export const DEFAULT_MECHANICS_SECTION = "Справочник";

/**
 * Идемпотентно: у системы, где раздел такого вида уже есть (пришёл импортом,
 * заведён руками), ничего не меняется. Поэтому вызывать можно и после
 * импорта, не рискуя вторым «Справочником».
 */
export function ensureDefaultMechanicsSection(database: Database, systemId: number): void {
  const existing = database
    .prepare("SELECT 1 FROM system_sections WHERE system_id = ? AND kind = 'mechanics' LIMIT 1")
    .get(systemId);
  if (existing) return;
  const { p } = database
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM system_sections WHERE system_id = ?")
    .get(systemId) as { p: number };
  database
    .prepare(
      "INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, 'mechanics')"
    )
    .run(systemId, p, DEFAULT_MECHANICS_SECTION);
}

/**
 * Разовый перенос для систем, заведённых до того, как «Справочник» стал
 * базовым разделом. Отметка о переносе хранится отдельно: без неё раздел
 * возвращался бы к тем, кто его сознательно удалил, — ровно та беда, из-за
 * которой убран досев групп при каждом чтении разделов.
 */
export function backfillDefaultMechanicsSections(database: Database): void {
  const key = "default_mechanics_section_backfilled";
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (done) return;
  const systems = database.prepare("SELECT id FROM systems").all() as { id: number }[];
  for (const s of systems) ensureDefaultMechanicsSection(database, s.id);
  database
    .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
    .run(key);
}

/**
 * «Транспорт» — такой же базовый раздел, как «Справочник»: корабль, повозка и
 * пост экипажа воздушного судна раньше расходились по Снаряжению и Бестиарию,
 * хотя это ни товар, ни существо. Раздел заводится и там, где транспорта нет
 * (Legend in the Mist): признака «система с транспортом» не существует, а
 * пустой раздел стоит одну строку и сразу говорит, куда класть корабль.
 */
export const DEFAULT_VEHICLE_SECTION = "Транспорт";

/** Идемпотентно — как ensureDefaultMechanicsSection. */
export function ensureDefaultVehicleSection(database: Database, systemId: number): void {
  const existing = database
    .prepare("SELECT 1 FROM system_sections WHERE system_id = ? AND kind = 'vehicle' LIMIT 1")
    .get(systemId);
  if (existing) return;
  const { p } = database
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM system_sections WHERE system_id = ?")
    .get(systemId) as { p: number };
  database
    .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, 'vehicle')")
    .run(systemId, p, DEFAULT_VEHICLE_SECTION);
}

/** Разовый перенос старым системам — с отметкой, как у «Справочника». */
export function backfillDefaultVehicleSections(database: Database): void {
  const key = "default_vehicle_section_backfilled";
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  if (done) return;
  const systems = database.prepare("SELECT id FROM systems").all() as { id: number }[];
  for (const s of systems) ensureDefaultVehicleSection(database, s.id);
  database
    .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
    .run(key);
}
