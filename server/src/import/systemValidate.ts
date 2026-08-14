// Смысловая проверка файла system-import/1 — то, чего нельзя выразить схемой,
// потому что нужен файл целиком: уникальность ключей, ссылки в никуда,
// эффекты, привязанные к несуществующему броску, осмысленность таблицы
// развития.
//
// Деление то же, что у импорта приключений:
//   errors   — импорт невозможен (сломан JSON, дубли ключей, чужой format,
//              ссылка в никуда — здесь она хуже, чем в приключении: без типа
//              урона эффект бесполезен, а не просто «менее связан»);
//   warnings — импорт пройдёт, но что-то потеряется или окажется неполным.

import { z } from "zod";
import {
  SYSTEM_KEY_PREFIX_TO_KIND,
  systemImportFileSchema,
  systemPrefixOf,
  type SystemImportFile,
} from "./systemFormat";

export interface Problem {
  path: string;
  message: string;
}

export interface SystemValidationResult {
  ok: boolean;
  errors: Problem[];
  warnings: Problem[];
  data: SystemImportFile | null;
  /** Ключи, объявленные в этом файле: key → вид записи компендиума. */
  keys: Record<string, string>;
  counts: Record<string, number>;
  /**
   * Ссылки, которым не на что указывать: ни в файле, ни среди уже занятых
   * ключей. Это не ошибка файла — так выглядит нормальный первый импорт в
   * систему, заполненную руками: глава заклинаний ссылается на классы,
   * которые в компендиуме давно есть, но ключа не имеют. Их связывает
   * человек на экране импорта, и связь запоминается навсегда.
   */
  unresolved: { ref: string; expect: string[]; paths: string[] }[];
}

/** Все ключи, которые файл объявляет, включая вложенные умения и подклассы. */
function collectKeys(file: SystemImportFile): { key: string; path: string }[] {
  const out: { key: string; path: string }[] = [];
  const push = (key: string, path: string) => out.push({ key, path });

  file.mechanics.forEach((m, i) => push(m.key, `mechanics[${i}]`));
  file.spells.forEach((s, i) => push(s.key, `spells[${i}]`));
  file.species.forEach((s, i) => {
    push(s.key, `species[${i}]`);
    s.features.forEach((f, j) => push(f.key, `species[${i}].features[${j}]`));
  });
  file.backgrounds.forEach((b, i) => push(b.key, `backgrounds[${i}]`));
  file.feats.forEach((f, i) => push(f.key, `feats[${i}]`));
  file.equipment.forEach((e, i) => push(e.key, `equipment[${i}]`));
  file.magic_items.forEach((m, i) => push(m.key, `magic_items[${i}]`));
  file.monsters.forEach((m, i) => push(m.key, `monsters[${i}]`));
  file.classes.forEach((c, i) => {
    push(c.key, `classes[${i}]`);
    c.features.forEach((f, j) => push(f.key, `classes[${i}].features[${j}]`));
    c.options?.entries.forEach((f, j) => push(f.key, `classes[${i}].options.entries[${j}]`));
    c.subclasses.forEach((sub, j) => {
      push(sub.key, `classes[${i}].subclasses[${j}]`);
      sub.features.forEach((f, k) => push(f.key, `classes[${i}].subclasses[${j}].features[${k}]`));
    });
  });
  return out;
}

/** Каждая ссылка файла с указанием, где она стоит и что должна означать. */
function collectRefs(file: SystemImportFile): { ref: string; path: string; expect?: string[] }[] {
  const out: { ref: string; path: string; expect?: string[] }[] = [];
  const add = (value: string | null | undefined, path: string, expect?: string[]) => {
    if (value && value !== "choice") out.push({ ref: value, path, expect });
  };

  file.spells.forEach((s, i) => {
    add(s.school, `spells[${i}].school`, ["mechanic_item"]);
    // Вид здесь законен: книга пишет «этот заговор знает лесной эльф» в том же
    // списке, что и классы. В компендиуме это хранится с другой стороны — у
    // вида, в «обретаемых заклинаниях», — и импорт разворачивает ссылку сам.
    s.classes.forEach((c, j) =>
      add(c.ref, `spells[${i}].classes[${j}]`, ["class", "subclass", "species"])
    );
    s.effects.forEach((e, j) => {
      add(e.damage_type, `spells[${i}].effects[${j}].damage_type`, ["mechanic_item"]);
      add(e.condition, `spells[${i}].effects[${j}].condition`, ["mechanic_item"]);
    });
  });
  file.classes.forEach((c, i) => {
    c.weapon_profs.forEach((r, j) => add(r, `classes[${i}].weapon_profs[${j}]`, ["mechanic_item"]));
    c.armor_profs.forEach((r, j) => add(r, `classes[${i}].armor_profs[${j}]`, ["mechanic_item"]));
    c.tool_profs.forEach((r, j) => add(r, `classes[${i}].tool_profs[${j}]`, ["mechanic_item"]));
    for (const slot of ["a", "b"] as const) {
      c.starting_equipment?.[slot]?.items.forEach((it, j) =>
        add(it.ref, `classes[${i}].starting_equipment.${slot}.items[${j}]`, ["equipment", "magic_item"])
      );
    }
  });
  file.species.forEach((s, i) => {
    add(s.creature_type, `species[${i}].creature_type`, ["mechanic_item"]);
    s.senses.forEach((r, j) => add(r.ref, `species[${i}].senses[${j}]`, ["mechanic_item"]));
    s.speeds.forEach((r, j) => add(r.ref, `species[${i}].speeds[${j}]`, ["mechanic_item"]));
    s.granted_spells.forEach((r, j) => add(r.ref, `species[${i}].granted_spells[${j}]`, ["spell"]));
  });
  file.backgrounds.forEach((b, i) => {
    add(b.origin_feat, `backgrounds[${i}].origin_feat`, ["feat"]);
    for (const slot of ["a", "b"] as const) {
      b.starting_equipment?.[slot]?.items.forEach((it, j) =>
        add(it.ref, `backgrounds[${i}].starting_equipment.${slot}.items[${j}]`, ["equipment", "magic_item"])
      );
    }
  });
  file.equipment.forEach((e, i) => {
    e.properties.forEach((r, j) => add(r, `equipment[${i}].properties[${j}]`, ["mechanic_item"]));
    add(e.mastery, `equipment[${i}].mastery`, ["mechanic_item"]);
    e.contents.forEach((c, j) => add(c.ref, `equipment[${i}].contents[${j}]`, ["equipment"]));
  });
  file.magic_items.forEach((m, i) =>
    m.classes.forEach((r, j) => add(r, `magic_items[${i}].classes[${j}]`, ["class", "subclass"]))
  );
  return out;
}

/** Броски и эффекты: эффект не должен ссылаться на несуществующий бросок. */
function checkActivatable(
  holder: { checks: { id: string }[]; effects: { when: string; check?: string; type: string; damage_type?: string }[] },
  path: string,
  errors: Problem[],
  warnings: Problem[]
): void {
  const ids = new Set(holder.checks.map((c) => c.id));
  const seen = new Set<string>();
  holder.checks.forEach((c, i) => {
    if (seen.has(c.id)) errors.push({ path: `${path}.checks[${i}]`, message: `дубль id броска «${c.id}»` });
    seen.add(c.id);
  });
  holder.effects.forEach((e, i) => {
    const at = `${path}.effects[${i}]`;
    if (e.when !== "always") {
      if (!e.check) {
        errors.push({ path: at, message: `«${e.when}» требует ссылки на бросок в поле check` });
      } else if (!ids.has(e.check)) {
        errors.push({ path: at, message: `бросок «${e.check}» в этой записи не объявлен` });
      }
    }
    if (e.type === "damage" && !e.damage_type) {
      warnings.push({ path: at, message: "урон без типа — на листе он покажется без стихии" });
    }
  });
}

/**
 * @param known ключи, уже занятые в целевой системе прошлыми импортами:
 *   key → вид записи. Без них вторая глава книги ссылается «в никуда» —
 *   заклинания третьей главы указывают на школы магии, приехавшие первой.
 */
export function validateSystemImport(
  raw: unknown,
  known: Record<string, string> = {}
): SystemValidationResult {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  const parsed = systemImportFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of (parsed.error as z.ZodError).issues) {
      errors.push({ path: issue.path.join("."), message: issue.message });
    }
    return { ok: false, errors, warnings, data: null, keys: {}, counts: {}, unresolved: [] };
  }
  const file = parsed.data;

  // 1. Ключи: уникальны и с известным префиксом.
  const declared = collectKeys(file);
  const keys: Record<string, string> = {};
  const seen = new Map<string, string>();
  for (const { key, path } of declared) {
    const prefix = systemPrefixOf(key);
    if (!prefix) {
      errors.push({ path, message: `ключ «${key}» без известного префикса` });
      continue;
    }
    const previous = seen.get(key);
    if (previous) {
      errors.push({ path, message: `ключ «${key}» уже объявлен в ${previous}` });
      continue;
    }
    seen.set(key, path);
    keys[key] = SYSTEM_KEY_PREFIX_TO_KIND[prefix];
    // Тот же ключ, но другого вида — значит, ключ поменял смысл. Молча
    // переписать заклинание классом нельзя: это не правка, а подмена.
    const before = known[key];
    if (before && before !== keys[key]) {
      errors.push({
        path,
        message: `ключ «${key}» уже занят записью вида ${before}, а здесь это ${keys[key]}`,
      });
    }
  }

  // 2. Ссылки: цель объявлена и того вида, которого ждут в этом месте.
  //    Промахнуться видом легко — модели путают класс с подклассом, а тип
  //    урона с состоянием, и молча получалась бы бессмыслица.
  const unresolvedByRef = new Map<string, { ref: string; expect: string[]; paths: string[] }>();
  for (const { ref, path, expect } of collectRefs(file)) {
    const kind = keys[ref] ?? known[ref];
    if (!kind) {
      // Ключ без известного префикса — опечатка модели, связывать нечего.
      if (!systemPrefixOf(ref)) {
        errors.push({ path, message: `ссылка «${ref}» — ключ без известного префикса` });
        continue;
      }
      const at = unresolvedByRef.get(ref) ?? {
        ref,
        expect: expect ?? [SYSTEM_KEY_PREFIX_TO_KIND[systemPrefixOf(ref)!]],
        paths: [],
      };
      at.paths.push(path);
      unresolvedByRef.set(ref, at);
      continue;
    }
    if (expect && !expect.includes(kind)) {
      errors.push({
        path,
        message: `«${ref}» — это ${kind}, а здесь ожидается ${expect.join(" или ")}`,
      });
    }
  }

  // 3. Броски и эффекты у всего, что можно применить.
  file.spells.forEach((s, i) => checkActivatable(s, `spells[${i}]`, errors, warnings));
  file.feats.forEach((f, i) => checkActivatable(f, `feats[${i}]`, errors, warnings));
  file.magic_items.forEach((m, i) => checkActivatable(m, `magic_items[${i}]`, errors, warnings));
  file.classes.forEach((c, i) => {
    c.features.forEach((f, j) => checkActivatable(f, `classes[${i}].features[${j}]`, errors, warnings));
    c.subclasses.forEach((sub, j) =>
      sub.features.forEach((f, k) =>
        checkActivatable(f, `classes[${i}].subclasses[${j}].features[${k}]`, errors, warnings)
      )
    );
  });
  file.species.forEach((s, i) =>
    s.features.forEach((f, j) => checkActivatable(f, `species[${i}].features[${j}]`, errors, warnings))
  );

  // 4. Таблица развития: без колонки уровня по ней ничего не посчитать,
  //    а разъехавшаяся ширина строк молча сдвинет все значения.
  file.classes.forEach((c, i) => {
    const p = c.progression;
    if (!p || p.columns.length === 0) return;
    const at = `classes[${i}].progression`;
    if (!p.columns.some((col) => col.role === "level")) {
      warnings.push({ path: at, message: "нет колонки с ролью level — уровни будут взяты по порядку строк" });
    }
    const width = p.columns.length;
    p.rows.forEach((row, j) => {
      if (row.length !== width) {
        errors.push({
          path: `${at}.rows[${j}]`,
          message: `в строке ${row.length} значений, а колонок ${width}`,
        });
      }
    });
    if (p.rows.length > 0 && p.rows.length !== 20) {
      warnings.push({ path: at, message: `строк ${p.rows.length}, а уровней обычно 20` });
    }
    const roles = p.columns.map((col) => col.role).filter((r) => r && r !== "resource" && r !== "stat");
    const dupe = roles.find((r, idx) => roles.indexOf(r) !== idx);
    if (dupe) errors.push({ path: at, message: `роль «${dupe}» стоит у двух колонок` });
  });

  // 5. Заклинание с временем «Иное» без пояснения бесполезно на листе.
  file.spells.forEach((s, i) => {
    if (s.casting_timing === "Иное" && !s.casting_timing_other?.trim()) {
      warnings.push({ path: `spells[${i}]`, message: "время «Иное» без пояснения, сколько именно" });
    }
  });

  const counts: Record<string, number> = {
    mechanics: file.mechanics.length,
    spells: file.spells.length,
    classes: file.classes.length,
    species: file.species.length,
    backgrounds: file.backgrounds.length,
    feats: file.feats.length,
    equipment: file.equipment.length,
    magic_items: file.magic_items.length,
    monsters: file.monsters.length,
  };

  const unresolved = [...unresolvedByRef.values()];
  for (const item of unresolved) {
    warnings.push({
      path: item.paths[0],
      message:
        item.paths.length > 1
          ? `«${item.ref}» не объявлен в файле — ссылок на него ${item.paths.length}`
          : `«${item.ref}» не объявлен в файле`,
    });
  }

  return { ok: errors.length === 0, errors, warnings, data: file, keys, counts, unresolved };
}
