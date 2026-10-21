import { memo, useState } from "react";
import type { MapLiquidRecipe } from "@shared/maps/core";
import { LIQUIDS, LIQUID_PATTERNS, LIQUID_RIMS, OWN_LIQUID_KEYS, WATER_DEPTHS, liquidKey, liquidRecipe, villageUrl, waterCode, waterLevel,
  type LiquidPattern, type LiquidRecipe, type LiquidRim } from "../assets/village";
import { liquidPackOf, packLiquidRecipe, type OwnPack, type OwnPackItem } from "../assets/ownPacks";
import { LIQUID_SLOTS, liquidShades } from "./liquids";
import "./workspace-editor.css";

const builtin = (key: string) => LIQUIDS.some(item => item.key === key);
export function Swatch({ recipe }: { recipe: Pick<LiquidRecipe, "key" | "fill" | "tones"> }) {
  return builtin(recipe.key) ? <img src={villageUrl(recipe.key === "water" ? "shallow" : recipe.key === "sea" ? "deep" : recipe.key)} alt="" style={{ background: recipe.fill }} />
    : <i aria-hidden="true" style={{ background: `linear-gradient(135deg, ${recipe.tones[2]} 0 18%, ${recipe.tones[1]} 18% 62%, ${recipe.tones[0]} 62%)` }} />;
}
function Range({ name, title, value, min, max, step, onChange, onSettle }: { name: string; title?: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; onSettle: () => void }) {
  return <label title={title}>{name}<input type="range" aria-label={name} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} onPointerUp={onSettle} onKeyUp={onSettle} onBlur={onSettle} /></label>;
}
type Recipe = Omit<MapLiquidRecipe, "key" | "name" | "ref">;
/** Ручки рецепта жидкости — и в слоте карты, и на экране набора. `live` — ползунок ещё тянут, шаг закроет `onSettle`. */
export function LiquidRecipeFields({ recipe, edit, onSettle }: { recipe: Omit<Recipe, "tones"> & { tones: readonly [string, string, string] }; edit: (patch: Partial<Recipe>, live?: boolean) => void; onSettle: () => void }) {
  return <>
    <fieldset><legend>Цвета</legend>{(["Глубина", "Середина", "Блик"] as const).map((name, i) => <label key={name}>{name}
      <input type="color" aria-label={`Цвет: ${name}`} value={recipe.tones[i]} onChange={event => edit({ tones: recipe.tones.map((tone, n) => n === i ? event.target.value : tone) as [string, string, string] }, true)} onBlur={onSettle} /></label>)}</fieldset>
    <button type="button" title="Подобрать «Глубину» и «Блик» по яркости «Середины»"
      onClick={() => { const [deep, light] = liquidShades(recipe.tones[1]); edit({ tones: [deep, recipe.tones[1], light] }); }}>Рассчитать глубины</button>
    <Range name="Подвижность" value={recipe.pace} min={0} max={2} step={0.05} onChange={pace => edit({ pace }, true)} onSettle={onSettle} />
    <Range name="Крупность рисунка" value={recipe.size} min={0.25} max={4} step={0.05} onChange={size => edit({ size }, true)} onSettle={onSettle} />
    <Range name="Дно видно" value={recipe.bed} min={0} max={1} step={0.05} onChange={bed => edit({ bed }, true)} onSettle={onSettle} />
    <Range name="Ширина берега" value={recipe.shore ?? 0.4} min={0} max={1} step={0.05} onChange={shore => edit({ shore }, true)} onSettle={onSettle} />
    <Range name="Рваность берега" value={recipe.ragged ?? 0.4} min={0} max={1} step={0.05} onChange={ragged => edit({ ragged }, true)} onSettle={onSettle} />
    <Range name="Напор" title="Кто теснит соседку на стыке двух жидкостей: сильная сдвигает середину перехода на её сторону" value={recipe.push ?? 0.5} min={0} max={1} step={0.05} onChange={push => edit({ push }, true)} onSettle={onSettle} />
    <Range name="Мягкость края" title="Ширина перехода к другой жидкости, до двух клеток; на стыке берётся бо́льшая из двух" value={recipe.blend ?? 0.25} min={0} max={1} step={0.05} onChange={blend => edit({ blend }, true)} onSettle={onSettle} />
    <Range name="Свечение" value={recipe.glow} min={0} max={1} step={0.05} onChange={glow => edit({ glow }, true)} onSettle={onSettle} />
    <label>Рисунок<select value={recipe.pattern} onChange={event => edit({ pattern: event.target.value as LiquidPattern })}>
      {Object.entries(LIQUID_PATTERNS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label>Кромка<select value={recipe.rim} onChange={event => edit({ rim: event.target.value as LiquidRim })}>
      {Object.entries(LIQUID_RIMS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
    <label className="workspace-liquid-check"><input type="checkbox" checked={recipe.solid} onChange={event => edit({ solid: event.target.checked })} />Твёрдая: по ней ходят, мост не нужен</label>
  </>;
}

/** Слоты жидкостей — полоска поверх карты, пока активен инструмент «Жидкость». Слот занят жидкостью, которая накрашена на
 * карте или только что взята; пустой предлагает готовый рецепт, жидкость подключённого набора или свою. Свой рецепт правится
 * тут же, и карта перекрашивается сразу: в слое лежит ключ рецепта, а не его цвета. Жидкость набора — ссылка (В12):
 * правится на экране набора, здесь из неё можно только завести свою.
 * `onOwn` — новая таблица своих рецептов; `live` — ползунок ещё тянут, шаг истории закроет `onSettle`.
 * `onSaveToPack` — своя жидкость уходит в набор, слот переключается на рецепт набора (В15). */
export const LiquidSlots = memo(function LiquidSlots({ used, own, material, live, onLive, onMaterial, onOwn, onSettle, onRelease, offered, packs, onSaveToPack }: {
  /** Включена ли «живая вода»: без неё жидкость — ровная заливка, и рецепт не на чем показать. */
  live: boolean; onLive: () => void;
  used: readonly string[]; own: readonly MapLiquidRecipe[]; material: string; onMaterial: (code: string) => void;
  onOwn: (next: MapLiquidRecipe[], live: boolean) => void; onSettle: () => void; onRelease: (key: string, to: string | null) => void;
  /** Жидкости подключённых наборов. */ offered: readonly { pack: OwnPack; items: OwnPackItem[] }[];
  /** Свои наборы, куда можно сохранить жидкость: подключённые к карте — первыми. */ packs: readonly OwnPack[];
  onSaveToPack: (key: string, pack: OwnPack, name: string) => Promise<boolean>;
}) {
  const [added, setAdded] = useState<string[]>([]), [panel, setPanel] = useState<"menu" | "edit" | "release" | "save" | null>(null);
  const [query, setQuery] = useState(""), [target, setTarget] = useState(""), [title, setTitle] = useState(""), [saving, setSaving] = useState(false);
  const current = liquidKey(material), depth = waterLevel(material) || 2, recipe = liquidRecipe(current, own);
  // Свой рецепт без накрашенного тоже держит слот: иначе его негде было бы выбрать.
  const slots = [...new Set([...used, ...added, ...own.map(item => item.key), current])].filter(key => builtin(key) || own.some(item => item.key === key)).slice(0, LIQUID_SLOTS);
  const room = slots.length < LIQUID_SLOTS, freeKey = OWN_LIQUID_KEYS.find(item => !own.some(entry => entry.key === item));
  const entry = own.find(item => item.key === current), linked = entry?.ref ? liquidPackOf(entry.ref) : null, mine = !builtin(current) && !!entry && !entry.ref;
  const found = (name: string) => name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
  const free = LIQUIDS.filter(item => !slots.includes(item.key) && found(item.name));
  const fromPacks = offered.map(group => ({ ...group, items: group.items.filter(item => !own.some(recipe => recipe.ref === item.uid) && found(item.name)) })).filter(group => group.items.length);
  const pick = (key: string) => { setPanel(null); setQuery(""); onMaterial(waterCode(depth, key)); };
  /** Своя жидкость на основе выбранной: её и открываем на правку. */
  const create = () => {
    if (!freeKey) return;
    const { fill: _fill, ref: _ref, ...base } = recipe as LiquidRecipe & { ref?: string };
    onOwn([...own, { ...base, key: freeKey, name: !builtin(current) || current !== "water" ? `${recipe.name}, своя`.slice(0, 40) : "Своя жидкость", tones: [...recipe.tones] as [string, string, string] }], false);
    onMaterial(waterCode(depth, freeKey)); setPanel("edit"); setQuery("");
  };
  const take = (item: OwnPackItem) => { if (!freeKey) return; onOwn([...own, packLiquidRecipe(item, freeKey)], false); pick(freeKey); };
  const edit = (patch: Partial<MapLiquidRecipe>, live = false) => onOwn(own.map(item => item.key === current ? { ...item, ...patch } : item), live);
  const release = (to: string | null) => {
    onRelease(current, to); setAdded(added.filter(key => key !== current)); setPanel(null);
    onMaterial(waterCode(depth, to ?? slots.find(key => key !== current) ?? "water"));
  };
  const openSave = () => { setTarget(String(packs[0]?.id ?? "")); setTitle(recipe.name); setPanel("save"); };
  const chosen = packs.find(pack => String(pack.id) === target) ?? null;
  const save = async () => {
    if (!chosen || !title.trim()) return;
    setSaving(true);
    const done = await onSaveToPack(current, chosen, title.trim()).finally(() => setSaving(false));
    if (done) setPanel(null);
  };
  return <div className="workspace-liquid-slots" role="group" aria-label="Жидкости карты">
    {slots.map(key => { const item = liquidRecipe(key, own), ref = own.find(entry => entry.key === key)?.ref, pack = ref ? liquidPackOf(ref) : null;
      return <button key={key} type="button" title={pack ? `${item.name} · из набора «${pack.name}»` : item.name} aria-pressed={key === current} onClick={() => pick(key)}>
        <Swatch recipe={item} /><span>{item.name}</span>
      </button>; })}
    {Array.from({ length: LIQUID_SLOTS - slots.length }, (_, i) => <button key={i} type="button" className="workspace-liquid-slot-empty" aria-label="Занять слот жидкостью" aria-expanded={panel === "menu"} onClick={() => setPanel(panel === "menu" ? null : "menu")}>+</button>)}
    <label title="1 — по щиколотку, 3 и глубже — вброд не перейти">Глубина · {depth} из {WATER_DEPTHS.length}
      <input aria-label="Глубина жидкости" type="range" min={1} max={WATER_DEPTHS.length} step={1} value={depth} onChange={event => onMaterial(waterCode(Number(event.target.value), current))} />
    </label>
    <div className="workspace-liquid-actions">
      <button type="button" aria-expanded={panel === "edit"} disabled={!mine && !room} title={mine ? undefined : linked ? `Рецепт из набора «${linked.name}» правится на экране наборов. Здесь — завести свою на его основе` : room ? "Заведёт свою жидкость на основе этой" : "Свободных слотов нет"}
        onClick={() => mine ? setPanel(panel === "edit" ? null : "edit") : create()}>{mine ? "Настроить" : "Своя на основе"}</button>
      <button type="button" aria-expanded={panel === "release"} onClick={() => setPanel(panel === "release" ? null : "release")}>Освободить слот</button>
    </div>
    {panel === "menu" && <div className="workspace-liquid-menu" role="menu" aria-label="Рецепты жидкостей">
      <input type="search" aria-label="Найти жидкость" placeholder="Найти…" value={query} onChange={event => setQuery(event.target.value)} />
      {free.map(item => <button key={item.key} type="button" role="menuitem" onClick={() => { setAdded([...added, item.key]); pick(item.key); }}><Swatch recipe={item} />{item.name}</button>)}
      {fromPacks.map(group => <div key={group.pack.uid} role="group" aria-label={group.pack.name} className="workspace-liquid-menu-group">
        <small>{group.pack.name}</small>
        {group.items.map(item => <button key={item.uid} type="button" role="menuitem" disabled={!freeKey} onClick={() => take(item)}><Swatch recipe={packLiquidRecipe(item, "")} />{item.name}</button>)}
      </div>)}
      {!free.length && !fromPacks.length && query.trim() && <small>Ничего не нашлось</small>}
      <button type="button" role="menuitem" disabled={!freeKey} onClick={create}>Своя жидкость…</button>
    </div>}
    {panel === "release" && <div className="workspace-liquid-menu workspace-liquid-release" role="dialog" aria-label={`Освободить слот: ${recipe.name}`}>
      <p>{used.includes(current) ? `«${recipe.name}» накрашена на карте. Что с ней сделать?` : `«${recipe.name}» на карте не накрашена.`}{mine && " Рецепт будет удалён."}{linked && ` В наборе «${linked.name}» жидкость останется.`}</p>
      <button type="button" onClick={() => release(null)}>{used.includes(current) ? "Стереть с карты" : "Освободить"}</button>
      {used.includes(current) && slots.filter(key => key !== current).map(key => <button key={key} type="button" onClick={() => release(key)}><Swatch recipe={liquidRecipe(key, own)} />Заменить на «{liquidRecipe(key, own).name}»</button>)}
      <button type="button" onClick={() => setPanel(null)}>Отмена</button>
    </div>}
    {panel === "edit" && mine && <div className="workspace-liquid-editor" role="dialog" aria-label={`Рецепт: ${recipe.name}`}>
      <label>Название<input type="text" maxLength={40} value={recipe.name} onChange={event => edit({ name: event.target.value || "Своя жидкость" })} /></label>
      <LiquidRecipeFields recipe={recipe} edit={edit} onSettle={onSettle} />
      {!live && <p className="workspace-liquid-warning">Сейчас жидкость — ровная заливка средним тоном: рисунок, глубину, кромку и свечение рисует «живая вода».
        <button type="button" onClick={onLive}>Включить живую воду</button></p>}
      <button type="button" title="Жидкость станет вещью набора: её можно будет взять на других картах" onClick={openSave}>Сохранить в набор…</button>
      <button type="button" onClick={() => setPanel(null)}>Готово</button>
    </div>}
    {panel === "save" && mine && <div className="workspace-liquid-editor" role="dialog" aria-label={`Сохранить в набор: ${recipe.name}`}>
      {packs.length ? <>
        <label>Набор<select value={target} onChange={event => setTarget(event.target.value)}>{packs.map(pack => <option key={pack.id} value={pack.id}>{pack.name}</option>)}</select></label>
        <label>Название в наборе<input type="text" maxLength={80} value={title} onChange={event => setTitle(event.target.value)} /></label>
        {chosen && title.trim() && <p>В набор «{chosen.name}» добавится жидкость «{title.trim()}». Слот на карте будет брать рецепт из набора, а своя копия удалится: дальше жидкость правится на экране наборов.</p>}
        <button type="button" className="primary" disabled={!chosen || !title.trim() || saving} onClick={() => void save()}>{saving ? "Сохраняю…" : "Сохранить в набор"}</button>
      </> : <p>Своих наборов пока нет. Заведите набор на экране «Наборы ассетов» — и жидкость можно будет сохранить в него.</p>}
      <button type="button" onClick={() => setPanel("edit")}>Назад</button>
    </div>}
  </div>;
});
