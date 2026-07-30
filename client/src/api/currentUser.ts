import { useEffect, useState } from "react";
import { api, getAuthToken } from "./client";

export interface CurrentUser {
  id: number;
  username: string;
  role: "gm" | "player";
  playerId: number | null;
  isAdmin: boolean;
}

// Fetched once per page load and shared by every consumer — role decides
// which navigation/pages render (see AppShell), so it must not be re-fetched
// per component. A token change always goes through window.location.reload()
// (LoginScreen / logout), which naturally resets this cache.
let cached: CurrentUser | null = null;
let inflight: Promise<CurrentUser | null> | null = null;

export function fetchCurrentUser(): Promise<CurrentUser | null> {
  if (cached) return Promise.resolve(cached);
  if (!getAuthToken()) return Promise.resolve(null);
  if (!inflight) {
    inflight = api
      .get<CurrentUser>("/auth/me")
      .then((user) => {
        cached = user;
        return user;
      })
      .catch(() => null);
  }
  return inflight;
}

export function useCurrentUser(): { user: CurrentUser | null; loading: boolean } {
  const [user, setUser] = useState<CurrentUser | null>(cached);
  const [loading, setLoading] = useState(!cached);

  useEffect(() => {
    if (cached) return;
    let alive = true;
    fetchCurrentUser().then((u) => {
      if (!alive) return;
      setUser(u);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  return { user, loading };
}
