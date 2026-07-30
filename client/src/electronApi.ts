export interface ElectronAPI {
  pickFolder: () => Promise<string | null>;
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
