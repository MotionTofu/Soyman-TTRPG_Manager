import { useState, type FormEvent } from "react";

interface Props {
  defaultServerUrl: string;
  defaultUsername: string;
  defaultPassword: string;
  onConnected: () => void;
}

export function ConnectScreen({ defaultServerUrl, defaultUsername, defaultPassword, onConnected }: Props) {
  const [serverUrl, setServerUrl] = useState(defaultServerUrl || "https://");
  const [username, setUsername] = useState(defaultUsername);
  const [password, setPassword] = useState(defaultPassword);
  const [remember, setRemember] = useState(!!defaultPassword);
  const [error, setError] = useState("");
  const [connecting, setConnecting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setConnecting(true);
    setError("");
    try {
      await window.gmApp.connect(serverUrl.trim(), username.trim(), password, remember);
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setConnecting(false);
    }
  }

  return (
    <form className="stack card" onSubmit={handleSubmit} style={{ maxWidth: 380, margin: "0 auto" }}>
      <h2 style={{ margin: 0 }}>Подключение к серверу</h2>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">Адрес сервера</span>
        <input
          value={serverUrl}
          onChange={(e) => setServerUrl(e.target.value)}
          placeholder="https://example.com"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </label>
      <label className="stack" style={{ gap: 4 }}>
        <span className="muted">Логин (мастерский аккаунт)</span>
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
      <label className="row" style={{ gap: 6 }}>
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Запомнить пароль
      </label>
      {error && <p className="error">{error}</p>}
      <button className="primary" type="submit" disabled={connecting || !serverUrl || !username || !password}>
        {connecting ? "Подключение…" : "Войти"}
      </button>
    </form>
  );
}
