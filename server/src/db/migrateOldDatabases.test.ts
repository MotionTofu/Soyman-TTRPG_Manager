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
