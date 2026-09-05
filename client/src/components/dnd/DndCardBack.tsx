import { inboxSourceLabel, type CharacterInboxMessage } from "./characterInbox";
import { textOnClassColor } from "./dndClassColors";
import type { ReactNode } from "react";

// Оборот первой карты — входящие игрока (этап 4). Чистый показ: состояние
// и запросы живут в DndCharacterView, здесь только разметка рубашки.
// Рубашка — инверсия (чёрное на бумаге, глубина инверсией, не тенью),
// единственная краска — цвет класса. По канвасу CardBack.dc.html.

// Дата SQLite ("2026-09-05 21:14:00", UTC) в короткую подпись. Без seconds:
// на обороте тесно, а секунды там никому не нужны.
function shortDate(raw: string): string {
  const d = new Date(raw.replace(" ", "T") + "Z");
  if (Number.isNaN(d.getTime())) return raw;
  return d.toLocaleString("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function DndCardBack({
  characterName,
  color,
  messages,
  loading,
  loadError,
  denied,
  notice,
  busyId,
  savedIds,
  onRetry,
  onRead,
  onSave,
  onClose,
  children,
}: {
  characterName: string;
  color: string;
  messages: CharacterInboxMessage[];
  loading: boolean;
  loadError: string | null;
  denied: boolean;
  notice: string | null;
  busyId: number | null;
  savedIds: ReadonlySet<number>;
  onRetry: () => void;
  onRead: (id: number) => void;
  onSave: (id: number) => void;
  onClose: () => void;
  // Слот под инструмент передач (этап 4б): тот же оборот, та же рубашка.
  children?: ReactNode;
}) {
  const unread = messages.filter((m) => !m.read_at).length;
  return (
    <div
      className="dnd-card-back"
      style={{ borderLeftColor: color, borderRightColor: color }}
      role="region"
      aria-label="Оборот карты: входящие"
    >
      <div className="dnd-card-back-head">
        <span className="dnd-card-back-title">Входящие</span>
        <span className="dnd-card-back-sub">
          {characterName}
          {unread > 0 && ` · ${unread} нов.`}
        </span>
      </div>
      {denied && (
        <p className="muted dnd-card-back-empty">
          Оборот читает владелец персонажа: откройте лист под игроком. Мастер пишет сюда из карточки персонажа.
        </p>
      )}
      {!denied && loading && <p className="muted dnd-card-back-empty">Загрузка…</p>}
      {!denied && !loading && loadError && (
        <div className="stack dnd-card-back-empty">
          <span>Входящие не загрузились: {loadError}</span>
          <button type="button" className="comp-mini" onClick={onRetry}>
            Повторить
          </button>
        </div>
      )}
      {!denied && !loading && !loadError && messages.length === 0 && (
        <p className="muted dnd-card-back-empty">Пока тихо — Мастер ещё ничего не прислал.</p>
      )}
      {!denied && !loading && !loadError && messages.length > 0 && (
        <div className="stack dnd-card-back-list">
          {messages.map((m) => {
            const isNew = !m.read_at;
            const busy = busyId === m.id;
            const saved = savedIds.has(m.id);
            return (
              <article
                key={m.id}
                className={`dnd-inbox-item${isNew ? " is-new" : ""}`}
                style={isNew ? { borderLeftColor: color } : undefined}
              >
                <div className="row dnd-inbox-meta">
                  <span
                    className={`dnd-inbox-badge${isNew ? " is-new" : ""}`}
                    style={isNew ? { background: color, color: textOnClassColor(color) } : undefined}
                  >
                    {inboxSourceLabel(m.target_type)}
                  </span>
                  <span className="dnd-inbox-date">{shortDate(m.created_at)}{!isNew && " · прочитано"}</span>
                </div>
                <p className="dnd-inbox-text">{m.message}</p>
                <div className="row dnd-inbox-actions">
                  {isNew && (
                    <button type="button" className="primary comp-mini" disabled={busy} onClick={() => onRead(m.id)}>
                      {busy ? "…" : "Прочитано"}
                    </button>
                  )}
                  <button type="button" className="comp-mini" disabled={busy || saved} onClick={() => onSave(m.id)}>
                    {saved ? "Сохранено ✓" : busy ? "…" : "В путевые заметки"}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {notice && <p className="dnd-card-back-notice" role="status">{notice}</p>}
      {children}
      {/* Угол возврата — тот же треугольник, что на лицевой, но бумажный на
          чёрном (по канвасу). Единственный жест назад с оборота. */}
      <button
        type="button"
        className="dnd-card-back-corner"
        onClick={onClose}
        aria-label="Вернуться на лицевую сторону карты"
      />
    </div>
  );
}
