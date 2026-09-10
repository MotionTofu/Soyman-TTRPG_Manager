import fs from "fs";
import os from "os";
import path from "path";
import { initDatabase } from "../db/db";
import { setVaultRoot } from "../services/filesystem";

/**
 * Каждому тестовому файлу — своя пустая база и своё пустое хранилище во
 * временном каталоге.
 *
 * Раньше и то и другое защёлкивалось ПОБОЧНЫМ ЭФФЕКТОМ ИМПОРТА: база
 * открывалась в `DB_DIR` при первом `import` модуля базы, а `VAULT_ROOT`
 * читался из среды в момент импорта `services/filesystem`. Чтобы не попасть в
 * рабочие данные владельца, каждый тест был обязан выставить обе переменные
 * раньше импортов — а значит импортировать роутер динамически, внутри
 * `beforeAll`. Обряд ничему не учил, забыть его было нечем, а цена ошибки —
 * тестовый мусор в живом хранилище (и однажды он туда попал).
 *
 * Здесь обе привязки заданы ВЫЗОВОМ, а не расстановкой импортов, поэтому
 * порядок строк на них не влияет. Vitest выполняет setup-файл до загрузки
 * тестового модуля, так что к первому `import` в тесте всё уже наведено:
 * тесты пишутся обычными статическими импортами.
 */
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "soyman-test-"));
const dbDir = path.join(tmpRoot, "data");
const vaultRoot = path.join(tmpRoot, "vault");

// Ставим и в среду тоже: часть тестов читает process.env.VAULT_ROOT, чтобы
// проверить наличие файла на диске.
process.env.DB_DIR = dbDir;
process.env.VAULT_ROOT = vaultRoot;

setVaultRoot(vaultRoot);
initDatabase(dbDir);
