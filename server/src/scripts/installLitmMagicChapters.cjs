// node server/src/scripts/installLitmMagicChapters.cjs <app.db> <system_id> <backup.db>
const Database = require("better-sqlite3");
const fs = require("node:fs");
const { cauldron, rotes } = require("./data/litm-magic-chapters.json");

const chapters = [
  { kind: "cauldron", original: "The Magic Cauldron", content: cauldron },
  { kind: "rotes", original: "Rotes", content: rotes },
];

async function main() {
  const [, , file, id, backup] = process.argv;
  if (!file || !/^[1-9]\d*$/.test(id ?? "") || !backup) {
    throw new Error("Укажите базу, ID системы LitM и новый путь для резервной копии");
  }
  const db = new Database(file, { fileMustExist: true });
  try {
    const systemId = Number(id);
    const getChapters = db.prepare(`
      SELECT e.id, e.description, e.data FROM compendium_entries e
      JOIN system_sections sec ON sec.id = e.section_id AND sec.kind = 'magic_way' AND sec.system_id = e.system_id
      JOIN systems s ON s.id = e.system_id AND s.code = 'litm'
      WHERE s.id = ? AND e.kind = 'mechanic_group' AND e.parent_id IS NULL AND e.name_original = ?
    `);
    function changes() {
      return chapters.map(({ kind, original, content }) => {
        const rows = getChapters.all(systemId, original);
        if (rows.length !== 1) throw new Error("Ожидалась одна глава " + original);
        const current = rows[0];
        const { description, page, ...fields } = content;
        const data = JSON.stringify({ ...JSON.parse(current.data ?? "{}"), page, magicChapter: { kind, ...fields } });
        return { current, description, data };
      }).filter(({ current, description, data }) => current.description !== description || current.data !== data);
    }

    const before = changes();
    if (!before.length) {
      console.log(JSON.stringify({ status: "already-applied", entries: 0 }));
      return;
    }
    fs.closeSync(fs.openSync(backup, "wx"));
    await db.backup(backup);
    const update = db.prepare("UPDATE compendium_entries SET description = ?, data = ? WHERE id = ?");
    db.transaction(() => {
      if (JSON.stringify(changes()) !== JSON.stringify(before)) {
        throw new Error("Главы изменились после создания резервной копии");
      }
      for (const { current, description, data } of before) update.run(description, data, current.id);
    }).immediate();
    console.log(JSON.stringify({ status: "applied", entries: before.length, backup }));
  } finally {
    db.close();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
