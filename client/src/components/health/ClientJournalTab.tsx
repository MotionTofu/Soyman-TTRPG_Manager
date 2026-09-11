import { write, useAction, useResource } from "../../data/hooks";
import { EmptyState } from "../EmptyState";

/**
 * Вкладка «Журнал» на странице «Здоровье» (docs/adr/0001, п. 6).
 *
 * Запросы дольше секунды и ошибки со всех устройств — мастера и игроков.
 * Затевалось, чтобы жалобу «зависает, много где» можно было проверить числами:
 * какой экран, какое действие, сколько шло, что ответил сервер.
 */

interface JournalRow {
  id: number;
  created_at: string;
  occurred_at: string | null;
  kind: "slow" | "error";
  screen: string;
  action: string;
  status: number | null;
  duration_ms: number | null;
  message: string;
  device: string;
  role: string | null;
  username: string | null;
}

const JOURNAL_PATH = "/client-journal?limit=300";

function when(row: JournalRow): string {
  const raw = row.occurred_at ?? `${row.created_at.replace(" ", "T")}Z`;
  const d = new Date(raw);
  return Number.isNaN(d.getTime())
    ? raw
    : d.toLocaleString("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function seconds(ms: number | null): string {
  return ms == null ? "—" : `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} с`;
}

export function ClientJournalTab() {
  const journal = useResource<JournalRow[]>(JOURNAL_PATH);
  const run = useAction();
  const rows = journal.data ?? [];
  const errors = rows.filter((r) => r.kind === "error").length;

  if (journal.loading) return <p className="muted">Загрузка…</p>;
  if (journal.error) {
    return (
      <div className="stack">
        <p className="muted health-hint">Журнал не загрузился: {journal.error}</p>
        <div className="row">
          <button className="primary" onClick={journal.reload}>Повторить</button>
        </div>
      </div>
    );
  }
  if (rows.length === 0) {
    return <EmptyState kind="search" title="Журнал пуст" hint="Сюда попадают запросы дольше секунды и ошибки — со всех устройств, включая телефоны игроков." />;
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <span className="muted health-value">
          Записей: {rows.length} · ошибок: {errors} · медленных: {rows.length - errors}
        </span>
        <span className="row" style={{ gap: 8 }}>
          <button onClick={journal.reload}>Обновить</button>
          <button
            onClick={() =>
              void run(() => write.del("/client-journal"), { affects: [{ path: "/client-journal" }], retry: false })
            }
          >
            Очистить журнал
          </button>
        </span>
      </div>
      {rows.map((r) => (
        <div key={r.id} className="health-row">
          <span className="health-row--mono" style={{ flex: "1 1 320px", minWidth: 0 }}>
            <span className={r.kind === "error" ? "badge tag" : "muted"}>
              {r.kind === "error" ? `ошибка${r.status != null ? ` ${r.status}` : ""}` : `медленно ${seconds(r.duration_ms)}`}
            </span>{" "}
            <span className="health-value">{r.action}</span>
            {r.message && (
              <span className="muted health-path" style={{ display: "block", overflowWrap: "anywhere" }}>
                {r.message}
              </span>
            )}
          </span>
          <span className="muted health-value" style={{ flex: "1 1 240px", minWidth: 0 }}>
            {when(r)} · {r.username ?? "—"}
            {r.role === "player" ? " (игрок)" : ""}
            <span style={{ display: "block", overflowWrap: "anywhere" }}>
              {r.screen} · {r.device}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
