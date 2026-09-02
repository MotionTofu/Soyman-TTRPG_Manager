import { useCallback, useEffect, useState } from "react";
import { useCurrentUser } from "../api/currentUser";

export type CompendiumViewMode = "grid" | "list";

function legacyKey(sectionId: number): string {
  return `compendium-equip-view-${sectionId}`;
}

function keyFor(userId: number | string, sectionId: number): string {
  return `compendium-view-${userId}-${sectionId}`;
}

export function useCompendiumViewMode(sectionId: number, defaultMode: CompendiumViewMode = "grid"): [CompendiumViewMode, (m: CompendiumViewMode) => void] {
  const { user } = useCurrentUser();
  const userId = user?.id ?? "anon";

  const [mode, setMode] = useState<CompendiumViewMode>(() => {
    // Миграция: старый ключ снаряжения → новый общий
    const legacy = localStorage.getItem(legacyKey(sectionId));
    if (legacy === "grid" || legacy === "list") return legacy;
    const k = keyFor(userId, sectionId);
    const raw = localStorage.getItem(k);
    return raw === "grid" || raw === "list" ? raw : defaultMode;
  });

  // Подхват после загрузки пользователя + миграция legacy
  useEffect(() => {
    const legacy = localStorage.getItem(legacyKey(sectionId));
    const k = keyFor(userId, sectionId);
    if (legacy && !localStorage.getItem(k) && (legacy === "grid" || legacy === "list")) {
      try { localStorage.setItem(k, legacy); } catch {}
      setMode(legacy);
      return;
    }
    const raw = localStorage.getItem(k);
    if (raw === "grid" || raw === "list") setMode(raw as CompendiumViewMode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, sectionId]);

  const set = useCallback((m: CompendiumViewMode) => {
    setMode(m);
    try { localStorage.setItem(keyFor(userId, sectionId), m); } catch {}
    // Совместимость: старый ключ держим в синхроне для снаряжения
    try { localStorage.setItem(legacyKey(sectionId), m); } catch {}
  }, [userId, sectionId]);

  return [mode, set];
}
