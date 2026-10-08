import { rasterAsset } from "../../rasterAssets";

/** «Местность · Деревня у реки» — второй набор комикс-панка (решения 2026-10-07).
 * Provenance — village-pack.json и `.scratch/map-locality/`. Картинки хранятся в родном
 * разрешении листа, размер на карте задают `cells`.
 *
 * Ассет — семейство с вариантами (решение владельца 2026-10-08): первый вариант лежит под
 * ключом семейства, остальные — `key-2`, `key-3`. В каталоге выбирают вариант или «случайный». */
export const VILLAGE_PACK = { id: "soyman-village", version: "1" } as const;
export type VillageCategory = "buildings" | "plants" | "yard" | "crossings" | "fences";
export const VILLAGE_CATEGORIES: Record<VillageCategory, string> = {
  buildings: "Постройки", plants: "Растения", yard: "Двор", crossings: "Переправы и лагерь", fences: "Ограды",
};
/** cells — размер в клетках, как нарисовано. Здание — крыша-штамп: объект, внутрь не заходят. */
/** Размеры — по таблице настоящих размеров: клетка тактической карты — 1,5 м (решение 2026-10-08).
 * Здания, лодка и грядки ждут новых листов (E1/E2-buildings, G2-yard) и пока в прежних размерах. */
export const VILLAGE_OBJECTS: readonly { key: string; name: string; category: VillageCategory; cells: readonly [number, number]; variants: number }[] = [
  { key: "hut", name: "Изба", category: "buildings", cells: [4, 3], variants: 1 },
  { key: "hut-small", name: "Малая изба", category: "buildings", cells: [3, 3], variants: 1 },
  { key: "shed", name: "Сарай", category: "buildings", cells: [2, 2], variants: 1 },
  { key: "barn", name: "Амбар", category: "buildings", cells: [5, 3], variants: 1 },
  { key: "mill", name: "Мельница", category: "buildings", cells: [4, 4], variants: 1 },
  { key: "smithy", name: "Кузня", category: "buildings", cells: [3, 2], variants: 1 },
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
  { key: "beds", name: "Грядки", category: "yard", cells: [2, 2], variants: 2 },
  { key: "boat", name: "Лодка", category: "yard", cells: [1, 2], variants: 2 },
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
export const VILLAGE_ROAD_KEYS = VILLAGE_ROADS.flatMap(item => variantKeys(item.key, item.variants));
const SURFACE_PREFIX = "village-";
export const villageSurfaceCode = (key: string) => `${SURFACE_PREFIX}${key}`;
/** Вода с глубиной (решение владельца 2026-10-08): одна поверхность «Вода», глубину 1–5 задаёт кисть.
 * Глубина живёт в коде материала — `village-water-3`, — поэтому формат карты не меняется. Вода-шейдер
 * рисует плавный переход между глубинами; вода-картинка знает только два рисунка и делит шкалу пополам. */
/** Глубина реки-линии 1–5: своя, а без неё — по виду реки (мелкая 2, глубокая 4). */
export const riverDepth = (path: { style?: string; depth?: number }) => path.depth ?? (/deep/.test(path.style ?? "") ? 4 : 2);
export const WATER_DEPTHS = [1, 2, 3, 4, 5] as const;
export const waterCode = (depth: number) => villageSurfaceCode(`water-${depth}`);
const WATER = /^village-water-([1-5])$/;
/** Глубина воды по коду материала: 0 — не вода. Прежние «мелководье» и «глубокая вода» — глубины 2 и 4. */
export const waterLevel = (code: string | null | undefined) => !code ? 0 : WATER.test(code) ? Number(WATER.exec(code)![1])
  : /deep|sea|lake/.test(code) ? 4 : /shallow|water/.test(code) ? 2 : 0;
const WATER_PICTURE = ["shallow", "shallow", "shallow-2", "deep", "deep-2"], WATER_FILL = ["#58b9a6", "#2f9c8c", "#27808a", "#1d5a6c", "#143f55"];
/** Ключ картинки по коду материала; `null` — код не из этого набора. */
export const villageSurfaceKey = (code: string) => !code.startsWith(SURFACE_PREFIX) ? null
  : WATER.test(code) ? WATER_PICTURE[waterLevel(code) - 1] : code.slice(SURFACE_PREFIX.length);
/** Цвет, пока картинка грузится, и в «Чертеже». */
export const VILLAGE_FILL: Readonly<Record<string, string>> = Object.fromEntries([...VILLAGE_SURFACES.flatMap(item =>
  variantKeys(item.key, item.variants).map(key => [villageSurfaceCode(key), item.fill])), ...WATER_DEPTHS.map(depth => [waterCode(depth), WATER_FILL[depth - 1]])]);
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
const scatter = (slug: string, name: string, key: string, size: number) =>
  ({ key: `scatter/village-${slug}-v1`, name, assetId: villageId(key), assetIds: variantKeys(key, 2).map(villageId), size });
export const VILLAGE_SCATTER = [
  scatter("willows", "Ивы", "willow", 4), scatter("trees", "Лиственный лес", "tree", 3), scatter("spruces", "Ельник", "spruce", 2.4),
  scatter("bushes", "Кусты", "bush", 1.2), scatter("reeds", "Камыш", "reeds", 1.2), scatter("grass", "Трава", "grass-tuft", 1),
  scatter("boulders", "Валуны", "boulders", 1),
];
