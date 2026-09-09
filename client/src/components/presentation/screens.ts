// Выбор монитора для окна показа и открытие окна сразу на нём.
//
// window.getScreenDetails (Chromium — десктопное Electron-приложение и
// Chrome/Edge) отдаёт список экранов с координатами; окно открываем
// window.open с left/top/width/height chosen-экрана — таскать руками не
// надо. Нет API или отказано в доступе — обычное окно, как раньше.
// Последний выбор запоминается (localStorage), повторный показ — в один клик.

export interface ScreenChoice {
  id: string;
  label: string;
  left: number;
  top: number;
  width: number;
  height: number;
  primary: boolean;
}

interface ScreenDetailsScreen {
  availLeft: number;
  availTop: number;
  availWidth: number;
  availHeight: number;
  label: string;
  primary: boolean;
}

const LAST_KEY = "presentation-screen-id";

export async function getScreens(): Promise<ScreenChoice[]> {
  try {
    const w = window as unknown as { getScreenDetails?: () => Promise<{ screens: ScreenDetailsScreen[] }> };
    const details = await w.getScreenDetails?.();
    const list = details?.screens ?? [];
    if (list.length > 0) {
      return list.map((s, i) => ({
        id: `screen-${i}`,
        label: s.label || (s.primary ? "Основной экран" : `Экран ${i + 1}`),
        left: s.availLeft,
        top: s.availTop,
        width: s.availWidth,
        height: s.availHeight,
        primary: s.primary,
      }));
    }
  } catch {
    /* отказано или не Chromium — fallback ниже */
  }
  return [
    {
      id: "primary",
      label: "Основной экран",
      left: 0,
      top: 0,
      width: window.screen.availWidth,
      height: window.screen.availHeight,
      primary: true,
    },
  ];
}

export function loadLastScreenId(): string | null {
  try {
    return localStorage.getItem(LAST_KEY);
  } catch {
    return null;
  }
}

export function openOnScreen(url: string, target: string, screen: ScreenChoice | null): Window | null {
  if (!screen || screen.id === "primary-fallback") {
    return window.open(url, target, "width=960,height=600");
  }
  const features = [
    `left=${Math.round(screen.left)}`,
    `top=${Math.round(screen.top)}`,
    `width=${Math.round(screen.width)}`,
    `height=${Math.round(screen.height)}`,
    "menubar=no",
    "toolbar=no",
    "location=no",
    "status=no",
  ].join(",");
  const win = window.open(url, target, features);
  if (win) {
    try {
      localStorage.setItem(LAST_KEY, screen.id);
    } catch {}
  }
  return win;
}
