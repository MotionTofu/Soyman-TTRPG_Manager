// Разбор файла в план импорта: что именно появится в базе, разложенное по
// разделам, и с чем из уже существующего оно совпадает по имени.
//
// Экран сверки (Этап 4) целиком строится по этому плану: галочка на каждой
// сущности, выбор «создать новую или использовать существующую» на найденных
// совпадениях и правка категории личности, которую модель угадывает хуже всего.
//
// Совпадения ищутся по всем известным именам сущности: название, короткое имя,
// оригинал («Sea Ward») и синонимы — разные переводы одной книги зовут район то
// «Морским округом», то «Приморским». Что не поймалось точно, ловится нечётким
// сравнением по словам и показывается отдельно, как «похоже». Автоматически не
// склеивается ничего: ошибочная склейка дороже лишнего дубля.

import { db } from "../db/db";
import { ImportFile } from "./format";
import { compendiumCandidates, matchCompendium } from "./compendium";
import { entityName } from "./apply";
import {
  NameMatch,
  buildTokenWeights,
  normalizeName as normalize,
  parseAliases,
  similarity,
} from "./names";

export type PlanMatch = NameMatch;

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
  /** Как зовут то, на что ведёт занятый ключ: столкновение видно только так. */
  knownName?: string | null;
  matches: PlanMatch[];
  /** Только для бестиария: монстры компендиума, с которыми можно связать. */
  compendium?: PlanMatch[];
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

interface ExistingRow {
  id: number;
  name: string;
  short_name?: string | null;
  hint?: string | null;
  aliases?: string | null;
  name_original?: string | null;
}

interface ExistingIndex {
  /** Точное совпадение: нормализованное имя/синоним/оригинал → строки. */
  exact: Map<string, PlanMatch[]>;
  /** Все имена всех строк — для нечёткого сравнения по словам. */
  all: { row: ExistingRow; names: string[]; ref: string }[];
  /** Вес слов по редкости среди этих же строк: «район» дешёв, «сафар» дорог. */
  weights: Map<string, number>;
}

/** Индекс существующих сущностей одного типа. */
function indexExisting(rows: ExistingRow[], type: string): ExistingIndex {
  const exact = new Map<string, PlanMatch[]>();
  const all: ExistingIndex["all"] = [];
  for (const row of rows) {
    const ref = `${type}:${row.id}`;
    const named: [string, string][] = [
      [row.name, "совпадает название"],
      [row.short_name ?? "", "совпадает короткое имя"],
      [row.name_original ?? "", "совпадает оригинальное название"],
      ...parseAliases(row.aliases).map((a): [string, string] => [a, `известен и как «${a}»`]),
    ];
    for (const [name, reason] of named) {
      if (!name.trim()) continue;
      const list = exact.get(normalize(name)) ?? [];
      if (!list.some((m) => m.ref === ref)) {
        list.push({ ref, name: row.name, hint: row.hint ?? "", reason, exact: true });
      }
      exact.set(normalize(name), list);
    }
    all.push({ row, ref, names: named.map(([n]) => n).filter((n) => n.trim()) });
  }
  return { exact, all, weights: buildTokenWeights(all.map((r) => r.names)) };
}

const EMPTY_INDEX: ExistingIndex = { exact: new Map(), all: [], weights: new Map() };

function existing(settingId: number | null): Record<string, ExistingIndex> {
  if (settingId == null) {
    return { location: EMPTY_INDEX, being: EMPTY_INDEX, community: EMPTY_INDEX, artifact: EMPTY_INDEX, adventure: EMPTY_INDEX };
  }
  const q = <T>(sql: string) => db.prepare(sql).all(settingId) as T[];
  return {
    location: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, short_name, aliases, name_original, kind as hint FROM setting_locations
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "location"
    ),
    being: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, short_name, aliases, name_original, category as hint FROM setting_beings
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "being"
    ),
    community: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, '' as short_name, aliases, name_original, '' as hint FROM setting_communities
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "community"
    ),
    artifact: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, short_name, aliases, name_original, rarity as hint FROM artifacts
         WHERE setting_id = ? AND archived_at IS NULL`
      ),
      "artifact"
    ),
    adventure: indexExisting(
      q<ExistingRow>(
        `SELECT id, name, '' as short_name, '[]' as aliases, '' as name_original, kind as hint
         FROM story_arcs
         WHERE setting_id = ? AND archived_at IS NULL AND kind = 'adventure'
           AND campaign_id IS NULL`
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
  const monsters = compendiumCandidates(settingId, "monster");
  const magicItems = compendiumCandidates(settingId, "magic_item");

  const entry = (
    type: keyof typeof index,
    key: string,
    name: string,
    note: string,
    aliases: string[] = [],
    category?: string,
    nameOriginal?: string
  ): PlanEntry => {
    const candidates = [name, ...aliases, nameOriginal ?? ""].filter((c) => c.trim());
    const matches: PlanMatch[] = [];
    const seen = new Set<string>();
    for (const candidate of candidates) {
      for (const match of index[type].exact.get(normalize(candidate)) ?? []) {
        if (seen.has(match.ref)) continue;
        seen.add(match.ref);
        matches.push(match);
      }
    }
    // Нечёткие кандидаты — только если точного совпадения не нашлось вовсе:
    // иначе «похоже» лишь замусорит выбор рядом с уверенным попаданием.
    if (!matches.length) {
      const fuzzy: (PlanMatch & { score: number })[] = [];
      for (const row of index[type].all) {
        if (seen.has(row.ref)) continue;
        let score = 0;
        for (const candidate of candidates) {
          for (const other of row.names)
            score = Math.max(score, similarity(candidate, other, index[type].weights));
        }
        if (score >= 0.5) {
          fuzzy.push({
            ref: row.ref,
            name: row.row.name,
            hint: row.row.hint ?? "",
            reason: "похоже по написанию",
            exact: false,
            score,
          });
        }
      }
      fuzzy.sort((a, b) => b.score - a.score);
      for (const { score, ...match } of fuzzy.slice(0, 3)) {
        void score;
        matches.push(match);
      }
    }
    const known = knownKeys[key] ?? null;
    return { key, type, name, note, category, known, knownName: entityName(known), matches };
  };

  const sceneCount = (advKey: string) =>
    data.adventures.find((a) => a.key === advKey)?.scenes.length ?? 0;

  const sections: PlanSection[] = [
    {
      id: "locations",
      title: "Локации",
      type: "location",
      entries: data.locations.map((l) =>
        entry("location", l.key, l.name, l.kind, l.aliases, undefined, l.name_original)
      ),
    },
    {
      id: "beings",
      title: "Личности",
      type: "being",
      entries: data.beings.map((b) =>
        entry("being", b.key, b.name, b.short_name ?? "", b.aliases, b.category, b.name_original)
      ),
    },
    {
      id: "bestiary",
      title: "Бестиарий",
      type: "being",
      entries: data.bestiary.map((b) => ({
        ...entry(
          "being",
          b.key,
          b.name,
          b.compendium_hints.join(", "),
          b.aliases,
          undefined,
          b.name_original
        ),
        // Подсказки из файла ищем наравне с именами: модель пишет в них то
        // название, под которым монстр известен в системе, и оно совпадает
        // с компендиумом чаще, чем имя из книги.
        compendium: matchCompendium(
          [b.name, b.name_original ?? "", ...b.aliases, ...b.compendium_hints],
          monsters
        ),
      })),
    },
    {
      id: "communities",
      title: "Сообщества",
      type: "community",
      entries: data.communities.map((c) =>
        entry("community", c.key, c.name, "", c.aliases, undefined, c.name_original)
      ),
    },
    {
      id: "treasury",
      title: "Сокровищница",
      type: "artifact",
      entries: data.treasury.map((t) => ({
        ...entry(
          "artifact",
          t.key,
          t.name,
          [t.item_type, t.rarity].filter(Boolean).join(", "),
          t.aliases,
          undefined,
          t.name_original
        ),
        // Только предметы с редкостью: она и отличает вещь правил, которой
        // место в справочнике системы, от реквизита этой книги — гроссбуха,
        // письма, ключа от склада. У реквизита редкости не бывает.
        compendium: t.rarity.trim()
          ? matchCompendium([t.name, t.name_original ?? "", ...t.aliases], magicItems)
          : undefined,
      })),
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
    "карточки статблоков": [...data.beings, ...data.bestiary].filter((b) => b.statblock).length,
  };
  for (const [what, count] of Object.entries(extras)) if (!count) delete extras[what];

  return { sections, extras };
}
