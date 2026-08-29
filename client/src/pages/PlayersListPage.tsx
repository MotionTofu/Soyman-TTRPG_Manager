import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { formatNearestDate } from "../nearestDate";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import type { Player } from "../types";

function PlayerCoverTile({ player: p }: { player: Player }) {
  const rawUrl = p.thumbnail_image_url ?? p.avatar_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link to={`/players/${p.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {bg ? (
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{p.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">
          {p.notes ? <MentionText text={p.notes} /> : "без описания"}
        </div>
        {p.next_planned_date && (
          <div className="campaign-tile-next">
            <span className="campaign-tile-next-mark" aria-hidden="true" />
            <span>{formatNearestDate(p.next_planned_date)}</span>
          </div>
        )}
      </div>
    </Link>
  );
}

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
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadPlayers(signal?: AbortSignal) {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await api.get<Player[]>("/players", signal ? { signal } : undefined);
      setPlayers(data);
    } catch (e) {
      if ((e as Error).name === "AbortError") return;
      setLoadError(String(e instanceof Error ? e.message : e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadPlayers(controller.signal);
    return () => controller.abort();
  }, []);

  function refresh() {
    void loadPlayers();
  }

  useEffect(() => () => { if (creating) setCreating(false); }, [creating]);

  async function create() {
    if (!name.trim()) return;
    try {
      const created = await api.post<Player>("/players", { name, notes });
      syncMentionLinks("player", created.id, "", notes);
      setCreating(false);
      setName("");
      setNotes("");
      refresh();
    } catch {
      // Modal stays open — user can retry
    }
  }

  return (
    <div className="stack">
      <div className="page-header-row row">
        <SectionHeading section="players" compact>Игроки</SectionHeading>
        <button className="primary" onClick={() => setCreating(true)}>
          + Новый игрок
        </button>
      </div>

      {loadError && (
        <div className="card" style={{ borderLeft: "3px solid var(--status-cancelled)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Не удалось загрузить игроков: {loadError}</span>
          <button className="primary" onClick={refresh}>Повторить</button>
        </div>
      )}

      {loading ? (
        <div className="grid-cards" aria-busy="true" aria-label="Загрузка игроков">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card" style={{ height: 220, opacity: 0.45, background: "var(--bg-elevated)", animation: "search-skeleton-pulse 1.1s ease-in-out infinite alternate", animationDelay: `${i * 120}ms` }} />
          ))}
        </div>
      ) : (
        <div className="stack">
          {groupPlayersByLetter(players).map(([letter, group]) => (
            <div key={letter} className="player-list-section">
              <div className="player-list-letter">{letter}</div>
              <div className="grid-cards">
                {group.map((p) => (
                  <PlayerCoverTile key={p.id} player={p} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!loading && !loadError && players.length === 0 && (
        <EmptyState
          icon="splatter"
          title="Стол пустует"
          hint="Ни одного игрока ещё не заведено — добавьте первого."
          action={
            <button className="primary" onClick={() => setCreating(true)}>
              + Новый игрок
            </button>
          }
        />
      )}

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
            <div className="modal-footer row">
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
