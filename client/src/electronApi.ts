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
