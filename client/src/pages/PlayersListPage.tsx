import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { SectionHeading } from "../components/SectionHeading";
import type { Player } from "../types";

// Groups players by the first letter of their name (locale-aware, so
// Cyrillic and Latin names each sort and group correctly), for a
// contacts-list-style presentation instead of a plain grid.
function groupPlayersByLetter(players: Player[]): [string, Player[]][] {
  const sorted = [...players].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  const groups = new Map<string, Player[]>();
  for (const p of sorted) {
    const letter = (p.name.trim()[0] || "#").toUpperCase();
    if (!groups.has(letter)) groups.set(letter, []);
    groups.get(letter)!.push(p);
  }
  return [...groups.entries()];
}

export function PlayersListPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  function refresh() {
    api.get<Player[]>("/players").then(setPlayers);
  }
  useEffect(refresh, []);

  async function create() {
    if (!name.trim()) return;
    const created = await api.post<Player>("/players", { name, notes });
    syncMentionLinks("player", created.id, "", notes);
    setCreating(false);
    setName("");
    setNotes("");
    refresh();
  }

  return (
    <div className="stack">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <SectionHeading>Игроки</SectionHeading>
        <button className="primary" onClick={() => setCreating(true)}>
          + Новый игрок
        </button>
      </div>
      <div className="stack">
        {groupPlayersByLetter(players).map(([letter, group]) => (
          <div key={letter} className="stack" style={{ gap: 4 }}>
            <div className="player-list-letter">{letter}</div>
            <div className="card stack" style={{ gap: 0 }}>
              {group.map((p) => (
                <Link key={p.id} to={`/players/${p.id}`} className="row player-list-row">
                  {p.thumbnail_image_url || p.avatar_image_url ? (
                    <img
                      src={p.thumbnail_image_url ?? p.avatar_image_url ?? undefined}
                      alt=""
                      className="player-list-avatar"
                    />
                  ) : (
                    <div className="player-list-avatar player-list-avatar-placeholder" />
                  )}
                  <div className="stack" style={{ gap: 2, minWidth: 0 }}>
                    <strong>{p.name}</strong>
                    {p.notes && (
                      <div className="muted player-list-notes-preview">
                        <MentionText text={p.notes} />
                      </div>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {players.length === 0 && <p className="muted">Пока нет игроков.</p>}
      </div>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2>Новый игрок</h2>
          <div className="stack">
            <label>
              Имя
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Заметки
              <MentionTextarea value={notes} onChange={setNotes} />
            </label>
            <div className="row" style={{ justifyContent: "flex-end" }}>
              <button onClick={() => setCreating(false)}>Отмена</button>
              <button className="primary" onClick={create}>
                Создать
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
