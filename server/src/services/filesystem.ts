import fs from "fs";
import path from "path";
import { execFile } from "child_process";
import { resizeImageBuffer, type ImageSizePreset } from "./imageResize";
import { storeDeduped } from "./vaultDedup";

export let VAULT_ROOT = process.env.VAULT_ROOT || "E:\\RPG-Vault";

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
function freshDir(base: string, name: string): string {
  const safe = sanitizeName(name);
  let candidate = path.join(base, safe);
  for (let n = 2; fs.existsSync(candidate); n++) {
    candidate = path.join(base, `${safe}-${n}`);
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

export function campaignFolder(name: string): string {
  return freshDir(path.join(VAULT_ROOT, "Campaigns"), name);
}

export function settingFolder(name: string): string {
  return freshDir(path.join(VAULT_ROOT, "Settings"), name);
}

export function systemFolder(name: string): string {
  return freshDir(path.join(VAULT_ROOT, "Systems"), name);
}

export function playerFolder(name: string): string {
  return freshDir(path.join(VAULT_ROOT, "Players"), name);
}

export function sessionFolder(campaignFolderPath: string, date: string): string {
  const base = freshDir(path.join(campaignFolderPath, "Sessions"), date);
  ensureDir(path.join(base, "resources"));
  ensureDir(path.join(base, "handouts"));
  ensureDir(path.join(base, "map"));
  return base;
}

export function characterFolder(campaignFolderPath: string, characterName: string): string {
  return freshDir(path.join(campaignFolderPath, "Characters"), characterName);
}

// Standalone (not tied to any campaign) character, created by a player from
// player-app's "Персонажи" section — lives under the player's own vault
// folder instead of a campaign's.
export function standaloneCharacterFolder(playerFolderPath: string, characterName: string): string {
  return freshDir(path.join(playerFolderPath, "Characters"), characterName);
}

export function campaignPlayerSectionFolder(campaignFolderPath: string, name: string): string {
  return freshDir(path.join(campaignFolderPath, "ForPlayers"), name);
}

const WORLD_EXPLORATION_KIND_FOLDERS: Record<string, string> = {
  being: "Существа",
  location: "Локации",
  item: "Предметы",
  event: "События",
};

export function worldExplorationEntryFolder(campaignFolderPath: string, kind: string, name: string): string {
  const kindFolder = WORLD_EXPLORATION_KIND_FOLDERS[kind] ?? "Прочее";
  return freshDir(path.join(campaignFolderPath, "WorldExploration", kindFolder), name);
}

export function locationFolder(parentFolderPath: string, name: string): string {
  return freshDir(parentFolderPath, name);
}

export function settingGeographyRoot(settingFolderPath: string): string {
  return ensureDir(path.join(settingFolderPath, "Geography"));
}

export function beingFolder(settingFolderPath: string, name: string): string {
  return freshDir(path.join(settingFolderPath, "Population"), name);
}

export function communityFolder(settingFolderPath: string, name: string): string {
  return freshDir(path.join(settingFolderPath, "Population", "Communities"), name);
}

export function artifactFolder(settingFolderPath: string, name: string): string {
  return freshDir(path.join(settingFolderPath, "Artifacts"), name);
}

export function knowledgeFolder(systemName: string): string {
  return ensureDir(
    path.join(VAULT_ROOT, "Mastering", "Knowledge", sanitizeName(systemName))
  );
}

export function ensureSubfolder(basePath: string, sub: string): string {
  return ensureDir(path.join(basePath, sub));
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
  if (oldPath && oldPath !== newPath && fs.existsSync(oldPath)) {
    try {
      fs.unlinkSync(oldPath);
    } catch (err) {
      console.error(`Failed to remove old file ${oldPath}:`, err);
    }
  }
  const finalBuffer = resize ? await resizeImageBuffer(buffer, resize) : buffer;
  await storeDeduped(finalBuffer, newPath);
}

// Reveals `target` in the OS file explorer — either the file itself
// (highlighted in its containing folder, when `selectFile` is true) or the
// folder itself. Runs on the same machine as the vault, so shelling out
// locally is safe here — this is a desktop tool, not a public server.
export function openInFileExplorer(target: string, selectFile: boolean): void {
  if (process.platform === "win32") {
    execFile("explorer.exe", [selectFile ? `/select,${target}` : target], () => {
      // explorer.exe returns a non-zero exit code even on success — ignore.
    });
  } else if (process.platform === "darwin") {
    execFile("open", selectFile ? ["-R", target] : [target], () => {});
  } else {
    execFile("xdg-open", [selectFile ? path.dirname(target) : target], () => {});
  }
}

export function toFileUrl(absolutePath: string): string {
  const relative = path.relative(VAULT_ROOT, absolutePath).split(path.sep).join("/");
  return `/files/${relative}`;
}

// Best-effort recursive removal of an entity's folder, used only by permanent
// (post-archive) deletion. Two hard safety rails: the target must resolve to a
// path *strictly inside* the current vault, and must not be the vault root
// itself — so a null/stale/malformed folder_path can never nuke the vault or
// anything outside it. Failure (a Windows file lock, say) is logged, not
// thrown: the DB row is already gone and folder cleanup is best-effort.
export function deleteVaultFolder(folderPath: string | null | undefined): void {
  if (!folderPath) return;
  const resolved = path.resolve(folderPath);
  const root = path.resolve(VAULT_ROOT);
  if (resolved === root || !resolved.startsWith(root + path.sep)) return;
  try {
    fs.rmSync(resolved, { recursive: true, force: true });
  } catch (err) {
    console.error(`Failed to delete vault folder ${resolved}:`, err);
  }
}

export function renameFolder(oldPath: string | null, newName: string): string {
  if (!oldPath || !fs.existsSync(oldPath)) {
    throw new Error(`Cannot rename: source folder missing (${oldPath})`);
  }
  const parent = path.dirname(oldPath);
  const safe = sanitizeName(newName);
  // Pick a target that isn't already taken by a *different* sibling — renaming
  // onto an existing folder throws (EPERM/ENOTEMPTY on Windows) or would merge
  // into someone else's data. Renaming to the same path (e.g. a no-op rename or
  // a case-only change) is fine and skipped below.
  let newPath = path.join(parent, safe);
  for (let n = 2; newPath !== oldPath && fs.existsSync(newPath); n++) {
    newPath = path.join(parent, `${safe}-${n}`);
  }
  if (oldPath !== newPath) {
    fs.renameSync(oldPath, newPath);
  }
  return newPath;
}

// Same idea as renameFolder, but moves into a different parent directory
// (re-parenting) instead of renaming within the current one — the basename
// stays the same, only the containing folder changes.
export function moveFolder(oldPath: string | null, newParentPath: string): string {
  if (!oldPath || !fs.existsSync(oldPath)) {
    throw new Error(`Cannot move: source folder missing (${oldPath})`);
  }
  const name = path.basename(oldPath);
  let newPath = path.join(newParentPath, name);
  for (let n = 2; newPath !== oldPath && fs.existsSync(newPath); n++) {
    newPath = path.join(newParentPath, `${name}-${n}`);
  }
  if (oldPath !== newPath) {
    fs.renameSync(oldPath, newPath);
  }
  return newPath;
}
