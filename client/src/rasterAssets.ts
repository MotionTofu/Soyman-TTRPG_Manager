/**
 * Реестр растровых ассетов интерфейса — единственное место, где живут их имена.
 *
 * ПРАВИЛО РАСТРА (решения гриллинга 2026-09-12, свод — `MainWorks/
 * Растр_как_материал_—_решения_2026-09-12.md`):
 *
 * 1. Растр — полноправный материал системы, а не уступка. Наклейка опознаётся
 *    быстрее слова: у Мастера за столом заняты руки и голова, значок он ловит
 *    боковым зрением. Границы по разделу или роли нет — где уместно, там и стоит.
 * 2. Наклейка **узнаёт, но не сообщает**: у неё всегда есть текстовая пара
 *    рядом (подпись, `title` по ховеру или строка списка). Значок без слова —
 *    дефект: пятнадцать состояний D&D наизусть не помнит никто, а листом
 *    пользуются и игроки.
 * 3. Тему растр не знает. Наклейка непрозрачна и несёт свой фон, поэтому
 *    читается на любой бумаге. **Контурный** ассет — исключение: чёрная линия
 *    на чернилах пропадает, поэтому ему нужна пара light/dark (`textures`).
 * 4. Формат `webp`, сторона не больше двойной экранной, вес **не больше
 *    100 КБ**. Принуждается `client/scripts/check-raster-assets.mjs`.
 *    Барьер **не запрещает, а требует причину**: превышение проходит, если
 *    ассет назван в `client/scripts/raster-exceptions.json` с непустым
 *    полем `reason`. Так отступление становится записью, а не нарушением.
 * 5. На печати наклейки гаснут — остаётся слово (см. `@media print` в
 *    `dnd-sheet.css`). Цветной квадрат на чёрно-белом принтере превращается
 *    в серое пятно и мешает, а текстовая пара из п.2 есть всегда.
 *
 * Почему реестр, а не строки по коду: путь вида `/conditions/blinded.png`
 * ломается при любой смене формата или раскладки, а таких строк было пять
 * мест в трёх файлах. То же правило, что `CONTEXT.md` держит для реестра
 * видов сущностей: литерал на месте — это копия реестра.
 *
 * Имена файлов — только нижний регистр. На Windows регистр не важен, а
 * самостоятельный хостинг предусмотрен (`deploy/nginx.conf`), и на Linux
 * `Invisible.webp` рядом с `blinded.webp` давал бы 404 через раз.
 *
 * Исходники — в `res/` (в репозиторий не входит, 63 МБ). Исходные png после
 * перевода в webp лежат в `Archive/2026-09-12/raster-png/`.
 */

export type RasterCategory = "conditions" | "schools" | "coins" | "inventory" | "tokens" | "textures";

/** Что реально лежит в раздаче. Ключ — имя файла без расширения. */
export const RASTER_ASSETS: Record<RasterCategory, readonly string[]> = {
  conditions: [
    "blinded",
    "charmed",
    "deafened",
    "exhaustion",
    "frightened",
    "grappled",
    "incapacitated",
    "invisible",
    "paralyzed",
    "petrified",
    "poisoned",
    "prone",
    "restrained",
    "stunned",
    "unconscious",
  ],
  schools: [
    "abjuration",
    "conjuration",
    "divination",
    "enchantment",
    "evocation",
    "illusion",
    "necromancy",
    "transmutation",
  ],
  coins: ["cp", "sp", "ep", "gp", "pp"],
  inventory: ["amulet", "key", "pack", "potion", "pouch", "shield", "sword", "wand"],
  tokens: ["familiar", "inspiration", "rest"],
  // Контурный ассет: пара light/dark по п.3.
  textures: ["dice-d20", "dice-d20-dark"],
};

const EXT = ".webp";

/**
 * Путь к растровому ассету. `null`, если такого ключа в реестре нет —
 * вызывающий обязан пережить отсутствие значка (текст остаётся, п.2).
 */
export function rasterAsset(category: RasterCategory, key: string | null | undefined): string | null {
  if (!key) return null;
  return (RASTER_ASSETS[category] as readonly string[]).includes(key) ? `/${category}/${key}${EXT}` : null;
}

/** Есть ли такой ассет в раздаче. */
export function hasRasterAsset(category: RasterCategory, key: string): boolean {
  return (RASTER_ASSETS[category] as readonly string[]).includes(key);
}
