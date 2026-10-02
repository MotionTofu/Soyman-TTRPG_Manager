import { rasterAsset } from "../../rasterAssets";

/** «Подземелье · Склеп» — первый набор комикс-панка (решения Q22, Q28 2026-10-01).
 * Стандарт: 256 px на клетку; provenance — crypt-pack.json и `.scratch/map-workspace-rebuild/assets_02/`. */
export const CRYPT_PACK = { id: "soyman-crypt", version: "1" } as const;
export type CryptCategory = "crypt" | "furniture" | "light" | "passage" | "gameplay";
export const CRYPT_CATEGORIES: Record<CryptCategory, string> = {
  crypt: "Склеп", furniture: "Мебель", light: "Свет и мусор", passage: "Переходы", gameplay: "Игровое",
};
/** cells — размер в клетках как нарисовано (вид «к зрителю»). directional — четыре вида `-s/-w/-n/-e`
 * вместо поворота картинки: стороной к стене такой предмет ставится поворотом на 90°. */
export const CRYPT_OBJECTS: readonly { key: string; name: string; category: CryptCategory; cells: readonly [number, number]; directional?: true }[] = [
  { key: "sarcophagus", name: "Саркофаг", category: "crypt", cells: [1, 2] },
  { key: "coffin", name: "Гроб", category: "crypt", cells: [1, 2] },
  { key: "niche", name: "Ниша с телом", category: "crypt", cells: [1, 2] },
  { key: "altar", name: "Алтарь", category: "crypt", cells: [2, 1], directional: true },
  { key: "statue", name: "Статуя", category: "crypt", cells: [1, 1], directional: true },
  { key: "throne", name: "Трон", category: "crypt", cells: [1, 1], directional: true },
  { key: "pentagram", name: "Пентаграмма", category: "crypt", cells: [2, 2] },
  { key: "urn", name: "Урна", category: "crypt", cells: [1, 1] },
  { key: "candles", name: "Свечи", category: "crypt", cells: [1, 1] },
  { key: "table", name: "Стол", category: "furniture", cells: [2, 1] },
  { key: "bench", name: "Скамья", category: "furniture", cells: [2, 1] },
  { key: "chair", name: "Стул", category: "furniture", cells: [1, 1], directional: true },
  { key: "bunk", name: "Нары", category: "furniture", cells: [2, 1], directional: true },
  { key: "wardrobe", name: "Шкаф", category: "furniture", cells: [1, 1], directional: true },
  { key: "chest", name: "Сундук", category: "furniture", cells: [1, 1] },
  { key: "barrels", name: "Бочки", category: "furniture", cells: [2, 1] },
  { key: "crates", name: "Ящики", category: "furniture", cells: [2, 1] },
  { key: "rug", name: "Ковёр", category: "furniture", cells: [2, 3] },
  { key: "brazier", name: "Жаровня", category: "light", cells: [1, 1] },
  { key: "torch", name: "Факел", category: "light", cells: [1, 1] },
  { key: "well", name: "Колодец", category: "light", cells: [2, 2] },
  { key: "bones", name: "Кости", category: "light", cells: [1, 1] },
  { key: "rubble", name: "Щебень", category: "light", cells: [1, 1] },
  { key: "pillar", name: "Колонна", category: "light", cells: [1, 1] },
  { key: "pillar-broken", name: "Упавшая колонна", category: "light", cells: [1, 2] },
  { key: "cobweb", name: "Паутина", category: "light", cells: [1, 1] },
  { key: "blood", name: "Кровь", category: "light", cells: [1, 1] },
  { key: "stairs-down", name: "Лестница вниз", category: "passage", cells: [1, 2] },
  { key: "stairs-up", name: "Лестница вверх", category: "passage", cells: [1, 2] },
  { key: "trapdoor", name: "Люк", category: "passage", cells: [1, 1] },
  { key: "pit", name: "Яма", category: "gameplay", cells: [1, 1] },
  { key: "spikes", name: "Шипы", category: "gameplay", cells: [1, 1] },
  { key: "lever", name: "Рычаг", category: "gameplay", cells: [1, 1] },
  { key: "cage", name: "Клетка", category: "gameplay", cells: [1, 1] },
  { key: "chains", name: "Цепи", category: "gameplay", cells: [1, 1] },
  { key: "treasure", name: "Сокровища", category: "gameplay", cells: [1, 1] },
];
export const CRYPT_SIDES = ["s", "w", "n", "e"] as const;
export type CryptSide = (typeof CRYPT_SIDES)[number];
/** Поверхности — по кодам материалов, как у «Бумаги и туши». */
export const CRYPT_SURFACES: Readonly<Record<string, string>> = {
  stone: "floor-tiles", plain: "paper-panel", earth: "floor-cave", forest: "floor-cave", hills: "floor-cave", desert: "floor-cave",
  shallow_water: "floor-water", deep_water: "floor-water", sea: "floor-water", lake: "floor-water",
};
export const CRYPT_DOORS: Readonly<Record<string, string>> = {
  door: "door", locked: "door", trapped: "door", secret: "door-secret", arch: "arch", portc: "portcullis",
};
/** Грязь раскидывает движок сам (Q1 2026-10-01): Мастер ничего не настраивает. */
export const CRYPT_GRIME = ["grime-splash", "grime-splatter", "grime-scribble", "grime-hatch", "grime-x-black",
  "grime-x-magenta", "grime-chunks", "grime-toner", "grime-tape"] as const;
/** Всё, что рисует само оформление: без этих файлов «Комикс-панк» не полон. */
export const CRYPT_STYLE_KEYS = ["paper-panel", "floor-tiles", "floor-cave", "floor-water", "wall-masonry", "wall-masonry-end", ...new Set(Object.values(CRYPT_DOORS)), ...CRYPT_GRIME];

export const cryptId = (key: string) => `${CRYPT_PACK.id}:${key}`;
export const cryptUrl = (key: string) => rasterAsset("crypt", key)!;
const objectByKey = new Map(CRYPT_OBJECTS.map(item => [item.key, item]));
export const cryptObject = (id: string) => id.startsWith(`${CRYPT_PACK.id}:`) ? objectByKey.get(id.slice(CRYPT_PACK.id.length + 1)) ?? null : null;
/** Вид для поворота: 0° — лицом вниз, по часовой 90° — влево, 180° — вверх, 270° — вправо. */
export function cryptSide(rotation: number): CryptSide {
  return CRYPT_SIDES[((Math.round(rotation / 90) % 4) + 4) % 4];
}
