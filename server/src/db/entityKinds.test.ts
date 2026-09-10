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
  EXPLICIT_SETS,
  UNSWEPT_PAIRS,
} from "./entityKinds";

/**
 * Схему проверяем по настоящей мигрированной базе, а не по schema.sql:
 * полторы сотни колонок добавляются `ALTER TABLE` уже внутри openDatabase, и
 * файл схемы про них не знает. Первая версия этого теста разбирала schema.sql
 * регулярками, находила ноль колонок и проходила вхолостую — проверка,
 * которая не умеет падать, хуже отсутствующей.
 */
let tables: Set<string>;
let db: import("better-sqlite3").Database;
const columns = new Map<string, Set<string>>();

beforeAll(async () => {
  // DB_DIR выставляется ДО импорта db (побочный эффект — открытие базы).
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "entity-kinds-"));
  process.env.DB_DIR = tmpDir;
  ({ db } = await import("./db"));

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

  it("в явных наборах нет опечаток", () => {
    // GRAPH_NODES и прочие перечисляют КЛЮЧИ. Опечатка там не сломает
    // компиляцию и не даст ошибки SQL — вид просто молча выпадет из графа
    // или из состава сцены.
    const known = new Set(ENTITY_KINDS.map((k) => k.kind));
    const bad: string[] = [];
    for (const [name, set] of Object.entries(EXPLICIT_SETS)) {
      for (const kind of set) if (!known.has(kind)) bad.push(`${name}: ${kind}`);
    }
    expect(bad).toEqual([]);
  });

  it("hasShortName и hasAliases соответствуют схеме", () => {
    const bad: string[] = [];
    for (const k of ENTITY_KINDS) {
      const real = colsOf(k.table);
      if (real.has("short_name") !== k.hasShortName) {
        bad.push(`${k.kind}: short_name в базе ${real.has("short_name")}, в реестре ${k.hasShortName}`);
      }
      if (real.has("aliases") !== k.hasAliases) {
        bad.push(`${k.kind}: aliases в базе ${real.has("aliases")}, в реестре ${k.hasAliases}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("у вида с именем колонка имени читается, а не только объявлена", () => {
    // Ровно этот дефект жил в SHORT_NAME_MAP: запись компендиума читалась по
    // колонке `title`, которой у неё нет, и первый же пин свалил бы запрос.
    const bad: string[] = [];
    for (const k of ENTITY_KINDS) {
      if (!k.nameCol) continue;
      try {
        db.prepare(`SELECT ${k.nameCol} AS name FROM ${k.table} LIMIT 1`).all();
      } catch (e) {
        bad.push(`${k.kind}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("каждая таблица спутника существует и полиморфна", () => {
    for (const sat of SATELLITE_TABLES) {
      expect(tables.has(sat), `нет таблицы ${sat}`).toBe(true);
      expect(colsOf(sat).has("owner_type"), `${sat} без owner_type`).toBe(true);
      expect(colsOf(sat).has("owner_id"), `${sat} без owner_id`).toBe(true);
    }
  });

  it("каждая полиморфная пара *_type/*_id либо обслуживается, либо объявлена", () => {
    // Раньше здесь стоял снимок из пятнадцати строк. Снимок фиксировал, что
    // пар пятнадцать, но ни слова не говорил, чем они друг от друга
    // отличаются, — а отличаются они сильно: одни говорят на языке реестра,
    // другие своим диалектом, третьи вообще не про сущности. Поэтому теперь
    // не снимок, а требование: новая пара обязана быть описана в
    // UNSWEPT_PAIRS с причиной.
    // Считается по ПАРАМ, а не по таблицам: у `canvas_boards` уборка знает
    // `owner_type`, но не `scope_type`, и при счёте по таблицам вторая пара
    // молча пряталась за первой.
    const known = new Set([
      ...SATELLITE_TABLES.map((t) => `${t}.owner_type`),
      "generic_links.from_type", "generic_links.to_type",
      "entity_relations.from_type", "entity_relations.to_type",
      "canvas_boards.owner_type",
    ]);
    const unmanaged: string[] = [];
    for (const [t, cols] of columns) {
      for (const c of cols) {
        if (!c.endsWith("_type") || !cols.has(c.replace(/_type$/, "_id"))) continue;
        if (known.has(`${t}.${c}`)) continue;
        unmanaged.push(`${t}.${c}`);
      }
    }
    const undeclared = unmanaged.filter((pair) => !UNSWEPT_PAIRS[pair]).sort();
    expect(
      undeclared,
      "новая полиморфная пара без уборки — опиши её в UNSWEPT_PAIRS"
    ).toEqual([]);
  });

  it("в UNSWEPT_PAIRS нет записей про исчезнувшие пары", () => {
    // Обратная сторона: колонку могли переименовать или убрать, и объяснение
    // осталось бы висеть, описывая то, чего нет.
    const stale = Object.keys(UNSWEPT_PAIRS).filter((pair) => {
      const [table, col] = pair.split(".");
      const cols = colsOf(table);
      return !cols.has(col) || !cols.has(col.replace(/_type$/, "_id"));
    });
    expect(stale).toEqual([]);
  });

  it("у каждой объявленной пары есть внятная причина", () => {
    for (const [pair, info] of Object.entries(UNSWEPT_PAIRS)) {
      expect(info.why.length, `${pair}: причина пустая`).toBeGreaterThan(20);
    }
  });
});

/**
 * Реестр объявляет фасет `graphNode` со словами «тот же набор строка в строку»
 * про `client/src/graphTypes.ts`. До этого теста «строка в строку» держалось
 * на честном слове: файлы лежат в разных проектах, общего кода у них нет, и
 * разъехаться они могли молча — вид, добавленный на сервере, просто не
 * нарисовался бы на графе.
 */
describe("граф связей: сервер и клиент знают одни виды", () => {
  const graphTypesPath = path.join(__dirname, "..", "..", "..", "client", "src", "graphTypes.ts");

  /** Ключи объекта `NAME: Record<string, …> = { … }` из исходника клиента. */
  function mapKeys(source: string, name: string): string[] {
    const start = source.indexOf(`export const ${name}`);
    if (start < 0) return [];
    const open = source.indexOf("{", start);
    const close = source.indexOf("\n};", open);
    if (open < 0 || close < 0) return [];
    const body = source.slice(open + 1, close);
    return [...body.matchAll(/^\s{2}([a-z_]+):/gm)].map((m) => m[1]);
  }

  /** Пары `ключ: "значение"` того же объекта. */
  function mapValues(source: string, name: string): Record<string, string> {
    const start = source.indexOf(`export const ${name}`);
    if (start < 0) return {};
    const open = source.indexOf("{", start);
    const close = source.indexOf("\n};", open);
    if (open < 0 || close < 0) return {};
    const body = source.slice(open + 1, close);
    return Object.fromEntries(
      [...body.matchAll(/^\s{2}([a-z_]+):\s*"([^"]*)"/gm)].map((m) => [m[1], m[2]])
    );
  }

  let source = "";
  beforeAll(() => {
    source = fs.readFileSync(graphTypesPath, "utf-8");
  });

  it("файл клиента прочитался и разобрался — проверка умеет падать", () => {
    // Первая версия соседнего теста разбирала schema.sql регулярками, находила
    // ноль колонок и проходила вхолостую. Поэтому сначала — что разбор нашёл
    // хоть что-то осмысленное.
    expect(source.length).toBeGreaterThan(1000);
    expect(mapKeys(source, "TYPE_LABELS").length).toBeGreaterThan(10);
  });

  it("набор узлов графа совпадает с TYPE_LABELS клиента", () => {
    const server = ENTITY_KINDS.filter((k) => k.graphNode).map((k) => k.kind).sort();
    expect(mapKeys(source, "TYPE_LABELS").sort()).toEqual(server);
  });

  it("маршруты клиента не расходятся с detailPrefix реестра", () => {
    // TYPE_ROUTES клиента — четвёртая копия того же знания. Сверяются только
    // виды с детальной страницей: у ресурса и мастерения её нет вовсе, и
    // щелчок по узлу ведёт в список раздела — это не расхождение, а разные
    // вопросы. Требовать совпадения там значило бы записать в реестр неправду.
    const routes = mapValues(source, "TYPE_ROUTES");
    expect(Object.keys(routes).length).toBeGreaterThan(10);
    const wrong: string[] = [];
    for (const [kind, route] of Object.entries(routes)) {
      const prefix = requireKind(kind).detailPrefix;
      if (prefix && prefix !== route) wrong.push(`${kind}: клиент ${route}, реестр ${prefix}`);
    }
    expect(wrong).toEqual([]);
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

  /**
   * Наборы, которые до реестра были литералами в своих файлах. Здесь они
   * зафиксированы такими, какими были, — чтобы правка фасета не расширила
   * молча то, что Мастер видит на экране. Проверка не круговая: слева
   * вычисление из фасетов, справа — прежнее содержимое карты.
   */
  it("выведенные наборы совпадают с прежними литералами", () => {
    const kinds = (pred: (k: (typeof ENTITY_KINDS)[number]) => boolean) =>
      ENTITY_KINDS.filter(pred).map((k) => k.kind).sort();

    // routes/gallery.ts OWNER_TABLES
    expect(kinds((k) => k.owns.includes("gallery_images"))).toEqual(
      ["artifact", "being", "campaign_player_section", "character", "community", "location"]
    );
    // story/foreignLinks.ts SETTING_ENTITIES (сущности мира с подписью)
    expect(kinds((k) => k.belongsTo === "world" && k.hasAliases)).toEqual(
      ["artifact", "being", "community", "location"]
    );
    // import/apply.ts ALIAS_TABLES — тот же признак
    expect(kinds((k) => k.hasAliases && k.belongsTo === "world")).toEqual(
      ["artifact", "being", "community", "location"]
    );
    // routes/search.ts SATELLITE_OWNERS
    expect(
      kinds(
        (k) =>
          k.searchable &&
          !!k.nameCol &&
          k.belongsTo !== "system" &&
          (k.owns.includes("statblocks") || k.owns.includes("gallery_images"))
      )
    ).toEqual(["artifact", "being", "character", "community", "location"]);
    // routes/links.ts NODE_TABLES — тот же набор, что TYPE_LABELS у клиента
    expect(kinds((k) => k.graphNode)).toEqual(
      [
        "adventure", "artifact", "being", "campaign", "character", "community",
        "compendium_entry", "location", "mastering", "player", "resource",
        "scene", "setting",
      ]
    );
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
