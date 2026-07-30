import type { AppState, GmUser } from "./types";

declare global {
  interface Window {
    gmApp: {
      getState: () => Promise<AppState>;
      connect: (
        serverUrl: string,
        username: string,
        password: string,
        remember: boolean
      ) => Promise<{ ok: true; user: GmUser }>;
      disconnect: () => Promise<{ ok: true }>;
      apiGet: <T = unknown>(path: string) => Promise<T>;
      apiPost: <T = unknown>(path: string, body?: unknown) => Promise<T>;
    };
  }
}

export {};
