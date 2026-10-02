import { useState } from "react";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyId, cartographyUrl } from "../assets/cartography";
import { CRYPT_CATEGORIES, CRYPT_OBJECTS, CRYPT_SURFACES, cryptId, cryptUrl, type CryptCategory } from "../assets/crypt";
import { MAP_SYMBOL_ASSETS } from "../assets/registry";
import { SCATTER_PROFILES } from "../scatter";
import type { WorkspaceTool } from "./editorCommands";
import type { ToolSet } from "./toolSets";

type Tile = { id: string; name: string; url: string | null; size?: string; chosen: boolean; choose: () => void };
type Category = { key: string; name: string; tiles: Tile[] };

function Thumbnail({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} />
    : <span className="workspace-catalog-glyph" title={failed ? "Изображение недоступно" : undefined} aria-hidden="true">✦</span>;
}
const cells = (size: number) => size >= 1 ? `${Math.round(size * 10) / 10} кл.` : undefined;

export function CatalogPanel({ tool, toolSet, comicPunk, symbol, material, scatterProfile, onSymbol, onMaterial, onScatter }: {
  tool: WorkspaceTool; toolSet: ToolSet; comicPunk: boolean; symbol: string; material: string; scatterProfile: string;
  onSymbol: (id: string) => void; onMaterial: (code: string) => void; onScatter: (key: string) => void;
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
  const categories: Category[] = tool === "asset" ? [
    ...(Object.keys(CRYPT_CATEGORIES) as CryptCategory[]).map((key) => ({ key, name: CRYPT_CATEGORIES[key], tiles: crypt(key) })),
    { key: "region", name: "Местность", tiles: objects("region") },
    { key: "symbols", name: "Знаки", tiles: MAP_SYMBOL_ASSETS.map((item) => ({ id: item.id, name: item.name, url: null, chosen: symbol === item.id, choose: () => onSymbol(item.id) })) },
  ] : tool === "scatter" ? [
    { key: "scatter", name: "Россыпи", tiles: SCATTER_PROFILES.map((item) => {
      const key = item.assetId.startsWith(`${cartographyId("")}`) ? item.assetId.slice(cartographyId("").length) : null;
      return { id: item.key, name: item.name, url: key ? cartographyUrl(key) : null, chosen: scatterProfile === item.key, choose: () => onScatter(item.key) };
    }) },
  ] : [
    { key: "surfaces", name: "Поверхности", tiles: CARTOGRAPHY_SURFACES.map((item) => ({
      id: item.code, name: item.name, url: comicPunk && CRYPT_SURFACES[item.code] ? cryptUrl(CRYPT_SURFACES[item.code]) : item.key ? cartographyUrl(item.key) : null,
      chosen: material === item.code, choose: () => onMaterial(item.code),
    })) },
  ];
  const fallback = tool === "asset" && toolSet !== "dungeon" ? "region" : categories[0].key;
  const category = categories.find((entry) => entry.key === picked) ?? categories.find((entry) => entry.key === fallback)!;
  const needle = query.trim().toLocaleLowerCase("ru");
  // Search looks through every category of the tool, not only the open one.
  const tiles = needle ? categories.flatMap((entry) => entry.tiles).filter((tile) => tile.name.toLocaleLowerCase("ru").includes(needle)) : category.tiles;
  return <aside className="workspace-catalog" aria-label="Каталог">
    <h2 className="workspace-panel-title">Каталог</h2>
    <input type="search" aria-label="Найти в каталоге" placeholder="Найти…" value={query} onChange={(event) => setQuery(event.target.value)} />
    {categories.length > 1 && !needle && <div className="workspace-catalog-chips" role="group" aria-label="Разделы каталога">
      {categories.map((entry) => <button key={entry.key} type="button" aria-pressed={entry.key === category.key} onClick={() => setPicked(entry.key)}>{entry.name}</button>)}
    </div>}
    <div className="workspace-catalog-tiles">
      {tiles.map((tile) => <button key={tile.id} type="button" aria-pressed={tile.chosen} onClick={tile.choose}>
        <Thumbnail url={tile.url} />
        <span><strong>{tile.name}</strong>{tile.size && <small>{tile.size}</small>}</span>
      </button>)}
      {!tiles.length && <p>Ничего не найдено. Попробуйте другое название.</p>}
    </div>
    <p className="workspace-catalog-pack">Набор: SoyMan · Бумага и тушь</p>
  </aside>;
}
