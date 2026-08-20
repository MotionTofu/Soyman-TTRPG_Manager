import type Database from "better-sqlite3";
import { normalizeName } from "../import/names";

/**
 * Лорная сводка существа бестиария: то, что переживает смену системы.
 *
 * Размер, тип и мировоззрение хранятся дважды — в `compendium_entries.data`
 * и внутри D&D-статблока. Убрать дубль нельзя: по `data` работают фильтры
 * раздела бестиария, а статблок — это цельный документ формата, из которого
 * поля не выдёргиваются. Поэтому здесь одно правило на всех: правка сводки
 * пишет и в `data`, и во все статблоки формата `dnd_creature`; пустое в
 * `data` дозаполняется из статблока. Обратно (статблок → data) молча не
 * пишем — иначе правка статблока переписывала бы то, что мастер задал руками.
 *
 * Формат важнее системы записи: одно и то же существо бестиария D&D может
 * нести статблок Legend in the Mist — ради того и заведены статблоки разных
 * форматов у одной записи. Привязка к системе сломала бы ровно этот случай.
 */

export interface CreatureSummary {
  size: string;
  creatureType: string;
  alignment: string;
}

interface EntryRow {
  id: number;
  system_id: number;
  data: string | null;
}

const DND_CREATURE_FORMAT = "dnd_creature";

function parseData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Тип существа из справочника механик системы — по нему работает фильтр раздела. */
export function creatureTypeOption(
  database: Database.Database,
  systemId: number,
  type: string
): { id: number; name: string } | null {
  if (!type.trim()) return null;
  const rows = database
    .prepare(
      `SELECT child.id, child.name
         FROM compendium_entries child
         JOIN compendium_entries grp ON grp.id = child.parent_id
        WHERE grp.system_id = ? AND grp.kind = 'mechanic_group'
          AND grp.name = 'Типы существ и их особенности'`
    )
    .all(systemId) as { id: number; name: string }[];
  return rows.find((r) => normalizeName(r.name) === normalizeName(type)) ?? null;
}

/** Размер, тип и мировоззрение из первого D&D-статблока записи. */
export function readDndCreatureSummary(
  database: Database.Database,
  entryId: number
): CreatureSummary | null {
  const row = database
    .prepare(
      `SELECT content FROM statblocks
        WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = ?
        ORDER BY id LIMIT 1`
    )
    .get(entryId, DND_CREATURE_FORMAT) as { content: string } | undefined;
  if (!row) return null;
  try {
    const sb = JSON.parse(row.content) as Record<string, unknown>;
    return {
      size: typeof sb.size === "string" ? sb.size : "",
      creatureType: typeof sb.creatureType === "string" ? sb.creatureType : "",
      alignment: typeof sb.alignment === "string" ? sb.alignment : "",
    };
  } catch {
    return null;
  }
}

/** Правка сводки уходит во все D&D-статблоки записи; чужие форматы не трогаются. */
export function writeDndCreatureSummary(
  database: Database.Database,
  entryId: number,
  patch: Partial<CreatureSummary>
): void {
  const rows = database
    .prepare(
      `SELECT id, content FROM statblocks
        WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = ?`
    )
    .all(entryId, DND_CREATURE_FORMAT) as { id: number; content: string }[];
  if (!rows.length) return;
  const update = database.prepare("UPDATE statblocks SET content = ? WHERE id = ?");
  for (const row of rows) {
    let sb: Record<string, unknown>;
    try {
      sb = JSON.parse(row.content) as Record<string, unknown>;
    } catch {
      continue;
    }
    if (patch.size !== undefined) sb.size = patch.size;
    if (patch.creatureType !== undefined) sb.creatureType = patch.creatureType;
    if (patch.alignment !== undefined) sb.alignment = patch.alignment;
    update.run(JSON.stringify(sb), row.id);
  }
}

/**
 * Дозаполняет пустые поля сводки из D&D-статблока. Возвращает true, если
 * что-то записалось: вызывающему это нужно, чтобы перечитать запись.
 */
export function backfillEntrySummary(database: Database.Database, entryId: number): boolean {
  const entry = database
    .prepare("SELECT id, system_id, data FROM compendium_entries WHERE id = ? AND kind = 'monster'")
    .get(entryId) as EntryRow | undefined;
  if (!entry) return false;
  const summary = readDndCreatureSummary(database, entryId);
  if (!summary) return false;

  const data = parseData(entry.data);
  let changed = false;
  if (!data.size && summary.size) {
    data.size = summary.size;
    changed = true;
  }
  if (!data.alignment && summary.alignment) {
    data.alignment = summary.alignment;
    changed = true;
  }
  if (!data.creature_type && summary.creatureType) {
    const ref = creatureTypeOption(database, entry.system_id, summary.creatureType);
    if (ref) {
      data.creature_type = ref;
      changed = true;
    }
  }
  if (!changed) return false;
  database
    .prepare("UPDATE compendium_entries SET data = ? WHERE id = ?")
    .run(JSON.stringify(data), entryId);
  return true;
}

/**
 * Разовый проход по всему бестиарию.
 *
 * Ленивого дозаполнения при открытии профиля мало: фильтры раздела читают
 * `data` у всех записей сразу, а профиль открывают у единиц. Проход
 * идемпотентен — заполняет только пустое, — поэтому его безопасно гонять при
 * каждом старте.
 */
export function backfillAllSummaries(database: Database.Database): number {
  const ids = database
    .prepare(
      `SELECT DISTINCT e.id FROM compendium_entries e
         JOIN statblocks s ON s.owner_type = 'compendium_entry' AND s.owner_id = e.id
        WHERE e.kind = 'monster' AND s.format = ?`
    )
    .all(DND_CREATURE_FORMAT) as { id: number }[];
  let filled = 0;
  const run = database.transaction(() => {
    for (const { id } of ids) if (backfillEntrySummary(database, id)) filled++;
  });
  run();
  return filled;
}
