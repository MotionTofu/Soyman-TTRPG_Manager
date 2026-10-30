// База, пропустившая версии, должна открываться и доходить до схемы свежей.
//
// Повод — 2026-09-11: база ЛЮБОГО релиза с 30 июля по 22 августа не
// запускала приложение. Причина одна на все случаи: новый шаг миграции
// вставляли в середину db.ts, выше шагов, от которых он зависит. Базе в
// непрерывной работе это не мешает — она получает шаги по одному, в порядке
// написания, — а база человека, обновившегося после перерыва, идёт по порядку
// строк и падает «no such column» прямо на старте. Своя база владельца этого
// не показывает никогда, поэтому держит только тест.
//
// Фикстуры — schema.sql двух релизов, дословно из git: таблицы ровно такие,
// какими их создавал тот релиз. 30 июля — первый релиз (падал на чтении
// name_original в сентябрьских шагах), 22 августа — эпоха индексов по
// archived_at в schema.sql (падал на CREATE INDEX до ALTER TABLE).

import { describe, it, expect, beforeAll } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { openDatabase } from "./db";

// Таблица → её колонки и индексы (индексы с префиксом «#», чтобы жить в том же
// списке). Не хватает колонки — экран падает «no such column»; не хватает
// индекса — перестройка таблицы унесла его и не вернула.
type Columns = Record<string, string[]>;

function columnsOf(db: Database.Database): Columns {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as { name: string }[];
  const out: Columns = {};
  for (const { name } of tables) {
    const cols = (db.prepare(`PRAGMA table_info("${name}")`).all() as { name: string }[]).map((c) => c.name);
    const idx = (db.prepare(`PRAGMA index_list("${name}")`).all() as { name: string }[])
      .map((i) => i.name)
      .filter((n) => !n.startsWith("sqlite_autoindex"))
      .map((n) => `#${n}`);
    out[name] = [...cols, ...idx].sort();
  }
  return out;
}

function databaseFromOldSchema(fixture: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-db-"));
  const old = new Database(path.join(dir, "app.db"));
  old.exec(fs.readFileSync(path.join(__dirname, "__fixtures__", fixture), "utf-8"));
  old.close();
  return dir;
}

let fresh: Columns;

beforeAll(() => {
  const db = openDatabase(fs.mkdtempSync(path.join(os.tmpdir(), "soyman-fresh-db-")));
  fresh = columnsOf(db);
  db.close();
}, 60_000);

describe("база старого релиза открывается текущим кодом", () => {
  for (const [label, fixture] of [
    ["релиз 2026-07-30", "schema-2026-07-30.sql"],
    ["релиз 2026-08-22", "schema-2026-08-22.sql"],
  ] as const) {
    it(`${label}: миграции проходят, и ни одной таблицы или колонки свежей базы не недостаёт`, () => {
      const db = openDatabase(databaseFromOldSchema(fixture));
      const migrated = columnsOf(db);
      db.close();

      const missing: string[] = [];
      for (const [table, cols] of Object.entries(fresh)) {
        if (!migrated[table]) {
          missing.push(`таблица ${table}`);
          continue;
        }
        for (const c of cols) if (!migrated[table].includes(c)) missing.push(`${table}.${c}`);
      }
      expect(missing).toEqual([]);
    }, 60_000);
  }
});

describe("точечные шаги для старых баз", () => {
  it("«Участие в кампании» существа становится ссылкой «задействована», один раз и без правки старых строк", () => {
    // Старая база: участия в кампании живут только на главе «Текущая
    // ситуация» существа с campaign_id; таблиц participations и
    // entity_records ещё нет.
    const dir = databaseFromOldSchema("schema-2026-08-22.sql");
    const old = new Database(path.join(dir, "app.db"));
    const settingId = Number(old.prepare("INSERT INTO settings (name) VALUES ('Город каналов')").run().lastInsertRowid);
    const campaignId = Number(old.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Мёртвый канал', ?)").run(settingId).lastInsertRowid);
    const being = (name: string) =>
      Number(old.prepare("INSERT INTO setting_beings (setting_id, name) VALUES (?, ?)").run(settingId, name).lastInsertRowid);
    const mia = being("Мия Тарн");
    const oris = being("Орис");
    const chapter = old.prepare("INSERT INTO being_chapters (being_id, section, title, campaign_id) VALUES (?, ?, ?, ?)");
    chapter.run(mia, "current_situation", "Ищет брата", campaignId);
    chapter.run(mia, "current_situation", "Вторая глава той же кампании", campaignId);
    // Без кампании и не «Текущая ситуация» — ссылки не дают.
    chapter.run(oris, "current_situation", "Вне кампаний", null);
    chapter.run(oris, "history", "Давно", campaignId);
    const snapshot = (db: Database.Database) => ({
      chapters: db.prepare("SELECT id, being_id, section, title, content, campaign_id, important, created_at FROM being_chapters ORDER BY id").all(),
      beings: db.prepare("SELECT id, setting_id, name FROM setting_beings ORDER BY id").all(),
      campaigns: db.prepare("SELECT id, name, setting_id FROM campaigns ORDER BY id").all(),
    });
    const before = snapshot(old);
    old.close();

    const links = (db: Database.Database) =>
      db.prepare("SELECT context_type, context_id, entity_type, entity_id, manual FROM participations ORDER BY id").all();
    let db = openDatabase(dir);
    expect(links(db)).toEqual([{ context_type: "campaign", context_id: campaignId, entity_type: "being", entity_id: mia, manual: 1 }]);
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("SELECT COUNT(*) AS n FROM entity_records").get()).toEqual({ n: 0 });

    // Мастер снял ссылку — повторный запуск её не возвращает и ничего не дублирует.
    db.prepare("DELETE FROM participations").run();
    db.close();
    db = openDatabase(dir);
    expect(links(db)).toEqual([]);
    db.close();
  }, 60_000);

  it("функция записи (тетрадь кампании v4) добавляется к старым записям, не меняя их", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-records-"));
    const initial = openDatabase(dir);
    // База слоя кампании до колонки function.
    initial.exec("ALTER TABLE entity_records DROP COLUMN function");
    const campaignId = Number(initial.prepare("INSERT INTO campaigns (name) VALUES ('Мёртвый канал')").run().lastInsertRowid);
    const add = initial.prepare("INSERT INTO entity_records (campaign_id, owner_type, owner_id, aspect, text, status, certainty, basis) VALUES (?, 'campaign', ?, ?, ?, ?, ?, ?)");
    add.run(campaignId, campaignId, "note", "Канал закрыт", "established", "rumor", "Орис");
    add.run(campaignId, campaignId, "unsorted", "Черновик", "draft", "known", "");
    const rows = (db: Database.Database) => db.prepare("SELECT id, campaign_id, owner_type, owner_id, aspect, text, status, certainty, known_to, basis, created_at, updated_at FROM entity_records ORDER BY id").all();
    const before = rows(initial);
    initial.close();

    const migrated = openDatabase(dir);
    expect(rows(migrated)).toEqual(before);
    expect(migrated.prepare("SELECT DISTINCT function FROM entity_records").all()).toEqual([{ function: "" }]);
    expect(() => migrated.prepare("UPDATE entity_records SET function = 'now'").run()).toThrow();
    migrated.close();
  }, 60_000);

  it("старые привязки карт сохраняются, а сцены становятся допустимой целью", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-map-bindings-"));
    const initial = openDatabase(dir);
    const mapId = Number(initial.prepare("INSERT INTO maps (name, grid, scale) VALUES ('Старая карта', 'square', 'locality')")
      .run().lastInsertRowid);
    initial.exec("DROP TABLE map_bindings");
    initial.exec(`CREATE TABLE map_bindings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      map_id INTEGER NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
      target_type TEXT NOT NULL CHECK (target_type IN ('setting','campaign','location')),
      target_id INTEGER NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(map_id, target_type, target_id)
    )`);
    initial.prepare("INSERT INTO map_bindings (id, map_id, target_type, target_id) VALUES (7, ?, 'setting', 12)").run(mapId);
    initial.close();

    const migrated = openDatabase(dir);
    expect(migrated.prepare("SELECT id, map_id, target_type, target_id FROM map_bindings WHERE id = 7").get())
      .toEqual({ id: 7, map_id: mapId, target_type: "setting", target_id: 12 });
    expect(() => migrated.prepare("INSERT INTO map_bindings (map_id, target_type, target_id) VALUES (?, 'scene', 34)")
      .run(mapId)).not.toThrow();
    const indexes = (migrated.prepare("PRAGMA index_list(map_bindings)").all() as { name: string }[]).map((row) => row.name);
    expect(indexes).toContain("idx_map_bindings_map");
    expect(indexes).toContain("idx_map_bindings_target");
    migrated.close();
  }, 60_000);

  it("canvas_routes теряет отменённый to_key, и вставка без него проходит", () => {
    // Так таблицу оставила модель рераута до 2026-08-30: to_key NOT NULL без
    // умолчания. Импорт приключения пишет рераут без to_key и на такой базе
    // падал «NOT NULL constraint failed: canvas_routes.to_key».
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-routes-"));
    const old = new Database(path.join(dir, "app.db"));
    old.exec(`CREATE TABLE canvas_routes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id INTEGER NOT NULL REFERENCES canvas_boards(id) ON DELETE CASCADE,
      from_key TEXT NOT NULL,
      to_key TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'transition',
      role TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )`);
    old.close();

    const db = openDatabase(dir);
    const cols = (db.prepare("PRAGMA table_info(canvas_routes)").all() as { name: string }[]).map((c) => c.name);
    expect(cols).not.toContain("to_key");
    const board = Number(db.prepare("INSERT INTO canvas_boards (scope_type, scope_id) VALUES ('arc', 1)").run().lastInsertRowid);
    expect(() =>
      db.prepare("INSERT INTO canvas_routes (board_id, from_key, kind, role) VALUES (?, 'being:1', 'cast', 'being')").run(board)
    ).not.toThrow();
    db.close();
  }, 60_000);
});


describe("артефакт в записях старой базы", () => {
  it("сохраняет строки, id, индексы, последовательность и FK; повторное открытие ничего не меняет", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-artifact-records-"));
    const initial = openDatabase(dir);
    const sql = (initial.prepare("SELECT sql FROM sqlite_master WHERE name = 'entity_records'").get() as { sql: string }).sql;
    initial.exec("DROP TABLE entity_records");
    // Точная схема слоя кампании до artifact, со всеми накопленными полями.
    initial.exec(sql.replace("'artifact',", ""));
    initial.exec("CREATE INDEX idx_entity_records_owner ON entity_records(campaign_id, owner_type, owner_id)");
    initial.exec("CREATE INDEX idx_entity_records_session ON entity_records(session_id)");
    initial.exec("CREATE INDEX idx_entity_records_replaces ON entity_records(replaces_id)");
    initial.exec("CREATE INDEX idx_records_test_status ON entity_records(status)");
    const campaign = Number(initial.prepare("INSERT INTO campaigns (name) VALUES ('Старая кампания')").run().lastInsertRowid);
    const session = Number(initial.prepare("INSERT INTO sessions (campaign_id, date) VALUES (?, '2026-10-01')").run(campaign).lastInsertRowid);
    initial.prepare(`INSERT INTO entity_records
      (id, campaign_id, owner_type, owner_id, aspect, text, status, certainty, known_to, known_note, basis, session_id, function, created_at, updated_at)
      VALUES (15, ?, 'campaign', ?, 'note', 'Было', 'assumption', 'rumor', 'some', 'Лиара', 'Письмо', ?, 'anchor', '2026-10-01', '2026-10-02')`)
      .run(campaign, campaign, session);
    initial.prepare(`INSERT INTO entity_records (id, campaign_id, owner_type, owner_id, text, replaces_id)
      VALUES (25, ?, 'campaign', ?, 'Стало', 15)`).run(campaign, campaign);
    initial.prepare("INSERT INTO entity_records (id, owner_type, owner_id, text) VALUES (90, 'campaign', ?, 'Удалено')").run(campaign);
    initial.prepare("DELETE FROM entity_records WHERE id = 90").run();
    const rows = (d: Database.Database) => d.prepare("SELECT * FROM entity_records ORDER BY id").all();
    const objects = (d: Database.Database) => d.prepare("SELECT type, name, sql FROM sqlite_master WHERE tbl_name = 'entity_records' ORDER BY type, name").all();
    const before = rows(initial);
    const foreignKeys = initial.prepare("PRAGMA foreign_key_list(entity_records)").all();
    const beforeIndexes = (initial.prepare("PRAGMA index_list(entity_records)").all() as { name: string }[]).map((i) => i.name).sort();
    initial.close();

    let migrated = openDatabase(dir);
    expect(rows(migrated)).toEqual(before);
    expect(migrated.prepare("PRAGMA foreign_key_list(entity_records)").all()).toEqual(foreignKeys);
    expect(migrated.pragma("foreign_keys", { simple: true })).toBe(1);
    expect(migrated.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect((migrated.prepare("PRAGMA index_list(entity_records)").all() as { name: string }[]).map((i) => i.name).sort()).toEqual(beforeIndexes);
    const afterObjects = objects(migrated);
    expect(migrated.prepare("SELECT seq FROM sqlite_sequence WHERE name = 'entity_records'").get()).toEqual({ seq: 90 });
    migrated.close();

    migrated = openDatabase(dir);
    expect(rows(migrated)).toEqual(before);
    expect(objects(migrated)).toEqual(afterObjects);
    const id = Number(migrated.prepare("INSERT INTO entity_records (owner_type, owner_id, text) VALUES ('artifact', 1, 'Камень')").run().lastInsertRowid);
    expect(id).toBeGreaterThan(90);
    expect(() => migrated.prepare("INSERT INTO entity_records (owner_type, owner_id, text) VALUES ('invented', 1, 'x')").run()).toThrow();
    migrated.prepare("DELETE FROM entity_records WHERE id = 15").run();
    expect(migrated.prepare("SELECT replaces_id FROM entity_records WHERE id = 25").get()).toEqual({ replaces_id: null });
    migrated.prepare("DELETE FROM campaigns WHERE id = ?").run(campaign);
    expect(migrated.prepare("SELECT 1 FROM entity_records WHERE id = 25").get()).toBeUndefined();
    migrated.close();
  }, 60_000);
});

describe("миграция хроники кампании", () => {
  it("старые события и точки целы, новые поля имеют безопасные умолчания, повтор не меняет строки", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-chronicle-"));
    let database = openDatabase(dir);
    database.exec("ALTER TABLE campaign_calendar_events DROP COLUMN visible_to_players");
    database.exec("ALTER TABLE campaign_calendar_events DROP COLUMN player_text");
    database.exec("ALTER TABLE setting_cycle_points DROP COLUMN color");
    const setting = Number(database.prepare("INSERT INTO settings (name) VALUES ('Старый мир')").run().lastInsertRowid);
    const campaign = Number(database.prepare("INSERT INTO campaigns (name, setting_id) VALUES ('Старая хроника', ?)").run(setting).lastInsertRowid);
    database.prepare("INSERT INTO campaign_calendar_events (campaign_id, title, description, full_description, consequences, inworld_year, inworld_month, inworld_day) VALUES (?, 'Старое событие', 'Кратко', 'Подробно', 'Последствия', 1496, 6, 7)").run(campaign);
    const cycle = Number(database.prepare("INSERT INTO setting_cycles (setting_id, name, period_days, anchor_year, anchor_month, anchor_day) VALUES (?, 'Луна', 28, 1496, 1, 1)").run(setting).lastInsertRowid);
    database.prepare("INSERT INTO setting_cycle_points (cycle_id, name, day_offset, day_end) VALUES (?, 'Полная', 14, 16)").run(cycle);
    const beforeEvent = database.prepare("SELECT id, title, description, full_description, consequences, inworld_year, inworld_month, inworld_day FROM campaign_calendar_events").all();
    const beforePoint = database.prepare("SELECT id, name, day_offset, day_end, position FROM setting_cycle_points").all();
    database.close();
    database = openDatabase(dir);
    expect(database.prepare("SELECT id, title, description, full_description, consequences, inworld_year, inworld_month, inworld_day FROM campaign_calendar_events").all()).toEqual(beforeEvent);
    expect(database.prepare("SELECT id, name, day_offset, day_end, position FROM setting_cycle_points").all()).toEqual(beforePoint);
    expect(database.prepare("SELECT visible_to_players, player_text FROM campaign_calendar_events").get()).toEqual({ visible_to_players: 0, player_text: "" });
    expect(database.prepare("SELECT color FROM setting_cycle_points").get()).toEqual({ color: null });
    const rows = database.prepare("SELECT * FROM campaign_calendar_events").all();
    const snapshots = fs.readdirSync(dir).filter((file) => file.startsWith("app-before-campaign-chronicle-"));
    database.close();
    database = openDatabase(dir);
    expect(database.prepare("SELECT * FROM campaign_calendar_events").all()).toEqual(rows);
    expect(fs.readdirSync(dir).filter((file) => file.startsWith("app-before-campaign-chronicle-"))).toEqual(snapshots);
    database.close();
  }, 60_000);
  it("старые эпохи и линии времени переживают добавление слоя кампании и повторный запуск", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-old-chronicle-layer-"));
    let database = openDatabase(dir);
    const settingId = Number(database.prepare("INSERT INTO settings (name) VALUES ('Мир эпох')").run().lastInsertRowid);
    const lineId = Number(database.prepare("INSERT INTO setting_calendar_timelines (setting_id, name) VALUES (?, 'Старая линия')").run(settingId).lastInsertRowid);
    database.prepare("INSERT INTO setting_calendar_eras (setting_id, name, start_year, timeline_id) VALUES (?, 'Старая эпоха', 1400, ?)").run(settingId, lineId);
    database.exec("ALTER TABLE setting_calendar_eras DROP COLUMN campaign_id");
    database.exec("ALTER TABLE setting_calendar_timelines DROP COLUMN campaign_id");
    database.close();
    for (let pass = 0; pass < 2; pass++) {
      database = openDatabase(dir);
      expect(database.prepare("SELECT name, start_year, timeline_id, campaign_id FROM setting_calendar_eras").get()).toEqual({ name: "Старая эпоха", start_year: 1400, timeline_id: lineId, campaign_id: null });
      expect(database.prepare("SELECT name, campaign_id FROM setting_calendar_timelines").get()).toEqual({ name: "Старая линия", campaign_id: null });
      expect(database.pragma("foreign_key_check")).toEqual([]);
      database.close();
    }
  }, 60_000);

});
