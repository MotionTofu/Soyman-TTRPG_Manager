import Database from '../server/node_modules/better-sqlite3/lib/index.js';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import sharp from '../server/node_modules/sharp/dist/index.mjs';
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
    const entries = db.prepare('SELECT id, section_id, parent_id, name, name_original, aliases, kind, level, position, data, description, avatar_image_path FROM compendium_entries WHERE system_id = ?').all(system.id).map(e => ({ ...e, data: JSON.parse(e.data || '{}'), aliases: JSON.parse(e.aliases || '[]') }));
    return { system, sections, entries };
  })();
  for (const entry of data.entries) {
    if (!entry.avatar_image_path) continue;
    const absolute = path.isAbsolute(entry.avatar_image_path) ? entry.avatar_image_path : path.join(storage.vaultRoot, entry.avatar_image_path);
    try {
      const full = await readFile(absolute);
      const preview = await sharp(full).resize({ width: 320, withoutEnlargement: true }).webp({ quality: 80 }).toBuffer();
      const mime = path.extname(absolute).toLowerCase() === '.png' ? 'image/png' : path.extname(absolute).toLowerCase() === '.jpg' || path.extname(absolute).toLowerCase() === '.jpeg' ? 'image/jpeg' : 'image/webp';
      entry.avatar_large_url = `data:${mime};base64,${full.toString('base64')}`;
      entry.avatar_preview_url = `data:image/webp;base64,${preview.toString('base64')}`;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  const catalog = parseCatalog(data);
  await mkdir(path.join(root, 'private'), { recursive: true });
  await writeFile(path.join(root, 'private/catalog.json'), JSON.stringify(catalog));
  console.log(`Local catalog prepared: ${catalog.sections.length} sections, ${catalog.entries.length} entries. No character or campaign data copied.`);
} finally { db.close(); }

