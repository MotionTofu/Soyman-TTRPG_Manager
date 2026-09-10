import { openDatabase } from "../db/db";

// Прогон всех pending-миграций (то же, что делает старт сервера).
// Использование: npx tsx src/scripts/runPendingMigrations.ts [dbDir]
//
// Мигрируется РОВНО тот каталог, который назван в аргументе: импорт модуля
// базу больше не открывает, поэтому «прогон на копии» трогает только копию.
const dbDir = process.argv[2] ?? "data";
const db = openDatabase(dbDir);
db.close();
console.log(`[run] migrations applied for ${dbDir}`);
process.exit(0);
