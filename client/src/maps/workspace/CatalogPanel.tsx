import { useState, memo } from "react";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyId, cartographyUrl } from "../assets/cartography";
import { CRYPT_CATEGORIES, CRYPT_OBJECTS, CRYPT_SURFACES, cryptId, cryptUrl, type CryptCategory } from "../assets/crypt";
import { VILLAGE_CATEGORIES, VILLAGE_OBJECTS, VILLAGE_PACK, VILLAGE_RIVERS, VILLAGE_ROADS, VILLAGE_SURFACES, variantKeys, villageId, villageSurfaceCode, villageUrl, type VillageCategory } from "../assets/village";
import { WORLD_CATEGORIES, WORLD_OBJECTS, WORLD_SURFACES, worldId, worldSurfaceCode, worldUrl, type WorldCategory } from "../assets/world";
import { MAP_SYMBOL_ASSETS, ownSurfaceCode } from "../assets/registry";
import { SCATTER_PROFILES } from "../scatter";
import { genreLabel, packName, packOfAsset, packsFor, rankPacks } from "../assets/packs";
import type { SettingGenre } from "../../types";
import { liveImages, ownImageId, ownImageSrc, ownRandomId, ownScatterKey, useMapImageRevision, type OwnPack } from "../assets/ownPacks";
import { Link } from "react-router-dom";
import type { MapKind } from "../mapTypes";
import type { WorkspaceTool } from "./editorCommands";

/** Плитка — семейство. `variants` — что именно ставить: конкретный вариант или «случайный» (без картинки). */
type Variant = { id: string; name: string; url: string | null; /** Свой выбор варианта, где мало одного кода: проём несёт ещё ширину и «потайной». */ choose?: () => void };
type Tile = { id: string; name: string; /** Теги: поиск ищет и по ним. */ tags?: string; url: string | null; fill?: string; size?: string; chosen: boolean; choose: () => void; variants?: Variant[] };
/** `pack` — набор из библиотеки (`MAP_PACKS`): каталог показывает разделы только подключённых к карте наборов. */
type Category = { key: string; name: string; pack: string; tiles: Tile[] };
/** Линии атласа набора «Мир»: id стиля, название, ширина по умолчанию в клетках. */
const ATLAS: readonly (readonly [string, string, number])[] = [["atlas-highway", "Тракт", 0.3], ["atlas-road", "Дорога", 0.2], ["atlas-trail", "Тропа", 0.15], ["atlas-sea", "Морской путь", 0.2], ["atlas-river", "Река атласа", 0.4]];

function Thumbnail({ url, fill }: { url: string | null; fill?: string }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} />
    : fill ? <span className="workspace-catalog-glyph" style={{ background: fill }} aria-hidden="true" />
    : <span className="workspace-catalog-glyph" title={failed ? "Изображение недоступно" : undefined} aria-hidden="true">✦</span>;
}
const cells = (size: number) => size >= 1 ? `${Math.round(size * 10) / 10} кл.` : undefined;

// memo: страница редактора рендерится на каждое движение мыши и камеры.
export const CatalogPanel = memo(function CatalogPanel({ tool, local, kind, packs, onPacks, ownPacks, used, genres, comicPunk, symbol, material, scatterProfile, lineStyle, doorStyle, onSymbol, onMaterial, onScatter, onLine, onDoor }: {
  tool: WorkspaceTool; /** Подборка «Местности» первой; иначе первым идёт «Склеп». */ local: boolean; comicPunk: boolean;
  /** Вид карты и подключённые к ней наборы; `onPacks` — новый список подключённых. */
  kind: MapKind; packs: readonly string[]; onPacks: (packs: string[]) => void; /** Свои наборы Мастера с сервера. */ ownPacks: readonly OwnPack[]; /** Жанры сеттинга карты; пусто — в библиотеке все наборы. */ genres: readonly SettingGenre[];
  /** Наборы, вещи которых уже стоят на карте, через «|»: строкой, чтобы панель не перерисовывалась на каждую правку. */ used: string; symbol: string; material: string; scatterProfile: string;
  /** Рисунок линии текущего инструмента: дороги, реки или стены. Пусто — обычная линия или кладка. */
  lineStyle: string;
  /** Рисунок проёма инструмента «Дверь»; пусто — обычная дверь оформления. */
  doorStyle: string; onDoor: (door: { style: string; span: number; secret: boolean } | undefined) => void;
  onSymbol: (id: string) => void; onMaterial: (code: string) => void; onScatter: (key: string, /** Густота россыпи по умолчанию. */ density?: number) => void; onLine: (style: string, width: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<string | null>(null);
  const [only, setOnly] = useState<string | null>(null), [choosing, setChoosing] = useState(false), [wide, setWide] = useState(false);
  useMapImageRevision();
  // Вещи своих наборов: раздел набора — раздел каталога. Объект с вариантами ставит случайный, как у «Деревни»;
  // у поверхности каждый вариант — свой материал, они красятся по отдельности.
  // Линия стоит в каталоге того инструмента, которым тянется (`use`); россыпь несёт свои размер и густоту.
  const OWN_SECTION = { object: "Объекты", surface: "Поверхности", line: "Линии", scatter: "Россыпи", door: "Проёмы" };
  const ownTiles = (kind: keyof typeof OWN_SECTION, use?: string): Category[] => ownPacks.filter((pack) => !pack.archived).flatMap((pack) => {
    const items = pack.items.filter((item) => !item.archived && item.kind === kind && (!use || item.use === use) && liveImages(item).length);
    return [...new Set(items.map((item) => item.section))].sort((a, b) => a.localeCompare(b, "ru")).map((section): Category => ({ key: `own:${pack.uid}:${kind}:${section}`, name: section || OWN_SECTION[kind], pack: pack.uid,
      tiles: items.filter((item) => item.section === section).map((item): Tile => {
        const images = liveImages(item), ids = images.map(ownImageId), random = ownRandomId(item);
        if (kind === "surface") {
          const codes = images.map((image) => ownSurfaceCode(image.uid));
          return { id: `own:${item.uid}`, name: item.name, tags: item.tags, url: ownImageSrc(ids[0]), fill: item.fill, chosen: codes.includes(material), choose: () => onMaterial(codes[0]),
            variants: codes.length > 1 ? codes.map((code, i) => ({ id: code, name: `Вариант ${i + 1}`, url: ownImageSrc(ids[i]) })) : undefined };
        }
        if (kind === "line") return { id: `own:${item.uid}`, name: item.name, tags: item.tags, url: ownImageSrc(ids[0]), size: `${item.width ?? 1} кл.`, chosen: ids.includes(lineStyle), choose: () => onLine(ids[0], item.width ?? 1),
          variants: ids.length > 1 ? ids.map((id, i) => ({ id, name: `Вариант ${i + 1}`, url: ownImageSrc(id) })) : undefined };
        if (kind === "door") {
          const door = (style: string) => () => onDoor({ style, span: item.span ?? 1, secret: item.secret === true });
          return { id: `own:${item.uid}`, name: item.name, tags: item.tags, url: ownImageSrc(ids[0]), size: `${item.span ?? 1} кл.${item.secret ? " · потайной" : ""}`, chosen: ids.includes(doorStyle),
            choose: door(ids[0]), variants: ids.length > 1 ? ids.map((id, i) => ({ id, name: `Вариант ${i + 1}`, url: ownImageSrc(id), choose: door(id) })) : undefined };
        }
        if (kind === "scatter") return { id: `own:${item.uid}`, name: item.name, tags: item.tags, url: ownImageSrc(ids[0]), chosen: scatterProfile === ownScatterKey(item), choose: () => onScatter(ownScatterKey(item), item.density) };
        const variants: Variant[] | undefined = ids.length > 1 ? [{ id: random, name: "Случайный", url: null }, ...ids.map((id, i) => ({ id, name: `Вариант ${i + 1}`, url: ownImageSrc(id) }))] : undefined;
        return { id: `own:${item.uid}`, name: item.name, tags: item.tags, url: ownImageSrc(ids[0]), size: `${item.w}×${item.h}`, variants,
          chosen: symbol === random || ids.includes(symbol), choose: () => onSymbol(variants ? random : ids[0]) };
      }) }));
  });
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
  const families = (items: readonly { key: string; name: string; cells: readonly [number, number]; variants: number }[], id: (key: string) => string, url: (key: string) => string,
    size: (cells: readonly [number, number]) => string) => items.map((item): Tile => {
    const keys = variantKeys(item.key, item.variants), random = `${id(item.key)}*`;
    const variants: Variant[] | undefined = keys.length > 1 ? [{ id: random, name: "Случайный", url: null },
      ...keys.map((key, i) => ({ id: id(key), name: `Вариант ${i + 1}`, url: url(key) }))] : undefined;
    return { id: id(item.key), name: item.name, url: url(item.key), size: size(item.cells), variants,
      chosen: symbol === random || keys.some((key) => symbol === id(key)), choose: () => onSymbol(variants ? random : id(item.key)) };
  });
  const village = (category: VillageCategory) => families(VILLAGE_OBJECTS.filter((item) => item.category === category), villageId, villageUrl, (size) => `${size[0]}×${size[1]}`);
  const world = (category: WorldCategory) => families(WORLD_OBJECTS.filter((item) => item.category === category), worldId, worldUrl, (size) => `${size[0]} кл.`);
  const scatterUrl = (assetId: string) => assetId.startsWith(`${VILLAGE_PACK.id}:`) ? villageUrl(assetId.slice(VILLAGE_PACK.id.length + 1))
    : assetId.startsWith(worldId("")) ? worldUrl(assetId.slice(worldId("").length))
    : assetId.startsWith(cartographyId("")) ? cartographyUrl(assetId.slice(cartographyId("").length)) : null;
  const scatter = (pack: string) => SCATTER_PROFILES.filter((item) => (packOfAsset(item.assetId) ?? "ink") === pack).map((item): Tile =>
    ({ id: item.key, name: item.name, url: scatterUrl(item.assetId), chosen: scatterProfile === item.key, choose: () => onScatter(item.key) }));
  const villageObjects = (Object.keys(VILLAGE_CATEGORIES) as VillageCategory[]).map((key) => ({ key, name: VILLAGE_CATEGORIES[key], pack: "village", tiles: village(key) }));
  const worldObjects = (Object.keys(WORLD_CATEGORIES) as WorldCategory[]).map((key) => ({ key: `world-${key}`, name: WORLD_CATEGORIES[key], pack: "world", tiles: world(key) }));
  const worldSurfaces: Category = { key: "world-surfaces", name: "Земля", pack: "world", tiles: WORLD_SURFACES.map((item): Tile => ({ id: worldSurfaceCode(item.key), name: item.name,
    url: worldUrl(item.key), chosen: material === worldSurfaceCode(item.key), choose: () => onMaterial(worldSurfaceCode(item.key)) })) };
  const cryptObjects = (Object.keys(CRYPT_CATEGORIES) as CryptCategory[]).map((key) => ({ key, name: CRYPT_CATEGORIES[key], pack: "crypt", tiles: crypt(key) }));
  // Воды и других жидкостей здесь нет: у них свой инструмент со слотами.
  const villageSurfaces: Category = { key: "village-surfaces", name: "Местность", pack: "village", tiles: [...VILLAGE_SURFACES.filter((item) => item.key !== "shallow" && item.key !== "deep").map((item): Tile => {
    const keys = variantKeys(item.key, item.variants);
    return { id: villageSurfaceCode(item.key), name: item.name, url: villageUrl(item.key), chosen: keys.some((key) => material === villageSurfaceCode(key)),
      choose: () => onMaterial(villageSurfaceCode(item.key)),
      variants: keys.map((key, i) => ({ id: villageSurfaceCode(key), name: `Вариант ${i + 1}`, url: villageUrl(key) })) };
  })] };
  const baseSurfaces: Category = { key: "surfaces", name: local ? "Основные" : "Подземелье", pack: comicPunk ? "crypt" : "ink", tiles: CARTOGRAPHY_SURFACES.map((item) => ({
    id: item.code, name: item.name, url: comicPunk && CRYPT_SURFACES[item.code] ? cryptUrl(CRYPT_SURFACES[item.code]) : item.key ? cartographyUrl(item.key) : null,
    chosen: material === item.code, choose: () => onMaterial(item.code),
  })) };
  const lines = [...VILLAGE_ROADS, ...VILLAGE_RIVERS];
  const ownLine = (style: string) => ownPacks.flatMap((pack) => pack.items).find((item) => item.kind === "line" && item.images.some((image) => ownImageId(image) === style));
  const lineWidth = (style: string) => ATLAS.find((item) => item[0] === style)?.[2] ?? lines.find((item) => variantKeys(item.key, item.variants).some((key) => villageId(key) === style))?.width ?? ownLine(style)?.width ?? 0.3;
  const strips = (items: readonly { key: string; name: string; width: number; variants: number }[]) => items.map((item): Tile => {
    const keys = variantKeys(item.key, item.variants);
    return { id: villageId(item.key), name: item.name, url: villageUrl(item.key), size: `${item.width} кл.`, chosen: keys.some((key) => lineStyle === villageId(key)),
      choose: () => onLine(villageId(item.key), item.width),
      variants: keys.map((key, i) => ({ id: villageId(key), name: `Вариант ${i + 1}`, url: villageUrl(key) })) };
  });
  const plain = (id: string, name: string, width: number, url: string | null = null): Tile => ({ id, name, url, chosen: !lineStyle, choose: () => onLine("", width) });
  // Линии атласа — у обзорной карты первыми (М6, М16): их рисует код, картинок нет.
  const atlas = (ids: readonly string[]): Tile[] => ATLAS.filter((item) => ids.includes(item[0])).map(([id, name, width]) => ({ id, name, url: null, size: `${width} кл.`,
    chosen: lineStyle === id, choose: () => onLine(id, width) }));
  const overview = kind === "overview";
  // Простая линия — из «Бумаги и туши»: она остаётся, даже если «Деревня» не подключена.
  const roads: Category[] = [...overview ? [{ key: "roads-atlas", name: "Атлас", pack: "world", tiles: atlas(["atlas-highway", "atlas-road", "atlas-trail", "atlas-sea"]) }] : [],{ key: "roads", name: "Дороги", pack: "village", tiles: strips(VILLAGE_ROADS.filter((item) => item.group === "road")) },
    { key: "roads-ink", name: "Простые", pack: "ink", tiles: [plain("road-ink", "Линия тушью", 0.3)] }];
  const rivers: Category[] = [...overview ? [{ key: "rivers-atlas", name: "Атлас", pack: "world", tiles: atlas(["atlas-river"]) }] : [],{ key: "rivers", name: "Реки", pack: "village", tiles: strips(VILLAGE_RIVERS) },
    { key: "rivers-ink", name: "Простые", pack: "ink", tiles: [plain("river-ink", "Линия", 0.3)] }];
  // Ограда — стена: её не перешагнуть, и на «Столе» она будет считаться преградой, в отличие от дороги.
  const fences: Category = { key: "fences", name: "Ограды", pack: "village", tiles: strips(VILLAGE_ROADS.filter((item) => item.group === "fence")) };
  const masonry: Category = { key: "walls", name: "Стены", pack: "crypt", tiles: [plain("wall-masonry", "Каменная кладка", 0.36, cryptUrl("wall-masonry"))] };
  // Подборка по карте — первой: где есть комнаты, это склеп, иначе деревня. Вторая остаётся рядом.
  const line = tool === "road" || tool === "river" || tool === "wall";
  const library: Category[] = tool === "door" ? [...ownTiles("door"),
    { key: "doors-ink", name: "Обычные", pack: "ink", tiles: [{ id: "door-plain", name: "Дверь оформления", url: null, chosen: !doorStyle, choose: () => onDoor(undefined) }] }] : tool === "road" ? [...ownTiles("line", "road"), ...roads] : tool === "river" ? [...ownTiles("line", "river"), ...rivers]
    : tool === "wall" ? [...ownTiles("line", "wall"), ...(local ? [fences, masonry] : [masonry, fences])] : tool === "asset" ? [
    ...ownTiles("object"), ...worldObjects, ...(local ? [...villageObjects, ...cryptObjects] : [...cryptObjects, ...villageObjects]),
    { key: "region", name: "Обзор", pack: "ink", tiles: objects("region") },
    { key: "symbols", name: "Знаки", pack: "ink", tiles: MAP_SYMBOL_ASSETS.map((item) => ({ id: item.id, name: item.name, url: null, chosen: symbol === item.id, choose: () => onSymbol(item.id) })) },
  ] : tool === "scatter" ? [
    ...ownTiles("scatter"),
    { key: "world-scatter", name: "Рельеф и лес", pack: "world", tiles: scatter("world") },
    { key: "village-scatter", name: "Местность", pack: "village", tiles: scatter("village") },
    { key: "scatter", name: "Обзор", pack: "ink", tiles: scatter("ink") },
  ] : [...ownTiles("surface"), worldSurfaces, ...(local ? [villageSurfaces, baseSurfaces] : [baseSurfaces, villageSurfaces])];
  // Каталог — только подключённые наборы; `only` сужает до одного. Остальная библиотека видна через поиск.
  const fit = packsFor(kind), mine = library.filter((entry) => packs.includes(entry.pack)), shown = fit.filter((pack) => mine.some((entry) => entry.pack === pack.id));
  const filter = only && shown.some((pack) => pack.id === only) ? only : null;
  const categories = filter ? mine.filter((entry) => entry.pack === filter) : mine;
  const category = categories.find((entry) => entry.key === picked) ?? categories[0];
  const needle = query.trim().toLocaleLowerCase("ru"), hit = (tile: Tile) => `${tile.name} ${tile.tags ?? ""}`.toLocaleLowerCase("ru").includes(needle);
  // Search looks through every category of the tool, not only the open one.
  const tiles = needle ? categories.flatMap((entry) => entry.tiles).filter(hit) : category?.tiles ?? [];
  // Найденное в неподключённых наборах: щелчок подключает набор и берёт вещь.
  const foreign = needle ? library.filter((entry) => !packs.includes(entry.pack) && fit.some((pack) => pack.id === entry.pack))
    .flatMap((entry) => entry.tiles.filter(hit).map((tile) => ({ tile, pack: entry.pack }))) : [];
  const chosen = library.flatMap((entry) => entry.tiles).find((tile) => tile.chosen);
  const current = line ? lineStyle : tool === "asset" ? symbol : tool === "door" ? doorStyle : material;
  const pick = line ? (id: string) => onLine(id, lineWidth(id)) : tool === "asset" ? onSymbol : onMaterial;
  // Вещи на карте из наборов, которых нет в её каталоге: отключён, не для этого вида карт или в архиве.
  const stray = used ? used.split("|").filter((id) => !packs.includes(id)) : [];
  const gone = stray.filter((id) => ownPacks.some((pack) => pack.uid === id && pack.archived));
  const off = stray.filter((id) => fit.some((pack) => pack.id === id));
  const alien = stray.filter((id) => !gone.includes(id) && !off.includes(id));
  const names = (ids: string[]) => ids.map((id) => `«${packName(id)}»`).join(", ");
  // Библиотека карты с сеттингом — по близости к его жанрам (гриллинг Q45); подключённое видно всегда.
  const near = wide ? fit : rankPacks(fit, genres), listed = [...near, ...fit.filter((pack) => packs.includes(pack.id) && !near.includes(pack))];
  const toggle = (id: string) => { const next = packs.includes(id) ? packs.filter((entry) => entry !== id) : [...packs, id]; if (next.length) onPacks(next); };
  return <aside className="workspace-catalog" aria-label="Каталог">
    <h2 className="workspace-panel-title">Каталог</h2>
    <input type="search" aria-label="Найти в каталоге" placeholder="Найти во всех наборах…" value={query} onChange={(event) => setQuery(event.target.value)} />
    <div className="workspace-catalog-packs" role="group" aria-label="Наборы карты">
      <button type="button" aria-pressed={!filter} onClick={() => setOnly(null)}>Все</button>
      {shown.map((pack) => <button key={pack.id} type="button" aria-pressed={filter === pack.id} onClick={() => setOnly(pack.id)}>{pack.name}</button>)}
      <button type="button" aria-expanded={choosing} title="Подключить или отключить наборы этой карты" onClick={() => setChoosing(!choosing)}>＋ Набор</button>
    </div>
    {choosing && <div className="workspace-catalog-library" role="group" aria-label="Библиотека наборов">
      {genres.length > 0 && <label><input type="checkbox" checked={!wide} onChange={() => setWide(!wide)} />
        <span><strong>Только близкие по жанру</strong><small>{genreLabel(genres)} — жанры сеттинга карты</small></span></label>}
      {listed.map((pack) => <label key={pack.id}><input type="checkbox" checked={packs.includes(pack.id)} disabled={packs.length === 1 && packs.includes(pack.id)} onChange={() => toggle(pack.id)} />
        <span><strong>{pack.name}</strong><small>{pack.genre} · {pack.place}</small></span></label>)}
      <small>Каталог показывает только подключённые наборы. Уже нарисованное с карты не пропадает.</small>
      <Link to="/maps/packs">Свои наборы ассетов →</Link>
    </div>}
    {stray.length > 0 && <div className="workspace-catalog-stray" role="status">
      {off.length > 0 && <p>На карте есть вещи из отключённых наборов: {names(off)}. Они остаются на карте. <button type="button" onClick={() => onPacks([...packs, ...off])}>Подключить</button></p>}
      {alien.length > 0 && <p>На карте есть вещи из наборов для другого вида карт: {names(alien)}. Они остаются на карте, но в каталоге этой карты их нет.</p>}
      {gone.length > 0 && <p>Наборы в архиве: {names(gone)}. Вместо их вещей на карте заглушки. <Link to="/maps/packs">Вернуть набор →</Link></p>}
    </div>}
    {categories.length > 1 && !needle && <div className="workspace-catalog-chips" role="group" aria-label="Разделы каталога">
      {categories.map((entry) => <button key={entry.key} type="button" aria-pressed={entry.key === category?.key} onClick={() => setPicked(entry.key)}>{entry.name}</button>)}
    </div>}
    {chosen?.variants && <div className="workspace-catalog-variants" role="group" aria-label={`${chosen.name}: вариант`}>
      <strong>{chosen.name}</strong>
      {chosen.variants.map((variant) => <button key={variant.id} type="button" aria-pressed={current === variant.id} title={variant.name} aria-label={variant.name} onClick={variant.choose ?? (() => pick(variant.id))}>
        {variant.url ? <img src={variant.url} alt="" /> : <span aria-hidden="true">?</span>}
      </button>)}
    </div>}
    <div className="workspace-catalog-tiles">
      {tiles.map((tile) => <button key={tile.id} type="button" aria-pressed={tile.chosen} onClick={tile.choose}>
        <Thumbnail url={tile.url} fill={tile.fill} />
        <span><strong>{tile.name}</strong>{tile.size && <small>{tile.size}</small>}</span>
      </button>)}
      {!tiles.length && !foreign.length && <p>{needle ? "Ничего не найдено. Попробуйте другое название." : "В подключённых наборах для этого инструмента ничего нет. Подключите набор: «＋ Набор»."}</p>}
      {foreign.length > 0 && <p className="workspace-catalog-foreign">В неподключённых наборах — щелчок подключит набор:</p>}
      {foreign.map(({ tile, pack }) => <button key={`${pack}:${tile.id}`} type="button" title={`Подключить набор «${packName(pack)}» и взять`} onClick={() => { onPacks([...packs, pack]); tile.choose(); }}>
        <Thumbnail url={tile.url} fill={tile.fill} />
        <span><strong>{tile.name}</strong><small>{packName(pack)}</small></span>
      </button>)}
    </div>
    {category && <p className="workspace-catalog-pack">Набор: {packName(category.pack)}</p>}
  </aside>;
});
