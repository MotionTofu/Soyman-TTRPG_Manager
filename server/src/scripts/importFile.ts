// Заливка главы книги правил из командной строки — тот же код, что и за
// экраном импорта, только без интерфейса. Нужен, когда файлов много и щёлкать
// их по одному руками долго.
//
//   npx tsx src/scripts/importFile.ts <файл.json> <system_id>            — только проверка
//   npx tsx src/scripts/importFile.ts <файл.json> <system_id> --apply    — записать
//   … --bind class.wizard=628,mech.damage.fire=42                        — связать ссылки
//
// Пишет в рабочую базу. Перед --apply делать копию.

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { validateSystemImport } from "../import/systemValidate";
import {
  applySystemImport,
  describeSystemImport,
  knownSystemKeys,
  unresolvedRefCandidates,
} from "../import/systemApply";

const [file, systemIdRaw, ...rest] = process.argv.slice(2);
if (!file || !systemIdRaw) {
  console.error("нужно: <файл.json> <system_id> [--apply] [--bind ref=id,…]");
  process.exit(1);
}
const systemId = Number(systemIdRaw);
const apply = rest.includes("--apply");
const bind: Record<string, number> = {};
const bindArg = rest[rest.indexOf("--bind") + 1];
if (rest.includes("--bind") && bindArg) {
  for (const pair of bindArg.split(",")) {
    const [ref, id] = pair.split("=");
    bind[ref] = Number(id);
  }
}

const result = validateSystemImport(JSON.parse(readFileSync(file, "utf8")), knownSystemKeys(systemId));
console.log(`\n=== ${basename(file)} ===`);
console.log("ok:", result.ok, "| ошибок:", result.errors.length, "| предупреждений:", result.warnings.length);
for (const e of result.errors) console.log("  ошибка:", e.path, "—", e.message);
if (!result.ok || !result.data) process.exit(1);
console.log("в файле:", result.counts);

// Записи, которые в компендиуме уже есть под тем же именем, но без ключа:
// экран импорта подставляет найденное совпадение сам, и здесь должно быть так
// же — иначе книга приезжает вторым комплектом. Явный --bind сильнее догадки.
const known = knownSystemKeys(systemId);
const adopted: string[] = [];
for (const section of describeSystemImport(result.data, known, systemId)) {
  for (const entry of section.entries) {
    if (!entry.match || bind[entry.key] || known[entry.key]) continue;
    bind[entry.key] = entry.match.id;
    adopted.push(`${entry.name} → «${entry.match.name}» (${entry.match.id})`);
  }
}
if (adopted.length) {
  console.log(`подхватит существующих записей: ${adopted.length}`);
  for (const a of adopted.slice(0, 40)) console.log("   ", a);
  if (adopted.length > 40) console.log(`    … и ещё ${adopted.length - 40}`);
}

const unresolved = unresolvedRefCandidates(systemId, result.unresolved);
for (const u of unresolved) {
  const chosen = bind[u.ref];
  console.log(
    `  ссылка ${u.ref} (${u.paths.length}):`,
    chosen ? `связана вручную → ${chosen}` : u.suggestion ? `догадка → ${u.suggestion.name} (${u.suggestion.id})` : "не на что указать",
    chosen ? "" : `| кандидатов: ${u.candidates.length}`
  );
}

if (!apply) {
  console.log("\n(проверка, ничего не записано — добавьте --apply)");
  process.exit(0);
}

const applied = applySystemImport(result.data, { systemId, fileName: basename(file), bind });
console.log("\nзалито:", applied.counts, "| батч:", applied.batchId);
for (const w of applied.warnings) console.log("  предупреждение:", w.path, "—", w.message);
const unbound = unresolved.filter((u) => !bind[u.ref]);
for (const u of unbound) console.log(`  не связано: ${u.ref} — ссылок не записано: ${u.paths.length}`);
