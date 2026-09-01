import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { resizeImageBuffer, type ImageSizePreset } from "./imageResize";
import { storeDeduped } from "./vaultDedup";

export let VAULT_ROOT = process.env.VAULT_ROOT || "E:\\RPG-Vault";

// Folders/files inside the vault are stored in the DB relative to the vault
// root (Windows separators, e.g. `Campaigns\Вотердип`), so the whole storage
// is portable: the DB travels with the vault and only the profile's vaultRoot
// changes (see storages.ts). Everything touching the filesystem or handing
// raw paths to the client goes through these two helpers. Paths that are
// already absolute (notably external resource file_paths — a sound library
// is not copied into the vault) pass through unchanged.
export function vaultAbs(p: string): string {
  return path.isAbsolute(p) ? p : path.join(VAULT_ROOT, p);
}

export function vaultRel(p: string): string {
  if (path.isAbsolute(p)) {
    const rel = path.relative(VAULT_ROOT, p);
    if (rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel)) return rel;
  }
  return p;
}

// Called when the active storage profile changes so every helper below
// (which read the module-level VAULT_ROOT at call time) starts writing to
// the new location without needing a process restart.
export function setVaultRoot(newRoot: string): void {
  VAULT_ROOT = newRoot;
  initVault();
}

export function sanitizeName(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
    .trim()
    .replace(/\.+$/, "");
  return cleaned || "untitled";
}

function ensureDir(p: string): string {
  fs.mkdirSync(p, { recursive: true });
  return p;
}

// Creates a *fresh* entity folder under `base`: uses sanitizeName(name), or
// `name-2`, `name-3`, … if that path is already taken — so two entities that
// happen to share a display name never land in the same folder (which would
// let their uploaded files silently overwrite each other, and let a new
// entity inherit an archived namesake's files). Use only for entity folders;
// structural subfolders (Geography, a session's resources/handouts/map,
// Mastering/Knowledge/<system>) keep plain ensureDir reuse semantics.
// Works in absolute space (vaultAbs on the base), returns an absolute path —
// public builders wrap the result in vaultRel before it reaches the DB.
function freshDir(base: string, name: string): string {
  const absBase = vaultAbs(base);
  const safe = sanitizeName(name);
  let candidate = path.join(absBase, safe);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(absBase, `${safe}-${n}`);
  }
  return ensureDir(candidate);
}

// Factored out of initVault() so a new/imported storage's folder structure
// can be created before it becomes the active VAULT_ROOT.
export function initVaultAt(root: string): void {
  ensureDir(root);
  ensureDir(path.join(root, "Campaigns"));
  ensureDir(path.join(root, "Settings"));
  ensureDir(path.join(root, "Systems"));
  ensureDir(path.join(root, "Players"));
  ensureDir(path.join(root, "Resources"));
  ensureDir(path.join(root, "Mastering", "Prep"));
  ensureDir(path.join(root, "Mastering", "Live"));
  ensureDir(path.join(root, "Mastering", "Knowledge"));
}

export function initVault(): void {
  initVaultAt(VAULT_ROOT);
}

// Все публичные «папко-дающие» функции возвращают ОТНОСИТЕЛЬНЫЙ путь — их
// результат попадает в БД (folder_path / *_image_path). Внутри всё
// создаётся в абсолютном пространстве (freshDir → vaultAbs).
export function campaignFolder(name: string): string {
  return vaultRel(freshDir(path.join(VAULT_ROOT, "Campaigns"), name));
}

export function settingFolder(name: string): string {
  return vaultRel(freshDir(path.join(VAULT_ROOT, "Settings"), name));
}

export function systemFolder(name: string): string {
  return vaultRel(freshDir(path.join(VAULT_ROOT, "Systems"), name));
}

export function playerFolder(name: string): string {
  return vaultRel(freshDir(path.join(VAULT_ROOT, "Players"), name));
}

export function sessionFolder(campaignFolderPath: string, date: string): string {
  const base = freshDir(path.join(vaultAbs(campaignFolderPath), "Sessions"), date);
  ensureDir(path.join(base, "resources"));
  ensureDir(path.join(base, "handouts"));
  ensureDir(path.join(base, "map"));
  return vaultRel(base);
}

export function characterFolder(campaignFolderPath: string, characterName: string): string {
  return vaultRel(freshDir(path.join(vaultAbs(campaignFolderPath), "Characters"), characterName));
}

// Standalone (not tied to any campaign) character, created by a player from
// player-app's "Персонажи" section — lives under the player's own vault
// folder instead of a campaign's.
export function standaloneCharacterFolder(playerFolderPath: string, characterName: string): string {
  return vaultRel(freshDir(path.join(vaultAbs(playerFolderPath), "Characters"), characterName));
}

export function campaignPlayerSectionFolder(campaignFolderPath: string, name: string): string {
  return vaultRel(freshDir(path.join(vaultAbs(campaignFolderPath), "ForPlayers"), name));
}

const WORLD_EXPLORATION_KIND_FOLDERS: Record<string, string> = {
  being: "Существа",
  location: "Локации",
  item: "Предметы",
  event: "События",
};

export function worldExplorationEntryFolder(campaignFolderPath: string, kind: string, name: string): string {
  const kindFolder = WORLD_EXPLORATION_KIND_FOLDERS[kind] ?? "Прочее";
  return vaultRel(freshDir(path.join(vaultAbs(campaignFolderPath), "WorldExploration", kindFolder), name));
}

export function locationFolder(parentFolderPath: string, name: string): string {
  return vaultRel(freshDir(vaultAbs(parentFolderPath), name));
}

export function settingGeographyRoot(settingFolderPath: string): string {
  return vaultRel(ensureDir(path.join(vaultAbs(settingFolderPath), "Geography")));
}

export function beingFolder(settingFolderPath: string, name: string): string {
  return vaultRel(freshDir(path.join(vaultAbs(settingFolderPath), "Population"), name));
}

export function communityFolder(settingFolderPath: string, name: string): string {
  return vaultRel(freshDir(path.join(vaultAbs(settingFolderPath), "Population", "Communities"), name));
}

export function artifactFolder(settingFolderPath: string, name: string): string {
  return vaultRel(freshDir(path.join(vaultAbs(settingFolderPath), "Artifacts"), name));
}

export function knowledgeFolder(systemName: string): string {
  return vaultRel(
    ensureDir(path.join(VAULT_ROOT, "Mastering", "Knowledge", sanitizeName(systemName)))
  );
}

export function ensureSubfolder(basePath: string, sub: string): string {
  return vaultRel(ensureDir(path.join(vaultAbs(basePath), sub)));
}

// Куда ложится собственное изображение записи компендиума — по разделу, к
// которому запись относится: смешивать портреты бестиария с портретами судов
// в одной папке значит получить список файлов `entry-317-avatar.jpg`, по
// которому ничего не найти. Имя латиницей, как у остальных служебных папок
// хранилища (Gallery, Inventory, Resources); папка портретов статблоков —
// `Statblocks` (было `Статблоки`, переименована в П2.5, 2026-08-29).
export function entryImageFolder(systemFolderPath: string, entryKind: string): string {
  const sub = entryKind === "vehicle" || entryKind === "vehicle_post" ? "Vehicles" : "Bestiary";
  return ensureSubfolder(systemFolderPath, sub);
}

// Extensions an export JSON might need to embed as base64 (images for
// avatars/thumbnails, audio/pdf for resources) — used by both systems.ts's
// export (thumbnail only) and settings.ts's export (avatars/background/
// thumbnail/resources), so it lives here instead of being duplicated.
const EXT_TO_MIME: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".m4a": "audio/mp4",
  ".flac": "audio/flac",
  ".pdf": "application/pdf",
};

// Reads a vault file into a base64 payload for embedding in a JSON export.
// Returns null if the path is empty or the file is missing (best-effort —
// a stale image path shouldn't fail the whole export). Falls back to
// application/octet-stream for unrecognized extensions rather than dropping
// the file entirely — a resource can be any file type, unlike a thumbnail.
// Accepts a stored (relative) path; resolves inside.
export function readFileAsBase64(
  storedPath: string | null | undefined
): { filename: string; mime: string; base64: string } | null {
  if (!storedPath) return null;
  const abs = vaultAbs(storedPath);
  if (!fs.existsSync(abs)) return null;
  const ext = path.extname(abs).toLowerCase();
  const mime = EXT_TO_MIME[ext] || "application/octet-stream";
  return { filename: path.basename(abs), mime, base64: fs.readFileSync(abs).toString("base64") };
}

// Decodes a base64 export payload and writes it into `folder` under
// `filename`, deduped the same way as a regular upload — used when
// importing a setting export that embedded avatar/background/resource
// files. Returns the resulting relative path (goes straight into the DB).
export async function writeBase64File(folder: string, filename: string, base64: string): Promise<string> {
  const target = path.join(vaultAbs(folder), sanitizeName(filename));
  const root = path.resolve(VAULT_ROOT);
  const resolved = path.resolve(target);
  if (resolved === root || !resolved.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside vault: ${folder}/${filename}`);
  }
  await storeDeduped(Buffer.from(base64, "base64"), target);
  return vaultRel(target);
}

// Writes a replacement upload (thumbnail/avatar/background/etc.) and removes
// the previous file if the new one landed at a different path — happens
// whenever the uploaded extension differs from the old one (e.g. png -> jpg),
// since otherwise the orphaned old file lingers on disk forever.
//
// Pass `resize` to cap the image's dimensions before writing (see
// imageResize.ts's presets) — omit it for uploads that must stay
// full-resolution (e.g. a location's map image).
export async function writeReplacingOldFile(
  newPath: string,
  buffer: Buffer,
  oldPath: string | null | undefined,
  resize?: ImageSizePreset
): Promise<void> {
  const absNew = vaultAbs(newPath);
  // C-P1-6: путь обязан лежать внутри VAULT_ROOT, иначе — испорченная запись БД (../../Windows)
  const root = path.resolve(VAULT_ROOT);
  const resolvedNew = path.resolve(absNew);
  if (resolvedNew === root || !resolvedNew.startsWith(root + path.sep)) {
    throw new Error(`Refusing to write outside vault: ${newPath}`);
  }
  const absOld = oldPath ? vaultAbs(oldPath) : null;
  if (absOld && absOld !== absNew && fs.existsSync(absOld)) {
    try {
      fs.unlinkSync(absOld);
    } catch (err) {
      console.error(`Failed to remove old file ${absOld}:`, err);
    }
  }
  const finalBuffer = resize ? await resizeImageBuffer(buffer, resize) : buffer;
  await storeDeduped(finalBuffer, absNew);
}

// Reveals `target` in the OS file explorer — either the file itself
// (highlighted in its containing folder, when `selectFile` is true) or the
// folder itself. Runs on the same machine as the vault, so shelling out
// locally is safe here — this is a desktop tool, not a public server.
// Accepts a stored (relative) path; resolves inside.
export function openInFileExplorer(target: string, selectFile: boolean): void {
  const abs = vaultAbs(target);
  if (process.platform === "win32") {
    execFile("explorer.exe", [selectFile ? `/select,${abs}` : abs], () => {
      // explorer.exe returns a non-zero exit code even on success — ignore.
    });
  } else if (process.platform === "darwin") {
    execFile("open", selectFile ? ["-R", abs] : [abs], () => {});
  } else {
    execFile("xdg-open", [selectFile ? path.dirname(abs) : abs], () => {});
  }
}

// A replacement upload usually lands at the exact same path (avatar.png ->
// avatar.png), so the URL never changes — the client refetches the entity,
// renders <img> with a byte-identical src, and the browser keeps showing the
// image it already has until a hard reload. Tagging the URL with the file's
// mtime makes every replacement a genuinely new URL, so the new image appears
// immediately without Ctrl+R. Missing file (stale path) — plain URL, the 404
// is the caller's problem either way. Accepts a stored (relative) path.
export function toFileUrl(storedPath: string): string {
  const abs = vaultAbs(storedPath);
  const relative = path.relative(VAULT_ROOT, abs).split(path.sep).join("/");
  let version = "";
  try {
    version = `?v=${Math.floor(fs.statSync(abs).mtimeMs)}`;
  } catch {
    /* file gone — serve the bare URL */
  }
  const encoded = relative.split("/").map((seg) => encodeURIComponent(seg)).join("/");
  return `/files/${encoded}${version}`;
}

// Best-effort recursive removal of an entity's folder, used only by permanent
// (post-archive) deletion. Two hard safety rails: the target must resolve to a
// path *strictly inside* the current vault, and must not be the vault root
// itself — so a null/stale/malformed folder_path can never nuke the vault or
// anything outside it. Failure (a Windows file lock, say) is logged, not
// thrown: the DB row is already gone and folder cleanup is best-effort.
// Accepts a stored (relative) path.
export function deleteVaultFolder(folderPath: string | null | undefined): void {
  if (!folderPath) return;
  const resolved = path.resolve(vaultAbs(folderPath));
  const root = path.resolve(VAULT_ROOT);
  if (resolved === root || !resolved.startsWith(root + path.sep)) return;
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to delete vault folder ${resolved}:`, err);
  }
}

// Публичные rename/move работают в относительной форме (старые пути — из БД;
// результат идёт обратно в БД и в rewriteVaultPaths). ФС резолвится внутри.
export function renameFolder(oldPath: string | null, newName: string): string {
  if (!oldPath || !fs.existsSync(vaultAbs(oldPath))) {
    throw new Error(`Cannot rename: source folder missing (${oldPath})`);
  }
  const absOld = vaultAbs(oldPath);
  const parent = path.dirname(absOld);
  const safe = sanitizeName(newName);
  // Pick a target that isn't already taken by a *different* sibling — renaming
  // onto an existing folder throws (EPERM/ENOTEMPTY on Windows) or would merge
  // into someone else's data. Renaming to the same path (e.g. a no-op rename or
  // a case-only change) is fine and skipped below.
  let newPath = path.join(parent, safe);
  for (let n = 2; newPath !== absOld && fs.existsSync(newPath); n++) {
    newPath = path.join(parent, `${safe}-${n}`);
  }
  if (absOld !== newPath) {
    fs.renameSync(absOld, newPath);
  }
  return vaultRel(newPath);
}

// Same idea as renameFolder, but moves into a different parent directory
// (re-parenting) instead of renaming within the current one — the basename
// stays the same, only the containing folder changes.
export function moveFolder(oldPath: string | null, newParentPath: string): string {
  if (!oldPath || !fs.existsSync(vaultAbs(oldPath))) {
    throw new Error(`Cannot move: source folder missing (${oldPath})`);
  }
  const absOld = vaultAbs(oldPath);
  const absParent = vaultAbs(newParentPath);
  const name = path.basename(absOld);
  let newPath = path.join(absParent, name);
  for (let n = 2; newPath !== absOld && fs.existsSync(newPath); n++) {
    newPath = path.join(absParent, `${name}-${n}`);
  }
  if (absOld !== newPath) {
    fs.renameSync(absOld, newPath);
  }
  return vaultRel(newPath);
}