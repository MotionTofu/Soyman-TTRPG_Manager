/**
 * Значки школ магии: имена файлов держит реестр `src/rasterAssets.ts`,
 * там же записано правило растра. Здесь — только сопоставление имени
 * школы с ключом реестра.
 *
 * Школа заклинания — строка из справочника («Школы магии»), единого
 * перечисления в коде нет. Сопоставление — по корню (нижний регистр,
 * ё→е), как у состояний (conditionIcons.ts). Нет совпадения — нет
 * значка, текст школы в подписи остаётся.
 * Сверено с живой базой (8 записей группы «Школы магии»).
 */
import { rasterAsset } from "../../rasterAssets";

const SCHOOL_ICONS: { key: string; match: RegExp }[] = [
  { key: "abjuration", match: /огражд|abjur/ },
  { key: "conjuration", match: /вызов|conj/ },
  { key: "divination", match: /прориц|divin/ },
  { key: "enchantment", match: /очаров|enchant/ },
  { key: "evocation", match: /воплощ|evoc/ },
  { key: "illusion", match: /иллюз|illus/ },
  { key: "necromancy", match: /некромант|necro/ },
  { key: "transmutation", match: /преобраз|transmut/ },
];

/** Путь к значку школы по её имени из справочника, null — нет значка. */
export function schoolIconSrc(school: string | null | undefined): string | null {
  if (!school) return null;
  const text = school.toLowerCase().replace(/ё/g, "е").trim();
  if (!text) return null;
  const hit = SCHOOL_ICONS.find((s) => s.match.test(text));
  return hit ? rasterAsset("schools", hit.key) : null;
}
