import { useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useAction, useResource, write } from "../data/hooks";
import { invalidateAffects } from "../data/entities";
import { labelled } from "../data/notices";
import { Modal } from "../components/Modal";
import { MentionTextarea } from "../components/mentions/MentionTextarea";
import { syncMentionLinks } from "../mentions";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { PlayerGroupMembersModal } from "../components/PlayerGroupMembersModal";
import { SectionBackground } from "../components/SectionBackground";
import { ListPage } from "../components/ListPage";
import { PlayerListCard } from "../components/players/PlayerListCard";
import type { Player, PlayerGroup } from "../types";
import "./players-d.css";

const NO_PLAYERS: Player[] = [];
const NO_GROUPS: PlayerGroup[] = [];
/** Группы игроков: список, составы и отметки в профиле — всё под одним префиксом. */
const GROUP_AFFECTS = [{ path: "/player-groups" }];

export function PlayersWorkspace() {
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
  const [view, setView] = useState<"tiles" | "rows">("tiles");
  const [saving, setSaving] = useState(false);

  // Группы правит каркас списка (ListPage) — после его правки перечитываются
  // группы и их составы.
  function refreshGroups() {
    void invalidateAffects(client, GROUP_AFFECTS);
  }


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

  async function create() {
    if (!name.trim() || saving) return;
    setSaving(true);
    try {
      const created = await run(labelled("Новый игрок", () => write.post<Player>("/players", { name: name.trim(), notes })), {
        affects: [{ kind: "player" }], retry: false,
      });
      if (!created) return;
      syncMentionLinks("player", created.id, "", notes);
      setCreating(false);
      setName("");
      setNotes("");
    } finally { setSaving(false); }
  }

  return (
    <div className="stack players-list-d">
      <SectionBackground />
      <ListPage
        ds
        groupsAbove
        allLabel="Все игроки"
        ungroupedLabel="Без группы"
        headingSection="players"
        title="Игроки"
        groups={groups.map((g, index) => ({ id: String(g.id), label: g.name, count: memberQueries[index]?.data?.length }))}
        groupsEndpoint="/player-groups"
        groupsDeleteNote="Игроки не будут удалены — они останутся в разделе «Все игроки»."
        onGroupsChanged={refreshGroups}
        createLabel="+ Новый игрок"
        onCreate={() => setCreating(true)}
        actions={
          <Link to="/invitations" className="d-btn"          >
            Пригласить →
          </Link>
        }
        activeGroup={activeTab}
        onGroupChange={setActiveTab}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по имени, заметкам…"
        searchLabel="Поиск по игрокам"
        toolbarExtra={
          <div className="d-seg players-list-d__view" role="group" aria-label="Вид списка игроков">
            <button type="button" className={view === "tiles" ? "active" : ""} aria-pressed={view === "tiles"} onClick={() => setView("tiles")}>Плитки</button>
            <button type="button" className={view === "rows" ? "active" : ""} aria-pressed={view === "rows"} onClick={() => setView("rows")}>Список</button>
          </div>
        }
        filteredCount={filteredPlayers.length}
        totalCount={players.length}
        onResetSearch={() => setQ("")}
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
          <div className="players-workspace">
            <div className={`players-d-items players-d-items--${view}`}>
              {filteredPlayers.map((p) => <PlayerListCard key={p.id} player={p} />)}
            </div>
            {activeTab !== null && activeTab !== "ungrouped" && (
              <button type="button" className="d-btn players-list-d__members" onClick={() => {
                const group = groups.find((g) => g.id === Number(activeTab));
                if (group) setGroupMembersModal({ groupId: group.id, groupName: group.name });
              }}>Изменить состав группы</button>
            )}
            {players.length > 0 && filteredPlayers.length === 0 && (
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
          </div>
        )}

        {!loading && !loadError && players.length === 0 && (
          <EmptyState
            title="Стол пустует"
            hint="Ни одного игрока ещё не заведено — добавьте первого."
            action={
              <button className="d-btn" onClick={() => setCreating(true)}>
                + Новый игрок
              </button>
            }
          />
        )}
      </ListPage>

      {creating && (
        <Modal onClose={() => !saving && setCreating(false)} ariaLabel="Новый игрок">
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
              <button onClick={() => setCreating(false)} disabled={saving}>Отмена</button>
              <button className="primary" onClick={create} disabled={saving || !name.trim()}>
                {saving ? "Создание…" : "Создать"}
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
