import type { Database } from "better-sqlite3";

/**
 * Пересвязка ссылок листа персонажа на справочник по именам.
 *
 * Тот же дефект, что уже дважды чинился в этой базе: **id записи справочника
 * не переживает переустановку модуля**, а лист хранит именно id. Сначала так
 * терялись владения навыками, потом — все 288 обретаемых заклинаний, теперь
 * нашлось третье и самое дорогое: у шести листов из шести **все 23 ссылки**
 * на класс, подкласс, вид и предысторию вели в пустоту.
 *
 * Видно этого не было, потому что рядом с каждой ссылкой лежит имя, и лист
 * рисовал шапку из него. Не работало же всё, что считается по записи:
 * таблица развития класса (ячейки заклинаний, число заговоров и
 * подготовленных), обретаемые заклинания, выдачи вида и предыстории.
 *
 * Ключ сведения — `name_original` (английское имя в скобках: «Колдун
 * [Warlock]» → `Warlock`), запасной — русская часть до скобки. Тот же ключ,
 * что у навыков и заклинаний: он не переводится и не переименовывается.
 * Спорное — имя, сведённое больше чем к одной записи, — не трогается вовсе.
 *
 * Заодно чинится `systemId` самого листа: у всех шести листов он указывал на
 * систему, которой в базе нет, и поиск заклинаний вместе со списком
 * доступных классу искал в пустоте. Новый берётся у записи, к которой лист
 * только что пересвязан, — то есть у его же класса или вида; догадок по
 * названию системы здесь не делается.
 */

const MIGRATION_KEY = "dnd_sheet_refs_relinked";

/** «Колдун [Warlock]» → русское имя и оригинал по отдельности. */
function splitName(raw: string): { name: string; original: string } {
  const m = /^(.*?)\s*\[(.+?)\]/.exec(raw ?? "");
  return m ? { name: m[1].trim(), original: m[2].trim() } : { name: (raw ?? "").trim(), original: "" };
}

interface Index {
  byOriginal: Map<string, number[]>;
  byName: Map<string, number[]>;
}

function buildIndex(database: Database, kinds: string | string[], topLevelOnly = false): Index {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const rows = database
    .prepare(
      `SELECT e.id, e.name, e.name_original
         FROM compendium_entries e
         JOIN system_sections s ON s.id = e.section_id
        WHERE s.kind IN (${list.map(() => "?").join(", ")})${topLevelOnly ? " AND e.parent_id IS NULL" : ""}`
    )
    .all(...list) as { id: number; name: string; name_original: string | null }[];
  const byOriginal = new Map<string, number[]>();
  const byName = new Map<string, number[]>();
  const push = (map: Map<string, number[]>, key: string, id: number) => {
    if (!key) return;
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const r of rows) {
    push(byOriginal, (r.name_original ?? "").trim().toLowerCase(), r.id);
    push(byName, r.name.trim().toLowerCase(), r.id);
  }
  return { byOriginal, byName };
}

/** Однозначное совпадение или ничего: догадка здесь стоит дороже пропуска. */
function resolve(index: Index, raw: string): number | null {
  const { name, original } = splitName(raw);
  for (const [map, key] of [
    [index.byOriginal, original.toLowerCase()],
    [index.byName, name.toLowerCase()],
  ] as [Map<string, number[]>, string][]) {
    if (!key) continue;
    const hit = map.get(key);
    if (hit && hit.length === 1) return hit[0];
  }
  return null;
}

export function migrateDndSheetRefs(database: Database): void {
  const done = database.prepare("SELECT value FROM app_settings WHERE key = ?").get(MIGRATION_KEY);
  if (done) return;

  let fixed = 0;
  let unresolved = 0;
  let alive = 0;
  let systemsFixed = 0;

  const run = database.transaction(() => {
    const classes = buildIndex(database, "class", true);
    // Подклассы лежат детьми классов в том же разделе.
    const subclasses = buildIndex(database, "class", false);
    const species = buildIndex(database, "species", false);
    const backgrounds = buildIndex(database, "background");
    // Заклинания, особенности и снаряжение листа хранят те же id и умерли
    // так же: 125 ссылок на заклинания, 69 на особенности, 3 на снаряжение —
    // все до одной. Особенности приходят из разных разделов (черта, механика,
    // умение класса), поэтому индекс общий; правило «однозначно или никак»
    // защищает от того, что одно имя встретится в двух разделах.
    const spells = buildIndex(database, "spell");
    const features = buildIndex(database, ["feat", "mechanics", "class", "species", "background"]);
    const items = buildIndex(database, ["equipment", "magic_item"]);
    const exists = database.prepare("SELECT 1 FROM compendium_entries WHERE id = ?");
    const systemExists = database.prepare("SELECT 1 FROM systems WHERE id = ?");
    const systemOfEntry = database.prepare("SELECT system_id FROM compendium_entries WHERE id = ?");
    const update = database.prepare("UPDATE statblocks SET content = ? WHERE id = ?");

    /** Возвращает новый id, если старый мёртв и имя свелось однозначно. */
    function relink(id: unknown, name: unknown, index: Index): number | null {
      if (typeof id !== "number") return null;
      if (exists.get(id)) {
        alive++;
        return null;
      }
      const found = typeof name === "string" ? resolve(index, name) : null;
      if (found == null) {
        unresolved++;
        return null;
      }
      fixed++;
      return found;
    }

    const rows = database
      .prepare("SELECT id, content FROM statblocks WHERE format = 'dnd_character'")
      .all() as { id: number; content: string }[];

    for (const row of rows) {
      let data: Record<string, unknown>;
      try {
        const parsed = JSON.parse(row.content || "{}");
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        data = parsed as Record<string, unknown>;
      } catch {
        continue;
      }
      let changed = false;

      const race = relink(data.raceId, data.raceName, species);
      if (race != null) {
        data.raceId = race;
        changed = true;
      }
      const background = relink(data.backgroundId, data.backgroundName, backgrounds);
      if (background != null) {
        data.backgroundId = background;
        changed = true;
      }
      if (Array.isArray(data.classes)) {
        for (const raw of data.classes as Record<string, unknown>[]) {
          if (!raw || typeof raw !== "object") continue;
          const cls = relink(raw.classId, raw.className, classes);
          if (cls != null) {
            raw.classId = cls;
            changed = true;
          }
          const sub = relink(raw.subclassId, raw.subclassName, subclasses);
          if (sub != null) {
            raw.subclassId = sub;
            changed = true;
          }
        }
      }

      // Ссылки внутри вкладок листа. Имя лежит рядом с каждой — в том же
      // виде «Русское [English]», что и у класса.
      const relinkRefs = (list: unknown, index: Index) => {
        if (!Array.isArray(list)) return;
        for (const raw of list as Record<string, unknown>[]) {
          if (!raw || typeof raw !== "object") continue;
          const found = relink(raw.entryId, raw.name, index);
          if (found != null) {
            raw.entryId = found;
            changed = true;
          }
        }
      };
      relinkRefs(data.cantrips, spells);
      if (Array.isArray(data.spellsByLevel)) {
        for (const lvl of data.spellsByLevel as unknown[]) relinkRefs(lvl, spells);
      }
      for (const group of ["classFeatures", "speciesFeatures", "feats", "specialAbilities"]) {
        relinkRefs(data[group], features);
      }
      if (Array.isArray(data.equipmentSections)) {
        for (const sec of data.equipmentSections as Record<string, unknown>[]) {
          relinkRefs(sec?.items, items);
        }
      }

      // Система листа — по записи, к которой он привязан. Берём первую
      // живую ссылку: класс, вид и предыстория одного листа не могут жить
      // в разных системах.
      if (typeof data.systemId === "number" && !systemExists.get(data.systemId)) {
        const anchors = [
          data.raceId,
          data.backgroundId,
          ...(Array.isArray(data.classes)
            ? (data.classes as Record<string, unknown>[]).flatMap((c) => [c?.classId, c?.subclassId])
            : []),
        ].filter((id): id is number => typeof id === "number");
        for (const id of anchors) {
          const found = systemOfEntry.get(id) as { system_id: number } | undefined;
          if (found?.system_id) {
            data.systemId = found.system_id;
            systemsFixed++;
            changed = true;
            break;
          }
        }
      }

      if (changed) update.run(JSON.stringify(data), row.id);
    }

    database
      .prepare("INSERT OR REPLACE INTO app_settings (key, value) VALUES (?, datetime('now'))")
      .run(MIGRATION_KEY);
  });

  run();
  if (fixed > 0 || unresolved > 0 || systemsFixed > 0) {
    console.log(
      `[db] Ссылки листов на справочник: пересвязано ${fixed}, живых было ${alive}, не свелось ${unresolved} (имени нет в справочнике либо оно неоднозначно), систем починено ${systemsFixed}`
    );
  }
}
