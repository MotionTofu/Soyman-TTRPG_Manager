/**
 * Значки состояний: имена файлов держит реестр `src/rasterAssets.ts` —
 * там же записано и само правило растра (формат, вес, текстовая пара,
 * поведение на печати). Здесь остаётся только сопоставление имени
 * состояния с ключом реестра.
 *
 * Имена состояний хранятся строками из справочника системы — единого
 * перечисления нет, у каждой базы свои формулировки («Оглушённый»,
 * «Ошеломлённый», «Лежащий ничком»). Поэтому сопоставление — по корню
 * слова, а не по точному имени: нормализация (нижний регистр, ё→е) плюс
 * ordered-список stems. Нет совпадения — нет значка, текст остаётся.
 * Сверено с живой базой (15 записей группы «Состояния», сверка вариантов —
 * «Лежащий ничком»/«Сбит с ног»/«Опрокинут», «Оглушённый»/«Ошеломлённый»).
 */
import { rasterAsset } from "../../rasterAssets";

const CONDITION_ICONS: { key: string; match: RegExp }[] = [
  { key: "blinded", match: /ослеп|ослепл|blind/ },
  { key: "charmed", match: /очар|charm/ },
  { key: "deafened", match: /оглох|глух|deaf/ },
  { key: "exhaustion", match: /истощ|exhaust/ },
  { key: "frightened", match: /испуг|страх|ужас|fright|fear/ },
  { key: "grappled", match: /схвач|схват|захвач|удерживаем|grappl/ },
  { key: "incapacitated", match: /недееспособ|incapac/ },
  { key: "invisible", match: /невидим|invis/ },
  { key: "paralyzed", match: /парали|paral/ },
  { key: "petrified", match: /окамен|petrif/ },
  { key: "poisoned", match: /отрав|poison|токси/ },
  { key: "prone", match: /ничком|распрост|лежит|сбит|опрокин|prone/ },
  { key: "restrained", match: /сдержан|опутан|связан|пута|restrain/ },
  { key: "stunned", match: /оглуш|ошеломл|stun/ },
  { key: "unconscious", match: /бессозн|без сознан|unconsc/ },
];

function normalizeConditionName(name: string): string {
  return name.toLowerCase().replace(/ё/g, "е").trim();
}

/** Путь к значку состояния по его имени из справочника, null — нет значка. */
export function conditionIconSrc(name: string | null | undefined): string | null {
  if (!name) return null;
  const text = normalizeConditionName(name);
  if (!text) return null;
  const hit = CONDITION_ICONS.find((c) => c.match.test(text));
  return hit ? rasterAsset("conditions", hit.key) : null;
}
