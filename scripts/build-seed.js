// Builds a "seed" data package (DB + vault files) containing only Системы
// and Сеттинги — no campaigns/sessions/players/finances/mastering notes —
// for bundling into the "full" portable exe so friends get the compendiums
// and settings pre-loaded without seeing personal campaign data.
//
// Usage: node scripts/build-seed.js
// Reads from the active storage registered in server/config/storages.json,
// writes to <repo>/seed-full/{data/app.db, vault/{Systems,Settings}}.

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const serverDir = path.join(repoRoot, "server");
const Database = require(path.join(serverDir, "node_modules", "better-sqlite3"));

const registryPath = path.join(serverDir, "config", "storages.json");
const registry = JSON.parse(fs.readFileSync(registryPath, "utf-8"));
const active = registry.storages.find((s) => s.id === registry.activeId) || registry.storages[0];

const srcDbPath = path.join(active.dbDir, "app.db");
const srcVaultRoot = active.vaultRoot;

const outRoot = path.join(repoRoot, "seed-full");
const outDataDir = path.join(outRoot, "data");
const outVaultRoot = path.join(outRoot, "vault");
const outDbPath = path.join(outDataDir, "app.db");

console.log("Source DB:", srcDbPath);
console.log("Source vault:", srcVaultRoot);
console.log("Output:", outRoot);

fs.rmSync(outRoot, { recursive: true, force: true });
fs.mkdirSync(outDataDir, { recursive: true });
fs.mkdirSync(outVaultRoot, { recursive: true });

// Backup (not a plain file copy) so we get a consistent snapshot even while
// the dev server holds the DB open in WAL mode.
const srcDb = new Database(srcDbPath, { readonly: true, fileMustExist: true });
srcDb.backup(outDbPath).then(() => {
  srcDb.close();
  pruneAndCopy();
});

function pruneAndCopy() {
  const db = new Database(outDbPath);
  db.pragma("foreign_keys = ON");

  const before = summarize(db);

  // Personal data: campaigns cascade-delete characters, sessions,
  // campaign_roster, campaign_entries, preproduction, campaign_calendar_events,
  // session_attendance, and any resources scoped to that campaign/session.
  db.exec("DELETE FROM campaigns");
  db.exec("DELETE FROM players");
  db.exec("DELETE FROM mastering_notes");
  // Keep only resources tied to a system or setting (e.g. statblock
  // templates); drop unscoped "global" resources, which may be personal
  // notes/files.
  db.exec("DELETE FROM resources WHERE scope NOT IN ('system','setting')");
  // App-wide UI prefs (e.g. home page background) — personal, not content.
  db.exec("DELETE FROM app_settings");
  // Toggle-module wrapper rows; re-synced lazily from systems/settings on
  // next GET /api/modules, so safe to clear.
  db.exec("DELETE FROM modules");

  db.exec("VACUUM");

  const after = summarize(db);
  console.log("Before prune:", before);
  console.log("After prune:", after);
  db.close();

  for (const folder of ["Systems", "Settings"]) {
    const src = path.join(srcVaultRoot, folder);
    const dest = path.join(outVaultRoot, folder);
    if (fs.existsSync(src)) {
      fs.cpSync(src, dest, { recursive: true });
      console.log(`Copied vault/${folder}`);
    }
  }

  // The DB's folder_path/image_path columns still hold this machine's
  // absolute vault path (e.g. "E:\RPG-Vault\..."). electron/main.js's
  // seedIfNeeded() rewrites every occurrence of this prefix to the
  // installing user's actual vault path on first launch — this marker file
  // is what it rewrites *from*.
  fs.writeFileSync(path.join(outRoot, "vault-root.txt"), srcVaultRoot, "utf-8");

  console.log("Seed package ready at", outRoot);
}

function summarize(db) {
  const tables = [
    "systems",
    "settings",
    "campaigns",
    "players",
    "characters",
    "sessions",
    "resources",
    "compendium_entries",
  ];
  const out = {};
  for (const t of tables) {
    out[t] = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
  }
  return out;
}
