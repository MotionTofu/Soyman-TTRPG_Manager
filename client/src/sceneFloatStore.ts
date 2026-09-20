import { useEffect, useState } from "react";

// Где живёт блок сцен пульта: в сетке, в плавающем окне или плашкой внизу
// докстанции. Общее для SceneSwitcher (сетка и окно) и PreviewDock (плашка) —
// они в разных ветках дерева, без общих пропсов через AppShell, поэтому стор
// тем же приёмом, что previewDockStore: модуль + событие.
//
// Переживает перезагрузку: ключ тот же, что у старого флага-«1»
// (rpgManagerScenesDetached), значение «1» читается как float.
export type SceneBlockMode = "grid" | "float" | "dock";

const KEY = "rpgManagerScenesDetached";
const EVENT = "scenes-place-changed";

function read(): SceneBlockMode {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === "float" || raw === "dock" || raw === "1") return raw === "dock" ? "dock" : "float";
    return "grid";
  } catch {
    return "grid";
  }
}

let mode: SceneBlockMode = read();

function commit(next: SceneBlockMode) {
  mode = next;
  try {
    if (next === "grid") localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* приватный режим — место просто не переживёт перезагрузку */
  }
  window.dispatchEvent(new Event(EVENT));
}

export function setSceneBlockMode(next: SceneBlockMode) {
  if (mode !== next) commit(next);
}

export function useSceneBlockMode(): SceneBlockMode {
  const [state, setState] = useState(mode);
  useEffect(() => {
    const handler = () => setState(mode);
    const storageHandler = () => {
      // Второе окно приложения правит тот же ключ.
      mode = read();
      setState(mode);
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
