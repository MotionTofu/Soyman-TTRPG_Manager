export interface UpdateStatus {
  status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  message?: string;
}

export interface ElectronAPI {
  pickFolder: () => Promise<string | null>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
  quitAndInstall: () => Promise<void>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  /** Вернуть клавиатурный фокус странице — см. installNativeDialogFocusFix. */
  restoreFocus: () => void;
  /** Открыть ещё одно окно приложения на указанном маршруте. */
  openWindow: (route: string) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
  }
}

// The app also runs as a plain browser tab during development (this preview)
// — window.electronAPI only exists inside the packaged Electron shell, where
// electron/preload.js exposes it.
export function hasElectronAPI(): boolean {
  return typeof window !== "undefined" && !!window.electronAPI;
}

/**
 * Открыть текущую страницу вторым окном: в приложении это настоящее окно
 * Electron, в браузере — обычное новое окно. Оба варианта смотрят в один
 * сервер и одну базу, а «Мешок» у них общий (см. bag.ts), поэтому сущность
 * можно взять в одном окне и перетащить в другом.
 */
export function openSecondWindow(route: string = window.location.pathname + window.location.search): void {
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow(route);
    return;
  }
  window.open(route, "_blank", "noopener,width=1400,height=900");
}

/**
 * Возвращает фокус странице после нативного диалога.
 *
 * В браузере всё в порядке, а в собранном приложении после `confirm()` (а он
 * стоит перед каждым удалением) страница переставала принимать ввод: щёлкаешь
 * в поле, курсор стоит, а буквы не появляются. Помогало только переключиться
 * на другое окно и обратно — то есть фокус терял не документ, а само окно.
 * Windows отдаёт фокус нативному диалогу и после его закрытия не возвращает
 * его webContents; Electron про это знает, но чинить в себе не стал.
 *
 * Поэтому окно фокусируется вручную сразу после того, как диалог ответил.
 * Патч ставится на window.confirm/alert/prompt, а не на каждый из девяноста
 * вызовов: место, где ломается, ровно одно, и оно здесь.
 */
export function installNativeDialogFocusFix(): void {
  const api = window.electronAPI;
  if (!api?.restoreFocus) return;

  const original = {
    confirm: window.confirm.bind(window),
    alert: window.alert.bind(window),
    prompt: window.prompt.bind(window),
  };
  // Фокус возвращается после того, как диалог действительно закрылся: пока мы
  // внутри синхронного вызова, окно ещё занято им.
  const restore = () => setTimeout(() => api.restoreFocus(), 0);

  window.confirm = (message?: string) => {
    const answer = original.confirm(message);
    restore();
    return answer;
  };
  window.alert = (message?: unknown) => {
    original.alert(message);
    restore();
  };
  window.prompt = (message?: string, defaultValue?: string) => {
    const answer = original.prompt(message, defaultValue);
    restore();
    return answer;
  };
}
