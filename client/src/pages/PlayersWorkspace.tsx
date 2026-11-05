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
import { GroupMembersModal, removeFromGroupItem } from "../components/GroupMembersModal";
import { SectionBackground } from "../components/SectionBackground";
import { ListPage } from "../components/ListPage";
import { RegAddRow, RegAddTile, RegArchive, RegMeta, RegRow, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import type { ContextMenuItem } from "../components/ContextMenu";
import { MentionText } from "../components/mentions/MentionText";
import { formatNearestDate } from "../nearestDate";
import type { Player, PlayerGroup } from "../types";
import "./players-d.css";

// «Список» (Q8): Игрок · Заметка · Ближайшая игра; на телефоне — игра (Q15).
const PLAYER_COLUMNS: RegColumn[] = [
  { label: "Игрок", width: "minmax(0, 1fr)" },
  { label: "Заметка", width: "minmax(0, 1.6fr)" },
  { label: "Ближайшая игра", width: "minmax(130px, 0.8fr)", phone: true },
];
const nearest = (p: Player) => (p.next_planned_date ? formatNearestDate(p.next_planned_date) : "не запланирована");

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
  const [view, setView] = useListView("players");
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
    const found = qq
      ? byTab.filter((p) => p.name.toLowerCase().includes(qq) || (p.notes ?? "").toLowerCase().includes(qq))
      : byTab;
    // Порядок А–Я (Q16).
    return [...found].sort((a, b) => a.name.localeCompare(b.name, "ru"));
  })();
  const currentGroup = activeTab !== null && activeTab !== "ungrouped" ? groups.find((g) => g.id === Number(activeTab)) : undefined;
  const addToGroup = currentGroup ? () => setGroupMembersModal({ groupId: currentGroup.id, groupName: currentGroup.name }) : undefined;
  const menuFor = (p: Player): ContextMenuItem[] => (currentGroup ? [removeFromGroupItem("player", currentGroup, p.id, run)] : []);

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
    <div className="stack">
      <SectionBackground />
      <ListPage
        ds
        allLabel="Все игроки"
        ungroupedLabel="Вне групп"
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
        view={view}
        onViewChange={setView}
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
          <ListSkeleton variant="tiles" label="Загрузка игроков" />
        ) : (
          <>
            {view === "tiles" ? (
              (filteredPlayers.length > 0 || addToGroup) && (
                <RegTiles>
                  {filteredPlayers.map((p) => (
                    <RegTile key={p.id} entity={{ type: "player", id: p.id, name: p.name }} to={`/players/${p.id}`}
                      image={p.thumbnail_image_url ?? p.avatar_image_url} menu={menuFor(p)}
                      placeholder={<span className="players-d-glyph" aria-hidden="true" />}>
                      {p.notes ? <div className="reg-tile__text"><MentionText text={p.notes} /></div> : null}
                      <RegMeta none={!p.next_planned_date}>{p.next_planned_date ? formatNearestDate(p.next_planned_date) : "игра не запланирована"}</RegMeta>
                    </RegTile>
                  ))}
                  {addToGroup && <RegAddTile label="+ Игрока в группу" onClick={addToGroup} />}
                </RegTiles>
              )
            ) : (
              <>
                {filteredPlayers.length > 0 && (
                  <RegTable columns={PLAYER_COLUMNS} label="Игроки">
                    {filteredPlayers.map((p) => (
                      <RegRow key={p.id} entity={{ type: "player", id: p.id, name: p.name }} to={`/players/${p.id}`}
                        columns={PLAYER_COLUMNS} menu={menuFor(p)}
                        cells={[
                          p.notes ? <MentionText text={p.notes} /> : <span className="is-none">—</span>,
                          <span className={`d-mono${p.next_planned_date ? "" : " is-none"}`}>{nearest(p)}</span>,
                        ]} />
                    ))}
                  </RegTable>
                )}
                {addToGroup && <RegAddRow label="+ Игрока в группу" onClick={addToGroup} />}
              </>
            )}
            {players.length > 0 && filteredPlayers.length === 0 && !addToGroup && (
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
          </>
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
        <RegArchive type="player" basePath="/players" affects={[{ kind: "player" }]} />
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
        <GroupMembersModal
          kind="player"
          groupId={groupMembersModal.groupId}
          groupName={groupMembersModal.groupName}
          onClose={() => setGroupMembersModal(null)}
          onUpdated={refreshGroups}
        />
      )}
    </div>
  );
}
