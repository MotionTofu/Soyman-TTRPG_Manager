// Разбор файла в план импорта: что именно появится в базе, разложенное по
// разделам, и с чем из уже существующего оно совпадает по имени.
//
// Экран сверки (Этап 4) целиком строится по этому плану: галочка на каждой
// сущности, выбор «создать новую или использовать существующую» на найденных
// совпадениях и правка категории личности, которую модель угадывает хуже всего.
//
// Совпадения ищутся только по имени — на пробных прогонах модель возвращает то
// «Мирт», то «Мирт Множественный», поэтому сверх точного совпадения сравниваются
// ещё короткое имя и алиасы. Автоматически ничего не склеивается: решение за
// человеком, ошибочная склейка дороже лишнего дубля.

import { db } from "../db/db";
import { ImportFile } from "./format";

export interface PlanMatch {
  /** Кого нашли: "тип:id" — в этом же виде уходит обратно в apply. */
  ref: string;
  name: string;
  hint: string;
}

export interface PlanEntry {
  key: string;
  type: string;
  name: string;
  /** Подпись под именем: тип локации, число сцен, редкость предмета. */
  note: string;
  /** Только для личностей: категория, которую предложила модель. */
  category?: string;
  /** Ключ уже импортирован раньше — сущность создаваться не будет. */
  known: string | null;
  matches: PlanMatch[];
}

export interface PlanSection {
  /** Ключ раздела для галочки «весь раздел целиком». */
  id: string;
  title: string;
  type: string;
  entries: PlanEntry[];
}

export interface ImportPlan {
  sections: PlanSection[];
  /** Что приедет без отдельной галочки: сцены, проверки, награды и прочее. */
  extras: Record<string, number>;
}

/** «Ёлка» и «Ёлка » и «ёлка» — одно и то же имя. */
function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ");
}

interface ExistingRow {
  id: number;
  name: string;
  short_name?: string | null;
  hint?: string | null;
}

/** Индекс существующих сущностей одного типа: нормализованное имя → строки. */
function indexExisting(rows: ExistingRow[], type: string): Map<string, PlanMatch[]> {
  const index = new Map<string, PlanMatch[]>();
  const put = (name: string | null | undefined, row: ExistingRow) => {
    if (!name?.trim()) return;
    const list = index.get(normalize(name)) ?? [];
    if (list.some((m) => m.ref === `${type}:${row.id}`)) return;
    list.push({ ref: `${type}:${row.id}`, name: row.name, hint: row.hint ?? "" });
    index.set(normalize(name), list);
  };
  for (const row of rows) {
    put(row.name, row);
    put(row.short_name, row);
  }
  return index;
}

function existing(settingId: number | null) {
  const empty = { location: new Map(), being: new Map(), community: new Map(), artifact: new Map(), adventure: new Map() };
  if (settingId == null) return empty as Record<string, Map<string, PlanMatch[]>>;
  const q = <T>(sql: string) => db.prepare(sql).all(settingId) as T[];
  return {
    location: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, short_name, kind as hint FROM setting_locations
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "location"
    ),
    being: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, short_name, category as hint FROM setting_beings
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "being"
    ),
    community: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, '' as short_name, '' as hint FROM setting_communities
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "community"
    ),
    artifact: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, short_name, rarity as hint FROM artifacts
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "artifact"
    ),
    adventure: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, '' as short_name, kind as hint FROM story_arcs
         WHERE setting_id = ? AND archived_at IS NULL AND kind = 'adventure'`
      ),
      "adventure"
    ),
  };
}

export function buildPlan(
  data: ImportFile,
  settingId: number | null,
  knownKeys: Record<string, string> = {}
): ImportPlan {
  const index = existing(settingId);

  const entry = (
    type: keyof typeof index,
    key: string,
    name: string,
    note: string,
    aliases: string[] = [],
    category?: string
  ): PlanEntry => {
    const matches: PlanMatch[] = [];
    const seen = new Set<string>();
    for (const candidate of [name, ...aliases]) {
      for (const match of index[type].get(normalize(candidate)) ?? []) {
        if (seen.has(match.ref)) continue;
        seen.add(match.ref);
        matches.push(match);
      }
    }
    return { key, type, name, note, category, known: knownKeys[key] ?? null, matches };
  };

  const sceneCount = (advKey: string) =>
    data.adventures.find((a) => a.key === advKey)?.scenes.length ?? 0;

  const sections: PlanSection[] = [
    {
      id: "locations",
      title: "Локации",
      type: "location",
      entries: data.locations.map((l) =>
        entry("location", l.key, l.name, l.kind, l.aliases)
      ),
    },
    {
      id: "beings",
      title: "Личности",
      type: "being",
      entries: data.beings.map((b) =>
        entry("being", b.key, b.name, b.short_name ?? "", b.aliases, b.category)
      ),
    },
    {
      id: "bestiary",
      title: "Бестиарий",
      type: "being",
      entries: data.bestiary.map((b) =>
        entry("being", b.key, b.name, b.compendium_hints.join(", "))
      ),
    },
    {
      id: "communities",
      title: "Сообщества",
      type: "community",
      entries: data.communities.map((c) => entry("community", c.key, c.name, "", c.aliases)),
    },
    {
      id: "treasury",
      title: "Сокровищница",
      type: "artifact",
      entries: data.treasury.map((t) =>
        entry("artifact", t.key, t.name, [t.item_type, t.rarity].filter(Boolean).join(", "))
      ),
    },
    {
      id: "adventures",
      title: "Приключения",
      type: "adventure",
      entries: data.adventures.map((a) => {
        const scenes = sceneCount(a.key);
        const chapters = a.chapters.length;
        return entry(
          "adventure",
          a.key,
          a.name,
          `${chapters ? `${chapters} гл., ` : ""}${scenes} сц.`
        );
      }),
    },
  ].filter((section) => section.entries.length > 0);

  const scenes = data.adventures.flatMap((a) => a.scenes);
  const extras: Record<string, number> = {
    главы: data.adventures.flatMap((a) => a.chapters).length,
    сцены: scenes.length,
    проверки: scenes.flatMap((s) => s.checks).length,
    награды:
      scenes.flatMap((s) => s.rewards).length + data.adventures.flatMap((a) => a.rewards).length,
    вехи: data.adventures.flatMap((a) => a.milestones).length,
    тайны: data.adventures.flatMap((a) => a.secrets).length,
    переходы: scenes.flatMap((s) => s.next).length,
    "события календаря": data.calendar_events.length,
    отношения: data.relations.length,
    связи: data.links.length,
  };
  for (const [what, count] of Object.entries(extras)) if (!count) delete extras[what];

  return { sections, extras };
}
