import { useLayoutEffect, useRef, useState } from "react";
import { TeleprompterScroller, type TeleprompterCursor, type TeleprompterStatus } from "./teleprompter";

export function useTeleprompterScroll(options: { identity: string; text: string | null; paused: boolean; wordsPerMinute: number;
  fontSize: number; cursor: TeleprompterCursor; onManual: () => void }) {
  const viewport = useRef<HTMLDivElement>(null), content = useRef<HTMLDivElement>(null);
  const scroller = useRef<TeleprompterScroller | null>(null);
  const manual = useRef(options.onManual); manual.current = options.onManual;
  const [status, setStatus] = useState<TeleprompterStatus>({ overflowing: false, atEnd: false });
  const { cursor } = options;
  useLayoutEffect(() => {
    const view = viewport.current, prose = content.current;
    if (!view || !prose) return;
    let alive = true;
    const instance = new TeleprompterScroller(view, prose, cursor, { manual: () => manual.current(),
      changed: next => { if (alive) setStatus(next); } });
    scroller.current = instance;
    view.addEventListener("wheel", instance.pauseForManualScroll, { passive: true });
    view.addEventListener("touchmove", instance.pauseForManualScroll, { passive: true });
    view.addEventListener("scroll", instance.scrolled, { passive: true });
    view.addEventListener("keydown", instance.keydown);
    const refresh = () => instance.refresh();
    const resize = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(refresh);
    resize?.observe(view); resize?.observe(prose);
    const mutation = new MutationObserver(refresh);
    mutation.observe(prose, { childList: true, subtree: true, characterData: true });
    window.addEventListener("resize", refresh); document.addEventListener("visibilitychange", refresh);
    void document.fonts?.ready.then(() => { if (alive) refresh(); });
    return () => {
      alive = false; instance.dispose(); scroller.current = null;
      resize?.disconnect(); mutation.disconnect();
      window.removeEventListener("resize", refresh); document.removeEventListener("visibilitychange", refresh);
      view.removeEventListener("wheel", instance.pauseForManualScroll); view.removeEventListener("touchmove", instance.pauseForManualScroll);
      view.removeEventListener("scroll", instance.scrolled); view.removeEventListener("keydown", instance.keydown);
    };
  }, [cursor]);
  useLayoutEffect(() => {
    scroller.current?.update(options.identity, options.paused, options.wordsPerMinute);
  }, [options.identity, options.paused, options.wordsPerMinute, options.text, options.fontSize]);
  return { viewport, content, status };
}
