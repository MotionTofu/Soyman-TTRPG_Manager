import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PlayerDisplayFrame } from "@shared/playerDisplay";
import { PresentationStage } from "./PresentationStage";
import { PlayerMapStage } from "./PlayerMapStage";
import { ScreenView } from "./ScreenView";
import { cameraOf } from "./screens";
import { isSafeImageUrl } from "../../utils/safeUrl";
import "./player-display.css";

function Frame({ frame }: { frame: PlayerDisplayFrame }) {
  const content = frame.content;
  return <ScreenView camera={cameraOf(frame.display)} fill={content.kind === "map"} style={{ width: "100%", height: "100%" }}>
    {content.kind === "map" ? <PlayerMapStage mapId={content.mapId} /> : content.kind === "composition" ?
      <PresentationStage backgroundUrl={content.data.background_url} layers={content.data.layers}
        visibleIds={content.visibleLayerIds} fadeMs={content.data.fade_ms} transition="cut" transitionMs={0}
        title={content.data.title} titleSecs={content.data.title_secs} playKey={frame.playKey} playback={frame.visualPlayback} interactive waitingLabel="" /> : null}
  </ScreenView>;
}

interface Layer { id: number; frame: PlayerDisplayFrame | null; opacity?: number }
async function prepare(frame: PlayerDisplayFrame): Promise<void> {
  if (frame.content.kind !== "composition") return;
  const { data, visibleLayerIds } = frame.content;
  const visible = new Set(visibleLayerIds);
  const urls = [data.background_url, ...data.layers.filter(l => !l.has_button || visible.has(l.id)).map(l => l.image_url)];
  await Promise.all(urls.filter((url): url is string => !!url).map(url => new Promise<void>((resolve, reject) => {
    if (!isSafeImageUrl(url)) { reject(new Error("Недопустимое изображение")); return; }
    const img = new Image();
    img.onload = () => resolve(); img.onerror = () => reject(new Error("Изображение не загружено")); img.src = url;
  })));
}

/** Composites actual old/new frames. Interruptions freeze the current blend before starting the next one. */
export function PlayerDisplaySurface({ frame, onError }: { frame: PlayerDisplayFrame | null; onError?: (message: string, frame: PlayerDisplayFrame) => void }) {
  const [ready, setReady] = useState<PlayerDisplayFrame | null>(null);
  const preparedKey = useRef<string | null>(null);
  useEffect(() => {
    if (!frame) return;
    if (preparedKey.current === frame.playKey) { setReady(frame); return; }
    let active = true;
    void prepare(frame).then(() => {
      if (active) { preparedKey.current = frame.playKey; setReady(frame); }
    }).catch(error => { if (active) onError?.(error instanceof Error ? error.message : String(error), frame); });
    return () => { active = false; };
  }, [frame, onError]);

  const [layers, setLayers] = useState<Layer[]>([]);
  const elements = useRef(new Map<number, HTMLDivElement>());
  const sequence = useRef(0);
  const currentId = useRef<number | null>(null);
  const previousKey = useRef<string | null>(null);
  const finish = useRef<(() => void) | null>(null);
  const timedAnimations = useRef<Animation[]>([]);
  const visualClock = useRef(ready?.visualPlayback); visualClock.current = ready?.visualPlayback;
  function syncClock() {
    const clock = visualClock.current;
    if (!clock) return;
    for (const animation of timedAnimations.current) {
      animation.currentTime = clock.elapsedMs + (clock.startedAt === null ? 0 : Math.max(0, Date.now() - clock.startedAt));
      if (clock.startedAt === null) animation.pause(); else animation.play();
    }
  }
  useLayoutEffect(() => {
    if (!ready) return;
    if (previousKey.current === ready.playKey) {
      setLayers(old => old.map(l => l.id === currentId.current ? { ...l, frame: ready } : l));
      syncClock();
      return;
    }
    // Freeze in-flight WAAPI opacities, including any partially opaque black curtain.
    finish.current?.();
    previousKey.current = ready.playKey;
    const nextId = ++sequence.current;
    currentId.current = nextId;
    const { kind, durationMs } = ready.transition;
    if (kind === "cut" || durationMs <= 0) {
      setLayers([{ id: nextId, frame: ready }]); return;
    }
    const blackId = kind === "black" ? ++sequence.current : null;
    setLayers(old => [...old, { id: nextId, frame: ready, opacity: 0 }, ...(blackId ? [{ id: blackId, frame: null, opacity: 0 }] : [])]);
    let disposed = false;
    const animations: Animation[] = [];
    timedAnimations.current = animations;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const start = requestAnimationFrame(() => {
      const incoming = elements.current.get(nextId);
      if (!incoming || disposed) return;
      incoming.style.opacity = kind === "black" ? "0" : "1";
      const animate = (el: HTMLElement, from: number, to: number, duration: number) => {
        const a = el.animate([{ opacity: from }, { opacity: to }], { duration, easing: "linear", fill: "forwards" });
        animations.push(a); return a;
      };
      const done = () => {
        if (disposed) return;
        incoming.style.opacity = "1";
        for (const a of animations) a.cancel();
        setLayers([{ id: nextId, frame: ready }]);
      };
      if (blackId && ready.visualPlayback) {
        const curtain = elements.current.get(blackId)!;
        const incomingAnimation = incoming.animate([{ opacity: 0 }, { opacity: 0, offset: .5 }, { opacity: 1, offset: .5 }, { opacity: 1 }], { duration: durationMs, easing: "linear", fill: "forwards" });
        const curtainAnimation = curtain.animate([{ opacity: 0 }, { opacity: 1, offset: .5 }, { opacity: 0 }], { duration: durationMs, easing: "linear", fill: "forwards" });
        animations.push(incomingAnimation, curtainAnimation); curtainAnimation.onfinish = done;
      } else if (blackId) {
        const curtain = elements.current.get(blackId)!;
        animate(curtain, 0, 1, durationMs / 2);
        timer = setTimeout(() => {
          if (disposed) return;
          incoming.style.opacity = "1";
          setLayers([{ id: nextId, frame: ready }, { id: blackId, frame: null, opacity: 1 }]);
          const out = animate(curtain, 1, 0, durationMs / 2);
          out.onfinish = done;
        }, durationMs / 2);
      } else animate(incoming, 0, 1, durationMs).onfinish = done;
      syncClock();
    });
    finish.current = () => {
      disposed = true; cancelAnimationFrame(start); clearTimeout(timer);
      for (const el of elements.current.values()) {
        const opacity = getComputedStyle(el).opacity;
        el.style.opacity = opacity;
      }
      for (const a of animations) a.cancel();
    };
  }, [ready]);
  useEffect(() => () => finish.current?.(), []);

  return <div className="player-display-surface" data-play-key={ready?.playKey}>
    {layers.map(layer => <div key={layer.id} className="player-display-layer" style={{ opacity: layer.opacity ?? 1 }}
      ref={el => { if (el) elements.current.set(layer.id, el); else elements.current.delete(layer.id); }}>
      {layer.frame ? <Frame frame={layer.frame} /> : null}
    </div>)}
  </div>;
}
