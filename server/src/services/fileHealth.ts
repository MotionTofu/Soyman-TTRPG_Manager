import fs from "fs";
import path from "path";
import { db } from "../db/db";
import { toFileUrl, VAULT_ROOT } from "../services/filesystem";

// Проверка и починка путей к файлам — общая для всех ресурсов, а не только
// для звуков. Первым заказчиком был пульт («кнопка погашена, файл не
// найден»), но `file_path` есть и у карт, и у раздаток, и «карта не
// открывается» бьёт по игре не слабее пропавшего звука. Поэтому механизм
// живёт отдельным сервисом: раздел «Здоровье» (см. later.md) вызовет его же.

export interface MissingFile {
  resource_id: number;
  name: string;
  type: string | null;
  audio_role: string | null;
  file_path: string;
  file_name: string;
}

interface ResourceFileRow {
  id: number;
  name: string;
  type: string | null;
  audio_role: string | null;
  file_path: string;
}

function allResourceFiles(): ResourceFileRow[] {
  return db
    .prepare(
      `SELECT id, name, type, audio_role, file_path
       FROM resources
       WHERE file_path IS NOT NULL AND file_path <> '' AND archived_at IS NULL`
    )
    .all() as ResourceFileRow[];
}

// Один проход по всем ресурсам с файлом. Это `fs.existsSync` на N путей —
// дёшево даже на тысячах строк; дорогой обход хранилища в поисках
// осиротевших файлов сюда сознательно не входит и остаётся за кнопкой в
// будущем разделе «Здоровье».
export function findMissingFiles(): MissingFile[] {
  const missing: MissingFile[] = [];
  for (const row of allResourceFiles()) {
    if (fs.existsSync(row.file_path)) continue;
    missing.push({
      resource_id: row.id,
      name: row.name,
      type: row.type,
      audio_role: row.audio_role,
      file_path: row.file_path,
      file_name: path.basename(row.file_path),
    });
  }
  return missing;
}

export function isMissing(filePath: string | null | undefined): boolean {
  if (!filePath) return false;
  return !fs.existsSync(filePath);
}

export type MatchStrength = "name_and_size" | "name_only";

export interface RelinkCandidate {
  resource_id: number;
  name: string;
  type: string | null;
  file_name: string;
  old_path: string;
  new_path: string;
  match: MatchStrength;
}

// После того как один файл указали руками, остальные пропавшие ищутся в той
// же папке по имени файла. Совпадение размера повышает уверенность;
// аудиотеги не читаем — у скачанных эмбиентов их обычно просто нет, и
// возиться с разбором ради ненадёжного признака незачем.
//
// Найденное не применяется само: одноимённый файл из чужой библиотеки
// подменил бы звук незаметно, и обнаружилось бы это на игре. Поэтому
// кандидаты только возвращаются — решает человек, отметками.
export function findRelinkCandidates(folder: string, excludeResourceId?: number): RelinkCandidate[] {
  let entries: string[];
  try {
    entries = fs.readdirSync(folder);
  } catch {
    return [];
  }
  const byName = new Map<string, string>();
  for (const entry of entries) byName.set(entry.toLowerCase(), path.join(folder, entry));

  const candidates: RelinkCandidate[] = [];
  for (const row of allResourceFiles()) {
    if (excludeResourceId != null && row.id === excludeResourceId) continue;
    if (fs.existsSync(row.file_path)) continue;
    const fileName = path.basename(row.file_path);
    const found = byName.get(fileName.toLowerCase());
    if (!found) continue;

    // Размер исходника взять неоткуда — файла нет. Поэтому «имя + размер»
    // означает, что размер совпал с тем, что помнит запись ресурса, если он
    // там есть; иначе честно говорим «только имя».
    let match: MatchStrength = "name_only";
    const known = db
      .prepare("SELECT size_bytes FROM resource_file_sizes WHERE resource_id = ?")
      .get(row.id) as { size_bytes: number } | undefined;
    if (known) {
      try {
        if (fs.statSync(found).size === known.size_bytes) match = "name_and_size";
      } catch {
        /* файл исчез между readdir и stat — остаётся «только имя» */
      }
    }

    candidates.push({
      resource_id: row.id,
      name: row.name,
      type: row.type,
      file_name: fileName,
      old_path: row.file_path,
      new_path: found,
      match,
    });
  }
  return candidates;
}

export function relinkResource(resourceId: number, newPath: string): void {
  db.prepare("UPDATE resources SET file_path = ? WHERE id = ?").run(newPath, resourceId);
  rememberFileSize(resourceId, newPath);
}

// Размер запоминается при каждой удачной привязке — только он потом и даёт
// подтверждение «имя + размер». Без этой памяти любое совпадение осталось бы
// «только по имени», то есть таким, которому нельзя верить молча.
export function rememberFileSize(resourceId: number, filePath: string): void {
  try {
    const size = fs.statSync(filePath).size;
    db.prepare(
      `INSERT INTO resource_file_sizes (resource_id, size_bytes) VALUES (?, ?)
       ON CONFLICT(resource_id) DO UPDATE SET size_bytes = excluded.size_bytes`
    ).run(resourceId, size);
  } catch {
    /* нечего запоминать */
  }
}

// Файл под хранилищем отдаётся статикой /files. Указать новое место можно и
// вне хранилища — библиотеку звуков на сотни мегабайт незачем копировать
// внутрь, — и такие файлы идут через /api/files/raw/:id, который умеет
// ровно то, что дословно записано в file_path. Обход каталогов там
// невозможен: путь не собирается из запроса, а берётся из базы.
export function fileSrc(resourceId: number, filePath: string | null): string | null {
  if (!filePath) return null;
  const relative = path.relative(VAULT_ROOT, filePath);
  const inside = relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
  return inside ? toFileUrl(filePath) : `/api/files/raw/${resourceId}`;
}
