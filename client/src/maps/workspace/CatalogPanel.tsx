import { useState, memo } from "react";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyId, cartographyUrl } from "../assets/cartography";
import { CRYPT_CATEGORIES, CRYPT_OBJECTS, CRYPT_SURFACES, cryptId, cryptUrl, type CryptCategory } from "../assets/crypt";
import { VILLAGE_CATEGORIES, VILLAGE_OBJECTS, VILLAGE_PACK, VILLAGE_RIVERS, VILLAGE_ROADS, VILLAGE_SURFACES, WATER_DEPTHS, LIQUIDS, liquidKind, randomVariantId, variantKeys, villageId, villageSurfaceCode, villageUrl, waterCode, waterLevel, type VillageCategory } from "../assets/village";
import { MAP_SYMBOL_ASSETS } from "../assets/registry";
import { SCATTER_PROFILES } from "../scatter";
import type { WorkspaceTool } from "./editorCommands";
import type { ToolSet } from "./toolSets";

/** Плитка — семейство. `variants` — что именно ставить: конкретный вариант или «случайный» (без картинки). */
type Variant = { id: string; name: string; url: string | null };
type Tile = { id: string; name: string; url: string | null; fill?: string; size?: string; chosen: boolean; choose: () => void; variants?: Variant[] };
type Category = { key: string; name: string; pack: string; tiles: Tile[] };
const PAPER = "Бумага и тушь", CRYPT = "Подземелье · Склеп", VILLAGE = "Местность · Деревня у реки";

function Thumbnail({ url, fill }: { url: string | null; fill?: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} />
    : fill ? <span className="workspace-catalog-glyph" style={{ background: fill }} aria-hidden="true" />
    : <span className="workspace-catalog-glyph" title={failed ? "Изображение недоступно" : undefined} aria-hidden="true">✦</span>;
}
const cells = (size: number) => size >= 1 ? `${Math.round(size * 10) / 10} кл.` : undefined;

// memo: страница редактора рендерится на каждое движение мыши и камеры.
export const CatalogPanel = memo(function CatalogPanel({ tool, toolSet, comicPunk, symbol, material, scatterProfile, lineStyle, onSymbol, onMaterial, onScatter, onLine }: {
  tool: WorkspaceTool; toolSet: ToolSet; comicPunk: boolean; symbol: string; material: string; scatterProfile: string;
  /** Рисунок линии текущего инструмента: дороги, реки или стены. Пусто — обычная линия или кладка. */
  lineStyle: string;
  onSymbol: (id: string) => void; onMaterial: (code: string) => void; onScatter: (key: string) => void; onLine: (style: string, width: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const objects = (group: "dungeon" | "region") => CARTOGRAPHY_OBJECTS.filter((item) => item.group === group).map((item): Tile => ({
    id: cartographyId(item.key), name: item.name, url: cartographyUrl(item.key), size: cells(item.size),
    chosen: symbol === cartographyId(item.key), choose: () => onSymbol(cartographyId(item.key)),
  }));
  // «Склеп» заменил предметы «Бумаги и туши» в каталоге (Q23): старые карты их по-прежнему рисуют.
  const crypt = (category: CryptCategory) => CRYPT_OBJECTS.filter((item) => item.category === category).map((item): Tile => ({
    id: cryptId(item.key), name: item.name, url: cryptUrl(item.directional ? `${item.key}-s` : item.key), size: `${item.cells[0]}×${item.cells[1]}`,
    chosen: symbol === cryptId(item.key), choose: () => onSymbol(cryptId(item.key)),
  }));
  // Семейство с вариантами: щелчок по плитке выбирает «случайный», конкретный — в полосе вариантов.
  const village = (category: VillageCategory) => VILLAGE_OBJECTS.filter((item) => item.category === category).map((item): Tile => {
    const keys = variantKeys(item.key, item.variants), random = randomVariantId(item.key);
    const variants: Variant[] | undefined = keys.length > 1 ? [{ id: random, name: "Случайный", url: null },
      ...keys.map((key, i) => ({ id: villageId(key), name: `Вариант ${i + 1}`, url: villageUrl(key) }))] : undefined;
    return { id: villageId(item.key), name: item.name, url: villageUrl(item.key), size: `${item.cells[0]}×${item.cells[1]}`, variants,
      chosen: symbol === random || keys.some((key) => symbol === villageId(key)), choose: () => onSymbol(variants ? random : villageId(item.key)) };
  });
  const scatterUrl = (assetId: string) => assetId.startsWith(`${VILLAGE_PACK.id}:`) ? villageUrl(assetId.slice(VILLAGE_PACK.id.length + 1))
    : assetId.startsWith(cartographyId("")) ? cartographyUrl(assetId.slice(cartographyId("").length)) : null;
  const scatter = (own: boolean) => SCATTER_PROFILES.filter((item) => item.assetId.startsWith(`${VILLAGE_PACK.id}:`) === own).map((item): Tile =>
    ({ id: item.key, name: item.name, url: scatterUrl(item.assetId), chosen: scatterProfile === item.key, choose: () => onScatter(item.key) }));
  const local = toolSet !== "dungeon";
  const villageObjects = (Object.keys(VILLAGE_CATEGORIES) as VillageCategory[]).map((key) => ({ key, name: VILLAGE_CATEGORIES[key], pack: VILLAGE, tiles: village(key) }));
  const cryptObjects = (Object.keys(CRYPT_CATEGORIES) as CryptCategory[]).map((key) => ({ key, name: CRYPT_CATEGORIES[key], pack: CRYPT, tiles: crypt(key) }));
  // Вода — одна плитка: мелко или глубоко, решает ползунок глубины, а не выбор из двух поверхностей.
  const villageWater = material.startsWith("village-") ? waterLevel(material) : 0, villageLiquid = liquidKind(material);
  const villageSurfaces: Category = { key: "village-surfaces", name: "Местность", pack: VILLAGE, tiles: [...VILLAGE_SURFACES.filter((item) => item.key !== "shallow" && item.key !== "deep").map((item): Tile => {
    const keys = variantKeys(item.key, item.variants);
    return { id: villageSurfaceCode(item.key), name: item.name, url: villageUrl(item.key), chosen: keys.some((key) => material === villageSurfaceCode(key)),
      choose: () => onMaterial(villageSurfaceCode(item.key)),
      variants: keys.map((key, i) => ({ id: villageSurfaceCode(key), name: `Вариант ${i + 1}`, url: villageUrl(key) })) };
  }), ...LIQUIDS.map((item, kind): Tile => ({ id: waterCode(2, item.key), name: item.name, url: kind ? null : villageUrl("shallow"), fill: item.fill,
    chosen: villageWater > 0 && villageLiquid === kind, choose: () => onMaterial(waterCode(kind === 2 || kind === 6 ? 4 : 2, item.key)) }))] };
  const baseSurfaces: Category = { key: "surfaces", name: local ? "Основные" : "Подземелье", pack: comicPunk ? CRYPT : PAPER, tiles: CARTOGRAPHY_SURFACES.map((item) => ({
    id: item.code, name: item.name, url: comicPunk && CRYPT_SURFACES[item.code] ? cryptUrl(CRYPT_SURFACES[item.code]) : item.key ? cartographyUrl(item.key) : null,
    chosen: material === item.code, choose: () => onMaterial(item.code),
  })) };
  const lines = [...VILLAGE_ROADS, ...VILLAGE_RIVERS];
  const lineWidth = (style: string) => lines.find((item) => variantKeys(item.key, item.variants).some((key) => villageId(key) === style))?.width ?? 0.3;
  const strips = (items: readonly { key: string; name: string; width: number; variants: number }[]) => items.map((item): Tile => {
    const keys = variantKeys(item.key, item.variants);
    return { id: villageId(item.key), name: item.name, url: villageUrl(item.key), size: `${item.width} кл.`, chosen: keys.some((key) => lineStyle === villageId(key)),
      choose: () => onLine(villageId(item.key), item.width),
      variants: keys.map((key, i) => ({ id: villageId(key), name: `Вариант ${i + 1}`, url: villageUrl(key) })) };
  });
  const plain = (id: string, name: string, width: number, url: string | null = null): Tile => ({ id, name, url, chosen: !lineStyle, choose: () => onLine("", width) });
  const roads: Category[] = [{ key: "roads", name: "Дороги", pack: VILLAGE, tiles: [plain("road-ink", "Линия тушью", 0.3), ...strips(VILLAGE_ROADS.filter((item) => item.group === "road"))] }];
  const rivers: Category[] = [{ key: "rivers", name: "Реки", pack: VILLAGE, tiles: [plain("river-ink", "Линия", 0.3), ...strips(VILLAGE_RIVERS)] }];
  // Ограда — стена: её не перешагнуть, и на «Столе» она будет считаться преградой, в отличие от дороги.
  const fences: Category = { key: "fences", name: "Ограды", pack: VILLAGE, tiles: strips(VILLAGE_ROADS.filter((item) => item.group === "fence")) };
  const masonry: Category = { key: "walls", name: "Стены", pack: CRYPT, tiles: [plain("wall-masonry", "Каменная кладка", 0.36, cryptUrl("wall-masonry"))] };
  // Свой набор — первым: в «Местности» деревня, в «Подземелье» склеп. Чужой остаётся рядом.
  const line = tool === "road" || tool === "river" || tool === "wall";
  const categories: Category[] = tool === "road" ? roads : tool === "river" ? rivers : tool === "wall" ? (local ? [fences, masonry] : [masonry, fences]) : tool === "asset" ? [
    ...(local ? [...villageObjects, ...cryptObjects] : [...cryptObjects, ...villageObjects]),
    { key: "region", name: "Мир", pack: PAPER, tiles: objects("region") },
    { key: "symbols", name: "Знаки", pack: PAPER, tiles: MAP_SYMBOL_ASSETS.map((item) => ({ id: item.id, name: item.name, url: null, chosen: symbol === item.id, choose: () => onSymbol(item.id) })) },
  ] : tool === "scatter" ? [
    { key: "village-scatter", name: "Местность", pack: VILLAGE, tiles: scatter(true) },
    { key: "scatter", name: "Мир", pack: PAPER, tiles: scatter(false) },
  ] : local ? [villageSurfaces, baseSurfaces] : [baseSurfaces, villageSurfaces];
  const category = categories.find((entry) => entry.key === picked) ?? categories[0];
  const needle = query.trim().toLocaleLowerCase("ru");
  // Search looks through every category of the tool, not only the open one.
  const tiles = needle ? categories.flatMap((entry) => entry.tiles).filter((tile) => tile.name.toLocaleLowerCase("ru").includes(needle)) : category.tiles;
  const chosen = categories.flatMap((entry) => entry.tiles).find((tile) => tile.chosen);
  const current = line ? lineStyle : tool === "asset" ? symbol : material;
  const pick = line ? (id: string) => onLine(id, lineWidth(id)) : tool === "asset" ? onSymbol : onMaterial;
  return <aside className="workspace-catalog" aria-label="Каталог">
    <h2 className="workspace-panel-title">Каталог</h2>
    <input type="search" aria-label="Найти в каталоге" placeholder="Найти…" value={query} onChange={(event) => setQuery(event.target.value)} />
    {categories.length > 1 && !needle && <div className="workspace-catalog-chips" role="group" aria-label="Разделы каталога">
      {categories.map((entry) => <button key={entry.key} type="button" aria-pressed={entry.key === category.key} onClick={() => setPicked(entry.key)}>{entry.name}</button>)}
    </div>}
    {chosen?.variants && <div className="workspace-catalog-variants" role="group" aria-label={`${chosen.name}: вариант`}>
      <strong>{chosen.name}</strong>
      {chosen.variants.map((variant) => <button key={variant.id} type="button" aria-pressed={current === variant.id} title={variant.name} aria-label={variant.name} onClick={() => pick(variant.id)}>
        {variant.url ? <img src={variant.url} alt="" /> : <span aria-hidden="true">?</span>}
      </button>)}
    </div>}
    {!line && villageWater > 0 && <label className="workspace-catalog-depth">Глубина · {villageWater} из {WATER_DEPTHS.length}
      <input aria-label="Глубина воды" type="range" min={1} max={WATER_DEPTHS.length} step={1} value={villageWater} onChange={(event) => onMaterial(waterCode(Number(event.target.value), LIQUIDS[villageLiquid].key))} />
      <small>1 — по щиколотку, 3 и глубже — вброд не перейти. Переход между глубинами плавный в «живой воде».{villageLiquid > 0 && " Эта жидкость оживает только с «живой водой» (Карта ▾ → Вода); без неё — ровная заливка."}</small>
    </label>}
    <div className="workspace-catalog-tiles">
      {tiles.map((tile) => <button key={tile.id} type="button" aria-pressed={tile.chosen} onClick={tile.choose}>
        <Thumbnail url={tile.url} fill={tile.fill} />
        <span><strong>{tile.name}</strong>{tile.size && <small>{tile.size}</small>}</span>
      </button>)}
      {!tiles.length && <p>Ничего не найдено. Попробуйте другое название.</p>}
    </div>
    <p className="workspace-catalog-pack">Набор: SoyMan · {category.pack}</p>
  </aside>;
});
