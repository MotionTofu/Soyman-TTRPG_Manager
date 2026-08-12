#!/usr/bin/env node
// Проверка выдачи нейросети в формате adventure-import/1.
//
//   node scripts/check-import.js <файл.json | папка> [...]
//
// Ловит то, на чём модели реально спотыкаются (см. docs/adventure-import/format.md):
// обрыв JSON, дубли и неверные префиксы ключей, ссылки в никуда, меншены на
// несозданные сущности, нулевые месяцы в датах. Заодно печатает статистику
// заполнения — по ней видно, что модель поленилась разобрать.
//
// Это отладочный инструмент этапа «формат и промпт». Валидатор самого импортёра
// будет отдельным (zod на сервере), но правила проверяет те же.

const fs = require("fs");
const path = require("path");

const KEY_PREFIX = {
  locations: "loc.",
  beings: "npc.",
  bestiary: "bst.",
  communities: "com.",
  treasury: "item.",
  adventures: "adv.",
};

function analyse(file) {
  const raw = fs.readFileSync(file, "utf8");
  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    return { file: path.basename(file), fatal: `JSON не разобран: ${e.message}` };
  }

  const keys = new Set();
  const duplicateKeys = [];
  const wrongPrefix = [];
  const addKey = (key, prefix) => {
    if (!key) return;
    if (keys.has(key)) duplicateKeys.push(key);
    keys.add(key);
    if (prefix && !key.startsWith(prefix)) wrongPrefix.push(key);
  };

  for (const [section, prefix] of Object.entries(KEY_PREFIX)) {
    for (const entity of data[section] ?? []) addKey(entity.key, prefix);
  }
  const adventures = data.adventures ?? [];
  for (const adv of adventures) {
    for (const c of adv.chapters ?? []) addKey(c.key, "chp.");
    for (const s of adv.scenes ?? []) addKey(s.key, "scn.");
    for (const m of adv.milestones ?? []) addKey(m.key, "mls.");
    for (const s of adv.secrets ?? []) addKey(s.key, "sec.");
  }

  const dangling = [];
  const checkRef = (value, where) => {
    if (!value) return;
    for (const key of [].concat(value)) {
      if (typeof key === "string" && key && !keys.has(key)) dangling.push(`${where} → ${key}`);
    }
  };
  for (const l of data.locations ?? []) checkRef(l.parent, `локация ${l.key}.parent`);
  for (const b of data.beings ?? []) {
    checkRef(b.locations, `личность ${b.key}.locations`);
    checkRef(b.communities, `личность ${b.key}.communities`);
  }
  for (const b of data.bestiary ?? []) checkRef(b.locations, `бестиарий ${b.key}.locations`);
  for (const c of data.communities ?? []) {
    checkRef(c.parent, `сообщество ${c.key}.parent`);
    checkRef(c.locations, `сообщество ${c.key}.locations`);
  }
  for (const adv of adventures) {
    for (const s of adv.scenes ?? []) {
      checkRef(s.chapter, `сцена ${s.key}.chapter`);
      checkRef(s.locations, `сцена ${s.key}.locations`);
      checkRef(s.participants, `сцена ${s.key}.participants`);
      checkRef(s.items, `сцена ${s.key}.items`);
      for (const n of s.next ?? []) checkRef(n.to, `сцена ${s.key}.next`);
      for (const r of s.rewards ?? []) checkRef(r.item, `сцена ${s.key}.rewards.item`);
    }
    for (const m of adv.milestones ?? []) checkRef(m.scene, `веха ${m.key}.scene`);
    for (const r of adv.rewards ?? []) checkRef(r.item, `награда приключения ${adv.key}`);
  }
  for (const r of data.relations ?? []) {
    checkRef(r.from, "отношение.from");
    checkRef(r.to, "отношение.to");
  }
  for (const l of data.links ?? []) {
    checkRef(l.from, "связь.from");
    checkRef(l.to, "связь.to");
  }

  // Меншены [[key|подпись]] в любом текстовом поле на любой глубине.
  const mentions = [];
  const walk = (value) => {
    if (typeof value === "string") {
      for (const m of value.matchAll(/\[\[([^\]|]+)\|/g)) mentions.push(m[1]);
    } else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(data);
  const badMentions = [...new Set(mentions.filter((m) => !keys.has(m)))];

  const badDates = (data.calendar_events ?? [])
    .filter((e) => !e.month || !e.day)
    .map((e) => e.title);

  const scenes = adventures.flatMap((a) => a.scenes ?? []);
  const checks = scenes.flatMap((s) => s.checks ?? []);
  const categories = {};
  for (const b of data.beings ?? []) categories[b.category ?? "—"] = (categories[b.category ?? "—"] ?? 0) + 1;

  return {
    file: path.basename(file),
    counts: {
      локации: (data.locations ?? []).length,
      личности: (data.beings ?? []).length,
      бестиарий: (data.bestiary ?? []).length,
      сообщества: (data.communities ?? []).length,
      предметы: (data.treasury ?? []).length,
      приключения: adventures.length,
      главы: adventures.flatMap((a) => a.chapters ?? []).length,
      сцены: scenes.length,
      вехи: adventures.flatMap((a) => a.milestones ?? []).length,
      тайны: adventures.flatMap((a) => a.secrets ?? []).length,
      проверки: checks.length,
      отношения: (data.relations ?? []).length,
    },
    categories,
    sceneFill: {
      всего: scenes.length,
      сЛокацией: scenes.filter((s) => (s.locations ?? []).length).length,
      сУчастниками: scenes.filter((s) => (s.participants ?? []).length).length,
      сЗачитыванием: scenes.filter((s) => (s.read_aloud ?? "").trim()).length,
      сПроверками: scenes.filter((s) => (s.checks ?? []).length).length,
      сПереходами: scenes.filter((s) => (s.next ?? []).length).length,
    },
    checkFill: {
      всего: checks.length,
      безУспеха: checks.filter((c) => !(c.on_success ?? "").trim()).length,
      безПровала: checks.filter((c) => !(c.on_failure ?? "").trim()).length,
      сложностьВName: checks.filter((c) => /\b(СЛ|DC|SA)\s*\d/i.test(c.what ?? "")).length,
    },
    problems: {
      дублиКлючей: duplicateKeys,
      неверныйПрефикс: wrongPrefix,
      ссылкиВНикуда: dangling,
      меншеныВНикуда: badMentions,
      датыБезМесяцаИлиДня: badDates,
    },
  };
}

function report(result) {
  console.log(`\n=== ${result.file}`);
  if (result.fatal) {
    console.log(`  ✗ ${result.fatal}`);
    return 1;
  }
  console.log("  " + Object.entries(result.counts).map(([k, v]) => `${k}: ${v}`).join(", "));
  console.log("  категории личностей: " + JSON.stringify(result.categories));
  const f = result.sceneFill;
  console.log(
    `  сцены: локация ${f.сЛокацией}/${f.всего}, участники ${f.сУчастниками}/${f.всего}, ` +
      `зачитывание ${f.сЗачитыванием}/${f.всего}, проверки ${f.сПроверками}/${f.всего}, переходы ${f.сПереходами}/${f.всего}`
  );
  const c = result.checkFill;
  console.log(
    `  проверки: ${c.всего}, без «при успехе» ${c.безУспеха}, без «при провале» ${c.безПровала}, ` +
      `со сложностью внутри what ${c.сложностьВName}`
  );

  let problems = 0;
  for (const [label, list] of Object.entries(result.problems)) {
    if (!list.length) continue;
    problems += list.length;
    console.log(`  ✗ ${label} (${list.length}):`);
    for (const item of list.slice(0, 10)) console.log(`      ${item}`);
    if (list.length > 10) console.log(`      … и ещё ${list.length - 10}`);
  }
  if (problems === 0) console.log("  ✓ структурных ошибок нет");
  return problems;
}

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Использование: node scripts/check-import.js <файл.json | папка> [...]");
  process.exit(2);
}

const files = [];
for (const arg of args) {
  const stat = fs.statSync(arg);
  if (stat.isDirectory()) {
    for (const name of fs.readdirSync(arg)) {
      if (name.toLowerCase().endsWith(".json")) files.push(path.join(arg, name));
    }
  } else files.push(arg);
}

let total = 0;
for (const file of files) total += report(analyse(file));
console.log(`\nПроверено файлов: ${files.length}. Проблем: ${total}.`);
process.exit(total > 0 ? 1 : 0);
