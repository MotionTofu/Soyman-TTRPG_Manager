import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { useCurrentUser } from "../api/currentUser";
import { Modal } from "../components/Modal";
import { SectionBackground } from "../components/SectionBackground";
import { useConfirm } from "../hooks/useConfirm";
import { MAP_KIND_LABELS, type MapKind } from "../maps/mapTypes";
import { MAP_PACKS } from "../maps/assets/packs";
import { OWN_SIDES, PACK_CELL_PX, liveImages, ownImageId, ownImageSrc, registerOwnPacks, sideImage, useMapImageRevision, type OwnPack, type OwnPackItem } from "../maps/assets/ownPacks";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyUrl } from "../maps/assets/cartography";
import { CRYPT_CATEGORIES, CRYPT_OBJECTS, cryptUrl, type CryptCategory } from "../maps/assets/crypt";
import { VILLAGE_CATEGORIES, VILLAGE_OBJECTS, VILLAGE_RIVERS, VILLAGE_ROADS, VILLAGE_SURFACES, villageUrl, type VillageCategory } from "../maps/assets/village";
import { MAP_SYMBOL_ASSETS } from "../maps/assets/registry";
import { seamlessTile } from "../maps/assets/seamless";

const KINDS: MapKind[] = ["tactical", "city", "overview"];
const AFFECTS = [{ path: "/map-packs" }];
const NO_PACKS: OwnPack[] = [];
/** Что стоит рядом с объектом для сравнения: вещь ровно в одну клетку на этом виде карты. */
const REFERENCE: Record<MapKind, string> = { tactical: "человек", city: "дом", overview: "клетка" };
const cellsOf = (value: number) => Math.max(0.5, Math.min(16, Math.round(value * 2) / 2));

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
  async function save() {
    const body = { name, kinds };
    const saved = await run(labelled("Набор не сохранён", () => pack ? write.put<OwnPack>(`/map-packs/${pack.id}`, body) : write.post<OwnPack>("/map-packs", body)), { affects: AFFECTS });
    if (saved) onClose(saved);
  }
  return <Modal onClose={() => onClose()} ariaLabel={pack ? "Набор ассетов" : "Новый набор ассетов"}>
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

  return <Modal onClose={onClose} wide ariaLabel={item ? `Объект «${item.name}»` : "Новый объект"}>
    <h2>{item ? "Объект набора" : "Новый объект"}</h2>
    <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <div className="stack" style={{ flex: "1 1 300px", minWidth: 260 }}>
        <SizeGrid src={shown} w={w} h={h} reference={REFERENCE[pack.kinds[0] ?? "tactical"]} />
        <div className="row" style={{ gap: 8 }}>
          <label>Ширина, клеток<input type="number" min={0.5} max={16} step={0.5} value={w} onChange={(event) => width(Number(event.target.value))} /></label>
          <label>Высота, клеток<input type="number" min={0.5} max={16} step={0.5} value={h} onChange={(event) => height(Number(event.target.value))} /></label>
        </div>
        <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={locked} onChange={(event) => setLocked(event.target.checked)} />Держать пропорции картинки</label>
        {small && <p className="muted" role="status">Картинка мельче стандарта ({PACK_CELL_PX} точек на клетку): на крупном приближении будет мягкой.</p>}
      </div>
      <div className="stack" style={{ flex: "1 1 280px", minWidth: 240 }}>
        {!item && <label>Картинка<input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(event) => choose(event.target.files?.[0] ?? null)} /></label>}
        <label>Название<input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} /></label>
        <label>Раздел<input value={section} maxLength={40} list="map-pack-sections" placeholder="Например, Мебель" onChange={(event) => setSection(event.target.value)} /></label>
        <datalist id="map-pack-sections">{sections.map((entry) => <option key={entry} value={entry} />)}</datalist>
        <label>Теги через запятую<input value={tags} maxLength={200} onChange={(event) => setTags(event.target.value)} /></label>
        {item && <>
          <label className="row" style={{ gap: 6 }}><input type="checkbox" checked={blocks} onChange={(event) => setBlocks(event.target.checked)} />Преграждает обзор</label>
          <label>Источник света, радиус в клетках<input type="number" min={0} max={60} step={0.5} value={light} placeholder="не светит" onChange={(event) => setLight(event.target.value)} /></label>
          <small className="muted">Обзор и свет начнут работать вместе со светом и туманом.</small>
          <div className="stack">
            <strong>Варианты</strong>
            <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
              {variants.map((image, index) => { const url = ownImageSrc(ownImageId(image)); return <span key={image.id} style={{ position: "relative", width: 64, height: 64, border: "2px solid currentColor" }}>
                {url && <img src={url} alt={`Вариант ${index + 1}`} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                <button type="button" disabled={variants.length < 2} title="Убрать вариант" aria-label={`Убрать вариант ${index + 1}`} style={{ position: "absolute", top: 0, right: 0, padding: "0 5px", height: 20 }}
                  onClick={() => removeImage(image.id, "Вариант не убран")}>×</button>
              </span>; })}
            </div>
            <label>Добавить вариант<input type="file" accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(event) => { void addVariant(event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
            <small className="muted">Каталог ставит случайный вариант; конкретный можно выбрать в полосе вариантов.</small>
          </div>
          <div className="stack">
            <strong>Виды по сторонам</strong>
            <small className="muted">Для предметов, нарисованных «с лица»: трон, шкаф, стул. Основная картинка — предмет без поворота. Добавьте, каким он виден после поворота, — и вместо кручения картинки карта возьмёт нужный вид. Без вида картинка просто поворачивается.</small>
            <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "flex-start" }}>
              {OWN_SIDES.map(([side, label]) => { const image = sideImage(item, side), url = image ? ownImageSrc(ownImageId(image)) : null; return <div key={side} className="stack" style={{ width: 96, gap: 4 }}>
                <span style={{ position: "relative", width: 64, height: 64, border: "2px dashed currentColor", display: "block" }}>
                  {url && <img src={url} alt={label} style={{ width: "100%", height: "100%", objectFit: "contain" }} />}
                  {image && <button type="button" title="Убрать вид" aria-label={`Убрать вид «${label}»`} style={{ position: "absolute", top: 0, right: 0, padding: "0 5px", height: 20 }} onClick={() => removeImage(image.id, "Вид не убран")}>×</button>}
                </span>
                <label style={{ fontSize: "var(--fs-meta)" }}>{label}<input type="file" aria-label={`Вид: ${label.toLocaleLowerCase("ru")}`} accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(event) => { void addSide(side, event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>
              </div>; })}
            </div>
          </div>
        </>}
        {note && <p className="muted" role="status">{note}</p>}
      </div>
    </div>
    <div className="modal-footer row">
      {item && <button onClick={remove}>Убрать из набора</button>}
      <button onClick={onClose}>{item ? "Закрыть" : "Отмена"}</button>
      <button className="primary" disabled={!name.trim() || (!item && !file)} onClick={save}>{item ? "Сохранить" : "Добавить"}</button>
    </div>
    {dialog}
  </Modal>;
}

/** Поверхность набора: бесшовный образец. Картинка обрезается до квадрата, края склеиваются подмесом —
 * предпросмотр 3×3 показывает ровно то, что уйдёт в набор. */
function SurfaceDialog({ pack, item, onClose }: { pack: OwnPack; item: OwnPackItem | null; onClose: () => void }) {
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  useMapImageRevision();
  const [source, setSource] = useState<HTMLImageElement | null>(null), [blend, setBlend] = useState(15);
  const [name, setName] = useState(item?.name ?? ""), [section, setSection] = useState(item?.section ?? ""), [tags, setTags] = useState(item?.tags ?? "");
  const [cells, setCells] = useState(item?.cells ?? 4);
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
      ? await run(labelled("Поверхность не сохранена", () => write.put(`/map-packs/items/${item.id}`, { name, section, tags, cells })), { affects: AFFECTS })
      : tile && await run(labelled("Поверхность не добавлена", async () => write.post(`/map-packs/${pack.id}/items`, await form({ kind: "surface", name, section, tags, cells: String(cells) }))), { affects: AFFECTS });
    if (saved) onClose();
  }
  async function addVariant() {
    if (!item || !tile) return;
    if (await run(labelled("Вариант не добавлен", async () => write.post(`/map-packs/items/${item.id}/images`, await form({}))), { affects: AFFECTS })) setSource(null);
  }
  async function remove() {
    if (!item || !await confirm({ title: `Убрать «${item.name}» из набора?`, message: "В каталоге поверхности не будет. На картах, где ею уже красили, она останется.", confirmLabel: "Убрать", cancelLabel: "Оставить", danger: true })) return;
    if (await run(labelled("Поверхность не убрана", () => write.del(`/map-packs/items/${item.id}`).then(() => true)), { affects: AFFECTS })) onClose();
  }
  const picker = <label>{item ? "Добавить вариант" : "Картинка"}<input type="file" aria-label={item ? "Картинка варианта" : "Картинка поверхности"} accept="image/png,image/jpeg,image/webp,image/avif,image/gif" onChange={(event) => { choose(event.target.files?.[0] ?? null); event.target.value = ""; }} /></label>;

  return <Modal onClose={onClose} wide ariaLabel={item ? `Поверхность «${item.name}»` : "Новая поверхность"}>
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
    </div>
    <div className="modal-footer row">
      {item && <button onClick={remove}>Убрать из набора</button>}
      <button onClick={onClose}>{item ? "Закрыть" : "Отмена"}</button>
      <button className="primary" disabled={!name.trim() || (!item && !tile)} onClick={() => void save()}>{item ? "Сохранить" : "Добавить"}</button>
    </div>
    {dialog}
  </Modal>;
}

export function MapPacksPage() {
  const { user } = useCurrentUser();
  const run = useAction();
  const [dialog, confirm] = useConfirm();
  const state = useResource<OwnPack[]>("/map-packs");
  const packs = state.data ?? NO_PACKS;
  useMemo(() => registerOwnPacks(packs), [packs]);
  useMapImageRevision();
  const [picked, setPicked] = useState<number | null>(null), [archive, setArchive] = useState(false), [builtin, setBuiltin] = useState<string | null>(null);
  const [packDialog, setPackDialog] = useState<OwnPack | "new" | null>(null), [objectDialog, setObjectDialog] = useState<OwnPackItem | "new" | "new-surface" | null>(null);
  const live = packs.filter((pack) => !pack.archived), archived = packs.filter((pack) => pack.archived);
  const pack = live.find((entry) => entry.id === picked) ?? live[0] ?? null;
  // Диалог держит объект по id: после добавления варианта список перечитан, и окно показывает свежие картинки.
  const editing = objectDialog && typeof objectDialog === "object" ? pack?.items.find((entry) => entry.id === objectDialog.id) ?? null : null;
  const items = pack?.items.filter((item) => !item.archived) ?? [];
  const sections = [...new Set(items.map((item) => item.section))].sort((a, b) => a.localeCompare(b, "ru"));

  if (user?.role === "player") return <div className="stack"><p>Наборы ассетов правит Мастер.</p></div>;
  async function setArchived(target: OwnPack, value: boolean) {
    if (value && !await confirm({ title: `Убрать набор «${target.name}» в архив?`, message: "На картах, где он использован, вместо его вещей будут заглушки — до восстановления набора.", confirmLabel: "В архив", cancelLabel: "Оставить", danger: true })) return;
    await run(labelled(value ? "Набор не убран в архив" : "Набор не восстановлен", () => write.put(`/map-packs/${target.id}/archive`, { archived: value })), { affects: AFFECTS });
  }

  return <div className="stack" style={{ position: "relative" }}>
    <SectionBackground />
    <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
      <h1 style={{ margin: 0 }}>Наборы ассетов</h1>
      <div className="row" style={{ gap: 8 }}><Link to="/maps">← К картам</Link><button className="primary" onClick={() => setPackDialog("new")}>+ Набор</button></div>
    </div>
    {state.error && <p role="alert">Не удалось загрузить наборы: {state.error}</p>}
    <div className="row" style={{ gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
      <nav className="stack" aria-label="Наборы" style={{ flex: "0 0 260px" }}>
        <strong>Свои</strong>
        {live.map((entry) => <button key={entry.id} type="button" aria-pressed={!builtin && entry.id === pack?.id} onClick={() => { setPicked(entry.id); setBuiltin(null); }} style={{ textAlign: "left", height: "auto", padding: "6px 10px" }}>
          <strong>{entry.name}</strong><br /><small>{entry.kinds.map((kind) => MAP_KIND_LABELS[kind]).join(", ")} · вещей: {entry.items.filter((item) => !item.archived).length}</small>
        </button>)}
        {!live.length && !state.loading && <p className="muted">Своих наборов пока нет. Создайте первый и добавьте в него картинки.</p>}
        <strong>Встроенные — только чтение</strong>
        {MAP_PACKS.map((entry) => <button key={entry.id} type="button" aria-pressed={builtin === entry.id} onClick={() => setBuiltin(entry.id)} style={{ textAlign: "left", height: "auto", padding: "6px 10px" }}>
          <strong>{entry.name}</strong><br /><small>{entry.genre} · {entry.place}</small></button>)}
        {archived.length > 0 && <button type="button" aria-expanded={archive} onClick={() => setArchive(!archive)}>Архив наборов: {archived.length}</button>}
        {archive && archived.map((entry) => <div key={entry.id} className="card row" style={{ padding: "6px 10px", justifyContent: "space-between" }}>
          <span>{entry.name}</span><button type="button" onClick={() => void setArchived(entry, false)}>Вернуть</button></div>)}
      </nav>
      {builtin && <section className="stack" style={{ flex: "1 1 520px", minWidth: 300 }} aria-label={`Встроенный набор «${MAP_PACKS.find((entry) => entry.id === builtin)?.name}»`}>
        <h2 style={{ margin: 0 }}>{MAP_PACKS.find((entry) => entry.id === builtin)?.name}</h2>
        <p className="muted">Встроенный набор: только посмотреть. Для карт: {MAP_PACKS.find((entry) => entry.id === builtin)?.kinds.map((kind) => MAP_KIND_LABELS[kind]).join(", ")}.</p>
        {builtinSections(builtin).map((section) => <div key={section.name} className="stack">
          <strong>{section.name}</strong>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {section.tiles.map((tile) => <div key={tile.name} className="card" style={{ width: 132, padding: 8, textAlign: "center" }}>
              <span style={{ display: "block", height: 96 }}>{tile.url && <img src={tile.url} alt="" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "contain" }} />}</span>
              <strong>{tile.name}</strong>{tile.note && <><br /><small>{tile.note}</small></>}
            </div>)}
          </div>
        </div>)}
      </section>}
      {pack && !builtin && <section className="stack" style={{ flex: "1 1 520px", minWidth: 300 }} aria-label={`Набор «${pack.name}»`}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <h2 style={{ margin: 0 }}>{pack.name}</h2>
          <div className="row" style={{ gap: 8 }}>
            <button onClick={() => setPackDialog(pack)}>Название и виды карт</button>
            <button onClick={() => void setArchived(pack, true)}>В архив</button>
            <button className="primary" onClick={() => setObjectDialog("new-surface")}>+ Поверхность</button>
            <button className="primary" onClick={() => setObjectDialog("new")}>+ Объект</button>
          </div>
        </div>
        {!items.length && <p className="muted">В наборе пока пусто. «+ Объект» — картинка и сколько клеток она занимает. «+ Поверхность» — образец, которым красят землю и полы.</p>}
        {sections.map((section) => <div key={section} className="stack">
          <strong>{section || "Без раздела"}</strong>
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            {items.filter((item) => item.section === section).map((item) => { const images = liveImages(item), url = images[0] ? ownImageSrc(ownImageId(images[0])) : null;
              return <button key={item.id} type="button" className="card" onClick={() => setObjectDialog(item)} style={{ width: 132, height: "auto", padding: 8, textAlign: "center" }}>
                <span style={{ display: "block", height: 96, background: item.kind === "surface" ? item.fill : undefined }}>{url && <img src={url} alt="" style={{ width: "100%", height: "100%", objectFit: item.kind === "surface" ? "cover" : "contain" }} />}</span>
                <strong>{item.name}</strong><br /><small>{item.kind === "surface" ? `поверхность · повтор ${item.cells ?? 4} кл.` : `${item.w}×${item.h} кл.`}{images.length > 1 ? ` · вариантов: ${images.length}` : ""}</small>
              </button>; })}
          </div>
        </div>)}
      </section>}
    </div>
    {packDialog && <PackDialog pack={packDialog === "new" ? null : packDialog} onClose={(saved) => { setPackDialog(null); if (saved) { setPicked(saved.id); setBuiltin(null); } }} />}
    {objectDialog && pack && (objectDialog === "new-surface" || editing?.kind === "surface"
      ? <SurfaceDialog key={editing?.id ?? "new-surface"} pack={pack} item={editing} onClose={() => setObjectDialog(null)} />
      : (objectDialog === "new" || editing) && <ObjectDialog key={editing?.id ?? "new"} pack={pack} item={editing} onClose={() => setObjectDialog(null)} />)}
    {dialog}
  </div>;
}
