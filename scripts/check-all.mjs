#!/usr/bin/env node
/**
 * Общие ворота перед слиянием и приёмкой: `npm run check`.
 *
 * ЗАЧЕМ. Каждый блок «Д» заново писал свои verify-merge.py / design-checks.cjs /
 * check-stand.cjs и в каждом отчёте доказывал «падения прежние». С 2026-11-04
 * все проверки зелёные, поэтому достаточно одной команды: всё прошло — можно
 * сливать, что-то упало — это новое.
 *
 * Что гоняется, по порядку (без пайпов — код возврата настоящий):
 *   tsc клиента (tsconfig.app.json: `tsc --noEmit` в client/ пустой), tsc
 *   сервера, `npm run lint` клиента (oxlint + барьеры), тесты клиента и сервера.
 *
 * Чужие незакоммиченные файлы:
 *   node scripts/check-all.mjs --snapshot   до работы: запомнить их содержимое
 *   node scripts/check-all.mjs --compare    после: какие из них изменились
 * Снимок — `.scratch/foreign-snapshot.json` (не в git). Нужен, когда в общей
 * копии работают несколько сессий: свою правку в чужом файле видно сразу.
 *
 *   --quick   без тестов (типы и lint, ~2 мин вместо ~10)
 */
import { spawnSync, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const SNAPSHOT = path.join(root, ".scratch", "foreign-snapshot.json");

function dirtyFiles() {
  const out = execFileSync("git", ["status", "--porcelain", "-z", "--untracked-files=all"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean).map((l) => l.slice(3)).filter((f) => !f.startsWith(".scratch/"));
}
const hashOf = (f) => {
  const p = path.join(root, f);
  return existsSync(p) ? createHash("sha1").update(readFileSync(p)).digest("hex") : "deleted";
};

if (args.has("--snapshot")) {
  const files = Object.fromEntries(dirtyFiles().map((f) => [f, hashOf(f)]));
  mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
  writeFileSync(SNAPSHOT, JSON.stringify({ at: new Date().toISOString(), files }, null, 2));
  console.log(`Снимок: ${Object.keys(files).length} незакоммиченных файлов → ${path.relative(root, SNAPSHOT)}`);
  process.exit(0);
}

if (args.has("--compare")) {
  if (!existsSync(SNAPSHOT)) {
    console.error("Снимка нет — сначала node scripts/check-all.mjs --snapshot");
    process.exit(2);
  }
  const { at, files } = JSON.parse(readFileSync(SNAPSHOT, "utf8"));
  const changed = Object.entries(files).filter(([f, h]) => hashOf(f) !== h).map(([f]) => f);
  const fresh = dirtyFiles().filter((f) => !(f in files));
  console.log(`Снимок от ${at}.`);
  console.log(changed.length ? `Изменились чужие файлы (${changed.length}):\n  ${changed.join("\n  ")}` : "Чужие файлы не тронуты.");
  if (fresh.length) console.log(`Новые незакоммиченные (${fresh.length}) — свои?\n  ${fresh.join("\n  ")}`);
  process.exit(changed.length ? 1 : 0);
}

const steps = [
  ["tsc клиента", "client", ["npx", "tsc", "-p", "tsconfig.app.json", "--noEmit"]],
  ["tsc сервера", "server", ["npx", "tsc", "--noEmit"]],
  ["lint клиента", "client", ["npm", "run", "lint", "--silent"]],
  ...(args.has("--quick")
    ? []
    : [
        ["тесты клиента", "client", ["npx", "vitest", "run", "--reporter=dot"]],
        ["тесты сервера", "server", ["npx", "vitest", "run", "--reporter=dot"]],
      ]),
];

const results = [];
for (const [name, dir, [cmd, ...rest]] of steps) {
  const started = Date.now();
  console.log(`\n▶ ${name}`);
  const r = spawnSync(cmd, rest, { cwd: path.join(root, dir), stdio: "inherit", shell: true });
  results.push({ name, ok: r.status === 0, sec: Math.round((Date.now() - started) / 1000) });
}

console.log("\nИтог:");
for (const r of results) console.log(`  ${r.ok ? "✓" : "✗"} ${r.name} (${r.sec} с)`);
process.exit(results.every((r) => r.ok) ? 0 : 1);
