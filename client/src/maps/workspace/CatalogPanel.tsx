import { useState, memo } from "react";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyId, cartographyUrl } from "../assets/cartography";
import { CRYPT_CATEGORIES, CRYPT_OBJECTS, CRYPT_SURFACES, cryptId, cryptUrl, type CryptCategory } from "../assets/crypt";
import { VILLAGE_CATEGORIES, VILLAGE_OBJECTS, VILLAGE_PACK, VILLAGE_ROADS, VILLAGE_SURFACES, randomVariantId, variantKeys, villageId, villageSurfaceCode, villageUrl, type VillageCategory } from "../assets/village";
import { MAP_SYMBOL_ASSETS } from "../assets/registry";
import { SCATTER_PROFILES } from "../scatter";
import type { WorkspaceTool } from "./editorCommands";
import type { ToolSet } from "./toolSets";

/** Плитка — семейство. `variants` — что именно ставить: конкретный вариант или «случайный» (без картинки). */
type Variant = { id: string; name: string; url: string | null };
type Tile = { id: string; name: string; url: string | null; size?: string; chosen: boolean; choose: () => void; variants?: Variant[] };
type Category = { key: string; name: string; pack: string; tiles: Tile[] };
const PAPER = "Бумага и тушь", CRYPT = "Подземелье · Склеп", VILLAGE = "Местность · Деревня у реки";

function Thumbnail({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} />
    : <span className="workspace-catalog-glyph" title={failed ? "Изображение недоступно" : undefined} aria-hidden="true">✦</span>;
}
const cells = (size: number) => size >= 1 ? `${Math.round(size * 10) / 10} кл.` : undefined;

// memo: страница редактора рендерится на каждое движение мыши и камеры.
export const CatalogPanel = memo(function CatalogPanel({ tool, toolSet, comicPunk, symbol, material, scatterProfile, roadStyle, onSymbol, onMaterial, onScatter, onRoad }: {
  tool: WorkspaceTool; toolSet: ToolSet; comicPunk: boolean; symbol: string; material: string; scatterProfile: string; roadStyle: string;
  onSymbol: (id: string) => void; onMaterial: (code: string) => void; onScatter: (key: string) => void; onRoad: (style: string, width: number) => void;
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
  const villageSurfaces: Category = { key: "village-surfaces", name: "Местность", pack: VILLAGE, tiles: VILLAGE_SURFACES.map((item): Tile => {
    const keys = variantKeys(item.key, item.variants);
    return { id: villageSurfaceCode(item.key), name: item.name, url: villageUrl(item.key), chosen: keys.some((key) => material === villageSurfaceCode(key)),
      choose: () => onMaterial(villageSurfaceCode(item.key)),
      variants: keys.map((key, i) => ({ id: villageSurfaceCode(key), name: `Вариант ${i + 1}`, url: villageUrl(key) })) };
  }) };
  const baseSurfaces: Category = { key: "surfaces", name: local ? "Основные" : "Подземелье", pack: comicPunk ? CRYPT : PAPER, tiles: CARTOGRAPHY_SURFACES.map((item) => ({
    id: item.code, name: item.name, url: comicPunk && CRYPT_SURFACES[item.code] ? cryptUrl(CRYPT_SURFACES[item.code]) : item.key ? cartographyUrl(item.key) : null,
    chosen: material === item.code, choose: () => onMaterial(item.code),
  })) };
  const roadWidth = (style: string) => VILLAGE_ROADS.find((item) => variantKeys(item.key, item.variants).some((key) => villageId(key) === style))?.width ?? 0.3;
  const strips = (group: "road" | "fence") => VILLAGE_ROADS.filter((item) => item.group === group).map((item): Tile => {
    const keys = variantKeys(item.key, item.variants);
    return { id: villageId(item.key), name: item.name, url: villageUrl(item.key), size: `${item.width} кл.`, chosen: keys.some((key) => roadStyle === villageId(key)),
      choose: () => onRoad(villageId(item.key), item.width),
      variants: keys.map((key, i) => ({ id: villageId(key), name: `Вариант ${i + 1}`, url: villageUrl(key) })) };
  });
  const roads: Category[] = [
    { key: "roads", name: "Дороги", pack: VILLAGE, tiles: [{ id: "road-ink", name: "Линия тушью", url: null, chosen: !roadStyle, choose: () => onRoad("", 0.3) }, ...strips("road")] },
    { key: "fences", name: "Ограды", pack: VILLAGE, tiles: strips("fence") },
  ];
  // Свой набор — первым: в «Местности» деревня, в «Подземелье» склеп. Чужой остаётся рядом.
  const categories: Category[] = tool === "road" ? roads : tool === "asset" ? [
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
  const current = tool === "road" ? roadStyle : tool === "asset" ? symbol : material;
  const pick = tool === "road" ? (id: string) => onRoad(id, roadWidth(id)) : tool === "asset" ? onSymbol : onMaterial;
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
    <div className="workspace-catalog-tiles">
      {tiles.map((tile) => <button key={tile.id} type="button" aria-pressed={tile.chosen} onClick={tile.choose}>
        <Thumbnail url={tile.url} />
        <span><strong>{tile.name}</strong>{tile.size && <small>{tile.size}</small>}</span>
      </button>)}
      {!tiles.length && <p>Ничего не найдено. Попробуйте другое название.</p>}
    </div>
    <p className="workspace-catalog-pack">Набор: SoyMan · {category.pack}</p>
  </aside>;
});
