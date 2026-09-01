import path from "path";
import { db } from "../db/db";
import { renameFolder, moveFolder } from "./filesystem";

// Every DB column that stores a vault path ends in "_path" (folder_path,
// file_path, and the various *_image_path), plus vault_files.path (dedup index
// uses a bare `path` column). We discover them by introspecting the live
// schema, so a newly added path column is covered automatically and there's
// no hand-maintained list to fall out of date.
function assertSafeIdentifier(name: string): void {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`Unsafe identifier: ${name}`);
}
function pathColumns(table: string): string[] {
  assertSafeIdentifier(table);
  const cols = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return cols
    .filter((c) => c.name.endsWith("_path") || (table === "vault_files" && c.name === "path"))
    .map((c) => c.name);
}

// After a folder is moved on disk, rewrite every stored path that WAS that
// folder or lived inside it — the renamed entity's own folder_path/images AND
// all descendants at any depth (a campaign's sessions & characters, a setting's
// nested locations/beings/communities, their uploaded files) — so no stored
// path is left dangling at the old location.
//
// Stored paths are RELATIVE to the vault root (since П2.1), so both prefixes
// are relative too (e.g. `Campaigns\Old` → `Campaigns\New`). Match is
// prefix-based but separator-aware: `oldPrefix + sep` guards against a sibling
// like `…/Test2` being caught when renaming `…/Test`. Table and column names
// come from the DB's own catalog (never from user input), so the interpolated
// identifiers are injection-safe.
export function rewriteVaultPaths(oldPrefix: string, newPrefix: string): void {
  if (!oldPrefix || oldPrefix === newPrefix) return;
  const withSep = oldPrefix + path.sep;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
    .all() as { name: string }[];
  const run = db.transaction(() => {
    for (const { name: table } of tables) {
      assertSafeIdentifier(table);
      for (const col of pathColumns(table)) {
        assertSafeIdentifier(col);
        db.prepare(
          `UPDATE ${table} SET ${col} = ? || substr(${col}, ?)
           WHERE ${col} = ? OR substr(${col}, 1, ?) = ?`
        ).run(newPrefix, oldPrefix.length + 1, oldPrefix, withSep.length, withSep);
      }
    }
  });
  run();
}

// Drop-in replacement for renameFolder at entity-rename sites: moves the folder
// on disk AND fixes every DB path underneath it in one step, so callers can't
// forget the second half and leave images/descendants pointing at the old name.
export function renameEntityFolder(oldPath: string | null, newName: string): string {
  const newPath = renameFolder(oldPath, newName);
  if (oldPath) rewriteVaultPaths(oldPath, newPath);
  return newPath;
}

// Drop-in replacement for moveFolder at entity re-parenting sites (e.g.
// nesting a location under a different parent) — moves the folder on disk
// AND fixes every DB path underneath it, same as renameEntityFolder.
export function moveEntityFolder(oldPath: string | null, newParentPath: string): string {
  const newPath = moveFolder(oldPath, newParentPath);
  if (oldPath) rewriteVaultPaths(oldPath, newPath);
  return newPath;
}