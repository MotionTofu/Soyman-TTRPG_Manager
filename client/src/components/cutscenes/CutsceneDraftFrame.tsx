import { useQueries } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { CutsceneComposition, CutsceneMediaAccess, CutsceneVisualTransition } from "@shared/cutscenes/types";
import type { CutsceneVisualPlayback } from "@shared/cutscenes/previewApi";
import { resourceQuery } from "../../data/hooks";
import { workshopAccessPath } from "../../data/cutsceneMedia";
import { PresentationStage, type LayerGeom } from "../presentation/PresentationStage";

export function CutsceneDraftFrame({ id, composition, transition, playKey = "edit", selected, onSelect, onGeometry, playback }: {
  id: number; composition: CutsceneComposition | null; transition?: CutsceneVisualTransition; playKey?: string | number;
  selected?: string | null; onSelect?: (id: string | null) => void; onGeometry?: (id: string, geometry: LayerGeom) => void;
  playback?: CutsceneVisualPlayback;
}) {
  const refs = [...new Map([...(composition?.background ? [composition.background] : []), ...(composition?.layers.map(layer => layer.image) ?? [])].map(ref => [ref.id,ref])).values()];
  const root = useRef<HTMLDivElement>(null), signature = refs.map(ref => ref.id).join(':');
  const attempted = useRef(false), [generation,setGeneration] = useState(0);
  useEffect(() => { attempted.current = false; if (root.current) delete root.current.dataset.imageError; },[signature]);
  const queries = useQueries({ queries: refs.map(ref => resourceQuery<CutsceneMediaAccess>(workshopAccessPath(id, ref.id), { staleMs: 45_000 })) });
  const urls = new Map(refs.map((ref,index) => [ref.id, queries[index]?.data?.url ?? ""]));
  const layers = (composition?.layers ?? []).map((layer,index) => ({ ...layer, id: index + 1, image_url: urls.get(layer.image.id) ?? "", image_path: "",
    has_button: 1, visible_on_enter: layer.visible ? 1 : 0 }));
  const editable = onSelect && onGeometry;
  const playing = playKey !== "edit";
  return <div ref={root} className="cs-draft-frame" onErrorCapture={event => {
    (event.currentTarget as HTMLElement).dataset.imageError = "true";
    // Cached signed access can expire before a newly mounted IMG loads. Renew once and remount StageImg's stable-URL cache.
    if (!attempted.current) { attempted.current = true; void Promise.all(queries.map(query => query.refetch())).then(() => {
      if (root.current) delete root.current.dataset.imageError; setGeneration(value => value + 1);
    }); }
  }}>
    <PresentationStage key={generation} backgroundUrl={composition?.background ? urls.get(composition.background.id) || null : null} layers={layers}
      visibleIds={layers.filter(layer => layer.visible_on_enter).map(layer => layer.id)} fadeMs={editable ? 0 : composition?.fade_ms ?? 0}
      transition={transition?.kind ?? "cut"} transitionMs={transition?.durationMs ?? 0} title={!playing ? "" : composition?.title ?? ""} titleSecs={playing ? composition?.title_secs ?? 0 : 0}
      playKey={playKey} playback={playback} waitingLabel={queries.some(query => query.isPending) ? "Изображение…" : "Чёрный экран"}
      edit={editable ? { selectedId: composition?.layers.findIndex(layer => layer.id === selected)! + 1 || null, showHidden: true,
        onSelect: index => onSelect(index === null ? null : composition?.layers[index - 1]?.id ?? null),
        onGeometry: (index, geometry) => { const layer = composition?.layers[index - 1]; if (layer) onGeometry(layer.id, geometry); } } : undefined} />
    {queries.some(query => query.isError) && <span className="cs-frame-error">Изображение недоступно: {queries.find(query => query.isError)?.error?.message}</span>}
  </div>;
}
