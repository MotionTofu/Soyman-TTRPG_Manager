// Запись разобранного файла adventure-import/1 в базу.
//
// Всё делается в одной транзакции better-sqlite3: либо появляется весь разбор,
// либо не появляется ничего. Каждая созданная строка записывается в
// import_records, поэтому откат батча — это удаление по списку, а не догадки о
// том, что именно приехало из файла.
//
// Ключи резолвятся в два прохода: сначала создаются все сущности и копится
// карта «ключ → тип:id», потом по ней проставляются ссылки и подменяются
// меншены [[ключ|подпись]] → [[тип:id|подпись]]. Иначе сцена не смогла бы
// сослаться на локацию, объявленную ниже по файлу.

import { db } from "../db/db";
import {
  settingFolder,
  settingGeographyRoot,
  locationFolder,
  beingFolder,
  communityFolder,
  artifactFolder,
} from "../services/filesystem";
import { ImportFile, ImportStatblock } from "./format";
import { Problem } from "./validate";
import { normalizeName } from "./names";
import {
  CompendiumKind,
  cleanChallengeRating,
  creatureTypeRef,
  importSystems,
  itemRarity,
  itemType,
  parseSizeType,
  validCompendiumIds,
} from "./compendium";

export interface ApplyOptions {
  /** Куда импортировать. null — создать новый сеттинг из data.setting. */
  settingId: number | null;
  fileName: string;
  /** Ключи прошлых батчей этого сеттинга: key → "тип:id". Многофайловость. */
  knownKeys?: Record<string, string>;
  /** Ключи, снятые галочкой на экране сверки: не создавать вовсе. */
  skip?: string[];
  /**
   * Совпавшие с существующим: key → "тип:id". Сущность не создаётся, ссылки и
   * упоминания ведут на неё, но саму её импорт не трогает — кроме приключения,
   * в которое дозаливаются главы и сцены.
   */
  reuse?: Record<string, string>;
  /** Правка категории личности человеком: key → key_figure | influential | notable. */
  categories?: Record<string, string>;
  /**
   * Выбранные на экране сверки монстры компендиума: key записи бестиария →
   * id записей compendium_entries. Связь дописывается и к уже существующей
   * записи — это явный выбор человека, а не переписывание чужого.
   */
  compendium?: Record<string, number[]>;
  /**
   * Ключи записей бестиария, для которых в компендиуме системы нужно завести
   * монстра: в книге он есть, в системе его ещё нет.
   */
  compendiumNew?: string[];
  /**
   * В компендиум какой системы писать. Сеттинг с системой не связан напрямую,
   * а Вотердип водят сразу в двух — угадать нельзя, выбирает человек.
   */
  compendiumSystem?: number | null;
  /**
   * Ключи, про которые человек на экране сверки сказал «это другая сущность».
   *
   * Ключи выводятся из имён детерминированно, и на типовых названиях книги
   * сталкиваются: `item.wand_of_secrets` в двух разных приключениях — две
   * разные палочки. Без этого списка вторая молча не создавалась бы, а ссылки
   * на неё вели бы на чужой предмет из прошлой книги.
   */
  detach?: string[];
}

export interface ApplyResult {
  batchId: number;
  settingId: number;
  settingCreated: boolean;
  counts: Record<string, number>;
  warnings: Problem[];
  keys: Record<string, string>;
}

interface Ref {
  type: string;
  id: number;
}

/** Тип сущности → таблица, из которой её удаляет откат. */
export const ROLLBACK_TABLES: Record<string, string> = {
  setting: "settings",
  location: "setting_locations",
  being: "setting_beings",
  community: "setting_communities",
  artifact: "artifacts",
  adventure: "story_arcs",
  scene: "story_scenes",
  calendar_event: "setting_calendar_events",
  relation: "entity_relations",
  link: "generic_links",
  important_date: "important_dates",
  // Вехи, тайны и награды приключения каскадом уходят только за своей дугой.
  // Если дуга существовала до импорта (дозалив в существующее приключение),
  // удалять их должен откат — поэтому они тоже поимённо в import_records.
  milestone: "story_milestones",
  secret: "story_secrets",
  reward: "story_scene_rewards",
  // Статблок висит на существе полиморфно, без внешнего ключа: каскад его не
  // унесёт, удалять должен откат.
  statblock: "statblocks",
  // Монстр, заведённый импортом в компендиуме системы. Компендиум общий для
  // всех кампаний на этой системе, поэтому откат обязан убирать за собой.
  compendium_entry: "compendium_entries",
};

/** Типы, у которых есть поле «Другие названия»: только им можно дописать синоним. */
const ALIAS_TABLES: Record<string, string> = {
  location: "setting_locations",
  being: "setting_beings",
  community: "setting_communities",
  artifact: "artifacts",
};

/**
 * Что дозаливается в уже существующую сущность, если у той поле пусто.
 *
 * Только простые текстовые колонки: статьи (главы локации, история личности)
 * лежат отдельными строками, и «пусто ли там» — вопрос куда менее очевидный,
 * чем пустая строка. Имя, категория и оригинал сюда не входят намеренно: имя
 * не бывает пустым, категорию человек правит на экране сверки, а оригинал и
 * синонимы дозаливает склейка.
 */
const FILLABLE_TABLES: Record<string, string> = ALIAS_TABLES;
const FILLABLE_COLUMNS: Record<string, string[]> = {
  location: ["kind", "short_name", "description"],
  being: ["short_name", "description", "statblock_short", "statblock_full"],
  community: ["description", "history", "current_situation", "features", "goals"],
  artifact: ["short_name", "owner", "power", "history", "notes", "item_type", "rarity"],
};

/** Ключ → значения из файла, которыми можно дозалить пустое. */
function fillable(data: ImportFile): [string, Record<string, string>][] {
  const out: [string, Record<string, string>][] = [];
  const add = (key: string, values: Record<string, string | undefined>) =>
    out.push([
      key,
      Object.fromEntries(Object.entries(values).map(([k, v]) => [k, v ?? ""])),
    ]);
  for (const l of data.locations)
    add(l.key, { kind: l.kind, short_name: l.short_name, description: l.description });
  for (const b of data.beings)
    add(b.key, {
      short_name: b.short_name,
      description: b.description,
      statblock_short: b.statblock_short,
      statblock_full: b.statblock_full,
    });
  for (const b of data.bestiary)
    add(b.key, {
      description: b.description,
      statblock_short: b.statblock_short,
      statblock_full: b.statblock_full,
    });
  for (const c of data.communities)
    add(c.key, {
      description: c.description,
      history: c.history,
      current_situation: c.current_situation,
      features: c.features,
      goals: c.goals,
    });
  for (const t of data.treasury)
    add(t.key, {
      short_name: t.short_name,
      owner: t.owner,
      power: t.power,
      history: t.history,
      notes: t.notes,
      item_type: t.item_type,
      rarity: t.rarity,
    });
  return out;
}

const mentionRe = () => /\[\[([^\]|]+)\|([^\]]*)\]\]/g;

/**
 * Вехи и тайны попадают в карту ключей — иначе повторный залив того же файла
 * создал бы их заново, — но своей страницы в приложении у них нет: ни меншена,
 * ни generic_link на них не собрать.
 */
const UNLINKABLE_TYPES = ["milestone", "secret"];
const linkable = (ref: Ref | undefined | null): ref is Ref =>
  !!ref && !!ref.type && !UNLINKABLE_TYPES.includes(ref.type);

export function applyImport(data: ImportFile, opts: ApplyOptions): ApplyResult {
  const warnings: Problem[] = [];
  const keys = new Map<string, Ref>();
  // Отцепленный ключ ведёт себя так, будто его в прошлых батчах не было вовсе:
  // сущность создастся заново, ссылки этого файла пойдут на неё. В key_map
  // батча она запишется поверх прежней — следующая книга с тем же ключом
  // увидит на экране сверки уже её и решит про себя сама.
  const detached = new Set(opts.detach ?? []);
  for (const [key, value] of Object.entries({ ...opts.knownKeys, ...opts.reuse })) {
    if (detached.has(key)) continue;
    const [type, id] = value.split(":");
    if (type && id) keys.set(key, { type, id: Number(id) });
  }
  const skipped = new Set(opts.skip ?? []);
  const categories = opts.categories ?? {};
  // Создаём только то, что не снято галочкой и чего ещё нет: ключ, уже
  // известный по прошлому батчу или отданный существующей сущности на экране
  // сверки, второй раз в базу не приезжает.
  const shouldCreate = (key: string) => !skipped.has(key) && !keys.has(key);
  // Дочерние строки и привязки дописываются только к тому, что создали мы:
  // чужую, уже существующую сущность импорт молча не переписывает.
  const created = new Set<string>();

  // Текстовые поля, в которых встретились меншены: подменим их вторым проходом,
  // когда карта ключей будет полной.
  const pending: { table: string; column: string; id: number; raw: string }[] = [];
  const records: { type: string; id: number; payload?: string }[] = [];
  const counts: Record<string, number> = {};
  const bump = (what: string, by = 1) => {
    counts[what] = (counts[what] ?? 0) + by;
  };

  const remember = (table: string, column: string, id: number, raw: string) => {
    if (raw && raw.includes("[[")) pending.push({ table, column, id, raw });
  };
  const record = (type: string, id: number, payload?: string) => {
    records.push({ type, id, payload });
    return id;
  };

  const resolve = (key: string | null | undefined, expect?: string): Ref | null => {
    if (!key) return null;
    const ref = keys.get(key);
    if (!ref) return null;
    if (expect && ref.type !== expect) return null;
    return ref;
  };

  const run = db.transaction((): ApplyResult => {
    // --- сеттинг -----------------------------------------------------------
    let settingId = opts.settingId;
    let settingCreated = false;
    if (settingId == null) {
      const folder = settingFolder(data.setting.name);
      const info = db
        .prepare("INSERT INTO settings (name, description, folder_path) VALUES (?, ?, ?)")
        .run(data.setting.name, data.setting.description ?? "", folder);
      settingId = Number(info.lastInsertRowid);
      settingCreated = true;
      record("setting", settingId);
      bump("сеттинг");
    }
    const setting = db
      .prepare("SELECT folder_path FROM settings WHERE id = ?")
      .get(settingId) as { folder_path: string } | undefined;
    if (!setting) throw new Error(`сеттинг ${settingId} не найден`);
    const settingFolderPath = setting.folder_path;

    // --- локации -----------------------------------------------------------
    // Родитель вставляется раньше ребёнка: и parent_id, и папка на диске
    // вложены. Локации, чей родитель недостижим (ссылка в никуда или цикл),
    // ложатся в корень географии.
    const geographyRoot = data.locations.length ? settingGeographyRoot(settingFolderPath) : "";
    const remaining = data.locations.filter((l) => shouldCreate(l.key));
    const folderOf = new Map<string, string>();
    let progress = true;
    while (remaining.length && progress) {
      progress = false;
      for (let i = 0; i < remaining.length; ) {
        const loc = remaining[i];
        const parentRef = loc.parent ? keys.get(loc.parent) : null;
        const parentPending =
          loc.parent && !parentRef && remaining.some((l) => l.key === loc.parent);
        if (parentPending) {
          i++;
          continue;
        }
        const parentFolder = (loc.parent && folderOf.get(loc.parent)) || geographyRoot;
        const folder = locationFolder(parentFolder, loc.name);
        const info = db
          .prepare(
            `INSERT INTO setting_locations
               (setting_id, parent_id, name, name_original, aliases, short_name, kind, description,
                folder_path)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            settingId,
            parentRef?.type === "location" ? parentRef.id : null,
            loc.name,
            loc.name_original ?? "",
            JSON.stringify(loc.aliases),
            loc.short_name ?? null,
            loc.kind,
            loc.description,
            folder
          );
        const id = record("location", Number(info.lastInsertRowid));
        keys.set(loc.key, { type: "location", id });
        created.add(loc.key);
        folderOf.set(loc.key, folder);
        remember("setting_locations", "description", id, loc.description);
        for (const ch of loc.chapters) {
          const chId = Number(
            db
              .prepare(
                "INSERT INTO location_chapters (location_id, title, content) VALUES (?, ?, ?)"
              )
              .run(id, ch.title, ch.content).lastInsertRowid
          );
          remember("location_chapters", "content", chId, ch.content);
        }
        bump("локации");
        remaining.splice(i, 1);
        progress = true;
      }
    }
    for (const loc of remaining) {
      warnings.push({
        path: `locations`,
        message: `«${loc.name}»: цикл в иерархии родителей — локация создана в корне`,
      });
      const folder = locationFolder(geographyRoot, loc.name);
      const info = db
        .prepare(
          `INSERT INTO setting_locations
             (setting_id, name, name_original, aliases, short_name, kind, description, folder_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settingId,
          loc.name,
          loc.name_original ?? "",
          JSON.stringify(loc.aliases),
          loc.short_name ?? null,
          loc.kind,
          loc.description,
          folder
        );
      const id = record("location", Number(info.lastInsertRowid));
      keys.set(loc.key, { type: "location", id });
      created.add(loc.key);
      bump("локации");
    }

    // --- сообщества --------------------------------------------------------
    // Два прохода: сначала строки, потом parent_id — иерархия может ссылаться
    // вперёд, а вложенных папок у сообществ нет, так что порядок не важен.
    for (const com of data.communities) {
      if (!shouldCreate(com.key)) continue;
      const folder = communityFolder(settingFolderPath, com.name);
      const info = db
        .prepare(
          `INSERT INTO setting_communities
             (setting_id, name, name_original, aliases, description, history, current_situation,
              features, goals, folder_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settingId,
          com.name,
          com.name_original ?? "",
          JSON.stringify(com.aliases),
          com.description,
          com.history,
          com.current_situation,
          com.features,
          com.goals,
          folder
        );
      const id = record("community", Number(info.lastInsertRowid));
      keys.set(com.key, { type: "community", id });
      created.add(com.key);
      for (const [column, value] of [
        ["description", com.description],
        ["history", com.history],
        ["current_situation", com.current_situation],
        ["features", com.features],
        ["goals", com.goals],
      ] as const) {
        remember("setting_communities", column, id, value);
      }
      bump("сообщества");
    }
    for (const com of data.communities) {
      const self = keys.get(com.key);
      if (!self || !created.has(com.key)) continue;
      const parent = resolve(com.parent, "community");
      if (parent && parent.id !== self.id) {
        db.prepare("UPDATE setting_communities SET parent_id = ? WHERE id = ?").run(
          parent.id,
          self.id
        );
      }
      for (const locKey of com.locations) {
        const loc = resolve(locKey, "location");
        if (loc) {
          db.prepare(
            "INSERT OR IGNORE INTO community_locations (community_id, location_id) VALUES (?, ?)"
          ).run(self.id, loc.id);
        }
      }
    }

    // --- личности и бестиарий ----------------------------------------------

    // Разобранный на поля статблок — отдельной строкой: по ней приложение
    // рисует карточку. Владелец полиморфный: та же строка нужна и существу
    // сеттинга, и записи компендиума. Текстовые statblock_short/full остаются
    // как были: они всё ещё показываются и служат запасным вариантом, когда
    // модель структуру не осилила.
    const insertStatblock = (
      ownerType: "being" | "compendium_entry",
      ownerId: number,
      name: string,
      statblock: ImportStatblock
    ) => {
      const { format, ...content } = statblock;
      content.challengeRating = cleanChallengeRating(content.challengeRating);
      // Навыки и спасброски клиент кладёт в «примечания к защите» с пометкой
      // «(старые данные)» — она про legacy-формат и на свежем импорте врёт.
      // Заполняем примечания сами: увидев эти строки уже внутри, клиент свою
      // пометку не добавит.
      const defenseNotes = [
        content.skills && `Навыки: ${content.skills}`,
        content.savingThrows && `Спасброски: ${content.savingThrows}`,
      ]
        .filter(Boolean)
        .join("\n");
      const id = Number(
        db
          .prepare(
            `INSERT INTO statblocks (owner_type, owner_id, kind, format, content)
             VALUES (?, ?, 'full', ?, ?)`
          )
          .run(ownerType, ownerId, format, JSON.stringify({ name, ...content, defenseNotes }))
          .lastInsertRowid
      );
      return record("statblock", id);
    };

    const insertBeing = (
      key: string,
      name: string,
      category: string,
      fields: {
        short_name?: string | null;
        name_original?: string;
        aliases?: string[];
        description: string;
        statblock_short: string;
        statblock_full: string;
        statblock?: ImportStatblock;
      }
    ) => {
      const folder = beingFolder(settingFolderPath, name);
      const info = db
        .prepare(
          `INSERT INTO setting_beings
             (setting_id, name, name_original, aliases, category, short_name, description,
              statblock_short, statblock_full, history, behavior, folder_path, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, '[]')`
        )
        .run(
          settingId,
          name,
          fields.name_original ?? "",
          JSON.stringify(fields.aliases ?? []),
          category,
          fields.short_name ?? null,
          fields.description,
          fields.statblock_short,
          fields.statblock_full,
          folder
        );
      const id = record("being", Number(info.lastInsertRowid));
      keys.set(key, { type: "being", id });
      created.add(key);
      remember("setting_beings", "description", id, fields.description);

      // Разобранный на поля статблок — отдельной строкой: по ней приложение
      // рисует карточку. Текстовые statblock_short/full остаются как были:
      // они всё ещё показываются и служат запасным вариантом, когда модель
      // структуру не осилила.
      if (fields.statblock) {
        insertStatblock("being", id, name, fields.statblock);
        bump("статблоки");
      }
      return id;
    };

    for (const being of data.beings) {
      if (!shouldCreate(being.key)) continue;
      // Категория — то, что модель угадывает хуже всего; человек мог поправить
      // её на экране сверки, и его выбор важнее.
      const id = insertBeing(
        being.key,
        being.name,
        categories[being.key] ?? being.category,
        being
      );
      for (const [section, list] of [
        ["history", being.history],
        ["behavior", being.behavior],
      ] as const) {
        for (const ch of list) {
          const chId = Number(
            db
              .prepare(
                "INSERT INTO being_chapters (being_id, section, title, content) VALUES (?, ?, ?, ?)"
              )
              .run(id, section, ch.title, ch.content).lastInsertRowid
          );
          remember("being_chapters", "content", chId, ch.content);
        }
      }
      bump("личности");
    }
    for (const beast of data.bestiary) {
      if (!shouldCreate(beast.key)) continue;
      insertBeing(beast.key, beast.name, "bestiary", {
        name_original: beast.name_original,
        aliases: beast.aliases,
        description: beast.description,
        statblock_short: beast.statblock_short,
        statblock_full: beast.statblock_full,
        statblock: beast.statblock,
      });
      bump("бестиарий");
    }
    // Привязки — после того, как созданы и локации, и сообщества.
    for (const being of data.beings) {
      const self = keys.get(being.key);
      if (!self || !created.has(being.key)) continue;
      let first: number | null = null;
      for (const locKey of being.locations) {
        const loc = resolve(locKey, "location");
        if (!loc) continue;
        first ??= loc.id;
        db.prepare(
          "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
        ).run(self.id, loc.id);
      }
      // location_id — досоздаточное поле «основное место»; клиент читает
      // being_locations, но карточки и старые запросы смотрят сюда.
      if (first) db.prepare("UPDATE setting_beings SET location_id = ? WHERE id = ?").run(first, self.id);
      for (const comKey of being.communities) {
        const com = resolve(comKey, "community");
        if (com) {
          db.prepare(
            "INSERT OR IGNORE INTO being_communities (being_id, community_id) VALUES (?, ?)"
          ).run(self.id, com.id);
        }
      }
      for (const date of being.important_dates) {
        if (date.day < 1 || (date.month != null && date.month < 1)) continue;
        const id = Number(
          db
            .prepare(
              `INSERT INTO important_dates (owner_type, owner_id, title, recurrence, year, month, day)
               VALUES ('being', ?, ?, ?, ?, ?, ?)`
            )
            .run(
              self.id,
              date.title,
              date.recurrence,
              date.year ?? null,
              date.month ?? null,
              date.day
            ).lastInsertRowid
        );
        record("important_date", id);
        bump("даты");
      }
    }
    for (const beast of data.bestiary) {
      const self = keys.get(beast.key);
      if (!self || !created.has(beast.key)) continue;
      let first: number | null = null;
      for (const locKey of beast.locations) {
        const loc = resolve(locKey, "location");
        if (!loc) continue;
        first ??= loc.id;
        db.prepare(
          "INSERT OR IGNORE INTO being_locations (being_id, location_id) VALUES (?, ?)"
        ).run(self.id, loc.id);
      }
      if (first) db.prepare("UPDATE setting_beings SET location_id = ? WHERE id = ?").run(first, self.id);
    }

    // --- сокровищница ------------------------------------------------------
    for (const item of data.treasury) {
      if (!shouldCreate(item.key)) continue;
      const folder = artifactFolder(settingFolderPath, item.name);
      const info = db
        .prepare(
          `INSERT INTO artifacts
             (setting_id, name, name_original, aliases, short_name, owner, power, history, notes,
              item_type, rarity, requires_attunement, folder_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settingId,
          item.name,
          item.name_original ?? "",
          JSON.stringify(item.aliases),
          item.short_name ?? null,
          item.owner,
          item.power,
          item.history,
          item.notes,
          item.item_type,
          item.rarity,
          item.requires_attunement ? 1 : 0,
          folder
        );
      const id = record("artifact", Number(info.lastInsertRowid));
      keys.set(item.key, { type: "artifact", id });
      created.add(item.key);
      for (const [column, value] of [
        ["owner", item.owner],
        ["power", item.power],
        ["history", item.history],
        ["notes", item.notes],
      ] as const) {
        remember("artifacts", column, id, value);
      }
      for (const ch of item.chapters) {
        const chId = Number(
          db
            .prepare("INSERT INTO artifact_chapters (artifact_id, title, content) VALUES (?, ?, ?)")
            .run(id, ch.title, ch.content).lastInsertRowid
        );
        remember("artifact_chapters", "content", chId, ch.content);
      }
      bump("предметы");
    }

    // --- компендиум --------------------------------------------------------
    // Связь ставится и на созданную запись, и на уже существовавшую: человек
    // выбрал монстра или предмет руками на экране сверки. У обеих таблиц связи
    // составной ключ без колонки id, поэтому в import_records кладётся ещё и
    // вторая половина — иначе откату нечего было бы удалять.
    //
    // Существо и предмет ведут себя одинаково, различаясь тремя вещами: своей
    // таблицей связи, разделом системы и тем, что кладётся в data записи.
    const linkStatements: Record<string, ReturnType<typeof db.prepare<[number, number]>>> = {
      being: db.prepare(
        "INSERT OR IGNORE INTO being_compendium_links (being_id, compendium_entry_id) VALUES (?, ?)"
      ),
      artifact: db.prepare(
        "INSERT OR IGNORE INTO artifact_compendium_links (artifact_id, compendium_entry_id) VALUES (?, ?)"
      ),
    };
    const link = (self: Ref, entryId: number) => {
      const statement = linkStatements[self.type];
      if (!statement || !statement.run(self.id, entryId).changes) return false;
      record("compendium_link", self.id, JSON.stringify({ entry: entryId, type: self.type }));
      return true;
    };

    // Монстра или предмет, которого в системе ещё нет, импорт может завести сам.
    // Это запись не приключения, а системы: компендиум общий для всех кампаний
    // на ней, поэтому создаётся только по явной галочке и в выбранной системе.
    const newInCompendium = new Set(opts.compendiumNew ?? []);
    if (newInCompendium.size) {
      const system = importSystems(settingId).find((s) => s.id === opts.compendiumSystem);
      if (!system) {
        warnings.push({
          path: "compendium",
          message: "Система для новых записей компендиума не выбрана — записи не заведены",
        });
      } else {
        const nextPosition = db.prepare(
          "SELECT COALESCE(MAX(position), -1) + 1 AS p FROM compendium_entries WHERE section_id = ?"
        );
        const insertEntry = db.prepare(
          `INSERT INTO compendium_entries
             (system_id, section_id, parent_id, kind, name, data, description, position)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`
        );
        const create = (
          kind: CompendiumKind,
          sectionId: number | null,
          key: string,
          title: string,
          nameOriginal: string,
          description: string,
          entryData: Record<string, unknown>
        ) => {
          const self = keys.get(key);
          if (!self) return null;
          if (!sectionId) {
            warnings.push({
              path: `compendium.${key}`,
              message: `В системе «${system.name}» нет подходящего раздела — запись не заведена`,
            });
            return null;
          }
          // Оригинал в скобках — конвенция компендиума: «Нимблрайт
          // [Nimblewright]». По ней же ищет matchCompendium, так что следующая
          // книга с тем же монстром найдёт эту запись и не заведёт вторую.
          const name = nameOriginal ? `${title} [${nameOriginal}]` : title;
          const entryId = Number(
            insertEntry.run(
              system.id,
              sectionId,
              kind,
              name,
              JSON.stringify(entryData),
              description,
              (nextPosition.get(sectionId) as { p: number }).p
            ).lastInsertRowid
          );
          record("compendium_entry", entryId);
          // Связь ставится сразу: заводили запись именно ради неё.
          link(self, entryId);
          bump("заведено в компендиуме");
          return entryId;
        };

        for (const beast of data.bestiary) {
          if (!newInCompendium.has(beast.key)) continue;
          // Имя берётся из compendium_hints, а не из name: книга зовёт группу
          // в этом приключении — «Контрабандисты», — а в справочник системы
          // идёт название вида, в единственном числе. Промпт просит написать
          // в подсказку ровно его: «как этот монстр называется в системе».
          const title = beast.compendium_hints.find((h) => h.trim())?.trim() || beast.name;
          const { size, type } = parseSizeType(beast.statblock?.sizeTypeAlignment ?? "");
          const entryData: Record<string, unknown> = {};
          if (size) entryData.size = size;
          const cr = cleanChallengeRating(beast.statblock?.challengeRating ?? "");
          if (cr) entryData.cr = cr;
          const creatureType = creatureTypeRef(system.id, type);
          if (creatureType) entryData.creature_type = creatureType;
          const entryId = create(
            "monster",
            system.monster_section_id,
            beast.key,
            title,
            beast.name_original ?? "",
            beast.description,
            entryData
          );
          if (entryId && beast.statblock) {
            insertStatblock("compendium_entry", entryId, title, beast.statblock);
          } else if (entryId) {
            // Запись без статблока — оболочка: имя и описание есть, карточки,
            // размера и опасности нет, фильтры раздела её не видят. Молчать об
            // этом нельзя: книга, разобранная старым промптом, так засевает
            // справочник системы пустыми строками.
            warnings.push({
              path: `bestiary.${beast.key}`,
              message: `«${title}» заведён в компендиуме без статблока — в файле его нет`,
            });
          }
        }

        for (const item of data.treasury) {
          if (!newInCompendium.has(item.key)) continue;
          // Тип и редкость книга пишет своими словами — «кольцо, необычное», —
          // а раздел фильтрует по значениям своих списков. Что не перевелось,
          // не пишем вовсе: пустое поле человек дозаполнит, а мусорное значение
          // выпадет из всех фильтров молча.
          const entryData: Record<string, unknown> = { attunement: item.requires_attunement };
          const type = itemType(item.item_type);
          if (type) entryData.item_type = type;
          const rarity = itemRarity(item.rarity);
          if (rarity) entryData.rarity = rarity;
          // Правила предмета живут в описании записи: у маг. предмета своего
          // статблока нет, его сила — это текст.
          const description = [item.power, item.notes].filter((t) => t.trim()).join("\n\n");
          create(
            "magic_item",
            system.magic_item_section_id,
            item.key,
            item.name,
            item.name_original ?? "",
            description,
            entryData
          );
        }
      }
    }

    for (const [key, ids] of Object.entries(opts.compendium ?? {})) {
      const self = keys.get(key);
      if (!self || !linkStatements[self.type]) continue;
      const kind: CompendiumKind = self.type === "artifact" ? "magic_item" : "monster";
      for (const entryId of validCompendiumIds(settingId, ids, kind)) {
        if (link(self, entryId)) bump("привязки к компендиуму");
      }
    }

    // --- приключения -------------------------------------------------------
    const source = [data.source.title, data.source.authors, data.source.pages, data.source.part]
      .filter(Boolean)
      .join(", ");
    const lastArcPosition = db
      .prepare(
        "SELECT COALESCE(MAX(position), -1) as p FROM story_arcs WHERE setting_id = ? AND parent_id IS NULL"
      )
      .get(settingId) as { p: number };
    let arcPosition = lastArcPosition.p + 1;

    for (const adv of data.adventures) {
      if (skipped.has(adv.key)) continue;
      // Приключение может быть отдано существующему — тогда главы и сцены
      // дозаливаются в него, а сама дуга не создаётся заново.
      let advId: number;
      const reused = keys.get(adv.key);
      if (reused && reused.type === "adventure") {
        advId = reused.id;
      } else {
        const info = db
          .prepare(
            `INSERT INTO story_arcs
               (setting_id, name, kind, description, hook, recommended_level, player_count, duration,
                source, tags, position)
             VALUES (?, ?, 'adventure', ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            settingId,
            adv.name,
            adv.description,
            adv.hook,
            adv.recommended_level,
            adv.player_count,
            adv.duration,
            source,
            adv.tags,
            arcPosition++
          );
        advId = record("adventure", Number(info.lastInsertRowid));
        keys.set(adv.key, { type: "adventure", id: advId });
        created.add(adv.key);
        remember("story_arcs", "description", advId, adv.description);
        remember("story_arcs", "hook", advId, adv.hook);
        bump("приключения");
      }

      // Дозалив в существующее приключение продолжает его нумерацию, а не
      // начинает с нуля поверх уже лежащих там глав.
      const lastChapter = db
        .prepare("SELECT COALESCE(MAX(position), -1) as p FROM story_arcs WHERE parent_id = ?")
        .get(advId) as { p: number };
      let chapterPosition = lastChapter.p + 1;

      adv.chapters.forEach((chapter) => {
        if (!shouldCreate(chapter.key)) return;
        const index = chapterPosition++;
        const chInfo = db
          .prepare(
            `INSERT INTO story_arcs (setting_id, parent_id, name, kind, description, position)
             VALUES (?, ?, ?, 'chapter', ?, ?)`
          )
          .run(settingId, advId, chapter.name, chapter.description, index);
        const chId = record("adventure", Number(chInfo.lastInsertRowid));
        keys.set(chapter.key, { type: "adventure", id: chId });
        created.add(chapter.key);
        remember("story_arcs", "description", chId, chapter.description);
        bump("главы");
      });

      // Сцены нумеруются подряд внутри своей главы, а бесхозные — внутри
      // приключения: в профиле приключения это и есть порядок показа.
      const positions = new Map<number, number>();
      const nextPosition = (arcId: number) => {
        if (!positions.has(arcId)) {
          const last = db
            .prepare("SELECT COALESCE(MAX(position), -1) as p FROM story_scenes WHERE arc_id = ?")
            .get(arcId) as { p: number };
          positions.set(arcId, last.p + 1);
        }
        return positions.get(arcId)!;
      };
      adv.scenes.forEach((scene) => {
        if (!shouldCreate(scene.key)) return;
        const chapter = resolve(scene.chapter, "adventure");
        const arcId = chapter && chapter.id !== advId ? chapter.id : advId;
        const position = nextPosition(arcId);
        positions.set(arcId, position + 1);
        const sInfo = db
          .prepare(
            `INSERT INTO story_scenes
               (setting_id, arc_id, name, kind, summary, read_aloud, whats_happening,
                entry_condition, outcomes, position)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            settingId,
            arcId,
            scene.name,
            scene.kind,
            scene.summary,
            scene.read_aloud,
            scene.whats_happening,
            scene.entry_condition,
            scene.outcomes,
            position
          );
        const sceneId = record("scene", Number(sInfo.lastInsertRowid));
        keys.set(scene.key, { type: "scene", id: sceneId });
        created.add(scene.key);
        for (const [column, value] of [
          ["summary", scene.summary],
          ["read_aloud", scene.read_aloud],
          ["whats_happening", scene.whats_happening],
          ["entry_condition", scene.entry_condition],
          ["outcomes", scene.outcomes],
        ] as const) {
          remember("story_scenes", column, sceneId, value);
        }
        scene.checks.forEach((check, index) => {
          const cId = Number(
            db
              .prepare(
                `INSERT INTO story_scene_checks (scene_id, what, difficulty, on_success, on_failure, position)
                 VALUES (?, ?, ?, ?, ?, ?)`
              )
              .run(sceneId, check.what, check.difficulty, check.on_success, check.on_failure, index)
              .lastInsertRowid
          );
          remember("story_scene_checks", "what", cId, check.what);
          remember("story_scene_checks", "on_success", cId, check.on_success);
          remember("story_scene_checks", "on_failure", cId, check.on_failure);
          bump("проверки");
        });
        bump("сцены");
      });
    }

    // --- всё, что ссылается на сцены: только когда созданы все сцены --------
    for (const adv of data.adventures) {
      const advRef = keys.get(adv.key);
      if (!advRef || skipped.has(adv.key)) continue;
      for (const scene of adv.scenes) {
        const self = keys.get(scene.key);
        if (!self || !created.has(scene.key)) continue;
        // generic_links полиморфны и каскадом за удалённой сценой не уходят —
        // поэтому каждая строка попадает в import_records поимённо.
        const link = (key: string, section: string) => {
          const ref = keys.get(key);
          if (!linkable(ref)) return;
          const info = db
            .prepare(
              `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
               VALUES ('scene', ?, ?, ?, ?)`
            )
            .run(self.id, ref.type, ref.id, section);
          if (info.changes) {
            record("link", Number(info.lastInsertRowid));
            bump("связи");
          }
        };
        scene.locations.forEach((k) => link(k, "scene_location"));
        scene.participants.forEach((k) => link(k, "scene_participants"));
        scene.items.forEach((k) => link(k, "scene_items"));

        scene.next.forEach((next, index) => {
          const to = resolve(next.to, "scene");
          if (!to) return;
          db.prepare(
            `INSERT OR IGNORE INTO story_scene_transitions (from_scene_id, to_scene_id, label, position)
             VALUES (?, ?, ?, ?)`
          ).run(self.id, to.id, next.label, index);
          bump("переходы");
        });

        scene.rewards.forEach((reward, index) => {
          const artifact = resolve(reward.item, "artifact");
          const rId = Number(
            db
              .prepare(
                `INSERT INTO story_scene_rewards (scene_id, what, where_found, notes, artifact_id, position)
                 VALUES (?, ?, ?, ?, ?, ?)`
              )
              .run(self.id, reward.what, reward.where_found, reward.notes, artifact?.id ?? null, index)
              .lastInsertRowid
          );
          remember("story_scene_rewards", "what", rId, reward.what);
          remember("story_scene_rewards", "where_found", rId, reward.where_found);
          remember("story_scene_rewards", "notes", rId, reward.notes);
          bump("награды");
        });
      }

      adv.milestones.forEach((milestone, index) => {
        if (!shouldCreate(milestone.key)) return;
        const scene = resolve(milestone.scene, "scene");
        const id = Number(
          db
            .prepare(
              `INSERT INTO story_milestones (arc_id, scene_id, title, description, position)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(advRef.id, scene?.id ?? null, milestone.title, milestone.description, index)
            .lastInsertRowid
        );
        record("milestone", id);
        keys.set(milestone.key, { type: "milestone", id });
        remember("story_milestones", "description", id, milestone.description);
        bump("вехи");
      });

      adv.secrets.forEach((secret, index) => {
        if (!shouldCreate(secret.key)) return;
        const id = Number(
          db
            .prepare(
              "INSERT INTO story_secrets (arc_id, kind, title, content, position) VALUES (?, ?, ?, ?, ?)"
            )
            .run(advRef.id, secret.kind, secret.title, secret.content, index).lastInsertRowid
        );
        record("secret", id);
        keys.set(secret.key, { type: "secret", id });
        remember("story_secrets", "content", id, secret.content);
        bump("тайны");
      });

      adv.rewards.forEach((reward, index) => {
        // У вех и тайн есть ключи, и повтор отсекается по ним. У награды
        // приключения ключа нет, так что от второго залива того же файла её
        // спасает только сравнение по содержимому — как у событий календаря.
        const duplicate = db
          .prepare(
            `SELECT 1 FROM story_scene_rewards
              WHERE arc_id = ? AND what = ? AND where_found = ?`
          )
          .get(advRef.id, reward.what, reward.where_found);
        if (duplicate) return;
        const artifact = resolve(reward.item, "artifact");
        const id = Number(
          db
            .prepare(
              `INSERT INTO story_scene_rewards (arc_id, what, where_found, notes, artifact_id, position)
               VALUES (?, ?, ?, ?, ?, ?)`
            )
            .run(advRef.id, reward.what, reward.where_found, reward.notes, artifact?.id ?? null, index)
            .lastInsertRowid
        );
        record("reward", id);
        remember("story_scene_rewards", "what", id, reward.what);
        remember("story_scene_rewards", "where_found", id, reward.where_found);
        remember("story_scene_rewards", "notes", id, reward.notes);
        bump("награды");
      });
    }

    // --- календарь ---------------------------------------------------------
    // У событий и отношений нет ключей, так что от повторного залива того же
    // файла их спасает только сравнение по содержимому.
    for (const event of data.calendar_events) {
      if (event.month < 1 || event.day < 1) continue;
      const duplicate = db
        .prepare(
          `SELECT 1 FROM setting_calendar_events
           WHERE setting_id = ? AND title = ? AND inworld_year = ? AND inworld_month = ? AND inworld_day = ?`
        )
        .get(settingId, event.title, event.year, event.month, event.day);
      if (duplicate) continue;
      const info = db
        .prepare(
          `INSERT INTO setting_calendar_events
             (setting_id, title, description, inworld_year, inworld_month, inworld_day, important)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settingId,
          event.title,
          event.description,
          event.year,
          event.month,
          event.day,
          event.important ? 1 : 0
        );
      const id = record("calendar_event", Number(info.lastInsertRowid));
      remember("setting_calendar_events", "description", id, event.description);
      bump("события");
    }

    // --- отношения и прочие связи ------------------------------------------
    for (const relation of data.relations) {
      const from = keys.get(relation.from);
      const to = keys.get(relation.to);
      if (!from || !to) continue;
      if (!["being", "community"].includes(from.type) || !["being", "community"].includes(to.type))
        continue;
      const duplicate = db
        .prepare(
          `SELECT 1 FROM entity_relations
           WHERE from_type = ? AND from_id = ? AND to_type = ? AND to_id = ? AND label = ?`
        )
        .get(from.type, from.id, to.type, to.id, relation.label);
      if (duplicate) continue;
      const info = db
        .prepare(
          `INSERT INTO entity_relations (from_type, from_id, to_type, to_id, tone, label, description)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .run(from.type, from.id, to.type, to.id, relation.tone, relation.label, relation.description);
      const id = record("relation", Number(info.lastInsertRowid));
      remember("entity_relations", "description", id, relation.description);
      bump("отношения");
    }
    for (const genericLink of data.links) {
      const from = keys.get(genericLink.from);
      const to = keys.get(genericLink.to);
      if (!linkable(from) || !linkable(to)) continue;
      const info = db
        .prepare(
          `INSERT OR IGNORE INTO generic_links (from_type, from_id, to_type, to_id, section)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(from.type, from.id, to.type, to.id, genericLink.section || null);
      if (info.changes) {
        record("link", Number(info.lastInsertRowid));
        bump("связи");
      }
    }

    // --- дозалив недостающего ----------------------------------------------
    // Уже существующую сущность импорт не переписывает: там мог быть выверенный
    // руками текст, и книга не вправе его перебивать. Но пустое поле не «чужое»
    // — перебивать в нём нечего. Без этого прохода улучшения формата обходили
    // бы стороной всё, что уже лежит в базе: перелив книгу через промпт со
    // статблоками, человек получал бы карточки только у новых записей, а у
    // старых — по-прежнему одну прозу.
    //
    // Касается это и ключей, известных по прошлым батчам, и склеенных руками на
    // экране сверки: и там, и там сущность создали не мы.
    for (const [key, values] of fillable(data)) {
      const ref = keys.get(key);
      if (!ref || created.has(key) || skipped.has(key)) continue;
      const table = FILLABLE_TABLES[ref.type];
      if (!table) continue;
      const columns = Object.keys(values).filter((c) => FILLABLE_COLUMNS[ref.type]?.includes(c));
      if (!columns.length) continue;
      const row = db
        .prepare(`SELECT ${columns.join(", ")} FROM ${table} WHERE id = ?`)
        .get(ref.id) as Record<string, string | null> | undefined;
      if (!row) continue;
      for (const column of columns) {
        const value = values[column];
        if (!value.trim() || (row[column] ?? "").trim()) continue;
        // В payload — прежнее значение: откат вернёт именно его, а не пустоту
        // наугад. Столбец и таблица оттуда же сверяются со списком.
        record("field", ref.id, JSON.stringify({ table, column, value: row[column] ?? "" }));
        db.prepare(`UPDATE ${table} SET ${column} = ? WHERE id = ?`).run(value, ref.id);
        remember(table, column, ref.id, value);
        bump("дозалито полей");
      }
    }
    // Карточка статблока: у существа её либо нет вовсе, либо она своя. Пустой
    // карточки не бывает, поэтому «недостающее» здесь — отсутствие строки.
    const hasStatblock = db.prepare(
      "SELECT 1 FROM statblocks WHERE owner_type = 'being' AND owner_id = ?"
    );
    for (const source of [...data.beings, ...data.bestiary]) {
      if (!source.statblock) continue;
      const ref = keys.get(source.key);
      if (!ref || ref.type !== "being" || created.has(source.key) || skipped.has(source.key))
        continue;
      if (hasStatblock.get(ref.id)) continue;
      insertStatblock("being", ref.id, source.name, source.statblock);
      bump("дозалито статблоков");
    }

    // --- меншены -----------------------------------------------------------
    // Ключ, у которого нет своей страницы (вехи, тайны) или которого нет в
    // карте, остаётся в тексте как есть: пользователь увидит его и решит сам.
    let substituted = 0;
    for (const field of pending) {
      let changed = false;
      const next = field.raw.replace(mentionRe(), (whole, key: string, label: string) => {
        const ref = keys.get(key);
        if (!linkable(ref)) return whole;
        changed = true;
        substituted++;
        return `[[${ref.type}:${ref.id}|${label}]]`;
      });
      if (changed) {
        db.prepare(`UPDATE ${field.table} SET ${field.column} = ? WHERE id = ?`).run(next, field.id);
      }
    }
    if (substituted) bump("упоминания", substituted);

    // --- склейка учит синонимам --------------------------------------------
    // Человек сказал «это существующий Приморский район» — значит «Морской
    // округ» из книги отныне его второе имя. Следующая книга с этим переводом
    // совпадёт уже сама, без ручного выбора.
    const synonyms = new Map<string, string[]>();
    // Оригинал держим отдельно: он не просто ещё одно имя, а самый надёжный
    // ключ сверки между переводами, и у него своя колонка.
    const originals = new Map<string, string>();
    const collect = (key: string, name: string, original: string | undefined, list: string[]) => {
      synonyms.set(key, [name, original ?? "", ...list].filter(Boolean));
      if (original?.trim()) originals.set(key, original.trim());
    };
    data.locations.forEach((l) => collect(l.key, l.name, l.name_original, l.aliases));
    data.beings.forEach((b) => collect(b.key, b.name, b.name_original, b.aliases));
    data.bestiary.forEach((b) => collect(b.key, b.name, b.name_original, b.aliases));
    data.communities.forEach((c) => collect(c.key, c.name, c.name_original, c.aliases));
    data.treasury.forEach((t) => collect(t.key, t.name, t.name_original, t.aliases));

    for (const key of Object.keys(opts.reuse ?? {})) {
      const ref = keys.get(key);
      const table = ref ? ALIAS_TABLES[ref.type] : null;
      if (!ref || !table) continue;
      const row = db
        .prepare(`SELECT name, aliases, name_original FROM ${table} WHERE id = ?`)
        .get(ref.id) as { name: string; aliases: string; name_original: string } | undefined;
      if (!row) continue;
      let current: string[] = [];
      try {
        current = JSON.parse(row.aliases) as string[];
      } catch {
        // Битое поле не повод ронять импорт: перезапишем массивом с нуля.
      }
      // Оригинал дописывается только в пустое поле: своё, уже заполненное,
      // книга перебивать не вправе — там мог быть выверенный вручную вариант.
      const original = originals.get(key) ?? "";
      const learnOriginal = !row.name_original.trim() && !!original;

      // Тот вариант имени, что уже живёт в колонке оригинала, в синонимы не
      // идёт: сверке он оттуда и так виден, а карточка «Другие названия»
      // пестрила бы вторым экземпляром одного и того же «North Ward».
      const inOriginalColumn = learnOriginal ? original : row.name_original;
      const seen = new Set(
        [row.name, ...current, inOriginalColumn].filter(Boolean).map(normalizeName)
      );
      const added: string[] = [];
      for (const candidate of synonyms.get(key) ?? []) {
        if (seen.has(normalizeName(candidate))) continue;
        seen.add(normalizeName(candidate));
        added.push(candidate);
      }
      if (!added.length && !learnOriginal) continue;

      record(
        "alias",
        ref.id,
        JSON.stringify({ table, aliases: row.aliases, name_original: row.name_original })
      );
      db.prepare(`UPDATE ${table} SET aliases = ?, name_original = ? WHERE id = ?`).run(
        JSON.stringify([...current, ...added]),
        learnOriginal ? original : row.name_original,
        ref.id
      );
      if (added.length) bump("синонимы", added.length);
      if (learnOriginal) bump("оригиналы", 1);
    }

    // --- батч --------------------------------------------------------------
    const keyMap: Record<string, string> = {};
    for (const [key, ref] of keys) keyMap[key] = `${ref.type}:${ref.id}`;

    const batchInfo = db
      .prepare(
        `INSERT INTO import_batches
           (setting_id, format, language, setting_key, source_title, source_part, file_name,
            counts_json, key_map_json, warnings_json, created_setting)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        settingId,
        data.format,
        data.language,
        data.setting.key,
        data.source.title,
        data.source.part,
        opts.fileName,
        JSON.stringify(counts),
        JSON.stringify(keyMap),
        JSON.stringify(warnings),
        settingCreated ? 1 : 0
      );
    const batchId = Number(batchInfo.lastInsertRowid);
    const insertRecord = db.prepare(
      "INSERT INTO import_records (batch_id, entity_type, entity_id, payload) VALUES (?, ?, ?, ?)"
    );
    for (const r of records) insertRecord.run(batchId, r.type, r.id, r.payload ?? "");

    return { batchId, settingId, settingCreated, counts, warnings, keys: keyMap };
  });

  return run();
}

/**
 * Откат батча: удаляет ровно те строки, которые он создал. Дочерние строки
 * (статьи, проверки, награды, привязки к локациям) уходят каскадом по внешним
 * ключам; полиморфные generic_links, entity_relations и important_dates
 * каскада не имеют, поэтому записаны в import_records поимённо.
 *
 * Папки в хранилище остаются: файлы, которые пользователь мог в них положить
 * после импорта, дороже пустых каталогов.
 */
export function rollbackBatch(batchId: number): { deleted: number } {
  const run = db.transaction(() => {
    const rows = db
      .prepare(
        "SELECT entity_type, entity_id, payload FROM import_records WHERE batch_id = ? ORDER BY id DESC"
      )
      .all(batchId) as { entity_type: string; entity_id: number; payload: string }[];
    let deleted = 0;
    // Сначала связи, потом сущности: связь на удалённую строку каскадом не
    // уходит, а вот сущность утащит за собой свои дочерние строки.
    const order = (type: string) =>
      [
        "link",
        "relation",
        "important_date",
        "milestone",
        "secret",
        "reward",
        "compendium_link",
        "statblock",
        "field",
      ].includes(type)
        ? 0
        : type === "setting"
          ? 2
          : 1;
    for (const row of [...rows].sort((a, b) => order(a.entity_type) - order(b.entity_type))) {
      // Синоним, дописанный склейкой в чужую сущность: её саму удалять нельзя,
      // нужно вернуть прежнее значение поля.
      if (row.entity_type === "alias") {
        try {
          const before = JSON.parse(row.payload) as {
            table: string;
            aliases: string;
            name_original?: string;
          };
          // Имя таблицы идёт в SQL, поэтому берём его не из payload как есть,
          // а сверяем со списком известных.
          if (Object.values(ALIAS_TABLES).includes(before.table)) {
            db.prepare(
              `UPDATE ${before.table} SET aliases = ?, name_original = ? WHERE id = ?`
            ).run(before.aliases, before.name_original ?? "", row.entity_id);
          }
        } catch {
          // Без payload вернуть нечего — лишний синоним безвреден.
        }
        continue;
      }
      // Поле, дозалитое в чужую сущность: саму её удалять нельзя, надо вернуть
      // прежнее значение — оно в payload, а не «пустота наугад».
      if (row.entity_type === "field") {
        try {
          const before = JSON.parse(row.payload) as {
            table: string;
            column: string;
            value: string;
          };
          // Таблица и столбец идут в SQL, поэтому сверяются со списком, а не
          // подставляются из payload как есть.
          const type = Object.keys(FILLABLE_TABLES).find(
            (t) => FILLABLE_TABLES[t] === before.table
          );
          if (type && FILLABLE_COLUMNS[type]?.includes(before.column)) {
            db.prepare(
              `UPDATE ${before.table} SET ${before.column} = ? WHERE id = ?`
            ).run(before.value, row.entity_id);
          }
        } catch {
          // Без payload вернуть нечего — дозалитый текст безвреден.
        }
        continue;
      }
      // Привязка к компендиуму: составной ключ, удалять надо по обеим
      // половинам — вторая лежит в payload. Тип там же: у существ и предметов
      // свои таблицы связи. Батчи до появления предметов типа не писали —
      // для них подразумевается существо.
      if (row.entity_type === "compendium_link") {
        try {
          const { entry, type } = JSON.parse(row.payload) as { entry: number; type?: string };
          const [table, column] =
            type === "artifact"
              ? ["artifact_compendium_links", "artifact_id"]
              : ["being_compendium_links", "being_id"];
          deleted += db
            .prepare(`DELETE FROM ${table} WHERE ${column} = ? AND compendium_entry_id = ?`)
            .run(row.entity_id, entry).changes;
        } catch {
          // Без payload удалять нечего: лишняя связь безвредна, а снести все
          // связи существа значило бы задеть проставленные руками.
        }
        continue;
      }
      const table = ROLLBACK_TABLES[row.entity_type];
      if (!table) continue;
      deleted += db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.entity_id).changes;
    }
    deleted += sweepDangling();
    db.prepare("DELETE FROM import_batches WHERE id = ?").run(batchId);
    return { deleted };
  });
  return run();
}

/**
 * Уборка связей, оставшихся без одного из концов.
 *
 * Откатить можно не только последний батч. Если следующие импорты ссылались на
 * сущности откатываемого — а в цикле ваншотов так и есть, — то после удаления
 * их связи повисают в пустоте: у полиморфных generic_links и entity_relations
 * внешних ключей нет, каскад до них не достаёт. Связь без одного конца не
 * значит ничего и никому не нужна, поэтому подметается вся, а не только своя.
 */
function sweepDangling(): number {
  let removed = 0;
  const gone = (type: string, id: number) => {
    const table = ROLLBACK_TABLES[type];
    // Незнакомый тип не трогаем: мало ли что появится в связях помимо импорта.
    if (!table) return false;
    return !db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(id);
  };
  for (const table of ["generic_links", "entity_relations"]) {
    const rows = db
      .prepare(`SELECT id, from_type, from_id, to_type, to_id FROM ${table}`)
      .all() as { id: number; from_type: string; from_id: number; to_type: string; to_id: number }[];
    const drop = db.prepare(`DELETE FROM ${table} WHERE id = ?`);
    for (const row of rows) {
      if (!gone(row.from_type, row.from_id) && !gone(row.to_type, row.to_id)) continue;
      removed += drop.run(row.id).changes;
    }
  }
  return removed;
}

/** Тип сущности → где взять её имя для справочника ключей. */
const KEY_NAMES: Record<string, { table: string; column: string }> = {
  location: { table: "setting_locations", column: "name" },
  being: { table: "setting_beings", column: "name" },
  community: { table: "setting_communities", column: "name" },
  artifact: { table: "artifacts", column: "name" },
  adventure: { table: "story_arcs", column: "name" },
  scene: { table: "story_scenes", column: "name" },
  milestone: { table: "story_milestones", column: "title" },
  secret: { table: "story_secrets", column: "title" },
};

/**
 * Подпись берётся из префикса ключа, а не из типа в базе: в базе и глава, и
 * приключение — story_arcs, а именной персонаж и вид существ — setting_beings.
 * Модели же список читать по её собственному словарю префиксов.
 */
const KEY_LABELS: Record<string, string> = {
  "loc.": "локация",
  "npc.": "персонаж",
  "bst.": "вид существ",
  "com.": "сообщество",
  "item.": "предмет",
  "adv.": "приключение",
  "chp.": "глава",
  "scn.": "сцена",
  "mls.": "веха",
  "sec.": "тайна",
};

/**
 * Как зовут сущность, на которую ведёт ссылка вида «тип:id».
 *
 * Нужно экрану сверки: без имени пометка «уже импортировано» ничего не говорит
 * человеку, а именно там и прячется столкновение ключей — «Волшебная палочка
 * секретов» из новой книги, ведущая на «Жезл секретов» из прошлой.
 */
export function entityName(ref: string | null | undefined): string | null {
  if (!ref) return null;
  const [type, id] = ref.split(":");
  const meta = KEY_NAMES[type];
  if (!meta || !id) return null;
  const row = db
    .prepare(`SELECT ${meta.column} AS name FROM ${meta.table} WHERE id = ?`)
    .get(Number(id)) as { name: string } | undefined;
  return row?.name ?? null;
}

/**
 * Справочник ключей сеттинга: ключ, имя и тип — то, что вкладывается в промпт
 * следующей части книги.
 *
 * Промпт просит выводить ключи детерминированно из имён, но между двумя
 * разговорами с моделью это держится на честном слове: «Синий переулок» легко
 * станет то loc.blue_alley, то loc.siniy_pereulok, и вторая часть уедет мимо
 * первой. Со списком на руках модель не гадает.
 */
export function keyDirectoryFor(settingId: number): { key: string; type: string; name: string; label: string }[] {
  const out: { key: string; type: string; name: string; label: string }[] = [];
  for (const [key, value] of Object.entries(knownKeysFor(settingId))) {
    const [type, id] = value.split(":");
    const meta = KEY_NAMES[type];
    if (!meta) continue;
    const row = db
      .prepare(`SELECT ${meta.column} AS name FROM ${meta.table} WHERE id = ?`)
      .get(Number(id)) as { name: string } | undefined;
    if (!row) continue;
    const prefix = Object.keys(KEY_LABELS).find((p) => key.startsWith(p));
    out.push({ key, type, name: row.name, label: prefix ? KEY_LABELS[prefix] : type });
  }
  return out.sort((a, b) => a.key.localeCompare(b.key));
}

/** Ключи всех прошлых батчей сеттинга — чтобы второй файл книги видел первый. */
export function knownKeysFor(settingId: number): Record<string, string> {
  const rows = db
    .prepare("SELECT key_map_json FROM import_batches WHERE setting_id = ? ORDER BY id")
    .all(settingId) as { key_map_json: string }[];
  const keys: Record<string, string> = {};
  for (const row of rows) {
    try {
      Object.assign(keys, JSON.parse(row.key_map_json) as Record<string, string>);
    } catch {
      // Битый батч не должен ломать импорт следующего файла.
    }
  }
  // Строка могла быть удалена вручную уже после импорта — проверяем, что она
  // ещё жива, иначе ссылка второго файла уедет в никуда молча.
  for (const [key, value] of Object.entries(keys)) {
    const [type, id] = value.split(":");
    const table = ROLLBACK_TABLES[type];
    if (!type || !table) {
      delete keys[key];
      continue;
    }
    const alive = db.prepare(`SELECT 1 FROM ${table} WHERE id = ?`).get(Number(id));
    if (!alive) delete keys[key];
  }
  return keys;
}
