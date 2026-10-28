import { useState, type ReactNode } from "react";
import type { CutsceneVisualPlayback } from "@shared/cutscenes/previewApi";
import type { CutsceneComposition, CutsceneImageLayer, CutsceneVisualTransition } from "@shared/cutscenes/types";
import type { WorkshopMedia } from "../../data/cutsceneMedia";
import { workshopId } from "../../cutscenes/workshopDraft";
import { CutsceneDraftFrame } from "./CutsceneDraftFrame";
import { CutsceneMediaPicker } from "./CutsceneMediaPicker";
import { WorkshopNumber, WorkshopSeconds, WorkshopFieldGroup } from "./WorkshopFields";

export function WorkshopComposition({ id, stepId, value, onChange, previewKey, transition, extra, playback }: {
  id: number; stepId: string; value: CutsceneComposition; onChange: (update: (current: CutsceneComposition) => CutsceneComposition) => void;
  previewKey?: string | number; transition?: CutsceneVisualTransition; extra?: ReactNode;
  playback?: CutsceneVisualPlayback;
}) {
  const [selected, setSelected] = useState<string | null>(null), [picker, setPicker] = useState<"background" | "layers" | null>(null);
  const [drag, setDrag] = useState<string | null>(null);
  const patch = (layerId: string, fields: Partial<CutsceneImageLayer>) => onChange(current => ({ ...current, layers: current.layers.map(layer => layer.id === layerId ? { ...layer,...fields } : layer) }));
  function reorder(fromId: string, toId: string) {
    onChange(current => { const layers = [...current.layers].sort((a,b) => a.position - b.position), from = layers.findIndex(layer => layer.id === fromId), to = layers.findIndex(layer => layer.id === toId);
      if (from < 0 || to < 0) return current; layers.splice(to,0,...layers.splice(from,1)); return { ...current,layers: layers.map((layer,position) => ({ ...layer,position })) }; });
  }
  function picked(media: WorkshopMedia[]) {
    onChange(current => picker === "background" ? { ...current, background: media[0].ref as CutsceneComposition["background"] } : { ...current,
      layers: [...current.layers,...media.map((item,index) => ({ id: workshopId(), name: item.name, image: { kind: "image" as const,id: item.ref.id },
        visible: true,position: current.layers.length + index,x_pct: 25,y_pct: 25,w_pct: 50,h_pct: 50 }))] });
  }
  const selectedLayer = value.layers.find(layer => layer.id === selected), layers = [...value.layers].sort((a,b) => a.position - b.position);
  const path = ['steps',stepId,'image','composition'];
  return <div className="cs-composition"><div className="cs-composition__canvas"><CutsceneDraftFrame id={id} composition={value} selected={selected} playKey={previewKey} playback={playback} transition={transition} onSelect={setSelected} onGeometry={(layerId, geometry) => patch(layerId,geometry)} />
    <p className="muted">Перетаскивайте слой за изображение, меняйте размер угловыми ручками. Shift — свободное растягивание.</p>
    </div><aside className="cs-composition__properties" aria-label="Свойства изображения">
    <div className="cs-toolbar"><button onClick={() => setPicker("background")}>{value.background ? "Заменить фон" : "Добавить фон"}</button>
      {value.background && <button onClick={() => onChange(current => ({ ...current,background: null }))}>Убрать фон</button>}
      <button onClick={() => setPicker("layers")}>Добавить изображения слоями</button></div>
    {!!layers.length && <div className="cs-layers" aria-label="Слои композиции">{layers.map((layer,index) => <div key={layer.id} className={`cs-layer${selected === layer.id ? " is-selected" : ""}`}
      draggable onDragStart={() => setDrag(layer.id)} onDragEnd={() => setDrag(null)} onDragOver={event => event.preventDefault()} onDrop={event => { event.preventDefault(); if (drag) reorder(drag,layer.id); setDrag(null); }}>
      <button aria-pressed={selected === layer.id} onClick={() => setSelected(layer.id)}>{layer.name || `Слой ${index + 1}`}</button>
      <label className="cs-checkbox"><input data-draft-path={JSON.stringify([...path,'layers',layer.id,'visible'])} type="checkbox" checked={layer.visible} onChange={event => patch(layer.id,{ visible: event.target.checked })} />Виден</label>
      <button aria-label={`Слой ${index + 1} выше`} disabled={index === 0} onClick={() => reorder(layer.id,layers[index - 1].id)}>↑</button>
      <button aria-label={`Слой ${index + 1} ниже`} disabled={index === layers.length - 1} onClick={() => reorder(layer.id,layers[index + 1].id)}>↓</button>
      <button aria-label={`Убрать слой ${index + 1}`} onClick={() => onChange(current => ({ ...current,layers: current.layers.filter(row => row.id !== layer.id) }))}>Убрать</button>
    </div>)}</div>}
    {selectedLayer && <WorkshopFieldGroup className="cs-fields" path={["steps",stepId,"image","composition","layers",selectedLayer.id]}>
      <label>Имя слоя<input data-draft-path={JSON.stringify([...path,'layers',selectedLayer.id,'name'])} value={selectedLayer.name} onChange={event => patch(selectedLayer.id,{ name: event.target.value })} /></label>
      {([['x_pct','Положение X, %'],['y_pct','Положение Y, %'],['w_pct','Ширина, %'],['h_pct','Высота, %']] as const).map(([key,label]) =>
        <WorkshopNumber key={key} path={[...path,'layers',selectedLayer.id,key]} label={label} min={key === 'x_pct' || key === 'y_pct' ? -Infinity : Number.MIN_VALUE} value={selectedLayer[key]} onChange={number => patch(selectedLayer.id,{ [key]: number ?? 1 })} />)}
    </WorkshopFieldGroup>}
    <div className="cs-fields"><WorkshopFieldGroup path={["steps",stepId,"image","composition","title"]}><label>Титр для игроков<input value={value.title} onChange={event => onChange(current => ({ ...current,title: event.target.value }))} /></label></WorkshopFieldGroup>
      <WorkshopNumber path={[...path,'title_secs']} label="Длительность титра, с" value={value.title_secs} onChange={number => onChange(current => ({ ...current,title_secs: number ?? 0 }))} />
      <WorkshopSeconds path={[...path,'fade_ms']} label="Плавность слоёв" ms={value.fade_ms} onChange={fade_ms => onChange(current => ({ ...current,fade_ms }))} /></div>
    {extra}</aside>
    {picker && <CutsceneMediaPicker id={id} kind="image" multiple={picker === "layers"} title={picker === "layers" ? "Изображения слоями" : "Фон композиции"} onPick={picked} onClose={() => setPicker(null)} />}
  </div>;
}
