// Перевод заклинаний со старых полей (attack_save / damage / healing /
// casting_time) на структуру checks + effects, плюс нормализация дистанций
// и длительностей, которые набирались руками и разъехались.
//
// По умолчанию — сухой прогон: ничего не пишет, печатает отчёт о том, что
// изменится, и отдельно всё, что разобрать не удалось. Применение только по
// явному флагу:
//
//   npx tsx src/scripts/migrateSpellEffects.ts          — отчёт
//   npx tsx src/scripts/migrateSpellEffects.ts --apply  — записать
//
// Повторный запуск безопасен: записи, у которых уже есть effects, не
// трогаются вовсе — иначе второй прогон удвоил бы им эффекты.

import { db } from "../db/db";

const APPLY = process.argv.includes("--apply");

interface Row {
  id: number;
  name: string;
  level: number | null;
  data: string;
}

type Data = Record<string, unknown>;

// ——— то же, что в client/src/components/dnd/effects.ts ———

interface Check {
  id: string;
  type: "attack" | "save";
  attackRange?: "melee" | "ranged";
  saveAbility?: string;
}

interface Effect {
  id: string;
  type: string;
  when: string;
  checkId?: string | null;
  dice?: string;
  damageType?: { id: number; name: string } | null;
  halfOnSuccess?: boolean;
  upcastPerLevel?: string;
  cantripScaling?: string;
  text?: string;
}

// Тот же страж, что в клиентской модели: тип урона не отсутствует, а
// выбирается при накладывании (Хроматический шар).
const DAMAGE_TYPE_CHOSEN = { id: -1, name: "Выбирается при накладывании" };

let counter = 0;
function localId(prefix: string): string {
  counter += 1;
  return `${prefix}m${counter.toString(36)}`;
}

// ——— справочник типов урона ———

// Тип урона в старом поле записан в любом падеже и роде («урона Огнём»,
// «Психического урона», «кислоты»), поэтому сопоставляем по корню, а не по
// имени записи. Корень — до первой изменяемой буквы.
const DAMAGE_ROOTS: [string, string][] = [
  ["огн", "Огненный"],
  ["кислот", "Кислотный"],
  ["излуч", "Излучение"],
  ["психич", "Психический"],
  ["некротич", "Некротический"],
  ["электрич", "Электричество"],
  ["молни", "Электричество"],
  ["холод", "Холодный"],
  ["звук", "Звуковой"],
  ["яд", "Ядовитый"],
  ["силов", "Силовое поле"],
  ["дробящ", "Дробящий"],
  ["колющ", "Колющий"],
  ["рубящ", "Рубящий"],
];

function loadDamageTypes(systemId: number): Map<string, { id: number; name: string }> {
  const rows = db
    .prepare(
      `SELECT e.id, e.name FROM compendium_entries e
       JOIN compendium_entries g ON g.id = e.parent_id
       WHERE e.system_id = ? AND g.name = 'Типы урона'`
    )
    .all(systemId) as { id: number; name: string }[];
  const byName = new Map<string, { id: number; name: string }>();
  for (const r of rows) byName.set(r.name.toLowerCase(), { id: r.id, name: r.name });
  return byName;
}

function matchDamageType(
  text: string,
  byName: Map<string, { id: number; name: string }>
): { id: number; name: string } | null {
  const lower = text.toLowerCase();
  for (const [root, canonical] of DAMAGE_ROOTS) {
    if (!lower.includes(root)) continue;
    // Имя в справочнике может отличаться от канонического («Электрический»
    // против «Электричество»), поэтому ищем запись тоже по корню.
    for (const [name, ref] of byName) {
      if (name.startsWith(root) || canonical.toLowerCase().startsWith(root)) {
        if (name.startsWith(root)) return ref;
      }
    }
  }
  return null;
}

// ——— разбор полей ———

// Кости пишутся и кириллицей («3к6»), и латиницей («1d6»), и вперемешку
// («1д6») — ловим всё, оригинальное написание сохраняем как есть.
const DICE_RE = /\d+\s*[кkдd]\s*\d+/gi;

interface ParsedDamage {
  parts: { dice: string; typeText: string }[];
  leftover: string;
}

// «5к6 урона Огнём и 5к6 урона Излучением» — два эффекта, а не один, поэтому
// строка режется по позициям костей: всё до следующей кости считается
// описанием типа для текущей.
function parseDamage(raw: string): ParsedDamage {
  const matches = [...raw.matchAll(DICE_RE)];
  if (matches.length === 0) return { parts: [], leftover: raw };
  const parts: { dice: string; typeText: string }[] = [];
  for (let i = 0; i < matches.length; i += 1) {
    const m = matches[i];
    const start = m.index ?? 0;
    const end = i + 1 < matches.length ? matches[i + 1].index ?? raw.length : raw.length;
    parts.push({ dice: m[0].replace(/\s+/g, ""), typeText: raw.slice(start + m[0].length, end) });
  }
  const leftover = raw.slice(0, matches[0].index ?? 0).trim();
  return { parts, leftover };
}

// \w в JS — это [A-Za-z0-9_], кириллицу он не покрывает, поэтому окончания
// слов везде ниже описаны явным классом, а не \w.
const CYR = "[а-яёА-ЯЁ]";

const TIMING_MAP: [RegExp, string][] = [
  [new RegExp(`^\\s*\\d*\\s*бонусн${CYR}*\\s+действ`, "i"), "Бонусное действие"],
  [/^\s*\d*\s*реакци/i, "Реакция"],
  [/^\s*\d*\s*действ/i, "Действие"],
];

interface ParsedTiming {
  timing: string | null;
  other: string;
  ritual: boolean;
}

function parseCastingTime(raw: string): ParsedTiming {
  const text = raw.trim();
  if (!text) return { timing: null, other: "", ritual: false };
  // «Действие или Ритуал» — ритуальность живёт и здесь, и во флаге `ritual`;
  // после миграции единственным источником остаётся флаг.
  const ritual = /ритуал/i.test(text);
  const withoutRitual = text.replace(/\s*или\s+ритуал\s*/i, "").trim();
  for (const [re, timing] of TIMING_MAP) {
    if (re.test(withoutRitual)) {
      // У реакции хвост строки — это условие срабатывания, и терять его
      // нельзя: «когда вас поражают броском атаки…» больше нигде не записано.
      const tail =
        timing === "Реакция"
          ? withoutRitual.replace(new RegExp(`^\\s*\\d*\\s*реакци${CYR}*[,\\s]*`, "i"), "").trim()
          : "";
      return { timing, other: tail, ritual };
    }
  }
  return { timing: "Иное", other: withoutRitual, ritual };
}

const RANGE_FIXES: [RegExp, string][] = [
  [/^на себя\?$/i, "На себя"],
  [/^на себя$/i, "На себя"],
  [/^(\d+)\s*фт\.?$/i, "$1 футов"],
  [/^(\d+)$/,  "$1 футов"],
  [/^на себя,\s*(\d+)\s*футов(ый|ая|ое)?\s+(\S+)$/i, "На себя ($1-футовый $3)"],
];

function normalizeRange(raw: string): string {
  const text = raw.trim();
  for (const [re, to] of RANGE_FIXES) {
    if (re.test(text)) return text.replace(re, to);
  }
  return text;
}

function normalizeDuration(raw: string): string {
  let text = raw.trim();
  // Только когда «мгновенно» — это вся строка целиком: у «Мгновенная или 1
  // час» (Формование воды и другие заговоры) вторая половина настоящая, и
  // срезать её нельзя.
  if (/^мгновенн[оая]{1,2}$/i.test(text)) return "Мгновенная";
  // «вплоть До 1 часа» — заглавная в середине фразы, следствие ручного ввода.
  text = text.replace(/\bДо\b/g, "до");
  text = text.replace(/^вплоть до/i, "Вплоть до");
  return text;
}

// «за каждый уровень ячейки выше N» — рост по кругу ячейки; «когда вы
// достигаете 5-го (2к6), 11-го…» — рост заговора по уровню персонажа. Это
// разные механики и разные поля модели.
const UPCAST_PER_SLOT = new RegExp(`на\\s+(\\d+\\s*[кkдd]\\s*\\d+)\\s+за\\s+кажд${CYR}+\\s+уровень\\s+ячейки`, "i");
const UPCAST_CANTRIP = /когда\s+вы\s+достигаете/i;
// «увеличивается на 1к8, когда вы достигаете 5-го…» — шаг у каждого заговора
// свой (у Испепеляющего взрыва 1к10), поэтому берём кость из самого текста, а
// не из общей константы. Пороги 5/11/17 в 5.5 фиксированы и не хранятся.
const CANTRIP_STEP = /на\s+(\d+\s*[кkдd]\s*\d+)\s*,?\s*когда\s+вы\s+достигаете/i;

// ——— прогон ———

interface Report {
  total: number;
  skippedHasEffects: number;
  checksFrom: number;
  damageEffects: number;
  healEffects: number;
  timingFilled: number;
  timingBreakdown: Record<string, number>;
  timingEmpty: { id: number; name: string }[];
  ritualFromText: { id: number; name: string }[];
  rangeFixed: { name: string; from: string; to: string }[];
  durationFixed: { name: string; from: string; to: string }[];
  concentrationMismatch: { name: string; duration: string; flag: boolean }[];
  upcastPerSlot: number;
  cantripParsed: number;
  upcastCantrip: { id: number; name: string; text: string }[];
  damageNoType: { name: string; raw: string }[];
  healingSuspect: { name: string; raw: string }[];
}

function run(): void {
  const system = db.prepare("SELECT id FROM systems WHERE name = 'D&D 5.5'").get() as { id: number } | undefined;
  if (!system) {
    console.error("Система «D&D 5.5» не найдена.");
    process.exit(1);
  }
  const damageTypes = loadDamageTypes(system.id);
  const rows = db
    .prepare("SELECT id, name, level, data FROM compendium_entries WHERE kind = 'spell' AND system_id = ?")
    .all(system.id) as Row[];

  const r: Report = {
    total: rows.length,
    skippedHasEffects: 0,
    checksFrom: 0,
    damageEffects: 0,
    healEffects: 0,
    timingFilled: 0,
    timingBreakdown: {},
    timingEmpty: [],
    ritualFromText: [],
    rangeFixed: [],
    durationFixed: [],
    concentrationMismatch: [],
    upcastPerSlot: 0,
    cantripParsed: 0,
    upcastCantrip: [],
    damageNoType: [],
    healingSuspect: [],
  };

  const updates: { id: number; data: string }[] = [];

  for (const row of rows) {
    const data = JSON.parse(row.data || "{}") as Data;
    if (Array.isArray(data.effects) && data.effects.length > 0) {
      r.skippedHasEffects += 1;
      continue;
    }

    const checks: Check[] = [];
    const effects: Effect[] = [];

    // 1. attack_save → check
    const attackSave = typeof data.attack_save === "string" ? data.attack_save.trim() : "";
    if (attackSave) {
      if (attackSave.startsWith("Атака")) {
        checks.push({
          id: localId("c"),
          type: "attack",
          attackRange: attackSave.includes("ближ") ? "melee" : "ranged",
        });
      } else if (attackSave.startsWith("Спасбросок")) {
        checks.push({
          id: localId("c"),
          type: "save",
          saveAbility: attackSave.replace("Спасбросок", "").trim(),
        });
      }
      if (checks.length > 0) r.checksFrom += 1;
    }
    const gate = checks[0];
    const when = !gate ? "always" : gate.type === "save" ? "save_fail" : "hit";

    // 2. upcast — только та часть, что относится к ячейкам
    const upcastRaw = typeof data.upcast === "string" ? data.upcast : "";
    const perSlot = UPCAST_PER_SLOT.exec(upcastRaw);
    if (perSlot) r.upcastPerSlot += 1;
    const cantripStep = row.level === 0 && UPCAST_CANTRIP.test(upcastRaw) ? CANTRIP_STEP.exec(upcastRaw) : null;
    if (cantripStep) r.cantripParsed += 1;
    else if (UPCAST_CANTRIP.test(upcastRaw)) {
      r.upcastCantrip.push({ id: row.id, name: row.name, text: upcastRaw });
    }

    // 3. damage → эффекты
    const damageRaw = typeof data.damage === "string" ? data.damage.trim() : "";
    if (damageRaw) {
      const parsed = parseDamage(damageRaw);
      if (parsed.parts.length === 0) {
        // Кости не нашлись — переносим строкой, чтобы ничего не потерять.
        effects.push({ id: localId("e"), type: "damage", when, checkId: gate?.id ?? null, dice: damageRaw });
        r.damageNoType.push({ name: row.name, raw: damageRaw });
        r.damageEffects += 1;
      } else {
        for (let i = 0; i < parsed.parts.length; i += 1) {
          const part = parsed.parts[i];
          const chosenAtCast = /выбранн\w*\s+типа|выбранного типа/i.test(part.typeText);
          const type = chosenAtCast ? DAMAGE_TYPE_CHOSEN : matchDamageType(part.typeText, damageTypes);
          if (!type) r.damageNoType.push({ name: row.name, raw: damageRaw });
          const effect: Effect = {
            id: localId("e"),
            type: "damage",
            when,
            checkId: gate?.id ?? null,
            dice: part.dice,
            damageType: type,
          };
          if (gate?.type === "save") effect.halfOnSuccess = true;
          // Апкаст вешается только на первый эффект: во всех разобранных
          // строках он относится к основному урону, а не к добавочному.
          if (i === 0 && perSlot) effect.upcastPerLevel = perSlot[1].replace(/\s+/g, "");
          if (i === 0 && cantripStep) effect.cantripScaling = cantripStep[1].replace(/\s+/g, "");
          if (i === 0 && parsed.leftover) effect.text = parsed.leftover;
          effects.push(effect);
          r.damageEffects += 1;
        }
      }
    }

    // 4. healing → эффекты. Поле заполнено у единиц, и часть значений —
    // вообще не лечение («+2 к КЗ»), поэтому всё сюда попавшее выносим в
    // отчёт на ручную проверку.
    const healingRaw = typeof data.healing === "string" ? data.healing.trim() : "";
    if (healingRaw) {
      const looksLikeHealing = DICE_RE.test(healingRaw) && !/к\s*КЗ|спасброс|атак/i.test(healingRaw);
      DICE_RE.lastIndex = 0;
      effects.push({
        id: localId("e"),
        type: looksLikeHealing ? "heal" : "special",
        when: "always",
        checkId: null,
        ...(looksLikeHealing ? { dice: healingRaw } : { text: healingRaw }),
      });
      r.healEffects += 1;
      if (!looksLikeHealing) r.healingSuspect.push({ name: row.name, raw: healingRaw });
    }

    // 5. casting_time → casting_timing
    const next: Data = { ...data };
    const castingRaw = typeof data.casting_time === "string" ? data.casting_time : "";
    if (!data.casting_timing) {
      const parsed = parseCastingTime(castingRaw);
      if (parsed.timing) {
        next.casting_timing = parsed.timing;
        if (parsed.other) next.casting_timing_other = parsed.other;
        r.timingFilled += 1;
        r.timingBreakdown[parsed.timing] = (r.timingBreakdown[parsed.timing] ?? 0) + 1;
        if (parsed.ritual && !data.ritual) {
          next.ritual = true;
          r.ritualFromText.push({ id: row.id, name: row.name });
        }
      } else {
        r.timingEmpty.push({ id: row.id, name: row.name });
      }
    }

    // 6. дистанция и длительность
    if (typeof data.range === "string" && data.range) {
      const fixed = normalizeRange(data.range);
      if (fixed !== data.range) {
        r.rangeFixed.push({ name: row.name, from: data.range, to: fixed });
        next.range = fixed;
      }
    }
    if (typeof data.duration === "string" && data.duration) {
      const fixed = normalizeDuration(data.duration);
      if (fixed !== data.duration) {
        r.durationFixed.push({ name: row.name, from: data.duration, to: fixed });
        next.duration = fixed;
      }
      // Концентрация записана и текстом, и флагом. Расхождения не чиним
      // автоматически — по одному тексту не видно, где правда.
      const textSaysConc = /концентрац/i.test(fixed);
      const flag = !!data.concentration;
      if (textSaysConc !== flag) {
        r.concentrationMismatch.push({ name: row.name, duration: fixed, flag });
      }
    }

    next.checks = checks;
    next.effects = effects;
    if (!next.cost) next.cost = { kind: "spell_slot" };
    updates.push({ id: row.id, data: JSON.stringify(next) });
  }

  print(r);

  if (!APPLY) {
    console.log("\nСухой прогон: база не изменена. Для записи — флаг --apply.");
    return;
  }
  const stmt = db.prepare("UPDATE compendium_entries SET data = ? WHERE id = ?");
  const tx = db.transaction((list: { id: number; data: string }[]) => {
    for (const u of list) stmt.run(u.data, u.id);
  });
  tx(updates);
  console.log(`\nЗаписано записей: ${updates.length}.`);
}

function print(r: Report): void {
  const line = (label: string, value: unknown) => console.log(`  ${label.padEnd(38)} ${value}`);
  console.log("\n=== Заклинания D&D 5.5: сухой прогон ===\n");
  line("всего записей", r.total);
  line("пропущено (эффекты уже есть)", r.skippedHasEffects);
  console.log("\n— переносится —");
  line("броски из «Атака/спасбросок»", r.checksFrom);
  line("эффектов урона", r.damageEffects);
  line("эффектов лечения/особых", r.healEffects);
  line("время накладывания заполнено", r.timingFilled);
  for (const [k, v] of Object.entries(r.timingBreakdown)) line(`    ${k}`, v);
  line("апкаст «за уровень ячейки»", r.upcastPerSlot);
  line("масштаб заговора разобран", r.cantripParsed);
  line("нормализовано дистанций", r.rangeFixed.length);
  line("нормализовано длительностей", r.durationFixed.length);
  line("ритуал взят из текста", r.ritualFromText.length);

  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    console.log(`\n— ${title} (${items.length}) —`);
    for (const i of items.slice(0, 40)) console.log(`  ${i}`);
    if (items.length > 40) console.log(`  … и ещё ${items.length - 40}`);
  };

  section(
    "время накладывания пустое, разобрать не из чего",
    r.timingEmpty.map((x) => x.name)
  );
  section(
    "урон перенесён без типа — проверить руками",
    r.damageNoType.map((x) => `${x.name}: «${x.raw}»`)
  );
  section(
    "в «Лечении» лежит не лечение — перенесено в «Особое»",
    r.healingSuspect.map((x) => `${x.name}: «${x.raw}»`)
  );
  section(
    "масштаб заговора: шаг не вычленяется, нужен ручной ввод",
    r.upcastCantrip.map((x) => `${x.name}: «${x.text.slice(0, 80)}»`)
  );
  section(
    "концентрация: текст и флаг расходятся",
    r.concentrationMismatch.map((x) => `${x.name}: «${x.duration}», флаг ${x.flag ? "стоит" : "снят"}`)
  );
  section(
    "дистанции",
    r.rangeFixed.map((x) => `${x.name}: «${x.from}» → «${x.to}»`)
  );
  section(
    "длительности",
    r.durationFixed.map((x) => `${x.name}: «${x.from}» → «${x.to}»`)
  );
  section(
    "ритуал проставлен по тексту времени накладывания",
    r.ritualFromText.map((x) => x.name)
  );
}

run();
