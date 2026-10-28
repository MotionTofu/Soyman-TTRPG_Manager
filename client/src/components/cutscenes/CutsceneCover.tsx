import { useEffect, useRef, useState } from "react";
import type { PresentationData } from "@shared/presentation";
import { useResource } from "../../data/hooks";
import { cutscenePaths } from "../../data/cutscenes";
import { PresentationStage } from "../presentation/PresentationStage";
import { NavIcon } from "../NavIcons";

export function CutsceneCover({ id, savedVersion }: { id: number; savedVersion: string }) {
  const root = useRef<HTMLDivElement>(null), [visible, setVisible] = useState(false), [failed, setFailed] = useState(false);
  useEffect(() => {
    const target = root.current;
    if (!target || typeof IntersectionObserver === "undefined") { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: "200px" });
    observer.observe(target); return () => observer.disconnect();
  }, []);
  useEffect(() => setFailed(false), [savedVersion]);
  const thumbnail = useResource<PresentationData | null>(visible ? cutscenePaths.thumbnail(id, savedVersion) : null);
  const data = !failed && !thumbnail.error ? thumbnail.data : null;
  return <div ref={root} className="cutscene-cover" aria-hidden="true" onErrorCapture={() => setFailed(true)}>
    {data ? <PresentationStage backgroundUrl={data.background_url} layers={data.layers} visibleIds={[]}
      title={data.title} titleSecs={0} fadeMs={0} playKey={`${id}:${savedVersion}`} transition="cut" transitionMs={0} waitingLabel="" />
      : <div className="cutscene-cover__placeholder cover-art-fallback zine-grain"><NavIcon name="image" />
        <span>{thumbnail.loading ? "Изображение…" : failed || thumbnail.error ? "Изображение недоступно" : "Без изображения"}</span></div>}
  </div>;
}
