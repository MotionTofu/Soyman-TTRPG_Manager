import type Database from "better-sqlite3";
import { normalizeName } from "../import/names";
import {
  capitalize,
  cleanChallengeRating,
  matchCreatureType,
  parseCreatureMeta,
} from "../import/creatureMeta";

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
  /** Класс опасности. В статблок обратной правкой не уходит — см. writeDndCreatureSummary. */
  cr: string;
  /** Слово, стоявшее на месте типа, но не найденное в словаре: «Объект», «бестия». */
  unknownType: string;
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
  const exact = rows.find((r) => normalizeName(r.name) === normalizeName(type));
  if (exact) return exact;
  // Книга склоняет тип по роду и стае — «Среднее Исчадие», «стая Крошечных
  // Зверей», — а справочник хранит именительный.
  const matched = matchCreatureType(type, rows.map((r) => r.name));
  return matched ? rows.find((r) => r.name === matched) ?? null : null;
}

/**
 * Размер, тип, мировоззрение и класс опасности из первого D&D-статблока.
 *
 * Статблоки живут в двух формах. Новая держит поля по отдельности (`size`,
 * `creatureType`, `challenge.rating`), старая — одной строкой книги
 * («Средний гуманоид (человек), хаотично-злой») плюс `challengeRating`.
 * Импортировано почти всё в старой форме, поэтому строка разбирается тем же
 * модулем, что и при импорте приключения, — см. import/creatureMeta.
 */
export function readDndCreatureSummary(
  database: Database.Database,
  entryId: number,
  vocabulary?: string[]
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
    const legacy =
      typeof sb.sizeTypeAlignment === "string" && sb.sizeTypeAlignment
        ? parseCreatureMeta(sb.sizeTypeAlignment, vocabulary)
        : null;
    const challenge = sb.challenge as { rating?: unknown } | undefined;
    const rating =
      typeof challenge?.rating === "string" && challenge.rating
        ? challenge.rating
        : typeof sb.challengeRating === "string"
        ? sb.challengeRating
        : "";
    return {
      size: (typeof sb.size === "string" && sb.size) || legacy?.size || "",
      creatureType: (typeof sb.creatureType === "string" && sb.creatureType) || legacy?.type || "",
      // Мировоззрение в старых статблоках писано со строчной — «хаотично-злой».
      alignment:
        (typeof sb.alignment === "string" && sb.alignment) || capitalize(legacy?.alignment ?? ""),
      cr: cleanChallengeRating(rating),
      unknownType: legacy?.unknownType ?? "",
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

/** Что дозаполнение сделало с одной записью — из этого складывается отчёт кнопки. */
export interface SummaryFillResult {
  filled: { size: boolean; creatureType: boolean; alignment: boolean; cr: boolean };
  /** Поле записи расходится со статблоком; заполненное руками не трогаем. */
  conflicts: { field: string; entry: string; statblock: string }[];
  /** Слово на месте типа, не найденное в справочнике механик. */
  unknownType: string;
  changed: boolean;
}

const EMPTY_FILL: SummaryFillResult = {
  filled: { size: false, creatureType: false, alignment: false, cr: false },
  conflicts: [],
  unknownType: "",
  changed: false,
};

/**
 * Дозаполняет пустые поля сводки из D&D-статблока — размер, тип,
 * мировоззрение и класс опасности. Заполненное не перезаписывается: значение,
 * поставленное руками, поставлено осознанно, — расхождение возвращается
 * вызывающему, чтобы оно не пропало молча.
 */
export function backfillEntrySummary(
  database: Database.Database,
  entryId: number,
  vocabulary?: string[]
): SummaryFillResult {
  const entry = database
    .prepare("SELECT id, system_id, data FROM compendium_entries WHERE id = ? AND kind = 'monster'")
    .get(entryId) as EntryRow | undefined;
  if (!entry) return EMPTY_FILL;
  const summary = readDndCreatureSummary(database, entryId, vocabulary);
  if (!summary) return EMPTY_FILL;

  const data = parseData(entry.data);
  const result: SummaryFillResult = {
    filled: { size: false, creatureType: false, alignment: false, cr: false },
    conflicts: [],
    unknownType: summary.unknownType,
    changed: false,
  };
  const note = (field: string, current: unknown, incoming: string) => {
    if (incoming && typeof current === "string" && current && current !== incoming) {
      result.conflicts.push({ field, entry: current, statblock: incoming });
    }
  };

  note("Размер", data.size, summary.size);
  note("Мировоззрение", data.alignment, summary.alignment);
  note("Класс опасности", data.cr, summary.cr);

  if (!data.size && summary.size) {
    data.size = summary.size;
    result.filled.size = true;
  }
  if (!data.alignment && summary.alignment) {
    data.alignment = summary.alignment;
    result.filled.alignment = true;
  }
  if (!data.cr && summary.cr) {
    data.cr = summary.cr;
    result.filled.cr = true;
  }
  if (summary.creatureType) {
    const ref = creatureTypeOption(database, entry.system_id, summary.creatureType);
    const current = data.creature_type as { name?: string } | undefined;
    if (ref && current?.name && current.name !== ref.name) {
      result.conflicts.push({ field: "Тип существа", entry: current.name, statblock: ref.name });
    }
    if (ref && !current) {
      data.creature_type = ref;
      result.filled.creatureType = true;
    }
    if (!ref && !result.unknownType) result.unknownType = summary.creatureType;
  }

  result.changed =
    result.filled.size || result.filled.creatureType || result.filled.alignment || result.filled.cr;
  if (result.changed) {
    database
      .prepare("UPDATE compendium_entries SET data = ? WHERE id = ?")
      .run(JSON.stringify(data), entryId);
  }
  return result;
}

/** Записи бестиария системы, у которых есть D&D-статблок. */
export function monsterIdsWithDndStatblock(
  database: Database.Database,
  systemId: number
): number[] {
  return (
    database
      .prepare(
        `SELECT DISTINCT e.id FROM compendium_entries e
           JOIN statblocks s ON s.owner_type = 'compendium_entry' AND s.owner_id = e.id
          WHERE e.kind = 'monster' AND e.system_id = ? AND s.format = ?`
      )
      .all(systemId, DND_CREATURE_FORMAT) as { id: number }[]
  ).map((r) => r.id);
}
