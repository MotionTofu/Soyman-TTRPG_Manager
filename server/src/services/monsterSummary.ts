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
 * Размер, тип, мировоззрение и класс опасности хранятся дважды — в
 * `compendium_entries.data` и внутри D&D-статблока. Убрать дубль нельзя: по
 * `data` работают фильтры раздела бестиария, а статблок — это цельный
 * документ формата, из которого поля не выдёргиваются.
 *
 * Направления синхронизации разные:
 * - **Живое:** правку деталей существа (раздел/«Досье», `writeDndCreatureSummary`)
 *   и правку статблока (`syncCreatureDataFromStatblock`) считаем равноценными,
 *   «что сохранили последним, то канонично». Живая правка статблока пишет
 *   значение, даже если в `data` уже что-то стоит.
 * - **Дозаполнение:** стартовый проход (`backfillCompendiumSummaries`) и
 *   импорт заполняют только пустое — значение, поставленное руками, молча не
 *   перетирается, расхождение уходит в отчёт (`conflicts`).
 *
 * Формат важнее системы записи: одно и то же существо бестиария D&D может
 * нести статблок Legend in the Mist — ради того и заведены статблоки разных
 * форматов у одной записи. Привязка к системе сломала бы ровно этот случай.
 */

export interface CreatureSummary {
  size: string;
  creatureType: string;
  alignment: string;
  /** Класс опасности. Двусторонний: живёт в `data` и в статблоке. */
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

/** Справочник типов существ механик системы — по нему работает фильтр раздела. */
export function creatureTypeRows(
  database: Database.Database,
  systemId: number
): { id: number; name: string }[] {
  return database
    .prepare(
      `SELECT child.id, child.name
         FROM compendium_entries child
         JOIN compendium_entries grp ON grp.id = child.parent_id
        WHERE grp.system_id = ? AND grp.kind = 'mechanic_group'
          AND grp.name = 'Типы существ и их особенности'`
    )
    .all(systemId) as { id: number; name: string }[];
}

/** Тип книги к значению справочника: по точному имени или по основе слова. */
function resolveCreatureType(
  type: string,
  rows: { id: number; name: string }[]
): { id: number; name: string } | null {
  if (!type.trim()) return null;
  const exact = rows.find((r) => normalizeName(r.name) === normalizeName(type));
  if (exact) return exact;
  // Книга склоняет тип по роду и стае — «Среднее Исчадие», «стая Крошечных
  // Зверей», — а справочник хранит именительный.
  const matched = matchCreatureType(type, rows.map((r) => r.name));
  return matched ? rows.find((r) => r.name === matched) ?? null : null;
}

/** Первый D&D-статблок записи; чужие форматы не берутся. */
function readFirstDndStatblock(
  database: Database.Database,
  entryId: number
): { content: string } | null {
  return (
    (database
      .prepare(
        `SELECT content FROM statblocks
          WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = ?
          ORDER BY id LIMIT 1`
      )
      .get(entryId, DND_CREATURE_FORMAT) as { content: string } | undefined) ?? null
  );
}

/**
 * Сводка из содержимого одного dnd-статблока. Значение null, если контент не
 * в формате dnd_creature: строку книги разобрать можно, числа — нет.
 */
export function parseDndCreatureSummary(
  content: string,
  vocabulary?: string[]
): CreatureSummary | null {
  try {
    const sb = JSON.parse(content) as Record<string, unknown>;
    if (typeof sb !== "object" || sb === null) return null;
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
  const row = readFirstDndStatblock(database, entryId);
  return row ? parseDndCreatureSummary(row.content, vocabulary) : null;
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
    if (patch.cr !== undefined) {
      // Новые статблоки носят CR в challenge.rating, импортированные по-старому
      // — в challengeRating. Пишем туда, где поле уже есть; если нет вовсе —
      // в новое место, старую форму больше не рождаем.
      const challenge = sb.challenge as { rating?: string } | undefined;
      if (challenge && typeof challenge === "object") challenge.rating = patch.cr;
      else sb.challengeRating = patch.cr;
    }
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
  const filledSummary = fillEmptySummary(data, summary, creatureTypeRows(database, entry.system_id));
  const result: SummaryFillResult = {
    filled: filledSummary.filled,
    conflicts: filledSummary.conflicts,
    unknownType: filledSummary.unknownType,
    changed: filledSummary.changed,
  };
  if (result.changed) {
    database
      .prepare("UPDATE compendium_entries SET data = ? WHERE id = ?")
      .run(JSON.stringify(data), entryId);
  }
  return result;
}

/**
 * Дозаполнение пустой сводки из одной разобранной записи — общий для точечной
 * и пачечной форм. Заполненное не перезаписывается: значение, поставленное
 * руками, поставлено осознанно, — расхождение возвращается, чтобы не пропало
 * молча.
 */
function fillEmptySummary(
  data: Record<string, unknown>,
  summary: CreatureSummary,
  rows: { id: number; name: string }[]
): {
  changed: boolean;
  filled: { size: boolean; creatureType: boolean; alignment: boolean; cr: boolean };
  conflicts: { field: string; entry: string; statblock: string }[];
  unknownType: string;
} {
  const result = {
    changed: false,
    filled: { size: false, creatureType: false, alignment: false, cr: false },
    conflicts: [] as { field: string; entry: string; statblock: string }[],
    unknownType: summary.unknownType,
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
    const ref = resolveCreatureType(summary.creatureType, rows);
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

/**
 * Отчёт стартового прохода (index.ts) и импорта: из него складываются строки
 * лога и видно, что проход заполнил, а что не трогал намеренно.
 */
export interface SummaryFillReport {
  /** Сколько монстров с dnd-статблоком проверили. */
  checked: number;
  /** Сколько записей проход реально изменил. */
  changed: number;
  filled: { size: number; creatureType: number; alignment: number; cr: number };
  /** Поле записи расходится со статблоком; заполненное руками не трогаем. */
  conflicts: { name: string; field: string; entry: string; statblock: string }[];
  /** Слово на месте типа, не найденное в словаре механик: «Объект», «бестия». */
  unknownTypes: { name: string; word: string }[];
}

/**
 * Дозаполнение пустых сводок сразу по всем монстрам систем(ы) — стартовый
 * проход импорта (index.ts, import/…). Один запрос на систему вместо
 * «монитор × поштучно», дозаполняется только пустое: правило сходится с
 * `fillEmptySummary`, поэтому агрегированный отчёт равен сумме точечных.
 *
 * `systemId` опционален — без него проход идёт по всем системам и не пишет
 * батчами больше, чем нужно (по 100 UPDATE-стейтментов не хватает).
 */
export function backfillCompendiumSummaries(
  database: Database.Database,
  systemId?: number
): SummaryFillReport {
  const systems: { id: number }[] =
    systemId === undefined
      ? (database.prepare("SELECT id FROM systems").all() as { id: number }[])
      : [{ id: systemId }];
  const report: SummaryFillReport = {
    checked: 0,
    changed: 0,
    filled: { size: 0, creatureType: 0, alignment: 0, cr: 0 },
    conflicts: [],
    unknownTypes: [],
  };

  // Монстр + его первый dnd-статблок одним проходом. ROW_NUMBER нужен, чтобы
  // у записи с несколькими статблоками взять именно первый, а не рандомный.
  const query = database.prepare(
    `SELECT e.id, e.name, e.data, s.content
       FROM (
         SELECT ce.id, ce.name, ce.data, s.id AS sb_id,
                ROW_NUMBER() OVER (PARTITION BY ce.id ORDER BY s.id) AS rn
           FROM compendium_entries ce
           JOIN statblocks s ON s.owner_type = 'compendium_entry' AND s.owner_id = ce.id
          WHERE ce.kind = 'monster' AND ce.system_id = ? AND s.format = ?
       ) e
       JOIN statblocks s ON s.owner_type = 'compendium_entry' AND s.owner_id = e.id AND s.id = e.sb_id
      WHERE e.rn = 1`
  );
  const update = database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");

  const run = database.transaction((systems: { id: number }[]) => {
    for (const s of systems) {
      const rows = creatureTypeRows(database, s.id);
      const vocabulary = rows.map((r) => r.name);
      const monsters = query.all(s.id, DND_CREATURE_FORMAT) as {
        id: number;
        name: string;
        data: string | null;
        content: string;
      }[];
      if (!monsters.length) continue;
      for (const m of monsters) {
        report.checked++;
        const summary = parseDndCreatureSummary(m.content, vocabulary);
        if (!summary) continue;
        const data = parseData(m.data);
        const r = fillEmptySummary(data, summary, rows);
        if (r.changed) {
          update.run(JSON.stringify(data), m.id);
          report.changed++;
          if (r.filled.size) report.filled.size++;
          if (r.filled.creatureType) report.filled.creatureType++;
          if (r.filled.alignment) report.filled.alignment++;
          if (r.filled.cr) report.filled.cr++;
        }
        for (const c of r.conflicts) report.conflicts.push({ name: m.name, ...c });
        if (r.unknownType) report.unknownTypes.push({ name: m.name, word: r.unknownType });
      }
    }
  });
  run(systems);

  return report;
}

/**
 * Живая синхронизация: правка статблока существа переписывает сводку записи.
 * «Что сохранили последним, то канонично» — статблок источник истины для
 * механических полей, поэтому значение пишется, даже если в data уже есть.
 * Обратное направление (правка «Досье»/строки раздела → статблок) делает
 * `writeDndCreatureSummary`: обе правки идут через одну точку изменения поля,
 * на сохранении последнее всегда канонично.
 *
 * Тип, не найденный в словаре механик, кладётся как `{ name }` без id: раздела
 * фильтруют по имени, а поиск по имени у потерявшегося значения не падает.
 */
export function syncCreatureDataFromStatblock(
  database: Database.Database,
  entryId: number
): void {
  const entry = database
    .prepare("SELECT id, system_id, data FROM compendium_entries WHERE id = ? AND kind = 'monster'")
    .get(entryId) as EntryRow | undefined;
  if (!entry) return;
  const row = readFirstDndStatblock(database, entryId);
  if (!row) return;
  const rows = creatureTypeRows(database, entry.system_id);
  const summary = parseDndCreatureSummary(row.content, rows.map((r) => r.name));
  if (!summary) return;

  const data = parseData(entry.data);
  let changed = false;
  if (summary.size && (data.size ?? "") !== summary.size) {
    data.size = summary.size;
    changed = true;
  }
  if (summary.alignment && (data.alignment ?? "") !== summary.alignment) {
    data.alignment = summary.alignment;
    changed = true;
  }
  if (summary.cr && (data.cr ?? "") !== summary.cr) {
    data.cr = summary.cr;
    changed = true;
  }
  if (summary.creatureType) {
    const current = data.creature_type as { name?: string } | undefined;
    const ref = resolveCreatureType(summary.creatureType, rows);
    const next = ref ?? { name: summary.creatureType };
    if (!current || current.name !== next.name) {
      data.creature_type = next;
      changed = true;
    }
  }

  if (changed) {
    database
      .prepare("UPDATE compendium_entries SET data = ? WHERE id = ?")
      .run(JSON.stringify(data), entryId);
  }
}
