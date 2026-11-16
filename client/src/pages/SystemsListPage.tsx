import { useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { resourceQuery, useAction, useResource, write } from "../data/hooks";
import { labelled } from "../data/notices";
import { invalidateAffects } from "../data/entities";
import { importModuleFile } from "../data/moduleImport";
import { systemGroupAffects, systemPaths } from "../data/systems";
import { Modal } from "../components/Modal";
import { ListSkeleton, LoadErrorCard } from "../components/Loadable";
import { EmptyState } from "../components/EmptyState";
import { ListPage } from "../components/ListPage";
import { GroupMembersModal, removeFromGroupItem } from "../components/GroupMembersModal";
import { SectionBackground } from "../components/SectionBackground";
import { RegAddRow, RegAddTile, RegArchive, RegMeta, RegRow, RegTable, RegTile, RegTiles, useListView, type RegColumn } from "../components/ListRegistry";
import type { ContextMenuItem } from "../components/ContextMenu";
import { plural } from "../sceneKinds";
import { refreshMentionIndex } from "../mentions";

import type { System, SystemGroup } from "../types";

// Список систем — шаблон «Реестр» (доска Sys-List, гриллинг 2026-11-05, Q13):
// обложка, плашка кода (у своей — «своя»), «N кампаний · M статей».

const campaignsOf = (s: System) => {
  const n = s.campaigns_count ?? 0;
  return n ? `${n} ${plural(n, "кампания", "кампании", "кампаний")}` : "нет кампаний";
};
const entriesOf = (s: System) => {
  const n = s.entries_count ?? 0;
  return `${n.toLocaleString("ru")} ${plural(n, "статья", "статьи", "статей")}`;
};
/** Первая фраза описания — для строки «Списка». */
const firstSentence = (text: string) => text.split(/(?<=[.!?…])\s/)[0] ?? "";

// «Список» (Q8): Название · Описание · Кампаний · Своя/импорт; на телефоне — кампании (Q15).
const SYSTEM_COLUMNS: RegColumn[] = [
  { label: "Название", width: "minmax(0, 1.1fr)" },
  { label: "Описание", width: "minmax(0, 2fr)" },
  { label: "Кампаний", width: "minmax(110px, 0.7fr)", phone: true },
  { label: "Источник", width: "110px" },
];

export function SystemsListPage() {
  const client = useQueryClient();
  const run = useAction();
  const systemsState = useResource<System[]>(systemPaths.list());
  const systems = systemsState.data ?? NO_SYSTEMS;
  const loading = systemsState.loading;
  const loadError = systemsState.error;
  const importInput = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const [activeTab, setActiveTab] = useState<string | null>(null);
  const groups = useResource<SystemGroup[]>(systemPaths.groups()).data ?? NO_GROUPS;
  // Составы всех групп — по ключу на группу: окно состава и профиль системы
  // правят их через слой, и вкладки списка перечитывают только задетое.
  const memberQueries = useQueries({
    queries: groups.map((g) => resourceQuery<System[]>(systemPaths.groupMembers(g.id))),
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
  const [view, setView] = useListView("systems");

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
    // Порядок А–Я (Q16) — сервер уже сортирует по имени.
    if (!qq) return byTab;
    return byTab.filter(
      (s) =>
        s.name.toLowerCase().includes(qq) ||
        (s.code ?? "").toLowerCase().includes(qq) ||
        (s.description ?? "").toLowerCase().includes(qq)
    );
  }, [systems, activeTab, groupMembers, ungroupedIds, q]);
  const currentGroup = activeTab !== null && activeTab !== "ungrouped" ? groups.find((g) => g.id === Number(activeTab)) : undefined;
  const addToGroup = currentGroup ? () => setGroupModalGroupId(currentGroup.id) : undefined;
  const menuFor = (s: System): ContextMenuItem[] => (currentGroup ? [removeFromGroupItem("system", currentGroup, s.id, run)] : []);

  async function importSystem(file: File) {
    if (importing) return;
    setImporting(true);
    try {
      const installed = await run(labelled("Импорт системы", () => importModuleFile(file, "system")), {
        affects: [],
        retry: false,
      });
      if (!installed) return;
      setActiveTab(null);
      setQ("");
      void refreshMentionIndex();
    } finally {
      setImporting(false);
    }
  }

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
        ds
        headingSection="systems"
        title="Системы"
        actions={
          <>
            <button type="button" className="d-btn" disabled={importing} onClick={() => importInput.current?.click()}>
              {importing ? "Импортируем…" : "Импорт системы"}
            </button>
            <input
              ref={importInput}
              type="file"
              accept=".json,application/json"
              aria-label="Файл экспорта системы"
              hidden
              onChange={(e) => {
                const file = e.currentTarget.files?.[0];
                e.currentTarget.value = "";
                if (file) void importSystem(file);
              }}
            />
          </>
        }
        groups={groups.map((g, i) => ({ id: String(g.id), label: g.name, count: memberQueries[i]?.data?.length }))}
        groupsEndpoint="/system-groups"
        groupsDeleteNote="Системы не будут удалены — они останутся в разделе «Все системы»."
        onGroupsChanged={refreshGroups}
        createLabel="+ Новая система"
        onCreate={() => setCreating(true)}
        activeGroup={activeTab}
        onGroupChange={setActiveTab}
        search={q}
        onSearch={setQ}
        searchPlaceholder="Поиск по названию, коду, описанию…"
        searchLabel="Поиск по системам"
        filteredCount={filteredSystems.length}
        totalCount={systems.length}
        onResetSearch={() => setQ("")}
        view={view}
        onViewChange={setView}
      >
        {loadError && (
          <LoadErrorCard
            message={<>Не удалось загрузить системы: {loadError}</>}
            onRetry={refresh}
          />
        )}

        {loading ? (
          <ListSkeleton variant="tiles" label="Загрузка систем" />
        ) : view === "tiles" ? (
          (filteredSystems.length > 0 || addToGroup) && (
            <RegTiles>
              {filteredSystems.map((s) => (
                <RegTile key={s.id} entity={{ type: "system", id: s.id, name: s.name }} to={`/systems/${s.id}`}
                  image={s.thumbnail_image_url} plate={s.code || (s.imported_at ? null : "своя")} menu={menuFor(s)}>
                  <RegMeta none={!s.campaigns_count}>
                    <span className="reg-nowrap">{campaignsOf(s)}</span> <span className="reg-nowrap">· {entriesOf(s)}</span>
                  </RegMeta>
                </RegTile>
              ))}
              {addToGroup && <RegAddTile label="+ Систему в группу" onClick={addToGroup} />}
            </RegTiles>
          )
        ) : (
          <>
            {filteredSystems.length > 0 && (
              <RegTable columns={SYSTEM_COLUMNS} label="Системы">
                {filteredSystems.map((s) => (
                  <RegRow key={s.id} entity={{ type: "system", id: s.id, name: s.name }} to={`/systems/${s.id}`}
                    columns={SYSTEM_COLUMNS} menu={menuFor(s)}
                    cells={[
                      firstSentence(s.description ?? "") || <span className="is-none">без описания</span>,
                      <span className={`d-mono${s.campaigns_count ? "" : " is-none"}`}>{campaignsOf(s)}</span>,
                      <span className="d-mono">{s.imported_at ? "импорт" : "своя"}</span>,
                    ]} />
                ))}
              </RegTable>
            )}
            {addToGroup && <RegAddRow label="+ Систему в группу" onClick={addToGroup} />}
          </>
        )}

        {!loading && !loadError && filteredSystems.length === 0 && systems.length > 0 && !addToGroup && (
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
              <button className="d-btn" onClick={() => setCreating(true)}>
                + Новая система
              </button>
            }
          />
        )}
        <RegArchive type="system" basePath="/systems" affects={[{ path: systemPaths.list() }]} />
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
        <GroupMembersModal
          kind="system"
          groupId={groupModalGroupId}
          groupName={groups.find(g => g.id === groupModalGroupId)?.name ?? ""}
          onClose={() => setGroupModalGroupId(null)}
        />
      )}
    </div>
  );
}

const NO_SYSTEMS: System[] = [];
const NO_GROUPS: SystemGroup[] = [];
