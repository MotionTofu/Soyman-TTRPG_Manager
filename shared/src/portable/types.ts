/**
 * Portable character format — единый контейнер обмена между SoyMan_1shot,
 * standalone HTML и основным SoyMan (фаза B2.1).
 *
 * Чистый строковый парсер: без DOM, без исполнения скриптов, без Node API.
 * Сервер и оба клиента делят именно этот модуль — второго парсера нет.
 *
 * Типы живут в ./parse рядом с реализацией (модуль без импортов — один
 * исходник грузят vite, tsc и node --test). Здесь только type-реэкспорт;
 * значений тут нет, чтобы не конфликтовать с `export *` в index.
 */
export type {
  PortableErrorCode,
  PortableError,
  PortableCatalogContainer,
  ValidatedPortablePayload,
} from "./parse";
