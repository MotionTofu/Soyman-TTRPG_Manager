// Собирает лицензии сторонних пакетов, которые уезжают в сборке, и пишет
// THIRD-PARTY-LICENSES.md в корне репозитория.
//
// Зачем: PolyForm и большинство лицензий зависимостей (MIT, ISC, BSD, Apache)
// требуют, чтобы копия условий и уведомление об авторстве ехали вместе с
// программой. Руками этот список не поддерживается — он пересобирается.
//
// Usage: npm run licenses
//
// Обходит server/node_modules и client/node_modules целиком: в сборку уезжает
// весь server/node_modules (см. extraResources), а код клиента бандлится
// Vite'ом, поэтому его зависимости тоже распространяются — в собранном виде.

const fs = require("fs");
const path = require("path");

const repoRoot = path.join(__dirname, "..");
const ROOTS = [
  { label: "server", dir: path.join(repoRoot, "server", "node_modules") },
  { label: "client", dir: path.join(repoRoot, "client", "node_modules") },
];

const LICENSE_FILE_RE = /^(LICENSE|LICENCE|COPYING|NOTICE)(\..*)?$/i;

/** Пакеты в node_modules лежат либо как `name`, либо как `@scope/name`. */
function listPackageDirs(nodeModulesDir) {
  if (!fs.existsSync(nodeModulesDir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === ".bin" || entry.name === ".cache") continue;
    const full = path.join(nodeModulesDir, entry.name);
    if (entry.name.startsWith("@")) {
      for (const sub of fs.readdirSync(full, { withFileTypes: true })) {
        if (sub.isDirectory()) out.push(path.join(full, sub.name));
      }
    } else {
      out.push(full);
    }
    // Вложенные node_modules — тоже часть поставки.
    const nested = path.join(full, "node_modules");
    if (fs.existsSync(nested)) out.push(...listPackageDirs(nested));
  }
  return out;
}

function readLicenseText(pkgDir) {
  let file;
  try {
    file = fs.readdirSync(pkgDir).find((f) => LICENSE_FILE_RE.test(f));
  } catch {
    return null;
  }
  if (!file) return null;
  const full = path.join(pkgDir, file);
  try {
    if (!fs.statSync(full).isFile()) return null;
    return fs.readFileSync(full, "utf-8").trim();
  } catch {
    return null;
  }
}

function licenseId(pkg) {
  if (typeof pkg.license === "string") return pkg.license;
  if (pkg.license && typeof pkg.license.type === "string") return pkg.license.type;
  if (Array.isArray(pkg.licenses)) return pkg.licenses.map((l) => l.type || l).join(" OR ");
  return "не указана";
}

const collected = new Map(); // "name@version" -> запись

for (const root of ROOTS) {
  for (const dir of listPackageDirs(root.dir)) {
    let pkg;
    try {
      pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
    } catch {
      continue;
    }
    if (!pkg.name || !pkg.version) continue;
    const key = `${pkg.name}@${pkg.version}`;
    const existing = collected.get(key);
    if (existing) {
      if (!existing.where.includes(root.label)) existing.where.push(root.label);
      continue;
    }
    collected.set(key, {
      name: pkg.name,
      version: pkg.version,
      license: licenseId(pkg),
      homepage: pkg.homepage || (pkg.repository && (pkg.repository.url || pkg.repository)) || "",
      text: readLicenseText(dir),
      where: [root.label],
    });
  }
}

const entries = [...collected.values()].sort((a, b) =>
  a.name.localeCompare(b.name) || a.version.localeCompare(b.version)
);

const byLicense = new Map();
for (const e of entries) byLicense.set(e.license, (byLicense.get(e.license) || 0) + 1);

const missing = entries.filter((e) => !e.text);

const lines = [];
lines.push("# Лицензии сторонних компонентов");
lines.push("");
lines.push("Файл сгенерирован `npm run licenses` — править руками не нужно.");
lines.push("");
lines.push("Список намеренно избыточен: в него попадают все пакеты из `node_modules`");
lines.push("сервера и клиента, включая сборочные, которые в готовое приложение не");
lines.push("уезжают. Лишнее уведомление безвредно, пропущенное — нарушение.");
lines.push("");
lines.push(`Пакетов: **${entries.length}**. Дата сборки списка: ${new Date().toISOString().slice(0, 10)}.`);
lines.push("");
lines.push("## Сводка по лицензиям");
lines.push("");
lines.push("| Лицензия | Пакетов |");
lines.push("| --- | ---: |");
for (const [lic, count] of [...byLicense.entries()].sort((a, b) => b[1] - a[1])) {
  lines.push(`| ${lic} | ${count} |`);
}
lines.push("");
if (missing.length) {
  lines.push("## Без файла лицензии в пакете");
  lines.push("");
  lines.push("У этих пакетов идентификатор лицензии объявлен в `package.json`, но");
  lines.push("отдельного файла с текстом в поставке нет — текст берётся по идентификатору.");
  lines.push("");
  for (const e of missing) lines.push(`- ${e.name}@${e.version} — ${e.license}`);
  lines.push("");
}
lines.push("## Тексты лицензий");
lines.push("");
for (const e of entries) {
  lines.push(`### ${e.name}@${e.version}`);
  lines.push("");
  lines.push(`Лицензия: ${e.license}${e.homepage ? ` · ${String(e.homepage).replace(/^git\+/, "")}` : ""}`);
  lines.push("");
  if (e.text) {
    lines.push("```");
    lines.push(e.text.replace(/```/g, "'''"));
    lines.push("```");
  } else {
    lines.push("_Текст лицензии в пакете не поставляется._");
  }
  lines.push("");
}

const outPath = path.join(repoRoot, "THIRD-PARTY-LICENSES.md");
fs.writeFileSync(outPath, lines.join("\n"), "utf-8");
console.log(`Пакетов: ${entries.length}, без файла лицензии: ${missing.length}`);
console.log(`Записано: ${outPath}`);
