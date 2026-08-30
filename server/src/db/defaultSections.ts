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

/**
 * «Бастионы» — отдельный таб D&D 5.5. Раньше бастионы жили внутри
 * «Справочник» > «Бастионы» как mechanic_group с 36 mechanic_item. Теперь
 * это самостоятельный раздел kind='bastion' с записями kind='bastion'.
 */
export const DEFAULT_BASTION_SECTION = "Бастионы";

export function ensureDefaultBastionSection(database: Database, systemId: number): void {
  const existing = database
    .prepare("SELECT 1 FROM system_sections WHERE system_id = ? AND kind = 'bastion' LIMIT 1")
    .get(systemId);
  if (existing) return;
  const { p } = database
    .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM system_sections WHERE system_id = ?")
    .get(systemId) as { p: number };
  database
    .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, 'bastion')")
    .run(systemId, p, DEFAULT_BASTION_SECTION);
}

/**
 * Перенос контента «Справочник» > «Бастионы» в отдельный таб «Бастионы».
 * Идемпотентно: если группы «Бастионы» в справочнике нет — ничего не делает.
 * Детей группы переносит как kind='bastion' в новый раздел, саму группу
 * удаляет. Запускается на каждом openDatabase — после переноса группа
 * исчезает, повторный прогон нечего переносить.
 */
export function migrateBastionsToOwnSection(database: Database): void {
  const systems = database.prepare("SELECT id FROM systems").all() as { id: number }[];
  for (const s of systems) {
    const mechSection = database
      .prepare("SELECT id FROM system_sections WHERE system_id = ? AND kind = 'mechanics' LIMIT 1")
      .get(s.id) as { id: number } | undefined;
    if (!mechSection) continue;

    const group = database
      .prepare(
        "SELECT id FROM compendium_entries WHERE section_id = ? AND parent_id IS NULL AND kind = 'mechanic_group' AND name = 'Бастионы' LIMIT 1"
      )
      .get(mechSection.id) as { id: number } | undefined;
    if (!group) continue;

    let bastionSection = database
      .prepare("SELECT id FROM system_sections WHERE system_id = ? AND kind = 'bastion' LIMIT 1")
      .get(s.id) as { id: number } | undefined;
    if (!bastionSection) {
      const { p } = database
        .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM system_sections WHERE system_id = ?")
        .get(s.id) as { p: number };
      const info = database
        .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, ?, 'bastion')")
        .run(s.id, p, DEFAULT_BASTION_SECTION);
      bastionSection = { id: Number(info.lastInsertRowid) };
    }

    const children = database
      .prepare("SELECT id, parent_id FROM compendium_entries WHERE parent_id = ? ORDER BY position")
      .all(group.id) as { id: number; parent_id: number | null }[];

    const toMove = new Set<number>();
    const queue = children.map((c) => c.id);
    while (queue.length) {
      const cur = queue.shift()!;
      toMove.add(cur);
      const sub = database
        .prepare("SELECT id FROM compendium_entries WHERE parent_id = ?")
        .all(cur) as { id: number }[];
      for (const ss of sub) queue.push(ss.id);
    }

    const directChildIds = new Set(children.map((c) => c.id));
    for (const entryId of toMove) {
      const isDirect = directChildIds.has(entryId);
      if (isDirect) {
        database
          .prepare("UPDATE compendium_entries SET section_id = ?, parent_id = NULL, kind = 'bastion' WHERE id = ?")
          .run(bastionSection.id, entryId);
      } else {
        database
          .prepare("UPDATE compendium_entries SET section_id = ?, kind = 'bastion' WHERE id = ?")
          .run(bastionSection.id, entryId);
      }
    }

    database.prepare("DELETE FROM compendium_entries WHERE id = ?").run(group.id);
  }
}
