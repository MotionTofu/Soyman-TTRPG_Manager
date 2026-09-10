import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

/**
 * Страж упаковки установщика.
 *
 * `electron-builder` кладёт в установщик не всё дерево, а перечисленное в
 * `files`. Пока сервер зависел только от своего `dist`, список был верен сам
 * собой. С появлением общего пакета (`@soyman/shared`, 2026-09-10) у сервера
 * есть внешняя зависимость исходниками: забыть её в списке значит собрать
 * установщик, который падает при первом запросе — и увидеть это можно только
 * установив приложение, никакой `tsc` тут не поможет.
 *
 * Проверка дешёвая и постоянная, поэтому она здесь, а не в ритуале релиза.
 */
const repoRoot = path.join(__dirname, "..", "..", "..");

interface BuilderConfig {
  name: string;
  files: string[];
  /** `extraResources` кладёт файлы мимо `files` — туда и едет общий пакет. */
  extra: { from: string; to: string }[];
}

function builderConfigs(): BuilderConfig[] {
  const read = (name: string, cfg: Record<string, unknown>): BuilderConfig => ({
    name,
    files: (cfg.files ?? []) as string[],
    extra: ((cfg.extraResources ?? []) as { from: string; to: string }[]).filter(
      (e) => typeof e === "object" && e
    ),
  });
  const out = fs
    .readdirSync(repoRoot)
    .filter((f) => /^electron-builder.*\.json$/.test(f))
    .map((name) => read(name, JSON.parse(fs.readFileSync(path.join(repoRoot, name), "utf-8"))));
  // Обычный `npm run dist` берёт конфигурацию не из отдельного файла, а из
  // блока `build` корневого package.json — забыть именно её проще всего.
  const root = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf-8"));
  if (root.build) out.push(read("package.json:build", root.build));
  return out;
}

/** Рабочие зависимости сервера, которые не приходят из npm-реестра. */
function localDeps(): { name: string; dir: string }[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(repoRoot, "server", "package.json"), "utf-8"));
  return Object.entries(pkg.dependencies ?? {})
    .filter(([, spec]) => typeof spec === "string" && (spec as string).startsWith("file:"))
    .map(([name, spec]) => ({
      name,
      dir: path.resolve(path.join(repoRoot, "server"), (spec as string).slice("file:".length)),
    }));
}

describe("установщик получает всё, от чего зависит сервер", () => {
  it("конфигурации electron-builder вообще нашлись", () => {
    const configs = builderConfigs();
    expect(configs.length).toBeGreaterThan(0);
    for (const c of configs) expect(c.files.length, `${c.name} без files`).toBeGreaterThan(0);
  });

  it("у каждой локальной зависимости сервера собран dist", () => {
    for (const dep of localDeps()) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dep.dir, "package.json"), "utf-8"));
      const main = pkg.main as string | undefined;
      expect(main, `${dep.name} без main`).toBeTruthy();
      // Сборка пакета висит на `npm run build` сервера (`build:shared`), так
      // что к моменту упаковки dist существует. Если теста нет — значит забыли.
      expect(
        fs.existsSync(path.join(dep.dir, main!)),
        `${dep.name}: нет ${main} — не собран, установщик получит пустышку`
      ).toBe(true);
    }
  });

  it("каждая локальная зависимость явно копируется в установщик", () => {
    const deps = localDeps();
    if (!deps.length) return;
    for (const { name, dir } of deps) {
      const rel = path.relative(repoRoot, dir).replace(/\\/g, "/");
      for (const cfg of builderConfigs()) {
        // Полагаться на копирование `server/node_modules` нельзя: npm ставит
        // `file:`-зависимость СИМВОЛИЧЕСКОЙ ССЫЛКОЙ на абсолютный путь этой
        // машины, и в установщике она была бы мёртвой. Поэтому требуем явную
        // запись в extraResources, ведущую в node_modules сервера под именем
        // пакета.
        const explicit = cfg.extra.some(
          (e) => e.from?.startsWith(rel) && e.to?.includes(name)
        );
        expect(
          explicit,
          `${cfg.name}: ${name} не копируется явно — установщик получит мёртвую ссылку`
        ).toBe(true);
      }
    }
  });

  it("копируется именно то, чем пакет представляется", () => {
    for (const { name, dir } of localDeps()) {
      const pkg = JSON.parse(fs.readFileSync(path.join(dir, "package.json"), "utf-8"));
      // `main` — это то, что резолвит node внутри установленного приложения.
      // Если копируем `dist`, а main смотрит в другое место, приложение
      // упадёт при первом же импорте.
      const mainDir = (pkg.main as string).split("/")[0];
      const rel = path.relative(repoRoot, dir).replace(/\\/g, "/");
      for (const cfg of builderConfigs()) {
        const copies = cfg.extra.filter((e) => e.from?.startsWith(rel)).map((e) => e.from);
        expect(
          copies.some((f) => f === `${rel}/${mainDir}`),
          `${cfg.name}: ${name} — main смотрит в ${mainDir}/, а копируется ${copies.join(", ") || "ничего"}`
        ).toBe(true);
      }
    }
  });
});
