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
import { ImportFile } from "./format";
import { Problem } from "./validate";

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
};

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
  for (const [key, value] of Object.entries({ ...opts.knownKeys, ...opts.reuse })) {
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
  const records: { type: string; id: number }[] = [];
  const counts: Record<string, number> = {};
  const bump = (what: string, by = 1) => {
    counts[what] = (counts[what] ?? 0) + by;
  };

  const remember = (table: string, column: string, id: number, raw: string) => {
    if (raw && raw.includes("[[")) pending.push({ table, column, id, raw });
  };
  const record = (type: string, id: number) => {
    records.push({ type, id });
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
               (setting_id, parent_id, name, short_name, kind, description, folder_path)
             VALUES (?, ?, ?, ?, ?, ?, ?)`
          )
          .run(
            settingId,
            parentRef?.type === "location" ? parentRef.id : null,
            loc.name,
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
          `INSERT INTO setting_locations (setting_id, name, short_name, kind, description, folder_path)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(settingId, loc.name, loc.short_name ?? null, loc.kind, loc.description, folder);
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
             (setting_id, name, description, history, current_situation, features, goals, folder_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settingId,
          com.name,
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
    const insertBeing = (
      key: string,
      name: string,
      category: string,
      fields: {
        short_name?: string | null;
        description: string;
        statblock_short: string;
        statblock_full: string;
      }
    ) => {
      const folder = beingFolder(settingFolderPath, name);
      const info = db
        .prepare(
          `INSERT INTO setting_beings
             (setting_id, name, category, short_name, description, statblock_short, statblock_full,
              history, behavior, folder_path, tags)
           VALUES (?, ?, ?, ?, ?, ?, ?, '', '', ?, '[]')`
        )
        .run(
          settingId,
          name,
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
        description: beast.description,
        statblock_short: beast.statblock_short,
        statblock_full: beast.statblock_full,
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
             (setting_id, name, short_name, owner, power, history, notes, item_type, rarity,
              requires_attunement, folder_path)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          settingId,
          item.name,
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
      "INSERT INTO import_records (batch_id, entity_type, entity_id) VALUES (?, ?, ?)"
    );
    for (const r of records) insertRecord.run(batchId, r.type, r.id);

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
      .prepare("SELECT entity_type, entity_id FROM import_records WHERE batch_id = ? ORDER BY id DESC")
      .all(batchId) as { entity_type: string; entity_id: number }[];
    let deleted = 0;
    // Сначала связи, потом сущности: связь на удалённую строку каскадом не
    // уходит, а вот сущность утащит за собой свои дочерние строки.
    const order = (type: string) =>
      ["link", "relation", "important_date", "milestone", "secret", "reward"].includes(type)
        ? 0
        : type === "setting"
          ? 2
          : 1;
    for (const row of [...rows].sort((a, b) => order(a.entity_type) - order(b.entity_type))) {
      const table = ROLLBACK_TABLES[row.entity_type];
      if (!table) continue;
      deleted += db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(row.entity_id).changes;
    }
    db.prepare("DELETE FROM import_batches WHERE id = ?").run(batchId);
    return { deleted };
  });
  return run();
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
