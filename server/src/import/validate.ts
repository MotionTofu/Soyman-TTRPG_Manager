// Смысловая проверка файла adventure-import/1 — то, что нельзя выразить схемой,
// потому что нужен файл целиком: уникальность ключей, ссылки в никуда, меншены
// на несозданные сущности, осмысленность дат.
//
// Делится на две категории:
//   errors   — импорт невозможен (сломан JSON, дубли ключей, чужой format);
//   warnings — импорт пройдёт, но что-то потеряется (висячая ссылка молча не
//              создастся, меншен останется текстом, кривая дата не попадёт в
//              календарь). Ронять разбор целой книги из-за одной битой ссылки
//              нельзя — на пробных прогонах такие ссылки были в каждом файле.

import { z } from "zod";
import {
  importFileSchema,
  ImportFile,
  KEY_PREFIX_TO_TYPE,
  UNLINKABLE_PREFIXES,
  prefixOf,
} from "./format";

export interface Problem {
  path: string;
  message: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: Problem[];
  warnings: Problem[];
  data: ImportFile | null;
  /** Ключи, объявленные в этом файле: key → тип сущности приложения. */
  keys: Record<string, string>;
  counts: Record<string, number>;
}

/** Меншены [[key|подпись]] в тексте. Глобальный, потому что их в поле много. */
export const MENTION_RE = /\[\[([^\]|]+)\|([^\]]*)\]\]/g;

function issuePath(issue: z.core.$ZodIssue): string {
  return issue.path.length ? issue.path.join(".") : "(корень)";
}

/** Обходит все строковые поля объекта, отдавая путь и значение. */
function walkStrings(value: unknown, path: string, visit: (path: string, text: string) => void) {
  if (typeof value === "string") visit(path, value);
  else if (Array.isArray(value)) value.forEach((v, i) => walkStrings(v, `${path}[${i}]`, visit));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) walkStrings(v, path ? `${path}.${k}` : k, visit);
  }
}

/**
 * @param known ключи, уже импортированные в этот сеттинг раньше (многофайловость):
 *              ссылка на них не считается висячей.
 */
export function validateImport(raw: unknown, known: Record<string, string> = {}): ValidationResult {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];

  const parsed = importFileSchema.safeParse(raw);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      errors.push({ path: issuePath(issue), message: issue.message });
    }
    return { ok: false, errors, warnings, data: null, keys: {}, counts: {} };
  }
  const data = parsed.data;

  // --- ключи ---------------------------------------------------------------
  const keys: Record<string, string> = {};
  const declare = (key: string, path: string) => {
    if (keys[key]) {
      errors.push({ path, message: `ключ «${key}» объявлен дважды` });
      return;
    }
    // Пустая строка — ключ объявлен, но своей страницы в приложении у него нет
    // (вехи, тайны): ссылаться на него можно, сделать меншеном — нет.
    const prefix = prefixOf(key);
    keys[key] = (prefix && KEY_PREFIX_TO_TYPE[prefix]) || "";
  };

  data.locations.forEach((l, i) => declare(l.key, `locations[${i}]`));
  data.beings.forEach((b, i) => declare(b.key, `beings[${i}]`));
  data.bestiary.forEach((b, i) => declare(b.key, `bestiary[${i}]`));
  data.communities.forEach((c, i) => declare(c.key, `communities[${i}]`));
  data.treasury.forEach((t, i) => declare(t.key, `treasury[${i}]`));
  data.adventures.forEach((a, i) => {
    declare(a.key, `adventures[${i}]`);
    a.chapters.forEach((c, j) => declare(c.key, `adventures[${i}].chapters[${j}]`));
    a.scenes.forEach((s, j) => declare(s.key, `adventures[${i}].scenes[${j}]`));
    a.milestones.forEach((m, j) => declare(m.key, `adventures[${i}].milestones[${j}]`));
    a.secrets.forEach((s, j) => declare(s.key, `adventures[${i}].secrets[${j}]`));
  });

  const resolvable = (key: string) => key in keys || key in known;
  const typeOf = (key: string) => keys[key] ?? known[key] ?? null;

  // --- ссылки --------------------------------------------------------------
  // allowed = префиксы, которые здесь осмысленны; ссылка не того типа так же
  // бесполезна, как висячая, — обе молча не создадутся.
  const checkRef = (
    value: string | null | undefined,
    path: string,
    allowed: string[]
  ) => {
    if (!value) return;
    if (!resolvable(value)) {
      warnings.push({ path, message: `ссылка в никуда: «${value}» — такой сущности нет` });
      return;
    }
    const prefix = prefixOf(value);
    if (prefix && !allowed.includes(prefix)) {
      warnings.push({
        path,
        message: `сюда нельзя ссылаться на «${value}»: ожидается ${allowed.join(", ")}`,
      });
    }
  };
  const checkRefs = (list: string[], path: string, allowed: string[]) =>
    list.forEach((v, i) => checkRef(v, `${path}[${i}]`, allowed));

  data.locations.forEach((l, i) => checkRef(l.parent, `locations[${i}].parent`, ["loc."]));
  data.beings.forEach((b, i) => {
    checkRefs(b.locations, `beings[${i}].locations`, ["loc."]);
    checkRefs(b.communities, `beings[${i}].communities`, ["com."]);
  });
  data.bestiary.forEach((b, i) => checkRefs(b.locations, `bestiary[${i}].locations`, ["loc."]));
  data.communities.forEach((c, i) => {
    checkRef(c.parent, `communities[${i}].parent`, ["com."]);
    checkRefs(c.locations, `communities[${i}].locations`, ["loc."]);
  });

  data.adventures.forEach((a, i) => {
    const ownChapters = new Set(a.chapters.map((c) => c.key));
    a.scenes.forEach((s, j) => {
      const at = `adventures[${i}].scenes[${j}]`;
      if (s.chapter) {
        checkRef(s.chapter, `${at}.chapter`, ["chp."]);
        if (resolvable(s.chapter) && !ownChapters.has(s.chapter)) {
          warnings.push({
            path: `${at}.chapter`,
            message: `глава «${s.chapter}» принадлежит другому приключению — сцена ляжет в приключение целиком`,
          });
        }
      }
      checkRefs(s.locations, `${at}.locations`, ["loc."]);
      checkRefs(s.participants, `${at}.participants`, ["npc.", "bst.", "com."]);
      checkRefs(s.items, `${at}.items`, ["item."]);
      s.next.forEach((n, k) => checkRef(n.to, `${at}.next[${k}].to`, ["scn."]));
      s.rewards.forEach((r, k) => checkRef(r.item, `${at}.rewards[${k}].item`, ["item."]));
    });
    a.milestones.forEach((m, j) =>
      checkRef(m.scene, `adventures[${i}].milestones[${j}].scene`, ["scn."])
    );
    a.rewards.forEach((r, j) => checkRef(r.item, `adventures[${i}].rewards[${j}].item`, ["item."]));
  });

  data.relations.forEach((r, i) => {
    checkRef(r.from, `relations[${i}].from`, ["npc.", "com."]);
    checkRef(r.to, `relations[${i}].to`, ["npc.", "com."]);
  });
  data.links.forEach((l, i) => {
    checkRef(l.from, `links[${i}].from`, Object.keys(KEY_PREFIX_TO_TYPE));
    checkRef(l.to, `links[${i}].to`, Object.keys(KEY_PREFIX_TO_TYPE));
  });

  // --- меншены -------------------------------------------------------------
  // Ловим и придуманные типы ([[заклинание:fear|…]] — реальный случай с прогона
  // DeepSeek), и ссылки на несозданные сущности.
  const seenBadMention = new Set<string>();
  walkStrings(data, "", (path, text) => {
    if (!text.includes("[[")) return;
    for (const m of text.matchAll(MENTION_RE)) {
      const key = m[1];
      if (resolvable(key)) {
        const prefix = prefixOf(key);
        if (prefix && UNLINKABLE_PREFIXES.includes(prefix) && !seenBadMention.has(key)) {
          seenBadMention.add(key);
          warnings.push({
            path,
            message: `на «${key}» нельзя сослаться: у вех и тайн нет своей страницы — останется текстом`,
          });
        }
        continue;
      }
      if (seenBadMention.has(key)) continue;
      seenBadMention.add(key);
      warnings.push({ path, message: `упоминание «${key}» ведёт в никуда — останется текстом` });
    }
  });

  // --- даты ----------------------------------------------------------------
  data.calendar_events.forEach((e, i) => {
    if (e.month < 1 || e.day < 1) {
      warnings.push({
        path: `calendar_events[${i}]`,
        message: `«${e.title}»: месяц и день нумеруются с единицы — событие не попадёт в календарь`,
      });
    }
  });
  const checkDay = (day: number, month: number | null | undefined, path: string, title: string) => {
    if (day < 1 || (month != null && month < 1)) {
      warnings.push({ path, message: `«${title}»: месяц и день нумеруются с единицы — дата пропущена` });
    }
  };
  data.beings.forEach((b, i) =>
    b.important_dates.forEach((d, j) =>
      checkDay(d.day, d.month, `beings[${i}].important_dates[${j}]`, d.title)
    )
  );

  const scenes = data.adventures.flatMap((a) => a.scenes);
  const counts = {
    локации: data.locations.length,
    личности: data.beings.length,
    бестиарий: data.bestiary.length,
    сообщества: data.communities.length,
    предметы: data.treasury.length,
    приключения: data.adventures.length,
    главы: data.adventures.flatMap((a) => a.chapters).length,
    сцены: scenes.length,
    вехи: data.adventures.flatMap((a) => a.milestones).length,
    тайны: data.adventures.flatMap((a) => a.secrets).length,
    проверки: scenes.flatMap((s) => s.checks).length,
    награды: scenes.flatMap((s) => s.rewards).length + data.adventures.flatMap((a) => a.rewards).length,
    события: data.calendar_events.length,
    отношения: data.relations.length,
    связи: data.links.length,
  };

  return { ok: errors.length === 0, errors, warnings, data, keys, counts };
}
