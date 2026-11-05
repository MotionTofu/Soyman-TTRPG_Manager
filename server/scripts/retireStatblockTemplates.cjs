// Explicit, reversible maintenance; never imports the application initializer.
const Database = require('../node_modules/better-sqlite3');
const fs = require('node:fs');
const path = require('node:path');

const quote = name => '"' + name.replaceAll('"', '""') + '"';

function templates(db) {
  return db.prepare("SELECT * FROM resources WHERE type = 'statblock_template' ORDER BY id").all();
}

function dependencies(db, rows) {
  if (!rows.length) return [];
  const ids = rows.map(row => row.id);
  const placeholders = ids.map(() => '?').join(',');
  const found = [];
  const legacy = new RegExp('\\[\\[resource:(' + ids.join('|') + ')\\|');
  const uidTokens = rows.filter(row => row.uid).flatMap(row => [row.uid, 'resource@' + row.uid.slice(0, 8)]);
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    const columns = db.prepare(`PRAGMA table_info(${quote(name)})`).all();
    for (const fk of db.prepare(`PRAGMA foreign_key_list(${quote(name)})`).all().filter(fk => fk.table === 'resources')) {
      const count = db.prepare(`SELECT COUNT(*) n FROM ${quote(name)} WHERE ${quote(fk.from)} IN (${placeholders})`).get(...ids).n;
      if (count) found.push({ table: name, column: fk.from, count, kind: 'foreign-key' });
    }
    for (const column of columns.filter(column => column.name.endsWith('_type'))) {
      const idColumn = column.name.replace(/_type$/, '_id');
      if (!columns.some(column => column.name === idColumn)) continue;
      const count = db.prepare(`SELECT COUNT(*) n FROM ${quote(name)} WHERE ${quote(column.name)} = 'resource' AND ${quote(idColumn)} IN (${placeholders})`).get(...ids).n;
      if (count) found.push({ table: name, column: column.name, count, kind: 'entity-link' });
    }
    for (const column of columns.filter(column => /TEXT|CHAR|CLOB/i.test(column.type))) {
      // The retired rows' own UID is identity, not a reference to themselves.
      const excluded = name === 'resources' ? `AND id NOT IN (${placeholders})` : '';
      const values = db.prepare(`SELECT ${quote(column.name)} value FROM ${quote(name)} WHERE ${quote(column.name)} IS NOT NULL ${excluded}`).all(...(name === 'resources' ? ids : []));
      const count = values.filter(({ value }) => typeof value === 'string' && (legacy.test(value) || uidTokens.some(uid => value.includes(uid)))).length;
      if (count) found.push({ table: name, column: column.name, count, kind: 'text-reference' });
    }
  }
  // Files need a separate preservation procedure; this operation only retires metadata.
  for (const row of rows.filter(row => row.file_path)) found.push({ resourceId: row.id, kind: 'file', path: row.file_path });
  return found;
}

async function retire(db, dbPath, output) {
  const initial = templates(db);
  if (!initial.length) return { retired: 0 };
  const refs = dependencies(db, initial);
  if (refs.length) throw new Error('Templates have dependencies: ' + JSON.stringify(refs));
  fs.mkdirSync(output, { recursive: true });
  const manifest = path.join(output, 'resources.json');
  const backup = path.join(output, 'app-before.sqlite');
  if (fs.existsSync(manifest) || fs.existsSync(backup)) throw new Error('Archive already exists; choose a new output directory');
  await db.backup(backup);
  db.transaction(() => {
    const rows = templates(db);
    if (JSON.stringify(rows) !== JSON.stringify(initial)) throw new Error('Templates changed during backup; repeat with a new archive');
    const currentRefs = dependencies(db, rows);
    if (currentRefs.length) throw new Error('New dependencies appeared: ' + JSON.stringify(currentRefs));
    fs.writeFileSync(manifest, JSON.stringify({ format: 1, dbPath, retiredAt: new Date().toISOString(), rows }, null, 2) + '\n', { flag: 'wx' });
    const remove = db.prepare("DELETE FROM resources WHERE id = ? AND type = 'statblock_template'");
    for (const row of rows) {
      if (remove.run(row.id).changes !== 1) throw new Error('Resource changed: ' + row.id);
    }
    if (db.pragma('foreign_key_check').length) throw new Error('Foreign-key validation failed');
  }).immediate();
  return { retired: initial.length, manifest, backup };
}

function restore(db, manifest) {
  const archive = JSON.parse(fs.readFileSync(manifest, 'utf8'));
  if (archive.format !== 1 || !Array.isArray(archive.rows)) throw new Error('Invalid archive');
  const columns = db.prepare('PRAGMA table_info(resources)').all().map(column => column.name);
  db.transaction(() => {
    for (const row of archive.rows) {
      if (row.type !== 'statblock_template' || !Number.isInteger(row.id)) throw new Error('Invalid archived row');
      if (db.prepare('SELECT id FROM resources WHERE id = ? OR (? IS NOT NULL AND uid = ?)').get(row.id, row.uid, row.uid)) throw new Error('ID or UID is occupied: ' + row.id);
      const fields = Object.keys(row);
      if (fields.some(field => !columns.includes(field))) throw new Error('Resource schema changed; restore requires field mapping');
      db.prepare(`INSERT INTO resources (${fields.map(quote).join(',')}) VALUES (${fields.map(() => '?').join(',')})`).run(...fields.map(field => row[field]));
    }
    if (db.pragma('foreign_key_check').length) throw new Error('Foreign-key validation failed');
  }).immediate();
  return { restored: archive.rows.length };
}

async function main() {
  const args = process.argv.slice(2);
  const option = name => { const index = args.indexOf(name); return index < 0 ? undefined : args[index + 1]; };
  if (args.includes('--apply') && args.includes('--restore')) throw new Error('Choose either --apply or --restore');
  const root = path.resolve(__dirname, '../..');
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'server/config/storages.json'), 'utf8'));
  const active = registry.storages.find(storage => storage.id === registry.activeId);
  if (!active) throw new Error('Active storage not found');
  const dbPath = path.resolve(option('--db') || path.join(active.dbDir, 'app.db'));
  const output = path.resolve(option('--output') || path.join(root, '.scratch/retired-statblock-templates/data'));
  const writing = args.includes('--apply') || args.includes('--restore');
  const db = new Database(dbPath, { readonly: !writing, fileMustExist: true });
  db.pragma('foreign_keys=ON');
  try {
    let result;
    if (args.includes('--restore')) {
      result = restore(db, path.join(output, 'resources.json'));
    } else if (args.includes('--apply')) {
      result = await retire(db, dbPath, output);
    } else {
      const rows = templates(db);
      result = { mode: 'read-only', dbPath, templates: rows.map(row => ({ id: row.id, name: row.name })), dependencies: dependencies(db, rows) };
    }
    console.log(JSON.stringify(result, null, 2));
  } finally { db.close(); }
}

module.exports = { templates, dependencies, retire, restore };
if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
