import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { useResource } from "../data/hooks";
import { readResource } from "../data/imperative";
import { PageFrame } from "../components/PageFrame";
import { SectionBackground } from "../components/SectionBackground";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { NavIcon } from "../components/NavIcons";
import { Modal } from "../components/Modal";

type NetEntry = { address: string; name: string };

const ADDRESSES_PATH = "/app-settings/network-addresses";

function isValidIPv4(addr: string): boolean {
  return /^(\d{1,3}\.){3}\d{1,3}$/.test(addr) && addr.split(".").every((p) => Number(p) <= 255);
}

function badgeFor(addr: string, name: string): { label: string; kind: "ok" | "warn" | "muted" } | null {
  const lower = name.toLowerCase();
  if (addr.startsWith("169.254.")) return { label: "без сети", kind: "warn" };
  if (addr.startsWith("192.168.") || addr.startsWith("10.")) return { label: "рекомендуется", kind: "ok" };
  if (lower.includes("docker") || lower.includes("veth") || lower.includes("br-") || addr === "172.17.0.1") return { label: "виртуалка", kind: "muted" };
  if (lower.includes("virtual") || lower.includes("vbox") || lower.includes("hyper-v") || lower.includes("wsl")) return { label: "виртуалка", kind: "muted" };
  if (lower.includes("vpn") || lower.includes("tun") || lower.includes("tap")) return { label: "VPN", kind: "warn" };
  return null;
}

// Manual copy over a real deep-link/invite-token: мобил-игрок (Capacitor)
// and игрок-клиент (Electron) have no custom url scheme registered, so a
// clickable "invite link" that auto-fills the connect screen isn't possible
// yet. Instead this just surfaces every LAN address this server is
// reachable on, so the GM can copy-paste one to a player.
export function InvitationsPage() {
  const addresses = useResource<{ addresses: string[]; entries?: NetEntry[]; port: number }>(ADDRESSES_PATH);
  const loading = addresses.loading;
  const loadError = addresses.error;
  const port = addresses.data?.port ?? null;
  // Prefer typed entries (with name), fallback to legacy string[].
  const entries = useMemo(() => {
    const r = addresses.data;
    if (!r) return [];
    const rawEntries: NetEntry[] = r.entries?.length
      ? r.entries
      : (r.addresses ?? []).map((a) => ({ address: a, name: "" }));
    return rawEntries.filter((e) => isValidIPv4(e.address));
  }, [addresses.data]);
  const [refreshing, setRefreshing] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [qrModal, setQrModal] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  // «Обновить» — всегда свежим чтением: адреса меняются от сети, а не от правок.
  async function load() {
    setRefreshing(true);
    try {
      await readResource(ADDRESSES_PATH, { fresh: true });
    } catch {
      // ошибку покажет карточка загрузки
    } finally {
      setRefreshing(false);
    }
  }

  useEffect(() => {
    return () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, []);

  function buildUrl(addr: string): string | null {
    if (port == null) return null;
    const proto = typeof window !== "undefined" && window.location.protocol === "https:" ? "https:" : "http:";
    return `${proto}//${addr}:${port}`;
  }

  async function copy(url: string) {
    setCopyError(null);
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const ta = document.createElement("textarea");
        ta.value = url;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        if (!ok) throw new Error("Копирование не поддерживается — выделите адрес вручную");
      }
      setCopied(url);
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => setCopied(null), 2000);
    } catch (e) {
      setCopyError(String(e instanceof Error ? e.message : e));
    }
  }

  async function copyAll() {
    const urls = entries.map((e) => buildUrl(e.address)).filter(Boolean) as string[];
    if (!urls.length) return;
    await copy(urls.join("\n"));
  }

  async function share(url: string) {
    // Web Share API — на мобиле открывает системный шеринг (Telegram и т.д.)
    const nav = navigator as unknown as { share?: (d: { title?: string; text?: string; url?: string }) => Promise<void>; canShare?: (d: unknown) => boolean };
    if (nav.share) {
      try {
        await nav.share({ title: "SoyMan — адрес сервера", text: url, url });
        return;
      } catch (e) {
        // AbortError — пользователь закрыл шеринг, не ошибка
        if ((e as Error).name === "AbortError") return;
      }
    }
    await copy(url);
  }

  const headerStyle: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    margin: 0,
    padding: "8px 12px",
    background: "var(--surface)",
    color: "var(--on-surface)",
    borderBottom: "1px solid var(--line)",
    fontFamily: "var(--font-ui)",
    fontSize: "var(--fs-meta)",
    fontWeight: 600,
    textTransform: "uppercase",
    letterSpacing: "0.08em",
    lineHeight: 1.2,
  };

  return (
    <PageFrame
      section="invite"
      title="Приглашения"
      className="invitations-page"
      actions={
        <button onClick={() => load()} disabled={loading || refreshing}>
          {loading || refreshing ? "Обновление…" : "Обновить"}
        </button>
      }
    >
      <SectionBackground />

      {loadError && (
        <LoadErrorCard
          message={<>Не удалось загрузить адреса: {loadError}</>}
          onRetry={() => load()}
        />
      )}

      <div className="card" style={{ padding: 0, overflow: "hidden", maxWidth: "64ch", width: "100%", alignSelf: "flex-start" }}>
        <div style={headerStyle}>
          <NavIcon name="invite" />
          Адрес сервера
          {!loading && entries.length > 1 && (
            <button
              onClick={copyAll}
              style={{ marginLeft: "auto", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", height: 22, padding: "0 8px" }}
            >
              Копировать всё
            </button>
          )}
        </div>
        <div className="stack" style={{ padding: 14, gap: "var(--sp-5)" }}>
          <p className="muted" style={{ margin: 0, maxWidth: "62ch" }}>
            Скопируйте адрес и отправьте игроку — он откроет его в браузере телефона/ПК или вставит в
            поле «Адрес сервера» в мобильном приложении, вместе с логином и паролем, которые вы ему
            выдали (создаются в профиле игрока).
          </p>
          <p className="muted" style={{ margin: 0, maxWidth: "62ch", fontSize: "var(--fs-meta)" }}>
            Это адрес вашего компьютера в домашней сети (не в интернете). Порт <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", background: "var(--bg-elevated)", padding: "1px 4px", border: "1px solid var(--line)" }}>{port ?? "3001"}</code> — стандартный, его менять не нужно.
          </p>

          {loading ? (
            <ListSkeleton variant="rows" label="Загрузка адресов" />
          ) : entries.length === 0 ? (
            !loadError && (
              <EmptyState kind="error"
                title="Адрес не найден"
                hint="Проверьте, что ПК подключён к Wi-Fi/Ethernet в той же сети, что и игроки. VPN и Docker могут скрывать реальный адрес."
                action={
                  <button className="primary" onClick={() => load()}>
                    Проверить снова
                  </button>
                }
              />
            )
          ) : (
            <div className="stack" role="list" aria-label="Сетевые адреса">
              <p className="muted" style={{ margin: 0, fontSize: "var(--fs-meta)", maxWidth: "62ch" }}>
                Выберите адрес вашей Wi-Fi/Ethernet сети (обычно <code style={{ fontFamily: "var(--font-mono)" }}>192.168.x.x</code>). Виртуалки и VPN — не тот.
              </p>
              {entries.map((e) => {
                const url = buildUrl(e.address);
                if (!url) return null;
                const isCopied = copied === url;
                const badge = badgeFor(e.address, e.name);
                return (
                  <div
                    key={`${e.name}:${e.address}`}
                    role="listitem"
                    className="row"
                    style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8, alignItems: "center", borderBottom: "1px solid var(--line)", paddingBottom: 8 }}
                  >
                    <div style={{ flex: "1 1 220px", minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                      {e.name && (
                        <span style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", color: "var(--muted)", lineHeight: 1 }}>
                          {e.name} {badge && <span className={`badge ${badge.kind === "ok" ? "held" : badge.kind === "warn" ? "rescheduled" : "tag"}`} style={{ marginLeft: 6, fontSize: "var(--fs-micro)", padding: "1px 6px", verticalAlign: "middle" }}>{badge.label}</span>}
                        </span>
                      )}
                      <code
                        onClick={() => copy(url)}
                        title="Нажмите, чтобы скопировать"
                        style={{
                          display: "block",
                          fontFamily: "var(--font-mono)",
                          fontSize: "var(--fs-meta)",
                          background: isCopied ? "var(--accent-soft)" : "var(--bg-elevated)",
                          border: `1px solid ${isCopied ? "var(--accent)" : "var(--line)"}`,
                          padding: "4px 8px",
                          borderRadius: "var(--card-radius)",
                          overflowWrap: "anywhere",
                          userSelect: "all",
                          cursor: "pointer",
                        }}
                      >
                        {url}
                      </code>
                    </div>
                    <div className="row" style={{ flex: "0 0 auto", gap: 6, alignItems: "center" }}>
                      <div
                        onClick={() => setQrModal(url)}
                        title="Показать QR"
                        role="button"
                        tabIndex={0}
                        onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") setQrModal(url); }}
                        style={{
                          width: 56,
                          height: 56,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          background: "var(--paper)",
                          border: "1px solid var(--line)",
                          borderRadius: "var(--card-radius)",
                          cursor: "pointer",
                          flexShrink: 0,
                        }}
                      >
                        <QRCodeSVG value={url} size={48} level="M" bgColor="transparent" fgColor="var(--ink)" style={{ width: 48, height: 48 }} />
                      </div>
                      <div className="stack" style={{ gap: 4 }}>
                        <button
                          onClick={() => copy(url)}
                          aria-label={`Копировать адрес ${url}${e.name ? ` (${e.name})` : ""}`}
                          className={isCopied ? "primary" : undefined}
                          style={{
                            fontFamily: "var(--font-ui)",
                            fontSize: "var(--fs-micro)",
                            textTransform: "uppercase",
                            letterSpacing: "0.06em",
                            height: 26,
                            padding: "0 10px",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {isCopied ? "Скопировано ✓" : "Копировать"}
                        </button>
                        <button
                          onClick={() => setQrModal(url)}
                          aria-label={`QR для ${url}`}
                          style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", height: 22, padding: "0 8px" }}
                        >
                          QR
                        </button>
                        <button
                          onClick={() => share(url)}
                          aria-label={`Поделиться ${url}`}
                          style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", height: 22, padding: "0 8px" }}
                        >
                          Поделиться
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div aria-live="polite" aria-atomic="true">
            {copyError && <p className="muted" style={{ margin: 0, color: "var(--status-cancelled-fg)", background: "var(--status-cancelled)", padding: "6px 8px" }}>{copyError}</p>}
            {copied && !copyError && <p className="muted" style={{ margin: 0, fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)" }}>Скопировано: {copied}</p>}
          </div>

          <div className="row" style={{ justifyContent: "flex-start" }}>
            <Link to="/players" className="primary" style={{ display: "inline-flex", alignItems: "center", gap: 6, padding: "6px 12px", background: "var(--primary-bg)", color: "var(--primary-text)", border: "1px solid var(--primary-bg)", borderRadius: "var(--card-radius)", fontFamily: "var(--font-ui)", fontSize: "var(--fs-micro)", textTransform: "uppercase", letterSpacing: "0.06em", textDecoration: "none" }}>
              К игрокам — выдать доступ →
            </Link>
          </div>
        </div>
      </div>

      <details className="card stack" open style={{ gap: 8, maxWidth: "64ch", width: "100%", alignSelf: "flex-start" }}>
        <summary style={{ fontFamily: "var(--font-ui)", fontSize: "var(--fs-meta)", textTransform: "uppercase", letterSpacing: "0.06em", cursor: "pointer" }}>
          Не подключается? Чек-лист
        </summary>
        <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: "var(--fs-meta)", maxWidth: "62ch" }}>
          <li>ПК и телефон — в одной Wi-Fi сети (не «гостевая» vs «основная», не 2.4 vs 5 ГГц изоляция).</li>
          <li>Разрешите <code style={{ fontFamily: "var(--font-mono)" }}>SoyMan</code> в брандмауэре Windows (порт {port ?? 3001}).</li>
          <li>Отключите VPN на обеих сторонах на время проверки.</li>
          <li>На самом ПК откройте <code style={{ fontFamily: "var(--font-mono)" }}>http://localhost:{port ?? 3001}</code> — если не открывается, перезапустите приложение.</li>
          <li>Попробуйте другой адрес из списка выше (не Docker/VirtualBox).</li>
        </ul>
      </details>

      {qrModal && (
        <Modal onClose={() => setQrModal(null)}>
          <div className="stack" style={{ alignItems: "center", textAlign: "center", gap: 12 }}>
            <h3 style={{ margin: 0, fontFamily: "var(--font-display)", fontSize: "var(--fs-h3)" }}>Сканируйте камерой телефона</h3>
            <div style={{ background: "white", padding: 12, border: "1px solid var(--line)" }}>
              <QRCodeSVG value={qrModal} size={220} level="M" />
            </div>
            <code style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-meta)", background: "var(--bg-elevated)", padding: "4px 8px", border: "1px solid var(--line)", overflowWrap: "anywhere" }}>{qrModal}</code>
            <div className="row">
              <button className="primary" onClick={() => copy(qrModal)}>Копировать</button>
              <button onClick={() => setQrModal(null)}>Закрыть</button>
            </div>
          </div>
        </Modal>
      )}
    </PageFrame>
  );
}
