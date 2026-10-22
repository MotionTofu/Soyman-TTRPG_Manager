import Database from "better-sqlite3";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { migrateDndInflicts } from "./dndInflicts";

const GHOUL = {
  name: "Упырь",
  actions: [
    { name: "Мультиатака", description: "Упырь совершает две атаки Когтями." },
    {
      name: "Когти",
      description:
        "Провал: цель Парализована до конца своего следующего хода. Испытание Выносливости: СЛ 10, одно существо.",
    },
    { name: "Укус", description: "Попадание: 5 Колющего урона.", inflicts: { conditions: [], duration: null } },
  ],
};

describe("migrateDndInflicts", () => {
  it("размечает заклинание и действие, не трогает размеченное, снимок до записи", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "inflicts-"));
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE compendium_entries (id INTEGER PRIMARY KEY, system_id INTEGER, kind TEXT, name TEXT, data TEXT, description TEXT)`);
    db.exec(`CREATE TABLE statblocks (id INTEGER PRIMARY KEY, owner_type TEXT, owner_id INTEGER, format TEXT, content TEXT)`);
    db.prepare("INSERT INTO compendium_entries VALUES (?, ?, ?, ?, ?, ?)").run(
      1, 7, "spell", "Удержание личности",
      JSON.stringify({ checks: [{ id: "save1", type: "save", saveAbility: "Мудрость" }] }),
      "В конце каждого своего хода цель повторяет спасбросок, при успехе заклинание прекращается."
    );
    db.prepare("INSERT INTO compendium_entries VALUES (?, ?, ?, ?, ?, ?)").run(2, 7, "condition", "Парализованный", "{}", "");
    db.prepare("INSERT INTO compendium_entries VALUES (?, ?, ?, ?, ?, ?)").run(3, 7, "monster", "Упырь", "{}", "");
    db.prepare("INSERT INTO statblocks VALUES (?, ?, ?, ?, ?)").run(1, "compendium_entry", 3, "dnd_creature", JSON.stringify(GHOUL));

    migrateDndInflicts(db, dir);

    const spell = JSON.parse((db.prepare("SELECT data FROM compendium_entries WHERE id = 1").get() as { data: string }).data);
    expect(spell.checks[0].repeat).toEqual(["turn_end"]);
    const sb = JSON.parse((db.prepare("SELECT content FROM statblocks WHERE id = 1").get() as { content: string }).content);
    expect(sb.actions[0].inflicts).toBeUndefined();
    expect(sb.actions[1]).toMatchObject({
      inflicts: { conditions: [{ id: 2, name: "Парализованный" }], duration: { until: "target_turn_end" }, repeat: null },
      saveAbility: "con",
      saveDC: 10,
    });
    expect(sb.actions[2].inflicts).toEqual({ conditions: [], duration: null });
  });
});
