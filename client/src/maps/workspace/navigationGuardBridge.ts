let active: ((event: PopStateEvent) => void) | null = null;
let installed = false;

/** Register before BrowserRouter subscribes. At the Window event target a
 * late listener cannot reliably keep an earlier router listener from firing. */
export function installMapNavigationBridge() {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("popstate", (event) => active?.(event), true);
}
export function activateMapPopGuard(handler: (event: PopStateEvent) => void): () => void {
  installMapNavigationBridge();
  active = handler;
  return () => { if (active === handler) active = null; };
}
