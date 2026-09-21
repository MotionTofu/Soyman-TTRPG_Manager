/**
 * Import boundaries shared kernel (§40 ТЗ 2F): shared не импортирует
 * client/server/React/Canvas/DOM/Vite-only API. Runtime-циклы отсутствуют:
 * kernel-модули ссылаются только друг на друга.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const FORBIDDEN: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /from\s+["']react["']|from\s+["']react-dom["']/, reason: "React" },
  // `document` как имя переменной/поля (document.grid) легально — ловим
  // только настоящие DOM-обращения к глобалу.
  { pattern: /\bwindow\b|\bdocument\s*\.\s*(createElement|querySelector|querySelectorAll|getElementById|getElementsBy|addEventListener|removeEventListener|body|head|title|cookie)\b|\bHTMLCanvasElement\b|\bCanvasRenderingContext2D\b|\bgetComputedStyle\b|\blocalStorage\b|\bnavigator\b/, reason: "DOM/Canvas" },
  { pattern: /import\.meta/, reason: "Vite-only import.meta" },
  { pattern: /from\s+["'][^"']*client\/src\//, reason: "client/src import" },
  { pattern: /from\s+["']\.\.\/\.\.\/(?!maps\/)/, reason: "import outside maps (server?)" },
  { pattern: /\.tsx?["']/, reason: ".tsx import" },
  { pattern: /from\s+["']\.\.\/render["']|from\s+["']\.\.\/\.\.\/render["']/, reason: "legacy render.ts" },
  { pattern: /MapCells/, reason: "legacy MapCells in kernel" },
];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      out.push(full);
    }
  }
  return out;
}

describe("shared kernel boundaries", () => {
  it("no forbidden imports in shared maps core", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(HERE)) {
      const text = fs.readFileSync(file, "utf8");
      const lines = text.split("\n");
      lines.forEach((line, i) => {
        const stripped = line.trim().startsWith("//") || line.trim().startsWith("*") ? "" : line;
        for (const { pattern, reason } of FORBIDDEN) {
          if (pattern.test(stripped)) {
            offenders.push(`${path.basename(file)}:${i + 1} [${reason}] ${line.trim().slice(0, 80)}`);
          }
        }
      });
    }
    expect(offenders).toEqual([]);
  });
});
