// Регресс парсера Long Story Short на фикстурах (фаза 3):
// настоящая функция на временной базе, живая база не затрагивается никак.
// Фикстуры: DevArchives/lss-empty.json (verbatim пустого экспорта),
// DevArchives/lss-filled.json (анонимизированный заполненный 3 ур.).

import { describe, it, expect, beforeAll } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { deriveSheet, normalizeDndCharacter } from "@soyman/shared";
import type { DndEquipmentItem } from "@soyman/shared";

type ParseFn = typeof import("./lssImport").parseLongStoryShort;
let parseLongStoryShort: ParseFn;
let db: import("better-sqlite3").Database;

const ids = {} as Record<string, number>;
let emptyRaw = "";
let filledRaw = "";

const testDir = path.dirname(fileURLToPath(import.meta.url));
function fixture(name: string): string {
  return fs.readFileSync(path.join(testDir, "..", "..", "..", "DevArchives", name), "utf-8");
}

function insertEntry(
  sectionId: number,
  kind: string,
  name: string,
  data: Record<string, unknown>,
  parentId: number | null = null,
  extra: { aliases?: string[]; name_original?: string } = {}
): number {
  return Number(
    (
      db
        .prepare(
          `INSERT INTO compendium_entries
             (system_id, section_id, parent_id, kind, name, level, data, description, position, aliases, name_original)
           VALUES (?, ?, ?, ?, ?, NULL, ?, '', 0, ?, ?)`
        )
        .run(
          ids.system,
          sectionId,
          parentId,
          kind,
          name,
          JSON.stringify(data),
          JSON.stringify(extra.aliases ?? []),
          extra.name_original ?? ""
        ) as { lastInsertRowid: unknown }
    ).lastInsertRowid
  );
}

beforeAll(async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "lss-import-test-"));
  process.env.DB_DIR = tmpDir;
  ({ parseLongStoryShort } = await import("./lssImport"));
  ({ db } = await import("../db/db"));

  // Миграции уже сидируют систему «D&D 5.5» на свежей базе — ищем, вставляем лишь запасной вариант.
  const existing = db.prepare("SELECT id FROM systems WHERE name = ?").get("D&D 5.5") as { id: number } | undefined;
  ids.system = existing
    ? Number(existing.id)
    : Number(
        (db.prepare("INSERT INTO systems (name) VALUES (?)").run("D&D 5.5") as { lastInsertRowid: unknown }).lastInsertRowid
      );
  const section = (name: string, kind: string): number =>
    Number(
      (
        db
          .prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, 0, ?, ?)")
          .run(ids.system, name, kind) as { lastInsertRowid: unknown }
      ).lastInsertRowid
    );
  const classSec = section("Классы", "class");
  const speciesSec = section("Виды", "species");
  const bgSec = section("Предыстории", "background");

  ids.artificer = insertEntry(classSec, "class", "Артефактор", {
    skill_choice_count: 2,
    skill_choice_options: ["Восприятие"],
    spellcasting_ability: "Интеллект",
    saving_throws: ["Телосложение", "Интеллект"],
  }, null, { aliases: ["Изобретатель"], name_original: "Artificer" });
  ids.cartographer = insertEntry(classSec, "subclass", "Картограф", {}, ids.artificer);
  ids.kalashtar = insertEntry(speciesSec, "species", "Калаштар", {
    creature_type: { name: "Аберрация" },
  }, null, { name_original: "Kalashtar" });
  ids.sage = insertEntry(bgSec, "background", "Мудрец", { skills: ["История"] });

  // Снаряжение — поля ровно как в живом справочнике D&D 5.5: тип доспеха
  // словами, КЗ и пределы строками, у тяжёлого `dex_bonus: false`.
  const gearSec = section("Снаряжение", "equipment");
  const magicSec = section("Маг. предметы", "magic_item");
  ids.chainMail = insertEntry(gearSec, "equipment", "Кольчуга", {
    armor_type: "Тяжёлый доспех", ac: "16", dex_bonus: false, category: "Доспехи", weight: "55 фнт.",
  }, null, { name_original: "Chain Mail" });
  ids.chainShirt = insertEntry(gearSec, "equipment", "Кольчужная рубаха", {
    armor_type: "Средний доспех", ac: "13", max_dex_bonus: "2", dex_bonus: true, category: "Доспехи",
  }, null, { name_original: "Chain Shirt" });
  ids.shield = insertEntry(gearSec, "equipment", "Щит", {
    armor_type: "Щит", ac: "2", dex_bonus: false, category: "Доспехи",
  }, null, { name_original: "Shield" });
  ids.bolts = insertEntry(gearSec, "equipment", "Болты", { category: "Прочие предметы" }, null, { name_original: "Bolt" });
  ids.manifoldTool = insertEntry(magicSec, "magic_item", "Многообразный инструмент", {
    attunement: true, item_type: "Чудесные предметы",
  }, null, { name_original: "Manifold Tool" });

  emptyRaw = fixture("lss-empty.json");
  filledRaw = fixture("lss-filled.json");
});

describe("пустой лист", () => {
  it("даёт ровно один warning info и ничего не находит", () => {
    const r = parseLongStoryShort(emptyRaw);
    expect(r.warnings.map((w) => w.field)).toEqual(["info"]);
    const cd = r.characterData as Record<string, unknown>;
    expect(cd.raceId).toBeNull();
    expect((cd.classes as { classId: unknown }[])[0].classId).toBeNull();
  });
  it("не показывает фантомное оружие", () => {
    const r = parseLongStoryShort(emptyRaw);
    expect(r.shortText).not.toContain("Оружие:");
    expect(r.characterData.attacks).toEqual([]);
  });
  it("пустые структуры без шума", () => {
    const r = parseLongStoryShort(emptyRaw);
    const cd = r.characterData as Record<string, unknown>;
    expect(cd.attunementCount).toBe(0);
    expect(cd.hitDice).toBe("");
    expect(cd.hitPointsTemp).toBe("");
    expect(r.rawExtras.preparedIds).toEqual([]);
    expect(r.rawExtras.homelessSections).toEqual([]);
    expect(r.rawExtras.proficiencySource).toBe("inner");
  });
});

describe("заполненный лист", () => {
  it("линкует 4/4, класс — через алиас", () => {
    const r = parseLongStoryShort(filledRaw);
    const cd = r.characterData as Record<string, unknown>;
    const cls = (cd.classes as Record<string, unknown>[])[0];
    expect(cls.classId).toBe(ids.artificer);
    expect(cls.className).toBe("Изобретатель");
    expect(cls.subclassId).toBe(ids.cartographer);
    expect(cls.skillChoiceCount).toBe(2);
    expect(cls.spellcastingAbility).toBe("Интеллект");
    expect(cd.raceId).toBe(ids.kalashtar);
    expect(cd.raceTypeName).toBe("Аберрация");
    expect(cd.backgroundId).toBe(ids.sage);
    const fields = r.warnings.map((w) => w.field);
    expect(fields).not.toContain("class");
    expect(fields).not.toContain("race");
    expect(fields).not.toContain("subclass");
    expect(fields).not.toContain("background");
  });
  it("тянет монеты, настройку, владения, бои", () => {
    const r = parseLongStoryShort(filledRaw);
    const cd = r.characterData as Record<string, unknown>;
    expect((cd.coins as Record<string, string>).gp).toBe("156");
    expect(cd.attunementCount).toBe(2);
    const profs = (cd.proficiencies as { name: string }[]).map((p) => p.name);
    expect(profs).toContain("Лёгкие доспехи");
    expect(profs).toContain("Средние доспехи");
    expect(profs).toContain("Простое оружие");
    expect(profs).toContain("armor-label");
    expect(r.warnings.map((w) => w.field)).toContain("prof");
    expect((cd.attacks as unknown[]).length).toBe(4);
    expect(Object.keys((cd.skillProfs as object) ?? {}).length).toBe(5);
    expect(cd.hitDice).toBe("3к8");
    expect(cd.hitPointsTemp).toBe("");
  });
  it("кладёт немappable в rawExtras и warnings", () => {
    const r = parseLongStoryShort(filledRaw);
    expect(r.rawExtras.preparedIds.length).toBe(12);
    expect((r.rawExtras.slotsRaw as { "slots-1": { value: number } })["slots-1"].value).toBe(2);
    expect(r.rawExtras.spellsInfo.baseCode).toBe("int");
    expect(r.rawExtras.avatarJpeg).toContain("example.com");
    expect(r.warnings.map((w) => w.field)).toContain("spells");
    expect(r.warnings.map((w) => w.field)).toContain("links");
  });
  it("бесхозные — шесть notes-*, allies в notes под своим лейблом", () => {
    const r = parseLongStoryShort(filledRaw);
    const keys = r.rawExtras.homelessSections.map((s) => s.key).sort();
    expect(keys).toEqual(["notes-1", "notes-2", "notes-3", "notes-4", "notes-5", "notes-6"]);
    const notes = String((r.characterData as Record<string, unknown>).notes ?? "");
    expect(notes).toContain("Предметы, которые могу сделать:");
    expect(notes).not.toContain("## Союзники");
  });

  // Корень двух пометок «не пересчитано» (docs/dnd-derive-revision.md,
  // «Находки»): импорт не ставил кубовую часть хитов и не отмечал надетое.
  it("хиты — моделью слагаемых: лист показывает ровно максимум из LSS", () => {
    const r = parseLongStoryShort(filledRaw);
    const cd = r.characterData as Record<string, unknown>;
    // Изобретатель 3, Телосложение 16, в LSS 30: 30 − 3 × 3.
    expect(cd.hpLump).toBe(21);
    expect(cd.hpRolls).toEqual([]);
    const hp = deriveSheet(normalizeDndCharacter(cd)).maxHitPoints;
    expect(hp.value).toBe(30);
    expect(hp.stale).toBeUndefined();
  });

  it("снаряжение связано со справочником, надето то, с чем сходится КЗ из LSS", () => {
    const r = parseLongStoryShort(filledRaw);
    const cd = r.characterData as Record<string, unknown>;
    const items = (cd.equipmentSections as { items: DndEquipmentItem[] }[])[0].items;
    const byName = (name: string) => items.find((i) => i.name === name);

    // «Кольчуга (средняя)» связалась с Кольчугой без уточнения в скобках. С
    // ней и без щита (в LSS щит снят) КЗ ровно 16 — значит, надета она.
    const armor = items.find((i) => i.entryId === ids.chainMail);
    expect(armor?.equipped).toBe(true);
    expect(armor?.armorType).toBe("Тяжёлый доспех");
    expect(byName("Щит")?.entryId).toBe(ids.shield);
    expect(byName("Щит")?.equipped).toBeFalsy();

    // Количество вынесено из названия и связь нашлась уже по чистому имени.
    expect(byName("Болты")?.qty).toBe("15");
    expect(byName("Болты")?.entryId).toBe(ids.bolts);

    // Оружие надетым не отмечается: атаки из LSS уже перенесены строками.
    expect(items.filter((i) => i.equipped).length).toBe(1);

    const ac = deriveSheet(normalizeDndCharacter(cd)).armorClass;
    expect(ac.value).toBe(16);
    expect(ac.stale).toBeUndefined();

    expect(r.rawExtras.gearSummary).toContain("Кольчуга");
    expect(r.rawExtras.gearSummary).toContain("Щит не надет");
    expect(r.warnings.map((w) => w.field)).not.toContain("equipment");
  });

  it("настроенное из LSS отмечено в инвентаре, в Заметках — только несовпавшее", () => {
    const r = parseLongStoryShort(filledRaw);
    const cd = r.characterData as Record<string, unknown>;
    const items = (cd.equipmentSections as { items: DndEquipmentItem[] }[])[0].items;
    expect(items.find((i) => i.name === "Многообразный инструмент")?.attuned).toBe(true);
    expect(items.filter((i) => i.attuned).length).toBe(1);
    // Счётчик настройки — по LSS, как и был: второй предмет настроен, просто
    // в инвентаре он записан другим именем.
    expect(cd.attunementCount).toBe(2);
    const notes = String(cd.notes ?? "");
    expect(notes).toContain("## Настройка (1)");
    expect(notes).toContain("Кольцо восстановления заклинаний");
    expect(notes).not.toContain("- Многообразный инструмент");
  });
});

describe("хиты и снаряжение пустого листа", () => {
  it("пустой максимум не превращается в число, итога сверки нет", () => {
    const r = parseLongStoryShort(emptyRaw);
    const cd = r.characterData as Record<string, unknown>;
    expect(cd.hpLump ?? null).toBeNull();
    expect(r.rawExtras.gearSummary).toBe("");
  });
});

describe("алиас не бьёт прямое имя", () => {
  it("точное совпадение побеждает", () => {
    const exactId = insertEntry(
      Number((db.prepare("SELECT section_id FROM compendium_entries WHERE id = ?").get(ids.artificer) as { section_id: number }).section_id),
      "class",
      "Изобретатель",
      {}
    );
    const inner = {
      name: { value: "Т" },
      info: { charClass: { value: "Изобретатель" }, level: { value: 1 } },
      stats: {}, saves: {}, skills: {}, vitality: {}, weaponsList: [], text: {},
    };
    const r = parseLongStoryShort(JSON.stringify({ data: JSON.stringify(inner) }));
    const cls = ((r.characterData as Record<string, unknown>).classes as Record<string, unknown>[])[0];
    expect(cls.classId).toBe(exactId);
  });
});
