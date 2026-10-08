import { memo, useState } from "react";
import { LIQUIDS, WATER_DEPTHS, liquidKind, villageUrl, waterCode, waterLevel, type LiquidKey } from "../assets/village";
import { LIQUID_SLOTS } from "./liquids";

const picture = (key: LiquidKey) => villageUrl(key === "water" ? "shallow" : key);

/** Слоты жидкостей — полоска поверх карты, пока активен инструмент «Жидкость». Слот занят жидкостью, которой на карте
 * красили или которую только что взяли; пустой предлагает рецепт. Свои рецепты и освобождение слота — следующим шагом:
 * пока рецептов столько же, сколько слотов, упереться в лимит нельзя. */
export const LiquidSlots = memo(function LiquidSlots({ used, material, onMaterial }: { used: readonly LiquidKey[]; material: string; onMaterial: (code: string) => void }) {
  const [added, setAdded] = useState<LiquidKey[]>([]), [menu, setMenu] = useState(false);
  const current = LIQUIDS[liquidKind(material)].key, depth = waterLevel(material) || 2;
  const slots = [...new Set([...used, ...added, current])].slice(0, LIQUID_SLOTS);
  const free = LIQUIDS.filter(item => !slots.includes(item.key));
  return <div className="workspace-liquid-slots" role="group" aria-label="Жидкости карты">
    {slots.map(key => { const item = LIQUIDS.find(entry => entry.key === key)!; return <button key={key} type="button" title={item.name} aria-pressed={key === current} onClick={() => onMaterial(waterCode(depth, key))}>
      <img src={picture(key)} alt="" style={{ background: item.fill }} /><span>{item.name}</span>
    </button>; })}
    {Array.from({ length: LIQUID_SLOTS - slots.length }, (_, i) => <button key={i} type="button" className="workspace-liquid-slot-empty" aria-label="Занять слот жидкостью" aria-expanded={menu} onClick={() => setMenu(!menu)}>+</button>)}
    {menu && free.length > 0 && <div className="workspace-liquid-menu" role="menu" aria-label="Рецепты жидкостей">
      {free.map(item => <button key={item.key} type="button" role="menuitem" onClick={() => { setAdded([...added, item.key]); setMenu(false); onMaterial(waterCode(depth, item.key)); }}>
        <img src={picture(item.key)} alt="" style={{ background: item.fill }} />{item.name}
      </button>)}
    </div>}
    <label title="1 — по щиколотку, 3 и глубже — вброд не перейти">Глубина · {depth} из {WATER_DEPTHS.length}
      <input aria-label="Глубина жидкости" type="range" min={1} max={WATER_DEPTHS.length} step={1} value={depth} onChange={event => onMaterial(waterCode(Number(event.target.value), current))} />
    </label>
  </div>;
});
