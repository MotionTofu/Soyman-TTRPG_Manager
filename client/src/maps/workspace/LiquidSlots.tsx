import { memo, useState } from "react";
import type { MapLiquidRecipe } from "@shared/maps/core";
import { LIQUIDS, LIQUID_PATTERNS, LIQUID_RIMS, OWN_LIQUID_KEYS, WATER_DEPTHS, liquidKey, liquidRecipe, villageUrl, waterCode, waterLevel,
  type LiquidPattern, type LiquidRecipe, type LiquidRim } from "../assets/village";
import { LIQUID_SLOTS, liquidShades } from "./liquids";

const builtin = (key: string) => LIQUIDS.some(item => item.key === key);
function Swatch({ recipe }: { recipe: LiquidRecipe }) {
  return builtin(recipe.key) ? <img src={villageUrl(recipe.key === "water" ? "shallow" : recipe.key)} alt="" style={{ background: recipe.fill }} />
    : <i aria-hidden="true" style={{ background: `linear-gradient(135deg, ${recipe.tones[2]} 0 18%, ${recipe.tones[1]} 18% 62%, ${recipe.tones[0]} 62%)` }} />;
}
function Range({ name, value, min, max, step, onChange, onSettle }: { name: string; value: number; min: number; max: number; step: number; onChange: (value: number) => void; onSettle: () => void }) {
  return <label>{name}<input type="range" aria-label={name} min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} onPointerUp={onSettle} onKeyUp={onSettle} onBlur={onSettle} /></label>;
}

/** Слоты жидкостей — полоска поверх карты, пока активен инструмент «Жидкость». Слот занят жидкостью, которая накрашена на
 * карте или только что взята; пустой предлагает готовый рецепт или свою жидкость. Свой рецепт правится тут же, и карта
 * перекрашивается сразу: в слое лежит ключ рецепта, а не его цвета.
 * `onOwn` — новая таблица своих рецептов; `live` — ползунок ещё тянут, шаг истории закроет `onSettle`. */
export const LiquidSlots = memo(function LiquidSlots({ used, own, material, live, onLive, onMaterial, onOwn, onSettle, onRelease }: {
  /** Включена ли «живая вода»: без неё жидкость — ровная заливка, и рецепт не на чем показать. */
  live: boolean; onLive: () => void;
  used: readonly string[]; own: readonly MapLiquidRecipe[]; material: string; onMaterial: (code: string) => void;
  onOwn: (next: MapLiquidRecipe[], live: boolean) => void; onSettle: () => void; onRelease: (key: string, to: string | null) => void;
}) {
  const [added, setAdded] = useState<string[]>([]), [panel, setPanel] = useState<"menu" | "edit" | "release" | null>(null);
  const current = liquidKey(material), depth = waterLevel(material) || 2, recipe = liquidRecipe(current, own);
  // Свой рецепт без накрашенного тоже держит слот: иначе его негде было бы выбрать.
  const slots = [...new Set([...used, ...added, ...own.map(item => item.key), current])].filter(key => builtin(key) || own.some(item => item.key === key)).slice(0, LIQUID_SLOTS);
  const free = LIQUIDS.filter(item => !slots.includes(item.key)), room = slots.length < LIQUID_SLOTS;
  const mine = !builtin(current) && own.some(item => item.key === current);
  const pick = (key: string) => { setPanel(null); onMaterial(waterCode(depth, key)); };
  /** Своя жидкость на основе выбранной: её и открываем на правку. */
  const create = () => {
    const key = OWN_LIQUID_KEYS.find(item => !own.some(entry => entry.key === item));
    if (!key) return;
    const { fill: _fill, ...base } = recipe;
    onOwn([...own, { ...base, key, name: builtin(current) && current !== "water" ? `${recipe.name}, своя` : "Своя жидкость", tones: [...recipe.tones] as [string, string, string] }], false);
    onMaterial(waterCode(depth, key)); setPanel("edit");
  };
  const edit = (patch: Partial<MapLiquidRecipe>, live = false) => onOwn(own.map(item => item.key === current ? { ...item, ...patch } : item), live);
  const release = (to: string | null) => {
    onRelease(current, to); setAdded(added.filter(key => key !== current)); setPanel(null);
    onMaterial(waterCode(depth, to ?? slots.find(key => key !== current) ?? "water"));
  };
  return <div className="workspace-liquid-slots" role="group" aria-label="Жидкости карты">
    {slots.map(key => { const item = liquidRecipe(key, own); return <button key={key} type="button" title={item.name} aria-pressed={key === current} onClick={() => pick(key)}>
      <Swatch recipe={item} /><span>{item.name}</span>
    </button>; })}
    {Array.from({ length: LIQUID_SLOTS - slots.length }, (_, i) => <button key={i} type="button" className="workspace-liquid-slot-empty" aria-label="Занять слот жидкостью" aria-expanded={panel === "menu"} onClick={() => setPanel(panel === "menu" ? null : "menu")}>+</button>)}
    <label title="1 — по щиколотку, 3 и глубже — вброд не перейти">Глубина · {depth} из {WATER_DEPTHS.length}
      <input aria-label="Глубина жидкости" type="range" min={1} max={WATER_DEPTHS.length} step={1} value={depth} onChange={event => onMaterial(waterCode(Number(event.target.value), current))} />
    </label>
    <div className="workspace-liquid-actions">
      <button type="button" aria-expanded={panel === "edit"} disabled={!mine && !room} title={mine ? undefined : room ? "Заведёт свою жидкость на основе этой" : "Свободных слотов нет"}
        onClick={() => mine ? setPanel(panel === "edit" ? null : "edit") : create()}>{mine ? "Настроить" : "Своя на основе"}</button>
      <button type="button" aria-expanded={panel === "release"} onClick={() => setPanel(panel === "release" ? null : "release")}>Освободить слот</button>
    </div>
    {panel === "menu" && <div className="workspace-liquid-menu" role="menu" aria-label="Рецепты жидкостей">
      {free.map(item => <button key={item.key} type="button" role="menuitem" onClick={() => { setAdded([...added, item.key]); pick(item.key); }}><Swatch recipe={item} />{item.name}</button>)}
      <button type="button" role="menuitem" disabled={own.length >= OWN_LIQUID_KEYS.length} onClick={create}>Своя жидкость…</button>
    </div>}
    {panel === "release" && <div className="workspace-liquid-menu workspace-liquid-release" role="dialog" aria-label={`Освободить слот: ${recipe.name}`}>
      <p>{used.includes(current) ? `«${recipe.name}» накрашена на карте. Что с ней сделать?` : `«${recipe.name}» на карте не накрашена.`}{mine && " Рецепт будет удалён."}</p>
      <button type="button" onClick={() => release(null)}>{used.includes(current) ? "Стереть с карты" : "Освободить"}</button>
      {used.includes(current) && slots.filter(key => key !== current).map(key => <button key={key} type="button" onClick={() => release(key)}><Swatch recipe={liquidRecipe(key, own)} />Заменить на «{liquidRecipe(key, own).name}»</button>)}
      <button type="button" onClick={() => setPanel(null)}>Отмена</button>
    </div>}
    {panel === "edit" && mine && <div className="workspace-liquid-editor" role="dialog" aria-label={`Рецепт: ${recipe.name}`}>
      <label>Название<input type="text" maxLength={40} value={recipe.name} onChange={event => edit({ name: event.target.value || "Своя жидкость" })} /></label>
      <fieldset><legend>Цвета</legend>{(["Глубина", "Середина", "Блик"] as const).map((name, i) => <label key={name}>{name}
        <input type="color" aria-label={`Цвет: ${name}`} value={recipe.tones[i]} onChange={event => edit({ tones: recipe.tones.map((tone, n) => n === i ? event.target.value : tone) as [string, string, string] }, true)} onBlur={onSettle} /></label>)}</fieldset>
      <button type="button" title="Подобрать «Глубину» и «Блик» по яркости «Середины»"
        onClick={() => { const [deep, light] = liquidShades(recipe.tones[1]); edit({ tones: [deep, recipe.tones[1], light] }); }}>Рассчитать глубины</button>
      <Range name="Подвижность" value={recipe.pace} min={0} max={2} step={0.05} onChange={pace => edit({ pace }, true)} onSettle={onSettle} />
      <Range name="Крупность рисунка" value={recipe.size} min={0.25} max={4} step={0.05} onChange={size => edit({ size }, true)} onSettle={onSettle} />
      <Range name="Дно видно" value={recipe.bed} min={0} max={1} step={0.05} onChange={bed => edit({ bed }, true)} onSettle={onSettle} />
      <Range name="Свечение" value={recipe.glow} min={0} max={1} step={0.05} onChange={glow => edit({ glow }, true)} onSettle={onSettle} />
      <label>Рисунок<select value={recipe.pattern} onChange={event => edit({ pattern: event.target.value as LiquidPattern })}>
        {Object.entries(LIQUID_PATTERNS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label>Кромка<select value={recipe.rim} onChange={event => edit({ rim: event.target.value as LiquidRim })}>
        {Object.entries(LIQUID_RIMS).map(([key, name]) => <option key={key} value={key}>{name}</option>)}</select></label>
      <label className="workspace-liquid-check"><input type="checkbox" checked={recipe.solid} onChange={event => edit({ solid: event.target.checked })} />Твёрдая: по ней ходят, мост не нужен</label>
      {!live && <p className="workspace-liquid-warning">Сейчас жидкость — ровная заливка средним тоном: рисунок, глубину, кромку и свечение рисует «живая вода».
        <button type="button" onClick={onLive}>Включить живую воду</button></p>}
      <button type="button" onClick={() => setPanel(null)}>Готово</button>
    </div>}
  </div>;
});
