export interface UpdateStatus {
  status: "checking" | "available" | "not-available" | "downloading" | "downloaded" | "error";
  version?: string;
  percent?: number;
  message?: string;
}

export interface ElectronAPI {
  pickFolder: () => Promise<string | null>;
  pickSaveFile: (defaultPath?: string) => Promise<string | null>;
  getAppVersion: () => Promise<string>;
  checkForUpdates: () => Promise<{ ok: boolean; reason?: string }>;
  quitAndInstall: () => Promise<void>;
  onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
  /** Вернуть клавиатурный фокус странице — см. installNativeDialogFocusFix. */
  restoreFocus: () => void;
  /** Открыть ещё одно окно приложения на указанном маршруте. */
  openWindow: (route: string) => void;
  /** Открыть внешний URL в браузере пользователя по умолчанию (shell.openExternal). */
  openExternal: (url: string) => void;
  /** Открыть Telegram автора: сначала установленный клиент (tg://), фолбэк — браузер. */
  openTelegram: () => void;
  /** Показать папку в проводнике / открыть путь — только безопасные абсолютные пути. */
  showInExplorer: (folderPath: string) => Promise<{ ok: boolean; error?: string }>;
  openPath: (targetPath: string) => Promise<{ ok: boolean; error?: string }>;
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
function isSafeRoute(route: string): boolean {
  return route.startsWith("/") && !route.startsWith("//") && !route.includes("..") && !route.includes("\\") && !route.toLowerCase().startsWith("javascript:");
}
function isSafeAbsolutePath(p: string): boolean {
  if (!p || typeof p !== "string" || p.includes("\0") || p.length > 1024) return false;
  if (p.includes("..")) return false;
  // Windows абсолютный: C:\ или C:/ или \\server\share
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  if (p.startsWith("\\\\")) return false; // UNC — не открываем из настроек (просит сеть)
  if (p.startsWith("/") || p.startsWith("\\")) return true;
  return false;
}
export function isPathSafeForExplorer(p: string): boolean { return isSafeAbsolutePath(p); }
export function openSecondWindow(route: string = window.location.pathname + window.location.search): void {
  const safe = isSafeRoute(route) ? route : "/";
  if (window.electronAPI?.openWindow) {
    window.electronAPI.openWindow(safe);
    return;
  }
  window.open(safe, "_blank", "noopener,width=1400,height=900");
}

/**
 * Открыть внешнюю ссылку в браузере пользователя по умолчанию. В собранном
 * приложении это ipc "open-external" → shell.openExternal (electron/main.js);
 * в браузере во время разработки — обычное новое окно. Отдельный канал нужен,
 * чтобы ссылка не открылась новым окном Electron вместо системного браузера.
 */
export function openExternalLink(url: string): void {
  if (!/^https?:\/\//i.test(url)) return;
  if (window.electronAPI?.openExternal) {
    window.electronAPI.openExternal(url);
    return;
  }
  window.open(url, "_blank", "noopener");
}

/**
 * Открыть Telegram автора. В приложении приоритет у установленного клиента:
 * ipc "open-telegram" сначала пробует глубокую ссылку tg:// и только если
 * Telegram не установлен, открывает t.me уже в браузере (см. electron/main.js).
 * В браузере во время разработки глубокая ссылка обычно блокируется и толку
 * от неё нет — открываем сразу t.me: страница сама перекинет в приложение,
 * если оно стоит.
 */
export function openTelegramLink(): void {
  if (window.electronAPI?.openTelegram) {
    window.electronAPI.openTelegram();
    return;
  }
  window.open("https://t.me/brothertofu", "_blank", "noopener");
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
