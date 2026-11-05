import { useEffect, useRef, useState } from "react";
import { Modal } from "./Modal";
import { useAfterWrite, useResource, write } from "../data/hooks";
import { attemptWithNotice } from "../data/notices";
import "./WebInbox.css";

// Настройки → «Расширение браузера» (макет Web-Pair, гриллинг 2026-11-05 Q4, Q8):
// как установить, код для подключения, список подключённых браузеров.

type Key = { id: string; label: string; created_at: string; last_seen_at: string | null };
const KEYS_PATH = "/web-capture/keys";

function date(iso: string | null): string {
  if (!iso) return "—";
  // SQLite отдаёт «2026-11-05 12:40:00» без зоны — это UTC.
  const d = new Date(/[zZ+]/.test(iso.slice(10)) ? iso : `${iso.replace(" ", "T")}Z`);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("ru-RU");
}

export function WebCaptureSettings() {
  const afterWrite = useAfterWrite();
  const keys = useResource<Key[]>(KEYS_PATH).data ?? [];
  const dir = useResource<{ path: string }>("/web-capture/extension-dir").data?.path ?? "";
  const electron = typeof window !== "undefined" ? window.electronAPI : undefined;
  const [pairing, setPairing] = useState(false);

  async function disconnect(key: Key) {
    if (await attemptWithNotice("Расширение не отключено", () => write.del(`${KEYS_PATH}/${key.id}`))) {
      afterWrite([{ path: KEYS_PATH }]);
    }
  }

  return <div className="card res-group web-capture-settings" style={{ padding: 16 }}>
    <h2 className="d-plate">Расширение браузера</h2>
    <p className="muted" style={{ maxWidth: "64ch" }}>
      Выделяете текст на любом сайте → ПКМ → «Во входящие SoyMan». Фрагмент попадает во Входящие Мешка,
      оттуда — в новую сущность вместе с источником. Пока только Chrome, Edge, Яндекс и другие браузеры на Chromium.
    </p>
    <ol className="web-capture-settings__steps">
      <li>
        <span>Установить: в браузере открыть <code>chrome://extensions</code>, включить «Режим разработчика»,
          нажать «Загрузить распакованное» и выбрать папку расширения.</span>
        {dir && <span className="web-capture-settings__dir">
          <code>{dir}</code>
          {electron
            ? <button type="button" className="d-btn d-btn--sm" onClick={() => void electron.openPath(dir)}>Открыть папку</button>
            : <button type="button" className="d-btn d-btn--sm" onClick={() => void navigator.clipboard?.writeText(dir)}>Копировать путь</button>}
        </span>}
      </li>
      <li><span>Подключить: кнопка ниже покажет код, его вставляют в окошко расширения (значок SoyMan на панели браузера).</span></li>
    </ol>
    <div><button type="button" className="d-btn" onClick={() => setPairing(true)}>Подключить расширение</button></div>
    {keys.length > 0 && <>
      <h3 className="d-plate" style={{ marginTop: 24 }}>Подключены</h3>
      <ul className="web-capture-settings__keys">
        {keys.map((key) => <li key={key.id}>
          <b>{key.label}</b>
          <span className="d-mono">с {date(key.created_at)} · был {date(key.last_seen_at)}</span>
          <button type="button" className="d-btn d-btn--sm" onClick={() => void disconnect(key)}>Отключить</button>
        </li>)}
      </ul>
    </>}
    {pairing && <PairingCode knownKeys={keys.length} onClose={() => setPairing(false)} />}
  </div>;
}

function PairingCode({ knownKeys, onClose }: { knownKeys: number; onClose: () => void }) {
  const afterWrite = useAfterWrite();
  const [code, setCode] = useState<{ code: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  // Ждём новое подключение: окно закрывается само, когда расширение обменяло код.
  const keys = useResource<Key[]>(code ? KEYS_PATH : null, { pollMs: 2000 }).data;
  const startKeys = useRef(knownKeys);

  useEffect(() => {
    let alive = true;
    write.post<{ code: string; expiresAt: string }>("/web-capture/pairings").then(
      (c) => { if (alive) setCode(c); },
      (e: unknown) => { if (alive) setError(e instanceof Error ? e.message : "Код не выдан"); });
    return () => { alive = false; };
  }, []);
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => {
    if (keys && keys.length > startKeys.current) {
      afterWrite([{ path: KEYS_PATH }]);
      onClose();
    }
  }, [keys, afterWrite, onClose]);

  const left = code ? Math.max(0, Date.parse(code.expiresAt) - now) : 0;
  const mmss = `${Math.floor(left / 60000)}:${String(Math.floor((left % 60000) / 1000)).padStart(2, "0")}`;

  return <Modal onClose={onClose} ariaLabel="Код для расширения">
    <h2>Код для расширения</h2>
    {error ? <p role="alert">{error}</p> : <>
      <div className="web-capture-code" aria-live="polite">{code?.code ?? "…"}</div>
      <p className="web-capture-code__ttl d-mono">{left > 0 ? `действует ${mmss} · один раз` : code ? "код истёк — закройте окно и возьмите новый" : ""}</p>
      <p>Вставьте его в окошко расширения: значок SoyMan на панели браузера → «Подключить». Окно закроется само.</p>
    </>}
    <div className="modal-footer row"><button type="button" onClick={onClose}>Закрыть</button></div>
  </Modal>;
}
