// Заливка файла system-import/1 из консоли — то же, что POST /api/system-import/apply,
// но без экрана сверки. Файл: { data, bind?, skip? } (bind — ключ файла → id записи,
// skip — ключи, которые не переписывать; см. docs/system-import/format.md).
//
//   DB_DIR=<папка копии> npx tsx src/scripts/applySystemImportFile.ts <файл> <system_id>
//
// Без DB_DIR пишет в рабочую базу: сначала копия, потом рабочая.
import fs from "fs";
import { db, initDatabase } from "../db/db";
initDatabase();
import { validateSystemImport } from "../import/systemValidate";
import { applySystemImport, knownSystemKeys } from "../import/systemApply";

const [file, sidArg] = process.argv.slice(2);
const sid = Number(sidArg);
if (!file || !Number.isInteger(sid)) {
  console.error("usage: applySystemImportFile.ts <file> <system_id>");
  process.exit(2);
}
const { data, bind = {}, skip = [] } = JSON.parse(fs.readFileSync(file, "utf8"));
const v = validateSystemImport(data, knownSystemKeys(sid));
console.log("errors:", JSON.stringify(v.errors));
v.warnings.forEach((w) => console.log("warn", w.path, w.message));
const unbound = v.unresolved.filter((u) => !(u.ref in bind)).map((u) => u.ref);
if (unbound.length) console.log("не связаны (ссылки не запишутся):", unbound);
if (!v.ok || !v.data) process.exit(1);
const r = applySystemImport(v.data, { systemId: sid, fileName: file, skip, bind });
console.log("партия", r.batchId, JSON.stringify(r.counts));
r.warnings.forEach((w) => console.log("warn", w.path, w.message));
console.log("записей в системе:", (db.prepare("SELECT count(*) n FROM compendium_entries WHERE system_id = ?").get(sid) as { n: number }).n);
