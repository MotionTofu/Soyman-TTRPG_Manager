// Разовая проверка присланного файла: что скажет валидатор и что предложит
// связать. Ничего не пишет.
import fs from "fs";
import { validateSystemImport } from "../import/systemValidate";
import { knownSystemKeys, unresolvedRefCandidates, describeSystemImport } from "../import/systemApply";

const path = process.argv[2];
const systemId = Number(process.argv[3] || 1);
const raw = JSON.parse(fs.readFileSync(path, "utf8"));
const known = knownSystemKeys(systemId);
const result = validateSystemImport(raw, known);
console.log("ok:", result.ok, "| ошибок:", result.errors.length, "| предупреждений:", result.warnings.length);
for (const e of result.errors.slice(0, 10)) console.log("  ошибка:", e.path, "—", e.message);
console.log("счётчики:", result.counts);
const unresolved = unresolvedRefCandidates(systemId, result.unresolved);
console.log("\nнесвязанных ссылок:", unresolved.length);
for (const u of unresolved) {
  console.log(`  ${u.ref} (${u.expect.join("/")}, ссылок ${u.paths.length}) → ${u.suggestion ? u.suggestion.name : "— нет догадки, кандидатов " + u.candidates.length}`);
}
if (result.data) {
  console.log("\nразделы:");
  for (const s of describeSystemImport(result.data, known)) {
    console.log(`  ${s.title}: ${s.entries.length}, из них перепишется ${s.entries.filter((e) => e.exists).length}`);
  }
}
