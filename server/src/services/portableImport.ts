import { randomUUID } from "crypto";
import { db } from "../db/db";
import {
  isCharacterUid,
  normalizeDndCharacter,
  parsePortableHtml,
  portableError,
  validatePortablePayload,
  PORTABLE_FORMAT,
  PORTABLE_MAX_HTML_BYTES,
} from "@soyman/shared";

// Разбор файла OneShot для импорта — общий у библиотеки игрока (новый
// персонаж, routes/player.ts) и экрана «Листа ещё нет» (лист в уже заведённого
// персонажа, routes/characters.ts).

const PORTABLE_AVATAR_MAX_BYTES = 15 * 1024 * 1024;
const PORTABLE_PORTRAIT_PATTERN = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/;

export interface PortableImportData {
  name: string;
  content: ReturnType<typeof normalizeDndCharacter>;
  portrait: { ext: string; buffer: Buffer } | null;
  characterUid: string;
  /** Portable slice system name (informational only — never imported as a catalog). */
  systemName: string | null;
}

export function portableHttpError(status: number, error: string): { status: number; error: string } {
  return { status, error };
}

/**
 * Файл OneShot: автономный HTML (`soyman-1shot-portable`) или резервная копия
 * JSON (`soyman-1shot-backup`, «Скачать резервную копию»). Копия сводится к
 * тому же payload и идёт той же проверкой — второго разборщика нет.
 */
function parsePortableText(text: string): ReturnType<typeof parsePortableHtml> {
  if (!text.trimStart().startsWith("{")) return parsePortableHtml(text);
  let doc: { format?: unknown; character?: { characterUid?: unknown } & Record<string, unknown>; catalog?: unknown };
  try {
    doc = JSON.parse(text);
  } catch {
    throw portableError("unsupported-file");
  }
  if (!doc || doc.format !== "soyman-1shot-backup" || !doc.character || typeof doc.character !== "object") {
    throw portableError("unsupported-file");
  }
  const { characterUid, ...character } = doc.character;
  const uid = isCharacterUid(characterUid) ? characterUid : null;
  return validatePortablePayload({
    format: PORTABLE_FORMAT,
    version: uid ? 2 : 1,
    ...(uid ? { identity: { characterUid: uid } } : {}),
    character,
    catalog: doc.catalog,
  });
}

export function parsePortableImport(html: unknown): PortableImportData {
  if (typeof html !== "string" || !html) {
    throw portableHttpError(400, "Это не файл персонажа SoyMan.");
  }
  if (html.length > PORTABLE_MAX_HTML_BYTES) {
    throw portableHttpError(413, "Файл персонажа повреждён или имеет неподдерживаемую версию.");
  }
  let parsed: ReturnType<typeof parsePortableHtml>;
  try {
    parsed = parsePortableText(html);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "unsupported-file") throw portableHttpError(400, "Это не файл персонажа SoyMan.");
    if (code === "invalid-character" || code === "invalid-catalog") {
      throw portableHttpError(422, "Не удалось восстановить игровые данные персонажа.");
    }
    throw portableHttpError(422, "Файл персонажа повреждён или имеет неподдерживаемую версию.");
  }
  // Same gate as the 1shot JSON restore: classes + abilities, then the
  // shared normalization. normalizeDndCharacter never throws (it repairs),
  // so the structural check above is the real validator.
  const raw = parsed.content as { classes?: unknown; abilities?: unknown } | null;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.classes) || !raw.abilities) {
    throw portableHttpError(422, "Не удалось восстановить игровые данные персонажа.");
  }
  // Portrait through the standard avatar path: dataURL -> buffer, same size
  // cap as uploads. Decoded here so every action shares the validation.
  let portrait: PortableImportData["portrait"] = null;
  if (parsed.portrait) {
    const match = PORTABLE_PORTRAIT_PATTERN.exec(parsed.portrait);
    if (!match) throw portableHttpError(422, "Не удалось восстановить игровые данные персонажа.");
    const buffer = Buffer.from(match[2], "base64");
    if (buffer.length > PORTABLE_AVATAR_MAX_BYTES) {
      throw portableHttpError(413, "Портрет в файле слишком большой.");
    }
    portrait = { ext: match[1] === "jpeg" ? ".jpg" : `.${match[1]}`, buffer };
  }
  // The portable slice is informational only and is never imported as a
  // global catalog. Callers match the global system by name when it lines up.
  const systemName = (parsed.catalog.system as { name?: unknown } | undefined)?.name;
  return {
    name: parsed.name,
    content: normalizeDndCharacter(raw),
    portrait,
    // v2 UID travels on; v1 mints a fresh one (zero owned matches follow).
    characterUid: isCharacterUid(parsed.characterUid) ? parsed.characterUid : randomUUID(),
    systemName: typeof systemName === "string" && systemName ? systemName : null,
  };
}

export function matchSystemId(systemName: unknown): number | null {
  if (typeof systemName !== "string" || !systemName) return null;
  const system = db
    .prepare("SELECT id FROM systems WHERE lower(name) = lower(?) AND archived_at IS NULL")
    .get(systemName) as { id: number } | undefined;
  return system?.id ?? null;
}
