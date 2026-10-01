import { useEffect, useLayoutEffect, useRef } from "react";

type Handlers = { down: (event: KeyboardEvent) => void; up?: (event: KeyboardEvent) => void; blur?: () => void };

/** Window key listeners bound once; each event reaches the latest handlers. */
export function useWindowKeys(handlers: Handlers) {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  useEffect(() => {
    const down = (event: KeyboardEvent) => latest.current.down(event);
    const up = (event: KeyboardEvent) => latest.current.up?.(event);
    const blur = () => latest.current.blur?.();
    window.addEventListener("keydown", down); window.addEventListener("keyup", up); window.addEventListener("blur", blur);
    return () => { window.removeEventListener("keydown", down); window.removeEventListener("keyup", up); window.removeEventListener("blur", blur); };
  }, []);
}
