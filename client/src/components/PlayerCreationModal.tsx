import { useState } from "react";
import { api } from "../api/client";
import { Modal } from "./Modal";
import type { Player } from "../types";

// Модалка создания игроков — до 6 за раз. Обязательное поле: имя.
// Описание (notes) опционально. Логин/пароль не предусмотрены API.

interface DraftPlayer {
  key: number;
  name: string;
  notes: string;
}

const MAX_PLAYERS = 6;

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function PlayerCreationModal({ onClose, onCreated }: Props) {
  const [drafts, setDrafts] = useState<DraftPlayer[]>([
    { key: 0, name: "", notes: "" },
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function addDraft() {
    if (drafts.length >= MAX_PLAYERS) return;
    setDrafts([...drafts, { key: Date.now(), name: "", notes: "" }]);
  }

  function removeDraft(key: number) {
    setDrafts(drafts.filter((d) => d.key !== key));
  }

  function updateDraft(key: number, field: "name" | "notes", value: string) {
    setDrafts(drafts.map((d) => (d.key === key ? { ...d, [field]: value } : d)));
  }

  const validDrafts = drafts.filter((d) => d.name.trim().length > 0);
  const canCreate = validDrafts.length > 0 && !saving;

  async function create() {
    if (!canCreate) return;
    setSaving(true);
    setError(null);
    try {
      await Promise.all(
        validDrafts.map((d) =>
          api.post<Player>("/players", { name: d.name.trim(), notes: d.notes.trim() })
        )
      );
      onCreated();
    } catch (e: any) {
      setError(e?.message || "Ошибка создания");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose}>
      <div className="stack">
        <h3 style={{ margin: 0 }}>Новые игроки</h3>
        {drafts.map((draft, i) => (
          <div key={draft.key} className="player-draft">
            <div className="player-draft-header">
              <span className="player-draft-num">{i + 1}</span>
              {drafts.length > 1 && (
                <button
                  type="button"
                  className="player-draft-remove"
                  onClick={() => removeDraft(draft.key)}
                  aria-label="Убрать"
                >
                  ×
                </button>
              )}
            </div>
            <div className="stack">
              <label>
                Имя
                <input
                  value={draft.name}
                  onChange={(e) => updateDraft(draft.key, "name", e.target.value)}
                  placeholder="Имя игрока"
                  autoFocus={i === 0}
                />
              </label>
              <label>
                Описание
                <input
                  value={draft.notes}
                  onChange={(e) => updateDraft(draft.key, "notes", e.target.value)}
                  placeholder="Краткое описание (необязательно)"
                />
              </label>
            </div>
          </div>
        ))}

        {drafts.length < MAX_PLAYERS && (
          <button type="button" className="player-draft-add" onClick={addDraft}>
            + Ещё игрока
          </button>
        )}

        {error && <p className="error-text">{error}</p>}

        <div className="row">
          <button onClick={onClose}>Отмена</button>
          <button className="primary" disabled={!canCreate} onClick={create}>
            {saving ? "Создание..." : `Создать${validDrafts.length > 0 ? ` (${validDrafts.length})` : ""}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
