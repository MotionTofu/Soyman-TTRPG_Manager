import Database from '../server/node_modules/better-sqlite3/lib/index.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCatalog } from './app/catalog.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(await readFile(path.join(root, '../server/config/storages.json'), 'utf8'));
const storage = registry.storages.find(s => s.id === registry.activeId);
if (!storage) throw Error('Активное хранилище SoyMan не найдено');
const db = new Database(path.join(storage.dbDir, 'app.db'), { readonly: true, fileMustExist: true });
try {
  const data = db.transaction(() => {
    const system = db.prepare("SELECT id, name, code, description FROM systems WHERE (code IN ('phb','dnd55') OR name = 'D&D 5.5') AND archived_at IS NULL ORDER BY id LIMIT 1").get();
    if (!system) throw Error('D&D 5.5 не найдена');
    const sections = db.prepare('SELECT id, name, kind, position FROM system_sections WHERE system_id = ?').all(system.id);
    const entries = db.prepare('SELECT id, section_id, parent_id, name, name_original, aliases, kind, level, position, data FROM compendium_entries WHERE system_id = ?').all(system.id).map(e => ({ ...e, data: JSON.parse(e.data || '{}'), aliases: JSON.parse(e.aliases || '[]') }));
    return parseCatalog({ system, sections, entries });
  })();
  await mkdir(path.join(root, 'private'), { recursive: true });
  await writeFile(path.join(root, 'private/catalog.json'), JSON.stringify(data));
  console.log(`Local catalog prepared: ${data.sections.length} sections, ${data.entries.length} entries. No character or campaign data copied.`);
} finally { db.close(); }

