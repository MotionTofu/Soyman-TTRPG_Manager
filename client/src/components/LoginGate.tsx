import { useEffect, useState, type ReactNode } from "react";
import { setUnauthorizedHandler } from "../api/client";
import { LoginScreen } from "./LoginScreen";

// Wraps the whole routed app. Auth is always on: any 401 (no token yet, or
// an expired/invalid one) flips this into a full-screen login form — which
// itself becomes a one-time "create GM account" form on a fresh install
// (see LoginScreen.tsx).
export function LoginGate({ children }: { children: ReactNode }) {
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => setNeedsLogin(true));
    return () => setUnauthorizedHandler(null);
  }, []);

  if (needsLogin) return <LoginScreen />;
  return <>{children}</>;
}
