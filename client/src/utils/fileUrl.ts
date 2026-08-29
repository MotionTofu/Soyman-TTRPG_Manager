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
    if (blobCache.has(clean)) {
      setUrl(blobCache.get(clean)!);
      return;
    }
    const token = getAuthToken();
    if (!token) {
      setUrl(null);
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
        blobCache.set(clean, objectUrl);
        setUrl(objectUrl);
      })
      .catch(() => {
        if (!cancelled) setUrl(null);
      });
    return () => {
      cancelled = true;
      controller.abort();
      // Не revoke если в кэше — кэш держит URL для переиспользования
      if (objectUrl && !blobCache.has(clean)) URL.revokeObjectURL(objectUrl);
    };
  }, [path]);

  return url;
}
