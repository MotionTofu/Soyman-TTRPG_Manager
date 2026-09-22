/**
 * Извлечение и структурная валидация portable payload из HTML-текста.
 *
 * HTML — только контейнер данных: исполняется ноль скриптов, ищется только
 * известный маркер экспортёра (`oneshot-payload`), который пишет
 * SoyMan_1shot/build-standalone.mjs через renderPortable.
 *
 * Точность маркера: renderPortable экранирует каждый `<` внутри JSON как
 * `\u003c`, поэтому литеральный `</script` внутри payload невозможен — первый
 * `</script>` после маркера всегда конец контейнера.
 *
 * Модуль намеренно без импортов: один и тот же исходник грузят vite
 * (браузер), tsc (серверный dist) и node --test (type-stripping) без
 * резолва зависимостей. Типы для внешних потребителей — в ./types.
 */

export const PORTABLE_FORMAT = "soyman-1shot-portable" as const;
/** Последняя пишущая версия. Импорт принимает 1 и 2 (см. validate). */
export const PORTABLE_VERSION = 2;
/** Экспорт ~4–5 МБ; отсекает гигантские произвольные файлы до парсинга. */
export const PORTABLE_MAX_HTML_BYTES = 64 * 1024 * 1024;

export type PortableErrorCode =
  | "unsupported-file"
  | "unsupported-version"
  | "damaged-payload"
  | "invalid-character"
  | "invalid-catalog";

export interface PortableError extends Error {
  code: PortableErrorCode;
}

export interface PortableCatalogContainer {
  system?: unknown;
  sections?: unknown;
  entries?: unknown;
}

export interface ValidatedPortablePayload {
  /** Display name: content.characterName → character.name → fallback. */
  name: string;
  /** Сырой content; глубокую нормализацию делает вызывающая сторона. */
  content: unknown;
  /** dataURL портрета или null. */
  portrait: string | null;
  /** Сырой catalog slice; глубокую проверку делает вызывающая сторона. */
  catalog: PortableCatalogContainer;
  /** Stable UID (v2) или null (v1). */
  characterUid: string | null;
}

const PAYLOAD_OPEN = '<script id="oneshot-payload" type="application/json">';
const PAYLOAD_CLOSE = "</script>";
const PORTRAIT_PATTERN = /^data:image\/(png|jpeg|webp);base64,/;

export function portableError(code: PortableErrorCode, detail?: string): PortableError {
  const error = new Error(detail || code) as PortableError;
  error.code = code;
  return error;
}

export function isCharacterUid(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

export function isSupportedPortrait(value: unknown): value is string {
  return typeof value === "string" && PORTRAIT_PATTERN.test(value);
}

/**
 * Сырой JSON-текст payload. Бросает `unsupported-file`, если известного
 * контейнера экспортёра нет — структура страницы не угадывается.
 */
export function extractPortablePayload(htmlText: string): string {
  if (typeof htmlText !== "string") {
    throw portableError("unsupported-file", "Это не файл персонажа SoyMan.");
  }
  const start = htmlText.indexOf(PAYLOAD_OPEN);
  if (start === -1) throw portableError("unsupported-file", "Это не файл персонажа SoyMan.");
  const end = htmlText.indexOf(PAYLOAD_CLOSE, start + PAYLOAD_OPEN.length);
  if (end === -1) throw portableError("unsupported-file", "Это не файл персонажа SoyMan.");
  return htmlText.slice(start + PAYLOAD_OPEN.length, end);
}

function resolvePortableName(character: { name?: unknown; content?: unknown }): string {
  const content = (character.content ?? {}) as { characterName?: unknown };
  if (typeof content.characterName === "string" && content.characterName.trim()) return content.characterName;
  if (typeof character.name === "string" && character.name.trim()) return character.name;
  return "Импортированный персонаж";
}

/**
 * Структурная валидация распарсенного payload. Глубокие проверки —
 * на вызывающей стороне существующими механизмами (normalizeDndCharacter,
 * parseCatalog): этот модуль не знает ни IDB, ни серверной схемы.
 * Ничего не сохраняет; бросает кодированные ошибки.
 */
export function validatePortablePayload(payload: unknown): ValidatedPortablePayload {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw portableError("damaged-payload", "Файл персонажа повреждён или имеет неподдерживаемую версию.");
  }
  const doc = payload as Record<string, unknown>;
  if (doc["format"] !== PORTABLE_FORMAT) {
    throw portableError("unsupported-file", "Это не файл персонажа SoyMan.");
  }
  // v1 без identity импортируется как новый персонаж; v2 несёт
  // identity.characterUid. Остальное не поддерживается.
  let characterUid: string | null = null;
  if (doc["version"] === 2) {
    const identity = doc["identity"];
    if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
      throw portableError("damaged-payload", "Файл персонажа повреждён или имеет неподдерживаемую версию.");
    }
    const uid = (identity as Record<string, unknown>)["characterUid"];
    if (!isCharacterUid(uid)) {
      throw portableError("damaged-payload", "Файл персонажа повреждён или имеет неподдерживаемую версию.");
    }
    characterUid = uid;
  } else if (doc["version"] !== 1) {
    throw portableError("unsupported-version", "Файл персонажа повреждён или имеет неподдерживаемую версию.");
  }
  const character = doc["character"];
  if (!character || typeof character !== "object" || Array.isArray(character)) {
    throw portableError("damaged-payload", "Файл персонажа повреждён или имеет неподдерживаемую версию.");
  }
  const container = character as Record<string, unknown>;
  const content = container["content"];
  if (!content || typeof content !== "object" || Array.isArray(content)) {
    throw portableError("invalid-character", "Не удалось восстановить игровые данные персонажа.");
  }
  const portraitValue: unknown = container["portrait"] ?? null;
  let portrait: string | null = null;
  if (portraitValue !== null) {
    if (!isSupportedPortrait(portraitValue)) {
      throw portableError("invalid-character", "Не удалось восстановить игровые данные персонажа.");
    }
    portrait = portraitValue;
  }
  const catalog = doc["catalog"];
  if (!catalog || typeof catalog !== "object" || Array.isArray(catalog)) {
    throw portableError("invalid-catalog", "Не удалось восстановить игровые данные персонажа.");
  }
  return {
    name: resolvePortableName(container as { name?: unknown; content?: unknown }),
    content,
    portrait,
    catalog: catalog as PortableCatalogContainer,
    characterUid,
  };
}

/** Полный конвейер: текст HTML → проверенные данные импорта. */
export function parsePortableHtml(htmlText: string): ValidatedPortablePayload {
  const raw = extractPortablePayload(htmlText);
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    throw portableError("damaged-payload", "Файл персонажа повреждён или имеет неподдерживаемую версию.");
  }
  return validatePortablePayload(payload);
}
