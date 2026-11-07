import "./maps-d.css";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { NavIcon } from "../components/NavIcons";
import { ListPage } from "../components/ListPage";
import { RegMeta, RegTable, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import { ContextMenu, type ContextMenuItem } from "../components/ContextMenu";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { useCurrentUser } from "../api/currentUser";
import { getAuthToken } from "../api/client";
import { Modal } from "../components/Modal";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { MAP_KIND_LABELS, type MapKind } from "../maps/mapTypes";
import { MAP_PACKS, genreLabel } from "../maps/assets/packs";
import { OWN_SIDES, PACK_CELL_PX, liveImages, ownEdge, ownImageId, ownImageSrc, packLiquidRecipe, registerOwnPacks, sideImage, useMapImageRevision, type OwnPack, type OwnPackItem } from "../maps/assets/ownPacks";
import { LiquidRecipeFields, Swatch } from "../maps/workspace/LiquidSlots";
import { LiquidPond } from "../maps/workspace/LiquidPond";
import { LIQUIDS } from "../maps/assets/village";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyUrl } from "../maps/assets/cartography";
import { CRYPT_CATEGORIES, CRYPT_OBJECTS, cryptUrl, type CryptCategory } from "../maps/assets/crypt";
import { WORLD_CATEGORIES, WORLD_OBJECTS, WORLD_SURFACES, worldUrl, type WorldCategory } from "../maps/assets/world";
import { VILLAGE_CATEGORIES, VILLAGE_OBJECTS, VILLAGE_RIVERS, VILLAGE_ROADS, VILLAGE_SURFACES, villageUrl, type VillageCategory } from "../maps/assets/village";
import { MAP_SYMBOL_ASSETS, getMapImageAsset } from "../maps/assets/registry";
import { edgeAlpha, edgeField, edgeRamp, edgeWindow, type SurfaceEdge } from "../maps/assets/surfaceEdge";
import { edgeNoiseOf } from "../maps/assets/terrainMaskDrawing";
import { seamlessTile } from "../maps/assets/seamless";
import { MapSheetDialog } from "./MapSheetDialog";
import { GenrePicker } from "../components/GenrePicker";
import type { SettingGenre } from "../types";

const KINDS: MapKind[] = ["tactical", "city", "overview"];
const AFFECTS = [{ path: "/map-packs" }];
const NO_PACKS: OwnPack[] = [];
/** Что стоит рядом с объектом для сравнения: вещь ровно в одну клетку на этом виде карты. */
const REFERENCE: Record<MapKind, string> = { tactical: "человек", city: "дом", overview: "клетка" };
const cellsOf = (value: number) => Math.max(0.5, Math.min(16, Math.round(value * 2) / 2));

/** Набор одним файлом для обмена (гриллинг Q19): zip с описанием и картинками. */
async function exportPack(pack: OwnPack) {
  const token = getAuthToken();
  const res = await fetch(`/api/map-packs/${pack.id}/export`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
  if (!res.ok) throw new Error(`сервер ответил ${res.status}`);
  const url = URL.createObjectURL(await res.blob()), link = document.createElement("a");
  link.href = url;
  link.download = `${pack.name.replace(/[\\/:*?"<>|]+/g, "_")}.zip`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/** Что лежит во встроенном наборе — только посмотреть: править и копировать встроенные нельзя. */
type BuiltinTile = { name: string; url: string | null; note?: string };
function builtinSections(id: string): { name: string; tiles: BuiltinTile[] }[] {
  const size = (cells: readonly [number, number]) => `${cells[0]}×${cells[1]} кл.`;
  if (id === "village") return [
    ...(Object.keys(VILLAGE_CATEGORIES) as VillageCategory[]).map((key) => ({ name: VILLAGE_CATEGORIES[key],
      tiles: VILLAGE_OBJECTS.filter((item) => item.category === key).map((item) => ({ name: item.name, url: villageUrl(item.key), note: `${size(item.cells)}${item.variants > 1 ? ` · вариантов: ${item.variants}` : ""}` })) })),
    { name: "Поверхности", tiles: VILLAGE_SURFACES.map((item) => ({ name: item.name, url: villageUrl(item.key) })) },
    { name: "Дороги и ограды", tiles: VILLAGE_ROADS.map((item) => ({ name: item.name, url: villageUrl(item.key), note: `ширина ${item.width} кл.` })) },
    { name: "Реки", tiles: VILLAGE_RIVERS.map((item) => ({ name: item.name, url: villageUrl(item.key), note: `ширина ${item.width} кл.` })) },
  ].filter((section) => section.tiles.length);
  if (id === "world") return [
    ...(Object.keys(WORLD_CATEGORIES) as WorldCategory[]).map((key) => ({ name: WORLD_CATEGORIES[key],
      tiles: WORLD_OBJECTS.filter((item) => item.category === key).map((item) => ({ name: item.name, url: worldUrl(item.key), note: `${item.cells[0]} кл.${item.variants > 1 ? ` · вариантов: ${item.variants}` : ""}` })) })),
    { name: "Земля", tiles: WORLD_SURFACES.map((item) => ({ name: item.name, url: worldUrl(item.key) })) },
    { name: "Линии атласа", tiles: ["Тракт", "Дорога", "Тропа", "Морской путь", "Река"].map((name) => ({ name, url: null, note: "рисует редактор" })) },
  ];
  if (id === "crypt") return (Object.keys(CRYPT_CATEGORIES) as CryptCategory[]).map((key) => ({ name: CRYPT_CATEGORIES[key],
    tiles: CRYPT_OBJECTS.filter((item) => item.category === key).map((item) => ({ name: item.name, url: cryptUrl(item.directional ? `${item.key}-s` : item.key), note: `${size(item.cells)}${item.directional ? " · виды по сторонам" : ""}` })) }));
  return [
    { name: "Подземелье", tiles: CARTOGRAPHY_OBJECTS.filter((item) => item.group === "dungeon").map((item) => ({ name: item.name, url: cartographyUrl(item.key) })) },
    { name: "Мир", tiles: CARTOGRAPHY_OBJECTS.filter((item) => item.group === "region").map((item) => ({ name: item.name, url: cartographyUrl(item.key) })) },
    { name: "Знаки", tiles: MAP_SYMBOL_ASSETS.map((item) => ({ name: item.name, url: null })) },
    { name: "Поверхности", tiles: CARTOGRAPHY_SURFACES.map((item) => ({ name: item.name, url: "key" in item && item.key ? cartographyUrl(item.key) : null })) },
  ];
}

/** Объект на сетке: сколько клеток он занимает, рядом — вещь в одну клетку. */
function SizeGrid({ src, w, h, reference }: { src: string | null; w: number; h: number; reference: string }) {
  const cols = Math.max(4, Math.ceil(w) + 2), rows = Math.max(3, Math.ceil(h) + 1), cell = Math.min(56, 320 / cols);
  return <svg viewBox={`0 0 ${cols * cell} ${rows * cell}`} role="img" aria-label={`Объект ${w} на ${h} клеток рядом с меркой «${reference}»`}
    style={{ display: "block", width: "100%", maxHeight: 280, border: "2px solid currentColor", background: "var(--paper, #f4efe2)" }}>
    {Array.from({ length: cols - 1 }, (_, i) => <line key={`x${i}`} x1={(i + 1) * cell} y1={0} x2={(i + 1) * cell} y2={rows * cell} stroke="currentColor" strokeOpacity={0.2} />)}
    {Array.from({ length: rows - 1 }, (_, i) => <line key={`y${i}`} x1={0} y1={(i + 1) * cell} x2={cols * cell} y2={(i + 1) * cell} stroke="currentColor" strokeOpacity={0.2} />)}
    <rect x={2} y={(rows - 1) * cell + 2} width={cell - 4} height={cell - 4} fill="currentColor" fillOpacity={0.18} stroke="currentColor" strokeWidth={2} />
    <text x={cell / 2} y={(rows - 1) * cell + cell / 2} textAnchor="middle" dominantBaseline="middle" fontSize={Math.max(8, cell * 0.2)} fill="currentColor">{reference}</text>
    <rect x={cell} y={(rows - h) * cell} width={w * cell} height={h * cell} fill="none" stroke="var(--accent-2, #ff3e91)" strokeWidth={2} strokeDasharray="6 4" />
    {src && <image href={src} x={cell} y={(rows - h) * cell} width={w * cell} height={h * cell} preserveAspectRatio="xMidYMid meet" />}
  </svg>;
}

function PackDialog({ pack, onClose }: { pack: OwnPack | null; onClose: (saved?: OwnPack) => void }) {
  const run = useAction();
  const [name, setName] = useState(pack?.name ?? ""), [kinds, setKinds] = useState<MapKind[]>(pack?.kinds ?? ["tactical"]);
  const [genres, setGenres] = useState<SettingGenre[]>(pack?.genres ?? []), [picking, setPicking] = useState(false);
  async function save() {
    const body = { name, kinds, genres };
    const saved = await run(labelled("Набор не сохранён", () => pack ? write.put<OwnPack>(`/map-packs/${pack.id}`, body) : write.post<OwnPack>("/map-packs", body)), { affects: AFFECTS });
    if (saved) onClose(saved);
  }
  if (picking) return <GenrePicker selected={genres} title="Жанры набора" hint="До трёх жанров: по ним набор находится при создании карты и в каталоге."
    onSave={(next) => { setGenres(next); setPicking(false); }} onClose={() => setPicking(false)} />;
  return <Modal onClose={() => onClose()} className="maps-win" ariaLabel={pack ? "Набор ассетов" : "Новый набор ассетов"}>
    <h2>{pack ? "Набор ассетов" : "Новый набор ассетов"}</h2>
    <div className="stack">
      <label>Название<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Например, Порт Оскольд" /></label>
      <fieldset style={{ border: "1px solid var(--line)", padding: "8px 10px" }}>
        <legend>Для каких карт</legend>
        {KINDS.map((kind) => <label key={kind} className="row" style={{ gap: 6 }}>
          <input type="checkbox" checked={kinds.includes(kind)} onChange={(event) => setKinds(event.target.checked ? [...kinds, kind] : kinds.filter((entry) => entry !== kind))} />{MAP_KIND_LABELS[kind]}
        </label>)}
        <small className="muted">Размеры вещей задаются под первый отмеченный вид. На других видах карты набор тоже будет в каталоге.</small>
      </fieldset>
      <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        <span>Жанры: {genreLabel(genres) || "не заданы — набор предлагается любой карте"}</span>
        <button type="button" onClick={() => setPicking(true)}>Выбрать жанры…</button>
      </div>
      <div className="modal-footer row"><button onClick={() => onClose()}>Отмена</button><button className="primary" disabled={!name.trim() || !kinds.length} onClick={save}>Сохранить</button></div>
    </div>
  </Modal>;
}

function ObjectDialog({ pack, item, onClose }: { pack: OwnPack; item: OwnPackItem | null; onClose: () => void }) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  useMapImageRevision();
  const [file, setFile] = useState<File | null>(null), [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [name, setName] = useState(item?.name ?? ""), [section, setSection] = useState(item?.section ?? ""), [tags, setTags] = useState(item?.tags ?? "");
  const [w, setW] = useState(item?.w ?? 1), [h, setH] = useState(item?.h ?? 1), [locked, setLocked] = useState(true);
  const [blocks, setBlocks] = useState(item?.blocks_sight ?? false), [light, setLight] = useState(item?.light ? String(item.light) : "");
  const [note, setNote] = useState<string | null>(null);
  const preview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const variants = item ? liveImages(item) : [];
  const shown = preview ?? (variants[0] ? ownImageSrc(ownImageId(variants[0])) : null);
  // Пропорции — у новой картинки её собственные, у готового объекта — его размер в клетках.
  const aspect = natural ? natural.w / natural.h : item ? item.w / item.h : 1;
  const sections = [...new Set(pack.items.map((entry) => entry.section).filter(Boolean))];
  const small = natural && (natural.w < w * PACK_CELL_PX && natural.h < h * PACK_CELL_PX);

  function choose(next: File | null) {
    setFile(next); setNatural(null);
    if (!next) return;
    if (!name) setName(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80));
    const image = new Image(), url = URL.createObjectURL(next);
    image.onload = () => { setNatural({ w: image.naturalWidth, h: image.naturalHeight }); if (!item) setH(cellsOf(w * image.naturalHeight / image.naturalWidth)); URL.revokeObjectURL(url); };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }
  const width = (value: number) => { const next = cellsOf(value); setW(next); if (locked) setH(cellsOf(next / aspect)); };
  const height = (value: number) => { const next = cellsOf(value); setH(next); if (locked) setW(cellsOf(next * aspect)); };

  async function save() {
    setNote(null);
    if (!item) {
      if (!file) return;
      const form = new FormData();
      form.append("file", file); form.append("name", name); form.append("section", section); form.append("tags", tags); form.append("w", String(w)); form.append("h", String(h));
      const saved = await run(labelled("Объект не добавлен", () => write.post<{ small: boolean }>(`/map-packs/${pack.id}/items`, form)), { affects: AFFECTS });
      if (saved) onClose();
      return;
    }
    const lightValue = Number(light);
    const saved = await run(labelled("Объект не сохранён", () => write.put(`/map-packs/items/${item.id}`, { name, section, tags, w, h, blocks_sight: blocks, light: light && lightValue > 0 ? lightValue : null })), { affects: AFFECTS });
    if (saved) onClose();
  }
  async function addVariant(next: File | null) {
    if (!item || !next) return;
    const form = new FormData(); form.append("file", next);
    const saved = await run(labelled("Вариант не добавлен", () => write.post<{ small: boolean }>(`/map-packs/items/${item.id}/images`, form)), { affects: AFFECTS });
    if (saved?.small) setNote("Вариант мельче стандарта: на крупном приближении он будет мягким.");
  }
  async function addSide(side: string, next: File | null) {
    if (!item || !next) return;
    const form = new FormData(); form.append("file", next); form.append("role", side);
    await run(labelled("Вид не добавлен", () => write.post<{ small: boolean }>(`/map-packs/items/${item.id}/images`, form)), { affects: AFFECTS });
  }
  const removeImage = (id: number, label: string) => void run(labelled(label, () => write.del(`/map-packs/images/${id}`).then(() => true)), { affects: AFFECTS });
  async function remove() {
    if (!item || !await confirm({ title: `Убрать «${item.name}» из набора?`, message: "В каталоге объекта не будет. На картах, где он уже стоит, он останется.", confirmLabel: "Убрать", cancelLabel: "Оставить", danger: true })) return;
    if (await run(labelled("Объект не убран", () => write.del(`/map-packs/items/${item.id}`).then(() => true)), { affects: AFFECTS })) onClose();
  }

  return <Modal onClose={onClose} wide className="maps-win maps-win--wide" ariaLabel={item ? `Объект «${item.name}»` : "Новый объект"}>
    <h2>{item ? `Объект «${item.name}»` : "Новый объект"}</h2>
    {/* Доска Map-Win-Object: слева — вещь на сетке рядом с меркой, справа — поля. */}
    <div className="maps-win__cols">
      <div className="maps-win__col">
        <div><span className="maps-lbl">На сетке</span>
          <SizeGrid src={shown} w={w} h={h} reference={REFERENCE[pack.kinds[0] ?? "tactical"]} /></div>
        <p className="maps-win__note">Мерка «{REFERENCE[pack.kinds[0] ?? "tactical"]}» — одна клетка. Размер задаётся числом справа.</p>
        {small && <p className="maps-win__note" role="status">Картинка мельче стандарта ({PACK_CELL_PX} точек на клетку): на крупном приближении будет мягкой.</p>}
      </div>
      <div className="maps-win__col">
        {!item && <label>Картинка<input type="file" accept={IMAGES} onChange={(event) => choose(event.target.files?.[0] ?? null)} /></label>}
        <div className="maps-win__pair">
          <label>Название<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
          <label>Раздел<input value={section} maxLength={40} list="map-pack-sections" placeholder="Например, Мебель" onChange={(event) => setSection(event.target.value)} /></label>
        </div>
        <datalist id="map-pack-sections">{sections.map((entry) => <option key={entry} value={entry} />)}</datalist>
        <label>Теги через запятую<input value={tags} maxLength={200} onChange={(event) => setTags(event.target.value)} /></label>
        <div className="maps-win__pair">
          <label>Ширина, клеток<input type="number" min={0.5} max={16} step={0.5} value={w} onChange={(event) => width(Number(event.target.value))} /></label>
          <label>Высота, клеток<input type="number" min={0.5} max={16} step={0.5} value={h} onChange={(event) => height(Number(event.target.value))} /></label>
        </div>
        <label><input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />Держать пропорции картинки</label>
        {item && <>
          <label><input type="checkbox" checked={blocks} onChange={(event) => setBlocks(event.target.checked)} />Преграждает обзор</label>
          <label>Источник света, радиус в клетках<input type="number" min={0} max={60} step={0.5} value={light} placeholder="не светит" onChange={(event) => setLight(event.target.value)} /></label>
          <small>Обзор и свет начнут работать вместе со светом и туманом.</small>
          <div>
            <span className="maps-lbl">Варианты · {variants.length}</span>
            <div className="maps-thumbs">
              {variants.map((image, index) => { const url = ownImageSrc(ownImageId(image)); return <span key={image.id} className="maps-thumb">
                {url && <img src={url} alt={`Вариант ${index + 1}`} />}
                <button type="button" className="maps-thumb__x" disabled={variants.length < 2} title="Убрать вариант" aria-label={`Убрать вариант ${index + 1}`}
                  onClick={() => removeImage(image.id, "Вариант не убран")}>×</button>
              </span>; })}
              <label className="maps-thumb maps-thumb--add" title="Добавить вариант">+<input type="file" hidden aria-label="Добавить вариант" accept={IMAGES} onChange={(event) => { void addVariant(event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
            </div>
            <small>Каталог ставит случайный вариант; конкретный можно выбрать в полосе вариантов.</small>
          </div>
          <div>
            <span className="maps-lbl">Виды по сторонам — для вещей, которые смотрят в комнату</span>
            <div className="maps-thumbs">
              {OWN_SIDES.map(([side, label]) => { const image = sideImage(item, side), url = image ? ownImageSrc(ownImageId(image)) : null; return <span key={side} className={`maps-thumb maps-thumb--side${url ? " is-filled" : ""}`}>
                <label title={`Вид: ${label.toLocaleLowerCase("ru")}`}>{url ? <img src={url} alt={label} /> : <span>{label}</span>}
                  <input type="file" hidden aria-label={`Вид: ${label.toLocaleLowerCase("ru")}`} accept={IMAGES} onChange={(event) => { void addSide(side, event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
                {image && <button type="button" className="maps-thumb__x" title="Убрать вид" aria-label={`Убрать вид «${label}»`} onClick={() => removeImage(image.id, "Вид не убран")}>×</button>}
              </span>; })}
            </div>
            <small>Для предметов, нарисованных «с лица»: трон, шкаф, стул. Основная картинка — без поворота; добавленный вид карта возьмёт вместо кручения картинки.</small>
          </div>
        </>}
        {note && <p className="maps-win__note" role="status">{note}</p>}
      </div>
    </div>
    <div className="modal-footer row">
      {item && <button className="maps-win__left is-danger" onClick={remove}>Убрать из набора</button>}
      <button onClick={onClose}>{item ? "Закрыть" : "Отмена"}</button>
      <button className="primary" disabled={!name.trim() || (!item && !file)} onClick={save}>{item ? "Сохранить" : "Добавить"}</button>
    </div>
    {dialog}
  </Modal>;
}

/** Поверхность набора: бесшовный образец. Картинка обрезается до квадрата, края склеиваются подмесом —
 * предпросмотр 3×3 показывает ровно то, что уйдёт в набор. */
const TIERS = ["Низ — земля, вода", "Середина — трава, посевы", "Верх — камень, настил"];
/** Пятно поверхности на нейтральной земле: край считается тем же кодом, что и на карте. Сетка — клетки. */
function EdgePreview({ art, cells, fill, edge }: { art: HTMLImageElement | HTMLCanvasElement | null; cells: number; fill: string; edge: SurfaceEdge }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const pen = ref.current?.getContext("2d");
    if (!pen) return;
    const side = 280, samples = 28, sample = 0.25, perUnit = side / (samples * sample);
    const inside = (sx: number, sy: number) => {
      const dx = sx + 0.5 - samples / 2, dy = sy + 0.5 - samples / 2, angle = Math.atan2(dy, dx);
      return Math.hypot(dx, dy) < samples * 0.3 * (1 + 0.18 * Math.sin(angle * 3) + 0.1 * Math.cos(angle * 5));
    };
    const field = edgeField(samples, 0, 0, (sx, sy) => inside(sx, sy) ? 0 : -Infinity, 0, edgeWindow(edge, sample));
    const layer = document.createElement("canvas"); layer.width = layer.height = side;
    const paint = layer.getContext("2d")!, pixels = paint.createImageData(side, side);
    edgeAlpha(field, samples, pixels.data, side, { ramp: edgeRamp(edge, sample), rough: edge.rough, noise: edgeNoiseOf(edge), x: 0, y: 0, perUnit });
    paint.putImageData(pixels, 0, 0); paint.globalCompositeOperation = "source-in";
    const pattern = art ? paint.createPattern(art, "repeat") : null, k = cells * perUnit / (art?.width || 1);
    pattern?.setTransform(new DOMMatrix([k, 0, 0, k, 0, 0]));
    paint.fillStyle = pattern ?? fill; paint.fillRect(0, 0, side, side);
    pen.fillStyle = "#8d7b5a"; pen.fillRect(0, 0, side, side); pen.drawImage(layer, 0, 0);
    pen.strokeStyle = "rgba(0,0,0,.25)"; pen.lineWidth = 1; pen.beginPath();
    for (let line = perUnit; line < side; line += perUnit) { pen.moveTo(line + 0.5, 0); pen.lineTo(line + 0.5, side); pen.moveTo(0, line + 0.5); pen.lineTo(side, line + 0.5); }
    pen.stroke();
  });
  return <canvas ref={ref} width={280} height={280} role="img" aria-label="Пятно поверхности на земле: так выглядит её край на карте" style={{ width: "100%", maxWidth: 280, border: "2px solid currentColor" }} />;
}

function SurfaceDialog({ pack, item, onClose }: { pack: OwnPack; item: OwnPackItem | null; onClose: () => void }) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  useMapImageRevision();
  const [source, setSource] = useState<HTMLImageElement | null>(null), [blend, setBlend] = useState(15);
  const [name, setName] = useState(item?.name ?? ""), [section, setSection] = useState(item?.section ?? ""), [tags, setTags] = useState(item?.tags ?? "");
  const [cells, setCells] = useState(item?.cells ?? 4);
  const [edgeWidth, setEdgeWidth] = useState(item?.edge_width ?? 0.25), [rough, setRough] = useState(Math.round((item?.edge_rough ?? 0) * 100)), [tier, setTier] = useState(item?.tier ?? 1);
  const mask = item ? sideImage(item, "edge") : null;
  const edge = ownEdge({ edge_width: edgeWidth, edge_rough: rough / 100, tier, cells, images: item?.images ?? [] });
  const tile = useMemo(() => source ? seamlessTile(source, blend / 100) : null, [source, blend]);
  const preview = useMemo(() => tile?.toDataURL("image/png") ?? null, [tile]);
  const variants = item ? liveImages(item) : [];
  const shown = preview ?? (variants[0] ? ownImageSrc(ownImageId(variants[0])) : null);
  const sections = [...new Set(pack.items.map((entry) => entry.section).filter(Boolean))];
  const lines = 100 / (3 * cells);

  function choose(next: File | null) {
    setSource(null);
    if (!next) return;
    if (!name) setName(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80));
    const image = new Image(), url = URL.createObjectURL(next);
    image.onload = () => { setSource(image); URL.revokeObjectURL(url); };
    image.onerror = () => URL.revokeObjectURL(url);
    image.src = url;
  }
  const form = async (fields: Record<string, string>) => {
    const body = new FormData(), blob = await new Promise<Blob | null>((resolve) => tile!.toBlob(resolve, "image/png"));
    body.append("file", blob!, "surface.png");
    for (const [key, value] of Object.entries(fields)) body.append(key, value);
    return body;
  };
  async function save() {
    const saved = item
      ? await run(labelled("Поверхность не сохранена", () => write.put(`/map-packs/items/${item.id}`, { name, section, tags, cells, edge_width: edgeWidth, edge_rough: rough / 100, tier })), { affects: AFFECTS })
      : tile && await run(labelled("Поверхность не добавлена", async () => write.post(`/map-packs/${pack.id}/items`, await form({ kind: "surface", name, section, tags, cells: String(cells), edge_width: String(edgeWidth), edge_rough: String(rough / 100), tier: String(tier) }))), { affects: AFFECTS });
    if (saved) onClose();
  }
  async function addVariant() {
    if (!item || !tile) return;
    if (await run(labelled("Вариант не добавлен", async () => write.post(`/map-packs/items/${item.id}/images`, await form({}))), { affects: AFFECTS })) setSource(null);
  }
  async function addMask(next: File | null) {
    if (!item || !next) return;
    const body = new FormData(); body.append("file", next); body.append("role", "edge");
    await run(labelled("Маска кромки не загружена", () => write.post(`/map-packs/items/${item.id}/images`, body)), { affects: AFFECTS });
  }
  async function remove() {
    if (!item || !await confirm({ title: `Убрать «${item.name}» из набора?`, message: "В каталоге поверхности не будет. На картах, где ею уже красили, она останется.", confirmLabel: "Убрать", cancelLabel: "Оставить", danger: true })) return;
    if (await run(labelled("Поверхность не убрана", () => write.del(`/map-packs/items/${item.id}`).then(() => true)), { affects: AFFECTS })) onClose();
  }
  const picker = <label>{item ? "Добавить вариант" : "Картинка"}<input type="file" aria-label={item ? "Картинка варианта" : "Картинка поверхности"} accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>;

  return <Modal onClose={onClose} wide className="maps-win maps-win--wide" ariaLabel={item ? `Поверхность «${item.name}»` : "Новая поверхность"}>
    <h2>{item ? "Поверхность набора" : "Новая поверхность"}</h2>
    <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="stack" style={{ flex: "1 1 300px", minWidth: 260 }}>
        <div role="img" aria-label={`Образец повторён три на три, сетка — клетки карты: один повтор на ${cells} клеток`}
          style={{ position: "relative", width: "100%", maxWidth: 360, aspectRatio: "1", border: "2px solid currentColor", backgroundColor: item?.fill ?? "var(--paper, #f4efe2)",
            backgroundImage: shown ? `url(${shown})` : undefined, backgroundSize: "33.334% 33.334%" }}>
          <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(to right, rgba(0,0,0,.4) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,.4) 1px, transparent 1px)", backgroundSize: `${lines}% ${lines}%` }} />
        </div>
        <small className="muted">Образец повторён 3×3 — швов быть не должно. Сетка поверх — клетки карты.</small>
        <label>Один повтор покрывает, клеток<input type="number" min={1} max={16} step={1} value={cells} onChange={(event) => setCells(Math.max(1, Math.min(16, Math.round(Number(event.target.value)) || 1)))} /></label>
        {source && <label>Подмес шва: {blend}%<input type="range" min={0} max={40} step={1} value={blend} onChange={(event) => setBlend(Number(event.target.value))} />
          <small className="muted">0 — если образец уже бесшовный. Для травы, камня, песка хватает 10–20%; крупный рисунок в полосе подмеса двоится.</small></label>}
        {source && Math.min(source.naturalWidth, source.naturalHeight) < Math.min(cells, 4) * PACK_CELL_PX && <p className="muted" role="status">Картинка мельче стандарта ({PACK_CELL_PX} точек на клетку): на крупном приближении будет мягкой.</p>}
      </div>
      <div className="stack" style={{ flex: "1 1 280px", minWidth: 240 }}>
        {!item && picker}
        <label>Название<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label>Раздел<input value={section} maxLength={40} list="map-pack-sections" placeholder="Например, Полы" onChange={(event) => setSection(event.target.value)} /></label>
        <datalist id="map-pack-sections">{sections.map((entry) => <option key={entry} value={entry} />)}</datalist>
        <label>Теги через запятую<input value={tags} maxLength={200} onChange={(event) => setTags(event.target.value)} /></label>
        {item && <div className="stack">
          <strong>Варианты</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {variants.map((image, index) => { const url = ownImageSrc(ownImageId(image)); return <span key={image.id} style={{ position: "relative", width: 64, height: 64, border: "2px solid currentColor" }}>
              {url && <img src={url} alt={`Вариант ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "cover" }} />}
              <button type="button" disabled={variants.length < 2} title="Убрать вариант" aria-label={`Убрать вариант ${index + 1}`} style={{ position: "absolute", top: 0, right: 0, padding: "0 5px", height: 20 }}
                onClick={() => void run(labelled("Вариант не убран", () => write.del(`/map-packs/images/${image.id}`).then(() => true)), { affects: AFFECTS })}>×</button>
            </span>; })}
          </div>
          {picker}
          {source && <button type="button" className="primary" onClick={() => void addVariant()}>Добавить вариант в набор</button>}
          <small className="muted">Каждый вариант красится отдельно: в каталоге они стоят полосой под плиткой, на карте их можно смешивать.</small>
        </div>}
      </div>
      <div className="stack" style={{ flex: "1 1 280px", minWidth: 240 }}>
        <strong>Край на карте</strong>
        <EdgePreview art={tile ?? (variants[0] ? getMapImageAsset(ownImageId(variants[0]))?.image ?? null : null)} cells={cells} fill={item?.fill ?? "#8a8a80"} edge={edge} />
        <label>Ширина кромки: {edgeWidth ? `${edgeWidth} кл.` : "чёткий край"}<input type="range" aria-label="Ширина кромки" min={0} max={1} step={0.05} value={edgeWidth} onChange={(event) => setEdgeWidth(Number(event.target.value))} /></label>
        <label>Рваность: {rough}%<input type="range" aria-label="Рваность кромки" min={0} max={100} step={5} value={rough} onChange={(event) => setRough(Number(event.target.value))} />
          <small className="muted">Чем шире кромка, тем крупнее клочья. При нулевой ширине рваность почти не видна.</small></label>
        <label>Ярус<select aria-label="Ярус поверхности" value={tier} onChange={(event) => setTier(Number(event.target.value))}>{TIERS.map((label, value) => <option key={value} value={value}>{label}</option>)}</select>
          <small className="muted">Верхняя поверхность лежит на нижней: под её рваным краем видна нижняя.</small></label>
        {item ? <div className="stack">
          <label>{mask ? "Заменить маску кромки" : "Своя маска кромки"}<input type="file" aria-label="Маска кромки" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(event) => { void addMask(event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
          {mask && <button type="button" onClick={() => void run(labelled("Маска не убрана", () => write.del(`/map-packs/images/${mask.id}`).then(() => true)), { affects: AFFECTS })}>Убрать маску — вернуть шум движка</button>}
          <small className="muted">Серая бесшовная картинка: где темнее, край отступает раньше. Повторяется с тем же шагом, что и поверхность.</small>
        </div> : <small className="muted">Свою маску кромки можно загрузить после добавления поверхности.</small>}
      </div>
    </div>
    <div className="modal-footer row">
      {item && <button onClick={remove}>Убрать из набора</button>}
      <button onClick={onClose}>{item ? "Закрыть" : "Отмена"}</button>
      <button className="primary" disabled={!name.trim() || (!item && !tile)} onClick={() => void save()}>{item ? "Сохранить" : "Добавить"}</button>
    </div>
    {dialog}
  </Modal>;
}

const STRIP_KINDS = [["line:road", "Дорога"], ["line:river", "Река — течёт"], ["line:wall", "Ограда — преграждает путь"],
  ["crossing:bridge-wood", "Переправа: деревянный мост"], ["crossing:bridge-stone", "Переправа: каменный мост"], ["crossing:ford", "Переправа: брод"]] as const;
const IMAGES = "image/png,image/jpeg,image/webp,image/avif,image/gif";

/** Линия, переправа или россыпь. Линия — полоса, которую движок тянет вдоль пути: высота картинки — ширина линии.
 * Переправа заменяет дорогу своего набора над водой. Россыпь — несколько картинок, которые движок раскидывает по области. */
function ThingDialog({ pack, item, mode, onClose }: { pack: OwnPack; item: OwnPackItem | null; mode: "line" | "scatter" | "door"; onClose: () => void }) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  useMapImageRevision();
  const [file, setFile] = useState<File | null>(null);
  const [name, setName] = useState(item?.name ?? ""), [section, setSection] = useState(item?.section ?? ""), [tags, setTags] = useState(item?.tags ?? "");
  const [what, setWhat] = useState<string>(item?.kind === "crossing" ? `crossing:${item.deck}` : `line:${item?.use ?? "road"}`);
  const [width, setWidth] = useState(item?.width ?? 1), [size, setSize] = useState(item?.size ?? 1), [density, setDensity] = useState(item?.density ?? 0.8);
  const [span, setSpan] = useState(item?.span ?? 1), [secret, setSecret] = useState(item?.secret ?? false), door = mode === "door";
  const preview = useMemo(() => file ? URL.createObjectURL(file) : null, [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const variants = item ? liveImages(item) : [], post = item ? sideImage(item, "post") : null;
  const shown = preview ?? (variants[0] ? ownImageSrc(ownImageId(variants[0])) : null);
  const [kind, sub] = what.split(":"), scatter = mode === "scatter", title = door ? "Проём" : scatter ? "Россыпь" : kind === "crossing" ? "Переправа" : "Линия";
  const sections = [...new Set(pack.items.map((entry) => entry.section).filter(Boolean))];
  const number = (set: (value: number) => void, min: number, max: number) => (event: { target: { value: string } }) => set(Math.max(min, Math.min(max, Number(event.target.value) || min)));

  function choose(next: File | null) {
    setFile(next);
    if (next && !name) setName(next.name.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80));
  }
  async function save() {
    const fields = { name, section, tags, width, size, density, span, secret, ...(scatter || door ? {} : kind === "line" ? { use: sub } : { deck: sub }) };
    let saved: unknown;
    if (item) saved = await run(labelled(`${title} не сохранена`, () => write.put(`/map-packs/items/${item.id}`, fields)), { affects: AFFECTS });
    else if (file) {
      const form = new FormData();
      form.append("file", file); form.append("kind", door ? "door" : scatter ? "scatter" : kind);
      for (const [key, value] of Object.entries(fields)) form.append(key, String(value));
      saved = await run(labelled(`${title} не добавлена`, () => write.post(`/map-packs/${pack.id}/items`, form)), { affects: AFFECTS });
    }
    if (saved) onClose();
  }
  async function addImage(role: string, next: File | null) {
    if (!item || !next) return;
    const form = new FormData(); form.append("file", next); form.append("role", role);
    await run(labelled("Картинка не добавлена", () => write.post(`/map-packs/items/${item.id}/images`, form)), { affects: AFFECTS });
  }
  const removeImage = (id: number) => void run(labelled("Картинка не убрана", () => write.del(`/map-packs/images/${id}`).then(() => true)), { affects: AFFECTS });
  async function remove() {
    if (!item || !await confirm({ title: `Убрать «${item.name}» из набора?`, message: "В каталоге её не будет. На картах, где она уже есть, она останется.", confirmLabel: "Убрать", cancelLabel: "Оставить", danger: true })) return;
    if (await run(labelled("Не убрано", () => write.del(`/map-packs/items/${item.id}`).then(() => true)), { affects: AFFECTS })) onClose();
  }
  const thumb = (image: { id: number }, url: string | null, label: string, removable: boolean) => <span key={image.id} style={{ position: "relative", width: 64, height: 64, border: "2px solid currentColor" }}>
    {url && <img src={url} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
    <button type="button" disabled={!removable} title="Убрать" aria-label={`Убрать: ${label}`} style={{ position: "absolute", top: 0, right: 0, padding: "0 5px", height: 20 }} onClick={() => removeImage(image.id)}>×</button>
  </span>;

  return <Modal onClose={onClose} wide className="maps-win maps-win--wide" ariaLabel={item ? `${title} «${item.name}»` : `Новая ${title.toLocaleLowerCase("ru")}`}>
    <h2>{item ? `${title} набора` : door ? "Новый проём" : scatter ? "Новая россыпь" : "Новая линия или переправа"}</h2>
    <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="stack" style={{ flex: "1 1 300px", minWidth: 260 }}>
        {scatter || door
          ? <div style={{ height: 140, border: "2px solid currentColor", background: "var(--paper, #f4efe2)" }}>{shown && <img src={shown} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}</div>
          : <div role="img" aria-label="Полоса, повторённая вдоль линии" style={{ height: 64, border: "2px solid currentColor", backgroundColor: "var(--paper, #f4efe2)", backgroundImage: shown ? `url(${shown})` : undefined, backgroundSize: "auto 100%", backgroundRepeat: "repeat-x" }} />}
        {door ? <>
          <small className="muted">Проём нарисован сверху: стена идёт слева направо, картинка занимает ширину проёма. На карте он встаёт на ребро клетки и поворачивается вдоль стены.</small>
          <label>Ширина, клеток<input type="number" min={1} max={4} step={1} value={span} onChange={number(setSpan, 1, 4)} /></label>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={secret} onChange={(event) => setSecret(event.target.checked)} />Потайной: игрокам не виден</label>
        </> : scatter ? <>
          <label>Размер знака, клеток<input type="number" min={0.25} max={8} step={0.25} value={size} onChange={number(setSize, 0.25, 8)} /></label>
          <label>Густота по умолчанию, знаков на клетку<input type="number" min={0.05} max={4} step={0.05} value={density} onChange={number(setDensity, 0.05, 4)} /></label>
          <small className="muted">Густоту и размер Мастер может поменять на карте, в настройках инструмента «Россыпь».</small>
        </> : <>
          <small className="muted">Полоса тянется слева направо и повторяется встык: левый и правый край картинки должны сходиться. Высота картинки — ширина линии.</small>
          <label>Что это<select value={what} onChange={(event) => setWhat(event.target.value)}>{STRIP_KINDS.filter(([value]) => !item || value.startsWith(`${item.kind}:`)).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label>Ширина, клеток<input type="number" min={0.25} max={8} step={0.25} value={width} onChange={number(setWidth, 0.25, 8)} /></label>
          {kind === "crossing" && <small className="muted">Дорога из этого набора над водой сменится этой переправой. У дорог других наборов переправы свои или общие.</small>}
        </>}
      </div>
      <div className="stack" style={{ flex: "1 1 280px", minWidth: 240 }}>
        {!item && <label>Картинка<input type="file" aria-label="Картинка" accept={IMAGES} onChange={(event) => choose(event.target.files?.[0] ?? null)} /></label>}
        <label>Название<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label>Раздел<input value={section} maxLength={40} list="map-pack-sections" onChange={(event) => setSection(event.target.value)} /></label>
        <datalist id="map-pack-sections">{sections.map((entry) => <option key={entry} value={entry} />)}</datalist>
        <label>Теги через запятую<input value={tags} maxLength={200} onChange={(event) => setTags(event.target.value)} /></label>
        {item && <div className="stack">
          <strong>{scatter ? "Картинки россыпи" : "Варианты"}</strong>
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>{variants.map((image, index) => thumb(image, ownImageSrc(ownImageId(image)), `вариант ${index + 1}`, variants.length > 1))}</div>
          <label>Добавить картинку<input type="file" aria-label="Добавить картинку" accept={IMAGES} onChange={(event) => { void addImage("variant", event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
          {scatter && <small className="muted">Движок раскидывает по области все картинки вперемешку.</small>}
        </div>}
        {item?.kind === "line" && <div className="stack">
          <strong>Столб</strong>
          <small className="muted">Ставится на каждом изломе и на концах линии: закрывает стык полосы. Нужен оградам; дороге и реке не обязателен.</small>
          <div className="row" style={{ gap: 6 }}>{post && thumb(post, ownImageSrc(ownImageId(post)), "столб", true)}</div>
          <label>{post ? "Заменить столб" : "Добавить столб"}<input type="file" aria-label="Картинка столба" accept={IMAGES} onChange={(event) => { void addImage("post", event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
        </div>}
      </div>
    </div>
    <div className="modal-footer row">
      {item && <button onClick={remove}>Убрать из набора</button>}
      <button onClick={onClose}>{item ? "Закрыть" : "Отмена"}</button>
      <button className="primary" disabled={!name.trim() || (!item && !file)} onClick={() => void save()}>{item ? "Сохранить" : "Добавить"}</button>
    </div>
    {dialog}
  </Modal>;
}

/** Подпись плитки вещи на экране набора. */
/** Жидкость набора (В16): рецепт без картинок, проверяется на пруду в четырёх видах воды. Новая — на основе воды. */
function LiquidDialog({ pack, item, onClose }: { pack: OwnPack; item: OwnPackItem | null; onClose: () => void }) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  const [name, setName] = useState(item?.name ?? ""), [section, setSection] = useState(item?.section ?? ""), [tags, setTags] = useState(item?.tags ?? "");
  const [recipe, setRecipe] = useState(() => { const { key: _key, name: _name, ref: _ref, ...fields } = item ? packLiquidRecipe(item, "") : { ...LIQUIDS[0], ref: undefined }; const { fill: _fill, ...rest } = fields as typeof fields & { fill?: string }; return { ...rest, tones: [...rest.tones] as [string, string, string] }; });
  const sections = [...new Set(pack.items.map((entry) => entry.section).filter(Boolean))];
  async function save() {
    const fields = { name, section, tags, ...recipe };
    const saved = item ? await run(labelled("Жидкость не сохранена", () => write.put(`/map-packs/items/${item.id}`, fields)), { affects: AFFECTS })
      : await run(labelled("Жидкость не добавлена", () => write.post(`/map-packs/${pack.id}/liquids`, fields)), { affects: AFFECTS });
    if (saved) onClose();
  }
  async function remove() {
    if (!item || !await confirm({ title: `Убрать «${item.name}» из набора?`, message: "В меню жидкостей её не будет. На картах, где она уже есть, она останется — такой, какой была.", confirmLabel: "Убрать", cancelLabel: "Оставить", danger: true })) return;
    if (await run(labelled("Не убрано", () => write.del(`/map-packs/items/${item.id}`).then(() => true)), { affects: AFFECTS })) onClose();
  }
  return <Modal onClose={onClose} wide className="maps-win maps-win--wide" ariaLabel={item ? `Жидкость «${item.name}»` : "Новая жидкость"}>
    <h2>{item ? "Жидкость набора" : "Новая жидкость"}</h2>
    <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="stack" style={{ flex: "1 1 260px", minWidth: 240 }}>
        <label>Название<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label>Раздел<input value={section} maxLength={40} list="liquid-sections" onChange={(event) => setSection(event.target.value)} /></label>
        <datalist id="liquid-sections">{sections.map((entry) => <option key={entry} value={entry} />)}</datalist>
        <label>Метки<input value={tags} maxLength={200} onChange={(event) => setTags(event.target.value)} /></label>
        <div className="workspace-liquid-editor liquid-recipe-inline"><LiquidRecipeFields recipe={recipe} edit={(patch) => setRecipe((current) => ({ ...current, ...patch }))} onSettle={() => {}} /></div>
      </div>
      <div className="stack" style={{ flex: "1 1 360px", minWidth: 300 }}>
        <LiquidPond recipe={recipe} />
        {item && <small className="muted">Карты, где стоит эта жидкость, перекрасятся, когда их откроют в редакторе.</small>}
      </div>
    </div>
    <div className="modal-footer row">
      {item && <button type="button" onClick={() => void remove()}>Убрать из набора</button>}
      <button type="button" onClick={onClose}>Отмена</button>
      <button className="primary" disabled={!name.trim()} onClick={() => void save()}>{item ? "Сохранить" : "Добавить"}</button>
    </div>
    {dialog}
  </Modal>;
}

function itemNote(item: OwnPackItem) {
  return item.kind === "liquid" ? "жидкость" : item.kind === "surface" ? `поверхность · повтор ${item.cells ?? 4} кл.` : item.kind === "scatter" ? "россыпь" : item.kind === "door" ? `проём · ${item.span ?? 1} кл.${item.secret ? " · потайной" : ""}`
    : item.kind === "crossing" ? `${STRIP_KINDS.find(([value]) => value === `crossing:${item.deck}`)?.[1].toLocaleLowerCase("ru") ?? "переправа"}`
    : item.kind === "line" ? `${{ road: "дорога", river: "река", wall: "ограда" }[item.use ?? "road"] ?? "линия"} · ${item.width ?? 1} кл.` : `${item.w}×${item.h} кл.`;
}

type ItemTab = "object" | "surface" | "line" | "scatter" | "door" | "liquid";
// Язычки открытого набора — по видам вещей (гриллинг «Д» 2026-11-06, Q15; доска Map-Pack).
const ITEM_TABS: readonly { id: ItemTab; label: string; kinds: readonly string[] }[] = [
  { id: "object", label: "Объекты", kinds: ["object"] },
  { id: "surface", label: "Поверхности", kinds: ["surface"] },
  { id: "line", label: "Линии", kinds: ["line", "crossing"] },
  { id: "scatter", label: "Россыпи", kinds: ["scatter"] },
  { id: "door", label: "Проёмы", kinds: ["door"] },
  { id: "liquid", label: "Жидкости", kinds: ["liquid"] },
];
type NewItem = "new" | "new-surface" | "new-line" | "new-scatter" | "new-door" | "new-liquid";
// «+ Добавить ▾» вместо восьми кнопок (Q15): вид вещи и одна строка, что это.
const ADD_ITEMS: readonly { value: NewItem; tab: ItemTab; label: string; hint: string }[] = [
  { value: "new", tab: "object", label: "Объект", hint: "картинка и сколько клеток она занимает" },
  { value: "new-surface", tab: "surface", label: "Поверхность", hint: "образец, которым красят землю и пол" },
  { value: "new-line", tab: "line", label: "Линия", hint: "дорога, река, ограда или переправа" },
  { value: "new-scatter", tab: "scatter", label: "Россыпь", hint: "кусты, камни, трава — ставятся вразнобой" },
  { value: "new-door", tab: "door", label: "Проём", hint: "дверь, арка, ворота" },
  { value: "new-liquid", tab: "liquid", label: "Жидкость", hint: "рецепт воды, лавы, болота для слота" },
];
const KIND_PLATE: Record<MapKind, string> = { tactical: "тактическая", city: "город", overview: "обзорная" };
const plural = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10, mod100 = n % 100;
  return mod10 === 1 && mod100 !== 11 ? one : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14) ? few : many;
};
const things = (n: number) => `${n} ${plural(n, "вещь", "вещи", "вещей")}`;
const liveItems = (pack: OwnPack) => pack.items.filter((item) => !item.archived);
const firstImage = (item: OwnPackItem) => { const images = liveImages(item); return images[0] ? ownImageSrc(ownImageId(images[0])) : null; };

/** Обложка набора — четыре первые вещи с картинкой (доска Map-Packs). */
function PackCover({ urls }: { urls: (string | null)[] }) {
  const shown = urls.filter((url): url is string => !!url).slice(0, 4);
  if (!shown.length) return <NavIcon name="map" />;
  return <span className="maps-pack-cover">{shown.map((url, i) => <img key={i} src={url} alt="" loading="lazy" />)}</span>;
}

interface PackEntry { key: string; to: string; name: string; own: OwnPack | null; kinds: readonly MapKind[]; note: string; meta: string; urls: (string | null)[] }
type OpenMenu = (entry: PackEntry, x: number, y: number) => void;

/** «⋯» набора. Общее меню сущности сюда не годится: у встроенного набора нет id,
 *  а «В мешок» и упоминание набору ни к чему — меню своё, тем же видом. */
function PackDots({ entry, onMenu }: { entry: PackEntry; onMenu: OpenMenu }) {
  return <button type="button" className="entity-dots" aria-label={`Действия: ${entry.name}`} aria-haspopup="menu"
    onClick={(event) => { event.stopPropagation(); const r = event.currentTarget.getBoundingClientRect(); onMenu(entry, r.left, r.bottom + 2); }}>⋯</button>;
}

function PackTile({ entry, onMenu }: { entry: PackEntry; onMenu: OpenMenu }) {
  return <article className="reg-tile maps-pack-tile" onContextMenu={(event) => { event.preventDefault(); onMenu(entry, event.clientX, event.clientY); }}>
    <span className="reg-tile__cover is-empty maps-pack-tile__cover" aria-hidden="true">
      <PackCover urls={entry.urls} />
      <span className="d-plate">{entry.own ? "свой" : "встроенный"}</span>
    </span>
    <div className="reg-tile__body">
      <h3 className="reg-tile__name"><Link to={entry.to}>{entry.name}</Link></h3>
      <div className="reg-tile__chips">{entry.kinds.map((kind) => <span key={kind} className="maps-gch">{KIND_PLATE[kind]}</span>)}</div>
      <span className="reg-tile__text">{entry.note}</span>
      <RegMeta>{entry.meta}</RegMeta>
    </div>
    <PackDots entry={entry} onMenu={onMenu} />
  </article>;
}

// «Список» наборов: Название · Вид карты · Жанр · Вещей; на телефоне — вид.
const PACK_COLUMNS: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1.6fr)" },
  { label: "Вид карты", width: "minmax(120px, 1fr)", phone: true },
  { label: "Жанр", width: "minmax(120px, 1fr)" },
  { label: "Вещей", width: "130px" },
];

function PackRow({ entry, onMenu }: { entry: PackEntry; onMenu: OpenMenu }) {
  const cells = [entry.kinds.map((kind) => KIND_PLATE[kind]).join(", "), entry.note, entry.meta];
  return <div className="reg-row maps-pack-row" role="row" onContextMenu={(event) => { event.preventDefault(); onMenu(entry, event.clientX, event.clientY); }}>
    <span role="cell" className="reg-row__name"><Link to={entry.to}>{entry.name}</Link></span>
    {cells.map((cell, i) => <span key={PACK_COLUMNS[i + 1].label} role="cell" className={PACK_COLUMNS[i + 1].phone ? "reg-row__cell" : "reg-row__cell reg-wide"}><span className="d-mono">{cell}</span></span>)}
    <span role="cell"><PackDots entry={entry} onMenu={onMenu} /></span>
  </div>;
}

/** Жанры набора для фильтра: верхний жанр; без жанров — «любой». */
const ANY_GENRE = "любой";
const genresOf = (genres: readonly { genre: string }[]) => genres.length ? genres.map((entry) => entry.genre.toLocaleLowerCase("ru")) : [ANY_GENRE];

/** Меню на <details>: «⋯» и «+ Добавить ▾» шапки набора. Пункт закрывает меню. */
function HeadMenu({ label, title, primary, children }: { label: string; title: string; primary?: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  return <details className="maps-head-menu" ref={ref} onClick={(event) => { if ((event.target as HTMLElement).closest("[data-close]")) ref.current?.removeAttribute("open"); }}>
    <summary className={primary ? "d-btn d-btn--primary" : "d-btn"} title={title} aria-label={title}>{label}</summary>
    <div className="maps-head-menu__popup" role="menu">{children}</div>
  </details>;
}

export function MapPacksPage() {
  const { user } = useCurrentUser();
  const run = useAction();
  const navigate = useNavigate();
  const { packId, builtinId } = useParams();
  const [dialog, confirm] = useConfirm();
  const state = useResource<OwnPack[]>("/map-packs");
  const packs = state.data ?? NO_PACKS;
  useMemo(() => registerOwnPacks(packs), [packs]);
  useMapImageRevision();
  const [packDialog, setPackDialog] = useState<OwnPack | "new" | null>(null), [objectDialog, setObjectDialog] = useState<OwnPackItem | NewItem | null>(null), [sheetDialog, setSheetDialog] = useState(false);
  // Загрузка набора из файла: при совпадении с уже имеющимся сервер ждёт выбора — заменить или копией.
  const [clash, setClash] = useState<{ file: File; name: string; archived: boolean } | null>(null), [importing, setImporting] = useState(false);
  const [segment, setSegment] = useState<string | null>(null), [q, setQ] = useState(""), [kindFilter, setKindFilter] = useState<MapKind | null>(null);
  const [archive, setArchive] = useState(false), [tab, setTab] = useState<ItemTab>("object");
  const [genreFilter, setGenreFilter] = useState<string | null>(null), [view, setView] = useListView("map-packs");
  const [menu, setMenu] = useState<{ entry: PackEntry; x: number; y: number } | null>(null);
  const live = packs.filter((entry) => !entry.archived), archived = packs.filter((entry) => entry.archived);
  const pack = packId ? packs.find((entry) => entry.id === Number(packId)) ?? null : null;
  const builtin = builtinId ? MAP_PACKS.find((entry) => entry.id === builtinId) ?? null : null;
  // Диалог держит объект по id: после добавления варианта список перечитан, и окно показывает свежие картинки.
  const editing = objectDialog && typeof objectDialog === "object" ? pack?.items.find((entry) => entry.id === objectDialog.id) ?? null : null;
  const items = pack ? liveItems(pack) : [];
  const tabItems = items.filter((item) => ITEM_TABS.find((entry) => entry.id === tab)!.kinds.includes(item.kind));
  const sections = [...new Set(tabItems.map((item) => item.section))].sort((a, b) => a.localeCompare(b, "ru"));

  if (user?.role === "player") return <div className="stack"><p>Наборы ассетов правит Мастер.</p></div>;
  async function setArchived(target: OwnPack, value: boolean) {
    if (value && !await confirm({ title: `Убрать набор «${target.name}» в архив?`, message: "На картах, где он использован, вместо его вещей будут заглушки — до восстановления набора.", confirmLabel: "В архив", cancelLabel: "Оставить", danger: true })) return;
    const done = await run(labelled(value ? "Набор не убран в архив" : "Набор не восстановлен", () => write.put(`/map-packs/${target.id}/archive`, { archived: value })), { affects: AFFECTS });
    if (done && value) navigate("/maps/packs");
  }
  async function importPack(file: File, mode?: "replace" | "copy") {
    setClash(null); setImporting(true);
    const form = new FormData();
    form.append("file", file);
    if (mode) form.append("mode", mode);
    const saved = await run(labelled("Набор не загружен", async () => {
      try { return await write.post<OwnPack>("/map-packs/import", form, { timeoutMs: 300000 }); } catch (failure) {
        const payload = (failure as { payload?: { code?: string; name?: string; archived?: boolean } }).payload;
        if (payload?.code !== "pack-exists") throw failure;
        setClash({ file, name: payload.name ?? "", archived: !!payload.archived });
        return null;
      }
    }), { affects: AFFECTS });
    setImporting(false);
    if (saved) navigate(`/maps/packs/${saved.id}`);
  }
  function openNew(value: NewItem) {
    setTab(ADD_ITEMS.find((entry) => entry.value === value)!.tab);
    setObjectDialog(value);
  }

  const windows = <>
    {packDialog && <PackDialog pack={packDialog === "new" ? null : packDialog} onClose={(saved) => { setPackDialog(null); if (saved) navigate(`/maps/packs/${saved.id}`); }} />}
    {clash && <Modal onClose={() => setClash(null)} className="maps-win" ariaLabel="Набор уже есть">
      <h2>Набор «{clash.name}» уже есть{clash.archived ? " в архиве" : ""}</h2>
      <div className="stack">
        <p><strong>Заменить</strong> — вещи из файла обновятся, карты продолжат их показывать; вещи, которых в файле нет, уйдут в архив{clash.archived ? ", а сам набор вернётся из архива" : ""}.</p>
        <p><strong>Добавить копией</strong> — рядом появится отдельный набор, прежний не изменится. Карты, сделанные с файлом, будут смотреть на прежний.</p>
        <div className="modal-footer row"><button onClick={() => setClash(null)}>Отмена</button>
          <button onClick={() => void importPack(clash.file, "copy")}>Добавить копией</button>
          <button className="primary" onClick={() => void importPack(clash.file, "replace")}>Заменить</button></div>
      </div>
    </Modal>}
    {sheetDialog && pack && <MapSheetDialog pack={pack} reference={REFERENCE[pack.kinds[0] ?? "tactical"]} onClose={() => setSheetDialog(false)}
      sizeGrid={(src, w, h, reference) => <SizeGrid src={src} w={w} h={h} reference={reference} />} />}
    {objectDialog && pack && (objectDialog === "new-liquid" || editing?.kind === "liquid"
      ? <LiquidDialog key={editing?.id ?? "new-liquid"} pack={pack} item={editing} onClose={() => setObjectDialog(null)} />
      : objectDialog === "new-surface" || editing?.kind === "surface"
      ? <SurfaceDialog key={editing?.id ?? "new-surface"} pack={pack} item={editing} onClose={() => setObjectDialog(null)} />
      : typeof objectDialog === "string" && objectDialog !== "new" || editing && editing.kind !== "object"
      ? <ThingDialog key={editing?.id ?? objectDialog as string} pack={pack} item={editing} onClose={() => setObjectDialog(null)}
        mode={objectDialog === "new-door" || editing?.kind === "door" ? "door" : objectDialog === "new-scatter" || editing?.kind === "scatter" ? "scatter" : "line"} />
      : (objectDialog === "new" || editing) && <ObjectDialog key={editing?.id ?? "new"} pack={pack} item={editing} onClose={() => setObjectDialog(null)} />)}
    {dialog}
  </>;

  // ── Открытый набор: своя страница (Q15) ──
  if (packId || builtinId) {
    if (!pack && !builtin) return <div className="stack maps-pack-page"><SectionBackground />
      {state.loading ? <ListSkeleton variant="tiles" label="Загрузка набора" /> : <EmptyState title="Набора нет" hint="Он удалён или ссылка неверна." action={<Link className="d-btn" to="/maps/packs">Все наборы</Link>} />}</div>;
    if (builtin) {
      const parts = builtinSections(builtin.id);
      return <div className="stack maps-pack-page"><SectionBackground />
        <div className="row page-head maps-pack-page__head">
          <div><h1 className="maps-pack-page__title">{builtin.name}</h1><p className="maps-pack-page__sub">Встроенный набор · только посмотреть · {builtin.kinds.map((kind) => KIND_PLATE[kind]).join(", ")} · {builtin.genre.toLocaleLowerCase("ru")}</p></div>
        </div>
        <section className="d-sheet maps-pack-page__sheet">
          {parts.map((section) => <section key={section.name} className="maps-pack-section" aria-label={section.name}>
            <div className="d-gh"><h2 className="d-plate">{section.name}</h2><span className="d-note">{section.tiles.length}</span></div>
            <div className="maps-items">{section.tiles.map((tile) => <div key={tile.name} className="maps-item">
              <span className="maps-item__art">{tile.url && <img src={tile.url} alt="" loading="lazy" />}</span>
              <span className="maps-item__name"><b>{tile.name}</b>{tile.note && <small>{tile.note}</small>}</span>
            </div>)}</div>
          </section>)}
        </section>
      </div>;
    }
    const own = pack!;
    const counts = Object.fromEntries(ITEM_TABS.map((entry) => [entry.id, items.filter((item) => entry.kinds.includes(item.kind)).length]));
    const usedOn = own.kinds.map((kind) => KIND_PLATE[kind]).join(", ");
    return <div className="stack maps-pack-page"><SectionBackground />
      <div className="row page-head maps-pack-page__head">
        <div><h1 className="maps-pack-page__title">{own.name}</h1>
          <p className="maps-pack-page__sub">{own.archived ? "В архиве" : "Свой набор"} · {usedOn || "вид карты не задан"} · {genreLabel(own.genres)?.toLocaleLowerCase("ru") || "без жанра"} · {things(items.length)}</p></div>
        <div className="row page-head__actions">
          <button type="button" className="d-btn" title="Набор одним файлом — передать другому Мастеру" onClick={() => void run(labelled("Набор не выгружен", () => exportPack(own)), { affects: [] })}>Выгрузить</button>
          <HeadMenu label="⋯" title="Действия набора">
            <button type="button" data-close onClick={() => setPackDialog(own)}>Название, жанры и виды карт</button>
            {own.archived
              ? <button type="button" data-close onClick={() => void setArchived(own, false)}>Вернуть из архива</button>
              : <button type="button" data-close className="is-danger" onClick={() => void setArchived(own, true)}>В архив</button>}
          </HeadMenu>
          {!own.archived && <HeadMenu label="+ Добавить ▾" title="Добавить в набор" primary>
            {ADD_ITEMS.map((entry) => <button key={entry.value} type="button" data-close onClick={() => openNew(entry.value)}><b>{entry.label}</b><small>{entry.hint}</small></button>)}
            <hr />
            <button type="button" data-close onClick={() => setSheetDialog(true)}><b>Лист — разрезать на вещи…</b><small>картинка с несколькими вещами разом</small></button>
          </HeadMenu>}
        </div>
      </div>
      <div className="tabs d-tabs maps-pack-page__tabs" role="tablist" aria-label="Вещи набора">
        {ITEM_TABS.map((entry) => <button key={entry.id} type="button" role="tab" aria-selected={tab === entry.id} className={tab === entry.id ? "active" : undefined} onClick={() => setTab(entry.id)}>{entry.label}<b>{counts[entry.id]}</b></button>)}
        <button type="button" role="tab" aria-disabled="true" className="is-soon" title="Придёт с этапом «Обставить»: что ставить в комнаты каждого назначения">Обстановка<b>этап 4</b></button>
      </div>
      <section className="d-sheet maps-pack-page__sheet" role="tabpanel">
        {!tabItems.length && <p className="maps-pack-page__empty">{items.length
          ? `${ITEM_TABS.find((entry) => entry.id === tab)!.label}: пока нет. «+ Добавить ▾» — добавить первую.`
          : "В наборе пока пусто. «+ Добавить ▾» — объект, поверхность, линия, россыпь, проём или жидкость; «Лист» — картинка с несколькими вещами."}</p>}
        {sections.map((section) => <section key={section} className="maps-pack-section" aria-label={section || "Без раздела"}>
          <div className="d-gh"><h2 className="d-plate">{section || "Без раздела"}</h2><span className="d-note">{tabItems.filter((item) => item.section === section).length}</span></div>
          <div className="maps-items">
            {tabItems.filter((item) => item.section === section).map((item) => { const images = liveImages(item), url = firstImage(item);
              return <button key={item.id} type="button" className="maps-item" onClick={() => setObjectDialog(item)}>
                {images.length > 1 && <span className="maps-item__variants">×{images.length}</span>}
                <span className={`maps-item__art${item.kind === "surface" ? " is-surface" : ""}`} style={item.kind === "surface" && item.fill ? { background: item.fill } : undefined}>
                  {item.kind === "liquid" && <span className="liquid-swatch"><Swatch recipe={packLiquidRecipe(item, "")} /></span>}{url && <img src={url} alt="" />}
                </span>
                <span className="maps-item__name"><b>{item.name}</b><small>{itemNote(item)}</small></span>
              </button>; })}
          </div>
        </section>)}
      </section>
      {windows}
    </div>;
  }

  // ── Список наборов: «Реестр» (Q15; доска Map-Packs) ──
  const qq = q.trim().toLowerCase();
  const fits = (name: string, genre: string, kinds: readonly MapKind[], genres: readonly { genre: string }[]) => (!qq || `${name} ${genre}`.toLowerCase().includes(qq))
    && (!kindFilter || kinds.includes(kindFilter)) && (!genreFilter || genresOf(genres).includes(genreFilter));
  const ownShown = segment === "builtin" ? [] : live.filter((entry) => fits(entry.name, genreLabel(entry.genres) ?? "", entry.kinds, entry.genres));
  const builtinShown = segment === "own" ? [] : MAP_PACKS.filter((entry) => fits(entry.name, `${entry.genre} ${entry.place}`, entry.kinds, entry.genres));
  const shown = ownShown.length + builtinShown.length, total = live.length + MAP_PACKS.length;
  const genreOptions = [...new Set([...live, ...MAP_PACKS].flatMap((entry) => genresOf(entry.genres)))]
    .sort((a, b) => a === ANY_GENRE ? 1 : b === ANY_GENRE ? -1 : a.localeCompare(b, "ru"));
  const entries: PackEntry[] = [
    ...ownShown.map((entry) => ({ key: `own:${entry.id}`, to: `/maps/packs/${entry.id}`, name: entry.name, own: entry, kinds: entry.kinds,
      note: genreLabel(entry.genres) || "Свой, без жанра", meta: things(liveItems(entry).length), urls: liveItems(entry).slice(0, 8).map(firstImage) })),
    ...builtinShown.map((entry) => ({ key: entry.id, to: `/maps/packs/builtin/${entry.id}`, name: entry.name, own: null, kinds: entry.kinds,
      note: `${entry.genre} · ${entry.place.toLocaleLowerCase("ru")}`, meta: "только посмотреть", urls: builtinSections(entry.id).flatMap((section) => section.tiles.map((tile) => tile.url)).slice(0, 8) })),
  ];
  const openMenu: OpenMenu = (entry, x, y) => setMenu({ entry, x, y });
  const menuItems = (entry: PackEntry): ContextMenuItem[] => entry.own ? [
    { label: "Открыть", onClick: () => navigate(entry.to) },
    { label: "Выгрузить", onClick: () => void run(labelled("Набор не выгружен", () => exportPack(entry.own!)), { affects: [] }) },
    { label: "Название, жанры и виды карт", onClick: () => setPackDialog(entry.own) },
    { label: "В архив", danger: true, dividerBefore: true, onClick: () => void setArchived(entry.own!, true) },
  ] : [{ label: "Открыть", onClick: () => navigate(entry.to) }];
  const resetFilters = () => { setQ(""); setKindFilter(null); setGenreFilter(null); };
  const chip = (kind: MapKind) => <button key={kind} type="button" className={`maps-gch${kindFilter === kind ? " is-on" : ""}`} aria-pressed={kindFilter === kind} onClick={() => setKindFilter(kindFilter === kind ? null : kind)}>{KIND_PLATE[kind]}</button>;
  const genreChip = (genre: string) => <button key={genre} type="button" className={`maps-gch${genreFilter === genre ? " is-on" : ""}`} aria-pressed={genreFilter === genre} onClick={() => setGenreFilter(genreFilter === genre ? null : genre)}>{genre}</button>;
  return <div className="stack" style={{ position: "relative" }}>
    <SectionBackground />
    <ListPage ds headingSection="map" title="Наборы ассетов" groups={[]} ungroupedLabel={null}
      extraTabs={[{ id: "own", label: "Свои", count: live.length }, { id: "builtin", label: "Встроенные", count: MAP_PACKS.length }]}
      activeGroup={segment} onGroupChange={setSegment}
      actions={<label className="d-btn" title="Набор из файла, выгруженного в SoyMan" aria-disabled={importing}>{importing ? "Загружаю…" : "Загрузить набор…"}
        <input type="file" accept=".zip,application/zip" hidden disabled={importing} onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void importPack(file); }} /></label>}
      createLabel="+ Набор" onCreate={() => setPackDialog("new")}
      search={q} onSearch={setQ} searchPlaceholder="Поиск по названию, жанру…" searchLabel="Поиск по наборам"
      filteredCount={shown} totalCount={total} onResetSearch={resetFilters} showReset={!!qq || !!kindFilter || !!genreFilter}
      view={view} onViewChange={setView}
      filters={<div className="maps-filters" role="group" aria-label="Фильтры наборов"><span className="d-mono">вид карты</span>{KINDS.map(chip)}
        <span className="d-mono">жанр</span>{genreOptions.map(genreChip)}</div>}>
      {state.error && <LoadErrorCard message={<>Не удалось загрузить наборы: {state.error}</>} onRetry={state.reload} />}
      {state.loading ? <ListSkeleton variant="tiles" label="Загрузка наборов" /> : shown > 0 && (view === "tiles"
        ? <RegTiles>{entries.map((entry) => <PackTile key={entry.key} entry={entry} onMenu={openMenu} />)}</RegTiles>
        : <RegTable columns={PACK_COLUMNS} label="Наборы ассетов">{entries.map((entry) => <PackRow key={entry.key} entry={entry} onMenu={openMenu} />)}</RegTable>)}
      {!state.loading && shown === 0 && <EmptyState kind="search" title="Ничего не найдено" hint={qq ? `По «${q.trim()}» ничего нет.` : "Под фильтр ничего не попало."}
        action={<button className="d-btn" onClick={() => { resetFilters(); setSegment(null); }}>Показать все</button>} />}
      {archived.length > 0 && <section className="reg-arch" aria-label="Архив наборов">
        <button type="button" className="reg-arch__head" aria-expanded={archive} onClick={() => setArchive(!archive)}><b>Архив</b><span className="d-note">{archived.length}</span><span className="d-mono">{archive ? "Скрыть ‹" : "Показать ›"}</span></button>
        {archive && <ul className="reg-arch__rows">{archived.map((entry) => <li key={entry.id}><span>{entry.name}</span>
          <button type="button" className="d-btn d-btn--sm" onClick={() => void setArchived(entry, false)}>Вернуть</button></li>)}</ul>}
      </section>}
    </ListPage>
    {menu && <ContextMenu x={menu.x} y={menu.y} title={menu.entry.name} ariaLabel={`Действия: ${menu.entry.name}`} items={menuItems(menu.entry)} onClose={() => setMenu(null)} />}
    {windows}
  </div>;
}
