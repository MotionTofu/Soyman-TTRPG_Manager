import { useSyncExternalStore } from "react";

// Замер скорости — инструмент разработки, а не Мастера (гриллинг «Д» 2026-11-06, Q13): по умолчанию
// выключен, включается в «⋯» шапки и помнится на этот браузер.
const PERF_KEY = "soyman.maps.perf";
const perfListeners = new Set<() => void>();
let perfOn = (() => { try { return localStorage.getItem(PERF_KEY) === "1"; } catch { return false; } })();
export function setPerformanceMeter(on: boolean) {
  perfOn = on;
  try { if (on) localStorage.setItem(PERF_KEY, "1"); else localStorage.removeItem(PERF_KEY); } catch { /* выбор живёт до перезагрузки */ }
  perfListeners.forEach((listener) => listener());
}
export function usePerformanceMeter() {
  return useSyncExternalStore((listener) => { perfListeners.add(listener); return () => { perfListeners.delete(listener); }; }, () => perfOn);
}
