import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { SectionHeading } from "../components/SectionHeading";
import { EmptyState } from "../components/EmptyState";
import { PlayerGroupTabs } from "../components/PlayerGroupTabs";
import { PlayerGroupMembersModal } from "../components/PlayerGroupMembersModal";
import { formatNearestDate } from "../nearestDate";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { SectionBackground } from "../components/SectionBackground";
import type { Player, PlayerGroup } from "../types";

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

export function PlayersListPage() {
  const [players, setPlayers] = useState<Player[]>([]);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const [groups, setGroups] = useState<PlayerGroup[]>([]);
  const [groupMemberships, setGroupMemberships] = useState<Record<number, number[]>>({});
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);
  const [q, setQ] = useState("");

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

  async function loadGroupMemberships(signal?: AbortSignal) {
    try {
      const fetchedGroups = await api.get<PlayerGroup[]>("/player-groups", signal ? { signal } : undefined);
      setGroups(fetchedGroups);
      const memberships: Record<number, number[]> = {};
      for (const g of fetchedGroups) {
        const members = await api.get<Player[]>(
          `/player-groups/${g.id}/members`,
          signal ? { signal } : undefined
        );
        for (const m of members) {
          if (!memberships[m.id]) memberships[m.id] = [];
          memberships[m.id].push(g.id);
        }
      }
      setGroupMemberships(memberships);
    } catch {
      // silent
    }
  }

  useEffect(() => {
    const controller = new AbortController();
    loadPlayers(controller.signal);
    loadGroupMemberships(controller.signal);
    return () => controller.abort();
  }, []);

  function refresh() {
    void loadPlayers();
    void loadGroupMemberships();
  }

  useEffect(() => () => { if (creating) setCreating(false); }, [creating]);

  const filteredPlayers = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byTab = (() => {
      if (activeTab === null) return players;
      if (activeTab === "ungrouped") {
        return players.filter((p) => !groupMemberships[p.id]?.length);
      }
      const groupId = Number(activeTab);
      return players.filter((p) => groupMemberships[p.id]?.includes(groupId));
    })();
    if (!qq) return byTab;
    return byTab.filter(
      (p) =>
        p.name.toLowerCase().includes(qq) ||
        (p.notes ?? "").toLowerCase().includes(qq)
    );
  }, [players, activeTab, groupMemberships, q]);

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
    <div className="stack" style={{ position: "relative", paddingBottom: "calc(var(--player-bar-height, 52px) + 16px)" }}>
      <SectionBackground />
      <div className="page-header-row row">
        <SectionHeading section="players" compact>Игроки</SectionHeading>
        <div className="row" style={{ gap: 8 }}>
          <Link
            to="/invitations"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 12px",
              border: "1px solid var(--line)",
              borderRadius: "var(--card-radius)",
              fontFamily: "var(--font-ui)",
              fontSize: 11,
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              textDecoration: "none",
              color: "var(--ink)",
              background: "var(--paper)",
            }}
          >
            Пригласить →
          </Link>
          <button className="primary" onClick={() => setCreating(true)}>
            + Новый игрок
          </button>
        </div>
      </div>

      {players.length > 0 && (
        <PlayerGroupTabs
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onGroupsChanged={refresh}
        />
      )}

      <div className="res-toolbar" style={{ marginTop: 4 }}>
        <input
          className="res-toolbar__search"
          placeholder="Поиск по имени, заметкам…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Поиск по игрокам"
        />
        <span className="muted" style={{ fontFamily: "var(--font-mono)", fontSize: "var(--fs-micro)" }}>
          {filteredPlayers.length} / {players.length}
        </span>
        {q && (
          <button
            onClick={() => setQ("")}
            style={{ fontSize: 11, padding: "2px 8px", height: 26 }}
            title="Сбросить поиск"
          >
            Сбросить
          </button>
        )}
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
          <div className="grid-cards">
            {filteredPlayers.map((p) => (
              <PlayerCoverTile key={p.id} player={p} />
            ))}
            {activeTab !== null && activeTab !== "ungrouped" && (
              <button
                className="card campaign-tile setting-group-empty-add"
                onClick={() => {
                  const g = groups.find((gr) => gr.id === Number(activeTab));
                  if (g) setGroupMembersModal({ groupId: g.id, groupName: g.name });
                }}
              >
                <div className="campaign-tile-cover cover-halftone">
                  <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
                  <div className="campaign-tile-scrim" />
                  <h3 className="campaign-tile-name">+</h3>
                </div>
                <div className="campaign-tile-meta">
                  <div className="campaign-tile-system muted">нажми, чтобы добавить игрока в группу</div>
                </div>
              </button>
            )}
          </div>
        </div>
      )}

      {!loading && !loadError && filteredPlayers.length === 0 && players.length > 0 && (
        <EmptyState
          icon="barcode"
          title="Ничего не найдено"
          hint={q.trim() ? `По «${q.trim()}» ничего нет.` : "Нет игроков в этой группе."}
          action={
            <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
              {q.trim() && <button onClick={() => setQ("")}>Сбросить поиск</button>}
              {activeTab !== null && <button onClick={() => setActiveTab(null)}>Показать всех</button>}
            </div>
          }
        />
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

      {groupMembersModal && (
        <PlayerGroupMembersModal
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={refresh}
        />
      )}
    </div>
  );
}
