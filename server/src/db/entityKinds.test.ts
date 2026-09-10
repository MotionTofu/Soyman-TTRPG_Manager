import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  ENTITY_KINDS,
  kindOf,
  requireKind,
  SATELLITE_OWNERS,
  SATELLITE_TABLES,
  ARCHIVE_TABLES,
  ARCHIVE_KEYS,
  sweepableSatellitePairs,
  endpointTableOf,
} from "./entityKinds";

/**
 * Схему проверяем по настоящей мигрированной базе, а не по schema.sql:
 * полторы сотни колонок добавляются `ALTER TABLE` уже внутри openDatabase, и
 * файл схемы про них не знает. Первая версия этого теста разбирала schema.sql
 * регулярками, находила ноль колонок и проходила вхолостую — проверка,
 * которая не умеет падать, хуже отсутствующей.
 */
let tables: Set<string>;
const columns = new Map<string, Set<string>>();

beforeAll(async () => {
  // DB_DIR выставляется ДО импорта db (побочный эффект — открытие базы).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "entity-kinds-"));
  process.env.DB_DIR = tmpDir;
  const { db } = await import("./db");

  tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[])
      .map((r) => r.name)
  );
  for (const t of tables) {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[];
    columns.set(t, new Set(cols.map((c) => c.name)));
  }
}, 120_000);

const colsOf = (t: string) => columns.get(t) ?? new Set<string>();

describe("реестр видов сущностей согласован со схемой", () => {
  it("схема вообще прочиталась", () => {
    expect(tables.size).toBeGreaterThan(50);
    expect(colsOf("setting_beings").has("archived_at")).toBe(true);
  });

  it("ключ вида уникален", () => {
    const kinds = ENTITY_KINDS.map((k) => k.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
  });

  it("каждая таблица из реестра существует", () => {
    // Опечатка `setting_events` вместо `setting_calendar_events` прожила в
    // routes/entityRelations.ts до 2026-09-10 именно потому, что такой
    // проверки не было: имя не резолвилось, а ошибки не возникало.
    const missing = ENTITY_KINDS.filter((k) => !tables.has(k.table)).map((k) => `${k.kind} → ${k.table}`);
    expect(missing).toEqual([]);
  });

  it("таблица подменного конца связи тоже существует", () => {
    const missing = ENTITY_KINDS.filter((k) => k.endpointTable && !tables.has(k.endpointTable)).map(
      (k) => `${k.kind} → ${k.endpointTable}`
    );
    expect(missing).toEqual([]);
  });

  it("колонка имени существует в своей таблице", () => {
    const bad = ENTITY_KINDS.filter((k) => k.nameCol && !colsOf(k.table).has(k.nameCol)).map(
      (k) => `${k.kind}: нет ${k.table}.${k.nameCol}`
    );
    expect(bad).toEqual([]);
  });

  it("hasArchivedAt соответствует схеме", () => {
    const bad = ENTITY_KINDS.filter((k) => colsOf(k.table).has("archived_at") !== k.hasArchivedAt).map(
      (k) => `${k.kind}: в базе archived_at ${colsOf(k.table).has("archived_at") ? "есть" : "нет"}, в реестре ${k.hasArchivedAt}`
    );
    expect(bad).toEqual([]);
  });

  it("архивируемое имеет archived_at", () => {
    expect(ENTITY_KINDS.filter((k) => k.archivable && !k.hasArchivedAt).map((k) => k.kind)).toEqual([]);
  });

  it("каждая колонка archiveKey существует", () => {
    const bad = Object.entries(ARCHIVE_KEYS)
      .filter(([kind, col]) => !colsOf(requireKind(kind).table).has(col))
      .map(([kind, col]) => `${kind}: нет ${requireKind(kind).table}.${col}`);
    expect(bad).toEqual([]);
  });

  it("у конца связи есть колонка id, по которой его ищут", () => {
    const bad = ENTITY_KINDS.filter(
      (k) => (k.linkEndpoint || k.relationEndpoint) && !colsOf(endpointTableOf(k)).has("id")
    ).map((k) => `${k.kind} → ${endpointTableOf(k)}`);
    expect(bad).toEqual([]);
  });

  it("каждая таблица спутника существует и полиморфна", () => {
    for (const sat of SATELLITE_TABLES) {
      expect(tables.has(sat), `нет таблицы ${sat}`).toBe(true);
      expect(colsOf(sat).has("owner_type"), `${sat} без owner_type`).toBe(true);
      expect(colsOf(sat).has("owner_id"), `${sat} без owner_id`).toBe(true);
    }
  });

  it("каждая полиморфная пара *_type/*_id в базе кем-то обслуживается", () => {
    // Не требование, а сигнал: список пар, которые реестр пока не описывает.
    // Уборка знает про спутники, generic_links, entity_relations и полотна;
    // остальные пары живут своей жизнью, и об этом надо знать явно.
    const known = new Set([
      ...SATELLITE_TABLES,
      "generic_links", "entity_relations", "canvas_boards",
    ]);
    const unmanaged: string[] = [];
    for (const [t, cols] of columns) {
      if (known.has(t)) continue;
      for (const c of cols) {
        if (c.endsWith("_type") && cols.has(c.replace(/_type$/, "_id"))) unmanaged.push(`${t}.${c}`);
      }
    }
    // Зафиксировано как есть на 2026-09-10. Рост списка означает новую
    // полиморфную связь без уборки — её нужно либо описать, либо внести сюда
    // осознанно.
    expect(unmanaged.sort()).toMatchSnapshot();
  });
});

describe("производные карты вычисляются, а не пишутся", () => {
  it("владельцы спутника выводятся из фасета owns", () => {
    for (const sat of SATELLITE_TABLES) {
      expect(SATELLITE_OWNERS[sat]).toEqual(
        ENTITY_KINDS.filter((k) => k.owns.includes(sat)).map((k) => k.kind)
      );
    }
  });

  it("уборка спутников покрывает всех владельцев, кроме явно исключённых", () => {
    const swept = new Set(sweepableSatellitePairs().map((p) => `${p.table}:${p.ownerKind}`));
    for (const k of ENTITY_KINDS) {
      for (const sat of k.owns) {
        const key = `${sat}:${k.kind}`;
        if (k.sweepSkip?.satellites) expect(swept.has(key)).toBe(false);
        else expect(swept.has(key), `${key} не подметается`).toBe(true);
      }
    }
  });

  it("исключение из уборки всегда объяснено", () => {
    for (const k of ENTITY_KINDS) {
      for (const reason of Object.values(k.sweepSkip ?? {})) {
        expect(String(reason).length, `${k.kind}: пустая причина`).toBeGreaterThan(10);
      }
    }
  });

  it("ARCHIVE_TABLES — ровно архивируемые виды", () => {
    expect(Object.keys(ARCHIVE_TABLES).sort()).toEqual(
      ENTITY_KINDS.filter((k) => k.archivable).map((k) => k.kind).sort()
    );
  });

  it("requireKind падает на незнакомом виде, kindOf — нет", () => {
    expect(kindOf("нет-такого")).toBeUndefined();
    expect(() => requireKind("нет-такого")).toThrow(/Неизвестный вид/);
  });
});
