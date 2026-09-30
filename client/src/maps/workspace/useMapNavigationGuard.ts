import { useContext, useEffect, useRef } from "react";
import { UNSAFE_NavigationContext, useLocation } from "react-router-dom";
import { activateMapPopGuard } from "./navigationGuardBridge";

/** BrowserRouter does not expose a data-router blocker. Guard its shared
 * navigator and reverse a POP before draining saves, then replay it only on
 * success. The router never unmounts the editor while a failed save is pending. */
export function useMapNavigationGuard(needed: () => boolean, leave: () => Promise<boolean>) {
  const { navigator } = useContext(UNSAFE_NavigationContext);
  const location = useLocation();
  const live = useRef({ needed, leave });
  live.current = { needed, leave };
  const index = useRef<number | null>(null);
  useEffect(() => { index.current = Number.isInteger(window.history.state?.idx) ? window.history.state.idx : null; }, [location]);
  useEffect(() => {
    const originalPush = navigator.push;
    const originalReplace = navigator.replace;
    let alive = true;
    let busy = false;
    let restore: { delta: number; from: number } | null = null;
    let replay = false;
    const attempt = async (action: () => void) => {
      if (busy) return;
      busy = true;
      try { if (await live.current.leave() && alive) action(); }
      catch { /* Unexpected callback failure must never replay navigation. */ }
      finally { busy = false; }
    };
    navigator.push = (...args) => {
      if (!live.current.needed()) return originalPush.apply(navigator, args);
      void attempt(() => originalPush.apply(navigator, args));
    };
    navigator.replace = (...args) => {
      if (!live.current.needed()) return originalReplace.apply(navigator, args);
      void attempt(() => originalReplace.apply(navigator, args));
    };
    const onPop = (event: PopStateEvent) => {
      const target = Number.isInteger(event.state?.idx) ? event.state.idx as number : null;
      if (restore) {
        event.stopImmediatePropagation();
        const pending = restore;
        restore = null;
        index.current = pending.from;
        void attempt(() => { replay = true; window.history.go(-pending.delta); });
        return;
      }
      if (replay) { replay = false; index.current = target; return; }
      if (!live.current.needed()) { index.current = target; return; }
      // Only BrowserRouter-managed history entries carry an idx. Leaving the
      // document itself is covered by autosave's native beforeunload guard.
      if (target === null || index.current === null || target === index.current) return;
      event.stopImmediatePropagation();
      const delta = index.current - target;
      restore = { delta, from: index.current };
      window.history.go(delta);
    };
    const deactivate = activateMapPopGuard(onPop);
    return () => {
      alive = false;
      navigator.push = originalPush;
      navigator.replace = originalReplace;
      deactivate();
    };
  }, [navigator]);
}
