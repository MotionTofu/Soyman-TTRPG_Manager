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
 * Основные рабочие файлы — в `assets/library/`, учёт и пути копий — в
 * `assets/manifest.json` (см. assets/README.md). Этот реестр задаёт ключи
 * для клиентского кода. Исторические оригиналы остаются в локальных `res/`
 * и `Archive/2026-09-12/raster-png/`.
 */

export type RasterCategory = "conditions" | "schools" | "coins" | "inventory" | "tokens" | "textures" | "mascot" | "cartography" | "crypt" | "village" | "ui/fantasy-punk/decorative/profile" | "ui/campaign-dossier/v1" | "ui/plot-restyle/v1";

/** Что реально лежит в раздаче. Ключ — имя файла без расширения. */
export const RASTER_ASSETS: Record<RasterCategory, readonly string[]> = {
  "ui/plot-restyle/v1": ["stamp-done", "stamp-skipped", "kind-window"],
  "ui/campaign-dossier/v1": ["card-paper", "portrait-frame", "view-label"],
  "ui/fantasy-punk/decorative/profile": ["tape", "seal"],
  // Local map artwork; provenance and crop/encoding manifest in maps/assets/cartography-pack.json.
  // «Подземелье · Склеп» (комикс-панк): provenance и хэши — maps/assets/crypt-pack.json.
  crypt: ["paper-panel", "sarcophagus", "coffin", "niche", "pentagram", "urn", "candles", "table", "bench", "chest", "barrels", "crates", "rug", "brazier", "well", "bones", "rubble", "pillar-broken", "pillar", "cobweb", "blood", "torch", "stairs-down", "stairs-up", "trapdoor", "pit", "spikes", "lever", "cage", "chains", "treasure", "grime-splash", "grime-splatter", "grime-scribble", "grime-hatch", "grime-x-black", "grime-x-magenta", "grime-chunks", "grime-toner", "grime-tape", "door", "door-double", "portcullis", "arch", "door-secret", "door-broken", "wall-masonry", "wall-masonry-end", "wall-masonry-corner", "wall-rock", "wall-rock-end", "wall-rock-corner", "throne-s", "throne-w", "throne-n", "throne-e", "altar-s", "altar-w", "altar-n", "altar-e", "statue-s", "statue-w", "statue-n", "statue-e", "chair-s", "chair-w", "chair-n", "chair-e", "wardrobe-s", "wardrobe-w", "wardrobe-n", "wardrobe-e", "bunk-s", "bunk-w", "bunk-n", "bunk-e", "floor-tiles", "floor-broken", "floor-cave", "floor-water"],
  // «Местность · Деревня у реки»: семейства с вариантами (`key`, `key-2`); provenance — maps/assets/village-pack.json.
  village: ["grass", "mud", "sand", "cobbles", "grass-2", "mud-2", "sand-2", "cobbles-2", "shallow", "deep", "bog", "field", "shallow-2", "deep-2", "bog-2", "field-2", "road-dirt", "road-path", "road-cobbles", "road-dirt-2", "road-path-2", "road-cobbles-2", "hut", "hut-small", "shed", "barn", "mill", "smithy", "willow", "tree", "spruce", "bush", "reeds", "grass-tuft", "stump", "log", "boulders", "willow-2", "tree-2", "spruce-2", "bush-2", "reeds-2", "grass-tuft-2", "stump-2", "log-2", "boulders-2", "well", "cart", "haystack", "woodpile", "sacks", "campfire", "beds", "boat", "signpost", "well-2", "cart-2", "haystack-2", "woodpile-2", "sacks-2", "campfire-2", "beds-2", "boat-2", "signpost-2", "bridge", "ford", "jetty", "tent", "stall", "barricade", "scarecrow", "graves", "idol", "bridge-2", "ford-2", "jetty-2", "tent-2", "stall-2", "barricade-2", "scarecrow-2", "graves-2", "idol-2", "fence-wattle", "fence-wattle-post", "fence-wattle-gate", "fence-pole", "fence-pole-post", "fence-pole-gate", "fence-wattle-2", "fence-wattle-post-2", "fence-wattle-gate-2", "fence-pole-2", "fence-pole-post-2", "fence-pole-gate-2"],
  cartography: ["stone-floor", "earth", "water", "stone-wall", "wood-door", "sarcophagus", "altar", "storage-cluster", "bone-pile", "rock-cluster", "stone-pillar", "torch", "pine", "mountain-ridge", "ruins", "outpost", "crypt-guard"],
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
  textures: ["dice-d20", "dice-d20-dark", "mastering-book-cloth", "mastering-shelf-wood"],
  mascot: [
    "agent-error",
    "agent-idle",
    "agent-waiting",
    "agent-working",
    "detective-error",
    "detective-idle",
    "detective-waiting",
    "detective-working",
    "hero-error",
    "hero-idle",
    "hero-waiting",
    "hero-working",
    "mage-error",
    "mage-idle",
    "mage-waiting",
    "mage-working",
    "pirate-error",
    "pirate-idle",
    "pirate-waiting",
    "pirate-working",
    "runner-error",
    "runner-idle",
    "runner-waiting",
    "runner-working",
    "taoist-error",
    "taoist-idle",
    "taoist-waiting",
    "taoist-working",
    "vampire-error",
    "vampire-idle",
    "vampire-waiting",
    "vampire-working",
    "walker-error",
    "walker-idle",
    "walker-waiting",
    "walker-working",
  ],
  // Курсор-паки (public/cursors/*.png) здесь НЕ числятся осознанно:
  // check-raster-assets требует webp, а Chromium молча отбрасывает webp
  // в cursor: url() — по спеке гарантирован только PNG.
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
