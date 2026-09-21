/**
 * Import boundaries shared kernel (§40 ТЗ 2F): shared не импортирует
 * client/server/React/Canvas/DOM/Vite-only API. Runtime-циклы отсутствуют:
 * kernel-модули ссылаются только друг на друга.
 * Исходники читаются через import.meta.glob ?raw (без node:fs — пакет
 * собирается без @types/node).
 */
import { describe, expect, it } from "vitest";

const sources = import.meta.glob("./*.ts", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+["']react["']|from\s+["']react-dom["']/, reason: "React" },
  // `document` как имя переменной/поля (document.grid) легально — ловим
  // только настоящие DOM-обращения к глобалу.
  { pattern: /\bwindow\b|\bdocument\s*\.\s*(createElement|querySelector|querySelectorAll|getElementById|getElementsBy|addEventListener|removeEventListener|body|head|title|cookie)\b|\bHTMLCanvasElement\b|\bCanvasRenderingContext2D\b|\bgetComputedStyle\b|\blocalStorage\b|\bnavigator\b/, reason: "DOM/Canvas" },
  { pattern: /from\s+["'][^"']*client\/src\//, reason: "client/src import" },
  { pattern: /from\s+["']\.\.\/\.\.\/(?!maps\/)/, reason: "import outside maps (server?)" },
  { pattern: /\.tsx?["']/, reason: ".tsx import" },
  { pattern: /from\s+["']\.\.\/render["']|from\s+["']\.\.\/\.\.\/render["']/, reason: "legacy render.ts" },
  { pattern: /MapCells/, reason: "legacy MapCells in kernel" },
];

describe("shared kernel boundaries", () => {
  it("no forbidden imports in shared maps core", () => {
    expect(Object.keys(sources).length).toBeGreaterThan(5);
    const offenders: string[] = [];
    for (const [file, text] of Object.entries(sources)) {
      if (file.endsWith(".test.ts")) continue;
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const stripped = line.trim().startsWith("//") || line.trim().startsWith("*") ? "" : line;
        for (const { pattern, reason } of FORBIDDEN) {
          if (pattern.test(stripped)) {
            offenders.push(`${file.split("/").pop()}:${i + 1} [${reason}] ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
