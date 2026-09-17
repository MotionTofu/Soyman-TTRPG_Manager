import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useAction, useResource, write } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { labelled } from "../data/notices";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { MentionText } from "../components/mentions/MentionText";
import { syncMentionLinks } from "../mentions";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { PlayerGroupMembersModal } from "../components/PlayerGroupMembersModal";
import { formatNearestDate } from "../nearestDate";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { SectionBackground } from "../components/SectionBackground";
import { PlayerProfilePanel } from "../components/players/PlayerProfilePanel";
import { ListPage } from "../components/ListPage";
import type { Player, PlayerGroup } from "../types";

function PlayerCoverTile({ player: p, active }: { player: Player; active: boolean }) {
  const rawUrl = p.thumbnail_image_url ?? p.avatar_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link
      to={`/players/${p.id}`}
      className={`card campaign-tile${active ? " campaign-tile--active" : ""}`}
      aria-current={active ? "true" : undefined}
    >
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

const NO_PLAYERS: Player[] = [];
const NO_GROUPS: PlayerGroup[] = [];
/** Группы игроков: список, составы и отметки в профиле — всё под одним префиксом. */
const GROUP_AFFECTS = [{ path: "/player-groups" }];

export function PlayersWorkspace({ selectedId }: { selectedId?: number }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const run = useAction();
  const playersState = useResource<Player[]>("/players");
  const players = playersState.data ?? NO_PLAYERS;
  const loading = playersState.loading;
  const loadError = playersState.error;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const groups = useResource<PlayerGroup[]>("/player-groups").data ?? NO_GROUPS;
  // Составы всех групп — параллельно и под тем же ключом, что у окна «добавить
  // в группу» (раньше — по очереди, по запросу на группу).
  const memberQueries = useQueries({
    queries: groups.map((g) => resourceQuery<Player[]>(`/player-groups/${g.id}/members`)),
  });
  const groupMemberships: Record<number, number[]> = {};
  groups.forEach((g, i) => {
    for (const m of memberQueries[i]?.data ?? []) {
      if (!groupMemberships[m.id]) groupMemberships[m.id] = [];
      groupMemberships[m.id].push(g.id);
    }
  });
  const [groupMembersModal, setGroupMembersModal] = useState<{ groupId: number; groupName: string } | null>(null);
  const [q, setQ] = useState("");

  // Группы правит каркас списка (ListPage) — после его правки перечитываются
  // группы и их составы.
  function refreshGroups() {
    void invalidateAffects(client, GROUP_AFFECTS);
  }

  useEffect(() => () => { if (creating) setCreating(false); }, [creating]);

  const filteredPlayers = (() => {
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
  })();

  const effectiveSelectedId = selectedId ?? null;

  useEffect(() => {
    if (selectedId == null) return;
    if (!window.matchMedia("(max-width: 900px)").matches) return;
    document.getElementById("player-detail")?.scrollIntoView({ block: "start" });
  }, [selectedId]);

  async function create() {
    if (!name.trim()) return;
    // Модалка остаётся открытой при отказе — набранное не теряется.
    const created = await run(labelled("Новый игрок", () => write.post<Player>("/players", { name, notes })), {
      affects: [{ kind: "player" }],
      retry: false,
    });
    if (!created) return;
    syncMentionLinks("player", created.id, "", notes);
    setCreating(false);
    setName("");
    setNotes("");
  }

  const selectedPlayer = effectiveSelectedId != null
    ? players.find((p) => p.id === effectiveSelectedId) ?? null
    : null;

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <ListPage
        headingSection="players"
        title="Игроки"
        groups={groups.map((g) => ({ id: String(g.id), label: g.name }))}
        groupsEndpoint="/player-groups"
        groupsDeleteNote="Игроки не будут удалены — они останутся в разделе «Все игроки»."
        onGroupsChanged={refreshGroups}
        createLabel="+ Новый игрок"
        onCreate={() => setCreating(true)}
        actions={
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
              fontSize: "var(--fs-micro)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              textDecoration: "none",
              color: "var(--ink)",
              background: "var(--paper)",
            }}
          >
            Пригласить →
          </Link>
        }
        activeGroup={activeTab}
        onGroupChange={(g) => { setActiveTab(g); navigate("/players"); }}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по имени, заметкам…"
        searchLabel="Поиск по игрокам"
        filteredCount={filteredPlayers.length}
        totalCount={players.length}
        onResetSearch={() => setQ("")}
        selectedId={effectiveSelectedId != null ? String(effectiveSelectedId) : null}
        onSelect={(id) => {
          if (id) {
            navigate(`/players/${id}`);
            if (window.matchMedia("(max-width: 900px)").matches) {
              requestAnimationFrame(() => {
                document.getElementById("player-detail")?.scrollIntoView({ block: "start" });
              });
            }
          } else {
            navigate("/players");
          }
        }}
        preview={
          selectedPlayer ? (
            <PlayerProfilePanel key={selectedPlayer.id} playerId={selectedPlayer.id} />
          ) : undefined
        }
      >
        {loadError && (
          <LoadErrorCard
            message={<>Не удалось загрузить игроков: {loadError}</>}
            onRetry={playersState.reload}
          />
        )}

        {loading ? (
          <ListSkeleton variant="tiles" tilesClassName="players-tiles" label="Загрузка игроков" />
        ) : (
          <div className="players-tiles">
            {filteredPlayers.map((p) => (
              <PlayerCoverTile key={p.id} player={p} active={p.id === effectiveSelectedId} />
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
        )}

        {!loading && !loadError && filteredPlayers.length === 0 && players.length > 0 && (
          <EmptyState kind="search"
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
            title="Стол пустует"
            hint="Ни одного игрока ещё не заведено — добавьте первого."
            action={
              <button className="primary" onClick={() => setCreating(true)}>
                + Новый игрок
              </button>
            }
          />
        )}
      </ListPage>

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
          onUpdated={refreshGroups}
        />
      )}
    </div>
  );
}
