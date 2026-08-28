import type Database from "better-sqlite3";
import {
  backfillEntrySummary,
  monsterIdsWithDndStatblock,
  readDndCreatureSummary,
} from "./monsterSummary";
import { CREATURE_SIZES, matchSize } from "../import/creatureMeta";

/**
 * «Привести справочник в порядок» — разовая уборка после импорта книги.
 *
 * Импорт кладёт в базу то, что было в файле: у существа — статблок, у
 * транспорта — таблицу строкой в описании, у поста экипажа воздушного судна —
 * запись в бестиарии с типом «Объект». Поля записей при этом остаются
 * пустыми, и фильтры разделов не видят почти ничего.
 *
 * Кнопка делает три вещи и ни одну не делает молча: заполняет пустые поля
 * бестиария из статблоков, разбирает описания транспорта в поля и переносит в
 * раздел «Транспорт» то, что человек отметил на экране сверки. Заполненное
 * руками не трогается никогда — расхождения уходят в отчёт.
 */

const VEHICLE_KINDS = new Set(["vehicle", "vehicle_post"]);

export interface MoveCandidate {
  id: number;
  name: string;
  /** Откуда переносим — показывается на экране сверки. */
  from: string;
  hint: string;
  targetKind: "vehicle" | "vehicle_post";
  /** Отмечено заранее: опознано уверенно. */
  suggested: boolean;
}

export interface TidyPlan {
  vehicleSectionId: number | null;
  bestiary: {
    entries: number;
    size: number;
    creatureType: number;
    cr: number;
    alignment: number;
  };
  vehicles: { entries: number; fields: number };
  candidates: MoveCandidate[];
}

export interface TidyReport {
  bestiary: {
    changed: number;
    size: number;
    creatureType: number;
    cr: number;
    alignment: number;
    conflicts: { name: string; field: string; entry: string; statblock: string }[];
    unknownTypes: { name: string; word: string }[];
    noStatblock: string[];
  };
  vehicles: { changed: number; fields: number; noCategory: string[] };
  moved: { name: string; from: string; to: string }[];
  vehicleSectionMissing: boolean;
}

interface EntryRow {
  id: number;
  system_id: number;
  section_id: number;
  parent_id: number | null;
  kind: string;
  name: string;
  data: string | null;
  description: string;
  position: number;
}

function parseData(raw: string | null): Record<string, unknown> {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

const entriesOf = (database: Database.Database, systemId: number) =>
  database
    .prepare(
      `SELECT e.id, e.system_id, e.section_id, e.parent_id, e.kind, e.name, e.data, e.description, e.position
         FROM compendium_entries e WHERE e.system_id = ?`
    )
    .all(systemId) as EntryRow[];

function vehicleSectionId(database: Database.Database, systemId: number): number | null {
  const row = database
    .prepare("SELECT id FROM system_sections WHERE system_id = ? AND kind = 'vehicle' ORDER BY position LIMIT 1")
    .get(systemId) as { id: number } | undefined;
  return row?.id ?? null;
}

function creatureTypeVocabulary(database: Database.Database, systemId: number): string[] {
  return (
    database
      .prepare(
        `SELECT child.name FROM compendium_entries child
           JOIN compendium_entries grp ON grp.id = child.parent_id
          WHERE grp.system_id = ? AND grp.kind = 'mechanic_group'
            AND grp.name = 'Типы существ и их особенности'`
      )
      .all(systemId) as { name: string }[]
  ).map((r) => r.name);
}

// ─── Транспорт: таблица из описания ──────────────────────────────────────────

/**
 * Книга пишет транспорт одной строкой: «Большой транспорт. Скорость: 8 миль/ч.
 * Команда: 10. Пассажиры: 20. Груз: 1 тонна. КД: 13. Хиты: 300. Порог урона: —».
 * Прочерк значит «не применимо» — такое поле не заполняется вовсе, иначе в
 * фильтре и в сводке стоял бы мусор.
 */
const VEHICLE_FIELD_PATTERNS: { key: string; re: RegExp }[] = [
  { key: "speed", re: /Скорость:\s*([^.]+)\./i },
  { key: "crew", re: /(?:Команда|Экипаж):\s*([^.]+)\./i },
  { key: "passengers", re: /Пассажиры:\s*([^.]+)\./i },
  { key: "cargo", re: /Груз:\s*([^.]+)\./i },
  { key: "ac", re: /КД:\s*([^.]+)\./i },
  { key: "hp", re: /Хиты:\s*([^.]+)\./i },
  { key: "damage_threshold", re: /Порог урона:\s*([^.]+)\./i },
];

const isBlank = (value: string) => !value || /^[—–-]+$/.test(value.trim());

/** Категория — только там, где описание говорит прямо. Наземность «от обратного» не угадываем. */
export function vehicleCategoryFrom(text: string): string {
  const plain = text.toLowerCase();
  if (/воздушн|небесн|летающ/.test(plain)) return "Воздушный";
  if (/корабл|лодк|баржа|судн|шлюп|галео|плот|парусн/.test(plain)) return "Водный";
  return "";
}

export function parseVehicleDescription(description: string): Record<string, string> {
  const out: Record<string, string> = {};
  const size = vehicleTableSize(description);
  if (size) out.size = size;
  for (const { key, re } of VEHICLE_FIELD_PATTERNS) {
    const value = description.match(re)?.[1]?.trim() ?? "";
    if (!isBlank(value)) out[key] = value;
  }
  return out;
}

/** Пост экипажа несёт прочность и класс доспеха в своём статблоке, а не в описании. */
function postFieldsFromStatblock(
  database: Database.Database,
  entryId: number
): Record<string, string> {
  const row = database
    .prepare(
      `SELECT content FROM statblocks
        WHERE owner_type = 'compendium_entry' AND owner_id = ? AND format = 'dnd_creature'
        ORDER BY id LIMIT 1`
    )
    .get(entryId) as { content: string } | undefined;
  if (!row) return {};
  let sb: Record<string, unknown>;
  try {
    sb = JSON.parse(row.content) as Record<string, unknown>;
  } catch {
    return {};
  }
  const out: Record<string, string> = {};
  const size = typeof sb.size === "string" && sb.size ? sb.size : matchSize(String(sb.sizeTypeAlignment ?? "").split(/\s+/)[0] ?? "");
  if (CREATURE_SIZES.includes(size as (typeof CREATURE_SIZES)[number])) out.size = size;
  const ac = typeof sb.armorClass === "string" ? sb.armorClass : "";
  if (!isBlank(ac)) out.ac = ac;
  const hp = typeof sb.hitPoints === "string" ? sb.hitPoints : "";
  if (!isBlank(hp)) out.hp = hp;
  return out;
}

// ─── Кандидаты на перенос ────────────────────────────────────────────────────

// Начало слова проверяется явным классом кириллицы: \b в JS считает границей
// только границу латиницы и цифр, поэтому «сани» находились внутри «опиСАНИе»,
// а «плот» — в «Воплотителе» и «Оплоте силы».
const VEHICLE_NAME_RE = /(?<![А-Яа-яЁё])(корабл|лодк|баржа|судн|повозк|телег|карет|колесниц|сани|шлюп|галео|дирижабл)/i;

/**
 * Уверенный признак — не слово «транспорт» в тексте, а таблица транспорта,
 * которой описание начинается: «Большой транспорт. Скорость: … Команда: …».
 * Просто слова мало: им описаны и пираты, грабящие транспортные суда, и
 * заклинание, которое «транспортирует существ», и «Сёдла и транспортные
 * средства» — общая подпись раздела снаряжения, стоящая и у корма для лошади.
 */
function vehicleTableSize(description: string): string {
  const head = description.trimStart().match(/^(\S+)\s+транспорт[.,\s]/i);
  return head ? matchSize(head[1]) : "";
}

/**
 * Кандидаты ищутся двумя правилами разной силы, и обе силы видны на экране
 * сверки. Уверенно (отмечено заранее): запись бестиария, у которой на месте
 * типа стоит «Объект» — это пост экипажа, а не существо; и запись снаряжения,
 * в описании которой книга прямо сказала «транспорт». Неуверенно (не
 * отмечено): всё остальное, чьё имя похоже на транспорт, — там и складная
 * лодка (магический предмет), и позолоченная карета из таблицы сокровищ.
 */
export function moveCandidates(database: Database.Database, systemId: number): MoveCandidate[] {
  const sections = new Map(
    (
      database.prepare("SELECT id, name FROM system_sections WHERE system_id = ?").all(systemId) as {
        id: number;
        name: string;
      }[]
    ).map((s) => [s.id, s.name])
  );
  const vocabulary = creatureTypeVocabulary(database, systemId);
  const out: MoveCandidate[] = [];
  for (const e of entriesOf(database, systemId)) {
    if (VEHICLE_KINDS.has(e.kind)) continue;
    const from = sections.get(e.section_id) ?? "";
    if (e.kind === "monster") {
      const summary = readDndCreatureSummary(database, e.id, vocabulary);
      if (summary?.unknownType && /^объект/i.test(summary.unknownType)) {
        out.push({
          id: e.id,
          name: e.name,
          from,
          hint: "В статблоке «Объект» вместо типа существа",
          targetKind: "vehicle_post",
          suggested: true,
        });
        continue;
      }
    }
    if (vehicleTableSize(e.description)) {
      out.push({
        id: e.id,
        name: e.name,
        from,
        hint: e.description.slice(0, 120),
        targetKind: "vehicle",
        suggested: true,
      });
      continue;
    }
    if (VEHICLE_NAME_RE.test(e.name)) {
      out.push({
        id: e.id,
        name: e.name,
        from,
        hint: e.description.slice(0, 120),
        targetKind: "vehicle",
        suggested: false,
      });
    }
  }
  return out.sort((a, b) => Number(b.suggested) - Number(a.suggested) || a.name.localeCompare(b.name));
}

// ─── План и применение ───────────────────────────────────────────────────────

/** Сколько работы найдено — числа для подтверждения перед запуском. */
export function planTidy(database: Database.Database, systemId: number): TidyPlan {
  const vocabulary = creatureTypeVocabulary(database, systemId);
  const plan: TidyPlan = {
    vehicleSectionId: vehicleSectionId(database, systemId),
    bestiary: { entries: 0, size: 0, creatureType: 0, cr: 0, alignment: 0 },
    vehicles: { entries: 0, fields: 0 },
    candidates: moveCandidates(database, systemId),
  };

  for (const id of monsterIdsWithDndStatblock(database, systemId)) {
    const summary = readDndCreatureSummary(database, id, vocabulary);
    if (!summary) continue;
    const data = parseData(
      (database.prepare("SELECT data FROM compendium_entries WHERE id = ?").get(id) as { data: string | null }).data
    );
    let any = false;
    if (!data.size && summary.size) (plan.bestiary.size++, (any = true));
    if (!data.alignment && summary.alignment) (plan.bestiary.alignment++, (any = true));
    if (!data.cr && summary.cr) (plan.bestiary.cr++, (any = true));
    if (!data.creature_type && summary.creatureType) (plan.bestiary.creatureType++, (any = true));
    if (any) plan.bestiary.entries++;
  }

  // Считается и то, что ещё лежит в Снаряжении: перенос и разбор идут одним
  // прогоном, и в подтверждении должно стоять число, которое человек потом
  // увидит в отчёте, а не ноль «в разделе пока пусто».
  const suggested = new Set(plan.candidates.filter((c) => c.suggested).map((c) => c.id));
  for (const e of entriesOf(database, systemId)) {
    if (!VEHICLE_KINDS.has(e.kind) && !suggested.has(e.id)) continue;
    const asPost =
      e.kind === "vehicle_post" ||
      plan.candidates.some((c) => c.id === e.id && c.targetKind === "vehicle_post");
    const parsed = asPost
      ? { ...parseVehicleDescription(e.description), ...postFieldsFromStatblock(database, e.id) }
      : parseVehicleDescription(e.description);
    const data = parseData(e.data);
    const fresh = Object.entries(parsed).filter(([k, v]) => v && !data[k]).length;
    if (fresh) {
      plan.vehicles.entries++;
      plan.vehicles.fields += fresh;
    }
  }
  return plan;
}

export function applyTidy(
  database: Database.Database,
  systemId: number,
  moveIds: number[]
): TidyReport {
  const vocabulary = creatureTypeVocabulary(database, systemId);
  const sectionId = vehicleSectionId(database, systemId);
  const report: TidyReport = {
    bestiary: {
      changed: 0,
      size: 0,
      creatureType: 0,
      cr: 0,
      alignment: 0,
      conflicts: [],
      unknownTypes: [],
      noStatblock: [],
    },
    vehicles: { changed: 0, fields: 0, noCategory: [] },
    moved: [],
    vehicleSectionMissing: sectionId === null,
  };

  const run = database.transaction(() => {
    // 1. Бестиарий из статблоков.
    const withStatblock = new Set(monsterIdsWithDndStatblock(database, systemId));
    const names = new Map(
      (
        database
          .prepare("SELECT id, name FROM compendium_entries WHERE system_id = ? AND kind = 'monster'")
          .all(systemId) as { id: number; name: string }[]
      ).map((r) => [r.id, r.name])
    );
    for (const [id, name] of names) {
      if (!withStatblock.has(id)) {
        report.bestiary.noStatblock.push(name);
        continue;
      }
      const result = backfillEntrySummary(database, id, vocabulary);
      if (result.changed) report.bestiary.changed++;
      if (result.filled.size) report.bestiary.size++;
      if (result.filled.creatureType) report.bestiary.creatureType++;
      if (result.filled.cr) report.bestiary.cr++;
      if (result.filled.alignment) report.bestiary.alignment++;
      for (const c of result.conflicts) report.bestiary.conflicts.push({ name, ...c });
      if (result.unknownType) report.bestiary.unknownTypes.push({ name, word: result.unknownType });
    }

    // 2. Перенос отмеченного в «Транспорт» — до разбора описаний, чтобы
    // перенесённое разобралось этим же прогоном.
    const wanted = new Set(moveIds);
    if (sectionId !== null && wanted.size) {
      const sections = new Map(
        (
          database
            .prepare("SELECT id, name FROM system_sections WHERE system_id = ?")
            .all(systemId) as { id: number; name: string }[]
        ).map((s) => [s.id, s.name])
      );
      const { p } = database
        .prepare("SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE section_id = ?")
        .get(sectionId) as { p: number };
      let position = p;
      for (const c of moveCandidates(database, systemId)) {
        if (!wanted.has(c.id)) continue;
        const row = database
          .prepare("SELECT data, description FROM compendium_entries WHERE id = ?")
          .get(c.id) as { data: string | null; description: string };
        const data = parseData(row.data);
        // Категория снаряжения — «Прочие предметы»: в разделе транспорта это
        // поле означает среду, и старое значение туда не годится.
        if (c.targetKind === "vehicle") {
          data.category = vehicleCategoryFrom(`${c.name} ${row.description}`);
          if (!data.category) delete data.category;
        } else {
          // Пост экипажа — узел судна: среды, класса опасности и
          // мировоззрения у него не бывает, даже если они достались от
          // записи бестиария, которой он был.
          delete data.category;
          delete data.cr;
          delete data.alignment;
          delete data.creature_type;
        }
        delete data.weight;
        database
          .prepare(
            "UPDATE compendium_entries SET section_id = ?, kind = ?, parent_id = NULL, position = ?, data = ? WHERE id = ?"
          )
          .run(sectionId, c.targetKind, position++, JSON.stringify(data), c.id);
        report.moved.push({ name: c.name, from: c.from, to: sections.get(sectionId) ?? "Транспорт" });
      }
    }

    // 3. Описания транспорта в поля.
    for (const e of entriesOf(database, systemId)) {
      if (!VEHICLE_KINDS.has(e.kind)) continue;
      const parsed =
        e.kind === "vehicle_post"
          ? { ...parseVehicleDescription(e.description), ...postFieldsFromStatblock(database, e.id) }
          : parseVehicleDescription(e.description);
      const data = parseData(e.data);
      let fields = 0;
      for (const [key, value] of Object.entries(parsed)) {
        if (!value || data[key]) continue;
        data[key] = value;
        fields++;
      }
      if (e.kind === "vehicle" && !data.category) {
        const category = vehicleCategoryFrom(`${e.name} ${e.description}`);
        if (category) {
          data.category = category;
          fields++;
        } else {
          report.vehicles.noCategory.push(e.name);
        }
      }
      if (!fields) continue;
      report.vehicles.changed++;
      report.vehicles.fields += fields;
      database.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?").run(JSON.stringify(data), e.id);
    }
  });
  run();
  // Перенесённое из отчёта по бестиарию убирается: «Штурвал» попал в него как
  // существо с неопознанным типом, но этим же прогоном перестал быть
  // существом, и просить проставить ему тип уже не за чем.
  const moved = new Set(report.moved.map((m) => m.name));
  report.bestiary.unknownTypes = report.bestiary.unknownTypes.filter((u) => !moved.has(u.name));
  return report;
}
