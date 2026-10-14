import { rasterAsset } from "../../rasterAssets";

/** «Местность · Деревня у реки» — второй набор комикс-панка (решения 2026-10-07).
 * Provenance — village-pack.json и `.scratch/map-locality/`. Картинки хранятся в родном
 * разрешении листа, размер на карте задают `cells`.
 *
 * Ассет — семейство с вариантами (решение владельца 2026-10-08): первый вариант лежит под
 * ключом семейства, остальные — `key-2`, `key-3`. В каталоге выбирают вариант или «случайный». */
export const VILLAGE_PACK = { id: "soyman-village", version: "1" } as const;
export type VillageCategory = "buildings" | "plants" | "yard" | "crossings" | "fences" | "water" | "liquids";
export const VILLAGE_CATEGORIES: Record<VillageCategory, string> = {
  buildings: "Постройки", plants: "Растения", yard: "Двор", crossings: "Переправы и лагерь", fences: "Ограды",
  water: "На воде", liquids: "Болото, лава, лёд",
};
/** cells — размер в клетках, как нарисовано. Здание — крыша-штамп: объект, внутрь не заходят. */
/** Размеры — по таблице настоящих размеров: клетка тактической карты — 1,5 м (решение 2026-10-08).
 * Здания — с листов E1/E2-buildings; малая изба нарисована квадратной (4×4 вместо 4×3), мельница — с колесом и
 * мостками (7×5 вместо 5×5). Лодка и грядки — с листов G2-yard. */
export const VILLAGE_OBJECTS: readonly { key: string; name: string; category: VillageCategory; cells: readonly [number, number]; variants: number }[] = [
  { key: "hut", name: "Изба", category: "buildings", cells: [5, 4], variants: 1 },
  { key: "hut-small", name: "Малая изба", category: "buildings", cells: [4, 4], variants: 1 },
  { key: "shed", name: "Сарай", category: "buildings", cells: [3, 2], variants: 1 },
  { key: "barn", name: "Амбар", category: "buildings", cells: [8, 5], variants: 1 },
  { key: "mill", name: "Мельница", category: "buildings", cells: [7, 5], variants: 1 },
  { key: "smithy", name: "Кузня", category: "buildings", cells: [4, 3], variants: 1 },
  { key: "willow", name: "Ива", category: "plants", cells: [4, 4], variants: 2 },
  { key: "tree", name: "Дерево", category: "plants", cells: [3, 3], variants: 2 },
  { key: "spruce", name: "Ель", category: "plants", cells: [2, 2], variants: 2 },
  { key: "bush", name: "Куст", category: "plants", cells: [1, 1], variants: 2 },
  { key: "reeds", name: "Камыш", category: "plants", cells: [1, 1], variants: 2 },
  { key: "grass-tuft", name: "Трава", category: "plants", cells: [1, 1], variants: 2 },
  { key: "stump", name: "Пень", category: "plants", cells: [1, 1], variants: 2 },
  { key: "log", name: "Бревно", category: "plants", cells: [2, 1], variants: 2 },
  { key: "boulders", name: "Валуны", category: "plants", cells: [1, 1], variants: 2 },
  { key: "well", name: "Колодец", category: "yard", cells: [1, 1], variants: 2 },
  { key: "cart", name: "Телега", category: "yard", cells: [1, 2], variants: 2 },
  { key: "haystack", name: "Стог", category: "yard", cells: [1, 1], variants: 2 },
  { key: "woodpile", name: "Поленница", category: "yard", cells: [2, 1], variants: 2 },
  { key: "sacks", name: "Мешки и бочки", category: "yard", cells: [1, 1], variants: 2 },
  { key: "campfire", name: "Костёр", category: "yard", cells: [1, 1], variants: 2 },
  { key: "beds", name: "Грядки", category: "yard", cells: [2, 3], variants: 2 },
  { key: "boat", name: "Лодка", category: "yard", cells: [1, 3], variants: 2 },
  { key: "signpost", name: "Указатель", category: "yard", cells: [1, 1], variants: 2 },
  { key: "bridge", name: "Мост", category: "crossings", cells: [2, 4], variants: 2 },
  { key: "ford", name: "Брод", category: "crossings", cells: [2, 3], variants: 2 },
  { key: "jetty", name: "Мостки", category: "crossings", cells: [1, 3], variants: 2 },
  { key: "tent", name: "Палатка", category: "crossings", cells: [2, 2], variants: 2 },
  { key: "stall", name: "Прилавок", category: "crossings", cells: [2, 1], variants: 2 },
  { key: "barricade", name: "Рогатки", category: "crossings", cells: [2, 1], variants: 2 },
  { key: "scarecrow", name: "Пугало", category: "crossings", cells: [1, 1], variants: 2 },
  { key: "graves", name: "Могилы", category: "crossings", cells: [1, 1], variants: 2 },
  { key: "idol", name: "Идол", category: "crossings", cells: [1, 1], variants: 2 },
  // Сама ограда — полоса в инструменте «Дорога»; здесь то, что ставят поштучно.
  { key: "fence-wattle-post", name: "Кол плетня", category: "fences", cells: [1, 1], variants: 2 },
  { key: "fence-wattle-gate", name: "Калитка плетня", category: "fences", cells: [1, 1], variants: 2 },
  { key: "fence-pole-post", name: "Столб ограды", category: "fences", cells: [1, 1], variants: 2 },
  { key: "fence-pole-gate", name: "Калитка ограды", category: "fences", cells: [1, 1], variants: 2 },
  // Листы W1/W2 (`.scratch/map-water`): нарисованы без воды, она просвечивает между листьями и камнями.
  { key: "lilies", name: "Кувшинки", category: "water", cells: [2, 2], variants: 1 },
  { key: "lilies-small", name: "Кувшинки, горсть", category: "water", cells: [1, 1], variants: 1 },
  { key: "lily-flower", name: "Кувшинка в цвету", category: "water", cells: [1, 1], variants: 1 },
  { key: "cattail", name: "Рогоз", category: "water", cells: [1, 1], variants: 1 },
  { key: "cattail-bed", name: "Заросли рогоза", category: "water", cells: [2, 1], variants: 1 },
  { key: "cattail-tufts", name: "Осока", category: "water", cells: [1, 1], variants: 1 },
  { key: "duckweed", name: "Ряска", category: "water", cells: [2, 2], variants: 1 },
  { key: "algae", name: "Тина", category: "water", cells: [2, 1], variants: 1 },
  { key: "leaves", name: "Листья на воде", category: "water", cells: [1, 1], variants: 1 },
  { key: "snag", name: "Коряга", category: "water", cells: [2, 2], variants: 1 },
  { key: "log-sunk", name: "Топляк", category: "water", cells: [2, 1], variants: 1 },
  { key: "driftwood", name: "Плавник", category: "water", cells: [2, 2], variants: 1 },
  { key: "rocks-wet", name: "Камни в воде", category: "water", cells: [1, 1], variants: 1 },
  { key: "rock-flat", name: "Плоский камень", category: "water", cells: [2, 2], variants: 1 },
  { key: "stepping-stones", name: "Камни-переход", category: "water", cells: [3, 1], variants: 1 },
  { key: "fish", name: "Тени рыб", category: "water", cells: [1, 1], variants: 1 },
  { key: "ripples", name: "Круги на воде", category: "water", cells: [1, 1], variants: 1 },
  { key: "wreckage", name: "Обломки", category: "water", cells: [2, 2], variants: 1 },
  // Лист L3.
  { key: "tussock", name: "Кочка", category: "liquids", cells: [1, 1], variants: 4 },
  { key: "dead-tree", name: "Утонувшее дерево", category: "liquids", cells: [2, 2], variants: 4 },
  { key: "gas-bubbles", name: "Пузыри газа", category: "liquids", cells: [1, 1], variants: 4 },
  { key: "basalt", name: "Базальтовый островок", category: "liquids", cells: [1, 1], variants: 4 },
  { key: "lava-crust", name: "Плита корки", category: "liquids", cells: [2, 2], variants: 4 },
  { key: "lava-stones", name: "Камни в лаве", category: "liquids", cells: [3, 1], variants: 4 },
  { key: "ice-floe", name: "Льдина", category: "liquids", cells: [2, 2], variants: 4 },
  { key: "ice-hole", name: "Лунка", category: "liquids", cells: [1, 1], variants: 4 },
  { key: "skeleton", name: "Скелет в кислоте", category: "liquids", cells: [2, 1], variants: 4 },
];
/** Ключи вариантов семейства: `well`, `well-2`. */
export const variantKeys = (key: string, variants: number) => Array.from({ length: variants }, (_, i) => i ? `${key}-${i + 1}` : key);

/** Поверхности набора. Код материала на карте — `village-<ключ варианта>`: варианты красятся
 * по отдельности и смешиваются на одной карте; в общий список террейнов они не входят. */
export const VILLAGE_SURFACES: readonly { key: string; name: string; fill: string; variants: number }[] = [
  { key: "grass", name: "Трава", fill: "#8a9a3c", variants: 2 },
  { key: "mud", name: "Грязь", fill: "#7a4f2c", variants: 2 },
  { key: "sand", name: "Песок", fill: "#e3b25c", variants: 2 },
  { key: "cobbles", name: "Брусчатка", fill: "#77736c", variants: 2 },
  { key: "shallow", name: "Мелководье", fill: "#2f9c8c", variants: 2 },
  { key: "deep", name: "Глубокая вода", fill: "#1d5a6c", variants: 2 },
  { key: "bog", name: "Топь", fill: "#4f5a22", variants: 2 },
  { key: "field", name: "Пашня", fill: "#8a5a34", variants: 2 },
];
/** Дороги и ограды — полоса, которую движок тянет вдоль линии. `width` — ширина по умолчанию, клеток.
 * Ограда — стена со своей полосой (инструмент «Стена»); на изломах и концах движок ставит её столб. */
export const VILLAGE_ROADS: readonly { key: string; name: string; group: "road" | "fence"; width: number; variants: number }[] = [
  { key: "road-dirt", name: "Грунтовая дорога", group: "road", width: 2, variants: 2 },
  { key: "road-path", name: "Тропа", group: "road", width: 1, variants: 2 },
  { key: "road-cobbles", name: "Мощёная дорога", group: "road", width: 3, variants: 2 },
  { key: "fence-wattle", name: "Плетень", group: "fence", width: 0.45, variants: 2 },
  { key: "fence-pole", name: "Жердяная ограда", group: "fence", width: 0.45, variants: 2 },
];
/** Реки: линия, залитая поверхностью воды. Картинка та же, что у поверхности, поэтому привязана к карте, а не к руслу. */
export const VILLAGE_RIVERS: readonly { key: string; name: string; width: number; variants: number }[] = [
  { key: "shallow", name: "Мелкая вода", width: 2, variants: 2 },
  { key: "deep", name: "Глубокая вода", width: 4, variants: 2 },
];
/** Столб ограды по id её полосы: `fence-wattle-2` → `fence-wattle-post-2`. */
export const fencePostId = (style: string) => /:fence-[a-z]+(-\d+)?$/.test(style) ? style.replace(/(-\d+)?$/, (tail) => `-post${tail}`) : null;
/** Настил переправы (листы C2-crossings) — полоса вместо дороги над водой. Вариант — тот же, что у дороги. */
export const deckKey = (kind: "bridge-wood" | "bridge-stone" | "ford", road: string) => `deck-${kind}${/-2$/.test(road) ? "-2" : ""}`;
export const VILLAGE_ROAD_KEYS = [...VILLAGE_ROADS.map(item => item.key), "deck-bridge-wood", "deck-bridge-stone", "deck-ford"].flatMap(key => variantKeys(key, 2));
const SURFACE_PREFIX = "village-";
export const villageSurfaceCode = (key: string) => `${SURFACE_PREFIX}${key}`;
/** Вода с глубиной (решение владельца 2026-10-08): одна поверхность «Вода», глубину 1–5 задаёт кисть.
 * Глубина живёт в коде материала — `village-water-3`, — поэтому формат карты не меняется. Вода-шейдер
 * рисует плавный переход между глубинами; вода-картинка знает только два рисунка и делит шкалу пополам. */
/** Глубина реки-линии 1–5: своя, а без неё — по виду реки (мелкая 2, глубокая 4). */
export const riverDepth = (path: { style?: string; depth?: number }) => path.depth ?? (/deep/.test(path.style ?? "") ? 4 : 2);
export const WATER_DEPTHS = [1, 2, 3, 4, 5] as const;
/** Рецепт жидкости — всё, чем одна жидкость отличается от другой (решение владельца 2026-10-08). Шейдер рисует любую
 * как воду выбранного вида, а рецепт её перекрашивает и перенастраивает.
 * `tones` — глубина, середина, блик; у воды они не применяются: у каждого вида воды своя палитра.
 * `pace` — подвижность (0 — застыла, 1 — вода); `size` — крупность рисунка; `bed` — насколько видно дно на мели;
 * `glow` — свечение: подсвечивает берег; `solid` — по ней ходят, переправа не нужна. */
export interface LiquidRecipe {
  key: string; name: string; /** Цвет плитки, пока нет картинки; у своих жидкостей — средний тон. */ fill?: string; tones: readonly [string, string, string];
  pace: number; size: number; pattern: LiquidPattern; bed: number; rim: LiquidRim; glow: number; solid: boolean;
  /** Берег: ширина перехода и рваность, 0…1. У своих рецептов без них — как у воды. */ shore?: number; ragged?: number;
}
/** Рисунок поверхности: рябь — родной рисунок вида воды, остальные ложатся поверх приглушённого. */
export const LIQUID_PATTERNS = { ripple: "Рябь", cracks: "Трещины", bubbles: "Пузыри", mist: "Туман", smooth: "Гладь" } as const;
export type LiquidPattern = keyof typeof LIQUID_PATTERNS;
/** Кромка: пена и мокрая полоса, только мокрая полоса, обугленный край или ничего. */
export const LIQUID_RIMS = { foam: "Пена и мокрый берег", none: "Ничего", scorch: "Обугленный край", wet: "Мокрый берег" } as const;
export type LiquidRim = keyof typeof LIQUID_RIMS;
/** Жидкости: вода и её родня. Красятся той же кистью с той же глубиной, код — `village-lava-3`. Номер в списке —
 * номер жидкости в маске и в шейдере (вода — 0); шейдер рисует их как воду, перекрашенную в свою шкалу тонов.
 * Картинки (листы L1/L2) — для вида «Картинкой» и под шейдером; у лавы на мели остывшая корка (`lava-2`),
 * у льда на глубине тонкий тёмный лёд (`ice-2`). */
export const LIQUIDS = [
  { key: "water", name: "Вода", fill: "#2f9c8c", tones: ["#213e5c", "#2f9c8c", "#eefaf2"], pace: 1, size: 1, pattern: "ripple", bed: 1, rim: "foam", glow: 0, solid: false, shore: 0.4, ragged: 0.4 },
  { key: "swamp", name: "Болото", fill: "#4a5226", tones: ["#212612", "#4d5724", "#9ead5c"], pace: 0.5, size: 1.2, pattern: "bubbles", bed: 0.4, rim: "foam", glow: 0, solid: false, shore: 0.8, ragged: 0.75 },
  { key: "lava", name: "Лава", fill: "#c8421a", tones: ["#290d0a", "#b82e0a", "#ffe666"], pace: 0.35, size: 1.5, pattern: "ripple", bed: 0, rim: "scorch", glow: 0.8, solid: false, shore: 0.2, ragged: 0.8 },
  { key: "ice", name: "Лёд", fill: "#cfe6ee", tones: ["#8cb8d1", "#cce6f0", "#ffffff"], pace: 0, size: 1, pattern: "cracks", bed: 0.3, rim: "none", glow: 0, solid: true, shore: 0.05, ragged: 0.1 },
  { key: "acid", name: "Кислота", fill: "#a4c21f", tones: ["#33540d", "#99c71a", "#edff99"], pace: 1.2, size: 1, pattern: "bubbles", bed: 0.5, rim: "scorch", glow: 0.4, solid: false, shore: 0.4, ragged: 0.4 },
  { key: "tar", name: "Смола", fill: "#1c1a1a", tones: ["#08080a", "#1f1a17", "#6b5c4d"], pace: 0.25, size: 1.8, pattern: "smooth", bed: 0, rim: "wet", glow: 0, solid: false, shore: 0.5, ragged: 0 },
  { key: "chasm", name: "Пропасть с туманом", fill: "#232a36", tones: ["#05080f", "#1a2133", "#8c99ad"], pace: 0.5, size: 1.5, pattern: "mist", bed: 0, rim: "none", glow: 0, solid: false, shore: 0.3, ragged: 0.8 },
] as const satisfies readonly LiquidRecipe[];
export type LiquidKey = typeof LIQUIDS[number]["key"];
/** Ключи своих жидкостей карты: рецепты лежат в `appearance.liquids`. */
export const OWN_LIQUID_KEYS = ["own1", "own2", "own3", "own4", "own5", "own6", "own7"] as const;
export const waterCode = (depth: number, kind: string = "water") => villageSurfaceCode(`${kind}-${depth}`);
const WATER = new RegExp(`^village-(${[...LIQUIDS.map(item => item.key), ...OWN_LIQUID_KEYS].join("|")})-([1-5])$`);
/** Ключ жидкости по коду материала; вода и всё, что не жидкость, — `water`. */
export const liquidKey = (code: string | null | undefined) => WATER.exec(code ?? "")?.[1] ?? "water";
/** Рецепт по ключу: готовый или свой из карты. Незнакомый ключ (рецепт удалён) рисуется водой. */
export const liquidRecipe = (key: string, own?: readonly LiquidRecipe[]): LiquidRecipe => LIQUIDS.find(item => item.key === key) ?? own?.find(item => item.key === key) ?? LIQUIDS[0];
/** Глубина жидкости по коду материала: 0 — не жидкость. Прежние «мелководье» и «глубокая вода» — глубины 2 и 4. */
export const waterLevel = (code: string | null | undefined) => !code ? 0 : WATER.test(code) ? Number(WATER.exec(code)![2])
  : /deep|sea|lake/.test(code) ? 4 : /shallow|water/.test(code) ? 2 : 0;
/** Номер жидкости в `LIQUIDS`; вода и всё, что не жидкость, — 0. */
export const liquidKind = (code: string | null | undefined) => Math.max(0, LIQUIDS.findIndex(item => item.key === WATER.exec(code ?? "")?.[1]));
const WATER_PICTURE = ["shallow", "shallow", "shallow-2", "deep", "deep-2"], WATER_FILL = ["#58b9a6", "#2f9c8c", "#27808a", "#1d5a6c", "#143f55"];
/** Ключ картинки по коду материала; `null` — код не из этого набора. */
export const villageSurfaceKey = (code: string) => !code.startsWith(SURFACE_PREFIX) ? null
  : !WATER.test(code) ? code.slice(SURFACE_PREFIX.length) : liquidPicture(liquidKey(code), waterLevel(code));
const liquidPicture = (kind: string, level: number) => kind === "water" ? WATER_PICTURE[level - 1]
  : kind === "lava" && level <= 2 ? "lava-2" : kind === "ice" && level >= 4 ? "ice-2" : kind;
/** Все картинки жидкостей: набор грузит их по тому, что накрашено. */
export const LIQUID_PICTURES = ["swamp", "lava", "lava-2", "ice", "ice-2", "acid", "tar", "chasm"] as const;
/** Цвет, пока картинка грузится, и в «Чертеже». */
export const VILLAGE_FILL: Readonly<Record<string, string>> = Object.fromEntries([...VILLAGE_SURFACES.flatMap(item =>
  variantKeys(item.key, item.variants).map(key => [villageSurfaceCode(key), item.fill])), ...WATER_DEPTHS.map(depth => [waterCode(depth), WATER_FILL[depth - 1]]),
  ...LIQUIDS.slice(1).flatMap(item => WATER_DEPTHS.map(depth => [waterCode(depth, item.key), item.fill]))]);
export const VILLAGE_SURFACE_KEYS = VILLAGE_SURFACES.flatMap(item => variantKeys(item.key, item.variants));

export const villageId = (key: string) => `${VILLAGE_PACK.id}:${key}`;
export const villageUrl = (key: string) => rasterAsset("village", key)!;
const objectByKey = new Map(VILLAGE_OBJECTS.flatMap(item => variantKeys(item.key, item.variants).map(key => [key, item] as const)));
export const villageObject = (id: string) => id.startsWith(`${VILLAGE_PACK.id}:`) ? objectByKey.get(id.slice(VILLAGE_PACK.id.length + 1)) ?? null : null;

/** «Случайный вариант» в каталоге — id семейства со звёздочкой; на карту всегда попадает конкретный вариант. */
export const randomVariantId = (key: string) => `${villageId(key)}*`;
export function pickVariant(assetId: string, random: () => number = Math.random): string {
  if (!assetId.endsWith("*")) return assetId;
  const family = assetId.slice(0, -1), item = villageObject(family);
  if (!item) return family;
  return villageId(variantKeys(item.key, item.variants)[Math.floor(random() * item.variants)]);
}

/** Россыпи: экземпляры берутся из вариантов семейства вразнобой. `size` — клеток на экземпляр при размере 1. */
const scatter = (slug: string, name: string, key: string, size: number, variants = 2) =>
  ({ key: `scatter/village-${slug}-v1`, name, assetId: villageId(key), assetIds: variantKeys(key, variants).map(villageId), size });
export const VILLAGE_SCATTER = [
  scatter("willows", "Ивы", "willow", 4), scatter("trees", "Лиственный лес", "tree", 3), scatter("spruces", "Ельник", "spruce", 2.4),
  scatter("bushes", "Кусты", "bush", 1.2), scatter("reeds", "Камыш", "reeds", 1.2), scatter("grass", "Трава", "grass-tuft", 1),
  scatter("boulders", "Валуны", "boulders", 1),
  scatter("lilies", "Кувшинки", "lilies-small", 1.2, 1), scatter("cattails", "Рогоз", "cattail", 1.2, 1), scatter("leaves", "Листья на воде", "leaves", 1, 1),
];
