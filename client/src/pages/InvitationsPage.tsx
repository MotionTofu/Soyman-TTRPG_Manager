import { useEffect, useState } from "react";
import { api } from "../api/client";

// Manual copy over a real deep-link/invite-token: мобил-игрок (Capacitor)
// and игрок-клиент (Electron) have no custom url scheme registered, so a
// clickable "invite link" that auto-fills the connect screen isn't possible
// yet. Instead this just surfaces every LAN address this server is
// reachable on, so the GM can copy-paste one to a player.
export function InvitationsPage() {
  const [addresses, setAddresses] = useState<string[]>([]);
  const [port, setPort] = useState<number | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ addresses: string[]; port: number }>("/app-settings/network-addresses")
      .then((r) => {
        setAddresses(r.addresses);
        setPort(r.port);
      });
  }, []);

  function copy(url: string) {
    navigator.clipboard.writeText(url).then(() => {
      setCopied(url);
      setTimeout(() => setCopied(null), 1500);
    });
  }

  return (
    <div className="stack" style={{ maxWidth: 640 }}>
      <h1>Приглашения</h1>
      <div className="card stack">
        <p className="muted">
          Скопируйте адрес и отправьте игроку — он вставит его в поле «Адрес сервера» при
          подключении в мобил-игроке или игрок-клиенте, вместе с логином и паролем, которые вы
          ему выдали (создаются в профиле игрока).
        </p>
        {addresses.length === 0 && (
          <p className="muted">
            Не удалось определить сетевой адрес этого компьютера. Убедитесь, что устройство
            подключено к той же сети, что и игроки.
          </p>
        )}
        {addresses.map((addr) => {
          const url = `http://${addr}:${port}`;
          return (
            <div key={addr} className="row" style={{ justifyContent: "space-between" }}>
              <code>{url}</code>
              <button onClick={() => copy(url)}>{copied === url ? "Скопировано ✓" : "Копировать"}</button>
            </div>
          );
        })}
      </div>
      <div className="card stack">
        <h3>Если игроков несколько</h3>
        <p className="muted">
          Один и тот же адрес сервера подходит всем — различаются только логин и пароль каждого
          игрока. Создать или сменить доступ можно в профиле игрока (раздел «Игроки»).
        </p>
      </div>
    </div>
  );
}
