import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { VAULT_ROOT, campaignFolder, sanitizeName, vaultAbs, vaultRel } from "./filesystem";
import { rewriteVaultPaths } from "./vaultPaths";

// Папка кампании живёт в хранилище, а в базе лежит её путь. Стоит удалить или
// перенести папку в проводнике — путь указывает в никуда, и всё, что пишет
// внутрь (переименование, загрузка картинок), падает. Приложение отличить
// «удалили» от «перенесли» не может, поэтому и говорит про оба случая сразу.
export const FOLDER_MISSING_ERROR = "Папки кампании нет в хранилище: создайте её заново в профиле кампании.";

/** Папки нет: путь пуст (старые базы, «Очистить» на «Здоровье») или его нет на
 *  диске. Для Мастера это одно состояние — файлы класть некуда. */
export function folderMissing(folderPath: string | null | undefined): boolean {
  if (!folderPath) return true;
  try {
    return !fs.statSync(vaultAbs(folderPath)).isDirectory();
  } catch {
    return true;
  }
}

/** Пути папок, уже занятых кампаниями (кроме одной — той, которую чиним). */
function usedFolders(exceptId?: number): Set<string> {
  const rows = db
    .prepare("SELECT id, folder_path FROM campaigns WHERE folder_path IS NOT NULL AND folder_path != ''")
    .all() as { id: number; folder_path: string }[];
  const out = new Set<string>();
  for (const r of rows) if (r.id !== exceptId) out.add(r.folder_path.toLowerCase());
  return out;
}

/** Папки в `Campaigns`, не привязанные ни к одной кампании: только их и можно
 *  предлагать в выборе, иначе две кампании писали бы в одни файлы. */
export function freeCampaignFolders(exceptId?: number): string[] {
  const base = path.join(VAULT_ROOT, "Campaigns");
  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(base, { withFileTypes: true });
  } catch {
    return [];
  }
  const used = usedFolders(exceptId);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => vaultRel(path.join(base, e.name)))
    .filter((rel) => !used.has(rel.toLowerCase()))
    .sort((a, b) => a.localeCompare(b, "ru"));
}

/** Привязать кампании папку. Пути детей (сессии, персонажи, картинки) ведут в
 *  старый корень — переписываем их, иначе они остались бы битыми. */
export function bindCampaignFolder(id: number, oldPath: string | null, newRel: string): void {
  if (oldPath && oldPath !== newRel) rewriteVaultPaths(oldPath, newRel);
  db.prepare("UPDATE campaigns SET folder_path = ? WHERE id = ?").run(newRel, id);
}

/**
 * Вернуть кампании папку. Если в `Campaigns` лежит свободная папка с её именем —
 * привязываем её: это случай «папку перенесли или переименовали руками», файлы
 * целы и вернутся вместе с ней. Иначе заводим пустую; создавать вторую папку
 * рядом с настоящей нельзя — та осталась бы сиротой навсегда.
 */
export function repairCampaignFolder(
  id: number,
  name: string,
  oldPath: string | null
): { folder: string; bound: boolean } {
  const candidate = vaultRel(path.join(VAULT_ROOT, "Campaigns", sanitizeName(name)));
  const free = !usedFolders(id).has(candidate.toLowerCase());
  let folder: string;
  let bound = false;
  if (free && fs.existsSync(vaultAbs(candidate))) {
    folder = candidate;
    bound = true;
  } else {
    folder = campaignFolder(name);
  }
  bindCampaignFolder(id, oldPath, folder);
  return { folder, bound };
}
