import { db } from "../db/db";
import { beingFolder, communityFolder } from "./filesystem";

// Imported profiles may predate their file folder. Use the same builders as
// profile creation so the first upload repairs them in the setting's shelf.
export function ensurePopulationFolder(table: "setting_beings" | "setting_communities", id: string | number): string {
  const entity = db.prepare(`
    SELECT e.name, e.folder_path, s.folder_path AS setting_folder
    FROM ${table} e JOIN settings s ON s.id = e.setting_id WHERE e.id = ?
  `).get(id) as { name: string; folder_path: string | null; setting_folder: string | null } | undefined;
  if (!entity) throw new Error("Profile or setting not found");
  if (entity.folder_path?.trim()) return entity.folder_path;
  if (!entity.setting_folder?.trim()) throw new Error("Setting has no file folder");
  const createFolder = table === "setting_beings" ? beingFolder : communityFolder;
  const folder = createFolder(entity.setting_folder, entity.name);
  db.prepare(`UPDATE ${table} SET folder_path = ? WHERE id = ?`).run(folder, id);
  return folder;
}
