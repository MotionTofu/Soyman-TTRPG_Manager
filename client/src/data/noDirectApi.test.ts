import { describe, expect, it } from "vitest";

/**
 * Сторож слоя данных (docs/adr/0001, п. 8). Страницы и компоненты читают и
 * пишут через слой — `useResource`, `useEntity`, `write`, `readResource` и
 * помощники `resourceQuery`/`entityQuery` для `useQueries`, — а не прямым
 * `api` транспорта. Прямой вызов — это второй кэш мимо слоя: другие окна о
 * правке не узнают, а открытая страница не увидит чужую. Перезагрузки окна
 * по сигналу, которая раньше это прикрывала, больше нет.
 */

const sources = import.meta.glob(["../pages/**/*.{ts,tsx}", "../components/**/*.{ts,tsx}", "!**/*.test.*"], {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Исключения — с причиной. Исключение, которому больше не нужен `api`, тест тоже ловит. */
const ALLOWED: Record<string, string> = {
  // Кэш записей компендиума листа: пачкой читает записи и сам кладёт их под
  // ключи слоя (`["entity", "compendium_entry", id]`).
  "../components/dnd/entryCache.ts": "пачка записей под ключами слоя",
  // В файле незакоммиченные правки владельца; переводится после них.
  "../components/dnd/DndLevelUpWizard.tsx": "ждёт правок владельца",
};

const IMPORTS_API = /import\s*\{[^}]*\bapi\b[^}]*\}\s*from\s*["'](\.\.\/)+api\/client["']/;

describe("сторож слоя данных", () => {
  it("страницы и компоненты не импортируют транспорт `api` напрямую", () => {
    const offenders = Object.entries(sources)
      .filter(([path, text]) => !(path in ALLOWED) && IMPORTS_API.test(text))
      .map(([path]) => path);
    expect(offenders).toEqual([]);
  });

  it("исключения ещё нужны", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(100);
    const stale = Object.keys(ALLOWED).filter((path) => !sources[path] || !IMPORTS_API.test(sources[path]));
    expect(stale).toEqual([]);
  });
});
