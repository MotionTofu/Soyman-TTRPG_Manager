import { openDatabase } from "../db/db";

// Прогон всех pending-миграций (то же, что делает старт сервера).
// Использование: npx tsx src/scripts/runPendingMigrations.ts [dbDir]
// ВНИМАНИЕ: сам импорт ../db/db открывает и мигрирует РАБОЧУЮ БД
// (module-level openDatabase). «Прогон на копии» копию тоже правит,
// но живую — всегда. Бэкап живой перед прогоном обязателен.
const dbDir = process.argv[2] ?? "data";
const db = openDatabase(dbDir);
db.close();
console.log(`[run] migrations applied for ${dbDir}`);
process.exit(0);
