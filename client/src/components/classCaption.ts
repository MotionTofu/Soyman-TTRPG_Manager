import type { CompendiumEntry } from "../types";

const ABILITY_ABBR: Record<string, string> = {
  "Сила": "СИЛ", "Ловкость": "ЛОВ", "Телосложение": "ТЕЛ",
  "Интеллект": "ИНТ", "Мудрость": "МДР", "Харизма": "ХАР",
};

function subclassWord(n: number): string {
  const tail = n % 100;
  if (tail >= 11 && tail <= 14) return "подклассов";
  if (n % 10 === 1) return "подкласс";
  if (n % 10 >= 2 && n % 10 <= 4) return "подкласса";
  return "подклассов";
}

/** «К8 · ИНТ · 4 подкласса» (макет «Д» Roll-Classes). Пустые части пропускаются. */
export function classCaption(entry: CompendiumEntry, subclasses: number): string | undefined {
  const raw = entry.data.hit_die ?? entry.data.hitDie;
  const die = typeof raw === "string" ? /\d+/.exec(raw)?.[0] : undefined;
  const abilities = Array.isArray(entry.data.primary_abilities)
    ? (entry.data.primary_abilities as string[]).map((a) => ABILITY_ABBR[a] ?? a.slice(0, 3).toUpperCase()).join("/")
    : "";
  const parts = [die ? `К${die}` : "", abilities, subclasses > 0 ? `${subclasses} ${subclassWord(subclasses)}` : ""];
  return parts.filter(Boolean).join(" · ") || undefined;
}
