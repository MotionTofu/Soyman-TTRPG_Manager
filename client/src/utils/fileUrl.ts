import { useEffect, useState } from "react";
import { getAuthToken } from "../api/client";

const blobCache = new Map<string, string>();

/**
 * Загружает /files/... через Authorization header и отдаёт blob URL.
 * Позволяет не светить ?token= в адресе <img>/backgroundImage.
 * Для остальных файлов (пока не переведены) остаётся withFileTokens fallback.
 */
export function useAuthenticatedFileUrl(path: string | null | undefined): string | null {
  const [url, setUrl] = useState<string | null>(null);
  const [tokenTick, setTokenTick] = useState(0);
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === "rpgManagerAuthToken") setTokenTick((t) => t + 1); };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  useEffect(() => {
    if (!path) {
      setUrl(null);
      return;
    }
    const clean = path.split("?")[0];
    if (!clean.startsWith("/files/")) {
      setUrl(null);
      return;
    }
    const token = getAuthToken();
    if (!token) {
      // Токен сброшен в другом окне — чистим кэш, иначе blob останется доступен после логаута
      blobCache.forEach((u) => URL.revokeObjectURL(u));
      blobCache.clear();
      setUrl(null);
      return;
    }
    if (blobCache.has(clean)) {
      setUrl(blobCache.get(clean)!);
      return;
    }
    const controller = new AbortController();
    let objectUrl: string | null = null;
    let cancelled = false;
    fetch(clean, { headers: { Authorization: `Bearer ${token}` }, signal: controller.signal })
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.blob();
      })
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        // LRU 20 — не копим гигабайты
        if (blobCache.size >= 20) {
          const firstKey = blobCache.keys().next().value as string;
          const old = blobCache.get(firstKey);
          if (old) URL.revokeObjectURL(old);
          blobCache.delete(firstKey);
        }
        blobCache.set(clean, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
      if (objectUrl && !blobCache.has(clean)) URL.revokeObjectURL(objectUrl);
    };
  }, [path, tokenTick]);

  return url;
}
