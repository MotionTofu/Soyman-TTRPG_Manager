import fs from "fs";
import os from "os";
import path from "path";

/**
 * Один временный каталог на весь прогон тестов (globalSetup vitest).
 *
 * Тесты заводят свои папки через `fs.mkdtempSync(os.tmpdir() …)` — базу,
 * хранилище, копии старых баз — и за собой не убирают: на 2026-11-04 в TEMP
 * лежало 4204 папки `soyman-*` (~18 ГБ), по ~160 с каждого прогона. Убирать в
 * каждом из трёх десятков файлов — значит забыть в тридцать первом. Поэтому
 * здесь TEMP прогона подменяется своим каталогом (воркеры наследуют среду, и
 * `os.tmpdir()` в них отдаёт его), а после прогона он удаляется целиком.
 *
 * На Windows воркеры к моменту уборки ещё держат файлы баз (EPERM), и каталог
 * иногда переживает прогон. Его подбирает следующий: в начале удаляются
 * каталоги прошлых прогонов старше STALE_MS — свежий может принадлежать
 * прогону, идущему прямо сейчас в соседнем окне.
 */
const PREFIX = "soyman-vitest-";
const STALE_MS = 60 * 60 * 1000;

function remove(dir: string) {
  try {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 300 });
  } catch {
    // Занято — уберёт следующий прогон.
  }
}

export default function setup() {
  const base = os.tmpdir();
  for (const name of fs.readdirSync(base)) {
    if (!name.startsWith(PREFIX)) continue;
    const dir = path.join(base, name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > STALE_MS) remove(dir);
    } catch {
      // Исчез между readdir и stat — тем лучше.
    }
  }
  const root = fs.mkdtempSync(path.join(base, PREFIX));
  const saved = { TMP: process.env.TMP, TEMP: process.env.TEMP, TMPDIR: process.env.TMPDIR };
  process.env.TMP = process.env.TEMP = process.env.TMPDIR = root;
  return () => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    remove(root);
  };
}
