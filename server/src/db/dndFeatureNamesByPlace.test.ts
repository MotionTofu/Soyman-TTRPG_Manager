import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { applyDndFeatureNamesByPlace } from "./dndFeatureNamesByPlace";

describe("applyDndFeatureNamesByPlace", () => {
  it("пишет только пустые имена умений на своём месте", () => {
    const db = new Database(":memory:");
    db.exec(`CREATE TABLE compendium_entries (id INTEGER PRIMARY KEY, parent_id INTEGER, kind TEXT, name TEXT, name_original TEXT NOT NULL DEFAULT '', level INTEGER)`);
    db.exec(`INSERT INTO compendium_entries VALUES
      (1, NULL, 'class', 'Бард', 'Bard', NULL),
      (2, 1, 'feature', 'Подкласс барда', '', 3),
      (3, 1, 'feature', 'Контрочарование', 'Мой перевод', 7),
      (4, 1, 'feature', 'Подкласс барда', '', 4),
      (5, NULL, 'class', 'Бард', 'Homebrew Bard', NULL),
      (6, 5, 'feature', 'Подкласс барда', '', 3)`);
    expect(applyDndFeatureNamesByPlace(db)).toBe(1);
    const names = db.prepare("SELECT id, name_original FROM compendium_entries ORDER BY id").all();
    expect(names).toEqual([
      { id: 1, name_original: "Bard" },
      { id: 2, name_original: "Bard Subclass" },
      { id: 3, name_original: "Мой перевод" },
      { id: 4, name_original: "" },
      { id: 5, name_original: "Homebrew Bard" },
      { id: 6, name_original: "" },
    ]);
    expect(applyDndFeatureNamesByPlace(db)).toBe(0);
  });
});
