import { useState } from "react";
import { CARTOGRAPHY_OBJECTS, CARTOGRAPHY_SURFACES, cartographyId, cartographyUrl } from "../assets/cartography";
import { MAP_SYMBOL_ASSETS } from "../assets/registry";

function Thumbnail({ url }: { url: string | null }) {
  const [failed, setFailed] = useState(false);
  return url && !failed ? <img src={url} alt="" onError={() => setFailed(true)} /> : <span title={failed ? "Изображение недоступно" : undefined} aria-hidden="true">✦</span>;
}
export function AssetLibrary({ selected, material, onObject, onSurface, onClose }: {
  selected: string; material: string; onObject: (id: string) => void; onSurface: (code: string) => void; onClose: () => void;
}) {
  const [category, setCategory] = useState<"dungeon" | "region" | "surfaces" | "symbols">("dungeon");
  const [query, setQuery] = useState("");
  const matches = (name: string) => name.toLocaleLowerCase("ru").includes(query.trim().toLocaleLowerCase("ru"));
  const items = category === "surfaces" ? CARTOGRAPHY_SURFACES.filter(item => matches(item.name)).map(item => ({
    id: item.code, name: item.name, url: item.key ? cartographyUrl(item.key) : null, chosen: material === item.code, choose: () => onSurface(item.code),
  })) : category === "symbols" ? MAP_SYMBOL_ASSETS.filter(item => matches(item.name)).map(item => ({
    id: item.id, name: item.name, url: null, chosen: selected === item.id, choose: () => onObject(item.id),
  })) : CARTOGRAPHY_OBJECTS.filter(item => item.group === category && matches(item.name)).map(item => ({
    id: cartographyId(item.key), name: item.name, url: cartographyUrl(item.key), chosen: selected === cartographyId(item.key), choose: () => onObject(cartographyId(item.key)),
  }));
  return <aside className="workspace-asset-library" aria-label="Библиотека карты">
    <div className="workspace-asset-library-heading"><strong>Библиотека</strong>
      <nav aria-label="Разделы библиотеки">{(["dungeon", "region", "surfaces", "symbols"] as const).map(key => <button key={key} aria-pressed={category === key} onClick={() => setCategory(key)}>{{ dungeon: "Подземелье", region: "Регион", surfaces: "Поверхности", symbols: "Символы" }[key]}</button>)}</nav>
      <input autoFocus aria-label="Найти в библиотеке" placeholder="Найти объект…" value={query} onChange={event => setQuery(event.target.value)} />
      <button aria-label="Закрыть библиотеку" onClick={onClose}>×</button>
    </div>
    <div className="workspace-asset-library-items">{items.map(item => <button key={item.id} aria-pressed={item.chosen} onClick={item.choose}>
      <Thumbnail url={item.url} /><span>{item.name}</span>
    </button>)}{!items.length && <p>Ничего не найдено. Попробуйте другое название.</p>}</div>
    <p>Выберите и поставьте на карту. Дверь из набора — декор; для прохода используйте инструмент «Дверь».</p>
  </aside>;
}
