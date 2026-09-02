import { useEffect, useState, type ReactNode } from "react";
import { setUnauthorizedHandler } from "../api/client";
import { loadMentionIndex } from "../mentions";
import { LoginScreen } from "./LoginScreen";
import { clearCachedUser, fetchCurrentUser } from "../api/currentUser";

// Wraps the whole routed app. Auth is always on: any 401 (no token yet, or
// an expired/invalid one) flips this into a full-screen login form — which
// itself becomes a one-time "create GM account" form on a fresh install
// (see LoginScreen.tsx).
export function LoginGate({ children }: { children: ReactNode }) {
  const [needsLogin, setNeedsLogin] = useState(false);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      clearCachedUser();
      setNeedsLogin(true);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Карта глобальных ключей: по ней ссылки в текстах узнают, куда ведут и
  // ведут ли вообще (mentions.ts). Грузится здесь, а не в main.tsx, потому что
  // запрос требует токена — до входа он вернул бы 401.
  useEffect(() => {
    if (needsLogin) return;
    // Игроку этот запрос отвечает 403 (ролевой гейт), поэтому карта грузится
    // только мастеру; у игрока подписи упоминаний — обычный текст
    // (components/mentions/MentionText.tsx).
    void fetchCurrentUser().then((u) => {
      if (u && u.role !== "player") void loadMentionIndex();
    });
  }, [needsLogin]);

  if (needsLogin) return <LoginScreen onAuthenticated={() => setNeedsLogin(false)} />;
  return <>{children}</>;
}
