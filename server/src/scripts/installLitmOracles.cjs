// node server/src/scripts/installLitmOracles.cjs <app.db> <system_id> <backup.db>
const Database = require("better-sqlite3");
const fs = require("node:fs");
const { article, oracles } = require("./data/litm-oracles.json");

async function main() {
  const [, , file, id, backup] = process.argv;
  if (!file || !/^[1-9]\d*$/.test(id ?? "") || !backup) {
    throw new Error("Укажите базу, ID системы LitM и новый путь для резервной копии");
  }
  const systemId = Number(id);
  const db = new Database(file, { fileMustExist: true });
  try {
    if (db.prepare("SELECT code FROM systems WHERE id = ?").pluck().get(systemId) !== "litm") {
      throw new Error("Указанная система не является LitM");
    }
    const sections = () => db.prepare("SELECT id, name, kind, position FROM system_sections WHERE system_id = ? ORDER BY position, id").all(systemId);
    const entries = oracles.map(({ name, nameEn, lead, ...data }, position) => ({
      uid: "litm.oracle." + data.key, name, nameEn, description: lead, data, position,
    }));
    const existing = () => {
      const all = sections();
      const oracle = all.find((section) => section.kind === "oracle");
      if (!oracle) return null;
      const saved = db.prepare("SELECT uid FROM compendium_entries WHERE system_id = ? AND section_id = ?").pluck().all(systemId, oracle.id);
      const rule = db.prepare("SELECT 1 FROM compendium_entries WHERE system_id = ? AND uid = ?").get(systemId, article.uid);
      if (!rule || entries.some(({ uid }) => !saved.includes(uid))) {
        throw new Error("Найден неполный раздел Оракулов");
      }
      return oracle.id;
    };
    const before = existing();
    if (before !== null) {
      console.log(JSON.stringify({ status: "already-applied", sectionId: before, entries: 0 }));
      return;
    }
    const fd = fs.openSync(backup, "wx");
    fs.closeSync(fd);
    await db.backup(backup);
    const install = db.transaction(() => {
      const installed = existing();
      if (installed !== null) return { status: "already-applied", sectionId: installed, entries: 0 };

      const all = sections();
      const journeys = all.find((s) => s.kind === "journey");
      const rules = all.find((s) => s.kind === "mechanics" && s.name === "Справочник");
      const group = rules && db.prepare("SELECT id FROM compendium_entries WHERE system_id = ? AND section_id = ? AND parent_id IS NULL AND kind = 'mechanic_group' AND name = 'Основы игры'").pluck().get(systemId, rules.id);
      const findEntry = db.prepare("SELECT 1 FROM compendium_entries WHERE system_id = ? AND uid = ?");
      if (!journeys || !group || all.some((s) => s.name === "Оракулы") ||
          [...entries, article].some(({ uid }) => findEntry.get(systemId, uid))) {
        throw new Error("Структура LitM не совпадает с планом установки");
      }
      db.prepare("UPDATE system_sections SET position = position + 1 WHERE system_id = ? AND position >= ?").run(systemId, journeys.position);
      const sectionId = Number(db.prepare("INSERT INTO system_sections (system_id, position, name, kind) VALUES (?, ?, 'Оракулы', 'oracle')")
        .run(systemId, journeys.position).lastInsertRowid);
      const insert = db.prepare(
        "INSERT INTO compendium_entries (system_id, section_id, parent_id, kind, name, name_original, description, data, position, uid) VALUES (?, ?, ?, 'mechanic_item', ?, ?, ?, ?, ?, ?)"
      );
      for (const entry of entries) {
        insert.run(systemId, sectionId, null, entry.name, entry.nameEn, entry.description, JSON.stringify(entry.data), entry.position, entry.uid);
      }
      const position = db.prepare("SELECT COALESCE(MAX(position), -1) + 1 FROM compendium_entries WHERE parent_id = ?").pluck().get(group);
      insert.run(systemId, rules.id, group, article.name, article.name_original, article.description, JSON.stringify(article.data), position, article.uid);
      if (existing() !== sectionId) throw new Error("Установка не прошла проверку");
      return { status: "applied", sectionId, entries: entries.length + 1, backup };
    });
    console.log(JSON.stringify(install.immediate()));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
