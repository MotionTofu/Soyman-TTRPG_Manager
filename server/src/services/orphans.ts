import { db } from "../db/db";

// statblocks / gallery_images / important_dates attach to their owner through a
// polymorphic (owner_type, owner_id) pair rather than a real foreign key, so
// SQLite's ON DELETE CASCADE never fires for them. When an owner goes away —
// directly, or as a side effect of an FK cascade (deleting a setting cascades
// to its beings, whose statblocks/gallery then dangle) — these satellite rows
// are left behind. A reconciliation sweep removes any satellite whose owner no
// longer exists; being prefix-free of "which delete happened" it catches
// orphans at any cascade depth. Table/column names are fixed literals here, so
// the interpolated identifiers are injection-safe.
const OWNER_TABLE: Record<string, string> = {
  character: "characters",
  being: "setting_beings",
  community: "setting_communities",
  location: "setting_locations",
  // Записи компендиума тоже владеют статблоками (полный лист существа
  // бестиария — статблок с owner_type='compendium_entry'). Раньше этого типа
  // здесь не было, и удалённая запись оставляла свой статблок висеть: сирота
  // жила вечно, потому что sweep её не видел. generic_links и entity_relations
  // этот случай уже покрывают (см. LINK_ENDPOINT_TABLE/RELATION_ENDPOINT_TABLE),
  // а statblocks — нет.
  compendium_entry: "compendium_entries",
};

const SATELLITES: { table: string; ownerTypes: string[] }[] = [
  { table: "statblocks", ownerTypes: ["character", "being", "compendium_entry"] },
  { table: "gallery_images", ownerTypes: ["character", "being"] },
  { table: "important_dates", ownerTypes: ["being", "community", "location", "character"] },
];

// generic_links (client/src/components/LinkDropZone.tsx and friends) is
// polymorphic the same way, but on both ends (from_type/from_id AND
// to_type/to_id) — a hard delete of *either* endpoint leaves the row
// dangling. Table names mirror links.ts's NODE_TABLES plus the two node
// types that route lives don't need to resolve (session, compendium_entry,
// playlist) but generic_links still stores.
const LINK_ENDPOINT_TABLE: Record<string, string> = {
  campaign: "campaigns",
  setting: "settings",
  player: "players",
  character: "characters",
  location: "setting_locations",
  being: "setting_beings",
  artifact: "artifacts",
  community: "setting_communities",
  resource: "resources",
  mastering: "mastering_notes",
  session: "sessions",
  compendium_entry: "compendium_entries",
  playlist: "playlists",
  // Сцены и приключения в этой таблице отсутствовали: у generic_links нет FK,
  // и связь удалённой сцены («участники», «место», упоминание) оставалась
  // висеть, выглядя при этом рабочей. Проверено на живой базе — до сих пор не
  // укусило только потому, что сеттинги целиком тут ещё не удаляли.
  scene: "story_scenes",
  adventure: "story_arcs",
  // Набор узлового редактора. Сущностью мира он не является и в графе связей
  // его нет, но членство в нём — обычные generic_links, и без уборки удалённый
  // набор оставлял бы их висеть.
  bundle: "canvas_bundles",
  // Набор пульта звука: сцена ссылается на него секцией scene_sound, а FK у
  // generic_links нет — удалённый набор оставил бы у сцены ссылку в никуда, и
  // запуск сцены пытался бы включить то, чего больше нет.
  sound_set: "sound_sets",
};

// entity_relations полиморфна с обоих концов ровно так же, но до сих пор не
// подметалась: удалённое существо оставляло за собой связи, и во вкладке
// «Отношения» второй стороны они рисовались как «? ⟶ Имя». Типы — те, что
// разрешает routes/entityRelations.ts.
const RELATION_ENDPOINT_TABLE: Record<string, string> = {
  being: "setting_beings",
  character: "characters",
  community: "setting_communities",
  compendium_entry: "compendium_entries",
  location: "setting_locations",
  artifact: "artifacts",
};

export function sweepOrphans(): number {
  let removed = 0;
  const run = db.transaction(() => {
    for (const { table, ownerTypes } of SATELLITES) {
      for (const ownerType of ownerTypes) {
        const ownerTable = OWNER_TABLE[ownerType];
        const info = db
          .prepare(
            `DELETE FROM ${table}
             WHERE owner_type = ? AND owner_id NOT IN (SELECT id FROM ${ownerTable})`
          )
          .run(ownerType);
        removed += info.changes;
      }
    }
    for (const [type, table] of Object.entries(LINK_ENDPOINT_TABLE)) {
      const infoFrom = db
        .prepare(`DELETE FROM generic_links WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`)
        .run(type);
      const infoTo = db
        .prepare(`DELETE FROM generic_links WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`)
        .run(type);
      removed += infoFrom.changes + infoTo.changes;
    }
    for (const [type, table] of Object.entries(RELATION_ENDPOINT_TABLE)) {
      const infoFrom = db
        .prepare(`DELETE FROM entity_relations WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`)
        .run(type);
      const infoTo = db
        .prepare(`DELETE FROM entity_relations WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`)
        .run(type);
      removed += infoFrom.changes + infoTo.changes;
    }
    // Полотна узлового редактора привязаны к владельцу полиморфно
    // (scope_type/scope_id), поэтому каскада за удалённым приключением у них
    // нет — как и у спутников выше. Без этой уборки после удаления сеттинга
    // остаются полотна с координатами нод, которых больше нет.
    const boards = db
      .prepare(
        `DELETE FROM canvas_boards
         WHERE scope_type = 'arc' AND scope_id NOT IN (SELECT id FROM story_arcs)`
      )
      .run();
    removed += boards.changes;
  });
  run();
  return removed;
}
