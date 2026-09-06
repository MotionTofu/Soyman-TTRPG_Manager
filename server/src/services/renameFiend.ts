/**
 * Переименование типа «бестия» → «исчадие» (новый официальный перевод).
 *
 * Чистая строковая замена по всем падежам с сохранением регистра первой
 * буквы. «Бестиарий» не задевается: после «бести» там идёт «а», ни одно
 * окончание не подходит. Граница слева — не буква: дефис границей считается
 * («бестий-военачальников» → «исчадий-военачальников»).
 */

const ENDINGS: Record<string, string> = {
  ями: "иями",
  ям: "иям",
  ях: "иях",
  ею: "иею",
  ей: "ием",
  ю: "ие",
  я: "ие",
  е: "ию",
  и: "ия",
  й: "ий",
};

// Окончания — от длинных к коротким, иначе «бестиями» срежется как «бестия».
const RE = /(^|[^а-яёa-z])(бести)(ями|ям|ях|ею|ей|ю|я|е|и|й)/giu;

export function renameFiendText(text: string): { text: string; count: number } {
  if (typeof text !== "string" || !/[бБ]ести/.test(text)) return { text, count: 0 };
  let count = 0;
  const out = text.replace(
    RE,
    (match: string, prefix: string, stem: string, ending: string) => {
      const to = ENDINGS[ending.toLowerCase()];
      if (!to) return match;
      count++;
      // Основа «исчади» + хвост нового окончания: исчадие, исчадия, исчадий…
      const stemOut = stem[0] === stem[0].toUpperCase() ? "Исчади" : "исчади";
      return prefix + stemOut + to.slice(1);
    }
  );
  return { text: out, count };
}
