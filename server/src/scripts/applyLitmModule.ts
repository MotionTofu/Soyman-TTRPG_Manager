// Применяет JSON-модуль LitM к существующей системе (merge по kind+name-path).
//   npx tsx src/scripts/applyLitmModule.ts <файл.json> <system_id>
// Тот же код, что «Обновить модуль» из каталога: новое добавляется,
// локальное не удаляется. Перед первым запуском — копия базы.

import { readFileSync } from "node:fs";
import { updateSystemFromExport } from "../routes/systems";
import { db } from "../db/db";

const [file, idRaw] = process.argv.slice(2);
if (!file || !idRaw) {
  console.error("нужно: <файл.json> <system_id>");
  process.exit(1);
}

const data = JSON.parse(readFileSync(file, "utf-8"));
const targetId = Number(idRaw);

db.prepare("SELECT name FROM systems WHERE id = ?").get(targetId) ??
  (console.error(`система ${targetId} не найдена`), process.exit(1));

updateSystemFromExport(targetId, data).then((summary) => {
  console.log("готово:", JSON.stringify(summary, null, 2));
  const rows = db
    .prepare(
      `SELECT s.name, s.kind, COUNT(c.id) AS n
       FROM system_sections s LEFT JOIN compendium_entries c ON c.section_id = s.id
       WHERE s.system_id = ? GROUP BY s.id ORDER BY s.position`
    )
    .all(targetId);
  for (const r of rows) console.log(`${String(r.name).padEnd(16)} ${r.n}`);
});
