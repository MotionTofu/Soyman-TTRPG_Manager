import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { api } from "../api/client";
import { useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { dataKeys, invalidateAffects } from "../data/entities";
import { systemGroupAffects, systemPaths } from "../data/systems";
import { Modal } from "../components/Modal";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { MentionText } from "../components/mentions/MentionText";
import { safeBackgroundImage, isSafeImageUrl } from "../utils/safeUrl";
import { useAuthenticatedFileUrl } from "../utils/fileUrl";
import { ListPage } from "../components/ListPage";
import { SystemGroupMembersModal } from "../components/SystemGroupMembersModal";
import { NavIcon } from "../components/NavIcons";
import { SectionBackground } from "../components/SectionBackground";

import type { System, SystemGroup } from "../types";

function SystemCoverTile({ system: s }: { system: System }) {
  const rawUrl = s.thumbnail_image_url ?? null;
  const imageUrl = rawUrl && isSafeImageUrl(rawUrl) ? rawUrl : null;
  const authBlob = useAuthenticatedFileUrl(imageUrl);
  const bg = imageUrl?.startsWith("/files/")
    ? (authBlob ? `url("${authBlob}")` : undefined)
    : safeBackgroundImage(imageUrl);

  return (
    <Link to={`/systems/${s.id}`} className="card campaign-tile">
      <div className="campaign-tile-cover cover-halftone">
        {bg ? (
          <div className="cover-art cover-photo">
            <div className="cover-art-image" style={{ backgroundImage: bg }} aria-hidden="true" />
          </div>
        ) : (
          <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
        )}
        <div className="campaign-tile-scrim" />
        <h3 className="campaign-tile-name">{s.name}</h3>
      </div>
      <div className="campaign-tile-meta">
        <div className="campaign-tile-system">
          {s.description ? <MentionText text={s.description} /> : "без описания"}
        </div>
        {s.imported_at && (
          <div className="campaign-tile-next">
            <span className="campaign-tile-next-mark" aria-hidden="true" />
            <span>импортировано</span>
          </div>
        )}
      </div>
    </Link>
  );
}

export function SystemsListPage() {
  const client = useQueryClient();
  const run = useAction();
  const systemsState = useResource<System[]>(systemPaths.list());
  const systems = systemsState.data ?? NO_SYSTEMS;
  const loading = systemsState.loading;
  const loadError = systemsState.error;
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const groups = useResource<SystemGroup[]>(systemPaths.groups()).data ?? NO_GROUPS;
  // Составы всех групп — по ключу на группу: окно состава и профиль системы
  // правят их через слой, и вкладки списка перечитывают только задетое.
  const memberQueries = useQueries({
    queries: groups.map((g) => ({
      queryKey: dataKeys.resource(systemPaths.groupMembers(g.id)),
      queryFn: ({ signal }: { signal: AbortSignal }) => api.get<System[]>(systemPaths.groupMembers(g.id), { signal }),
    })),
  });
  // Ключ по составу, а не по ссылкам: массив запросов пересобирается на
  // каждый рендер, и фильтр ниже пересчитывался бы вхолостую.
  const membersKey = groups
    .map((g, i) => `${g.id}:${memberQueries[i]?.data?.map((m) => m.id).join(",") ?? "-"}`)
    .join("|");
  const groupMembers = useMemo(() => {
    const map = new Map<number, Set<number>>();
    for (const part of membersKey ? membersKey.split("|") : []) {
      const [id, ids] = part.split(":");
      if (ids !== "-") map.set(Number(id), new Set(ids ? ids.split(",").map(Number) : []));
    }
    return map;
  }, [membersKey]);
  const ungroupedIds = useMemo(() => {
    const inGroups = new Set<number>();
    for (const ids of groupMembers.values()) for (const id of ids) inGroups.add(id);
    return new Set(systems.filter((s) => !inGroups.has(s.id)).map((s) => s.id));
  }, [groupMembers, systems]);
  const [groupModalGroupId, setGroupModalGroupId] = useState<number | null>(null);
  const [q, setQ] = useState("");

  // Группы правит каркас списка (ListPage) мимо слоя — после его правки
  // перечитываются группы и их составы.
  function refreshGroups() {
    void invalidateAffects(client, systemGroupAffects());
  }

  function refresh() {
    void systemsState.reload();
    refreshGroups();
  }

  const filteredSystems = useMemo(() => {
    const qq = q.trim().toLowerCase();
    const byTab = (() => {
      if (activeTab === null) return systems;
      if (activeTab === "ungrouped") return systems.filter(s => ungroupedIds.has(s.id));
      const groupId = Number(activeTab);
      const memberIds = groupMembers.get(groupId);
      if (!memberIds) return systems.filter(() => false);
      return systems.filter(s => memberIds.has(s.id));
    })();
    if (!qq) return byTab;
    return byTab.filter(
      (s) =>
        s.name.toLowerCase().includes(qq) ||
        (s.code ?? "").toLowerCase().includes(qq) ||
        (s.description ?? "").toLowerCase().includes(qq)
    );
  }, [systems, activeTab, groupMembers, ungroupedIds, q]);

  async function create() {
    if (!name.trim()) return;
    // При отказе окно остаётся открытым с набранным, а плашка говорит, что
    // не так; раньше отказ был молчаливым.
    const created = await run(labelled("Новая система", () => write.post<System>("/systems", { name, description })), {
      affects: [{ path: systemPaths.list() }],
      retry: false,
    });
    if (!created) return;
    setCreating(false);
    setName("");
    setDescription("");
  }

  return (
    <div className="stack" style={{ position: "relative" }}>
      <SectionBackground />
      <ListPage
        headingSection="systems"
        title="Системы"
        groups={groups.map((g) => ({ id: String(g.id), label: g.name }))}
        groupsEndpoint="/system-groups"
        groupsDeleteNote="Системы не будут удалены — они останутся в разделе «Все системы»."
        onGroupsChanged={refreshGroups}
        createLabel="+ Новая система"
        onCreate={() => setCreating(true)}
        activeGroup={activeTab}
        onGroupChange={setActiveTab}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по имени, коду, описанию…"
        searchLabel="Поиск по системам"
        filteredCount={filteredSystems.length}
        totalCount={systems.length}
        onResetSearch={() => setQ("")}
      >
        {loadError && (
          <LoadErrorCard
            message={<>Не удалось загрузить системы: {loadError}</>}
            onRetry={refresh}
          />
        )}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка систем" />
        ) : (
          <div className="grid-cards">
            {filteredSystems.map((s) => (
              <SystemCoverTile key={s.id} system={s} />
            ))}
            {activeTab !== null && activeTab !== "ungrouped" && (
              <button
                className="card campaign-tile setting-group-empty-add"
                onClick={() => {
                  const g = groups.find((gr) => gr.id === Number(activeTab));
                  if (g) setGroupModalGroupId(g.id);
                }}
              >
                <div className="campaign-tile-cover cover-halftone">
                  <div className="cover-art cover-art-fallback zine-grain" aria-hidden="true" />
                  <div className="campaign-tile-scrim" />
                  <span className="group-add-icon"><NavIcon name="gears" /></span>
                  <h3 className="campaign-tile-name">+</h3>
                </div>
                <div className="campaign-tile-meta">
                  <div className="campaign-tile-system muted">нажми, чтобы добавить систему в группу</div>
                </div>
              </button>
            )}
          </div>
        )}

        {!loading && !loadError && filteredSystems.length === 0 && systems.length > 0 && (
          <EmptyState kind="search"
            title="Ничего не найдено"
            hint={q.trim() ? `По «${q.trim()}» ничего нет.` : "Нет систем в этой группе."}
            action={
              <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
                {q.trim() && <button onClick={() => setQ("")}>Сбросить поиск</button>}
                <button onClick={() => setActiveTab(null)}>Показать все</button>
              </div>
            }
          />
        )}

        {!loading && !loadError && systems.length === 0 && (
          <EmptyState
            title="Правил ещё нет"
            hint="Ни одной системы не заведено — добавьте первую."
            action={
              <button className="primary" onClick={() => setCreating(true)}>
                + Новая система
              </button>
            }
          />
        )}
      </ListPage>

      {creating && (
        <Modal onClose={() => setCreating(false)}>
          <h2>Новая система</h2>
          <div className="stack">
            <label>
              Название
              <input value={name} onChange={(e) => setName(e.target.value)} />
            </label>
            <label>
              Описание
              <textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
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

      {groupModalGroupId !== null && (
        <SystemGroupMembersModal
          groupId={groupModalGroupId}
          groupName={groups.find(g => g.id === groupModalGroupId)?.name ?? ""}
          onClose={() => setGroupModalGroupId(null)}
          onUpdated={() => undefined}
        />
      )}
    </div>
  );
}

const NO_SYSTEMS: System[] = [];
const NO_GROUPS: SystemGroup[] = [];
