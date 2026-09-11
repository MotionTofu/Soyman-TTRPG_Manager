/**
 * Значки школ магии: рисованные PNG из `res/SoM` лежат в
 * `client/public/schools/` — сам `res/` в репозиторий не входит
 * (.gitignore), поэтому 8 файлов скопированы в раздачу как есть,
 * с исходными именами и регистром.
 *
 * Школа заклинания — строка из справочника («Школы магии»), единого
 * перечисления в коде нет. Сопоставление — по корню (нижний регистр,
 * ё→е), как у состояний (conditionIcons.ts). Нет совпадения — нет
 * значка, текст школы в подписи остаётся.
 * Сверено с живой базой (8 записей группы «Школы магии»).
 */
const SCHOOL_ICONS: { file: string; match: RegExp }[] = [
  { file: "Abjuration.png", match: /огражд|abjur/ },
  { file: "conjuration.png", match: /вызов|conj/ },
  { file: "Divination.png", match: /прориц|divin/ },
  { file: "Enchantment.png", match: /очаров|enchant/ },
  { file: "evocation.png", match: /воплощ|evoc/ },
  { file: "Illusion.png", match: /иллюз|illus/ },
  { file: "Necromancy.png", match: /некромант|necro/ },
  { file: "Transmutation.png", match: /преобраз|transmut/ },
];

/** Путь к значку школы по её имени из справочника, null — нет значка. */
export function schoolIconSrc(school: string | null | undefined): string | null {
  if (!school) return null;
  const text = school.toLowerCase().replace(/ё/g, "е").trim();
  if (!text) return null;
  const hit = SCHOOL_ICONS.find((s) => s.match.test(text));
  return hit ? `/schools/${hit.file}` : null;
}
