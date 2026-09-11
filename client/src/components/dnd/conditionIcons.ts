/**
 * Значки состояний: рисованные PNG из `res/conditions` лежат в
 * `client/public/conditions/` — сам `res/` в репозиторий не входит
 * (.gitignore: 63 МБ исходников), поэтому нужные 15 файлов скопированы
 * в раздачу как есть, с исходными именами (включая опечатку posioned).
 *
 * Имена состояний хранятся строками из справочника системы — единого
 * перечисления нет, у каждой базы свои формулировки («Оглушённый»,
 * «Ошеломлённый», «Лежащий ничком»). Поэтому сопоставление — по корню
 * слова, а не по точному имени: нормализация (нижний регистр, ё→е) плюс
 * ordered-список stems. Нет совпадения — нет значка, текст остаётся.
 * Сверено с живой базой (15 записей группы «Состояния», сверка вариантов —
 * «Лежащий ничком»/«Сбит с ног»/«Опрокинут», «Оглушённый»/«Ошеломлённый»).
 */
const CONDITION_ICONS: { file: string; match: RegExp }[] = [
  { file: "blinded.png", match: /ослеп|ослепл|blind/ },
  { file: "charmed.png", match: /очар|charm/ },
  { file: "deafened.png", match: /оглох|глух|deaf/ },
  { file: "exhaustion.png", match: /истощ|exhaust/ },
  { file: "frightened.png", match: /испуг|страх|ужас|fright|fear/ },
  { file: "grappled.png", match: /схвач|схват|захвач|удерживаем|grappl/ },
  { file: "Incapacitated.png", match: /недееспособ|incapac/ },
  { file: "Invisible.png", match: /невидим|invis/ },
  { file: "Paralyzed.png", match: /парали|paral/ },
  { file: "petrified.png", match: /окамен|petrif/ },
  { file: "posioned.png", match: /отрав|poison|токси/ },
  { file: "prone.png", match: /ничком|распрост|лежит|сбит|опрокин|prone/ },
  { file: "restrained.png", match: /сдержан|опутан|связан|пута|restrain/ },
  { file: "stunned.png", match: /оглуш|ошеломл|stun/ },
  { file: "unconscious.png", match: /бессозн|без сознан|unconsc/ },
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
  return hit ? `/conditions/${hit.file}` : null;
}
