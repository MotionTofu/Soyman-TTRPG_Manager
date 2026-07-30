import { useEffect, useState, type FormEvent } from "react";
import { setAuthToken } from "../api/client";

// Shown whenever there's no valid token (see LoginGate.tsx) — auth is always
// on now, including the local desktop app. On a fresh install with no GM
// account yet, /api/auth/status reports needsSetup and this renders a
// one-time "create GM account" form instead of a login no one could pass.
export function LoginScreen() {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  useEffect(() => {
    fetch("/api/auth/status")
      .then((res) => res.json())
      .then((data) => setNeedsSetup(!!data.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, []);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (needsSetup && password !== password2) {
      setError("Пароли не совпадают");
      return;
    }
    setConnecting(true);
    setError("");
    try {
      const res = await fetch(needsSetup ? "/api/auth/setup" : "/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Не удалось войти");
      setAuthToken(data.token);
      // Full reload instead of trying to make every already-mounted page
      // retry its failed (401'd) fetch — simplest way to get a clean slate
      // under the new token, matches how "Переключить хранилище" reloads too.
      window.location.reload();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  }

  if (needsSetup === null) {
    return (
      <div className="app-body" style={{ paddingTop: 80 }}>
        <p className="muted" style={{ textAlign: "center" }}>Загрузка…</p>
      </div>
    );
  }

  return (
    <div className="app-body" style={{ paddingTop: 80 }}>
      <form className="stack card" onSubmit={handleSubmit} style={{ maxWidth: 380, margin: "0 auto" }}>
        <h2 style={{ margin: 0 }}>{needsSetup ? "Первый запуск" : "Вход на сервер"}</h2>
        {needsSetup && (
          <p className="muted" style={{ margin: 0 }}>
            Создайте аккаунт мастера — под ним вы будете входить в приложение. Аккаунты игроков создаются позже, в
            профиле игрока.
          </p>
        )}
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Логин</span>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </label>
        <label className="stack" style={{ gap: 4 }}>
          <span className="muted">Пароль</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        {needsSetup && (
          <label className="stack" style={{ gap: 4 }}>
            <span className="muted">Пароль ещё раз</span>
            <input type="password" value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </label>
        )}
        {error && <p className="error">{error}</p>}
        <button className="primary" type="submit" disabled={connecting || !username || !password}>
          {connecting ? "…" : needsSetup ? "Создать и войти" : "Войти"}
        </button>
      </form>
    </div>
  );
}
