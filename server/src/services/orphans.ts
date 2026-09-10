import type { Database } from "better-sqlite3";
import { db as appDb } from "../db/db";
import {
  sweepableSatellitePairs,
  sweepableLinkEndpoints,
  sweepableRelationEndpoints,
} from "../db/entityKinds";

// statblocks / gallery_images / important_dates attach to their owner through a
// polymorphic (owner_type, owner_id) pair rather than a real foreign key, so
// SQLite's ON DELETE CASCADE never fires for them. When an owner goes away —
// directly, or as a side effect of an FK cascade (deleting a setting cascades
// to its beings, whose statblocks/gallery then dangle) — these satellite rows
// are left behind. A reconciliation sweep removes any satellite whose owner no
// longer exists; being prefix-free of "which delete happened" it catches
// orphans at any cascade depth.
//
// Какие виды чем владеют и какие бывают концами связей, этот файл больше не
// решает: всё берётся из реестра видов (`db/entityKinds.ts`). Раньше здесь
// лежали четыре карты, ещё четыре их копии — в `routes/health.ts`, и ещё две —
// в сборке сида; они разошлись, и картинки локаций не подметались вовсе.
// Имена таблиц приходят из реестра фиксированными литералами, поэтому
// подстановка идентификаторов по-прежнему безопасна.

/** Что уборка нашла: ключ — «таблица:вид», значение — сами строки. */
type OrphanRows = Record<string, unknown[]>;

let lastOrphanBackup: { at: string; rows: OrphanRows } | null = null;

export function getLastOrphanBackup(): typeof lastOrphanBackup { return lastOrphanBackup; }

export function restoreLastOrphanBackup(): number {
  if (!lastOrphanBackup) return 0;
  let restored = 0;
  const run = appDb.transaction(() => {
    for (const [key, rows] of Object.entries(lastOrphanBackup!.rows)) {
      const [table] = key.split(":");
      if (!rows.length) continue;
      const cols = Object.keys(rows[0] as Record<string, unknown>);
      const placeholders = cols.map(() => "?").join(",");
      const stmt = appDb.prepare(`INSERT OR IGNORE INTO ${table} (${cols.join(",")}) VALUES (${placeholders})`);
      for (const r of rows) restored += stmt.run(...cols.map((c) => (r as Record<string, unknown>)[c])).changes;
    }
  });
  run();
  lastOrphanBackup = null;
  return restored;
}

/**
 * Собирает сирот, ничего не удаляя. Отдельная функция, потому что ровно этим
 * заняты и подсчёт в разделе «Здоровье», и сухой прогон перед расширением
 * уборки: считать сирот и удалять их — разные задачи, и вторая не должна быть
 * единственным способом узнать первую.
 */
export function collectOrphans(db: Database = appDb): OrphanRows {
  const found: OrphanRows = {};
  const problems: string[] = [];
  const take = (key: string, sql: string, ...params: unknown[]) => {
    try {
      const rows = db.prepare(sql).all(...(params as [])) as unknown[];
      if (rows.length) found[key] = rows;
    } catch (e) {
      // На старой базе таблицы из реестра может ещё не быть. Ронять запуск
      // из-за этого нельзя — приложение стартует у Мастера за столом, — но и
      // глотать молча тоже: раньше здесь стоял пустой `catch {}`, и именно он
      // прятал то, что часть уборки не работает.
      problems.push(`${key}: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  for (const { table, ownerKind, ownerTable } of sweepableSatellitePairs()) {
    take(
      `${table}:${ownerKind}`,
      `SELECT * FROM ${table} WHERE owner_type = ? AND owner_id NOT IN (SELECT id FROM ${ownerTable})`,
      ownerKind
    );
  }
  for (const { kind, table } of sweepableLinkEndpoints()) {
    take(`generic_links:from:${kind}`, `SELECT * FROM generic_links WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`, kind);
    take(`generic_links:to:${kind}`, `SELECT * FROM generic_links WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`, kind);
  }
  for (const { kind, table } of sweepableRelationEndpoints()) {
    take(`entity_relations:from:${kind}`, `SELECT * FROM entity_relations WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`, kind);
    take(`entity_relations:to:${kind}`, `SELECT * FROM entity_relations WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`, kind);
  }
  // Полотна узлового редактора привязаны к владельцу полиморфно
  // (scope_type/scope_id), поэтому каскада за удалённым приключением у них
  // нет — как и у спутников выше. Без этой уборки после удаления сеттинга
  // остаются полотна с координатами нод, которых больше нет. Связка
  // scope_type='arc' не описывается видом сущности: это не «вид → таблица»,
  // а одна конкретная привязка Полотна.
  take("canvas_boards:arc", `SELECT * FROM canvas_boards WHERE scope_type = 'arc' AND scope_id NOT IN (SELECT id FROM story_arcs)`);

  lastSweepProblems = problems;
  return found;
}

/**
 * Что уборка не смогла проверить в последний раз (обычно — таблицы из реестра,
 * которых на этой базе ещё нет). Пусто — значит проверено всё.
 */
let lastSweepProblems: string[] = [];
export function getLastSweepProblems(): readonly string[] { return lastSweepProblems; }

/** Сколько сирот каждого рода, без удаления. */
export function countOrphans(db: Database = appDb): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [key, rows] of Object.entries(collectOrphans(db))) counts[key] = rows.length;
  return counts;
}

/**
 * Удаляет сирот и возвращает их число.
 *
 * База — аргумент, а не синглтон: та же уборка гоняется по копии базы в сухом
 * прогоне и в сборке сида, где раньше стояла переписанная от руки копия этого
 * же правила. Два adapter на один seam — боевая база и база сборки.
 */
export function sweepOrphans(db: Database = appDb): number {
  const found = collectOrphans(db);
  // Откат держим только для боевой базы: восстанавливать копию сида некуда.
  if (db === appDb) lastOrphanBackup = { at: new Date().toISOString(), rows: found };

  let removed = 0;
  // Удаляем только то, что сбор действительно нашёл: пара, которую не удалось
  // проверить (нет таблицы), не удаляется вслепую, а пустая пара не порождает
  // лишнего DELETE.
  const del = (key: string, sql: string, ...params: unknown[]) => {
    if (!found[key]?.length) return;
    removed += db.prepare(sql).run(...(params as [])).changes;
  };
  const run = db.transaction(() => {
    for (const { table, ownerKind, ownerTable } of sweepableSatellitePairs()) {
      del(`${table}:${ownerKind}`, `DELETE FROM ${table} WHERE owner_type = ? AND owner_id NOT IN (SELECT id FROM ${ownerTable})`, ownerKind);
    }
    for (const { kind, table } of sweepableLinkEndpoints()) {
      del(`generic_links:from:${kind}`, `DELETE FROM generic_links WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`, kind);
      del(`generic_links:to:${kind}`, `DELETE FROM generic_links WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`, kind);
    }
    for (const { kind, table } of sweepableRelationEndpoints()) {
      del(`entity_relations:from:${kind}`, `DELETE FROM entity_relations WHERE from_type = ? AND from_id NOT IN (SELECT id FROM ${table})`, kind);
      del(`entity_relations:to:${kind}`, `DELETE FROM entity_relations WHERE to_type = ? AND to_id NOT IN (SELECT id FROM ${table})`, kind);
    }
    del("canvas_boards:arc", `DELETE FROM canvas_boards WHERE scope_type = 'arc' AND scope_id NOT IN (SELECT id FROM story_arcs)`);
  });
  run();
  return removed;
}
