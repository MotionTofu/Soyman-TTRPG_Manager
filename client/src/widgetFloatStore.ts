import { useEffect, useState } from "react";

// Где живёт каждый блок пульта: в сетке, в плавающем окне или плашкой внизу
// докстанции. Общее для SceneSwitcher, PultGrid (сетка и окна) и PreviewDock
// (плашки) — они в разных ветках дерева, без общих пропсов через AppShell,
// поэтому стор тем же приёмом, что previewDockStore: модуль + событие.
//
// Замена sceneFloatStore (тот знал только сцены): старый ключ
// rpgManagerScenesDetached мигрирует в scenes один раз и удаляется.
export type WidgetFloatMode = "grid" | "float" | "dock";

export type PultWidgetId =
  | "scenes"
  | "idea"
  | "events"
  | "plot"
  | "locations"
  | "obstacles"
  | "loot"
  | "reminders"
  | "compendium"
  | "roster"
  | "secrets";

const KEY = "rpgManagerWidgetFloat";
const LEGACY_KEY = "rpgManagerScenesDetached";
const EVENT = "widget-float-changed";

function isMode(v: unknown): v is WidgetFloatMode {
  return v === "grid" || v === "float" || v === "dock";
}

function read(): Partial<Record<PultWidgetId, WidgetFloatMode>> {
  try {
    const out: Partial<Record<PultWidgetId, WidgetFloatMode>> = {};
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [id, mode] of Object.entries(parsed)) {
        if (isMode(mode)) out[id as PultWidgetId] = mode;
      }
    }
    // Миграция со стора только-сцен: откреплено значило «в окне».
    const legacy = localStorage.getItem(LEGACY_KEY);
    if (legacy === "1" || legacy === "float" || legacy === "dock") {
      if (!out.scenes) out.scenes = legacy === "dock" ? "dock" : "float";
      localStorage.removeItem(LEGACY_KEY);
    }
    return out;
  } catch {
    return {};
  }
}

let modes: Partial<Record<PultWidgetId, WidgetFloatMode>> = read();

function commit(next: Partial<Record<PultWidgetId, WidgetFloatMode>>) {
  modes = next;
  try {
    const entries = Object.entries(next).filter(([, m]) => m !== "grid");
    if (entries.length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    /* приватный режим — места просто не переживут перезагрузку */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function setWidgetFloatMode(id: PultWidgetId, mode: WidgetFloatMode) {
  if (modes[id] === mode) return;
  const next = { ...modes };
  if (mode === "grid") delete next[id];
  else next[id] = mode;
  commit(next);
}

function snapshot(): Partial<Record<PultWidgetId, WidgetFloatMode>> {
  return modes;
}

export function useWidgetFloatMode(id: PultWidgetId): WidgetFloatMode {
  const [state, setState] = useState<WidgetFloatMode>(() => modes[id] ?? "grid");
  useEffect(() => {
    const handler = () => setState(modes[id] ?? "grid");
    const storageHandler = () => {
      // Второе окно приложения правит тот же ключ.
      modes = read();
      setState(modes[id] ?? "grid");
    };
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, [id]);
  return state;
}

/** Все не-сеточные места разом — для плашек докстанции. */
export function useWidgetFloatModes(): Partial<Record<PultWidgetId, WidgetFloatMode>> {
  const [state, setState] = useState<Partial<Record<PultWidgetId, WidgetFloatMode>>>(snapshot);
  useEffect(() => {
    const handler = () => setState({ ...modes });
    const storageHandler = () => {
      modes = read();
      setState({ ...modes });
    };
    window.addEventListener(EVENT, handler);
    window.addEventListener("storage", storageHandler);
    return () => {
      window.removeEventListener(EVENT, handler);
      window.removeEventListener("storage", storageHandler);
    };
  }, []);
  return state;
}
