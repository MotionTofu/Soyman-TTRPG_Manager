import { useEffect, useState, type FormEvent } from "react";
import { setAuthToken } from "../api/client";
import { brandLogo } from "../brandLogo";
import { ParticleField } from "./ParticleField";
import { SoyManResponsive } from "./SoyMan";
import { Loading } from "./Loading";
import { setCachedUser } from "../api/currentUser";

// Shown whenever there's no valid token (see LoginGate.tsx) — auth is always
// on now, including the local desktop app. On a fresh install with no GM
// account yet, /api/auth/status reports needsSetup and this renders a
// one-time "create GM account" form instead of a login no one could pass.
export function LoginScreen({ onAuthenticated }: { onAuthenticated?: () => void }) {
  const [needsSetup, setNeedsSetup] = useState<boolean | null>(null);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [password2, setPassword2] = useState("");
  const [showPass, setShowPass] = useState(false);
  const [showPass2, setShowPass2] = useState(false);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);

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
    if (!username.trim() || !password) {
      setError("Заполни логин и пароль");
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
      if (data.user) setCachedUser(data.user);
      if (needsSetup) {
        try { sessionStorage.setItem("justCreated", data.user?.username || "1"); } catch {}
      }
      if (onAuthenticated) {
        onAuthenticated();
      } else {
        window.location.reload();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setConnecting(false);
    }
  }

  if (needsSetup === null) {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", backgroundImage: "var(--page-texture)", position: "relative", overflow: "hidden", padding: 16 }}>
        <ParticleField count={8} className="header-particles" />
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <img src={brandLogo} alt="SoyMan" style={{ width: 180, maxWidth: "60vw", opacity: 0.9 }} />
          {/* Баннер и маскот уживаются: баннер — леттеринг, маскот — лицо (гайд §28). */}
          <Loading />
        </div>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "var(--paper)", backgroundImage: "var(--page-texture)", position: "relative", overflow: "hidden", padding: 16 }}>
      <ParticleField count={8} className="header-particles" />
      {/* Маскот встречает над карточкой, а не внутри неё: в шапке уже есть
          баннер и заголовок, и третий предмет туда не влезает. */}
      <div style={{ position: "relative", zIndex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 12, width: "100%" }}>
      <SoyManResponsive state="idle" size="lg" decorative />
      <form onSubmit={handleSubmit} className="card" style={{ maxWidth: 440, width: "100%", padding: 0, overflow: "hidden", position: "relative", zIndex: 1 }}>
        {/* Шапка-инверсия §1.4 */}
        <div style={{ background: "var(--surface)", color: "var(--on-surface)", padding: "14px 20px", borderBottom: "1px solid var(--line)", display: "flex", flexDirection: "column", gap: 6 }}>
          <img src={brandLogo} alt="SoyMan — TTRPG Manager" style={{ width: 140, maxWidth: "50%", filter: needsSetup ? undefined : "none", opacity: 0.98 }} />
          <h1 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--fs-h2)", lineHeight: 0.96, textTransform: "uppercase", letterSpacing: "-0.01em", color: "var(--on-surface)" }}>{needsSetup ? "Первый запуск" : "Вход на сервер"}</h1>
          <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--on-surface-muted)", lineHeight: 1.2 }}>{needsSetup ? "Создай аккаунт мастера — локально, офлайн" : "Войди под аккаунтом мастера или игрока"}</span>
        </div>

        <div className="stack" style={{ padding: "18px 20px", gap: 14, background: "var(--paper-2)", backgroundImage: "var(--card-body-texture)" }}>
          {needsSetup ? (
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)", lineHeight: 1.35, maxWidth: "62ch" }}>
              Аккаунт хранится <strong style={{ color: "var(--ink)" }}>локально на этом компьютере</strong> — в папке <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>RPG-Vault</span>. Без облака и интернета. Аккаунты игроков создашь позже в «Игроки».
            </p>
          ) : (
            <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)", lineHeight: 1.35 }}>
              Войди под логином мастера или игрока. Пароль хранится локально, сброс — через удаление <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>app.db</span> (см. Справку).
            </p>
          )}

          <label className="stack" style={{ gap: 4 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--muted)" }}>Логин</span>
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              autoComplete={needsSetup ? "username" : "username"}
              placeholder={needsSetup ? "например, Мастер" : "твой логин"}
              style={{ fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)" }}
            />
          </label>

          <label className="stack" style={{ gap: 4 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--muted)" }}>Пароль</span>
            <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
              <input
                type={showPass ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={needsSetup ? "new-password" : "current-password"}
                placeholder="не короче 4 символов"
                style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", paddingRight: 72 }}
              />
              <button type="button" onClick={() => setShowPass((v) => !v)} tabIndex={-1} style={{ position: "absolute", right: 4, height: 26, padding: "0 8px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                {showPass ? "Скрыть" : "Показать"}
              </button>
            </span>
          </label>

          {needsSetup && (
            <label className="stack" style={{ gap: 4 }}>
              <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.10em", color: "var(--muted)" }}>Пароль ещё раз</span>
              <span style={{ position: "relative", display: "flex", alignItems: "center" }}>
                <input
                  type={showPass2 ? "text" : "password"}
                  value={password2}
                  onChange={(e) => setPassword2(e.target.value)}
                  autoComplete="new-password"
                  style={{ flex: 1, fontFamily: "var(--font-body)", fontSize: "var(--fs-meta)", paddingRight: 72 }}
                />
                <button type="button" onClick={() => setShowPass2((v) => !v)} tabIndex={-1} style={{ position: "absolute", right: 4, height: 26, padding: "0 8px", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {showPass2 ? "Скрыть" : "Показать"}
                </button>
              </span>
            </label>
          )}

          {error && <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", background: "var(--paper)", color: "var(--status-cancelled-fg)", padding: "8px 10px", fontSize: "var(--fs-meta)" }}>{error}</div>}

          <button className="primary" type="submit" disabled={connecting || !username.trim() || !password} style={{ width: "100%", justifyContent: "center", fontFamily: "var(--font-ui)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
            {connecting ? "…" : needsSetup ? "Создать и войти" : "Войти"}
          </button>

          <div style={{ borderTop: "1px solid var(--line)", paddingTop: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.08em", color: "var(--muted)" }}>Где хранятся данные?</span>
            <span className="muted" style={{ fontSize: "var(--fs-meta)", lineHeight: 1.35 }}>
              Локально, офлайн. Папка хранилища по умолчанию — <span style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>%APPDATA%/RPG-Vault</span>. Переключишь в Настройки → Хранилище. Бэкап — там же, кнопка «Бэкап» в навигации.
            </span>
            <button type="button" onClick={() => setAboutOpen((v) => !v)} style={{ alignSelf: "flex-start", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", background: "transparent", border: "1px solid var(--line)", padding: "4px 8px" }}>
              {aboutOpen ? "Скрыть подробности" : "Подробнее — Справка"}
            </button>
            {aboutOpen && (
              <div className="card" style={{ background: "var(--paper)", border: "1px solid var(--line)", fontSize: "var(--fs-meta)", lineHeight: 1.4 }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <span><strong>Офлайн-first:</strong> сервер — твой же компьютер (Electron, порт 4732). Без интернета всё работает.</span>
                  <span><strong>Забыл пароль:</strong> удали <span style={{ fontFamily: "var(--font-mono)" }}>app.db</span> в папке данных или попроси админа сбросить — хеш <span style={{ fontFamily: "var(--font-mono)" }}>bcrypt</span>, восстановления письмом нет.</span>
                  <span><strong>Игроки:</strong> создаются после входа, в «Игроки» → «Создать логин».</span>
                </div>
              </div>
            )}
          </div>
        </div>
      </form>
      </div>
    </div>
  );
}
